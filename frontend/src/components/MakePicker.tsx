import { useEffect, useMemo, useRef, useState } from 'react';
import { useApp } from '../context';

/** Häufig gesuchte Marken – stehen im Markenfilter oben, sofern sie im Bestand vorkommen; der Rest folgt alphabetisch. */
export const POPULAR_MAKES = [
  'Mercedes-Benz', 'BMW', 'Audi', 'Porsche', 'Volkswagen', 'Toyota', 'Lexus', 'Hyundai', 'Kia', 'Genesis',
  'Land Rover', 'Tesla', 'Ford', 'Chevrolet', 'Dodge', 'Jeep', 'Nissan', 'Honda', 'Mazda', 'Volvo',
];

/** Marken aufteilen: beliebte in fester Reihenfolge, übrige alphabetisch; optional auf einen Suchtext gefiltert. */
export function splitMakes(makes: string[], filter: string): { popular: string[]; others: string[] } {
  const q = filter.trim().toLowerCase();
  const present = new Set(makes);
  const match = (m: string) => !q || m.toLowerCase().includes(q);
  const popular = POPULAR_MAKES.filter((m) => present.has(m) && match(m));
  const popularSet = new Set(popular);
  const others = makes.filter((m) => !popularSet.has(m) && !POPULAR_MAKES.includes(m) && match(m)).sort((a, b) => a.localeCompare(b));
  return { popular, others };
}

interface Props {
  value: string;
  makes: string[];
  onChange: (make: string) => void;
}

/** Markenfilter mit Suchfeld: Eingabe filtert die Liste, beliebte Marken stehen oben. */
export function MakePicker({ value, makes, onChange }: Props) {
  const { t } = useApp();
  const [open, setOpen] = useState(false);
  const [text, setText] = useState('');
  const root = useRef<HTMLDivElement>(null);
  const { popular, others } = useMemo(() => splitMakes(makes, text), [makes, text]);
  const all = [...popular, ...others];

  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => { if (root.current && !root.current.contains(e.target as Node)) { setOpen(false); setText(''); } };
    document.addEventListener('mousedown', onDown);
    return () => document.removeEventListener('mousedown', onDown);
  }, [open]);

  const pick = (m: string) => { onChange(m); setOpen(false); setText(''); };

  return (
    <div ref={root} className="aim-makepicker">
      <div style={{ position: 'relative' }}>
        <i className="ph ph-magnifying-glass" style={{ position: 'absolute', left: 9, top: '50%', transform: 'translateY(-50%)', fontSize: 13, color: 'var(--color-neutral-500)', pointerEvents: 'none' }} />
        <input
          className="input"
          value={open ? text : value}
          placeholder={open ? t('searchMake') : t('allMakes')}
          onFocus={() => { setOpen(true); setText(''); }}
          onChange={(e) => { setText(e.target.value); setOpen(true); }}
          onKeyDown={(e) => {
            if (e.key === 'Escape') { setOpen(false); setText(''); (e.target as HTMLInputElement).blur(); }
            if (e.key === 'Enter' && all.length) { e.preventDefault(); pick(all[0]); (e.target as HTMLInputElement).blur(); }
          }}
          role="combobox"
          aria-expanded={open}
          aria-label={t('make')}
          style={{ minHeight: 32, fontSize: 12.5, paddingLeft: 28, paddingRight: value ? 28 : 10, width: '100%' }}
        />
        {value && !open && (
          <button type="button" className="aim-btn-plain" onClick={() => onChange('')} aria-label={t('reset')} style={{ position: 'absolute', right: 7, top: '50%', transform: 'translateY(-50%)', color: 'var(--color-neutral-400)', display: 'grid' }}>
            <i className="ph ph-x" style={{ fontSize: 13 }} />
          </button>
        )}
      </div>
      {open && (
        <div className="aim-makepicker-list elev-md" role="listbox">
          {!text && (
            <button type="button" role="option" aria-selected={!value} className={`aim-makepicker-item${!value ? ' is-active' : ''}`} onMouseDown={(e) => e.preventDefault()} onClick={() => pick('')}>
              {t('allMakes')}
            </button>
          )}
          {popular.length > 0 && <div className="aim-makepicker-group">{t('popularMakes')}</div>}
          {popular.map((m) => (
            <button key={m} type="button" role="option" aria-selected={m === value} className={`aim-makepicker-item${m === value ? ' is-active' : ''}`} onMouseDown={(e) => e.preventDefault()} onClick={() => pick(m)}>{m}</button>
          ))}
          {others.length > 0 && popular.length > 0 && <div className="aim-makepicker-group">{t('otherMakes')}</div>}
          {others.map((m) => (
            <button key={m} type="button" role="option" aria-selected={m === value} className={`aim-makepicker-item${m === value ? ' is-active' : ''}`} onMouseDown={(e) => e.preventDefault()} onClick={() => pick(m)}>{m}</button>
          ))}
          {!all.length && <div className="aim-makepicker-group">{t('noMakeMatch')}</div>}
        </div>
      )}
    </div>
  );
}
