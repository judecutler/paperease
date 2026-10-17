'use client';
import { useState } from 'react';
import { Button } from '@/components/ui';
import { BrandMark, BrandName } from '@/components/Logo';

export default function LoginPage() {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const res = await fetch('/api/auth/login', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ email, password }) });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error || 'Could not sign in.');
      // only same-site paths, so the link cannot send people elsewhere
      const next = new URLSearchParams(window.location.search).get('next');
      window.location.assign(next?.startsWith('/') && !next.startsWith('//') ? next : '/');
    } catch (err) {
      setError((err as Error).message);
      setBusy(false);
    }
  };

  return (
    <main className="login">
      <div className="brand login-brand">
        <BrandMark size={40} />
        <BrandName />
      </div>
      <form className="card login-card" onSubmit={submit}>
        <h2>Sign in</h2>
        <p className="small muted">For agency staff. Caregivers use the link in their text message.</p>
        <label>Email<input className="input" type="email" autoComplete="username" required value={email} onChange={(e) => setEmail(e.target.value)} /></label>
        <label>Password<input className="input" type="password" autoComplete="current-password" required value={password} onChange={(e) => setPassword(e.target.value)} /></label>
        {error && <p className="login-error" role="alert">{error}</p>}
        <Button type="submit" variant="primary" disabled={busy}>{busy ? 'Signing in…' : 'Sign in'}</Button>
      </form>
    </main>
  );
}
