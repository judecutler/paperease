'use client';
import { useState } from 'react';
import { Button, Icon } from '@/components/ui';
import { timeLabel, type useCareLoop } from '@/components/useCareLoop';
import type { Payload } from '@/lib/payload';
import { assess, REGISTRY_STATUS_DEFINITIONS_URL } from '@/lib/registry';
import type { RegistryStatus, Submission } from '@/lib/types';

type Act = ReturnType<typeof useCareLoop>['act'];

const TONE = { pass: 'pine', blocked: 'danger', 'not-found': 'attention', unchecked: 'attention' } as const;

export function RegistryCheckCard({ sub, cgName, registry, locked, busy, act }: { sub: Submission; cgName: string; registry: Payload['registry']; locked: boolean; busy: boolean; act: Act }) {
  const check = sub.registryCheck;
  const verdict = check ? assess(check) : null;
  const hasNumber = !!sub.fields.find((f) => f.key === 'registration_number')?.value;
  // no default: a recorded result is a statement about a real person, so staff pick it on purpose
  const [result, setResult] = useState<RegistryStatus | 'NOT_FOUND' | ''>('');

  return (
    <div className="stack-sm">
      <span className="eyebrow">California HCA registry</span>
      <div className="cl-field">
        <div className="cl-field-head">
          <span className="cl-label">Registry status</span>
          {verdict ? (
            <span className={`cl-badge cl-tone-${TONE[verdict.kind]}`}>
              <Icon name={verdict.kind === 'pass' ? 'check' : verdict.kind === 'unchecked' ? 'clock' : 'flag'} />
              {verdict.label}
            </span>
          ) : (
            <span className="cl-badge cl-tone-attention">
              <Icon name="clock" />
              Not checked yet
            </span>
          )}
        </div>

        {check && verdict ? (
          <>
            <div className="cl-field-value">
              {verdict.kind === 'pass' ? `Registry shows ${check.status}` : verdict.kind === 'unchecked' ? 'Waiting for a lookup' : verdict.kind === 'not-found' ? 'No match found' : `Registry shows ${check.status}`}
            </div>
            <div className="small">{verdict.kind === 'pass' ? verdict.note : verdict.reason}</div>
            {verdict.kind !== 'unchecked' && (
              <div className="cl-data cl-muted">
                Searched {check.searchedName}, ID {check.perIdMasked} · {check.by === 'manual' ? `recorded by ${check.checkedBy ?? 'staff'}` : registry.label.toLowerCase()} · {timeLabel(check.checkedAt)}
              </div>
            )}
          </>
        ) : (
          <div className="small muted">
            {hasNumber
              ? 'The registry has not been checked for this number yet.'
              : `The registry search needs ${cgName.split(' ')[0]}’s registration number, which has not been read yet.`}
          </div>
        )}

        {!locked && (
          <div className="field-actions" style={{ flexWrap: 'wrap', alignItems: 'center' }}>
            {registry.automatic && (
              <Button size="sm" icon="loop" disabled={busy || !hasNumber} onClick={() => act({ type: 'check-registry', submissionId: sub.id })}>
                {check ? 'Check again' : 'Check registry'}
              </Button>
            )}
            <a className="small" href={registry.searchUrl} target="_blank" rel="noreferrer">Open the registry search</a>
            <a className="small" href={REGISTRY_STATUS_DEFINITIONS_URL} target="_blank" rel="noreferrer">What each status means</a>
          </div>
        )}

        {!locked && !registry.automatic && (
          <form
            className="field-edit"
            style={{ marginTop: 8 }}
            onSubmit={(e) => {
              e.preventDefault();
              if (result) act({ type: 'record-registry-check', submissionId: sub.id, result });
            }}
          >
            <select className="input input-sm" value={result} onChange={(e) => setResult(e.target.value as RegistryStatus | 'NOT_FOUND' | '')} aria-label="What the registry shows" disabled={busy || !hasNumber}>
              <option value="" disabled>What does the registry show?</option>
              {registry.statuses.map((s) => <option key={s} value={s}>{s}</option>)}
              <option value="NOT_FOUND">No match found</option>
            </select>
            <Button size="sm" type="submit" disabled={busy || !hasNumber || !result}>Record result</Button>
          </form>
        )}
      </div>
    </div>
  );
}
