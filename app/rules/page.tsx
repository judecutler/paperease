'use client';
import { useEffect, useState } from 'react';
import { Shell } from '@/components/Shell';
import { Button } from '@/components/ui';
import { useCareLoop } from '@/components/useCareLoop';

export default function RulesPage() {
  const { data, busy, error, setError, act } = useCareLoop();
  const [form, setForm] = useState({ expiringWithinDays: 30, minConfidence: 60, maxFollowUps: 2 });
  useEffect(() => {
    if (data) setForm({ expiringWithinDays: data.db.rules.expiringWithinDays, minConfidence: Math.round(data.db.rules.minConfidence * 100), maxFollowUps: data.db.rules.maxFollowUps });
  }, [data]);
  if (!data) return <Shell error={error}><p className="loading">Loading…</p></Shell>;
  const { rules } = data.db;
  return (
    <Shell ai={data.ai} error={error} onDismiss={() => setError(null)}>
      <div className="page-head">
        <div>
          <div className="eyebrow">Configuration</div>
          <h1>Compliance rules</h1>
          <p className="muted small" style={{ marginTop: 4 }}>A California HCO-oriented checklist for the demo. Verify each rule against current Home Care Services Bureau requirements before real use.</p>
        </div>
      </div>

      <section className="card">
        <div className="card-head"><h3>How the agent behaves</h3></div>
        <form
          className="form-row"
          onSubmit={(e) => {
            e.preventDefault();
            act({ type: 'update-rules', expiringWithinDays: form.expiringWithinDays, minConfidence: form.minConfidence / 100, maxFollowUps: form.maxFollowUps });
          }}
        >
          <label>Flag as expiring within (days)<input className="input" type="number" min={1} value={form.expiringWithinDays} onChange={(e) => setForm({ ...form, expiringWithinDays: +e.target.value })} /></label>
          <label>Escalate below confidence (%)<input className="input" type="number" min={10} max={99} value={form.minConfidence} onChange={(e) => setForm({ ...form, minConfidence: +e.target.value })} /></label>
          <label>Follow-ups before escalating<input className="input" type="number" min={0} max={5} value={form.maxFollowUps} onChange={(e) => setForm({ ...form, maxFollowUps: +e.target.value })} /></label>
          <Button type="submit" disabled={busy}>Save and re-check</Button>
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
