import { useState, type FormEvent } from 'react';
import { useApp } from '../context';

export interface EnquiryValues {
  name: string; email: string; phone: string; message: string; optInspection: boolean; optBid: boolean;
}

interface Props {
  initialMessage: string;
  bidLabel: string;
  onSubmit: (v: EnquiryValues) => Promise<void>;
}

export function EnquiryForm({ initialMessage, bidLabel, onSubmit }: Props) {
  const { t } = useApp();
  const [v, setV] = useState<EnquiryValues>({ name: '', email: '', phone: '', message: initialMessage, optInspection: true, optBid: false });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(false);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setBusy(true); setError(false);
    try { await onSubmit(v); } catch { setError(true); } finally { setBusy(false); }
  };

  return (
    <form onSubmit={submit} style={{ display: 'flex', flexDirection: 'column', gap: 9 }}>
      <div className="field"><label>{t('name')}</label><input className="input" required minLength={2} value={v.name} onChange={(e) => setV({ ...v, name: e.target.value })} placeholder={t('yourName')} /></div>
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 9 }}>
        <div className="field"><label>{t('email')}</label><input className="input" type="email" required value={v.email} onChange={(e) => setV({ ...v, email: e.target.value })} placeholder="name@firma.de" /></div>
        <div className="field"><label>{t('phone')}</label><input className="input" value={v.phone} onChange={(e) => setV({ ...v, phone: e.target.value })} placeholder="+49" /></div>
      </div>
      <div className="field"><label>{t('message')}</label><textarea className="input" value={v.message} onChange={(e) => setV({ ...v, message: e.target.value })} style={{ minHeight: 74, fontSize: 13 }} /></div>
      <label style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 12.5, cursor: 'pointer' }}>
        <input type="checkbox" checked={v.optInspection} onChange={(e) => setV({ ...v, optInspection: e.target.checked })} style={{ accentColor: 'var(--color-accent)', width: 14, height: 14 }} />
        {t('reqInspection')}
      </label>
      <label style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 12.5, cursor: 'pointer' }}>
        <input type="checkbox" checked={v.optBid} onChange={(e) => setV({ ...v, optBid: e.target.checked })} style={{ accentColor: 'var(--color-accent)', width: 14, height: 14 }} />
        {bidLabel}
      </label>
      {error && <div style={{ fontSize: 12, color: 'var(--color-accent-300)' }}>{t('sendError')}</div>}
      <button className="btn btn-primary btn-block" style={{ height: 40 }} disabled={busy} type="submit">
        <i className="ph ph-paper-plane-tilt" style={{ fontSize: 15 }} />{busy ? t('sending') : t('sendEnquiry')}
      </button>
      <div style={{ fontSize: 10.5, color: 'var(--color-neutral-600)', lineHeight: 1.5 }}>{t('formNote')}</div>
    </form>
  );
}
