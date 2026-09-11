import { useState } from 'react';
import type { DestCode } from '../api';
import { useApp } from '../context';
import type { DisplayCurrency } from '../format';
import type { Lang } from '../i18n';
import { DICT } from '../i18n';
import { Dialog } from './Dialog';
import { Flag } from './Flag';

interface Props {
  view: 'search' | 'detail' | 'watchlist' | 'compare';
  onLang: (l: Lang) => void;
  onDest: (d: DestCode) => void;
  onCcy: (c: DisplayCurrency) => void;
}

export function Header({ view, onLang, onDest, onCcy }: Props) {
  const { t, lang, dest, ccy, saved, compare, navigate, config } = useApp();
  const [signIn, setSignIn] = useState(false);
  const dests = config?.destinations ?? [];
  const destMeta = dests.find((d) => d.code === dest);

  return (
    <div className="aim-header">
      <div className="aim-wrap" style={{ display: 'flex', alignItems: 'center', flexWrap: 'wrap', columnGap: 28, rowGap: 10, padding: '12px 28px' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginRight: 8, cursor: 'pointer' }} onClick={() => navigate({ view: 'search' })}>
          <div style={{ width: 9, height: 22, background: 'var(--color-accent)', borderRadius: 2 }} />
          <div style={{ display: 'flex', flexDirection: 'column', lineHeight: 1 }}>
            <span style={{ fontFamily: 'var(--font-heading)', fontWeight: 500, fontSize: 17, letterSpacing: '-0.02em', whiteSpace: 'nowrap' }}>auto import markt</span>
          </div>
        </div>

        <nav style={{ display: 'flex', alignItems: 'center', gap: 22, fontSize: 13.5 }}>
          <span className="aim-nav-link" aria-current={view === 'search' ? 'page' : undefined} onClick={() => navigate({ view: 'search' })}>{t('navSearch')}</span>
          <span className="aim-nav-link" aria-current={view === 'watchlist' ? 'page' : undefined} onClick={() => navigate({ view: 'watchlist' })}>
            {t('navWatchlist')}
            <span className="tag tag-neutral" style={{ padding: '1px 7px', fontSize: 10 }}>{saved.length}</span>
          </span>
          <span className="aim-nav-link" aria-current={view === 'compare' ? 'page' : undefined} onClick={() => navigate({ view: 'compare' })}>
            {t('navCompare')}
            <span className="tag tag-neutral" style={{ padding: '1px 7px', fontSize: 10 }}>{compare.length}</span>
          </span>
        </nav>

        <div style={{ marginLeft: 'auto', display: 'flex', alignItems: 'center', flexWrap: 'wrap', gap: 10 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 7, border: '1px solid var(--color-divider)', borderRadius: 'var(--radius-md)', padding: '4px 6px 4px 9px' }}>
            <Flag code={lang === 'de' ? 'de' : 'gb'} />
            <select className="input aim-select-bare" value={lang} onChange={(e) => onLang(e.target.value as Lang)} aria-label="Language">
              {(Object.keys(DICT) as Lang[]).map((k) => <option key={k} value={k}>{DICT[k].langName}</option>)}
            </select>
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 7, border: '1px solid var(--color-divider)', borderRadius: 'var(--radius-md)', padding: '4px 6px 4px 9px' }}>
            <Flag code={destMeta?.flag ?? dest.toLowerCase()} />
            <select className="input aim-select-bare" value={dest} onChange={(e) => onDest(e.target.value as DestCode)} aria-label="Destination">
              {dests.map((d) => <option key={d.code} value={d.code}>{t('c' + d.code)} · {Math.round(d.vatRate * 100)}% {d.taxLabel}</option>)}
            </select>
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 6, border: '1px solid var(--color-divider)', borderRadius: 'var(--radius-md)', padding: '4px 6px 4px 10px' }}>
            <i className="ph ph-currency-eur" style={{ fontSize: 14, color: 'var(--color-accent)' }} />
            <select className="input aim-select-bare" value={ccy} onChange={(e) => onCcy(e.target.value as DisplayCurrency)} aria-label="Currency">
              {(['EUR', 'USD', 'GBP', 'CHF'] as DisplayCurrency[]).map((c) => <option key={c} value={c}>{c}</option>)}
            </select>
          </div>
          <button className="btn btn-primary" style={{ height: 34, whiteSpace: 'nowrap' }} onClick={() => setSignIn(true)}>
            <i className="ph ph-user-circle" style={{ fontSize: 15 }} />{t('signIn')}
          </button>
        </div>
      </div>

      {signIn && (
        <Dialog title={t('signInTitle')} onClose={() => setSignIn(false)} actions={<button className="btn btn-primary" onClick={() => setSignIn(false)}>{t('close')}</button>}>
          {t('signInBody')}
        </Dialog>
      )}
    </div>
  );
}
