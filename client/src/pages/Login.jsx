import React, { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../auth/AuthContext';
import { api } from '../lib/api';
import { getFriendlyErrorMessage } from '../lib/errors';

export function Login() {
  const { isAuthenticated, user, login } = useAuth();
  const navigate = useNavigate();

  const [step, setStep] = useState(1); // 1 = phone, 2 = otp & name
  const [phone, setPhone] = useState('');
  const [otp, setOtp] = useState('');
  const [name, setName] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);

  const demoHint = import.meta.env?.VITE_DEMO_HINT;

  // Redirect if already logged in
  useEffect(() => {
    if (isAuthenticated && user) {
      if (user.role === 'staff' || user.role === 'admin') {
        navigate('/staff', { replace: true });
      } else {
        navigate('/patient', { replace: true });
      }
    }
  }, [isAuthenticated, user, navigate]);

  const handleRequestOtp = async (e) => {
    e.preventDefault();
    setError(null);
    const cleanPhone = phone.trim();
    if (!cleanPhone || cleanPhone.length < 10) {
      setError('Please enter a valid phone number (min 10 digits)');
      return;
    }

    setLoading(true);
    try {
      await api.post('/api/auth/request-otp', { phone: cleanPhone });
      setStep(2);
    } catch (err) {
      setError(getFriendlyErrorMessage(err));
    } finally {
      setLoading(false);
    }
  };

  const handleVerifyOtp = async (e) => {
    e.preventDefault();
    setError(null);
    const cleanOtp = otp.trim();
    if (!cleanOtp) {
      setError('Please enter the verification code');
      return;
    }

    setLoading(true);
    try {
      const payload = {
        phone: phone.trim(),
        otp: cleanOtp,
      };
      if (name.trim()) {
        payload.name = name.trim();
      }

      const res = await api.post('/api/auth/verify-otp', payload);
      login(res.token, res.user);

      if (res.user?.role === 'staff' || res.user?.role === 'admin') {
        navigate('/staff', { replace: true });
      } else {
        navigate('/patient', { replace: true });
      }
    } catch (err) {
      setError(getFriendlyErrorMessage(err));
    } finally {
      setLoading(false);
    }
  };

  return (
    <main className="login-container">
      <div className="login-card">
        <header className="login-header">
          <div className="app-logo">⚡ SmartQueue</div>
          <h1>Welcome</h1>
          <p className="login-subtitle">
            {step === 1
              ? 'Enter your phone number to receive a login code'
              : 'Enter the code sent to your phone'}
          </p>
        </header>

        {demoHint && (
          <aside className="demo-hint-box" aria-label="Demo login hint">
            <div><strong>Patient demo:</strong> Phone <code>9999900001</code>, Code <code>{demoHint}</code></div>
            <div style={{ marginTop: '4px' }}><strong>Staff demo:</strong> Phone <code>9999900000</code>, Code <code>staffsecret123</code></div>
          </aside>
        )}

        {error && (
          <div className="error-banner" role="alert" aria-live="polite">
            {error}
          </div>
        )}

        {step === 1 ? (
          <form onSubmit={handleRequestOtp} className="login-form">
            <div className="form-group">
              <label htmlFor="phone-input">Phone Number</label>
              <input
                id="phone-input"
                type="tel"
                className="form-input"
                placeholder="e.g. 9999900001"
                value={phone}
                onChange={(e) => setPhone(e.target.value)}
                autoComplete="tel"
                required
                disabled={loading}
              />
            </div>

            <button
              type="submit"
              className="btn btn-primary btn-block"
              disabled={loading}
              aria-label="Request OTP"
            >
              {loading ? 'Sending code...' : 'Request Code'}
            </button>
          </form>
        ) : (
          <form onSubmit={handleVerifyOtp} className="login-form">
            <div className="form-group">
              <label htmlFor="otp-input">Code</label>
              <input
                id="otp-input"
                type="text"
                className="form-input"
                placeholder="Enter 6-digit code"
                value={otp}
                onChange={(e) => setOtp(e.target.value)}
                autoComplete="one-time-code"
                required
                disabled={loading}
                autoFocus
              />
            </div>

            <div className="form-group">
              <label htmlFor="name-input">Your Name (Optional for new patients)</label>
              <input
                id="name-input"
                type="text"
                className="form-input"
                placeholder="Full name"
                value={name}
                onChange={(e) => setName(e.target.value)}
                disabled={loading}
              />
            </div>

            <button
              type="submit"
              className="btn btn-primary btn-block"
              disabled={loading}
              aria-label="Verify OTP and Sign In"
            >
              {loading ? 'Verifying...' : 'Sign In'}
            </button>

            <button
              type="button"
              className="btn btn-link btn-block"
              onClick={() => {
                setStep(1);
                setError(null);
              }}
              disabled={loading}
            >
              ← Change phone number
            </button>
          </form>
        )}
      </div>
    </main>
  );
}
