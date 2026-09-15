import { useEffect, useState } from 'react';
import { api, type Listing, type Partner, type ReferencePrices } from '../api';
import { EnquiryForm, type EnquiryValues } from '../components/EnquiryForm';
import { Flag } from '../components/Flag';
import { LandedLines } from '../components/LandedLines';
import { Photo } from '../components/Photo';
import { useApp } from '../context';
import { countdown, km, local, title } from '../format';

function refSourceLabel(code: string): string {
  const c = code.toLowerCase();
  if (c.includes('mobile')) return 'mobile.de';
  if (c.includes('kleinanzeigen')) return 'Kleinanzeigen';
  if (c.includes('autoscout')) return 'AutoScout24';
  return code;
}

const PANELS = ['pFront', 'pBonnet', 'pFlWing', 'pFrWing', 'pLDoor', 'pRDoor', 'pQuarter', 'pTail'];
const THUMBS = ['thFront', 'thInterior', 'thEngine', 'thUnder'];

export function DetailView({ id }: { id: string }) {
  const { t, dest, destName, port, money, now, saved, toggleSaved, toggleCompare, compare, navigate, lang, marketLabel, config } = useApp();
  const [data, setData] = useState<{ listing: Listing; partner: Partner | null } | null>(null);
  const [state, setState] = useState<'loading' | 'ok' | 'error'>('loading');
  const [sent, setSent] = useState(false);
  const [heroIdx, setHeroIdx] = useState(0);
  const [ref, setRef] = useState<ReferencePrices | null | 'loading' | 'none'>('none');

  useEffect(() => {
    let cancelled = false;
    setState('loading'); setSent(false);
    setRef('none');
    api.listing(id, dest).then((d) => {
      if (cancelled) return;
      setData(d); setState('ok');
      if (d.referenceAvailable) {
        setRef('loading');
        api.reference(id, dest).then((r) => { if (!cancelled) setRef(r); }).catch(() => { if (!cancelled) setRef(null); });
      }
    }).catch(() => { if (!cancelled) setState('error'); });
    return () => { cancelled = true; };
  }, [id, dest]);

  if (state === 'error') {
    return (
      <div className="aim-wrap" style={{ padding: '70px 28px', textAlign: 'center', color: 'var(--color-neutral-500)' }}>
        <div style={{ fontSize: 15 }}>{t('loadError')}</div>
        <button className="btn btn-primary" style={{ marginTop: 14 }} onClick={() => navigate({ view: 'search' })}>{t('back')}</button>
      </div>
    );
  }
  if (!data) return <div className="aim-wrap" style={{ padding: '40px 28px', color: 'var(--color-neutral-500)' }}>{t('loading')}</div>;

  const { listing: sel, partner } = data;
  const name = title(sel);
  const isSaved = saved.includes(sel.id);
  const isAuction = !!sel.auction;
  const isEU = sel.landed.isEU;
  const marketMeta = config?.markets.find((m) => m.code === sel.market);
  const damage = sel.damage.length ? sel.damage : PANELS.map((p) => ({ panel: p, code: '' }));

  const specs: Array<[string, string]> = [
    [t('sYear'), String(sel.year)], [t('sMileage'), km(sel.km)],
    [t('sEngine'), sel.engine], [t('sTrans'), t(sel.transmission)],
    [t('sDrive'), sel.drive], [t('sFuel'), t(sel.fuel)],
    [t('sSteering'), t('vLhd')], [t('sMarket'), marketLabel(sel.market)],
    [t('sEmissions'), sel.fuel === 'Electric' ? t('vZero') : sel.classic ? t('vPreEuro') : t('vEuro6')],
    [t('sOwners'), sel.year > 2019 ? '1' : '2'],
    [t('sTitle'), isAuction ? t('vCleanA') : t('vCleanD')],
    [t('sAvail'), isAuction ? t('vBidding') : t('vInStock')],
  ];
  if (sel.vehicleTax && dest === 'DE') specs.push([t('sTax'), `${money(sel.vehicleTax.annualEur)}${sel.vehicleTax.estimated ? ` · ${t('estimated')}` : ''}`]);

  const compliance = [
    { icon: sel.coc ? 'ph-fill ph-check-circle' : 'ph ph-warning-circle', color: sel.coc ? 'var(--color-accent-300)' : 'var(--color-neutral-400)', title: sel.coc ? t('cocYes') : t('cocNo'), note: sel.coc ? t('cocYesNote') : t('cocNoNote') },
    { icon: 'ph-fill ph-steering-wheel', color: 'var(--color-accent-300)', title: t('lhdOk'), note: t('lhdOkNote') },
    { icon: 'ph ph-file-text', color: 'var(--color-neutral-400)', title: isEU ? t('intraEU') : t('customs'), note: isEU ? t('intraEUNote') : t('customsNote', { port }) },
    { icon: 'ph ph-gauge', color: 'var(--color-neutral-400)', title: t('kmOk'), note: isEU ? t('kmOkE') : t('kmOkA') },
  ];

  const initialMessage = t('msgTpl', { car: name, lot: sel.auction ? ` (${t('lot')} ${sel.auction.lot})` : '' });
  const submit = async (v: EnquiryValues) => {
    await api.enquiry({ listingId: sel.id, dest, lang, ...v });
    setSent(true);
  };

  const hammer = (v: number | null) => (v == null ? '—' : money(v * sel.landed.fxRate));
  const photos = sel.photos;

  return (
    <div className="aim-wrap aim-fade-in" style={{ padding: '22px 28px' }}>
      <button className="btn btn-ghost" style={{ fontSize: 13, marginBottom: 14 }} onClick={() => navigate({ view: 'search' })}><i className="ph ph-arrow-left" style={{ fontSize: 14 }} />{t('back')}</button>

      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 32, alignItems: 'flex-start' }}>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 26, flex: '999 1 56%', minWidth: 330 }}>
          <div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 8, flexWrap: 'wrap' }}>
              <span className="tag tag-outline" style={{ fontSize: 10.5, letterSpacing: '0.04em', display: 'flex', alignItems: 'center', gap: 6 }}>
                <Flag code={sel.country} small />{marketLabel(sel.market)}
              </span>
              <span className="tag" style={{ background: 'var(--color-neutral-900)', color: 'var(--color-neutral-300)', fontSize: 10.5 }}>{isAuction ? t('auctionLot') : t('fixedPrice')}</span>
              <span className="tag" style={{ background: 'var(--color-neutral-900)', color: 'var(--color-neutral-300)', fontSize: 10.5 }}>LHD</span>
            </div>
            <h2 style={{ fontSize: 34, margin: 0 }}>{name}</h2>
            <div style={{ fontSize: 15, color: 'var(--color-neutral-400)', marginTop: 4 }}>{sel.trim} · {km(sel.km)} · {sel.engine}</div>
          </div>

          <div style={{ display: 'grid', gridTemplateColumns: 'minmax(0,1fr) minmax(104px,132px)', gap: 10 }}>
            <div style={{ position: 'relative', aspectRatio: '16/10', background: 'var(--color-neutral-900)', borderRadius: 'var(--radius-md)', overflow: 'hidden' }}>
              <Photo src={photos[heroIdx]} alt={name} hint={photos.length ? name : t('photoHint')} />
            </div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
              {THUMBS.map((hint, i) => (
                <div key={hint} onClick={() => photos[i + 1] && setHeroIdx(i + 1)} style={{ position: 'relative', aspectRatio: '4/3', background: 'var(--color-neutral-900)', borderRadius: 'var(--radius-sm)', overflow: 'hidden', cursor: photos[i + 1] ? 'pointer' : 'default', outline: heroIdx === i + 1 ? '1px solid var(--color-accent)' : undefined }}>
                  <Photo src={photos[i + 1]} alt={t(hint)} hint={t(hint)} />
                </div>
              ))}
            </div>
          </div>

          <div>
            <h6 style={{ color: 'var(--color-neutral-500)', marginBottom: 10 }}>{t('vehicleData')}</h6>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', gap: 1, background: 'var(--color-divider)', borderRadius: 'var(--radius-md)', overflow: 'hidden' }}>
              {specs.map(([k, v]) => (
                <div key={k} style={{ background: 'var(--color-bg)', padding: '10px 12px' }}>
                  <div style={{ fontSize: 10.5, letterSpacing: '0.06em', textTransform: 'uppercase', color: 'var(--color-neutral-600)' }}>{k}</div>
                  <div className="tabular" style={{ fontSize: 14, marginTop: 2 }}>{v}</div>
                </div>
              ))}
            </div>
          </div>

          {isAuction && sel.auction && (
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(290px, 1fr))', gap: 20 }}>
              <div className="card elev-sm" style={{ padding: 16, gap: 12 }}>
                <div className="card-kicker">{t('auctionSheet')}</div>
                <div style={{ display: 'flex', alignItems: 'flex-end', gap: 14 }}>
                  <div>
                    <div style={{ fontFamily: 'var(--font-heading)', fontSize: 38, lineHeight: 1, color: 'var(--color-accent-300)', whiteSpace: 'nowrap' }}>{sel.auction.grade ?? '—'}</div>
                    <div style={{ fontSize: 11, color: 'var(--color-neutral-500)', marginTop: 4 }}>{t('extInt')}</div>
                  </div>
                  <div style={{ fontSize: 12.5, color: 'var(--color-neutral-300)', lineHeight: 1.5 }}>{sel.auction.gradeNote}</div>
                </div>
                <div style={{ height: 1, background: 'var(--color-divider)' }} />
                <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 12.5 }}><span style={{ color: 'var(--color-neutral-500)' }}>{t('house')}</span><span>{sel.auction.house}</span></div>
                <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 12.5 }}><span style={{ color: 'var(--color-neutral-500)' }}>{t('lot')}</span><span className="tabular">{sel.auction.lot}</span></div>
                <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 12.5 }}><span style={{ color: 'var(--color-neutral-500)' }}>{t('closesIn')}</span><span className="tabular" style={{ color: 'var(--color-accent-300)' }}>{countdown(sel.auction.endsAt, now, t('ended'))}</span></div>
                <div style={{ height: 1, background: 'var(--color-divider)' }} />
                <div>
                  <div style={{ fontSize: 11, color: 'var(--color-neutral-500)', marginBottom: 6 }}>{t('hammerRange')}</div>
                  <div style={{ position: 'relative', height: 6, borderRadius: 3, background: 'var(--color-neutral-900)' }}>
                    <div style={{ position: 'absolute', left: '22%', right: '26%', top: 0, bottom: 0, borderRadius: 3, background: 'var(--color-accent-600)' }} />
                  </div>
                  <div className="tabular" style={{ display: 'flex', justifyContent: 'space-between', fontSize: 12, marginTop: 6 }}>
                    <span>{hammer(sel.auction.hammerLow)}</span><span style={{ color: 'var(--color-neutral-500)' }}>{t('mostLikely')}</span><span>{hammer(sel.auction.hammerHigh)}</span>
                  </div>
                </div>
              </div>

              <div className="card elev-sm" style={{ padding: 16, gap: 12 }}>
                <div className="card-kicker">{t('conditionMap')}</div>
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(148px, 1fr))', gap: 1, background: 'var(--color-divider)', borderRadius: 'var(--radius-sm)', overflow: 'hidden' }}>
                  {damage.map((d) => (
                    <div key={d.panel} style={{ background: 'var(--color-surface)', padding: '8px 10px', display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8, minWidth: 0 }}>
                      <span style={{ fontSize: 12, color: 'var(--color-neutral-300)', minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{t(d.panel)}</span>
                      <span className="tag" style={{ background: d.code ? 'var(--color-accent-800)' : 'var(--color-neutral-900)', color: d.code ? 'var(--color-accent-100)' : 'var(--color-neutral-500)', fontSize: 10, padding: '1px 7px', flex: 'none', whiteSpace: 'nowrap' }}>{d.code || t('pClean')}</span>
                    </div>
                  ))}
                </div>
                <div style={{ fontSize: 11, color: 'var(--color-neutral-600)', lineHeight: 1.5 }}>{t('damageLegend', { n: sel.photoCount })}</div>
              </div>
            </div>
          )}

          <div>
            <h6 style={{ color: 'var(--color-neutral-500)', marginBottom: 10 }}>{t('importCompliance')}</h6>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
              {compliance.map((c) => (
                <div key={c.title} style={{ display: 'flex', alignItems: 'flex-start', gap: 10, padding: '11px 13px', borderRadius: 'var(--radius-md)', background: 'var(--color-surface)' }}>
                  <i className={c.icon} style={{ fontSize: 16, color: c.color, marginTop: 1 }} />
                  <div>
                    <div style={{ fontSize: 13.5 }}>{c.title}</div>
                    <div style={{ fontSize: 12, color: 'var(--color-neutral-500)', marginTop: 2 }}>{c.note}</div>
                  </div>
                </div>
              ))}
              {!isEU && !sel.originProof && marketMeta?.preferentialNote && (
                <div style={{ display: 'flex', alignItems: 'flex-start', gap: 10, padding: '11px 13px', borderRadius: 'var(--radius-md)', background: 'var(--color-surface)' }}>
                  <i className="ph ph-seal-percent" style={{ fontSize: 16, color: 'var(--color-neutral-400)', marginTop: 1 }} />
                  <div style={{ fontSize: 12, color: 'var(--color-neutral-500)' }}>{marketMeta.preferentialNote}</div>
                </div>
              )}
            </div>
          </div>
        </div>

        <div style={{ position: 'sticky', top: 88, display: 'flex', flexDirection: 'column', gap: 16, flex: '1 1 34%', minWidth: 286, maxWidth: 400 }}>
          <div className="card elev-md" style={{ padding: 18, gap: 12 }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline' }}>
              <span className="card-kicker">{t('landedTitle', { dest: destName })}</span>
            </div>
            <div className="tabular" style={{ fontFamily: 'var(--font-heading)', fontSize: 38, lineHeight: 1, letterSpacing: '-0.02em' }}>{money(sel.landed.totalEur)}</div>
            <div style={{ fontSize: 12, color: 'var(--color-neutral-500)', marginTop: -4 }}>{t('roadLegal', { price: local(sel) })}</div>
            <div style={{ height: 1, background: 'var(--color-divider)', margin: '4px 0' }} />
            <LandedLines landed={sel.landed} t={t} fmt={money} size={13} />
            <div style={{ height: 1, background: 'var(--color-divider)', margin: '4px 0' }} />
            <div className="tabular" style={{ display: 'flex', justifyContent: 'space-between', fontSize: 15 }}>
              <span>{t('totalLanded')}</span><span style={{ color: 'var(--color-accent-300)' }}>{money(sel.landed.totalEur)}</span>
            </div>
            <div style={{ fontSize: 11, color: 'var(--color-neutral-600)', lineHeight: 1.5, marginTop: 2 }}>{t(sel.landed.noteKey, sel.landed.noteVars)} {t('estimateNote')}</div>
            <div style={{ display: 'flex', gap: 8, marginTop: 6 }}>
              <button className="btn btn-secondary" style={{ flex: 1 }} onClick={() => toggleSaved(sel.id)}><i className={isSaved ? 'ph-fill ph-heart' : 'ph ph-heart'} style={{ fontSize: 14 }} />{isSaved ? t('saved') : t('save')}</button>
              <button className="btn btn-secondary" style={{ flex: 1, color: compare.includes(sel.id) ? 'var(--color-accent)' : undefined }} onClick={() => toggleCompare(sel.id)}><i className="ph ph-columns" style={{ fontSize: 14 }} />{t('navCompare')}</button>
            </div>
          </div>

          {ref !== 'none' && (
            <div className="card elev-sm" style={{ padding: 18, gap: 10 }}>
              <div className="card-kicker">{t('refTitle', { source: ref && ref !== 'loading' ? refSourceLabel(ref.source) : 'mobile.de' })}</div>
              {ref === 'loading' && <div style={{ fontSize: 12.5, color: 'var(--color-neutral-500)' }}>{t('refLoading')}</div>}
              {ref !== 'loading' && (!ref || ref.count === 0) && <div style={{ fontSize: 12.5, color: 'var(--color-neutral-500)' }}>{t('refNone')}</div>}
              {ref && ref !== 'loading' && ref.count > 0 && (
                <>
                  <div className="tabular" style={{ fontFamily: 'var(--font-heading)', fontSize: 28, lineHeight: 1, letterSpacing: '-0.02em' }}>{ref.medianEur != null ? money(ref.medianEur) : '—'}</div>
                  <div style={{ fontSize: 12, color: 'var(--color-neutral-500)', marginTop: -2 }}>{t('refMedian')} · {t('refLine', { n: ref.count, yearFrom: ref.yearFrom, yearTo: ref.yearTo })}</div>
                  <div style={{ height: 1, background: 'var(--color-divider)' }} />
                  <div className="tabular" style={{ display: 'flex', justifyContent: 'space-between', fontSize: 13 }}><span style={{ color: 'var(--color-neutral-400)' }}>{t('refRange')}</span><span>{ref.minEur != null && ref.maxEur != null ? `${money(ref.minEur)} – ${money(ref.maxEur)}` : '—'}</span></div>
                  {ref.medianKm != null && <div className="tabular" style={{ display: 'flex', justifyContent: 'space-between', fontSize: 13 }}><span style={{ color: 'var(--color-neutral-400)' }}>{t('refKm')}</span><span>{km(ref.medianKm)}</span></div>}
                  <div className="tabular" style={{ display: 'flex', justifyContent: 'space-between', fontSize: 13 }}><span style={{ color: 'var(--color-neutral-400)' }}>{t('totalLanded')}</span><span style={{ color: ref.medianEur != null && sel.landed.totalEur <= ref.medianEur ? 'var(--color-accent-300)' : 'var(--color-text)' }}>{money(sel.landed.totalEur)}</span></div>
                  <div style={{ fontSize: 11, color: 'var(--color-neutral-600)', lineHeight: 1.5 }}>{t('refNote')}</div>
                </>
              )}
            </div>
          )}

          <div className="card elev-sm" style={{ padding: 18, gap: 12 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 11 }}>
              <div style={{ width: 38, height: 38, borderRadius: 'var(--radius-sm)', background: 'var(--color-accent-900)', display: 'grid', placeItems: 'center' }}>
                <i className="ph ph-handshake" style={{ fontSize: 19, color: 'var(--color-accent-300)' }} />
              </div>
              <div>
                <div style={{ fontSize: 14.5 }}>{partner?.name ?? '—'}</div>
                <div style={{ fontSize: 11.5, color: 'var(--color-neutral-500)' }}>{t('partnerImporter', { note: partner?.note ?? '' })}</div>
              </div>
            </div>

            {sent ? (
              <div className="aim-fade-in" style={{ padding: 14, borderRadius: 'var(--radius-md)', background: 'var(--color-accent-900)', display: 'flex', gap: 10, alignItems: 'flex-start' }}>
                <i className="ph-fill ph-check-circle" style={{ fontSize: 18, color: 'var(--color-accent-300)' }} />
                <div style={{ fontSize: 12.5, color: 'var(--color-accent-100)', lineHeight: 1.5 }}>{t('sentMsg', { partner: partner?.name ?? '' })}</div>
              </div>
            ) : (
              <EnquiryForm key={sel.id} initialMessage={initialMessage} bidLabel={isAuction ? t('bidForMe') : t('negotiate')} onSubmit={submit} />
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
