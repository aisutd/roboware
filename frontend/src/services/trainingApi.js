/**
 * Thin client for the RoboWare training backend (FastAPI, proxied by Vite at /api).
 */

async function request(path, options = {}) {
  const res = await fetch(`/api${path}`, {
    headers: { 'Content-Type': 'application/json' },
    ...options,
  });
  if (res.status === 204) return null;
  const body = await res.json().catch(() => null);
  if (!res.ok) {
    const detail = body?.detail;
    const message = Array.isArray(detail)
      ? detail.map((d) => `${d.loc?.slice(-1)[0]}: ${d.msg}`).join('; ')
      : detail || `Request failed (${res.status})`;
    throw new Error(message);
  }
  return body;
}

export const trainingApi = {
  health: () => request('/health'),
  layout: () => request('/layout'),
  listModels: () => request('/models'),
  getModel: (id) => request(`/models/${id}`),
  deleteModel: (id) => request(`/models/${id}`, { method: 'DELETE' }),
  train: (body) => request('/models', { method: 'POST', body: JSON.stringify(body) }),
};
