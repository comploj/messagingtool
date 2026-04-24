import { useState, useEffect, useRef } from 'react';
import { fetchShareState, pushShareState } from '../utils/apiClient';
import { setPromptOverrides } from '../utils/storage';
import Overview from './Overview';
import Sequences from './Sequences';
import ThemeToggle from './ThemeToggle';
import { useToast } from './Toast';

const TABS = ['Overview', 'Sequences'];

// Full editable view of ONE project, accessed via /share/:token without login.
// Viewers can edit everything (VP, lead, sequences, messages) except DELETE
// existing sequences — the server enforces this.
export default function ShareProjectView({ token }) {
  const [activeTab, setActiveTab] = useState('Sequences');
  const [state, setState] = useState({ loading: true, error: null, project: null, customer: null, version: 0 });
  const toast = useToast();
  const saveTimer = useRef(null);
  const pendingRef = useRef(null);
  const savingRef = useRef(false);

  // Initial load + poll every 30s for updates from the owner.
  useEffect(() => {
    let cancelled = false;
    const load = async (silent = false) => {
      try {
        const snap = await fetchShareState(token);
        if (cancelled) return;
        if (!snap) {
          setState((s) => ({ ...s, loading: false, error: 'not_found' }));
          return;
        }
        // Write prompt overrides to localStorage so prompt-composition
        // (prelude/postlude wrapping at generate time) works for the viewer too.
        if (snap.promptOverrides) {
          try { setPromptOverrides(snap.promptOverrides); } catch {}
        }
        setState((prev) => {
          // Don't overwrite in-flight local edits.
          if (!silent || !prev.project) {
            return { loading: false, error: null, project: snap.project, customer: snap.customer, version: snap.version };
          }
          // For polled refresh: only update version; keep user's project state.
          return { ...prev, version: snap.version };
        });
      } catch (err) {
        if (cancelled) return;
        if (!silent) setState((s) => ({ ...s, loading: false, error: err.message || 'error' }));
      }
    };
    load(false);
    const id = setInterval(() => load(true), 30_000);
    return () => { cancelled = true; clearInterval(id); };
  }, [token]);

  // Debounced save: merges rapid updates, handles conflicts.
  const flushSave = async () => {
    if (savingRef.current) return;
    if (!pendingRef.current) return;
    const { project, baseVersion } = pendingRef.current;
    pendingRef.current = null;
    savingRef.current = true;
    try {
      const res = await pushShareState(token, project, baseVersion);
      if (res?.forbidden) {
        toast.error('Share does not allow that change');
        // Reload to reset local state
        const snap = await fetchShareState(token);
        if (snap) setState({ loading: false, error: null, project: snap.project, customer: snap.customer, version: snap.version });
        return;
      }
      if (res?.conflict) {
        if (res.current?.project) {
          setState({ loading: false, error: null, project: res.current.project, customer: res.current.customer, version: res.current.version });
          toast.info?.('Owner updated the project — latest version loaded');
        }
        return;
      }
      if (res?.version != null) {
        setState((s) => ({ ...s, version: res.version }));
      }
    } catch (err) {
      console.error('[share] save failed', err);
      toast.error('Save failed — check your connection');
    } finally {
      savingRef.current = false;
      if (pendingRef.current) {
        setTimeout(flushSave, 50);
      }
    }
  };

  const updateProject = (updates) => {
    setState((s) => {
      if (!s.project) return s;
      const next = { ...s.project, ...updates };
      pendingRef.current = { project: next, baseVersion: s.version };
      clearTimeout(saveTimer.current);
      saveTimer.current = setTimeout(flushSave, 300);
      return { ...s, project: next };
    });
  };

  const renderShell = (content) => (
    <div className="share-page">
      <header className="nav share-nav">
        <div className="nav-left">
          <a
            href="https://leadhunt.ai"
            target="_blank"
            rel="noopener noreferrer"
            className="nav-brand share-nav-brand"
            aria-label="Leadhunt — opens in a new tab"
          >
            <img src="/leadhunt-logo.png" alt="Leadhunt" />
          </a>
          <span className="nav-sep">/</span>
          <span className="share-nav-label">Messaging preview</span>
        </div>
        <div className="nav-right">
          <ThemeToggle />
          <span className="badge badge-delay">Collaboration link</span>
        </div>
      </header>

      <div className="share-body">{content}</div>

      <footer className="share-footer">
        <div className="share-footer-inner">
          <div className="share-footer-copy">
            Operated by{' '}
            <a href="https://leadhunt.ai" target="_blank" rel="noopener noreferrer">
              leadhunt.ai
            </a>
          </div>
          <div className="share-footer-links">
            <a href="https://leadhunt.ai" target="_blank" rel="noopener noreferrer">leadhunt.ai</a>
            <span aria-hidden="true">•</span>
            <a href="https://www.leadhuntai.de/privacy-policy" target="_blank" rel="noopener noreferrer">Privacy policy</a>
            <span aria-hidden="true">•</span>
            <a href="https://www.leadhuntai.de/imprint" target="_blank" rel="noopener noreferrer">Imprint</a>
          </div>
        </div>
      </footer>
    </div>
  );

  if (state.loading) {
    return renderShell(
      <div className="share-status">
        <span className="spinner" style={{ marginRight: 10 }} /> Loading…
      </div>
    );
  }

  if (state.error === 'not_found') {
    return renderShell(
      <div className="share-status share-status-message">
        <h2>Link expired or revoked</h2>
        <p>This share link is no longer active. Please ask the sender for a new link.</p>
      </div>
    );
  }

  if (state.error) {
    return renderShell(
      <div className="share-status share-status-message">
        <h2>Something went wrong</h2>
        <p>{state.error}</p>
      </div>
    );
  }

  const { project, customer } = state;
  if (!project) return null;

  return renderShell(
    <>
      <div className="share-subheader">
        <strong>{project.name || 'Shared project'}</strong>
        {customer?.name && (
          <span className="share-subheader-customer">for {customer.name}</span>
        )}
      </div>

      <div className="tabs">
        {TABS.map((tab) => (
          <button
            key={tab}
            className={`tab ${activeTab === tab ? 'active' : ''}`}
            onClick={() => setActiveTab(tab)}
          >
            {tab}
          </button>
        ))}
      </div>

      <div className="project-view">
        {activeTab === 'Overview' && (
          <Overview
            project={project}
            updateProject={updateProject}
            recentlyDeletedSeqs={project.deletedSequences || []}
            restoreDeletedSeq={(seqId) => {
              const list = project.deletedSequences || [];
              const seq = list.find((s) => s.id === seqId);
              if (!seq) return;
              updateProject({
                sequences: [...(project.sequences || []), seq],
                deletedSequences: list.filter((s) => s.id !== seqId),
              });
            }}
            purgeDeletedSeq={(seqId) => {
              const list = project.deletedSequences || [];
              updateProject({ deletedSequences: list.filter((s) => s.id !== seqId) });
            }}
            shareMode
          />
        )}
        {activeTab === 'Sequences' && (
          <Sequences
            project={project}
            updateProject={updateProject}
            shareMode
          />
        )}
      </div>
    </>
  );
}
