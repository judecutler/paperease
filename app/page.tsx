'use client';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { Shell } from '@/components/Shell';
import { Button, Icon, ReadinessMeter, StatusBadge } from '@/components/ui';
import { dateLabel, timeLabel, useCareLoop } from '@/components/useCareLoop';
import type { DocStatus } from '@/lib/types';

const SHORT: Record<string, string> = {
  hca_registration: 'HCA reg.',
  background_check: 'Background',
  tb_test: 'TB screening',
  initial_training: 'Entry training',
  annual_training: 'Annual training',
};

const bucket = (s: DocStatus) =>
  s === 'approved' ? 'approved' : s === 'pending-review' || s === 'escalated' || s === 'expiring' ? 'review' : s === 'missing' ? 'missing' : 'agent';

export default function Dashboard() {
  const { data, busy, error, setError, act } = useCareLoop();
  const router = useRouter();
  const [adding, setAdding] = useState(false);
  const [form, setForm] = useState({ name: '', phone: '', language: 'en' as 'en' | 'es' });

  if (!data) return <Shell error={error}><p className="loading">Loading agency records…</p></Shell>;
  const { db } = data;

  const counts = { approved: 0, review: 0, agent: 0, missing: 0 };
  for (const s of db.requirements) counts[bucket(s.status)]++;
  const needsYou = db.requirements
    .filter((s) => s.status === 'pending-review' || s.status === 'escalated')
    .sort((a, b) => (a.status === 'escalated' ? -1 : 1) - (b.status === 'escalated' ? -1 : 1));
  const delegable = db.requirements.filter((s) => {
    const cg = db.caregivers.find((c) => c.id === s.caregiverId)!;
    const req = db.rules.requirements.find((r) => r.id === s.requirementId)!;
    return (s.status === 'missing' || s.status === 'expiring') && req.smsCollectible && cg.smsConsent && !cg.optedOut;
  }).length;
  const lastCheck = [...db.audit].reverse().find((e) => e.action.startsWith('ran gap detection'));

  return (
    <Shell ai={data.ai} error={error} onDismiss={() => setError(null)}>
      <div className="page-head">
        <div>
          <div className="eyebrow">{db.agency.name}</div>
          <h1>Documentation readiness</h1>
          <p className="muted small" style={{ marginTop: 4 }}>
            {lastCheck ? `Gap check last ran ${timeLabel(lastCheck.time)}.` : 'Gap check has not run yet.'}
          </p>
        </div>
        <div className="actions">
          <Button icon="spark" onClick={() => act({ type: 'run-gap-check' })} disabled={busy}>Run gap check</Button>
          <Button variant="primary" icon="arrow" onClick={() => act({ type: 'authorize-all' })} disabled={busy || delegable === 0}>
            {delegable ? `Let the agent request ${delegable} missing item${delegable > 1 ? 's' : ''}` : 'Nothing to delegate'}
          </Button>
        </div>
      </div>

      <div className="grid-2">
        <section className="card">
          <div className="card-head">
            <h3>Agency readiness</h3>
            <span className="muted small">{db.caregivers.length} caregivers · {db.rules.requirements.length} requirements each</span>
          </div>
          <ReadinessMeter counts={counts} />
        </section>
        <section className="card">
          <div className="card-head">
            <h3>Needs you</h3>
            <span className="muted small">{needsYou.length} waiting</span>
          </div>
          {needsYou.length === 0 ? (
            <div className="empty">Nothing needs a decision right now.</div>
          ) : (
            <ul className="queue">
              {needsYou.map((s) => {
                const cg = db.caregivers.find((c) => c.id === s.caregiverId)!;
                const req = db.rules.requirements.find((r) => r.id === s.requirementId)!;
                return (
                  <li key={`${s.caregiverId}-${s.requirementId}`}>
                    <Link href={`/caregivers/${cg.id}?req=${req.id}`}>
                      <div className="queue-main">
                        <strong>{cg.name}</strong> · {req.name}
                        <div className="small muted">{s.explanation}</div>
                      </div>
                      <StatusBadge status={s.status} />
                    </Link>
                  </li>
                );
              })}
            </ul>
          )}
        </section>
      </div>

      <section className="card">
        <div className="card-head">
          <h3>Caregivers</h3>
          <Button size="sm" variant="quiet" onClick={() => setAdding((v) => !v)}>{adding ? 'Cancel' : '+ Add caregiver'}</Button>
        </div>
        {adding && (
          <form
            className="form-row"
            style={{ marginBottom: 'var(--space-4)' }}
            onSubmit={async (e) => {
              e.preventDefault();
              if (await act({ type: 'add-caregiver', ...form })) {
                setForm({ name: '', phone: '', language: 'en' });
                setAdding(false);
              }
            }}
          >
            <label>Full name<input className="input" required value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} placeholder="Rosa Martinez" /></label>
            <label>Mobile number<input className="input" required value={form.phone} onChange={(e) => setForm({ ...form, phone: e.target.value })} placeholder="(213) 555-0100" /></label>
            <label>SMS language
              <select className="input" value={form.language} onChange={(e) => setForm({ ...form, language: e.target.value as 'en' | 'es' })}>
                <option value="en">English</option>
                <option value="es">Spanish</option>
              </select>
            </label>
            <Button type="submit" variant="secondary" disabled={busy}>Add and check documents</Button>
            <p className="small muted" style={{ flexBasis: '100%' }}>Adding a caregiver records SMS consent for the demo. In production, consent is collected before the first text.</p>
          </form>
        )}
        <div className="table-wrap">
          <table className="roster">
            <thead>
              <tr>
                <th>Caregiver</th>
                {db.rules.requirements.map((r) => <th key={r.id}>{SHORT[r.id] || r.name}</th>)}
              </tr>
            </thead>
            <tbody>
              {db.caregivers.map((cg) => (
                <tr key={cg.id} onClick={() => router.push(`/caregivers/${cg.id}`)}>
                  <td className="name">
                    <Link href={`/caregivers/${cg.id}`} onClick={(e) => e.stopPropagation()}>{cg.name}</Link>
                    <div className="small muted">
                      {cg.language === 'es' ? 'Spanish' : 'English'} · hired {dateLabel(cg.hiredOn)}
                      {cg.optedOut ? ' · opted out of SMS' : ''}
                    </div>
                  </td>
                  {db.rules.requirements.map((r) => {
                    const s = db.requirements.find((x) => x.caregiverId === cg.id && x.requirementId === r.id);
                    return <td key={r.id}>{s ? <StatusBadge status={s.status} /> : <span className="muted"><Icon name="empty" /></span>}</td>;
                  })}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>
    </Shell>
  );
}
