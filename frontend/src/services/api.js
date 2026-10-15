// Thin fetch wrapper for the RoboWare FastAPI backend (proxied at /api by Vite).
export class ApiError extends Error {
  constructor(message, status, detail) {
    super(message);
    this.status = status;
    this.detail = detail;
  }
}

export function errorMessage(data, status) {
  const detail = data?.detail;
  if (typeof detail === 'string') return detail;
  if (detail?.message) return detail.message;
  if (Array.isArray(detail) && detail[0]?.msg) {
    const where = (detail[0].loc ?? []).slice(1).join('.');
    return where ? `${where}: ${detail[0].msg}` : detail[0].msg;
  }
  return `Request failed (${status})`;
}

async function request(method, path, body) {
  const res = await fetch(`/api${path}`, {
    method,
    headers: body === undefined ? undefined : { 'Content-Type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  if (res.status === 204) return null;
  const text = await res.text();
  let data = null;
  try {
    data = text ? JSON.parse(text) : null;
  } catch {
    data = { detail: text };
  }
  if (!res.ok) throw new ApiError(errorMessage(data, res.status), res.status, data?.detail);
  return data;
}

export const api = {
  health: () => request('GET', '/health'),
  listLayouts: () => request('GET', '/layouts'),
  getLayout: (id) => request('GET', `/layouts/${id}`),
  createLayout: (body) => request('POST', '/layouts', body),
  updateLayout: (id, body) => request('PUT', `/layouts/${id}`, body),
  listModels: () => request('GET', '/models'),
  getModel: (id) => request('GET', `/models/${id}`),
  createModel: (body) => request('POST', '/models', body),
  deleteModel: (id) => request('DELETE', `/models/${id}`),
  trainModel: (id, body) => request('POST', `/models/${id}/train`, body),
  getTrainingJob: (jobId) => request('GET', `/training/${jobId}`),
  getQTable: (id, dest) => request('GET', `/models/${id}/qtable?dest=${dest[0]},${dest[1]}`),
  importModel: (data) => request('POST', '/models/import', data),
  exportModelUrl: (id) => `/api/models/${id}/export`,
  listSessions: () => request('GET', '/sessions'),
  getSession: (id) => request('GET', `/sessions/${id}`),
  createSession: (body) => request('POST', '/sessions', body),
  controlSession: (id, action, speed) => request('POST', `/sessions/${id}/control`, { action, speed: speed ?? null }),
  injectOrder: (id, body) => request('POST', `/sessions/${id}/orders`, body),
  saveSessionModel: (id, name) => request('POST', `/sessions/${id}/save-model`, { name: name ?? null }),
  compare: (body) => request('POST', '/compare', body),
};
