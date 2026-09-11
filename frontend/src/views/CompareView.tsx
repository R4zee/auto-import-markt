import type { Listing, Partner } from '../api';
import { useApp } from '../context';
import { countdown, km, local, title } from '../format';

export function CompareView({ cars, partners }: { cars: Listing[]; partners: Record<string, Partner> }) {
  const { t, destName, money, now, navigate, marketLabel } = useApp();

  const dutyTax = (d: Listing) => {
    const duty = d.landed.lines.find((l) => l.key === 'lDuty' || l.key === 'lDutyEU');
    const tax = d.landed.lines.find((l) => l.key === 'lTax' || l.key === 'lVatEU');
    const f = (v: number | null | undefined) => (v == null ? '—' : money(v));
    return `${f(duty?.amountEur)} + ${f(tax?.amountEur)}`;
  };

  const rows: Array<[string, (d: Listing) => string]> = [
    [t('thVehicle'), (d) => title(d)], [t('rTrim'), (d) => d.trim], [t('thMarket'), (d) => marketLabel(d.market)],
    [t('thOffer'), (d) => d.auction ? `${t('auction')} · ${countdown(d.auction.endsAt, now, t('ended'))}` : t('fixedPrice')],
    [t('thMileage'), (d) => km(d.km)], [t('sEngine'), (d) => d.engine], [t('sDrive'), (d) => d.drive],
    [t('rSourcePrice'), (d) => local(d)], [t('rLandedPrice'), (d) => money(d.landed.totalEur)],
    [t('rDutyTax'), dutyTax],
    [t('rCoc'), (d) => d.coc ? t('rAvail') : t('rOnReq')],
    [t('rPartner'), (d) => partners[d.partnerId]?.name ?? '—'],
  ];

  return (
    <div className="aim-wrap aim-fade-in" style={{ padding: '26px 28px' }}>
      <h2 style={{ margin: '0 0 6px' }}>{t('navCompare')}</h2>
      <p style={{ fontSize: 13, color: 'var(--color-neutral-500)' }}>{t('cmpIntro', { dest: destName })}</p>
      {cars.length > 0 ? (
        <div style={{ overflowX: 'auto', marginTop: 18 }}>
          <div style={{ display: 'grid', gridTemplateColumns: `190px repeat(${cars.length}, minmax(230px, 1fr))`, gap: 1, background: 'var(--color-divider)', borderRadius: 'var(--radius-md)', overflow: 'hidden', minWidth: 640 }}>
            {rows.map(([label, fn]) => (
              <RowGroup key={label} label={label} cells={cars.map(fn)} highlight={label === t('rLandedPrice')} large={label === t('thVehicle') || label === t('rLandedPrice')} />
            ))}
          </div>
        </div>
      ) : (
        <div style={{ padding: '70px 20px', textAlign: 'center', color: 'var(--color-neutral-500)' }}>
          <i className="ph ph-columns" style={{ fontSize: 34, display: 'block', marginBottom: 12 }} />
          <div style={{ fontSize: 15 }}>{t('cmpEmpty')}</div>
          <button className="btn btn-primary" style={{ marginTop: 14 }} onClick={() => navigate({ view: 'search' })}>{t('browse')}</button>
        </div>
      )}
    </div>
  );
}

function RowGroup({ label, cells, highlight, large }: { label: string; cells: string[]; highlight: boolean; large: boolean }) {
  return (
    <>
      <div style={{ background: 'var(--color-surface)', padding: '11px 13px' }}>
        <div style={{ fontSize: 12, color: 'var(--color-neutral-400)', lineHeight: 1.35 }}>{label}</div>
      </div>
      {cells.map((c, i) => (
        <div key={i} style={{ background: 'var(--color-bg)', padding: '11px 13px' }}>
          <div className="tabular" style={{ fontSize: large ? 15 : 13, color: highlight ? 'var(--color-accent-300)' : 'var(--color-text)', lineHeight: 1.35 }}>{c}</div>
        </div>
      ))}
    </>
  );
}
