import { useState, useEffect } from 'react';
import { getAuth, clearAuth, getApiKey, hydrateFromServer, getCustomer, getProjects } from './utils/storage';
import Login from './components/Login';
import Nav from './components/Nav';
import Projects from './components/Projects';
import CustomerView from './components/CustomerView';
import ProjectView from './components/ProjectView';
import Settings from './components/Settings';
import ShareView from './components/ShareView';
import { useToast } from './components/Toast';

function detectShareToken() {
  if (typeof window === 'undefined') return null;
  const m = window.location.pathname.match(/^\/share\/([^/?#]+)/);
  return m ? decodeURIComponent(m[1]) : null;
}

export default function App() {
  const shareToken = detectShareToken();
  if (shareToken) {
    return <ShareView token={shareToken} />;
  }
  return <AppAuthed />;
}

function AppAuthed() {
  const [authed, setAuthed] = useState(!!getAuth());
  const [hydrated, setHydrated] = useState(!getAuth());
  const [view, setView] = useState('projects'); // 'projects' | 'customer' | 'project' | 'settings'
  const [customerId, setCustomerId] = useState(null);
  const [customerName, setCustomerName] = useState('');
  const [projectId, setProjectId] = useState(null);
  const [projectName, setProjectName] = useState('');
  const toast = useToast();

  // Hydrate on login / app mount, and poll every 30s to pick up teammates' edits
  // into localStorage. Changes appear on the next navigation / reload.
  useEffect(() => {
    if (!authed) { setHydrated(true); return; }
    let cancelled = false;
    (async () => {
      try { await hydrateFromServer(); } catch (err) { console.error('[hydrate] failed', err); }
      if (!cancelled) setHydrated(true);
    })();
    const id = setInterval(() => { hydrateFromServer().catch(() => {}); }, 30_000);
    return () => { cancelled = true; clearInterval(id); };
  }, [authed]);

  // Surface save conflicts (teammate saved while we had a pending push).
  useEffect(() => {
    const onConflict = () => {
      toast.info?.('Teammate saved while you were editing — latest version loaded');
    };
    window.addEventListener('leadhunt:state_conflict', onConflict);
    return () => window.removeEventListener('leadhunt:state_conflict', onConflict);
  }, [toast]);

  const handleLogin = () => { setAuthed(true); setHydrated(false); };

  const handleLogout = () => {
    clearAuth();
    setAuthed(false);
    setView('projects');
    setCustomerId(null);
    setCustomerName('');
    setProjectId(null);
    setProjectName('');
  };

  const handleSelectCustomer = (id, name) => {
    setCustomerId(id);
    setCustomerName(name);
    setView('customer');
  };

  const handleSelectProject = (id, name) => {
    setProjectId(id);
    setProjectName(name || '');
    // Ensure customer context is set even if this was called from outside CustomerView.
    if (!customerId) {
      const p = getProjects().find((x) => x.id === id);
      if (p?.customerId) {
        setCustomerId(p.customerId);
        setCustomerName(getCustomer(p.customerId)?.name || '');
      }
    }
    setView('project');
  };

  const handleBack = () => {
    if (view === 'project') {
      setView('customer');
      setProjectId(null);
      setProjectName('');
      return;
    }
    if (view === 'customer' || view === 'settings') {
      setView('projects');
      setCustomerId(null);
      setCustomerName('');
      setProjectId(null);
      setProjectName('');
    }
  };

  if (!authed) {
    return <Login onLogin={handleLogin} />;
  }

  if (!hydrated) {
    return (
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', minHeight: '100vh', color: 'var(--text-secondary)' }}>
        <span className="spinner" style={{ marginRight: 10 }} /> Loading…
      </div>
    );
  }

  const apiKey = getApiKey();

  return (
    <>
      {!apiKey && (
        <div className="banner">
          <span>Anthropic API key not set. AI features will not work.</span>
          <button onClick={() => setView('settings')}>Go to Settings</button>
        </div>
      )}
      <Nav
        customerName={(view === 'customer' || view === 'project') ? customerName : null}
        projectName={view === 'project' ? projectName : null}
        onBack={view !== 'projects' ? handleBack : null}
        onSettings={() => setView('settings')}
        onLogout={handleLogout}
      />
      {view === 'projects' && (
        <Projects onSelectCustomer={handleSelectCustomer} />
      )}
      {view === 'customer' && customerId && (() => {
        const customer = getCustomer(customerId) || { id: customerId, name: customerName };
        return (
          <CustomerView
            customer={customer}
            onSelectProject={handleSelectProject}
          />
        );
      })()}
      {view === 'project' && projectId && (
        <ProjectView projectId={projectId} />
      )}
      {view === 'settings' && <Settings />}
    </>
  );
}
