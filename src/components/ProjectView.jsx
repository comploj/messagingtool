import { useState, useEffect } from 'react';
import { getProject, saveProject } from '../utils/storage';
import Overview from './Overview';
import Sequences from './Sequences';

const TABS = ['Overview', 'Sequences'];

export default function ProjectView({ projectId }) {
  const [activeTab, setActiveTab] = useState('Overview');
  const [project, setProject] = useState(null);
  // Session-only trash: deleted sequences held in memory so the user can
  // restore them from the Overview tab. Wiped on reload and on project switch.
  const [recentlyDeletedSeqs, setRecentlyDeletedSeqs] = useState([]);

  useEffect(() => {
    setProject(getProject(projectId));
    setRecentlyDeletedSeqs([]);
  }, [projectId]);

  const updateProject = (updates) => {
    const updated = { ...project, ...updates };
    saveProject(updated);
    setProject(updated);
  };

  const addDeletedSeq = (seq) => {
    if (!seq) return;
    setRecentlyDeletedSeqs((prev) => [seq, ...prev.filter((s) => s.id !== seq.id)]);
  };

  const restoreDeletedSeq = (seqId) => {
    const seq = recentlyDeletedSeqs.find((s) => s.id === seqId);
    if (!seq) return;
    setRecentlyDeletedSeqs((prev) => prev.filter((s) => s.id !== seqId));
    const updated = { ...project, sequences: [...project.sequences, seq] };
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
        <Overview
          project={project}
          updateProject={updateProject}
          recentlyDeletedSeqs={recentlyDeletedSeqs}
          restoreDeletedSeq={restoreDeletedSeq}
        />
      )}
      {activeTab === 'Sequences' && (
        <Sequences
          project={project}
          updateProject={updateProject}
          addDeletedSeq={addDeletedSeq}
        />
      )}
    </div>
  );
}
