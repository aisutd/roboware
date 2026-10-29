import { useEffect, useRef } from 'react';
import { PixelIcon } from './PixelIcon';

// Native dialogs provide focus containment, Escape, and focus restoration.
// pixel: the arcade look (pixel title and an X close button) used by the session screens.
export function Dialog({ open, onClose, title, children, className = '', pixel = false }) {
  const ref = useRef(null);
  useEffect(() => {
    const dialog = ref.current;
    if (open && !dialog.open) dialog.showModal();
    if (!open && dialog.open) dialog.close();
  }, [open]);
  return (
    <dialog ref={ref} className={`dialog-surface ${pixel ? 'px-dialog' : ''} ${className}`} aria-label={title} onCancel={onClose} onClose={onClose}>
      <div className="dialog-heading"><h2>{title}</h2>{pixel
        ? <button className="px-btn px-small px-icon-btn" type="button" onClick={onClose} aria-label={`Close ${title}`} title="Close (Esc)"><PixelIcon name="close" /></button>
        : <button className="clay-btn clay-pill-sm" type="button" onClick={onClose} aria-label={`Close ${title}`}>Close</button>}</div>
      {children}
    </dialog>
  );
}
