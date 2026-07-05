'use strict';

// Electron shell for klens. In dev the Express server and Vite are already
// running (via `npm run dev:desktop` / concurrently), so we just load the Vite
// dev URL. When packaged we spawn the Express server ourselves — using the
// bundled Electron binary as a plain Node runtime (ELECTRON_RUN_AS_NODE) so the
// end user does not need Node installed — and load the single-port server URL.

const { app, BrowserWindow, Menu, ipcMain, shell } = require('electron');
const path = require('node:path');
const http = require('node:http');
const { spawn } = require('node:child_process');

const isDev = !app.isPackaged;
const SERVER_PORT = process.env.PORT || 3100;
const DEV_URL = 'http://localhost:5173';
const PROD_URL = `http://localhost:${SERVER_PORT}`;
const APP_URL = isDev ? DEV_URL : PROD_URL;

let serverProc = null;
let win = null;

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
  if (!isDev) startServer();
  buildMenu();
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
