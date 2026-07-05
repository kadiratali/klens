<p align="center">
  <img src="assets/logo.png" alt="klens" width="360" />
</p>

<p align="center">
  A mobile UI inspector, powered by Appium — desktop app for macOS &amp; Windows.
</p>

<p align="center">
  <a href="https://github.com/kadiratali/klens/releases/latest"><img src="https://img.shields.io/github/v/release/kadiratali/klens?label=version" alt="version" /></a>
  <a href="https://github.com/kadiratali/klens/releases"><img src="https://img.shields.io/github/downloads/kadiratali/klens/total?label=downloads" alt="downloads" /></a>
  <img src="https://img.shields.io/badge/platform-macOS%20%7C%20Windows-lightgrey" alt="platforms" />
</p>

---

Appium-based mobile UI inspector. Phase 1: Appium Inspector parity + better element matching.

## Download (desktop app)

Grab a prebuilt installer from the [GitHub Releases](https://github.com/kadiratali/klens/releases) page:

- **macOS** → `klens-<version>-universal.dmg` (Intel + Apple Silicon)
- **Windows** → `klens-Setup-<version>.exe`

> **Note (unsigned builds):** the app is not code-signed yet.
> On macOS, on first launch **right-click → Open → Open** (a plain double-click
> shows a "developer cannot be verified" warning). On Windows, SmartScreen →
> "More info → Run anyway".

The app runs its own embedded Appium proxy server (port 3100), so no separate
Node install is needed. You only need an Appium server running as usual.

## Architecture

- **server/** — Node.js + Express (port 3100). Proxies to the Appium server over W3C REST (no WebdriverIO):
  - `GET /api/inspect?since=<v>` → screenshot (Base64) + hierarchy in one call. Race-guarded capture
    (source → [screenshot ∥ source], retries 3× if the hash doesn't match, then `consistent: false`).
    If `since` matches the client's version, only the **diff** is returned (`added/removed/changed`);
    if the hierarchy didn't change at all, `unchanged: true`.
  - `GET /api/health` → session health (`ok | degraded | reconnecting | dead`), with a `window/rect`
    ping every 4s. When a session dies (UiAutomator2/WDA crash, session-dead), a new session is opened
    automatically with the same capabilities using exponential backoff (1s→30s, up to 8 attempts);
    the diff baseline and client state are preserved.
  - `GET /api/screenshot`, `GET /api/source` — individual endpoints (parity).
  - `GET /api/sessions`, `POST /api/session`, `POST /api/session/attach` (validation ping before
    attach), `DELETE /api/session`, `POST /api/appium-url`.
  - Errors are classified (`server/src/errors.js`): a meaningful description + stable code
    (`uia2-crash`, `wda-crash`, `session-dead`, `appium-unreachable`) instead of the raw driver message.
  - `POST /api/action/*` — interaction (Phase 1 / M1): `tap` and `longpress` (coordinate or element
    `path` — center computed from the snapshot), `swipe` (from/to + duration, W3C pointer actions),
    `type` (find element by XPath and sendKeys, optional `clear`), `key` (back/home/recents).
  - `GET /api/locators?path=` — locator suggestions for the selected element (accessibility-id,
    resource-id, text, class+instance, optimized short XPath). Each suggestion is validated against
    the current snapshot and returned with a match count (1 = unique); XPath candidates try simple
    attribute forms first, then a form relative to the nearest ancestor with a unique resource-id,
    and finally an absolute path. No request is sent to the device.
  - `POST /api/search` — search over the snapshot: `text` (text + content-desc substring),
    `id` (resource-id substring) or `xpath` (real XPath 1.0 engine); returns the list of matching paths.
- **web/** — Vite + React (dev: 5173, `/api` → 3100 proxy; after `vite build` the backend serves
  `web/dist` from 3100 — a single port is enough). Screenshot + XML tree + element detail panels;
  a live health indicator in the header, reconnect/inconsistency warning bars. Because a node's
  identity is its XPath, the selection is preserved across refreshes.
  - **Inspect / Interact mode** (toggle with `i`): in Inspect, a click selects an element; in
    Interact, a click sends a real tap to the device, a drag becomes a swipe, and a 600 ms+ hold is a
    long-press. Header has back/home/recents keys; the detail panel has "Tap element" and text entry
    (Type / Clear & type). The view auto-refreshes after every action (via diff).
  - **Search + locator panel** (Phase 1 / M3): a Text / ID / XPath search bar in the tree panel —
    matches are marked in the tree and highlighted together with green frames on the screenshot.
    A "Suggested locators" table in the detail panel: uniqueness badge (`unique` / `×N`), raw selector
    copy, and one-line Java / Python / JS (WebdriverIO) code snippets.
  - **Live mode** (`l` key or the Live button in the header): non-overlapping polling via a setTimeout
    chain. Adaptive cadence — 1.2s while the screen is changing, gradually backing off to 5s while
    idle; any action or change resets the cadence instantly. While the screen is static, traffic is
    just `unchanged` responses (the tree isn't parsed, no render is triggered). Polling pauses during
    an action; the error bar isn't spammed during reconnect.

## Running

```sh
npm install
npm run dev         # server + web together (browser)
npm run dev:desktop # server + web + Electron window (desktop)
```

For the browser: `http://localhost:5173` → enter the Appium URL → **List sessions** → **Attach**
(or **New session…** with a capabilities JSON to open a new session) → **Refresh**. In the desktop
version the same UI opens directly in the Electron window.

Environment variables: `APPIUM_URL` (default `http://127.0.0.1:4723`), `PORT` (backend, default 3100).

## Desktop (Electron)

`desktop/` — wraps the existing Express server and React UI in an Electron shell without changing
them (an Appium Inspector–style desktop app).

- **Dev** (`npm run dev:desktop`): server + Vite start via `concurrently`, and the Electron window
  loads the Vite dev URL (`5173`) — HMR works as usual. The window waits with `waitForUrl` until the
  target URL responds (no blank screen on cold start).
- **Native menu**: standard roles (reload, devtools, zoom, copy/paste) + a "klens" menu:
  **Toggle Inspect/Interact** (Cmd/Ctrl+I) and **Toggle Live** (Cmd/Ctrl+L) — identical to the
  `i`/`l` keyboard shortcuts. Menu actions are delivered to the UI via IPC (`menu-action`) through
  `preload.js`; in the browser build `window.klens` is undefined, so this code path is a no-op.
- **Packaged run**: the Electron main process starts the server itself with the bundled Node runtime
  (`ELECTRON_RUN_AS_NODE`) and loads the single-port URL (`3100`); no separate Node install is needed.
  The server is compiled into a single file (`desktop/build/server.cjs`) with `esbuild` and embedded
  as a resource together with `web/dist`.

### Packaging and publishing

Local build (for your current platform):

```sh
npm run dist            # web build + server bundle + electron-builder
```

Artifacts land under `desktop/dist/` (`.dmg` / `.exe`).

**Publishing (download link):** push a version tag — `.github/workflows/release.yml` builds the
installers on GitHub Actions macOS and Windows runners and uploads them to
[GitHub Releases](https://github.com/kadiratali/klens/releases):

```sh
git tag v0.1.0
git push origin v0.1.0
```

Builds are unsigned until a code-signing certificate is added (see the note above).

## Differences from Appium Inspector

- Click matching is done by **smallest bounding-box area** rather than the deepest DFS node (far more
  accurate on overlays and full-screen containers).
- **All overlapping candidates** at a point are listed; switch between them with the chips in the detail panel.
- `displayed="false"` / `visible="false"` elements are excluded from hit testing (they still show in the tree).
- Live highlight on hover; tree ↔ screenshot selection is synced both ways.

## Coordinate spaces

- Android (uiautomator2): `bounds="[x1,y1][x2,y2]"` in pixels — matches the screenshot pixels exactly.
- iOS (XCUITest): `x/y/width/height` in points; since the screenshot is in pixels, scaling is done
  proportionally via the hierarchy's total bounding box (`boundsSpace`).
