import type { Listing } from '../api';
import { useApp } from '../context';
import { title } from '../format';

export function CompareBar({ cars }: { cars: Listing[] }) {
  const { t, compare, clearCompare, navigate } = useApp();
  if (!compare.length) return null;
  return (
    <div className="aim-compare-bar">
      <div className="aim-wrap" style={{ padding: '12px 28px', display: 'flex', alignItems: 'center', gap: 16, flexWrap: 'wrap' }}>
        <span style={{ fontSize: 13, color: 'var(--color-neutral-300)' }}>{t('selected', { n: compare.length })}</span>
        <div style={{ display: 'flex', gap: 7, flexWrap: 'wrap' }}>
          {cars.map((c) => <span key={c.id} className="tag tag-neutral" style={{ fontSize: 11, gap: 6 }}>{title(c)}</span>)}
        </div>
        <div style={{ marginLeft: 'auto', display: 'flex', gap: 8 }}>
          <button className="btn btn-secondary" style={{ height: 32, fontSize: 12.5 }} onClick={clearCompare}>{t('clear')}</button>
          <button className="btn btn-primary" style={{ height: 32, fontSize: 12.5 }} onClick={() => navigate({ view: 'compare' })}>
            {t('compareSide')}<i className="ph ph-arrow-right" style={{ fontSize: 13 }} />
          </button>
        </div>
      </div>
    </div>
  );
}
