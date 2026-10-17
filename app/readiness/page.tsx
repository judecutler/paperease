'use client';
import Link from 'next/link';
import { useEffect, useState } from 'react';
import { Shell } from '@/components/Shell';
import { usePaperEase } from '@/components/usePaperEase';
import type { agencyReadiness } from '@/lib/packet';

type Readiness = ReturnType<typeof agencyReadiness>;

export default function ReadinessPage() {
  const { data, error, setError } = usePaperEase();
  const [r, setR] = useState<Readiness | null>(null);
  const [failed, setFailed] = useState<string | null>(null);
  useEffect(() => {
    fetch('/api/readiness').then(async (res) => (res.ok ? setR(await res.json()) : setFailed((await res.json()).error))).catch((e) => setFailed(String(e)));
  }, [data]);
  return (
    <Shell ai={data?.ai} error={error} onDismiss={() => setError(null)}>
      <div className="page-head">
        <div>
          <div className="eyebrow">{data?.db.agency.name}</div>
          <h1>If an inspector walked in today</h1>
          <p className="muted small" style={{ marginTop: 4 }}>
            A file is audit ready only when a person approved each record, confirmed every field, the original is attached, nothing has expired and the registry check passes.
          </p>
        </div>
        {r && <div className="muted small">{r.auditReady} of {r.total} personnel files audit ready · average {r.average}%</div>}
      </div>
      {failed && <p className="loading">{failed}</p>}
      {!r && !failed && <p className="loading">Checking every personnel file…</p>}
      {r && (
        <section className="card">
          <div className="table-wrap"><table className="rules-table">
            <thead><tr><th>Caregiver</th><th>Readiness</th><th>What is in the way</th><th /></tr></thead>
            <tbody>
              {[...r.rows].sort((a, b) => a.score - b.score).map((row) => (
                <tr key={row.caregiverId}>
                  <td><Link href={`/caregivers/${row.caregiverId}`}>{row.name}</Link></td>
                  <td><strong>{row.score}%</strong> <span className="muted small">{row.ready}/{row.total}</span></td>
                  <td className="small">{row.auditReady ? 'Nothing. Ready to hand over.' : row.blockers.slice(0, 3).join(' ')}{row.blockers.length > 3 ? ` +${row.blockers.length - 3} more` : ''}</td>
                  <td><a href={`/api/packet/${row.caregiverId}`} target="_blank" rel="noreferrer">Open file</a></td>
                </tr>
              ))}
            </tbody>
          </table></div>
        </section>
      )}
    </Shell>
  );
}
