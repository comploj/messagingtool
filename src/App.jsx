import { useState, useEffect } from 'react';
import { getAuth, clearAuth, getApiKey, hydrateFromServer } from './utils/storage';
import Login from './components/Login';
import Nav from './components/Nav';
import Projects from './components/Projects';
import ProjectView from './components/ProjectView';
import Settings from './components/Settings';
import { useToast } from './components/Toast';

export default function App() {
  const [authed, setAuthed] = useState(!!getAuth());
  const [hydrated, setHydrated] = useState(!getAuth());
  const [view, setView] = useState('projects'); // 'projects' | 'project' | 'settings'
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
    setProjectId(null);
  };

  const handleSelectProject = (id) => {
    const projects = JSON.parse(localStorage.getItem('leadhunt_projects') || '[]');
    const p = projects.find((p) => p.id === id);
    setProjectId(id);
    setProjectName(p?.name || '');
    setView('project');
  };

  const handleBack = () => {
    if (view === 'project' || view === 'settings') {
      setView('projects');
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
        projectName={view === 'project' ? projectName : null}
        onBack={view !== 'projects' ? handleBack : null}
        onSettings={() => setView('settings')}
        onLogout={handleLogout}
      />
      {view === 'projects' && (
        <Projects onSelectProject={handleSelectProject} />
      )}
      {view === 'project' && projectId && (
        <ProjectView projectId={projectId} />
      )}
      {view === 'settings' && <Settings />}
    </>
  );
}
