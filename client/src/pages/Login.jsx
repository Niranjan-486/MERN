import React, { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { AnimatePresence, m } from 'motion/react';
import { ArrowLeft } from 'lucide-react';
import { useAuth } from '../auth/AuthContext';
import { api } from '../lib/api';
import { getFriendlyErrorMessage } from '../lib/errors';
import { Button } from '../components/ui/Button';
import { ThemeToggle } from '../components/ui/ThemeToggle';

function getValidReturnTo() {
  try {
    const returnTo = sessionStorage.getItem('returnTo');
    if (!returnTo || typeof returnTo !== 'string') return null;
    // Accept only relative same-origin paths starting with a single '/'
    if (returnTo.startsWith('/') && !returnTo.startsWith('//') && !returnTo.includes('\\')) {
      return returnTo;
    }
  } catch (_) {}
  return null;
}

export function Login() {
  const { isAuthenticated, user, login } = useAuth();
  const navigate = useNavigate();

  const [step, setStep] = useState(1); // 1 = phone, 2 = code & name
  const [phone, setPhone] = useState('');
  const [otp, setOtp] = useState('');
  const [name, setName] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);

  const demoHint = import.meta.env?.VITE_DEMO_HINT;

  useEffect(() => {
    document.title = 'Sign in — SmartQueue';
  }, []);

  // Redirect if already logged in
  useEffect(() => {
    if (isAuthenticated && user) {
      const returnTo = getValidReturnTo();
      if (returnTo) {
        sessionStorage.removeItem('returnTo');
        navigate(returnTo, { replace: true });
      } else if (user.role === 'staff' || user.role === 'admin') {
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
      setError('Enter a valid phone number with at least 10 digits.');
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
      setError('Enter your verification code.');
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

      const returnTo = getValidReturnTo();
      if (returnTo) {
        sessionStorage.removeItem('returnTo');
        navigate(returnTo, { replace: true });
      } else if (res.user?.role === 'staff' || res.user?.role === 'admin') {
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

  const slideVariants = {
    initial: (direction) => ({
      opacity: 0,
      x: direction > 0 ? 20 : -20,
    }),
    animate: {
      opacity: 1,
      x: 0,
      transition: { duration: 0.2, ease: [0.25, 1, 0.5, 1] },
    },
    exit: (direction) => ({
      opacity: 0,
      x: direction > 0 ? -20 : 20,
      transition: { duration: 0.15, ease: [0.25, 1, 0.5, 1] },
    }),
  };

  return (
    <div className="min-h-screen bg-paper flex flex-col justify-between p-4 sm:p-6 lg:p-8">
      {/* Header bar with wordmark & theme toggle */}
      <header className="flex items-center justify-between w-full max-w-sm mx-auto mb-4">
        <div className="flex items-center gap-2 select-none">
          <span className="w-2.5 h-2.5 rounded-full bg-signal" aria-hidden="true" />
          <span className="font-semibold text-ink text-base tracking-tight">SmartQueue</span>
        </div>
        <ThemeToggle />
      </header>

      {/* Main container */}
      <main className="w-full max-w-sm mx-auto my-auto py-6">
        <div className="text-left mb-6">
          <h1 className="text-2xl font-bold text-ink tracking-tight">Sign in</h1>
          <p className="text-sm text-slate mt-1">
            Real-time queue tracking for hospital consultations.
          </p>
        </div>

        {error && (
          <div
            className="mb-5 p-3 rounded-[var(--radius-control)] bg-coral-tint text-coral text-sm border border-coral/20"
            role="alert"
            aria-live="polite"
          >
            {error}
          </div>
        )}

        <div className="relative overflow-hidden">
          <AnimatePresence mode="wait" initial={false} custom={step}>
            {step === 1 ? (
              <m.form
                key="step-1"
                custom={1}
                variants={slideVariants}
                initial="initial"
                animate="animate"
                exit="exit"
                onSubmit={handleRequestOtp}
                className="space-y-4"
              >
                <div>
                  <label
                    htmlFor="phone-input"
                    className="block text-xs font-semibold text-ink mb-1.5 uppercase tracking-wider"
                  >
                    Phone number
                  </label>
                  <input
                    id="phone-input"
                    type="tel"
                    inputMode="tel"
                    autoComplete="tel"
                    placeholder="e.g. 9999900001"
                    value={phone}
                    onChange={(e) => setPhone(e.target.value)}
                    required
                    disabled={loading}
                    className="w-full min-h-[48px] px-3.5 py-2.5 text-base text-ink bg-paper border border-line rounded-[var(--radius-control)] placeholder:text-slate focus:outline-none focus:ring-2 focus:ring-signal focus:border-transparent transition-shadow duration-150"
                  />
                </div>

                <Button
                  type="submit"
                  variant="primary"
                  loading={loading}
                  disabled={loading}
                  className="w-full justify-center"
                  aria-label="Request OTP"
                >
                  Request code
                </Button>
              </m.form>
            ) : (
              <m.form
                key="step-2"
                custom={2}
                variants={slideVariants}
                initial="initial"
                animate="animate"
                exit="exit"
                onSubmit={handleVerifyOtp}
                className="space-y-4"
              >
                <div className="text-xs text-slate pb-1">
                  Sent to <span className="font-semibold text-ink">{phone}</span>
                </div>

                <div>
                  <label
                    htmlFor="otp-input"
                    className="block text-xs font-semibold text-ink mb-1.5 uppercase tracking-wider"
                  >
                    Verification code
                  </label>
                  <input
                    id="otp-input"
                    type="text"
                    inputMode="text"
                    autoComplete="one-time-code"
                    placeholder="Enter code"
                    value={otp}
                    onChange={(e) => setOtp(e.target.value)}
                    required
                    disabled={loading}
                    autoFocus
                    className="w-full min-h-[48px] px-3.5 py-2.5 text-base text-ink bg-paper border border-line rounded-[var(--radius-control)] placeholder:text-slate focus:outline-none focus:ring-2 focus:ring-signal focus:border-transparent transition-shadow duration-150"
                  />
                </div>

                <div>
                  <label
                    htmlFor="name-input"
                    className="block text-xs font-semibold text-ink mb-1.5 uppercase tracking-wider"
                  >
                    Your name <span className="font-normal text-slate lowercase">(optional)</span>
                  </label>
                  <input
                    id="name-input"
                    type="text"
                    autoComplete="name"
                    placeholder="Full name"
                    value={name}
                    onChange={(e) => setName(e.target.value)}
                    disabled={loading}
                    className="w-full min-h-[48px] px-3.5 py-2.5 text-base text-ink bg-paper border border-line rounded-[var(--radius-control)] placeholder:text-slate focus:outline-none focus:ring-2 focus:ring-signal focus:border-transparent transition-shadow duration-150"
                  />
                </div>

                <div className="space-y-2 pt-1">
                  <Button
                    type="submit"
                    variant="primary"
                    loading={loading}
                    disabled={loading}
                    className="w-full justify-center"
                    aria-label="Verify OTP and Sign In"
                  >
                    Sign in
                  </Button>

                  <Button
                    type="button"
                    variant="quiet"
                    onClick={() => {
                      setStep(1);
                      setError(null);
                    }}
                    disabled={loading}
                    className="w-full justify-center text-xs"
                  >
                    <ArrowLeft className="w-3.5 h-3.5 mr-1" aria-hidden="true" />
                    Change phone number
                  </Button>
                </div>
              </m.form>
            )}
          </AnimatePresence>
        </div>

        {demoHint && (
          <aside
            className="mt-8 p-3.5 rounded-[var(--radius-card)] bg-line-subtle/50 border border-line text-xs text-slate space-y-2"
            aria-label="Demo login hint"
          >
            <div className="font-semibold text-ink text-[11px] uppercase tracking-wider">
              Demo Credentials
            </div>
            <div>
              <span className="font-medium text-ink">Patient:</span> Phone{' '}
              <code className="px-1.5 py-0.5 rounded bg-paper border border-line text-ink font-mono">
                9999900001
              </code>
              , Code{' '}
              <code className="px-1.5 py-0.5 rounded bg-paper border border-line text-ink font-mono">
                {demoHint}
              </code>
            </div>
            <div>
              <span className="font-medium text-ink">Staff:</span> Phone{' '}
              <code className="px-1.5 py-0.5 rounded bg-paper border border-line text-ink font-mono">
                9999900000
              </code>
              , Code{' '}
              <code className="px-1.5 py-0.5 rounded bg-paper border border-line text-ink font-mono">
                staffsecret123
              </code>
            </div>
          </aside>
        )}
      </main>

      {/* Footer */}
      <footer className="text-center text-xs text-slate py-2">
        <span>SmartQueue OPD System</span>
      </footer>
    </div>
  );
}

export default Login;
