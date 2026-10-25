import { useCallback, useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import { ToastContext } from './toastContext';

export function ToastProvider({ children }) {
  const [toasts, setToasts] = useState([]);
  const [target, setTarget] = useState(() => document.body);
  useEffect(() => {
    const changed = () => setTarget(document.fullscreenElement ?? document.body);
    document.addEventListener('fullscreenchange', changed);
    return () => document.removeEventListener('fullscreenchange', changed);
  }, []);
  const push = useCallback((message, tone = 'error') => {
    const id = `${Date.now()}-${Math.random()}`;
    setToasts((list) => [...list, { id, message, tone }]);
    setTimeout(() => setToasts((list) => list.filter((t) => t.id !== id)), 4500);
  }, []);
  return (
    <ToastContext.Provider value={push}>
      {children}
      {createPortal(<div className="toast-stack" role="status" aria-live="polite">
        {toasts.map((t) => (
          <div key={t.id} className={`toast toast-${t.tone} clay-card`}>{t.message}</div>
        ))}
      </div>, target)}
    </ToastContext.Provider>
  );
}
