// Live session state over WebSocket: a pure reducer plus a reconnecting client.
export const initialSessionState = {
  connected: false,
  session: null,
  layout: null,
  tick: 0,
  finished: false,
  robots: [],
  orders: [],
  stations: [],
  stock: {},
  stats: null,
  events: [],
  recentEvents: [],
  metricSamples: [],
  error: null,
};

const MAX_RECENT_EVENTS = 50;

function pickFrame(m) {
  return {
    tick: m.tick ?? 0,
    finished: Boolean(m.finished),
    robots: m.robots ?? [],
    orders: m.orders ?? [],
    stations: m.stations ?? [],
    stock: m.stock ?? {},
    stats: m.stats ?? null,
    events: m.events ?? [],
  };
}

export function sessionReducer(state, message) {
  switch (message.type) {
    case 'connected':
      return { ...state, connected: true, error: null };
    case 'disconnected':
      return { ...state, connected: false };
    case 'snapshot':
      return { ...state, ...pickFrame(message), session: message.session, layout: message.layout, recentEvents: [], metricSamples: message.stats ? [{ ...message.stats, tick: message.tick ?? 0 }] : [], error: null };
    case 'frame': {
      const newest = [...(message.events ?? [])].reverse();
      const samples = state.metricSamples;
      const tick = message.tick ?? 0;
      const sample = message.stats && (!samples.length || tick - samples[samples.length - 1].tick >= 10);
      return {
        ...state,
        ...pickFrame(message),
        session: message.session ?? state.session,
        recentEvents: [...newest, ...state.recentEvents].slice(0, MAX_RECENT_EVENTS),
        metricSamples: sample ? [...samples, { ...message.stats, tick }].slice(-100) : samples,
      };
    }
    case 'error':
      return { ...state, error: message.message };
    case 'reset':
      return initialSessionState;
    default:
      return state;
  }
}

export function streamUrl(sessionId, loc = window.location) {
  const proto = loc.protocol === 'https:' ? 'wss:' : 'ws:';
  return `${proto}//${loc.host}/api/sessions/${sessionId}/stream`;
}

const NOT_LIVE = 4404;

export function connectSessionStream(sessionId, onMessage, { WebSocketImpl = WebSocket, maxDelay = 5000 } = {}) {
  let socket = null;
  let closed = false;
  let attempt = 0;
  let timer = null;

  const open = () => {
    socket = new WebSocketImpl(streamUrl(sessionId));
    socket.onopen = () => {
      attempt = 0;
      onMessage({ type: 'connected' });
    };
    socket.onmessage = (event) => {
      try {
        onMessage(JSON.parse(event.data));
      } catch {
        // ignore a malformed frame; the next one replaces it
      }
    };
    socket.onclose = (event) => {
      onMessage({ type: 'disconnected' });
      if (event.code === NOT_LIVE) {
        onMessage({ type: 'error', message: event.reason || 'This session is no longer live.' });
        return;
      }
      if (closed) return;
      const delay = Math.min(maxDelay, 500 * 2 ** attempt);
      attempt += 1;
      timer = setTimeout(open, delay);
    };
  };

  open();
  return {
    send: (msg) => {
      if (socket?.readyState === 1) socket.send(JSON.stringify(msg));
    },
    close: () => {
      closed = true;
      clearTimeout(timer);
      socket?.close();
    },
  };
}
