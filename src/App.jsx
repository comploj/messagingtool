import { useState, useEffect } from 'react';
import { getAuth, clearAuth, getApiKey } from './utils/storage';
import Login from './components/Login';
import Nav from './components/Nav';
import Projects from './components/Projects';
import ProjectView from './components/ProjectView';
import Settings from './components/Settings';

export default function App() {
  const [authed, setAuthed] = useState(!!getAuth());
  const [view, setView] = useState('projects'); // 'projects' | 'project' | 'settings'
  const [projectId, setProjectId] = useState(null);
  const [projectName, setProjectName] = useState('');

  const handleLogin = () => setAuthed(true);

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
