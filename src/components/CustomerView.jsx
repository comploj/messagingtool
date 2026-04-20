import { useState } from 'react';
import { getProjects, saveProject, deleteProject } from '../utils/storage';
import { createDefaultSequences } from '../utils/defaults';
import { useToast } from './Toast';

export default function CustomerView({ customer, onSelectProject }) {
  const [projects, setProjects] = useState(() =>
    getProjects().filter((p) => p.customerId === customer.id)
  );
  const [showModal, setShowModal] = useState(false);
  const [name, setName] = useState('');
  const [clientName, setClientName] = useState(customer.name || '');
  const [clientWebsite, setClientWebsite] = useState('');
  const toast = useToast();

  const refresh = () =>
    setProjects(getProjects().filter((p) => p.customerId === customer.id));

  const handleCreate = (e) => {
    e.preventDefault();
    if (!name.trim()) return;
    const project = {
      id: crypto.randomUUID(),
      customerId: customer.id,
      name: name.trim(),
      clientName: clientName.trim(),
      clientWebsite: clientWebsite.trim(),
      valueProposition: { summary: '', elevatorPitch: '', painPoints: '', usps: '', urgency: '', services: '', benefits: '' },
      senderFirstName: '',
      senderLastName: '',
      sequences: createDefaultSequences(),
      createdAt: new Date().toISOString(),
    };
    saveProject(project);
    refresh();
    setShowModal(false);
    setName('');
    setClientName(customer.name || '');
    setClientWebsite('');
    toast.success('Project created');
  };

  const handleDelete = (e, id) => {
    e.stopPropagation();
    if (!confirm('Delete this project?')) return;
    deleteProject(id);
    refresh();
    toast.success('Project deleted');
  };

  return (
    <div className="page">
      <div className="page-header">
        <h2>{customer.name}</h2>
        <button className="btn btn-primary" onClick={() => setShowModal(true)}>
          + New Project
        </button>
      </div>

      {projects.length === 0 ? (
        <div className="empty-state">
          <h3>No projects yet</h3>
          <p>Create your first project for {customer.name}.</p>
          <button className="btn btn-primary" onClick={() => setShowModal(true)}>
            Create Project
          </button>
        </div>
      ) : (
        <div className="project-grid">
          {projects.map((p) => (
            <div key={p.id} className="project-card" onClick={() => onSelectProject(p.id, p.name)}>
              <h3>{p.name}</h3>
              <div className="text-secondary text-sm">{p.clientName || 'No client'}</div>
              <div className="project-card-meta">
                <span>{p.sequences?.length || 0} sequences</span>
                <span>{new Date(p.createdAt).toLocaleDateString()}</span>
              </div>
              <div className="project-card-actions">
                <button
                  className="btn btn-danger btn-sm"
                  onClick={(e) => handleDelete(e, p.id)}
                >
                  Delete
                </button>
              </div>
            </div>
          ))}
        </div>
      )}

      {showModal && (
        <div className="modal-overlay" onClick={() => setShowModal(false)}>
          <div className="modal" onClick={(e) => e.stopPropagation()}>
            <div className="modal-header">
              <h2>New Project for {customer.name}</h2>
              <button className="btn btn-ghost btn-sm" onClick={() => setShowModal(false)}>
                &times;
              </button>
            </div>
            <form onSubmit={handleCreate}>
              <div className="form-group mb-16">
                <label className="form-label">Project Name</label>
                <input
                  className="input"
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  placeholder="e.g. Q1 Outreach Campaign"
                  autoFocus
                />
              </div>
              <div className="form-group mb-16">
                <label className="form-label">Client Name</label>
                <input
                  className="input"
                  value={clientName}
                  onChange={(e) => setClientName(e.target.value)}
                  placeholder="e.g. Acme Corp"
                />
              </div>
              <div className="form-group mb-16">
                <label className="form-label">Client Website</label>
                <input
                  className="input"
                  value={clientWebsite}
                  onChange={(e) => setClientWebsite(e.target.value)}
                  placeholder="https://example.com"
                />
              </div>
              <div className="modal-footer">
                <button type="button" className="btn btn-secondary" onClick={() => setShowModal(false)}>
                  Cancel
                </button>
                <button type="submit" className="btn btn-primary">
                  Create Project
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
