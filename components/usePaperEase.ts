'use client';
import { useCallback, useEffect, useRef, useState } from 'react';
import type { Action } from '@/lib/agent';
import type { Payload } from '@/lib/payload';

// how often an open tab picks up changes made elsewhere (caregiver replies, the daily sweep, other admins)
const REFRESH_MS = 4000;

// the session ended (signed out elsewhere or expired): back to sign-in, then back here
function signedOut(): false {
  window.location.assign(`/login?next=${encodeURIComponent(window.location.pathname + window.location.search)}`);
  return false;
}

export function usePaperEase() {
  const [data, setData] = useState<Payload | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const last = useRef('');
  // bumped by every action, so a refresh that started before it cannot overwrite its result
  const generation = useRef(0);
  const inFlight = useRef(0);

  const apply = useCallback((text: string) => {
    if (text === last.current) return;
    last.current = text;
    setData(JSON.parse(text));
  }, []);

  const refresh = useCallback(async () => {
    const gen = generation.current;
    const res = await fetch('/api/state', { cache: 'no-store' });
    if (res.status === 401) return signedOut();
    if (!res.ok) throw new Error(`Could not load records (${res.status})`);
    const text = await res.text();
    if (gen === generation.current && inFlight.current === 0) apply(text);
  }, [apply]);

  useEffect(() => {
    refresh().catch((e) => setError(String(e)));
    const tick = () => {
      if (document.visibilityState === 'visible') refresh().catch(() => {});
    };
    const timer = setInterval(tick, REFRESH_MS);
    document.addEventListener('visibilitychange', tick);
    window.addEventListener('focus', tick);
    return () => {
      clearInterval(timer);
      document.removeEventListener('visibilitychange', tick);
      window.removeEventListener('focus', tick);
    };
  }, [refresh]);

  const act = useCallback(async (action: Action) => {
    generation.current++;
    inFlight.current++;
    setBusy(true);
    setError(null);
    try {
      const res = await fetch('/api/actions', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(action) });
      if (res.status === 401) return signedOut();
      const text = await res.text();
      const json = JSON.parse(text);
      if (!res.ok) throw new Error(json.error || 'Something went wrong');
      apply(text);
      return true;
    } catch (e) {
      setError((e as Error).message);
      return false;
    } finally {
      inFlight.current--;
      generation.current++;
      setBusy(false);
    }
  }, [apply]);

  return { data, busy, error, setError, act };
}

export function timeLabel(isoTime: string) {
  const d = new Date(isoTime);
  const sameDay = d.toDateString() === new Date().toDateString();
  const t = d.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' });
  return sameDay ? t : `${d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}, ${t}`;
}

export function dateLabel(dateStr: string) {
  return new Date(dateStr.length === 10 ? dateStr + 'T12:00:00' : dateStr).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
}
