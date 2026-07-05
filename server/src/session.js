import { HttpError, classify, FATAL_SESSION_CODES } from './errors.js';

export const state = {
  appiumUrl: process.env.APPIUM_URL || 'http://127.0.0.1:4723',
  sessionId: null,
  // W3C payload used to create the session; null when attached to an external
  // session (then we cannot recreate it, only report it dead).
  lastCapabilities: null,
  // Last parsed tree, for incremental diffs: { version, xmlHash, tree }
  snapshot: null,
  health: {
    status: 'idle', // idle | ok | degraded | reconnecting | dead
    code: null,
    message: null,
    failures: 0,
    lastCheckAt: null,
    reconnect: null, // { attempt, maxAttempts, nextRetryInMs }
  },
};

const PING_INTERVAL_MS = 4000;
const PING_TIMEOUT_MS = 3000;
const DEGRADED_FAILURES_BEFORE_RECONNECT = 3;
const BACKOFF_MS = [1000, 2000, 4000, 8000, 16000, 30000];
const MAX_RECONNECT_ATTEMPTS = 8;

export async function appium(path, { timeoutMs, ...options } = {}) {
  const url = state.appiumUrl.replace(/\/+$/, '') + path;
  let res;
  try {
    res = await fetch(url, {
      ...options,
      signal: timeoutMs ? AbortSignal.timeout(timeoutMs) : undefined,
      headers: { 'Content-Type': 'application/json', ...(options.headers || {}) },
    });
  } catch (err) {
    throw new HttpError(
      502,
      `Cannot reach Appium server at ${state.appiumUrl}: ${err.message}`,
      'appium-unreachable'
    );
  }
  const body = await res.json().catch(() => ({}));
  if (!res.ok) {
    const msg = body?.value?.message || body?.message || `${res.status} ${res.statusText}`;
    throw new HttpError(502, msg, classify(msg).code);
  }
  return body;
}

export function resetSession({ sessionId = null, capabilities = null } = {}) {
  state.sessionId = sessionId;
  state.lastCapabilities = capabilities;
  state.snapshot = null;
  Object.assign(state.health, {
    status: sessionId ? 'ok' : 'idle',
    code: null,
    message: null,
    failures: 0,
    lastCheckAt: null,
    reconnect: null,
  });
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

let reconnecting = false;

async function reconnectLoop(code, rawMessage) {
  if (reconnecting) return;
  const { user } = classify(rawMessage);
  if (!state.lastCapabilities) {
    // Externally attached session: we can't recreate it — report clearly.
    Object.assign(state.health, {
      status: 'dead',
      code,
      message: `${user || rawMessage} Re-attach or start a new session.`,
      reconnect: null,
    });
    return;
  }
  reconnecting = true;
  Object.assign(state.health, { status: 'reconnecting', code, message: user || rawMessage });
  try {
    for (let attempt = 1; attempt <= MAX_RECONNECT_ATTEMPTS; attempt++) {
      const delay = BACKOFF_MS[Math.min(attempt - 1, BACKOFF_MS.length - 1)];
      state.health.reconnect = { attempt, maxAttempts: MAX_RECONNECT_ATTEMPTS, nextRetryInMs: delay };
      await sleep(delay);
      try {
        const body = await appium('/session', {
          method: 'POST',
          body: JSON.stringify(state.lastCapabilities),
          timeoutMs: 60000,
        });
        // Success: swap session id but keep snapshot/version so incremental
        // diffs (and the client's tree/selection) survive the reconnect.
        state.sessionId = body.value?.sessionId || body.sessionId;
        Object.assign(state.health, {
          status: 'ok',
          code: null,
          message: null,
          failures: 0,
          reconnect: null,
        });
        console.log(`reconnected: new session ${state.sessionId} (attempt ${attempt})`);
        return;
      } catch (err) {
        state.health.message = `Reconnect attempt ${attempt}/${MAX_RECONNECT_ATTEMPTS} failed: ${err.message}`;
        console.warn(state.health.message);
      }
    }
    Object.assign(state.health, {
      status: 'dead',
      message: `Gave up after ${MAX_RECONNECT_ATTEMPTS} reconnect attempts. Start a new session manually.`,
      reconnect: null,
    });
  } finally {
    reconnecting = false;
  }
}

/** Feed any request/ping failure into the health state machine. */
export function noteFailure(err) {
  const code = err.code || classify(err.message).code;
  console.warn(`session failure [${code}]: ${err.message}`);
  state.health.lastCheckAt = Date.now();
  if (FATAL_SESSION_CODES.includes(code)) {
    reconnectLoop(code, err.message);
    return;
  }
  state.health.failures += 1;
  Object.assign(state.health, { status: 'degraded', code, message: err.message });
  if (state.health.failures >= DEGRADED_FAILURES_BEFORE_RECONNECT) {
    reconnectLoop(code, err.message);
  }
}

async function pingOnce() {
  if (!state.sessionId || reconnecting) return;
  try {
    await appium(`/session/${state.sessionId}/window/rect`, { timeoutMs: PING_TIMEOUT_MS });
    Object.assign(state.health, {
      status: 'ok',
      code: null,
      message: null,
      failures: 0,
      lastCheckAt: Date.now(),
    });
  } catch (err) {
    noteFailure(err);
  }
}

export function startHealthLoop() {
  const tick = async () => {
    await pingOnce().catch(() => {});
    setTimeout(tick, PING_INTERVAL_MS);
  };
  setTimeout(tick, PING_INTERVAL_MS);
}
