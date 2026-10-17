import type { PhotoCheck, PhotoCheckItem } from '@/lib/types';
import styles from './PhotoCheckCard.module.css';

const TITLES: Record<PhotoCheck['status'], string> = {
  ready: 'Ready for staff review',
  'needs-info': 'More information needed',
  'needs-review': 'Staff review needed',
  'not-checked': 'Not checked',
};

const SOURCES: Record<PhotoCheck['source'], string> = {
  claude: 'Claude analysis',
  sample: 'Demo result',
  none: 'Not analyzed',
};

const CHECK_STATES: Record<PhotoCheckItem['status'], { symbol: string; label: string }> = {
  pass: { symbol: '✓', label: 'Pass' },
  attention: { symbol: '!', label: 'Attention' },
  'not-checked': { symbol: '–', label: 'Not checked' },
};

export function PhotoCheckCard({ check }: { check: PhotoCheck }) {
  const attentionCount = check.checks.filter((item) => item.status === 'attention').length;
  const uncheckedCount = check.checks.filter((item) => item.status === 'not-checked').length;
  const summary = check.summary.replace(/^Demo result:\s*/i, '').trim();
  const normalize = (value: string) => value.toLowerCase().replace(/[^a-z0-9]/g, '');
  const duplicateSummary = [
    TITLES[check.status],
    'This photo needs staff review.',
    'More information is needed.',
    'Photo not checked.',
  ].some((value) => normalize(value) === normalize(summary));
  const checkSummary = uncheckedCount === check.checks.length && uncheckedCount > 0
    ? `${uncheckedCount} not checked`
    : `${attentionCount} need attention${uncheckedCount > 0 ? ` · ${uncheckedCount} not checked` : ''}`;

  return (
    <section className={styles.card} data-status={check.status} aria-label="Photo check result">
      <div className={styles.header}>
        <span className={styles.eyebrow}>Photo check</span>
        <span className={styles.source} data-source={check.source}>{SOURCES[check.source]}</span>
      </div>
      <h3 className={styles.title}>{TITLES[check.status]}</h3>
      {summary && !duplicateSummary && <p className={styles.summary}>{summary}</p>}

      {check.source === 'sample' && (
        <p className={styles.sourceNote}>Sample data; no photo analysis.</p>
      )}

      <div className={styles.nextStep}>
        <strong>Next step</strong>
        <p>{check.nextStep}</p>
      </div>

      <details className={styles.details}>
        <summary>View {check.checks.length} checks · {checkSummary}</summary>
        <dl className={styles.documents}>
          <div>
            <dt>Expected document</dt>
            <dd>{check.requirementName || 'Not specified'}</dd>
          </div>
          <div>
            <dt>Detected document</dt>
            <dd>{check.documentType || 'Not determined'}</dd>
          </div>
        </dl>
        {check.checks.length > 0 && (
          <ul className={styles.checks} aria-label="Individual photo checks">
            {check.checks.map((item) => {
              const state = CHECK_STATES[item.status];
              return (
                <li key={item.id} className={styles.check} data-status={item.status}>
                  <span className={styles.checkSymbol} aria-hidden="true">{state.symbol}</span>
                  <div className={styles.checkBody}>
                    <div className={styles.checkHeading}>
                      <strong>{item.label}</strong>
                      <span className={styles.checkState}>{state.label}</span>
                    </div>
                    <p>{item.detail}</p>
                  </div>
                </li>
              );
            })}
          </ul>
        )}
      </details>
      <p className={styles.disclaimer}>Separate staff approval required.</p>
    </section>
  );
}
