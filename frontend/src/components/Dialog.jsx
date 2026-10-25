import { useEffect, useRef } from 'react';

// Native dialogs provide focus containment, Escape, and focus restoration.
export function Dialog({ open, onClose, title, children }) {
  const ref = useRef(null);
  useEffect(() => {
    const dialog = ref.current;
    if (open && !dialog.open) dialog.showModal();
    if (!open && dialog.open) dialog.close();
  }, [open]);
  return (
    <dialog ref={ref} className="dialog-surface" aria-label={title} onCancel={onClose} onClose={onClose}>
      <div className="dialog-heading"><h2>{title}</h2><button className="clay-btn clay-pill-sm" type="button" onClick={onClose} aria-label={`Close ${title}`}>Close</button></div>
      {children}
    </dialog>
  );
}
