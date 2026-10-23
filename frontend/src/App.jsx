import { useState } from 'react';
import { NavRail } from './components/NavRail';
import { ToastProvider } from './components/Toast';
import { HistoryView } from './views/HistoryView';
import { LayoutsView } from './views/LayoutsView';
import { ModelsView } from './views/ModelsView';
import { SessionView } from './views/SessionView';

function readStored(key, fallback) {
  try {
    return localStorage.getItem(key) ?? fallback;
  } catch {
    return fallback;
  }
}

function writeStored(key, value) {
  try {
    if (value == null) localStorage.removeItem(key);
    else localStorage.setItem(key, value);
  } catch {
    // storage unavailable (private mode); the app still works without it
  }
}

export default function App() {
  const [view, setView] = useState(() => readStored('roboware.view', 'session'));
  const [sessionId, setSessionId] = useState(() => readStored('roboware.session', null));

  const go = (next) => {
    setView(next);
    writeStored('roboware.view', next);
  };
  const changeSession = (id) => {
    setSessionId(id);
    writeStored('roboware.session', id);
  };

  return (
    <ToastProvider>
      <div className="app-shell">
        <NavRail view={view} onChange={go} />
        <main className="app-main">
          {view === 'session' && <SessionView sessionId={sessionId} onSessionChange={changeSession} />}
          {view === 'models' && <ModelsView />}
          {view === 'layouts' && <LayoutsView />}
          {view === 'history' && (
            <HistoryView onOpenSession={(id) => { changeSession(id); go('session'); }} />
          )}
        </main>
      </div>
    </ToastProvider>
  );
}
