import type { LandedCost } from '../api';
import type { T } from '../i18n';

export function LandedLines({ landed, t, fmt, size = 12 }: { landed: LandedCost; t: T; fmt: (eur: number) => string; size?: number }) {
  return (
    <>
      {landed.lines.map((l) => (
        <div key={l.key} className="tabular" style={{ display: 'flex', justifyContent: 'space-between', gap: 12, fontSize: size }}>
          <span style={{ color: 'var(--color-neutral-400)' }}>{t(l.key, l.vars)}</span>
          <span>{l.amountEur == null ? '—' : fmt(l.amountEur)}</span>
        </div>
      ))}
    </>
  );
}
