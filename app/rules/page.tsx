'use client';
import { useEffect, useState } from 'react';
import { Shell } from '@/components/Shell';
import { Button } from '@/components/ui';
import { usePaperEase } from '@/components/usePaperEase';
import type { Payload } from '@/lib/payload';
import { staffFor } from '@/lib/staff';
import type { Hco } from '@/lib/types';

export default function RulesPage() {
  const { data, busy, error, setError, act } = usePaperEase();
  const [form, setForm] = useState({ expiringWithinDays: 30, minConfidence: 60, maxFollowUps: 2, autoRequest: false, reminderAfterDays: 1, maxReminders: 2 });
  // refill the form only when the saved rules change, so a background refresh does not wipe unsaved edits
  const saved = data ? JSON.stringify({ ...data.db.rules, requirements: undefined }) : '';
  useEffect(() => {
    if (!data) return;
    const r = data.db.rules;
    setForm({ expiringWithinDays: r.expiringWithinDays, minConfidence: Math.round(r.minConfidence * 100), maxFollowUps: r.maxFollowUps, autoRequest: r.autoRequest, reminderAfterDays: r.reminderAfterDays, maxReminders: r.maxReminders });
  }, [saved]); // eslint-disable-line react-hooks/exhaustive-deps
  if (!data) return <Shell error={error}><p className="loading">Loading…</p></Shell>;
  const { rules } = data.db;
  return (
    <Shell ai={data.ai} me={data.me} error={error} onDismiss={() => setError(null)}>
      <div className="page-head">
        <div>
          <div className="eyebrow">Configuration</div>
          <h1>Compliance rules</h1>
          <p className="muted small" style={{ marginTop: 4 }}>A California HCO-oriented checklist for the demo. Verify each rule against current Home Care Services Bureau requirements before real use.</p>
        </div>
      </div>

      <HcoCard data={data} busy={busy} act={act} />

      <section className="card">
        <div className="card-head"><h3>How the agent behaves</h3></div>
        <form
          className="form-row"
          onSubmit={(e) => {
            e.preventDefault();
            act({ type: 'update-rules', ...form, minConfidence: form.minConfidence / 100 });
          }}
        >
          <label>Flag as expiring within (days)<input className="input" type="number" min={1} value={form.expiringWithinDays} onChange={(e) => setForm({ ...form, expiringWithinDays: +e.target.value })} /></label>
          <label>Escalate below confidence (%)<input className="input" type="number" min={10} max={99} value={form.minConfidence} onChange={(e) => setForm({ ...form, minConfidence: +e.target.value })} /></label>
          <label>Follow-ups before escalating<input className="input" type="number" min={0} max={5} value={form.maxFollowUps} onChange={(e) => setForm({ ...form, maxFollowUps: +e.target.value })} /></label>
          <label>Remind after no reply for (days)<input className="input" type="number" min={1} value={form.reminderAfterDays} onChange={(e) => setForm({ ...form, reminderAfterDays: +e.target.value })} /></label>
          <label>Reminders before escalating<input className="input" type="number" min={0} max={5} value={form.maxReminders} onChange={(e) => setForm({ ...form, maxReminders: +e.target.value })} /></label>
          <label className="check">
            <input type="checkbox" checked={form.autoRequest} onChange={(e) => setForm({ ...form, autoRequest: e.target.checked })} />
            Let the daily sweep request new gaps without asking me
          </label>
          <Button type="submit" disabled={busy}>Save and re-check</Button>
          <p className="small muted" style={{ flexBasis: '100%' }}>
            The daily sweep runs every morning. It re-checks expiry dates, reminds caregivers who have not replied and hands silent requests to a person.
            With automatic requests off, the agent only texts about gaps you have asked it to collect.
          </p>
        </form>
      </section>

      <section className="card">
        <div className="card-head"><h3>Required documents per caregiver</h3></div>
        <div className="table-wrap">
          <table className="rules-table" style={{ minWidth: 720 }}>
            <thead><tr><th>Document</th><th>Rule</th><th>Collected</th><th>Valid for</th><th>Fields the agent extracts</th></tr></thead>
            <tbody>
              {rules.requirements.map((r) => (
                <tr key={r.id}>
                  <td><strong>{r.name}</strong></td>
                  <td className="small">{r.rule}</td>
                  <td>{r.smsCollectible ? <span className="tag cl-tone-agent">By agent over SMS</span> : <span className="tag cl-tone-attention">By staff only</span>}</td>
                  <td className="cl-data">{r.validMonths ? `${r.validMonths} months` : 'No expiry'}</td>
                  <td className="small">{r.fields.map((f) => f.label + (f.required ? '' : ' (optional)')).join(', ')}{r.minHours ? `. Minimum ${r.minHours} hours.` : ''}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      <section className="card">
        <div className="card-head"><h3>Demo data</h3></div>
        <div className="actions">
          <Button variant="danger" disabled={busy} onClick={() => confirm('Reset all demo data to the starting state?') && act({ type: 'reset' })}>Reset demo data</Button>
          <span className="small muted">Restores the six sample caregivers and clears every message and decision.</span>
        </div>
      </section>
    </Shell>
  );
}

const EMPTY_HCO: Hco = { name: '', license: '', address: '', phone: '' };

// Each staff member's HCO: caregivers assigned to them see its name on texts and the upload page.
function HcoCard({ data, busy, act }: { data: Payload; busy: boolean; act: ReturnType<typeof usePaperEase>['act'] }) {
  const me = data.me;
  const mine = staffFor(data.db, me?.email);
  const [hco, setHco] = useState<Hco>(mine?.hco ?? EMPTY_HCO);
  // refill only when the saved details change, like the rules form
  const saved = JSON.stringify(mine?.hco ?? null);
  useEffect(() => setHco(mine?.hco ?? EMPTY_HCO), [saved]); // eslint-disable-line react-hooks/exhaustive-deps
  const field = (key: keyof Hco, label: string, placeholder: string) => (
    <label>{label}<input className="input" value={hco[key]} placeholder={placeholder} onChange={(e) => setHco({ ...hco, [key]: e.target.value })} /></label>
  );
  return (
    <section className="card">
      <div className="card-head">
        <h3>HCO details</h3>
        <span className="muted small">Caregivers see their assigned staff member's HCO on texts and the upload page.</span>
      </div>
      {me ? (
        <form
          className="form-row"
          style={{ marginBottom: 'var(--space-4)' }}
          onSubmit={(e) => {
            e.preventDefault();
            act({ type: 'update-hco', email: me.email, hco });
          }}
        >
          {field('name', 'Your HCO name', 'Sunrise Home Care')}
          {field('license', 'HCO license number', '194700101')}
          {field('address', 'Address', '1200 Wilshire Blvd, Los Angeles, CA')}
          {field('phone', 'Phone', '(213) 555-0190')}
          <Button type="submit" disabled={busy}>Save HCO</Button>
        </form>
      ) : (
        <p className="small muted" style={{ marginBottom: 'var(--space-4)' }}>Sign in to edit your own HCO details.</p>
      )}
      <div className="table-wrap">
        <table className="rules-table" style={{ minWidth: 720 }}>
          <thead><tr><th>Staff</th><th>HCO</th><th>License</th><th>Address</th><th>Phone</th><th>Caregivers</th></tr></thead>
          <tbody>
            {data.db.staff.map((s) => (
              <tr key={s.email}>
                <td><strong>{s.name}</strong><div className="small muted">{s.email}</div></td>
                <td>{s.hco.name}</td>
                <td className="cl-data">{s.hco.license || 'not set'}</td>
                <td className="small">{s.hco.address}</td>
                <td className="cl-data">{s.hco.phone}</td>
                <td>{data.db.caregivers.filter((c) => c.assignedTo === s.email).length}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}
