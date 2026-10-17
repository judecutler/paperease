'use client';
import { useEffect, useRef, useState } from 'react';
import { Button, Icon } from '@/components/ui';
import type { LinkView } from '@/lib/caregiverLink';

// The caregiver's side: a page opened from the link in the agency's text. No app, no login.

const T = {
  en: {
    needs: 'What we need',
    hi: (name: string) => `Hi ${name}!`,
    how: 'Take a clear photo of the whole page, with every corner showing.',
    camera: 'Take a photo',
    file: 'Choose a file',
    send: 'Send',
    another: 'Choose another',
    sending: 'Sending. Reading your document can take up to a minute.',
    missing: (field: string) => `We couldn't find the ${field} on your document.`,
    answerLabel: (field: string) => `Your ${field}`,
    orPhoto: 'Or send a photo that shows it',
    received: (name: string) => `Thanks, ${name}! We got it.`,
    receivedBody: 'The office will review it. You don’t need to do anything else.',
    office: (name: string) => `Thanks, ${name}!`,
    officeBody: (agency: string) => `Someone from ${agency} will contact you about the next step.`,
    approved: 'Your document is approved.',
    approvedBody: 'Nothing else is needed. Thank you!',
    closed: 'This request is closed.',
    closedBody: (agency: string) => `If you got a newer text from ${agency}, use the link in that one.`,
    expired: 'This link has expired.',
    expiredBody: 'Reply to the text from your agency and they will send you a new one.',
    privacy: 'Only send the document we asked for. We never ask for your Social Security number by text.',
    placeholder: { text: '', date: 'e.g. 10/05/2026', number: 'e.g. 5' },
  },

};

export function CaregiverLink({ token }: { token: string }) {
  const [view, setView] = useState<LinkView | null>(null);
  const [expired, setExpired] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [sending, setSending] = useState(false);
  const [file, setFile] = useState<File | null>(null);
  const [preview, setPreview] = useState<string | null>(null);
  const [answer, setAnswer] = useState('');
  const [sample, setSample] = useState('');
  const camera = useRef<HTMLInputElement>(null);
  const picker = useRef<HTMLInputElement>(null);

  useEffect(() => {
    fetch(`/api/link/${token}`)
      .then(async (r) => (r.ok ? setView(await r.json()) : setExpired(true)))
      .catch(() => setExpired(true));
  }, [token]);

  useEffect(() => {
    if (!file || !file.type.startsWith('image/')) return setPreview(null);
    const url = URL.createObjectURL(file);
    setPreview(url);
    return () => URL.revokeObjectURL(url);
  }, [file]);

  const t = T.en;

  const submit = async (body: FormData) => {
    setSending(true);
    setError(null);
    try {
      const res = await fetch(`/api/link/${token}`, { method: 'POST', body });
      const json = await res.json();
      if (res.status === 404) return setExpired(true);
      if (!res.ok) throw new Error(json.error);
      setView(json);
      setFile(null);
      setAnswer('');
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setSending(false);
    }
  };
  const sendFile = () => {
    if (!file) return;
    const fd = new FormData();
    fd.append('file', file);
    submit(fd);
  };
  const sendAnswer = (e: React.FormEvent) => {
    e.preventDefault();
    if (!answer.trim()) return;
    const fd = new FormData();
    fd.append('text', answer);
    submit(fd);
  };
  const sendSample = () => {
    const fd = new FormData();
    fd.append('sampleId', sample);
    submit(fd);
  };
  const pick = (e: React.ChangeEvent<HTMLInputElement>) => {
    setFile(e.target.files?.[0] ?? null);
    e.target.value = '';
  };

  if (expired) return <Frame><Done tone="muted" title={T.en.expired} body={T.en.expiredBody} /></Frame>;
  if (!view) return <Frame><p className="muted">Loading…</p></Frame>;

  const done =
    view.state === 'received' ? <Done tone="pine" title={t.received(view.firstName)} body={t.receivedBody} />
    : view.state === 'approved' ? <Done tone="pine" title={t.approved} body={t.approvedBody} />
    : view.state === 'office' ? <Done tone="attention" title={t.office(view.firstName)} body={t.officeBody(view.agency)} />
    : view.state === 'closed' ? <Done tone="muted" title={t.closed} body={t.closedBody(view.agency)} />
    : null;

  const uploader = (
    <div className="cg-upload">
      <input ref={camera} type="file" accept="image/*" capture="environment" hidden onChange={pick} />
      <input ref={picker} type="file" accept="image/png,image/jpeg,image/webp,image/gif,application/pdf" hidden onChange={pick} />
      {file ? (
        <>
          {preview ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img className="cg-preview" src={preview} alt="" />
          ) : (
            <div className="cg-file"><Icon name="doc" size={20} /> {file.name}</div>
          )}
          <Button variant="primary" className="cg-wide" disabled={sending} onClick={sendFile}>{t.send}</Button>
          <Button variant="quiet" className="cg-wide" disabled={sending} onClick={() => setFile(null)}>{t.another}</Button>
        </>
      ) : (
        <>
          <Button variant={view.state === 'question' ? 'secondary' : 'primary'} className="cg-wide" disabled={sending} onClick={() => camera.current?.click()}>{t.camera}</Button>
          <Button variant="quiet" className="cg-wide" disabled={sending} onClick={() => picker.current?.click()}>{t.file}</Button>
        </>
      )}
      {view.samples && (
        <div className="cg-demo">
          <span className="eyebrow">Demo · AI reading is off</span>
          <select className="input" value={sample} onChange={(e) => setSample(e.target.value)} disabled={sending} aria-label="Sample document">
            <option value="">Pick a sample document…</option>
            {view.samples.map((s) => <option key={s.id} value={s.id}>{s.label}</option>)}
          </select>
          <Button className="cg-wide" disabled={sending || !sample} onClick={sendSample}>Send sample</Button>
        </div>
      )}
    </div>
  );

  return (
    <Frame agency={view.agency}>
      {done ?? (
        <>
          <section className="cg-ask">
            <p className="cg-hi">{t.hi(view.firstName)}</p>
            <p className="eyebrow">{t.needs}</p>
            <h1>{view.ask}</h1>
          </section>

          {view.state === 'question' && view.question ? (
            <section className="card cg-card">
              <p className="cg-q">{t.missing(view.question.name)}</p>
              <form className="cg-answer" onSubmit={sendAnswer}>
                <label htmlFor="cg-answer">{t.answerLabel(view.question.name)}</label>
                <input
                  id="cg-answer"
                  className="input"
                  inputMode={view.question.kind === 'number' ? 'decimal' : 'text'}
                  placeholder={t.placeholder[view.question.kind]}
                  value={answer}
                  onChange={(e) => setAnswer(e.target.value)}
                  disabled={sending}
                  autoComplete="off"
                />
                <Button type="submit" variant="primary" className="cg-wide" disabled={sending || !answer.trim()}>{t.send}</Button>
              </form>
              <p className="cg-or">{t.orPhoto}</p>
              {uploader}
            </section>
          ) : (
            <section className="card cg-card">
              <p className="muted">{t.how}</p>
              {uploader}
            </section>
          )}

          {sending && <p className="cg-status" role="status">{t.sending}</p>}
          {error && <p className="cg-error" role="alert">{error}</p>}
          <p className="cg-privacy small muted">{t.privacy}</p>
        </>
      )}
    </Frame>
  );
}

function Frame({ agency, children }: { agency?: string; children: React.ReactNode }) {
  return (
    <main className="cg-page">
      {agency && <header className="cg-head">{agency}</header>}
      {children}
      <footer className="cg-foot small muted">PaperEase</footer>
    </main>
  );
}

function Done({ tone, title, body }: { tone: 'pine' | 'attention' | 'muted'; title: string; body: string }) {
  return (
    <section className={`cg-done cg-done-${tone}`} role="status">
      <span className="cg-done-mark" aria-hidden="true"><Icon name={tone === 'pine' ? 'check' : tone === 'attention' ? 'clock' : 'empty'} size={28} /></span>
      <h1>{title}</h1>
      <p className="muted">{body}</p>
    </section>
  );
}
