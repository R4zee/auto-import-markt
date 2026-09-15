import type { Listing } from '../api';
import { useApp } from '../context';
import { countdown, km, local, title } from '../format';
import { Flag } from './Flag';
import { Photo } from './Photo';

export function chipsFor(car: Listing, t: (k: string, v?: Record<string, string | number>) => string): string[] {
  const chips: string[] = [];
  if (car.auction?.grade) chips.push(t('chSheet', { g: car.auction.grade }));
  if (car.auction) chips.push(`${car.auction.house} · ${car.auction.lot}`);
  chips.push(car.coc ? t('chCocYes') : t('chCocNo'));
  if (car.classic) chips.push(t('chClassic'));
  return chips;
}

export function CarCard({ car }: { car: Listing }) {
  const { t, money, now, saved, compare, toggleSaved, toggleCompare, navigate, pro, dest, marketLabel } = useApp();
  const isSaved = saved.includes(car.id);
  const isAuction = car.offerType === 'auction' && car.auction;
  const sourceMain = money(car.landed.fobEur);
  const sourceSub = car.currency === 'EUR' && sourceMain === local(car) ? '' : local(car);
  const margin = car.resaleEur != null ? car.resaleEur - car.landed.totalEur : null;
  const name = title(car);

  return (
    <article className="card elev-sm aim-fade-in" style={{ padding: 0, overflow: 'visible', gap: 0, position: 'relative', height: '100%' }}>
      <div style={{ position: 'relative', aspectRatio: '16/9', background: 'var(--color-neutral-900)', borderRadius: 'var(--radius-md) var(--radius-md) 0 0', overflow: 'hidden' }}>
        <Photo src={car.photos[0]} alt={name} hint={name} />
        <div style={{ position: 'absolute', top: 10, left: 10, display: 'flex', gap: 6, pointerEvents: 'none' }}>
          <span className="tag" style={{ background: 'rgba(22,24,38,0.82)', color: 'var(--color-neutral-200)', fontSize: 10.5, padding: '3px 8px', display: 'flex', alignItems: 'center', gap: 6 }}>
            <Flag code={car.country} small />
            {marketLabel(car.market)}
          </span>
        </div>
        <button className="aim-card-photo-btn" onClick={() => toggleSaved(car.id)} aria-label={isSaved ? t('saved') : t('save')} aria-pressed={isSaved}>
          <i className={isSaved ? 'ph-fill ph-heart' : 'ph ph-heart'} style={{ fontSize: 16, color: isSaved ? 'var(--color-accent)' : 'var(--color-neutral-300)' }} />
        </button>
        <div style={{ position: 'absolute', bottom: 10, left: 10, pointerEvents: 'none' }}>
          {isAuction ? (
            <span className="tag tabular" style={{ background: 'var(--color-accent-800)', color: 'var(--color-accent-100)', fontSize: 11, padding: '4px 9px', display: 'flex', alignItems: 'center', gap: 6 }}>
              <i className="ph-fill ph-gavel" style={{ fontSize: 12 }} />{countdown(car.auction!.endsAt, now, t('ended'))}
            </span>
          ) : (
            <span className="tag" style={{ background: 'rgba(22,24,38,0.82)', color: 'var(--color-neutral-200)', fontSize: 11, padding: '4px 9px', display: 'flex', alignItems: 'center', gap: 6 }}>
              <i className="ph ph-tag" style={{ fontSize: 12 }} />{t('fixedPrice')}
            </span>
          )}
        </div>
      </div>

      <div style={{ padding: '13px 14px 14px', display: 'flex', flexDirection: 'column', gap: 9, flex: 1 }}>
        <div>
          <div style={{ display: 'flex', alignItems: 'baseline', gap: 7 }}>
            <span style={{ fontFamily: 'var(--font-heading)', fontSize: 16, lineHeight: 1.2 }}>{name}</span>
          </div>
          <div style={{ fontSize: 12.5, color: 'var(--color-neutral-400)', marginTop: 3 }}>{car.trim}</div>
        </div>

        <div className="tabular" style={{ display: 'flex', flexWrap: 'wrap', columnGap: 9, rowGap: 4, fontSize: 12, color: 'var(--color-neutral-300)' }}>
          <span>{km(car.km)}</span>
          <span style={{ color: 'var(--color-neutral-700)' }}>/</span>
          <span>{car.engine}</span>
          <span style={{ color: 'var(--color-neutral-700)' }}>/</span>
          <span>{t(car.transmission)}</span>
          <span style={{ color: 'var(--color-neutral-700)' }}>/</span>
          <span>{car.drive}</span>
        </div>

        <div style={{ display: 'flex', gap: 5, flexWrap: 'wrap' }}>
          {chipsFor(car, t).map((c) => (
            <span key={c} className="tag" style={{ background: 'var(--color-neutral-900)', color: 'var(--color-neutral-300)', fontSize: 10.5, padding: '2px 8px' }}>{c}</span>
          ))}
        </div>

        <div style={{ height: 1, background: 'var(--color-divider)', marginTop: 'auto' }} />

        <div style={{ display: 'flex', alignItems: 'flex-end', justifyContent: 'space-between', gap: 10, position: 'relative', paddingTop: 9 }}>
          <div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
              <span className="tabular" style={{ fontFamily: 'var(--font-heading)', fontSize: 21, letterSpacing: '-0.02em' }}>{sourceMain}</span>
            </div>
            <div className="tabular" style={{ fontSize: 11.5, color: 'var(--color-neutral-400)', marginTop: 2 }}>{sourceSub}</div>
            {car.reference && (
              <div
                className="tabular aim-ref"
                title={t('refTooltip', { n: car.reference.count, kmTo: car.reference.kmTo.toLocaleString('de-DE'), years: `${car.reference.generation ? car.reference.generation + ' ' : ''}${car.reference.yearFrom}–${car.reference.yearTo}`, landed: money(car.landed.totalEur) })}
              >
                <span className="aim-ref-label">{t('refDeFrom', { price: money(car.reference.minEur) })}</span>
                <span className={car.reference.diffPct <= 0 ? 'aim-ref-diff aim-ref-good' : 'aim-ref-diff aim-ref-bad'}>
                  {(car.reference.diffPct > 0 ? '+' : '−') + Math.abs(car.reference.diffPct).toLocaleString('de-DE', { maximumFractionDigits: 0 })} %
                </span>
              </div>
            )}
          </div>
          <button className="btn btn-primary" style={{ height: 32, fontSize: 12.5 }} onClick={() => navigate({ view: 'detail', id: car.id })}>
            {t('details')}<i className="ph ph-arrow-right" style={{ fontSize: 13 }} />
          </button>
        </div>

        {pro && (
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 10, padding: '8px 10px', borderRadius: 'var(--radius-sm)', background: 'var(--color-neutral-900)' }}>
            <label style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 11.5, color: 'var(--color-neutral-300)', cursor: 'pointer' }}>
              <input type="checkbox" checked={compare.includes(car.id)} onChange={() => toggleCompare(car.id)} style={{ accentColor: 'var(--color-accent)', width: 14, height: 14 }} />
              {t('navCompare')}
            </label>
            {margin != null && (
              <div className="tabular" style={{ fontSize: 11.5, color: 'var(--color-neutral-400)' }}>
                {t('retail', { dest, price: money(car.resaleEur!) })} · <span style={{ color: margin >= 0 ? 'var(--color-accent-300)' : 'var(--color-neutral-400)' }}>{(margin >= 0 ? '+' : '−') + money(Math.abs(margin))}</span>
              </div>
            )}
          </div>
        )}
      </div>
    </article>
  );
}
