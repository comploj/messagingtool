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

  // Deleted sequences are persisted on the project (project.deletedSequences)
  // so they survive page reloads and sync across devices until the user
  // explicitly restores or permanently removes them.
  const recentlyDeletedSeqs = project?.deletedSequences || [];

  const restoreDeletedSeq = (seqId) => {
    const seq = recentlyDeletedSeqs.find((s) => s.id === seqId);
    if (!seq) return;
    updateProject({
      sequences: [...(project.sequences || []), seq],
      deletedSequences: recentlyDeletedSeqs.filter((s) => s.id !== seqId),
    });
  };

  const purgeDeletedSeq = (seqId) => {
    updateProject({
      deletedSequences: recentlyDeletedSeqs.filter((s) => s.id !== seqId),
    });
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
          purgeDeletedSeq={purgeDeletedSeq}
        />
      )}
      {activeTab === 'Sequences' && (
        <Sequences
          project={project}
          updateProject={updateProject}
        />
      )}
    </div>
  );
}
