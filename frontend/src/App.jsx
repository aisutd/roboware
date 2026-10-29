import { useEffect, useState } from 'react';
import { sound } from './lib/sound';
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

// Every button in the app makes a soft click (or the sound named in its data-sound attribute).
// The first press anywhere also unlocks audio, which browsers keep muted until the user interacts.
function useButtonSounds() {
  useEffect(() => {
    const unlock = () => sound.unlock();
    const click = (event) => {
      const button = event.target.closest?.('button, [role="button"], a.clay-btn');
      if (!button || button.disabled || button.getAttribute('aria-disabled') === 'true') return;
      sound.play(button.dataset.sound || 'click');
    };
    window.addEventListener('pointerdown', unlock, true);
    window.addEventListener('keydown', unlock, true);
    document.addEventListener('click', click, true);
    return () => {
      window.removeEventListener('pointerdown', unlock, true);
      window.removeEventListener('keydown', unlock, true);
      document.removeEventListener('click', click, true);
    };
  }, []);
}

export default function App() {
  useButtonSounds();
  const [view, setView] = useState(() => (['session', 'models', 'layouts', 'history'].includes(readStored('roboware.view', 'session')) ? readStored('roboware.view', 'session') : 'session'));
  const [layoutHandoff, setLayoutHandoff] = useState(null);
  const [sessionId, setSessionId] = useState(() => readStored('roboware.session', null));

  const go = (next) => {
    setLayoutHandoff(null);
    setView(next);
    writeStored('roboware.view', next);
  };
  const configure = (id, next, modelId = null, simulationDraft = null) => {
    go(next);
    setLayoutHandoff({ id, view: next, modelId, simulationDraft });
  };
  const changeSession = (id) => {
    setLayoutHandoff(null);
    setSessionId(id);
    writeStored('roboware.session', id);
  };

  return (
    <ToastProvider>
      <div className="app-shell">
        <a className="skip-link" href="#main-workspace">Skip to workspace</a>
        <NavRail view={view} onChange={go} />
        <main id="main-workspace" tabIndex={-1} className="app-main">
          {view === 'session' && <SessionView key={sessionId ?? 'empty'} sessionId={sessionId} onSessionChange={changeSession} onNavigate={go} initialLayoutId={layoutHandoff?.view === 'session' ? layoutHandoff.id : null} initialModelId={layoutHandoff?.view === 'session' ? layoutHandoff.modelId : null} initialDraft={layoutHandoff?.view === 'session' ? layoutHandoff.simulationDraft : null} onTrainRequested={(id, modelId, draft) => configure(id, 'models', modelId, draft)} />}
          {view === 'models' && <ModelsView initialLayoutId={layoutHandoff?.view === 'models' ? layoutHandoff.id : null} initialModelId={layoutHandoff?.view === 'models' ? layoutHandoff.modelId : null} onUseModel={(id, modelId) => configure(id, 'session', modelId, layoutHandoff?.simulationDraft)} onBackToSetup={layoutHandoff?.simulationDraft ? () => configure(layoutHandoff.id, 'session', layoutHandoff.modelId, layoutHandoff.simulationDraft) : null} onNavigate={go} />}
          {view === 'layouts' && <LayoutsView onUseLayout={configure} />}
          {view === 'history' && (
            <HistoryView onOpenSession={(id) => { changeSession(id); go('session'); }} />
          )}
        </main>
      </div>
    </ToastProvider>
  );
}
