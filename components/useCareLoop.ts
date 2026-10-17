'use client';
import { useCallback, useEffect, useState } from 'react';
import type { Action } from '@/lib/agent';
import type { Payload } from '@/lib/payload';

export function useCareLoop() {
  const [data, setData] = useState<Payload | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    fetch('/api/state').then((r) => r.json()).then(setData).catch((e) => setError(String(e)));
  }, []);

  const act = useCallback(async (action: Action) => {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch('/api/actions', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(action) });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error || 'Something went wrong');
      setData(json);
      return true;
    } catch (e) {
      setError((e as Error).message);
      return false;
    } finally {
      setBusy(false);
    }
  }, []);

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
