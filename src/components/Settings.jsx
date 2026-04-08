import { useState } from 'react';
import { getApiKey, setApiKey, getCustomTokens, addCustomToken } from '../utils/storage';
import { ACCESS_TOKENS } from '../config';
import { useToast } from './Toast';

export default function Settings() {
  const [apiKey, setApiKeyState] = useState(getApiKey());
  const [newToken, setNewToken] = useState('');
  const [customTokens, setCustomTokens] = useState(getCustomTokens());
  const toast = useToast();

  const handleSaveApiKey = () => {
    setApiKey(apiKey);
    toast.success('API key saved');
  };

  const handleAddToken = (e) => {
    e.preventDefault();
    const t = newToken.trim();
    if (!t) return;
    if ([...ACCESS_TOKENS, ...customTokens].includes(t)) {
      toast.error('Token already exists');
      return;
    }
    addCustomToken(t);
    setCustomTokens(getCustomTokens());
    setNewToken('');
    toast.success('Token added');
  };

  return (
    <div className="settings-page">
      <h2 style={{ marginBottom: 20 }}>Settings</h2>

      <div className="settings-section">
        <h3>Anthropic API Key</h3>
        <div className="settings-row">
          <div className="form-group">
            <label className="form-label">API Key</label>
            <input
              className="input"
              type="password"
              value={apiKey}
              onChange={(e) => setApiKeyState(e.target.value)}
              placeholder="sk-ant-..."
            />
          </div>
          <button className="btn btn-primary" onClick={handleSaveApiKey}>
            Save
          </button>
        </div>
      </div>

      <div className="settings-section">
        <h3>Access Tokens</h3>
        <form onSubmit={handleAddToken}>
          <div className="settings-row">
            <div className="form-group">
              <label className="form-label">New Token</label>
              <input
                className="input"
                value={newToken}
                onChange={(e) => setNewToken(e.target.value)}
                placeholder="my-custom-token"
              />
            </div>
            <button className="btn btn-secondary" type="submit">
              Add
            </button>
          </div>
        </form>
        <div className="token-list">
          {ACCESS_TOKENS.map((t) => (
            <span key={t} className="token-tag">{t}</span>
          ))}
          {customTokens.map((t) => (
            <span key={t} className="token-tag">{t}</span>
          ))}
        </div>
      </div>
    </div>
  );
}
