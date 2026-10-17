'use client';
import Link from 'next/link';
import { useState } from 'react';
import { Shell } from '@/components/Shell';
import { AuditTrail } from '@/components/ui';
import { timeLabel, useCareLoop } from '@/components/useCareLoop';
import type { Actor } from '@/lib/types';

const FILTERS: [Actor | 'all', string][] = [['all', 'All'], ['agent', 'Agent'], ['admin', 'Admin'], ['caregiver', 'Caregivers'], ['system', 'System']];

export default function AuditPage() {
  const { data, error, setError } = useCareLoop();
  const [filter, setFilter] = useState<Actor | 'all'>('all');
  if (!data) return <Shell error={error}><p className="loading">Loading…</p></Shell>;
  const { db } = data;
  const events = db.audit
    .filter((e) => filter === 'all' || e.actor === filter)
    .map((e) => {
      const cg = db.caregivers.find((c) => c.id === e.caregiverId);
      const req = db.rules.requirements.find((r) => r.id === e.requirementId);
      return {
        ...e,
        time: timeLabel(e.time),
        detail: (
          <>
            {cg && <Link href={`/caregivers/${cg.id}`}>{cg.name}</Link>}
            {cg && (req || e.detail) ? ' · ' : ''}
            {[req?.name, e.detail].filter(Boolean).join(' · ')}
          </>
        ),
      };
    })
    .reverse();
  return (
    <Shell ai={data.ai} error={error} onDismiss={() => setError(null)}>
      <div className="page-head">
        <div>
          <div className="eyebrow">{db.agency.name}</div>
          <h1>Audit trail</h1>
          <p className="muted small" style={{ marginTop: 4 }}>Every agent action, caregiver reply and admin decision, with a timestamp.</p>
        </div>
        <div className="filters" role="group" aria-label="Filter by actor">
          {FILTERS.map(([k, label]) => (
            <button key={k} className="cl-btn cl-btn-secondary cl-btn-sm" aria-pressed={filter === k} onClick={() => setFilter(k)}>{label}</button>
          ))}
        </div>
      </div>
      <section className="card">
        <AuditTrail events={events} />
      </section>
    </Shell>
  );
}
