'use client';
import Link from 'next/link';
import { useEffect, useRef, useState } from 'react';
import { Shell } from '@/components/Shell';
import { ApprovalBar, AuditTrail, Button, EscalationNotice, ExtractedField, SmsThread, StatusBadge } from '@/components/ui';
import { RegistryCheckCard } from '@/components/RegistryCheck';
import { dateLabel, timeLabel, usePaperEase } from '@/components/usePaperEase';
import { approvalBlocker, needsRegistryCheck } from '@/lib/registry';
import type { Payload } from '@/lib/payload';
import { hcoFor } from '@/lib/staff';
import type { ExtractedFieldValue, RequirementState, RequirementType, Submission } from '@/lib/types';

const unverified = (s: Submission) =>
  s.fields.filter((f) => (f.value !== null && (f.source === 'ai' || f.source === 'caregiver')) || (f.required && f.value === null)).length;

export function CaregiverView({ id, initialReq }: { id: string; initialReq?: string }) {
  const { data, busy, error, setError, act } = usePaperEase();
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
  if (!cg) return <Shell ai={data.ai} me={data.me}><p className="loading">No caregiver with this id. <Link href="/">Back to dashboard</Link></p></Shell>;

  const selState = states.find((s) => s.requirementId === selected);
  const subId = selState?.openSubmissionId || selState?.approvedSubmissionId;
  const sub = subId ? db.submissions.find((s) => s.id === subId) : undefined;
  const messages = db.messages.filter((m) => m.caregiverId === id).map((m) => ({ ...m, time: timeLabel(m.time) }));
  const events = db.audit
    .filter((e) => e.caregiverId === id)
    .map((e) => ({ ...e, time: timeLabel(e.time), detail: [db.rules.requirements.find((r) => r.id === e.requirementId)?.name, e.detail].filter(Boolean).join(' · ') }))
    .reverse();
  const hco = hcoFor(db, cg);
  const approvedCount = states.filter((s) => s.status === 'approved').length;
  const openRequirements = states
    .filter((s) => (s.status === 'requested' || s.status === 'following-up') && s.openSubmissionId)
    .map((s) => db.rules.requirements.find((r) => r.id === s.requirementId)!)
    .filter((r) => r.smsCollectible)
    .map((r) => ({ id: r.id, name: r.name }));

  return (
    <Shell ai={data.ai} me={data.me} error={error} onDismiss={() => setError(null)}>
      <div className="page-head">
        <div>
          <div className="eyebrow"><Link href="/">Dashboard</Link> / Caregiver</div>
          <h1>{cg.name}</h1>
          <p className="muted small" style={{ marginTop: 4 }}>
            <span className="cl-data">{cg.phone}</span> · SMS in English · hired {dateLabel(cg.hiredOn)} ·{' '}
            {cg.optedOut ? 'opted out of texts' : cg.smsConsent ? 'agreed to texts' : 'no SMS consent'}
          </p>
          <div className="assign small">
            <label>
              Assigned to{' '}
              <select className="input input-sm" value={cg.assignedTo ?? ''} disabled={busy} onChange={(e) => act({ type: 'assign-caregiver', caregiverId: cg.id, email: e.target.value })}>
                <option value="">Unassigned</option>
                {db.staff.filter((s) => s.hcoId === cg.hcoId).map((s) => <option key={s.email} value={s.email}>{s.name}</option>)}
              </select>
            </label>
            {hco ? (
              <span className="muted">{hco.name} · HCO license <span className="cl-data">{hco.license || 'not set'}</span> · {hco.phone}</span>
            ) : (
              <span className="muted">No HCO: texts and the upload page use {db.agency.name}.</span>
            )}
          </div>
        </div>
        <div className="muted small">{approvedCount} of {states.length} requirements approved</div>
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
                <RequirementRow key={s.requirementId} s={s} req={db.rules.requirements.find((r) => r.id === s.requirementId)!} canText={cg.smsConsent && !cg.optedOut} selected={s.requirementId === selected} busy={busy} onSelect={() => setSelected(s.requirementId)} act={act} />
              ))}
            </div>
          </section>

          {selState && (
            <ReviewPanel
              key={`${selState.requirementId}-${sub?.id}`}
              req={db.rules.requirements.find((r) => r.id === selState.requirementId)!}
              canText={cg.smsConsent && !cg.optedOut}
              registry={data.registry}
              state={selState}
              sub={sub}
              firstName={cg.firstName}
              cgName={cg.name}
              busy={busy}
              act={act}
            />
          )}

          <section className="card">
            <div className="card-head">
              <h3>Audit trail</h3>
              <Link className="small" href="/audit">All activity</Link>
            </div>
            <AuditTrail events={events} />
          </section>
        </div>

        <Phone cgId={cg.id} firstName={cg.firstName} name={cg.name} phone={cg.phone} messages={messages} samples={data.samples} busy={busy} act={act} optedOut={!!cg.optedOut} canReceivePhotos={cg.smsConsent && !cg.optedOut} selectedRequirementId={selected} openRequirements={openRequirements} />
      </div>
    </Shell>
  );
}

type Act = ReturnType<typeof usePaperEase>['act'];

function RequirementRow({ s, req, canText, selected, busy, onSelect, act }: { s: RequirementState; req: RequirementType; canText: boolean; selected: boolean; busy: boolean; onSelect: () => void; act: Act }) {
  // staff enter it themselves when the agent cannot collect it: a background check, or a caregiver who cannot be texted
  const byStaff = !req.smsCollectible || !canText;
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
        {(s.status === 'missing' || s.status === 'expiring') && !byStaff && (
          <Button size="sm" icon="arrow" disabled={busy} onClick={() => act({ type: 'authorize-outreach', caregiverId: s.caregiverId, requirementId: s.requirementId }).then(onSelect)}>
            {s.status === 'expiring' ? 'Ask agent to renew' : 'Ask agent to request'}
          </Button>
        )}
        {(s.status === 'missing' || s.status === 'expiring') && byStaff && (
          <Button size="sm" icon="doc" disabled={busy} onClick={() => act({ type: 'staff-record', caregiverId: s.caregiverId, requirementId: s.requirementId }).then(onSelect)}>
            Add record
          </Button>
        )}
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

function ReviewPanel({ req, canText, registry, state, sub, firstName, cgName, busy, act }: { req: RequirementType; canText: boolean; registry: Payload['registry']; state: RequirementState; sub?: Submission; firstName: string; cgName: string; busy: boolean; act: Act }) {
  const reqName = req.name;
  // only documents the agent may collect by text can be asked for again
  const canAskAgain = req.smsCollectible && canText;
  const reqId = req.id;
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
              ? req.smsCollectible ? 'Nothing submitted yet. Ask the agent to request it.' : 'Staff collect this document. Use Add record to enter it.'
              : 'No document on file for this record.'}
        </div>
      </section>
    );
  }
  const n = unverified(sub);
  const locked = sub.state === 'approved' || sub.state === 'rejected';
  const checksRegistry = needsRegistryCheck(reqId);
  const byHand = sub.extractedBy === 'none' && sub.fields.length > 0 && sub.fields.every((f) => f.source === 'edited' || f.source === 'verified');
  const blocker = checksRegistry && !locked ? approvalBlocker(sub.registryCheck) : null;
  return (
    <section className="card stack">
      <div className="card-head" style={{ marginBottom: 0 }}>
        <div>
          <h3>{reqName}</h3>
          <p className="small muted">
            {sub.extractedBy === 'claude' ? 'Extracted by Claude' : sub.extractedBy === 'sample' ? 'Extracted (demo extraction)' : byHand ? 'Entered by hand' : 'Not extracted'} · {byHand ? 'started' : 'received'} {timeLabel(sub.createdAt)}
            {sub.supersedes ? ' · replaces an earlier submission' : ''}
          </p>
        </div>
        <StatusBadge status={state.status} />
      </div>

      {sub.state === 'escalated' && (
        <EscalationNotice reason={sub.escalation}>
          {canAskAgain && <Button size="sm" icon="loop" disabled={busy} onClick={() => act({ type: 'request-another', submissionId: sub.id })}>Ask {firstName} for another photo</Button>}
          {sub.fields.length > 0 ? (
            <span className="small muted" style={{ alignSelf: 'center' }}>or fill in the fields below yourself and approve.</span>
          ) : (
            <Button size="sm" icon="doc" disabled={busy} onClick={() => act({ type: 'staff-record', caregiverId: sub.caregiverId, requirementId: sub.requirementId })}>Enter it myself</Button>
          )}
        </EscalationNotice>
      )}

      {reqId === 'background_check' && !locked && (
        <p className="small muted">Record the clearance from the agency's Live Scan or Guardian notice. Attach the clearance notice only, never a full criminal record report.</p>
      )}

      {(sub.files.length > 0 || !locked) && (
        <div className="stack-sm">
          <div className="docs-head">
            <span className="eyebrow">Original documents</span>
            {!locked && <AttachButton subId={sub.id} busy={busy} act={act} />}
          </div>
          {sub.files.length === 0 && <p className="small muted">No document attached.</p>}
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
          onRequest={canAskAgain ? () => act({ type: 'request-another', submissionId: sub.id }) : undefined}
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

function AttachButton({ subId, busy, act }: { subId: string; busy: boolean; act: Act }) {
  const input = useRef<HTMLInputElement>(null);
  const [uploading, setUploading] = useState(false);
  const attach = async (file: File) => {
    setUploading(true);
    try {
      const fd = new FormData();
      fd.append('file', file);
      const res = await fetch('/api/upload', { method: 'POST', body: fd });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error);
      await act({ type: 'attach-file', submissionId: subId, upload: json });
    } catch (e) {
      alert((e as Error).message);
    } finally {
      setUploading(false);
      if (input.current) input.current.value = '';
    }
  };
  return (
    <>
      <input ref={input} type="file" accept="image/png,image/jpeg,image/webp,image/gif,application/pdf" hidden onChange={(e) => e.target.files?.[0] && attach(e.target.files[0])} />
      <Button size="sm" variant="quiet" icon="doc" disabled={busy || uploading} onClick={() => input.current?.click()}>{uploading ? 'Uploading…' : 'Attach document'}</Button>
    </>
  );
}

function FieldCard({ f, subId, busy, locked, act }: { f: ExtractedFieldValue; subId: string; busy: boolean; locked: boolean; act: Act }) {
  const [editing, setEditing] = useState(false);
  const [value, setValue] = useState(f.value ?? '');
  const unchecked = f.source === 'ai' || f.source === 'caregiver';
  return (
    <ExtractedField label={f.label + (f.required ? '' : ' (optional)')} value={f.value} source={f.source} confidence={f.value ? f.confidence : undefined} sourceRef={f.sourceRef} verifiedBy={f.verifiedBy} missing={f.value === null && (unchecked || 'Not entered yet')}>
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

function Phone({ cgId, firstName, name, phone, messages, samples, busy, act, optedOut, canReceivePhotos, selectedRequirementId, openRequirements }: {
  cgId: string; firstName: string; name: string; phone: string; optedOut: boolean; canReceivePhotos: boolean;
  selectedRequirementId?: string; openRequirements: { id: string; name: string }[];
  messages: Parameters<typeof SmsThread>[0]['messages']; samples: { id: string; label: string }[]; busy: boolean; act: Act;
}) {
  const [text, setText] = useState('');
  const [sample, setSample] = useState((samples.find((s) => s.label.includes(firstName)) ?? samples[0])?.id ?? '');
  const [target, setTarget] = useState(() => openRequirements.some((r) => r.id === selectedRequirementId)
    ? selectedRequirementId!
    : openRequirements.length === 1 ? openRequirements[0].id : '');
  const [phase, setPhase] = useState<{ kind: 'uploading' | 'checking'; fileName: string } | null>(null);
  const [uploadError, setUploadError] = useState<string | null>(null);
  const body = useRef<HTMLDivElement>(null);
  const fileInput = useRef<HTMLInputElement>(null);
  const openRequirementIds = openRequirements.map((r) => r.id).join('|');
  const validTarget = openRequirements.some((r) => r.id === target) ? target : undefined;
  const disabled = busy || phase !== null;
  const photoDisabled = disabled || !canReceivePhotos || !validTarget;

  useEffect(() => {
    const ids = openRequirementIds.split('|').filter(Boolean);
    setTarget((current) => {
      if (selectedRequirementId && ids.includes(selectedRequirementId)) return selectedRequirementId;
      if (ids.includes(current)) return current;
      return ids.length === 1 ? ids[0] : '';
    });
  }, [selectedRequirementId, openRequirementIds]);

  useEffect(() => {
    const container = body.current;
    if (!container) return;
    const latestReply = [...messages].reverse().find((message) => message.from === 'caregiver');
    if (latestReply?.photoCheck) {
      const cards = container.querySelectorAll<HTMLElement>('[aria-label="Photo check result"]');
      const latestCard = cards[cards.length - 1];
      if (latestCard) {
        const top = latestCard.getBoundingClientRect().top - container.getBoundingClientRect().top + container.scrollTop;
        container.scrollTo({ top: Math.max(0, top - 8) });
        return;
      }
    }
    container.scrollTo({ top: container.scrollHeight });
  }, [messages.length]);

  const sendText = async (t: string) => {
    if (!t.trim() || disabled || (!canReceivePhotos && t.trim().toUpperCase() !== 'STOP')) return;
    if (await act({ type: 'caregiver-reply', caregiverId: cgId, requirementId: validTarget, text: t })) setText('');
  };
  const upload = async (file: File) => {
    if (photoDisabled) return;
    setUploadError(null);
    setPhase({ kind: 'uploading', fileName: file.name });
    try {
      const fd = new FormData();
      fd.append('file', file);
      const res = await fetch('/api/upload', { method: 'POST', body: fd });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error || 'The document could not be uploaded. Please try again.');
      setPhase({ kind: 'checking', fileName: file.name });
      if (await act({ type: 'caregiver-reply', caregiverId: cgId, requirementId: validTarget, upload: json, text: text || undefined })) {
        setText('');
      } else {
        setUploadError('The document could not be checked. Please try again or ask agency staff for help.');
      }
    } catch (e) {
      setUploadError(e instanceof Error ? e.message : 'The document could not be uploaded. Please try again.');
    } finally {
      setPhase(null);
      if (fileInput.current) fileInput.current.value = '';
    }
  };
  const sendSample = async () => {
    if (photoDisabled || !sample) return;
    setUploadError(null);
    setPhase({ kind: 'checking', fileName: samples.find((s) => s.id === sample)?.label || 'Sample photo' });
    try {
      if (await act({ type: 'caregiver-reply', caregiverId: cgId, requirementId: validTarget, sampleId: sample, text: text || undefined })) {
        setText('');
      } else {
        setUploadError('The sample photo could not be checked. Please try again.');
      }
    } finally {
      setPhase(null);
    }
  };

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
            <label className="photo-target" htmlFor={`photo-target-${cgId}`}>
              Check document for
              <select id={`photo-target-${cgId}`} className="input input-sm" value={validTarget || ''} onChange={(e) => { setTarget(e.target.value); setUploadError(null); }} disabled={disabled || !canReceivePhotos || openRequirements.length === 0}>
                <option value="">Choose a requested document</option>
                {openRequirements.map((r) => <option key={r.id} value={r.id}>{r.name}</option>)}
              </select>
            </label>
            {!canReceivePhotos ? <p className="hint">Photo checks are unavailable without active SMS consent. You can still send STOP.</p>
              : openRequirements.length === 0 ? <p className="hint">Ask the agent to request a document before sending a photo.</p>
                : !validTarget && <p className="hint">Choose which requested document this photo should be checked against.</p>}
            <form className="composer-row" onSubmit={(e) => { e.preventDefault(); sendText(text); }}>
              <input className="input input-sm" aria-label="Text message" placeholder="Text message" value={text} onChange={(e) => setText(e.target.value)} disabled={disabled} />
              <Button size="sm" type="submit" disabled={disabled || !text.trim() || (!canReceivePhotos && text.trim().toUpperCase() !== 'STOP')}>Send</Button>
            </form>
            <div className="chips">
              {['It was 5 hours', 'I did 3 hours', 'STOP'].map((t) => (
                <button key={t} className="chip" disabled={disabled || (!canReceivePhotos && t !== 'STOP')} onClick={() => sendText(t)}>{t}</button>
              ))}
            </div>
            <div className="composer-row">
              <select className="input input-sm" value={sample} onChange={(e) => setSample(e.target.value)} disabled={photoDisabled} aria-label="Sample document">
                {samples.map((s) => <option key={s.id} value={s.id}>{s.label}</option>)}
              </select>
              <Button size="sm" icon="doc" disabled={photoDisabled || !sample} onClick={sendSample}>Send sample photo</Button>
            </div>
            <div className="composer-row">
              <input ref={fileInput} type="file" accept="image/png,image/jpeg,image/webp,image/gif,application/pdf" hidden disabled={photoDisabled} onChange={(e) => e.target.files?.[0] && upload(e.target.files[0])} />
              <Button size="sm" variant="quiet" disabled={photoDisabled} onClick={() => fileInput.current?.click()}>Upload your own photo</Button>
            </div>
            {phase && <p className="photo-progress" role="status" aria-live="polite">{phase.kind === 'uploading' ? 'Uploading' : 'Checking'} <span>{phase.fileName}</span>…</p>}
            {uploadError && <p className="photo-error" role="alert">{uploadError}</p>}
          </div>
        }
      />
    </aside>
  );
}
