import { useState, type ReactNode } from 'react';
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

interface PickerProps {
  ariaLabel: string;
  value: string;
  options: Array<{ value: string; label: string }>;
  onChange: (v: string) => void;
  icon: ReactNode;
  /** Text, solange die Optionen noch nicht geladen sind */
  fallbackLabel?: string;
}

/** Auswahlkasten der Kopfzeile: sichtbar Symbol + Text + Pfeil, darüber das unsichtbare native <select> über die volle Fläche. */
function Picker({ ariaLabel, value, options, onChange, icon, fallbackLabel }: PickerProps) {
  const current = options.find((o) => o.value === value)?.label ?? fallbackLabel ?? value;
  return (
    <div className="aim-picker">
      {icon}
      <span>{current}</span>
      <i className="ph ph-caret-down" aria-hidden="true" />
      <select value={value} onChange={(e) => onChange(e.target.value)} aria-label={ariaLabel}>
        {options.length ? options.map((o) => <option key={o.value} value={o.value}>{o.label}</option>) : <option value={value}>{current}</option>}
      </select>
    </div>
  );
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
          <Picker
            ariaLabel={lang === 'de' ? 'Sprache' : 'Language'}
            value={lang}
            onChange={(v) => onLang(v as Lang)}
            options={(Object.keys(DICT) as Lang[]).map((k) => ({ value: k, label: DICT[k].langName }))}
            icon={<Flag code={lang === 'de' ? 'de' : 'gb'} />}
          />
          <Picker
            ariaLabel={lang === 'de' ? 'Zielland' : 'Destination'}
            value={dest}
            onChange={(v) => onDest(v as DestCode)}
            options={dests.map((d) => ({ value: d.code, label: `${t('c' + d.code)} · ${Math.round(d.vatRate * 100)}% ${d.taxLabel}` }))}
            fallbackLabel={t('c' + dest)}
            icon={<Flag code={destMeta?.flag ?? dest.toLowerCase()} />}
          />
          <Picker
            ariaLabel={lang === 'de' ? 'Währung' : 'Currency'}
            value={ccy}
            onChange={(v) => onCcy(v as DisplayCurrency)}
            options={(['EUR', 'USD', 'GBP', 'CHF'] as DisplayCurrency[]).map((c) => ({ value: c, label: c }))}
            icon={<i className="ph ph-currency-eur" style={{ fontSize: 14, color: 'var(--color-accent)' }} />}
          />
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
