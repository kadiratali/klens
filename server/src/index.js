import express from 'express';
import cors from 'cors';
import crypto from 'node:crypto';
import path from 'node:path';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';
import { parsePageSource } from './xmlParser.js';
import { diffTrees, countNodes } from './diff.js';
import { HttpError, classify, FATAL_SESSION_CODES } from './errors.js';
import { state, appium, resetSession, noteFailure, startHealthLoop } from './session.js';
import {
  tapActions,
  swipeActions,
  findNodeByPath,
  rectCenter,
  ANDROID_KEYCODES,
} from './actions.js';
import { suggestLocators, xpathMatches } from './locators.js';

const PORT = process.env.PORT || 3100;
const RACE_GUARD_MAX_ATTEMPTS = 3;
const DIFF_MAX_CHURN_RATIO = 0.4; // above this, a full tree is cheaper than a diff

const app = express();
app.use(cors());
app.use(express.json({ limit: '10mb' }));

const sha1 = (s) => crypto.createHash('sha1').update(s).digest('hex');

function requireSession() {
  if (state.health.status === 'reconnecting') {
    const attempt = state.health.reconnect?.attempt ?? 1;
    throw new HttpError(503, `Reconnecting to device (attempt ${attempt})…`, 'reconnecting');
  }
  if (!state.sessionId) {
    throw new HttpError(409, 'No active session. Attach to or create a session first.', 'no-session');
  }
  return state.sessionId;
}

const wrap = (fn) => (req, res) =>
  Promise.resolve(fn(req, res)).catch((err) => {
    // Fatal session errors feed the health machine, which kicks off reconnect.
    if (FATAL_SESSION_CODES.includes(err.code)) noteFailure(err);
    const status = err instanceof HttpError ? err.status : 500;
    const { user } = classify(err.message);
    res.status(status).json({
      error: user || err.message,
      code: err.code || null,
      detail: user ? err.message : undefined,
    });
  });

// --- Connection / session management ---------------------------------------

// Known cloud providers. Only BrowserStack is wired up for now; others are
// surfaced in the UI as "coming soon".
const CLOUD_PROVIDERS = {
  browserstack: { name: 'BrowserStack', appiumUrl: 'https://hub-cloud.browserstack.com/wd/hub' },
};

app.get('/api/state', (req, res) => {
  res.json({
    appiumUrl: state.appiumUrl,
    sessionId: state.sessionId,
    provider: state.provider,
    hasAuth: !!state.appiumAuth,
  });
});

app.get('/api/health', (req, res) => {
  res.json({ sessionId: state.sessionId, ...state.health });
});

app.post('/api/appium-url', (req, res) => {
  const { appiumUrl } = req.body || {};
  if (!appiumUrl) return res.status(400).json({ error: 'appiumUrl is required' });
  state.appiumUrl = appiumUrl;
  // A plain URL means no cloud provider — drop any stored auth.
  state.appiumAuth = null;
  state.provider = null;
  resetSession();
  res.json({ appiumUrl: state.appiumUrl });
});

// Connect through a cloud provider (BrowserStack): point the Appium URL at the
// provider hub and store credentials, sent as HTTP Basic on every request.
app.post('/api/provider', (req, res) => {
  const { provider, username, accessKey } = req.body || {};
  if (provider == null) {
    // Clear provider, revert to a local Appium server.
    state.provider = null;
    state.appiumAuth = null;
    state.appiumUrl = process.env.APPIUM_URL || 'http://127.0.0.1:4723';
    resetSession();
    return res.json({ provider: null, appiumUrl: state.appiumUrl });
  }
  const conf = CLOUD_PROVIDERS[provider];
  if (!conf) return res.status(400).json({ error: `Unknown provider: ${provider}` });
  if (!username || !accessKey) {
    return res.status(400).json({ error: 'username and accessKey are required' });
  }
  state.provider = provider;
  state.appiumUrl = conf.appiumUrl;
  state.appiumAuth = { username, accessKey };
  resetSession();
  res.json({ provider, appiumUrl: state.appiumUrl });
});

app.get(
  '/api/sessions',
  wrap(async (req, res) => {
    // Appium >= 2.19 exposes /appium/sessions; older servers use /sessions.
    let body;
    try {
      body = await appium('/appium/sessions');
    } catch {
      body = await appium('/sessions');
    }
    const sessions = (body.value || []).map((s) => ({
      id: s.id,
      capabilities: s.capabilities || {},
    }));
    res.json({ sessions });
  })
);

// BrowserStack authenticates session creation via userName/accessKey inside
// bstack:options; inject the stored credentials so it works even when a Basic
// auth header alone is not honored.
function withProviderCreds(caps) {
  if (state.provider !== 'browserstack' || !state.appiumAuth) return caps;
  const { username, accessKey } = state.appiumAuth;
  const inject = (c) => ({
    ...c,
    'bstack:options': { ...(c['bstack:options'] || {}), userName: username, accessKey },
  });
  return caps.alwaysMatch ? { ...caps, alwaysMatch: inject(caps.alwaysMatch) } : inject(caps);
}

app.post(
  '/api/session',
  wrap(async (req, res) => {
    const caps = withProviderCreds(req.body?.capabilities || {});
    const payload = caps.alwaysMatch || caps.firstMatch
      ? { capabilities: caps }
      : { capabilities: { alwaysMatch: caps, firstMatch: [{}] } };
    const body = await appium('/session', {
      method: 'POST',
      body: JSON.stringify(payload),
      timeoutMs: 120000,
    });
    // Remember the payload so we can transparently recreate the session on crash.
    resetSession({ sessionId: body.value?.sessionId || body.sessionId, capabilities: payload });
    res.json({ sessionId: state.sessionId, capabilities: body.value?.capabilities || {} });
  })
);

app.post(
  '/api/session/attach',
  wrap(async (req, res) => {
    const { sessionId } = req.body || {};
    if (!sessionId) throw new HttpError(400, 'sessionId is required');
    // Validate before adopting, so a stale id fails loudly here, not later.
    await appium(`/session/${sessionId}/window/rect`, { timeoutMs: 5000 });
    resetSession({ sessionId });
    res.json({ sessionId });
  })
);

app.delete(
  '/api/session',
  wrap(async (req, res) => {
    const quit = req.query.quit === 'true';
    if (quit && state.sessionId) {
      await appium(`/session/${state.sessionId}`, { method: 'DELETE' }).catch(() => {});
    }
    resetSession();
    res.json({ ok: true });
  })
);

// --- Inspector endpoints -----------------------------------------------------

app.get(
  '/api/screenshot',
  wrap(async (req, res) => {
    const sessionId = requireSession();
    const body = await appium(`/session/${sessionId}/screenshot`);
    res.json({ base64: body.value });
  })
);

app.get(
  '/api/source',
  wrap(async (req, res) => {
    const sessionId = requireSession();
    const body = await appium(`/session/${sessionId}/source`);
    res.json({ xml: body.value, tree: parsePageSource(body.value) });
  })
);

/**
 * Race-guarded capture: source, then [screenshot ∥ source] in parallel.
 * If the two source dumps hash the same, the hierarchy was stable while the
 * screenshot was taken. Otherwise retry; after RACE_GUARD_MAX_ATTEMPTS give
 * the caller the latest pair flagged consistent: false.
 */
async function captureConsistent(sessionId) {
  const getSource = () => appium(`/session/${sessionId}/source`).then((b) => b.value);
  const getShot = () => appium(`/session/${sessionId}/screenshot`).then((b) => b.value);

  let before = await getSource();
  let base64;
  let xml;
  for (let attempt = 1; attempt <= RACE_GUARD_MAX_ATTEMPTS; attempt++) {
    [base64, xml] = await Promise.all([getShot(), getSource()]);
    if (sha1(xml) === sha1(before)) {
      return { base64, xml, consistent: true, attempts: attempt };
    }
    before = xml;
  }
  return { base64, xml, consistent: false, attempts: RACE_GUARD_MAX_ATTEMPTS };
}

/**
 * One-shot inspect: screenshot + source with race guard and incremental diff.
 * Pass ?since=<version> (the version the client already has). Response is one of:
 *   { version, unchanged: true, base64, ... }        — hierarchy identical
 *   { version, baseVersion, diff, base64, ... }      — apply diff to your tree
 *   { version, tree, base64, ... }                   — full tree
 */
app.get(
  '/api/inspect',
  wrap(async (req, res) => {
    const sessionId = requireSession();
    const since = req.query.since != null ? Number(req.query.since) : null;

    const capture = await captureConsistent(sessionId);
    const meta = {
      base64: capture.base64,
      consistent: capture.consistent,
      attempts: capture.attempts,
    };

    const xmlHash = sha1(capture.xml);
    const prev = state.snapshot;
    if (prev && prev.xmlHash === xmlHash) {
      // "unchanged" is only meaningful if the client actually has our version;
      // otherwise hand it the stored tree so it can't keep a stale one.
      if (since === prev.version) {
        return res.json({ version: prev.version, unchanged: true, ...meta });
      }
      return res.json({ version: prev.version, tree: prev.tree, ...meta });
    }

    const tree = parsePageSource(capture.xml);
    const version = (prev?.version || 0) + 1;
    state.snapshot = { version, xmlHash, tree, xml: capture.xml };

    if (prev && since === prev.version) {
      const diff = diffTrees(prev.tree, tree);
      if (diff) {
        const churn = diff.added.length + diff.removed.length + diff.changed.length;
        if (churn <= countNodes(tree) * DIFF_MAX_CHURN_RATIO) {
          return res.json({
            version,
            baseVersion: prev.version,
            diff,
            stats: {
              added: diff.added.length,
              removed: diff.removed.length,
              changed: diff.changed.length,
            },
            ...meta,
          });
        }
      }
    }
    res.json({ version, tree, ...meta });
  })
);

// --- Locators & search (computed on the stored snapshot, no device round trip) ---

function requireSnapshot() {
  if (!state.snapshot) throw new HttpError(409, 'No snapshot yet. Refresh first.');
  return state.snapshot;
}

app.get(
  '/api/locators',
  wrap(async (req, res) => {
    const snap = requireSnapshot();
    const nodePath = req.query.path;
    if (!nodePath) throw new HttpError(400, 'path query parameter is required');
    const node = findNodeByPath(snap.tree, nodePath);
    if (!node) throw new HttpError(404, `Element not found in current snapshot: ${nodePath}`);
    res.json({ locators: suggestLocators(node, snap.tree, snap.xml) });
  })
);

app.post(
  '/api/search',
  wrap(async (req, res) => {
    const snap = requireSnapshot();
    const { strategy = 'text', query } = req.body || {};
    if (!query) throw new HttpError(400, 'query is required');
    let matches;
    if (strategy === 'xpath') {
      try {
        matches = xpathMatches(snap.xml, query);
      } catch (err) {
        throw new HttpError(400, `Invalid XPath: ${err.message}`);
      }
    } else {
      const needle = String(query).toLowerCase();
      const preds = {
        text: (n) =>
          `${n.attrs.text || ''}\n${n.attrs['content-desc'] || ''}`.toLowerCase().includes(needle),
        id: (n) => (n.attrs['resource-id'] || '').toLowerCase().includes(needle),
      };
      const pred = preds[strategy];
      if (!pred) throw new HttpError(400, `Unknown strategy "${strategy}". Use text, id or xpath.`);
      matches = [];
      (function walk(n) {
        if (pred(n)) matches.push(n.path);
        n.children.forEach(walk);
      })(snap.tree);
    }
    res.json({ matches, total: matches.length });
  })
);

// --- Interaction endpoints ----------------------------------------------------
// Coordinates are in bounds-space (same space as node rects — device px on Android).

/** Resolve {x,y} directly, or an element `path` to its bounds center via the snapshot. */
function resolvePoint({ x, y, path: nodePath }) {
  if (Number.isFinite(x) && Number.isFinite(y)) return { x, y };
  if (nodePath) {
    const node = findNodeByPath(state.snapshot?.tree, nodePath);
    if (!node) throw new HttpError(409, `Element not found in current snapshot: ${nodePath}. Refresh and retry.`);
    if (!node.rect) throw new HttpError(409, `Element has no bounds, cannot tap: ${nodePath}`);
    return rectCenter(node.rect);
  }
  throw new HttpError(400, 'Provide x/y coordinates or an element path.');
}

async function performActions(sessionId, payload) {
  await appium(`/session/${sessionId}/actions`, {
    method: 'POST',
    body: JSON.stringify(payload),
    timeoutMs: 30000,
  });
}

app.post(
  '/api/action/tap',
  wrap(async (req, res) => {
    const sessionId = requireSession();
    const pt = resolvePoint(req.body || {});
    await performActions(sessionId, tapActions(pt.x, pt.y));
    res.json({ ok: true, tapped: { x: Math.round(pt.x), y: Math.round(pt.y) } });
  })
);

app.post(
  '/api/action/longpress',
  wrap(async (req, res) => {
    const sessionId = requireSession();
    const { durationMs = 800 } = req.body || {};
    const pt = resolvePoint(req.body || {});
    await performActions(sessionId, tapActions(pt.x, pt.y, durationMs));
    res.json({ ok: true, pressed: { x: Math.round(pt.x), y: Math.round(pt.y) }, durationMs });
  })
);

app.post(
  '/api/action/swipe',
  wrap(async (req, res) => {
    const sessionId = requireSession();
    const { from, to, durationMs = 300 } = req.body || {};
    if (!from || !to || ![from.x, from.y, to.x, to.y].every(Number.isFinite)) {
      throw new HttpError(400, 'swipe requires from:{x,y} and to:{x,y}');
    }
    await performActions(sessionId, swipeActions(from, to, durationMs));
    res.json({ ok: true });
  })
);

// The absolute tree path (rooted at the synthetic AppiumAUT/hierarchy node)
// does not match when the device re-runs the XPath, so locate the element by a
// unique attribute instead — works for Android (resource-id/content-desc/text)
// and iOS (name/label/value).
function deviceLocatorXPath(node) {
  const a = node.attrs || {};
  const tag = node.tag;
  const q = (s) => (String(s).includes('"') ? `'${s}'` : `"${s}"`);
  const count = (attr, val) => {
    let n = 0;
    (function walk(x) {
      if (!x) return;
      if ((x.attrs || {})[attr] === val) n++;
      (x.children || []).forEach(walk);
    })(state.snapshot?.tree);
    return n;
  };
  const tries = [
    ['name', a.name], // iOS accessibility id
    ['content-desc', a['content-desc']], // Android accessibility id
    ['resource-id', a['resource-id']],
    ['text', a.text],
    ['label', a.label],
    ['value', a.value],
  ];
  for (const [attr, val] of tries) {
    if (val && count(attr, val) === 1) return `//${tag}[@${attr}=${q(val)}]`;
  }
  // Fallback: drop the synthetic root so the path can match on the device.
  return node.path.replace(/^\/(AppiumAUT|hierarchy)\[\d+\]/, '') || node.path;
}

app.post(
  '/api/action/type',
  wrap(async (req, res) => {
    const sessionId = requireSession();
    const { path: nodePath, text, clear = false } = req.body || {};
    if (!nodePath) throw new HttpError(400, 'type requires an element path');
    if (typeof text !== 'string') throw new HttpError(400, 'type requires text');
    const node = findNodeByPath(state.snapshot?.tree, nodePath);
    const xpath = node ? deviceLocatorXPath(node) : nodePath;
    const body = await appium(`/session/${sessionId}/element`, {
      method: 'POST',
      body: JSON.stringify({ using: 'xpath', value: xpath }),
      timeoutMs: 15000,
    });
    const el = body.value || {};
    const elementId = el['element-6066-11e4-a52e-4f735466cecf'] || el.ELEMENT;
    if (!elementId) throw new HttpError(502, 'Could not locate element on device for typing.');
    // Focus the field first: iOS (XCUITest) often ignores setValue unless the
    // field has keyboard focus. Best-effort — some elements aren't clickable.
    await appium(`/session/${sessionId}/element/${elementId}/click`, {
      method: 'POST',
      body: '{}',
    }).catch(() => {});
    if (clear) {
      await appium(`/session/${sessionId}/element/${elementId}/clear`, { method: 'POST', body: '{}' });
    }
    await appium(`/session/${sessionId}/element/${elementId}/value`, {
      method: 'POST',
      body: JSON.stringify({ text }),
    });
    res.json({ ok: true });
  })
);

app.post(
  '/api/action/key',
  wrap(async (req, res) => {
    const sessionId = requireSession();
    const { name } = req.body || {};
    const keycode = ANDROID_KEYCODES[name];
    if (!keycode) {
      throw new HttpError(400, `Unknown key "${name}". Supported: ${Object.keys(ANDROID_KEYCODES).join(', ')}`);
    }
    await appium(`/session/${sessionId}/appium/device/press_keycode`, {
      method: 'POST',
      body: JSON.stringify({ keycode }),
    });
    res.json({ ok: true });
  })
);

// Serve the built frontend (web/dist) if present, so a single port is enough.
// KLENS_DIST_DIR lets the packaged Electron app point at its bundled web assets,
// which live outside the usual source-relative location.
const distDir = process.env.KLENS_DIST_DIR
  ? path.resolve(process.env.KLENS_DIST_DIR)
  : path.resolve(fileURLToPath(import.meta.url), '../../../web/dist');
if (fs.existsSync(distDir)) {
  app.use(express.static(distDir));
  app.get(/^\/(?!api\/).*/, (req, res) => res.sendFile(path.join(distDir, 'index.html')));
}

app.listen(PORT, () => {
  console.log(`klens server listening on http://localhost:${PORT}`);
  console.log(`Appium target: ${state.appiumUrl}`);
  startHealthLoop();
});
