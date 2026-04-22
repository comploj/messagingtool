import { useState } from 'react';

const AVAILABLE_VARS = [
  '{Anrede}', '{FirstName}', '{LastName}', '{Position}', '{Company}',
  '{CompanyDescription}', '{CompanyIndustry}', '{CompanySize}',
  '{CompanyLocation}', '{PersonLocation}',
  '{MyNameFirst}', '{MyNameLast}', '{op.value_proposition}',
];

export default function SequenceEditor({ sequence, onSave, onDelete, onClose, shareMode = false }) {
  const [seq, setSeq] = useState(JSON.parse(JSON.stringify(sequence)));

  const updateField = (field, value) => {
    setSeq({ ...seq, [field]: value });
  };

  const updateMessage = (idx, field, value) => {
    const msgs = [...seq.messages];
    msgs[idx] = { ...msgs[idx], [field]: value };
    setSeq({ ...seq, messages: msgs });
  };

  const addMessage = () => {
    const num = seq.messages.length + 1;
    setSeq({
      ...seq,
      messages: [
        ...seq.messages,
        {
          id: crypto.randomUUID(),
          label: `Message ${num}`,
          type: 'ai',
          delayDays: num === 1 ? 1 : (seq.messages[seq.messages.length - 1]?.delayDays || 1) + 3,
          prompt: '',
        },
      ],
    });
  };

  const removeMessage = (idx) => {
    setSeq({ ...seq, messages: seq.messages.filter((_, i) => i !== idx) });
  };

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal modal-lg" onClick={(e) => e.stopPropagation()}>
        <div className="modal-header">
          <h2>Edit Sequence</h2>
          <button className="btn btn-ghost btn-sm" onClick={onClose}>&times;</button>
        </div>

        <div className="form-group mb-16">
          <label className="form-label">Name</label>
          <input
            className="input"
            value={seq.name}
            onChange={(e) => updateField('name', e.target.value)}
          />
        </div>

        <div className="form-group mb-16">
          <label className="form-label">Description</label>
          <textarea
            className="textarea"
            value={seq.description}
            onChange={(e) => updateField('description', e.target.value)}
            rows={2}
          />
        </div>

        <div className="flex-between mb-8">
          <h3>Messages ({seq.messages.length})</h3>
          <button className="btn btn-secondary btn-sm" onClick={addMessage}>
            + Add Message
          </button>
        </div>

        <div className="message-list">
          {seq.messages.map((msg, idx) => (
            <div key={msg.id} className="message-item">
              <div className="message-item-header">
                <input
                  className="input"
                  value={msg.label}
                  onChange={(e) => updateMessage(idx, 'label', e.target.value)}
                  style={{ width: 130 }}
                />
                <select
                  value={msg.type}
                  onChange={(e) => updateMessage(idx, 'type', e.target.value)}
                  style={{ width: 110 }}
                >
                  <option value="ai">AI</option>
                  <option value="static">Static</option>
                </select>
                <label className="form-label" style={{ marginBottom: 0 }}>Day</label>
                <input
                  className="input delay-input"
                  type="number"
                  min={1}
                  value={msg.delayDays}
                  onChange={(e) => updateMessage(idx, 'delayDays', parseInt(e.target.value) || 1)}
                  style={{ width: 70 }}
                />
                <button
                  className="btn btn-ghost btn-sm message-item-remove"
                  onClick={() => removeMessage(idx)}
                >
                  Remove
                </button>
              </div>
              <textarea
                className="textarea textarea-mono"
                value={msg.prompt}
                onChange={(e) => updateMessage(idx, 'prompt', e.target.value)}
                rows={6}
                placeholder="Enter message template with {Variables}..."
              />
              <div className="var-reference">
                <strong>Variables: </strong>
                {AVAILABLE_VARS.map((v) => (
                  <span
                    key={v}
                    className={`var-chip ${v.startsWith('{op.') ? 'var-chip-op' : 'var-chip-regular'}`}
                  >
                    {v}
                  </span>
                ))}
              </div>
            </div>
          ))}
        </div>

        <div className="modal-footer">
          {!shareMode && (
            <button className="btn btn-danger btn-sm" onClick={onDelete}>
              Delete Sequence
            </button>
          )}
          <div style={{ flex: 1 }} />
          <button className="btn btn-secondary" onClick={onClose}>Cancel</button>
          <button className="btn btn-primary" onClick={() => onSave(seq)}>Save</button>
        </div>
      </div>
    </div>
  );
}
