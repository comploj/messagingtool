import { useState } from 'react';
import { getCustomers, getProjects, saveCustomer, deleteCustomer } from '../utils/storage';
import { useToast } from './Toast';

export default function Projects({ onSelectCustomer }) {
  const [customers, setCustomers] = useState(() => getCustomers());
  const [showModal, setShowModal] = useState(false);
  const [name, setName] = useState('');
  const toast = useToast();

  const refresh = () => setCustomers(getCustomers());
  const projects = getProjects();

  const projectCount = (customerId) =>
    projects.filter((p) => p.customerId === customerId).length;

  const handleCreate = (e) => {
    e.preventDefault();
    const trimmed = name.trim();
    if (!trimmed) return;
    saveCustomer({
      id: crypto.randomUUID(),
      name: trimmed,
      createdAt: new Date().toISOString(),
    });
    refresh();
    setShowModal(false);
    setName('');
    toast.success('Customer created');
  };

  const handleDelete = (e, customer) => {
    e.stopPropagation();
    const n = projectCount(customer.id);
    const msg = n > 0
      ? `Delete "${customer.name}" and its ${n} project${n === 1 ? '' : 's'}?`
      : `Delete "${customer.name}"?`;
    if (!confirm(msg)) return;
    deleteCustomer(customer.id);
    refresh();
    toast.success('Customer deleted');
  };

  return (
    <div className="page">
      <div className="page-header">
        <h2>Customers</h2>
        <button className="btn btn-primary" onClick={() => setShowModal(true)}>
          + New Customer
        </button>
      </div>

      {customers.length === 0 ? (
        <div className="empty-state">
          <h3>No customers yet</h3>
          <p>Create your first customer to start adding projects.</p>
          <button className="btn btn-primary" onClick={() => setShowModal(true)}>
            Create Customer
          </button>
        </div>
      ) : (
        <div className="project-grid">
          {customers.map((c) => {
            const n = projectCount(c.id);
            return (
              <div key={c.id} className="project-card" onClick={() => onSelectCustomer(c.id, c.name)}>
                <h3>{c.name}</h3>
                <div className="project-card-meta">
                  <span>{n} project{n === 1 ? '' : 's'}</span>
                  {c.createdAt && <span>{new Date(c.createdAt).toLocaleDateString()}</span>}
                </div>
                <div className="project-card-actions">
                  <button
                    className="btn btn-danger btn-sm"
                    onClick={(e) => handleDelete(e, c)}
                  >
                    Delete
                  </button>
                </div>
              </div>
            );
          })}
        </div>
      )}

      {showModal && (
        <div className="modal-overlay" onClick={() => setShowModal(false)}>
          <div className="modal" onClick={(e) => e.stopPropagation()}>
            <div className="modal-header">
              <h2>New Customer</h2>
              <button className="btn btn-ghost btn-sm" onClick={() => setShowModal(false)}>
                &times;
              </button>
            </div>
            <form onSubmit={handleCreate}>
              <div className="form-group mb-16">
                <label className="form-label">Customer Name</label>
                <input
                  className="input"
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  placeholder="e.g. Acme Corp"
                  autoFocus
                />
              </div>
              <div className="modal-footer">
                <button type="button" className="btn btn-secondary" onClick={() => setShowModal(false)}>
                  Cancel
                </button>
                <button type="submit" className="btn btn-primary">
                  Create Customer
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
