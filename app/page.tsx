'use client';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { Shell } from '@/components/Shell';
import { Button, Icon, ReadinessMeter, StatusBadge } from '@/components/ui';
import { dateLabel, timeLabel, usePaperEase } from '@/components/usePaperEase';
import { hcoById, staffFor } from '@/lib/staff';
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
  const { data, busy, error, setError, act } = usePaperEase();
  const router = useRouter();
  const [adding, setAdding] = useState(false);
  const [form, setForm] = useState({ name: '', phone: '', language: 'en' as 'en' | 'es', assignedTo: '' });
  const [scope, setScope] = useState<'mine' | 'all' | null>(null);

  if (!data) return <Shell error={error}><p className="loading">Loading agency records…</p></Shell>;
  const { db } = data;
  // signed-in staff see their own caregivers first; demo mode without sign-in shows everyone
  const mine = staffFor(db, data.me?.email);
  const myHco = hcoById(db, mine?.hcoId);
  const view = scope ?? (mine ? 'mine' : 'all');
  const caregivers = view === 'mine' && mine ? db.caregivers.filter((c) => c.assignedTo === mine.email) : db.caregivers;
  const visible = new Set(caregivers.map((c) => c.id));
  const requirements = db.requirements.filter((s) => visible.has(s.caregiverId));

  const counts = { approved: 0, review: 0, agent: 0, missing: 0 };
  for (const s of requirements) counts[bucket(s.status)]++;
  const needsYou = requirements
    .filter((s) => s.status === 'pending-review' || s.status === 'escalated')
    .sort((a, b) => (a.status === 'escalated' ? -1 : 1) - (b.status === 'escalated' ? -1 : 1));
  const delegable = requirements.filter((s) => {
    const cg = db.caregivers.find((c) => c.id === s.caregiverId)!;
    const req = db.rules.requirements.find((r) => r.id === s.requirementId)!;
    return (s.status === 'missing' || s.status === 'expiring') && req.smsCollectible && cg.smsConsent && !cg.optedOut;
  }).length;
  const lastSweep = [...db.audit].reverse().find((e) => e.action.includes('daily sweep'));

  return (
    <Shell ai={data.ai} me={data.me} error={error} onDismiss={() => setError(null)}>
      <div className="page-head">
        <div>
          <div className="eyebrow">{myHco && mine ? `${myHco.name} · ${mine.name}` : db.agency.name}</div>
          <h1>Documentation readiness</h1>
          <p className="muted small" style={{ marginTop: 4 }}>
            {lastSweep ? `Daily sweep last ran ${timeLabel(lastSweep.time)}: ${lastSweep.detail}` : 'The daily sweep has not run yet.'}
          </p>
        </div>
        <div className="actions">
          <Button icon="spark" onClick={() => act({ type: 'run-sweep' })} disabled={busy}>Run daily sweep now</Button>
          <Button variant="primary" icon="arrow" onClick={() => act({ type: 'authorize-all', caregiverIds: caregivers.map((c) => c.id) })} disabled={busy || delegable === 0}>
            {delegable ? `Let the agent request ${delegable} missing item${delegable > 1 ? 's' : ''}` : 'Nothing to delegate'}
          </Button>
        </div>
      </div>

      {data.me && !mine && (
        <div className="toast" role="note">Your account is not linked to an HCO yet, so there is nothing to show. Ask an administrator to add you to your HCO.</div>
      )}

      <div className="grid-2">
        <section className="card">
          <div className="card-head">
            <h3>Agency readiness</h3>
            <span className="muted small">{caregivers.length} caregivers · {db.rules.requirements.length} requirements each</span>
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
          <div className="actions">
            {mine && (
              <div className="filters" role="group" aria-label="Which caregivers">
                <button className="cl-btn cl-btn-secondary cl-btn-sm" aria-pressed={view === 'mine'} onClick={() => setScope('mine')}>My caregivers ({db.caregivers.filter((c) => c.assignedTo === mine.email).length})</button>
                <button className="cl-btn cl-btn-secondary cl-btn-sm" aria-pressed={view === 'all'} onClick={() => setScope('all')}>All ({db.caregivers.length})</button>
              </div>
            )}
            <Button size="sm" variant="quiet" onClick={() => setAdding((v) => !v)}>{adding ? 'Cancel' : '+ Add caregiver'}</Button>
          </div>
        </div>
        {adding && (
          <form
            className="form-row"
            style={{ marginBottom: 'var(--space-4)' }}
            onSubmit={async (e) => {
              e.preventDefault();
              if (await act({ type: 'add-caregiver', ...form, assignedTo: form.assignedTo || mine?.email })) {
                setForm({ name: '', phone: '', language: 'en', assignedTo: '' });
                setAdding(false);
              }
            }}
          >
            <label>Full name<input className="input" required value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} placeholder="Rosa Martinez" /></label>
            <label>Mobile number<input className="input" required value={form.phone} onChange={(e) => setForm({ ...form, phone: e.target.value })} placeholder="(213) 555-0100" /></label>
            <p className="small muted">Messages are sent in English.</p>
            <label>Assigned to
              <select className="input" value={form.assignedTo || mine?.email || ''} onChange={(e) => setForm({ ...form, assignedTo: e.target.value })}>
                <option value="">Unassigned</option>
                {db.staff.map((s) => <option key={s.email} value={s.email}>{s.name}{myHco ? '' : ` · ${hcoById(db, s.hcoId)?.name ?? ''}`}</option>)}
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
              {caregivers.length === 0 && (
                <tr><td colSpan={db.rules.requirements.length + 1} className="muted">No caregivers assigned to you yet. Choose All to see everyone.</td></tr>
              )}
              {caregivers.map((cg) => (
                <tr key={cg.id} onClick={() => router.push(`/caregivers/${cg.id}`)}>
                  <td className="name">
                    <Link href={`/caregivers/${cg.id}`} onClick={(e) => e.stopPropagation()}>{cg.name}</Link>
                    <div className="small muted">
                      English · hired {dateLabel(cg.hiredOn)}
                      {cg.optedOut ? ' · opted out of SMS' : ''}
                      {view === 'all' && ` · ${staffFor(db, cg.assignedTo)?.name ?? 'unassigned'}`}
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
