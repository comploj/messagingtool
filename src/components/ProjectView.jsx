import { useState, useEffect } from 'react';
import { getProject, saveProject } from '../utils/storage';
import Overview from './Overview';
import Sequences from './Sequences';

const TABS = ['Overview', 'Sequences'];

export default function ProjectView({ projectId }) {
  const [activeTab, setActiveTab] = useState('Overview');
  const [project, setProject] = useState(null);

  useEffect(() => {
    setProject(getProject(projectId));
  }, [projectId]);

  const updateProject = (updates) => {
    const updated = { ...project, ...updates };
    saveProject(updated);
    setProject(updated);
  };

  if (!project) return null;

  return (
    <div className="project-view">
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

      {activeTab === 'Overview' && (
        <Overview project={project} updateProject={updateProject} />
      )}
      {activeTab === 'Sequences' && (
        <Sequences project={project} updateProject={updateProject} />
      )}
    </div>
  );
}
