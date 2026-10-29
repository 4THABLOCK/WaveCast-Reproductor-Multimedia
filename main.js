const { app, BrowserWindow, ipcMain, dialog, Menu, screen } = require('electron');
const path = require('path');
const fs = require('fs');
const { pathToFileURL } = require('url');

const AUDIO_EXT = new Set(['.wav', '.mp3', '.flac', '.ogg', '.m4a', '.aac', '.opus']);
const isAudio = (p) => AUDIO_EXT.has(path.extname(p).toLowerCase());

let win = null;
let pendingFile = null;

// ── Archivo recibido al abrir (doble clic / "Abrir con") ─────────────────────
function fileFromArgv(argv) {
  const args = argv.slice(app.isPackaged ? 1 : 2);
  return args.find((a) => !a.startsWith('-') && isAudio(a) && fs.existsSync(a)) || null;
}
pendingFile = fileFromArgv(process.argv);

// macOS entrega los archivos por este evento (puede llegar antes de 'ready').
app.on('open-file', (e, p) => {
  e.preventDefault();
  if (win && !win.isDestroyed()) {
    win.webContents.send('open-file', p);
    if (win.isMinimized()) win.restore();
    win.focus();
  } else {
    pendingFile = p;
  }
});

// Una sola ventana: si se abre otro archivo, se reutiliza.
if (!app.requestSingleInstanceLock()) {
  app.quit();
} else {
  app.on('second-instance', (_e, argv) => {
    const f = fileFromArgv(argv);
    if (win) {
      if (win.isMinimized()) win.restore();
      win.focus();
      if (f) win.webContents.send('open-file', f);
    }
  });
}

// ── Estado de la ventana ─────────────────────────────────────────────────────
const stateFile = () => path.join(app.getPath('userData'), 'window.json');
function loadBounds() {
  const def = { width: 560, height: 340 };
  try {
    const b = JSON.parse(fs.readFileSync(stateFile(), 'utf8'));
    const visible = screen.getAllDisplays().some((d) => {
      const a = d.workArea;
      return b.x >= a.x - 20 && b.y >= a.y - 20 && b.x < a.x + a.width - 80 && b.y < a.y + a.height - 40;
    });
    return { width: Math.max(420, b.width), height: Math.max(280, b.height), ...(visible ? { x: b.x, y: b.y } : {}) };
  } catch { return def; }
}
function saveBounds() {
  try { fs.writeFileSync(stateFile(), JSON.stringify(win.getNormalBounds())); } catch {}
}

function createWindow() {
  const isMac = process.platform === 'darwin';
  win = new BrowserWindow({
    ...loadBounds(),
    minWidth: 420,
    minHeight: 280,
    backgroundColor: '#0f1115',
    title: 'Onda',
    show: false,
    autoHideMenuBar: true,
    titleBarStyle: 'hidden',
    ...(isMac ? { trafficLightPosition: { x: 14, y: 12 } } : { titleBarOverlay: { color: '#0f1115', symbolColor: '#e8eaf0', height: 36 } }),
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      spellcheck: false,
      autoplayPolicy: 'no-user-gesture-required',
      backgroundThrottling: false,
    },
  });
  win.loadFile(path.join(__dirname, 'renderer', 'index.html'));
  win.once('ready-to-show', () => win.show());
  win.on('close', saveBounds);
  win.on('closed', () => { win = null; });

  // Nada de navegar fuera de la app.
  win.webContents.on('will-navigate', (e) => e.preventDefault());
  win.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
}

function buildMenu() {
  const open = { label: 'Abrir archivo…', accelerator: 'CmdOrCtrl+O', click: () => win && win.webContents.send('menu-open') };
  if (process.platform === 'darwin') {
    Menu.setApplicationMenu(Menu.buildFromTemplate([
      { role: 'appMenu' },
      { label: 'Archivo', submenu: [open, { role: 'close' }] },
      { role: 'editMenu' },
      { role: 'windowMenu' },
    ]));
  } else {
    Menu.setApplicationMenu(null);
  }
}

// ── IPC ──────────────────────────────────────────────────────────────────────
ipcMain.handle('app:initial-file', () => { const f = pendingFile; pendingFile = null; return f; });

ipcMain.handle('file:read', async (_e, p) => {
  const data = await fs.promises.readFile(p);
  return { path: p, name: path.basename(p), url: pathToFileURL(p).href, data };
});

ipcMain.handle('file:siblings', async (_e, p) => {
  try {
    const dir = path.dirname(p);
    const names = (await fs.promises.readdir(dir)).filter(isAudio);
    names.sort((a, b) => a.localeCompare(b, undefined, { numeric: true, sensitivity: 'base' }));
    return names.map((n) => path.join(dir, n));
  } catch { return [p]; }
});

ipcMain.handle('file:dialog', async () => {
  const r = await dialog.showOpenDialog(win, {
    title: 'Abrir audio',
    properties: ['openFile'],
    filters: [
      { name: 'Audio', extensions: ['wav', 'mp3', 'flac', 'ogg', 'm4a', 'aac', 'opus'] },
      { name: 'Todos los archivos', extensions: ['*'] },
    ],
  });
  return r.canceled ? null : r.filePaths[0];
});

ipcMain.on('win:always-on-top', (_e, on) => { if (win) win.setAlwaysOnTop(!!on); });
ipcMain.on('win:overlay', (_e, o) => {
  if (win && process.platform !== 'darwin' && typeof win.setTitleBarOverlay === 'function') {
    try { win.setTitleBarOverlay({ color: o.color, symbolColor: o.symbolColor, height: 36 }); } catch {}
  }
  if (win && o.color) win.setBackgroundColor(o.color);
});

app.whenReady().then(() => {
  buildMenu();
  createWindow();
  app.on('activate', () => { if (BrowserWindow.getAllWindows().length === 0) createWindow(); });
});

app.on('window-all-closed', () => { if (process.platform !== 'darwin') app.quit(); });
