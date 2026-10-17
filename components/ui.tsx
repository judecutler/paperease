// TSX port of the CareLoop design system reference components (design-system/reference-components.js).
// Class names match app/components.css.
import type React from 'react';
import type { DocStatus, PhotoCheck } from '@/lib/types';
import { PhotoCheckCard } from '@/components/PhotoCheckCard';

const cx = (...c: (string | false | null | undefined)[]) => c.filter(Boolean).join(' ');

export type IconName = 'empty' | 'arrow' | 'loop' | 'eye' | 'flag' | 'clock' | 'check' | 'spark' | 'doc';
const PATHS: Record<IconName, React.ReactNode> = {
  empty: <circle cx={6} cy={6} r={4} />,
  arrow: <path d="M2.5 6h6.5M6.5 3.25 9.25 6 6.5 8.75" />,
  loop: (<><path d="M9.5 4.5A4 4 0 1 0 10 7" /><path d="M9.75 2v2.75H7" /></>),
  eye: (<><path d="M1.5 6S3.5 2.75 6 2.75 10.5 6 10.5 6 8.5 9.25 6 9.25 1.5 6 1.5 6Z" /><circle cx={6} cy={6} r={1.25} /></>),
  flag: <path d="M3 10.5V1.75M3 2h6l-1.5 2.25L9 6.5H3" />,
  clock: (<><circle cx={6} cy={6} r={4.5} /><path d="M6 3.5V6l1.75 1.25" /></>),
  check: <path d="M2.5 6.25 5 8.75l4.5-5.5" />,
  spark: <path d="M6 1.5v2.5M6 8v2.5M1.5 6H4M8 6h2.5M3 3l1.25 1.25M7.75 7.75 9 9M9 3 7.75 4.25M4.25 7.75 3 9" />,
  doc: (<><path d="M3 1.5h4l2 2v7H3z" /><path d="M7 1.5v2h2" /></>),
};

export function Icon({ name, size = 12 }: { name: IconName; size?: number }) {
  return (
    <svg className="cl-icon" width={size} height={size} viewBox="0 0 12 12" fill="none" stroke="currentColor" strokeWidth={1.75} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      {PATHS[name]}
    </svg>
  );
}

export function Button({ variant = 'secondary', size = 'md', icon, className, children, ...rest }: React.ButtonHTMLAttributes<HTMLButtonElement> & { variant?: 'primary' | 'secondary' | 'quiet' | 'danger'; size?: 'md' | 'sm'; icon?: IconName }) {
  return (
    <button type="button" {...rest} className={cx('cl-btn', `cl-btn-${variant}`, `cl-btn-${size}`, className)}>
      {icon && <Icon name={icon} size={size === 'sm' ? 12 : 14} />}
      {children}
    </button>
  );
}

export const STATUS: Record<DocStatus, [tone: string, word: string, icon: IconName]> = {
  missing: ['danger', 'Missing', 'empty'],
  requested: ['agent', 'Requested', 'arrow'],
  'following-up': ['agent', 'Following up', 'loop'],
  'pending-review': ['attention', 'Pending review', 'eye'],
  escalated: ['attention', 'Escalated', 'flag'],
  expiring: ['attention', 'Expiring soon', 'clock'],
  approved: ['pine', 'Approved', 'check'],
};

export function StatusBadge({ status, label }: { status: DocStatus; label?: string }) {
  const [tone, word, icon] = STATUS[status] ?? STATUS.missing;
  return (
    <span className={cx('cl-badge', `cl-tone-${tone}`)}>
      <Icon name={icon} />
      {label || word}
    </span>
  );
}

export function ExtractedField(props: {
  label: string;
  value?: React.ReactNode;
  source?: 'ai' | 'caregiver' | 'verified' | 'edited';
  confidence?: number;
  sourceRef?: string;
  verifiedBy?: string;
  missing?: boolean;
  children?: React.ReactNode;
}) {
  const source = props.source || 'ai';
  const unchecked = source === 'ai' || source === 'caregiver';
  const low = unchecked && typeof props.confidence === 'number' && props.confidence < 0.8;
  let meta: React.ReactNode;
  if (props.missing) meta = <span className="cl-field-tag cl-tone-attention"><Icon name="flag" />Not found on document</span>;
  else if (source === 'verified') meta = <span className="cl-field-tag cl-tone-pine"><Icon name="check" />Verified{props.verifiedBy ? ` by ${props.verifiedBy}` : ''}</span>;
  else if (source === 'edited') meta = <span className="cl-field-tag cl-tone-pine"><Icon name="check" />Corrected{props.verifiedBy ? ` by ${props.verifiedBy}` : ''}</span>;
  else
    meta = (
      <span className={cx('cl-field-tag', low ? 'cl-tone-attention' : 'cl-tone-agent')}>
        <Icon name="spark" />
        {source === 'caregiver' ? 'From SMS reply' : 'AI'}
        {typeof props.confidence === 'number' ? ` · ${Math.round(props.confidence * 100)}%` : ''}
        {low ? ' · check this' : ''}
      </span>
    );
  return (
    <div className={cx('cl-field', `cl-field-${props.missing ? 'missing' : unchecked ? 'ai' : source}`)}>
      <div className="cl-field-head">
        <span className="cl-label">{props.label}</span>
        {meta}
      </div>
      <div className="cl-field-value">{props.missing ? 'Not provided' : props.value}</div>
      {props.sourceRef && (
        <div className="cl-data cl-muted">
          <Icon name="doc" /> {props.sourceRef}
        </div>
      )}
      {props.children}
    </div>
  );
}

export function ApprovalBar(props: { unverified?: number; note?: string; busy?: boolean; onApprove?: () => void; onRequest?: () => void; onReject?: () => void }) {
  const n = props.unverified || 0;
  return (
    <div className="cl-approval" role="region" aria-label="Approval">
      <div className="cl-approval-text">
        <strong>{n > 0 ? `Verify ${n} field${n > 1 ? 's' : ''} to approve` : 'Ready for your approval'}</strong>
        <span className="cl-muted cl-small">{props.note || 'CareLoop never approves a record on its own.'}</span>
      </div>
      <div className="cl-approval-actions">
        <Button variant="quiet" onClick={props.onReject} disabled={props.busy}>Reject</Button>
        <Button variant="secondary" icon="loop" onClick={props.onRequest} disabled={props.busy}>Request another document</Button>
        <Button variant="primary" icon="check" disabled={n > 0 || props.busy} onClick={props.onApprove}>Approve record</Button>
      </div>
    </div>
  );
}

export interface SmsBubble { id: string; from: 'agent' | 'admin' | 'caregiver'; text?: string; time?: string; attachment?: { name: string; url: string; mime: string }; photoCheck?: PhotoCheck }

export function SmsThread({ contact, number, messages, footer, bodyRef }: { contact?: string; number?: string; messages: SmsBubble[]; footer?: React.ReactNode; bodyRef?: React.Ref<HTMLDivElement> }) {
  return (
    <div className="cl-sms">
      {contact && (
        <div className="cl-sms-head">
          <strong>{contact}</strong>
          {number && <span className="cl-data cl-muted">{number}</span>}
        </div>
      )}
      <div className="cl-sms-body" ref={bodyRef}>
        {messages.length === 0 && <p className="cl-small cl-muted" style={{ textAlign: 'center', margin: 0 }}>No messages yet.</p>}
        {messages.map((m) => {
          const mine = m.from !== 'caregiver';
          return (
            <div key={m.id} className={cx('cl-sms-row', mine ? 'cl-sms-out' : 'cl-sms-in', !!m.photoCheck && 'cl-sms-photo-result')}>
              {m.attachment &&
                (m.attachment.mime.startsWith('image/') ? (
                  <a href={m.attachment.url} target="_blank" rel="noreferrer" className="sms-photo">
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img src={m.attachment.url} alt={m.attachment.name} />
                  </a>
                ) : (
                  <a className="cl-sms-attach" href={m.attachment.url} target="_blank" rel="noreferrer">
                    <Icon name="doc" size={16} />
                    <span>{m.attachment.name}</span>
                  </a>
                ))}
              {m.text && <div className={cx('cl-sms-bubble', m.from === 'admin' && 'cl-sms-admin')}>{m.text}</div>}
              {m.photoCheck && <PhotoCheckCard check={m.photoCheck} />}
              <div className="cl-sms-meta cl-data">
                {m.from === 'agent' ? 'CareLoop agent' : m.from === 'admin' ? 'Agency staff' : 'Caregiver'}
                {m.time ? ` · ${m.time}` : ''}
              </div>
            </div>
          );
        })}
      </div>
      {footer}
    </div>
  );
}

const ACTOR = { agent: 'CareLoop agent', admin: 'Admin', caregiver: 'Caregiver', system: 'System' } as const;
export function AuditTrail({ events }: { events: { id: string; actor: keyof typeof ACTOR; who?: string; action: string; detail?: React.ReactNode; time: string }[] }) {
  if (!events.length) return <p className="cl-muted cl-small">Nothing recorded yet.</p>;
  return (
    <ol className="cl-audit">
      {events.map((e) => (
        <li key={e.id} className={`cl-audit-row cl-actor-${e.actor}`}>
          <span className="cl-audit-mark" aria-hidden="true" />
          <div className="cl-audit-main">
            <div>
              <strong>{e.who || ACTOR[e.actor]}</strong> {e.action}
            </div>
            {e.detail && <div className="cl-small cl-muted">{e.detail}</div>}
          </div>
          <time className="cl-data cl-muted">{e.time}</time>
        </li>
      ))}
    </ol>
  );
}

const SEGS = [
  ['approved', 'pine', 'Approved'],
  ['review', 'attention', 'Needs you'],
  ['agent', 'agent', 'Agent working'],
  ['missing', 'danger', 'Missing'],
] as const;
export function ReadinessMeter({ counts, caption }: { counts: Partial<Record<(typeof SEGS)[number][0], number>>; caption?: string }) {
  const total = SEGS.reduce((s, x) => s + (counts[x[0]] || 0), 0) || 1;
  const pct = Math.round(((counts.approved || 0) / total) * 100);
  return (
    <div className="cl-meter">
      <div className="cl-meter-head">
        <span className="cl-display">{pct}%</span>
        <span className="cl-muted">{caption || 'of required documents approved'}</span>
      </div>
      <div className="cl-meter-bar" role="img" aria-label={SEGS.map((x) => `${counts[x[0]] || 0} ${x[2]}`).join(', ')}>
        {SEGS.map((x) => (counts[x[0]] ? <span key={x[0]} className={`cl-seg cl-fill-${x[1]}`} style={{ flexGrow: counts[x[0]] }} /> : null))}
      </div>
      <ul className="cl-meter-legend">
        {SEGS.map((x) => (
          <li key={x[0]}>
            <span className={`cl-dot cl-fill-${x[1]}`} />
            <span className="cl-data-strong">{counts[x[0]] || 0}</span> {x[2]}
          </li>
        ))}
      </ul>
    </div>
  );
}

export function EscalationNotice({ title, reason, children }: { title?: string; reason: React.ReactNode; children?: React.ReactNode }) {
  return (
    <div className="cl-escalation" role="note">
      <div className="cl-escalation-icon">
        <Icon name="flag" size={16} />
      </div>
      <div className="cl-escalation-main">
        <div className="cl-escalation-title">{title || 'The agent needs you'}</div>
        <div>{reason}</div>
        {children && <div className="cl-escalation-actions">{children}</div>}
      </div>
    </div>
  );
}
