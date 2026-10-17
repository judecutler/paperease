'use client';
import Link from 'next/link';
import { useEffect, useRef, useState } from 'react';
import { Shell } from '@/components/Shell';
import { ApprovalBar, AuditTrail, Button, EscalationNotice, ExtractedField, SmsThread, StatusBadge } from '@/components/ui';
import { RegistryCheckCard } from '@/components/RegistryCheck';
import { dateLabel, timeLabel, useCareLoop } from '@/components/useCareLoop';
import { approvalBlocker, needsRegistryCheck } from '@/lib/registry';
import { isUnconfirmed } from '@/lib/fields';
import type { Action } from '@/lib/agent';
import type { Payload } from '@/lib/payload';
import type { ExtractedFieldValue, RequirementState, RequirementType, Submission } from '@/lib/types';

const unverified = (s: Submission) => s.fields.filter(isUnconfirmed).length;

export function CaregiverView({ id, initialReq }: { id: string; initialReq?: string }) {
  const { data, busy, error, setError, act } = useCareLoop();
  const [selected, setSelected] = useState<string | undefined>(initialReq);

  const db = data?.db;
  const cg = db?.caregivers.find((c) => c.id === id);
  const states = db ? db.rules.requirements.map((r) => db.requirements.find((s) => s.caregiverId === id && s.requirementId === r.id)!).filter(Boolean) : [];

  // default selection: whatever most needs a person, then whatever the agent is working on
  useEffect(() => {
    if (!db || selected) return;
    const pick = states.find((s) => s.status === 'escalated') || states.find((s) => s.status === 'pending-review') || states.find((s) => s.openSubmissionId);
    if (pick) setSelected(pick.requirementId);
  }, [db]); // eslint-disable-line react-hooks/exhaustive-deps

  if (!data || !db) return <Shell error={error}><p className="loading">Loading…</p></Shell>;
  if (!cg) return <Shell ai={data.ai}><p className="loading">No caregiver with this id. <Link href="/">Back to dashboard</Link></p></Shell>;

  const selState = states.find((s) => s.requirementId === selected);
  const subId = selState?.openSubmissionId || selState?.approvedSubmissionId;
  const sub = subId ? db.submissions.find((s) => s.id === subId) : undefined;
  const messages = db.messages.filter((m) => m.caregiverId === id).map((m) => ({ ...m, time: timeLabel(m.time) }));
  const events = db.audit
    .filter((e) => e.caregiverId === id)
    .map((e) => ({ ...e, time: timeLabel(e.time), detail: [db.rules.requirements.find((r) => r.id === e.requirementId)?.name, e.detail].filter(Boolean).join(' · ') }))
    .reverse();
  const approvedCount = states.filter((s) => s.status === 'approved').length;

  return (
    <Shell ai={data.ai} error={error} onDismiss={() => setError(null)}>
      <div className="page-head">
        <div>
          <div className="eyebrow"><Link href="/">Dashboard</Link> / Caregiver</div>
          <h1>{cg.name}</h1>
          <p className="muted small" style={{ marginTop: 4 }}>
            <span className="cl-data">{cg.phone}</span> · SMS in {cg.language === 'es' ? 'Spanish' : 'English'} · hired {dateLabel(cg.hiredOn)} ·{' '}
            {cg.optedOut ? 'opted out of texts' : cg.smsConsent ? 'agreed to texts' : 'no SMS consent'}
          </p>
        </div>
        <div className="actions">
          <span className="muted small">{approvedCount} of {states.length} requirements approved</span>
          <a className="cl-btn cl-btn-secondary cl-btn-sm" href={`/api/packet/${cg.id}`} target="_blank" rel="noreferrer">Personnel file for audit</a>
        </div>
      </div>

      <div className="grid-cg">
        <div className="stack">
          <section className="card">
            <div className="card-head">
              <h3>Required documents</h3>
              <span className="muted small">California HCO checklist (demo rules)</span>
            </div>
            <div className="reqs">
              {states.map((s) => (
                <RequirementRow key={s.requirementId} s={s} req={db.rules.requirements.find((r) => r.id === s.requirementId)!} selected={s.requirementId === selected} busy={busy} onSelect={() => setSelected(s.requirementId)} act={act} />
              ))}
            </div>
          </section>

          {selState && (
            <ReviewPanel
              key={`${selState.requirementId}-${sub?.id}`}
              reqName={db.rules.requirements.find((r) => r.id === selState.requirementId)!.name}
              reqId={selState.requirementId}
              registry={data.registry}
              state={selState}
              sub={sub}
              firstName={cg.firstName}
              cgName={cg.name}
              busy={busy}
              act={act}
            />
          )}

          <WalletCard cgId={cg.id} firstName={cg.firstName} canText={cg.smsConsent && !cg.optedOut} busy={busy} act={act} />

          <section className="card">
            <div className="card-head">
              <h3>Audit trail</h3>
              <Link className="small" href="/audit">All activity</Link>
            </div>
            <AuditTrail events={events} />
          </section>
        </div>

        <Phone cgId={cg.id} firstName={cg.firstName} name={cg.name} phone={cg.phone} messages={messages} samples={data.samples} busy={busy} act={act} optedOut={!!cg.optedOut} />
      </div>
    </Shell>
  );
}

type Act = ReturnType<typeof useCareLoop>['act'];

function RequirementRow({ s, req, selected, busy, onSelect, act }: { s: RequirementState; req: RequirementType; selected: boolean; busy: boolean; onSelect: () => void; act: Act }) {
  return (
    <div className={`req-row${selected ? ' selected' : ''}`}>
      <div>
        <button className="req-name" onClick={onSelect}>
          {req.name}
        </button>
        <div className="why">{s.explanation}</div>
        {s.expiresOn && (s.status === 'approved' || s.status === 'expiring') && <div className="why cl-data">Valid until {dateLabel(s.expiresOn)}</div>}
      </div>
      <div className="req-side">
        <StatusBadge status={s.status} />
        {(s.status === 'missing' || s.status === 'expiring') && req.smsCollectible && (
          <Button size="sm" icon="arrow" disabled={busy} onClick={() => act({ type: 'authorize-outreach', caregiverId: s.caregiverId, requirementId: s.requirementId }).then(onSelect)}>
            {s.status === 'expiring' ? 'Ask agent to renew' : 'Ask agent to request'}
          </Button>
        )}
        {s.status === 'missing' && !req.smsCollectible && <span className="small muted">Staff collects this</span>}
        {(s.status === 'requested' || s.status === 'following-up') && (
          <Button size="sm" variant="quiet" icon="loop" disabled={busy} onClick={() => act({ type: 'send-reminder', caregiverId: s.caregiverId, requirementId: s.requirementId })}>
            Send reminder
          </Button>
        )}
        {(s.status === 'pending-review' || s.status === 'escalated') && !selected && (
          <Button size="sm" icon="eye" onClick={onSelect}>Review</Button>
        )}
        {(s.status === 'approved' || s.status === 'expiring') && s.approvedSubmissionId && !selected && (
          <Button size="sm" variant="quiet" icon="doc" onClick={onSelect}>View record</Button>
        )}
      </div>
    </div>
  );
}

function ReviewPanel({ reqName, reqId, registry, state, sub, firstName, cgName, busy, act }: { reqName: string; reqId: string; registry: Payload['registry']; state: RequirementState; sub?: Submission; firstName: string; cgName: string; busy: boolean; act: Act }) {
  if (!sub || (sub.state === 'collecting' && sub.files.length === 0)) {
    return (
      <section className="card">
        <div className="card-head">
          <h3>{reqName}</h3>
          <StatusBadge status={state.status} />
        </div>
        <div className="empty">
          {state.status === 'requested' || state.status === 'following-up'
            ? `The agent is waiting for ${firstName} to reply. Use the phone on the right to reply as ${firstName}.`
            : state.status === 'missing'
              ? 'Nothing submitted yet. Ask the agent to request it.'
              : 'No document on file for this record.'}
        </div>
      </section>
    );
  }
  const n = unverified(sub);
  const locked = sub.state === 'approved' || sub.state === 'rejected';
  const checksRegistry = needsRegistryCheck(reqId);
  const blocker = checksRegistry && !locked ? approvalBlocker(sub.registryCheck) : null;
  return (
    <section className="card stack">
      <div className="card-head" style={{ marginBottom: 0 }}>
        <div>
          <h3>{reqName}</h3>
          <p className="small muted">
            {sub.extractedBy === 'claude' ? 'Extracted by Claude' : sub.extractedBy === 'sample' ? 'Extracted (demo extraction)' : 'Not extracted'} · received {timeLabel(sub.createdAt)}
            {sub.supersedes ? ' · replaces an earlier submission' : ''}
          </p>
        </div>
        <StatusBadge status={state.status} />
      </div>

      {sub.state === 'escalated' && (
        <EscalationNotice reason={sub.escalation}>
          <Button size="sm" icon="loop" disabled={busy} onClick={() => act({ type: 'request-another', submissionId: sub.id })}>Ask {firstName} for another photo</Button>
          <span className="small muted" style={{ alignSelf: 'center' }}>or fill in the fields below yourself and approve.</span>
        </EscalationNotice>
      )}

      {sub.files.length > 0 && (
        <div className="stack-sm">
          <span className="eyebrow">Original documents</span>
          <div className="docs">
            {sub.files.map((f, i) => (
              <a key={i} className="doc-thumb" href={f.url} target="_blank" rel="noreferrer">
                {f.mime.startsWith('image/') ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img src={f.url} alt={f.name} />
                ) : (
                  <div style={{ height: 110, display: 'grid', placeItems: 'center' }}>PDF</div>
                )}
                <span>{f.name}</span>
              </a>
            ))}
          </div>
        </div>
      )}

      <div className="stack-sm">
        <span className="eyebrow">Extracted record</span>
        <div className="fields">
          {sub.fields.map((f) => (
            <FieldCard key={f.key} f={f} subId={sub.id} busy={busy} locked={locked} act={act} />
          ))}
        </div>
      </div>

      {checksRegistry && <RegistryCheckCard sub={sub} cgName={cgName} registry={registry} locked={locked} busy={busy} act={act} />}

      {!locked && sub.state !== 'collecting' && (
        <ApprovalBar
          unverified={n}
          blocker={blocker}
          busy={busy}
          note={n > 0 ? 'Check each value against the original, then verify or correct it.' : undefined}
          onApprove={() => act({ type: 'approve', submissionId: sub.id })}
          onRequest={() => act({ type: 'request-another', submissionId: sub.id })}
          onReject={() => {
            const reason = window.prompt('Why are you rejecting this submission?') ?? undefined;
            act({ type: 'reject', submissionId: sub.id, reason });
          }}
        />
      )}
      {sub.state === 'collecting' && <p className="small muted">The agent is still collecting missing information from {firstName}. You can review once the record is ready.</p>}
    </section>
  );
}

function FieldCard({ f, subId, busy, locked, act }: { f: ExtractedFieldValue; subId: string; busy: boolean; locked: boolean; act: Act }) {
  const [editing, setEditing] = useState(false);
  const [value, setValue] = useState(f.value ?? '');
  const unchecked = f.source === 'ai' || f.source === 'caregiver' || f.source === 'imported';
  return (
    <ExtractedField label={f.label + (f.required ? '' : ' (optional)')} value={f.value} source={f.source} confidence={f.value ? f.confidence : undefined} sourceRef={f.sourceRef} verifiedBy={f.verifiedBy} missing={f.value === null && unchecked}>
      {!locked && !editing && (
        <div className="field-actions">
          {unchecked && f.value !== null && <Button size="sm" icon="check" disabled={busy} onClick={() => act({ type: 'verify-field', submissionId: subId, key: f.key })}>Verify</Button>}
          <Button size="sm" variant="quiet" disabled={busy} onClick={() => setEditing(true)}>{f.value === null ? 'Enter value' : 'Correct'}</Button>
        </div>
      )}
      {editing && (
        <form
          className="field-edit"
          onSubmit={async (e) => {
            e.preventDefault();
            if (await act({ type: 'edit-field', submissionId: subId, key: f.key, value })) setEditing(false);
          }}
        >
          <input className="input input-sm" autoFocus value={value} onChange={(e) => setValue(e.target.value)} aria-label={f.label} />
          <Button size="sm" type="submit" disabled={busy}>Save</Button>
          <Button size="sm" variant="quiet" onClick={() => setEditing(false)}>Cancel</Button>
        </form>
      )}
    </ExtractedField>
  );
}

function Phone({ cgId, firstName, name, phone, messages, samples, busy, act, optedOut }: {
  cgId: string; firstName: string; name: string; phone: string; optedOut: boolean;
  messages: Parameters<typeof SmsThread>[0]['messages']; samples: { id: string; label: string }[]; busy: boolean; act: Act;
}) {
  const [text, setText] = useState('');
  const [sample, setSample] = useState((samples.find((s) => s.label.includes(firstName)) ?? samples[0])?.id ?? '');
  const [uploading, setUploading] = useState(false);
  const body = useRef<HTMLDivElement>(null);
  const fileInput = useRef<HTMLInputElement>(null);
  useEffect(() => {
    body.current?.scrollTo({ top: body.current.scrollHeight });
  }, [messages.length]);

  const sendText = async (t: string) => {
    if (!t.trim()) return;
    if (await act({ type: 'caregiver-reply', caregiverId: cgId, text: t })) setText('');
  };
  const upload = async (file: File) => {
    setUploading(true);
    try {
      const fd = new FormData();
      fd.append('file', file);
      const res = await fetch('/api/upload', { method: 'POST', body: fd });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error);
      await act({ type: 'caregiver-reply', caregiverId: cgId, upload: json, text: text || undefined });
      setText('');
    } catch (e) {
      alert((e as Error).message);
    } finally {
      setUploading(false);
      if (fileInput.current) fileInput.current.value = '';
    }
  };
  const disabled = busy || uploading;

  return (
    <aside className="phone" aria-label={`Simulated phone for ${name}`}>
      <span className="eyebrow">{firstName}’s phone (simulated SMS)</span>
      <SmsThread
        contact={name}
        number={phone}
        messages={messages}
        bodyRef={body}
        footer={
          <div className="composer">
            <span className="hint">Reply as {firstName} to drive the demo.{optedOut ? ` ${firstName} opted out, so the agent will not text back.` : ''}</span>
            <form className="composer-row" onSubmit={(e) => { e.preventDefault(); sendText(text); }}>
              <input className="input input-sm" placeholder="Text message" value={text} onChange={(e) => setText(e.target.value)} disabled={disabled} />
              <Button size="sm" type="submit" disabled={disabled || !text.trim()}>Send</Button>
            </form>
            <div className="chips">
              {['It was 5 hours', 'I did 3 hours', 'STOP'].map((t) => (
                <button key={t} className="chip" disabled={disabled} onClick={() => sendText(t)}>{t}</button>
              ))}
            </div>
            <div className="composer-row">
              <select className="input input-sm" value={sample} onChange={(e) => setSample(e.target.value)} disabled={disabled} aria-label="Sample document">
                {samples.map((s) => <option key={s.id} value={s.id}>{s.label}</option>)}
              </select>
              <Button size="sm" icon="doc" disabled={disabled} onClick={() => act({ type: 'caregiver-reply', caregiverId: cgId, sampleId: sample })}>Send photo</Button>
            </div>
            <div className="composer-row">
              <input ref={fileInput} type="file" accept="image/png,image/jpeg,image/webp,image/gif,application/pdf" hidden onChange={(e) => e.target.files?.[0] && upload(e.target.files[0])} />
              <Button size="sm" variant="quiet" disabled={disabled} onClick={() => fileInput.current?.click()}>{uploading ? 'Uploading…' : 'Upload your own photo'}</Button>
            </div>
          </div>
        }
      />
    </aside>
  );
}

function WalletCard({ cgId, firstName, canText, busy, act }: { cgId: string; firstName: string; canText: boolean; busy: boolean; act: (a: Action) => Promise<boolean> }) {
  return (
    <section className="card">
      <div className="card-head">
        <h3>Credential wallet</h3>
        <span className="muted small">Records that follow {firstName} between agencies</span>
      </div>
      <p className="small muted" style={{ margin: '0 0 var(--space-3)' }}>
        With {firstName}&apos;s permission by text, confirmed values (not photos) are saved to a wallet, and another agency can pre-fill {firstName}&apos;s file from it.
        A person there still confirms every field, and the registry is checked again.
      </p>
      <div className="actions">
        <Button size="sm" icon="arrow" disabled={busy || !canText} onClick={() => act({ type: 'wallet-offer-share', caregiverId: cgId })}>Ask to add {firstName}&apos;s records</Button>
        <Button size="sm" icon="loop" disabled={busy || !canText} onClick={() => act({ type: 'wallet-request', caregiverId: cgId })}>Check for earlier records</Button>
        <Button size="sm" variant="quiet" disabled={busy} onClick={() => act({ type: 'wallet-withdraw', caregiverId: cgId })}>Remove our records</Button>
      </div>
    </section>
  );
}
