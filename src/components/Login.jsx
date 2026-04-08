import { useState } from 'react';
import { ACCESS_TOKENS } from '../config';
import { setAuth, getCustomTokens } from '../utils/storage';
import { useToast } from './Toast';

export default function Login({ onLogin }) {
  const [token, setToken] = useState('');
  const toast = useToast();

  const handleSubmit = (e) => {
    e.preventDefault();
    const allTokens = [...ACCESS_TOKENS, ...getCustomTokens()];
    if (allTokens.includes(token.trim())) {
      setAuth(token.trim());
      onLogin();
      toast.success('Logged in successfully');
    } else {
      toast.error('Invalid access token');
    }
  };

  return (
    <div className="login-page">
      <div className="login-card">
        <h1>LeadHunt</h1>
        <p>Enter your access token to continue</p>
        <form onSubmit={handleSubmit}>
          <div className="form-group">
            <label className="form-label">Access Token</label>
            <input
              className="input"
              type="password"
              value={token}
              onChange={(e) => setToken(e.target.value)}
              placeholder="Enter your token..."
              autoFocus
            />
          </div>
          <button className="btn btn-primary" type="submit" style={{ width: '100%' }}>
            Sign In
          </button>
        </form>
      </div>
    </div>
  );
}
