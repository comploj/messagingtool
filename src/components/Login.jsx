import { useState } from 'react';
import { setAuth } from '../utils/storage';
import { validateToken } from '../utils/apiClient';
import { useToast } from './Toast';

export default function Login({ onLogin }) {
  const [token, setToken] = useState('');
  const [checking, setChecking] = useState(false);
  const toast = useToast();

  const handleSubmit = async (e) => {
    e.preventDefault();
    const t = token.trim();
    if (!t) return;
    setChecking(true);
    try {
      if (await validateToken(t)) {
        setAuth(t);
        onLogin();
        toast.success('Logged in successfully');
      } else {
        toast.error('Invalid access token');
      }
    } finally {
      setChecking(false);
    }
  };

  return (
    <div className="login-page">
      <div className="login-card">
        <img src="/leadhunt-logo.png" alt="LeadHunt" className="login-logo" />
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
          <button className="btn btn-primary" type="submit" style={{ width: '100%' }} disabled={checking}>
            {checking ? <><span className="spinner spinner-sm"></span> Signing in...</> : 'Sign In'}
          </button>
        </form>
      </div>
    </div>
  );
}
