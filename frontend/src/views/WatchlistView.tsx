import { useState } from 'react';
import { api, type Listing } from '../api';
import { Dialog } from '../components/Dialog';
import { EnquiryForm, type EnquiryValues } from '../components/EnquiryForm';
import { Flag } from '../components/Flag';
import { useApp } from '../context';
import { countdown, km, local, title } from '../format';

export function WatchlistView({ cars }: { cars: Listing[] }) {
  const { t, destName, money, now, compare, toggleCompare, toggleSaved, navigate, pro, dest, lang, marketLabel } = useApp();
  const [bulkOpen, setBulkOpen] = useState(false);
  const [bulkSent, setBulkSent] = useState<number | null>(null);

  const exportCsv = () => {
    const rows = [[t('sYear'), 'Make', 'Model', t('rTrim'), t('thMarket'), t('thOffer'), t('thMileage') + ' km', t('thSource'), t('thLanded') + ' EUR']];
    cars.forEach((c) => rows.push([String(c.year), c.make, c.model, c.trim, marketLabel(c.market), c.offerType === 'auction' ? t('auctionLot') : t('fixedPrice'), String(c.km), `${c.price} ${c.currency}`, String(Math.round(c.landed.totalEur))]));
    const text = rows.map((r) => r.map((v) => '"' + String(v).replace(/"/g, '""') + '"').join(',')).join('\n');
    const a = document.createElement('a');
    a.href = URL.createObjectURL(new Blob([text], { type: 'text/csv' }));
    a.download = 'auto-import-markt-watchlist.csv';
    a.click();
  };

  const submitBulk = async (v: EnquiryValues) => {
    const r = await api.bulkEnquiry({ listingIds: cars.map((c) => c.id), dest, lang, ...v });
    setBulkSent(r.total);
    setBulkOpen(false);
  };

  return (
    <div className="aim-wrap aim-fade-in" style={{ padding: '26px 28px' }}>
      <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', gap: 16, flexWrap: 'wrap', marginBottom: 6 }}>
        <h2 style={{ margin: 0 }}>{t('navWatchlist')}</h2>
        {pro && cars.length > 0 && (
          <div style={{ display: 'flex', gap: 9 }}>
            <button className="btn btn-secondary" style={{ height: 34, fontSize: 13 }} onClick={exportCsv}><i className="ph ph-download-simple" style={{ fontSize: 14 }} />{t('exportCsv')}</button>
            <button className="btn btn-primary" style={{ height: 34, fontSize: 13 }} onClick={() => setBulkOpen(true)}><i className="ph ph-paper-plane-tilt" style={{ fontSize: 14 }} />{t('volumeEnquiry')}</button>
          </div>
        )}
      </div>
      <p style={{ fontSize: 13, color: 'var(--color-neutral-500)', maxWidth: 640 }}>{t('wlIntro', { dest: destName })}</p>

      {bulkSent != null && (
        <div style={{ padding: '13px 15px', borderRadius: 'var(--radius-md)', background: 'var(--color-accent-900)', color: 'var(--color-accent-100)', fontSize: 13, marginBottom: 14, display: 'flex', gap: 10, alignItems: 'center' }}>
          <i className="ph-fill ph-check-circle" style={{ fontSize: 18, color: 'var(--color-accent-300)' }} />
          {t('bulkMsg', { n: bulkSent })}
        </div>
      )}

      {cars.length > 0 ? (
        <div style={{ overflowX: 'auto' }}>
          <table className="table" style={{ marginTop: 14 }}>
            <thead>
              <tr>
                <th style={{ width: 38 }}></th>
                <th>{t('thVehicle')}</th><th>{t('thMarket')}</th><th>{t('thOffer')}</th><th>{t('thMileage')}</th>
                <th style={{ textAlign: 'right' }}>{t('thSource')}</th><th style={{ textAlign: 'right' }}>{t('thLanded')}</th><th></th>
              </tr>
            </thead>
            <tbody>
              {cars.map((car) => (
                <tr key={car.id}>
                  <td><input type="checkbox" checked={compare.includes(car.id)} onChange={() => toggleCompare(car.id)} style={{ accentColor: 'var(--color-accent)', width: 15, height: 15 }} aria-label={t('navCompare')} /></td>
                  <td>
                    <div style={{ fontSize: 14, cursor: 'pointer' }} onClick={() => navigate({ view: 'detail', id: car.id })}>{title(car)}</div>
                    <div style={{ fontSize: 11.5, color: 'var(--color-neutral-500)' }}>{car.trim}</div>
                  </td>
                  <td>
                    <span style={{ display: 'flex', alignItems: 'center', gap: 7, fontSize: 12.5, color: 'var(--color-neutral-300)' }}>
                      <Flag code={car.country} />{marketLabel(car.market)}
                    </span>
                  </td>
                  <td style={{ fontSize: 12.5 }}>
                    {car.auction ? <span className="tabular" style={{ color: 'var(--color-accent-300)' }}>{countdown(car.auction.endsAt, now, t('ended'))}</span> : <span style={{ color: 'var(--color-neutral-400)' }}>{t('fixedPrice')}</span>}
                  </td>
                  <td className="tabular" style={{ fontSize: 12.5 }}>{km(car.km)}</td>
                  <td className="tabular" style={{ textAlign: 'right', fontSize: 12.5, color: 'var(--color-neutral-400)' }}>{local(car)}</td>
                  <td className="tabular" style={{ textAlign: 'right', fontSize: 14 }}>{money(car.landed.totalEur)}</td>
                  <td style={{ textAlign: 'right' }}><button className="btn btn-ghost" style={{ fontSize: 12 }} onClick={() => toggleSaved(car.id)}>{t('remove')}</button></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : (
        <div style={{ padding: '70px 20px', textAlign: 'center', color: 'var(--color-neutral-500)' }}>
          <i className="ph ph-heart" style={{ fontSize: 34, display: 'block', marginBottom: 12 }} />
          <div style={{ fontSize: 15 }}>{t('nothingSaved')}</div>
          <button className="btn btn-primary" style={{ marginTop: 14 }} onClick={() => navigate({ view: 'search' })}>{t('browse')}</button>
        </div>
      )}

      {bulkOpen && (
        <Dialog title={t('bulkTitle')} onClose={() => setBulkOpen(false)}>
          <p style={{ fontSize: 13, color: 'var(--color-neutral-400)' }}>{t('bulkIntro', { n: cars.length })}</p>
          <EnquiryForm initialMessage="" bidLabel={t('negotiate')} onSubmit={submitBulk} />
        </Dialog>
      )}
    </div>
  );
}
