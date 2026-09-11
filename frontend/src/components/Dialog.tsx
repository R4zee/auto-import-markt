import { useEffect, type ReactNode } from 'react';

export function Dialog({ title, children, actions, onClose }: { title: string; children: ReactNode; actions?: ReactNode; onClose: () => void }) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);
  return (
    <div className="dialog-backdrop" style={{ zIndex: 90 }} onClick={onClose} role="presentation">
      <div className="dialog aim-fade-in" role="dialog" aria-modal="true" aria-label={title} onClick={(e) => e.stopPropagation()}>
        <div className="dialog-title">{title}</div>
        <div className="dialog-body">{children}</div>
        {actions && <div className="dialog-actions">{actions}</div>}
      </div>
    </div>
  );
}
