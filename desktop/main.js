'use strict';

// Electron shell for klens. In dev the Express server and Vite are already
// running (via `npm run dev:desktop` / concurrently), so we just load the Vite
// dev URL. When packaged we spawn the Express server ourselves — using the
// bundled Electron binary as a plain Node runtime (ELECTRON_RUN_AS_NODE) so the
// end user does not need Node installed — and load the single-port server URL.

const { app, BrowserWindow, Menu, ipcMain, shell, dialog } = require('electron');
const path = require('node:path');
const http = require('node:http');
const fs = require('node:fs');
const { spawn } = require('node:child_process');

// Packaged builds get their name from the bundle; in dev the binary is plain
// "Electron", so set it explicitly for the dock tooltip and app menu.
app.setName('klens');

const isDev = !app.isPackaged;
const SERVER_PORT = process.env.PORT || 3100;
const DEV_URL = 'http://localhost:5173';
const PROD_URL = `http://localhost:${SERVER_PORT}`;
const APP_URL = isDev ? DEV_URL : PROD_URL;

// Packaged builds carry the icon in the app bundle; in dev we set it at runtime
// so the dock/taskbar shows the klens logo instead of the default Electron icon.
const ICON_PATH = path.join(__dirname, 'assets', 'icon.png');

let serverProc = null;
let win = null;

// --- Locator export prefs -------------------------------------------------
// A tiny JSON blob in userData holds the user's constant template and the
// files they've recently exported to. Kept intentionally simple (no schema
// migration) — on any read error we fall back to defaults.
const PREFS_PATH = path.join(app.getPath('userData'), 'klens-prefs.json');
const DEFAULT_PREFS = {
  template: 'public static final String {name} = "{selector}";',
  recentFiles: [],
};
const MAX_RECENT = 8;

function readPrefs() {
  try {
    return { ...DEFAULT_PREFS, ...JSON.parse(fs.readFileSync(PREFS_PATH, 'utf8')) };
  } catch {
    return { ...DEFAULT_PREFS };
  }
}

function writePrefs(prefs) {
  try {
    fs.writeFileSync(PREFS_PATH, JSON.stringify(prefs, null, 2));
  } catch (err) {
    console.error('[klens] failed to write prefs:', err.message);
  }
}

function registerExportIpc() {
  ipcMain.handle('klens:get-prefs', () => readPrefs());

  ipcMain.handle('klens:set-prefs', (_e, patch) => {
    const next = { ...readPrefs(), ...patch };
    writePrefs(next);
    return next;
  });

  ipcMain.handle('klens:choose-file', async () => {
    const res = await dialog.showOpenDialog(win, {
      title: 'Choose a file to append locators to',
      properties: ['openFile'],
    });
    if (res.canceled || !res.filePaths.length) return null;
    return res.filePaths[0];
  });

  ipcMain.handle('klens:append', (_e, { filePath, line }) => {
    try {
      let original = '';
      try {
        original = fs.readFileSync(filePath, 'utf8');
      } catch {
        // File may have been removed since it was picked; recreate it below.
      }
      fs.writeFileSync(filePath, insertLine(original, line));
      // Bump to the front of the recent list on successful use.
      const prefs = readPrefs();
      const recentFiles = [filePath, ...prefs.recentFiles.filter((f) => f !== filePath)].slice(
        0,
        MAX_RECENT
      );
      writePrefs({ ...prefs, recentFiles });
      return { ok: true, recentFiles };
    } catch (err) {
      return { ok: false, error: err.message };
    }
  });
}

// Copy the leading whitespace of the last indented line — so an inserted field
// lines up with the existing ones (tabs or 2/4 spaces). Falls back to 4 spaces.
function detectIndent(text) {
  const lines = text.split('\n');
  for (let i = lines.length - 1; i >= 0; i--) {
    const m = lines[i].match(/^([ \t]+)\S/);
    if (m) return m[1];
  }
  return '    ';
}

// Place `line` inside the file. If the file ends with a class/namespace body
// (last non-space char is `}`), insert just before that closing brace, indented
// to match — otherwise a naive append would land outside the class. For plain
// files (module-level constants) append at the end.
function insertLine(original, line) {
  const endsWithBrace = original.replace(/\s+$/, '').endsWith('}');
  if (endsWithBrace) {
    const braceIdx = original.lastIndexOf('}');
    const before = original.slice(0, braceIdx).replace(/\s*$/, '\n');
    const after = original.slice(braceIdx);
    return `${before}${detectIndent(before)}${line}\n${after}`;
  }
  const sep = original.length && !original.endsWith('\n') ? '\n' : '';
  return `${original}${sep}${line}\n`;
}

// In a packaged app, the server is shipped as a single esbuild bundle
// (server.cjs) and the built frontend as web-dist/, both under resources/.
// We run the bundle with the Electron binary as a plain Node runtime.
function startServer() {
  const serverEntry = path.join(process.resourcesPath, 'server.cjs');
  const distDir = path.join(process.resourcesPath, 'web-dist');
  serverProc = spawn(process.execPath, [serverEntry], {
    env: {
      ...process.env,
      ELECTRON_RUN_AS_NODE: '1',
      PORT: String(SERVER_PORT),
      KLENS_DIST_DIR: distDir,
    },
    stdio: 'inherit',
  });
  serverProc.on('error', (err) => console.error('[klens] server failed to start:', err));
  serverProc.on('exit', (code) => console.log(`[klens] server exited (${code})`));
}

// Poll the target URL until it answers, so window creation never races the
// server/Vite startup (avoids a blank window on cold start).
function waitForUrl(url, timeout = 30000) {
  const deadline = Date.now() + timeout;
  return new Promise((resolve, reject) => {
    const attempt = () => {
      const req = http.get(url, (res) => {
        res.resume();
        resolve();
      });
      req.on('error', () => {
        if (Date.now() > deadline) reject(new Error(`Timed out waiting for ${url}`));
        else setTimeout(attempt, 250);
      });
    };
    attempt();
  });
}

function buildMenu() {
  const send = (action) => win?.webContents.send('menu-action', action);
  const isMac = process.platform === 'darwin';

  const template = [
    ...(isMac ? [{ role: 'appMenu' }] : []),
    { role: 'fileMenu' },
    { role: 'editMenu' },
    {
      label: 'klens',
      submenu: [
        {
          label: 'Toggle Inspect / Interact',
          accelerator: 'CmdOrCtrl+I',
          click: () => send('toggle-mode'),
        },
        {
          label: 'Toggle Live Mode',
          accelerator: 'CmdOrCtrl+L',
          click: () => send('toggle-live'),
        },
      ],
    },
    { role: 'viewMenu' },
    { role: 'windowMenu' },
  ];

  Menu.setApplicationMenu(Menu.buildFromTemplate(template));
}

async function createWindow() {
  win = new BrowserWindow({
    width: 1400,
    height: 900,
    show: false,
    title: 'klens',
    icon: fs.existsSync(ICON_PATH) ? ICON_PATH : undefined,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
    },
  });

  // Open external links (e.g. docs) in the system browser, not in-app.
  win.webContents.setWindowOpenHandler(({ url }) => {
    shell.openExternal(url);
    return { action: 'deny' };
  });

  try {
    await waitForUrl(APP_URL);
  } catch (err) {
    console.error('[klens]', err.message);
  }
  await win.loadURL(APP_URL);
  win.show();
}

app.whenReady().then(async () => {
  if (process.platform === 'darwin' && app.dock && fs.existsSync(ICON_PATH)) {
    try {
      app.dock.setIcon(ICON_PATH);
    } catch {}
  }
  if (!isDev) startServer();
  buildMenu();
  registerExportIpc();
  await createWindow();

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});

app.on('quit', () => {
  serverProc?.kill();
});
