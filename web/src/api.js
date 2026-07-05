async function request(path, options = {}) {
  const res = await fetch(path, {
    headers: { 'Content-Type': 'application/json' },
    ...options,
  });
  const body = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(body.error || `${res.status} ${res.statusText}`);
  return body;
}

export const api = {
  getState: () => request('/api/state'),
  setAppiumUrl: (appiumUrl) =>
    request('/api/appium-url', { method: 'POST', body: JSON.stringify({ appiumUrl }) }),
  listSessions: () => request('/api/sessions'),
  attachSession: (sessionId) =>
    request('/api/session/attach', { method: 'POST', body: JSON.stringify({ sessionId }) }),
  createSession: (capabilities) =>
    request('/api/session', { method: 'POST', body: JSON.stringify({ capabilities }) }),
  detachSession: () => request('/api/session', { method: 'DELETE' }),
  getScreenshot: () => request('/api/screenshot'),
  getSource: () => request('/api/source'),
  inspect: (since) => request(since != null ? `/api/inspect?since=${since}` : '/api/inspect'),
  getHealth: () => request('/api/health'),
  tap: (body) => request('/api/action/tap', { method: 'POST', body: JSON.stringify(body) }),
  longPress: (body) => request('/api/action/longpress', { method: 'POST', body: JSON.stringify(body) }),
  swipe: (body) => request('/api/action/swipe', { method: 'POST', body: JSON.stringify(body) }),
  type: (body) => request('/api/action/type', { method: 'POST', body: JSON.stringify(body) }),
  pressKey: (name) => request('/api/action/key', { method: 'POST', body: JSON.stringify({ name }) }),
};
