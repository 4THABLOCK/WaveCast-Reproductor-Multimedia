'use strict';
/* Onda – lógica del reproductor.
 * Reproduce el audio decodificado tal cual (AudioBuffer → ganancia → salida):
 * sin compresor, sin limitador, sin ecualizador. La normalización solo cambia la ganancia. */

const api = window.onda;
const $ = (s) => document.querySelector(s);
const TARGET_LUFS = -14;
const HEADROOM_DB = 1;            // margen de picos al subir la ganancia (≈ -1 dBTP)
const PEAK_BUCKETS = 3000;

document.body.dataset.platform = api.platform;

// ── Ajustes guardados ────────────────────────────────────────────────────────
const DEFAULTS = { theme: 'dark', accent: '#7c5cff', style: 'bars', scale: 'real', normalize: false, volume: 0.8, loop: false, onTop: false };
const ACCENTS = ['#7c5cff', '#38bdf8', '#2dd4bf', '#a3e635', '#fbbf24', '#fb923c', '#fb7185', '#f472b6'];
const OVERLAY = {
  dark: { color: '#0f1115', symbolColor: '#e8eaf0' },
  midnight: { color: '#000000', symbolColor: '#e8eaf0' },
  light: { color: '#f4f5f8', symbolColor: '#1b1e27' },
};
let cfg = { ...DEFAULTS };
try { cfg = { ...DEFAULTS, ...JSON.parse(localStorage.getItem('onda.settings') || '{}') }; } catch {}
const saveCfg = () => { try { localStorage.setItem('onda.settings', JSON.stringify(cfg)); } catch {} };

// ── Estado ───────────────────────────────────────────────────────────────────
const S = {
  ctx: null, normGain: null, volGain: null, src: null,
  buf: null, dur: 0, path: null, siblings: [], idx: -1,
  playing: false, offset: 0, startedAt: 0,
  peaks: null, ref: 1, lufs: null, peak: 0, gainDb: 0, limited: false,
  cols: null, colsKey: '', token: 0, hoverX: null, dragging: false, muted: false, lastVol: 0.8,
};

// ── Utilidades ───────────────────────────────────────────────────────────────
const clamp = (v, a, b) => Math.min(b, Math.max(a, v));
function fmtTime(sec) {
  sec = Math.max(0, Math.floor(sec || 0));
  const h = Math.floor(sec / 3600), m = Math.floor((sec % 3600) / 60), s = sec % 60;
  return h ? `${h}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}` : `${m}:${String(s).padStart(2, '0')}`;
}
function fmtNum(v, digits = 1) {
  return v.toLocaleString('es', { minimumFractionDigits: digits, maximumFractionDigits: digits }).replace('-', '−');
}
let toastTimer = 0;
function toast(msg) {
  const t = $('#toast'); t.textContent = msg; t.hidden = false;
  clearTimeout(toastTimer); toastTimer = setTimeout(() => (t.hidden = true), 3200);
}

// ── Lectura de cabeceras para mostrar el formato real del archivo ────────────
function sniff(u8) {
  const dv = new DataView(u8.buffer, u8.byteOffset, u8.byteLength);
  const tag = (o) => String.fromCharCode(u8[o], u8[o + 1], u8[o + 2], u8[o + 3]);
  try {
    if (u8.length > 12 && tag(0) === 'RIFF' && tag(8) === 'WAVE') {
      let o = 12;
      while (o + 8 <= u8.length) {
        const id = tag(o), size = dv.getUint32(o + 4, true);
        if (id === 'fmt ') {
          let fmt = dv.getUint16(o + 8, true);
          const channels = dv.getUint16(o + 10, true);
          const sampleRate = dv.getUint32(o + 12, true);
          const bits = dv.getUint16(o + 22, true);
          if (fmt === 0xfffe && size >= 26) fmt = dv.getUint16(o + 32, true);
          return { kind: 'WAV', sampleRate, bits, channels, float: fmt === 3 };
        }
        o += 8 + size + (size & 1);
      }
    }
    if (u8.length > 4 && tag(0) === 'fLaC') {
      // STREAMINFO: tasa (20 bits), canales (3), bits (5)
      const v = (dv.getUint8(18) << 12) | (dv.getUint8(19) << 4) | (dv.getUint8(20) >> 4);
      const channels = ((dv.getUint8(20) >> 1) & 7) + 1;
      const bits = (((dv.getUint8(20) & 1) << 4) | (dv.getUint8(21) >> 4)) + 1;
      return { kind: 'FLAC', sampleRate: v, bits, channels };
    }
    // MP3 (con o sin ID3v2)
    let o = 0;
    if (tag(0).startsWith('ID3')) o = 10 + ((u8[6] << 21) | (u8[7] << 14) | (u8[8] << 7) | u8[9]);
    for (let i = o; i < Math.min(u8.length - 4, o + 65536); i++) {
      if (u8[i] === 0xff && (u8[i + 1] & 0xe0) === 0xe0) {
        const ver = (u8[i + 1] >> 3) & 3, layer = (u8[i + 1] >> 1) & 3, sr = (u8[i + 2] >> 2) & 3;
        if (ver === 1 || layer === 0 || sr === 3) continue;
        const table = ver === 3 ? [44100, 48000, 32000] : ver === 2 ? [22050, 24000, 16000] : [11025, 12000, 8000];
        return { kind: 'MP3', sampleRate: table[sr], channels: ((u8[i + 3] >> 6) & 3) === 3 ? 1 : 2 };
      }
    }
  } catch {}
  return null;
}

// ── Audio ────────────────────────────────────────────────────────────────────
async function ensureContext(sampleRate) {
  if (S.ctx && (!sampleRate || S.ctx.sampleRate === sampleRate)) return;
  if (S.ctx) { try { await S.ctx.close(); } catch {} }
  try {
    S.ctx = new AudioContext(sampleRate ? { sampleRate, latencyHint: 'playback' } : { latencyHint: 'playback' });
  } catch {
    S.ctx = new AudioContext({ latencyHint: 'playback' });
  }
  S.normGain = S.ctx.createGain();
  S.volGain = S.ctx.createGain();
  S.normGain.connect(S.volGain).connect(S.ctx.destination);
  S.src = null;
  applyVolume();
  applyNormalization();
}

const volCurve = (v) => v * v;
function applyVolume() {
  if (S.volGain) S.volGain.gain.setTargetAtTime(S.muted ? 0 : volCurve(cfg.volume), S.ctx.currentTime, 0.015);
  const r = $('#volume');
  r.value = S.muted ? 0 : cfg.volume;
  r.style.setProperty('--fill', (S.muted ? 0 : cfg.volume) * 100 + '%');
  $('#vol-wave').style.display = S.muted || cfg.volume === 0 ? 'none' : '';
}

function position() {
  if (!S.buf) return 0;
  if (!S.playing) return S.offset;
  const t = S.offset + (S.ctx.currentTime - S.startedAt);
  return cfg.loop ? t % S.dur : Math.min(t, S.dur);
}

function stopSource() {
  if (S.src) { S.src.onended = null; try { S.src.stop(); } catch {} try { S.src.disconnect(); } catch {} S.src = null; }
}

function startSource() {
  stopSource();
  const src = S.ctx.createBufferSource();
  src.buffer = S.buf;
  src.loop = cfg.loop;
  src.connect(S.normGain);
  src.onended = () => { if (S.src === src) onTrackEnded(); };
  src.start(0, clamp(S.offset, 0, Math.max(0, S.dur - 0.001)));
  S.src = src;
  S.startedAt = S.ctx.currentTime;
}

async function play() {
  if (!S.buf) return;
  if (S.ctx.state === 'suspended') { try { await S.ctx.resume(); } catch {} }
  if (S.offset >= S.dur - 0.05) S.offset = 0;
  startSource();
  S.playing = true;
  updatePlayButton();
  loop();
}
function pause() {
  if (!S.playing) return;
  S.offset = position();
  stopSource();
  S.playing = false;
  updatePlayButton();
  draw(); updateTimes();
}
const togglePlay = () => (S.playing ? pause() : play());

function seek(sec) {
  if (!S.buf) return;
  S.offset = clamp(sec, 0, S.dur);
  if (S.playing) startSource();
  draw(); updateTimes();
}

function onTrackEnded() {
  S.playing = false; S.offset = 0; S.src = null;
  updatePlayButton(); draw(); updateTimes();
  if (S.idx >= 0 && S.idx < S.siblings.length - 1) openPath(S.siblings[S.idx + 1], true);
}

function setLoop(on) {
  if (S.playing) { S.offset = position(); S.startedAt = S.ctx.currentTime; }
  cfg.loop = on; saveCfg();
  if (S.src) S.src.loop = on;
  $('#btn-loop').classList.toggle('on', on);
}

// ── Normalización a −14 LUFS (solo ganancia, sin compresión) ─────────────────
function applyNormalization() {
  S.gainDb = 0; S.limited = false;
  if (cfg.normalize && S.lufs !== null && isFinite(S.lufs)) {
    let g = TARGET_LUFS - S.lufs;
    const peakDb = S.peak > 0 ? 20 * Math.log10(S.peak) : -Infinity;
    const maxUp = -HEADROOM_DB - peakDb;            // no pasar de −1 dBFS al subir
    if (g > maxUp) { g = Math.max(0, maxUp); S.limited = true; }
    S.gainDb = g;
  }
  if (S.normGain) S.normGain.gain.setTargetAtTime(Math.pow(10, S.gainDb / 20), S.ctx.currentTime, 0.03);
  renderLoudness();
}

function renderLoudness() {
  const btn = $('#btn-norm'), val = $('#lufs-val'), sub = $('#norm-sub');
  btn.setAttribute('aria-checked', String(cfg.normalize));
  btn.classList.toggle('analyzing', !!S.buf && S.lufs === null);
  if (!S.buf) { val.textContent = '—'; sub.textContent = 'Normalizar −14'; return; }
  if (S.lufs === null) { val.textContent = '…'; sub.textContent = 'Midiendo sonoridad'; return; }
  if (!isFinite(S.lufs)) { val.textContent = '−∞'; sub.textContent = 'Silencio'; return; }
  val.textContent = fmtNum(S.lufs);
  if (!cfg.normalize) { sub.textContent = 'Normalizar −14'; return; }
  const sign = S.gainDb > 0.05 ? '+' : S.gainDb < -0.05 ? '' : '';
  sub.textContent = `${sign}${fmtNum(S.gainDb)} dB` + (S.limited ? ' · limitado por picos' : ' → −14 LUFS');
}

// ── Análisis en segundo plano ────────────────────────────────────────────────
let worker = null, workerBroken = false;

function onAnalysis(m) {
  if (m.id !== S.token) return;
  if (m.error) { S.lufs = -Infinity; renderLoudness(); return; }
  S.lufs = m.lufs; S.peak = m.peak; S.peaks = { min: m.min, max: m.max };
  let mx = 0.0001;
  for (let i = 0; i < m.max.length; i++) mx = Math.max(mx, m.max[i], -m.min[i]);
  S.ref = mx; S.colsKey = '';
  applyNormalization(); draw();
}

// Worker creado desde un Blob (los archivos locales no siempre pueden cargar un Worker por ruta).
function makeWorker() {
  const body = `self.Lufs = (${Lufs.factorySource})();
self.onmessage = (e) => {
  const { id, channels, sampleRate, buckets } = e.data;
  try {
    const r = Lufs.measure(channels, sampleRate);
    const p = Lufs.peaks(channels, buckets);
    self.postMessage({ id, lufs: r.lufs, peak: r.peak, min: p.min, max: p.max }, [p.min.buffer, p.max.buffer]);
  } catch (err) { self.postMessage({ id, error: String(err) }); }
};`;
  const w = new Worker(URL.createObjectURL(new Blob([body], { type: 'text/javascript' })));
  w.onmessage = (e) => onAnalysis(e.data);
  w.onerror = () => { workerBroken = true; worker = null; if (S.buf) analyzeInline(S.buf, S.token); };
  return w;
}

// Respaldo: medir en el hilo principal (más lento en archivos largos, pero siempre funciona).
function analyzeInline(buf, token) {
  setTimeout(() => {
    if (token !== S.token) return;
    try {
      const channels = [];
      for (let c = 0; c < buf.numberOfChannels; c++) channels.push(buf.getChannelData(c));
      const r = Lufs.measure(channels, buf.sampleRate);
      const p = Lufs.peaks(channels, PEAK_BUCKETS);
      onAnalysis({ id: token, lufs: r.lufs, peak: r.peak, min: p.min, max: p.max });
    } catch (err) { onAnalysis({ id: token, error: String(err) }); }
  }, 30);
}

function analyze(buf, token) {
  if (!workerBroken) {
    try {
      if (!worker) worker = makeWorker();
      const channels = [];
      for (let c = 0; c < buf.numberOfChannels; c++) channels.push(buf.getChannelData(c).slice());
      worker.postMessage({ id: token, channels, sampleRate: buf.sampleRate, buckets: PEAK_BUCKETS }, channels.map((c) => c.buffer));
      return;
    } catch (err) { workerBroken = true; worker = null; }
  }
  analyzeInline(buf, token);
}

// ── Abrir archivos ───────────────────────────────────────────────────────────
async function openPath(p, autoplay = true) {
  const token = ++S.token;
  try {
    const f = await api.readFile(p);
    if (token !== S.token) return;
    const info = sniff(f.data);
    pause(); stopSource();
    await ensureContext(info && info.sampleRate);
    const ab = f.data.buffer.slice(f.data.byteOffset, f.data.byteOffset + f.data.byteLength);
    const buf = await S.ctx.decodeAudioData(ab);
    if (token !== S.token) return;

    S.buf = buf; S.dur = buf.duration; S.path = p; S.offset = 0; S.playing = false;
    S.lufs = null; S.peak = 0; S.peaks = null; S.colsKey = ''; S.gainDb = 0; S.limited = false;
    document.body.classList.add('has-file');
    const base = f.name.replace(/\.[^.]+$/, '');
    $('#track-title').textContent = base;
    $('#track-title').title = f.name;
    document.title = `${base} — Onda`;
    $('#track-info').textContent = describe(f, info, buf);
    $('#t-dur').textContent = fmtTime(S.dur);
    renderLoudness(); updateTimes(); updatePlayButton(); draw();

    analyze(buf, token);
    api.siblings(p).then((list) => { if (token === S.token) { S.siblings = list; S.idx = list.indexOf(p); } });
    if (autoplay) play();
  } catch (err) {
    console.error(err);
    if (token === S.token) toast('No se pudo abrir este archivo');
  }
}

function describe(f, info, buf) {
  const ext = (f.name.split('.').pop() || '').toUpperCase();
  const parts = [info ? info.kind : ext];
  if (info && info.kind === 'WAV') parts.push(info.float ? `${info.bits}-bit float` : `${info.bits}-bit`);
  else if (info && info.kind === 'FLAC') parts.push(`${info.bits}-bit`);
  else if (!info || info.kind === 'MP3') parts.push(`${Math.round((f.data.byteLength * 8) / buf.duration / 1000)} kbps`);
  const rate = (info && info.sampleRate) || buf.sampleRate;
  parts.push(`${(rate / 1000).toLocaleString('es', { maximumFractionDigits: 1 })} kHz`);
  const ch = (info && info.channels) || buf.numberOfChannels;
  parts.push(ch === 1 ? 'Mono' : ch === 2 ? 'Estéreo' : `${ch} canales`);
  return parts.join(' · ');
}

async function openDialog() { const p = await api.openDialog(); if (p) openPath(p); }
function step(delta) {
  if (!S.siblings.length || S.idx < 0) return;
  const n = S.idx + delta;
  if (n >= 0 && n < S.siblings.length) openPath(S.siblings[n], true);
}

// ── Interfaz: botones y tiempos ──────────────────────────────────────────────
function updatePlayButton() {
  $('#ico-play').hidden = S.playing; $('#ico-pause').hidden = !S.playing;
  $('#btn-play').setAttribute('aria-label', S.playing ? 'Pausar' : 'Reproducir');
}
function updateTimes() { $('#t-cur').textContent = fmtTime(position()); }

function loop() {
  if (!S.playing) return;
  draw(); updateTimes();
  requestAnimationFrame(loop);
}

// ── Forma de onda ────────────────────────────────────────────────────────────
const canvas = $('#wave');
const g = canvas.getContext('2d');
let colors = {};
function readColors() {
  const cs = getComputedStyle(document.documentElement);
  colors = { accent: cs.getPropertyValue('--accent').trim(), idle: cs.getPropertyValue('--idle').trim(), text: cs.getPropertyValue('--text').trim() };
}

const BAR_W = 3, BAR_GAP = 2;
function buildCols(W) {
  const style = cfg.style;
  const n = style === 'bars' ? Math.max(1, Math.floor((W + BAR_GAP) / (BAR_W + BAR_GAP)))
    : style === 'lines' ? Math.max(1, Math.floor(W / 3)) : Math.max(1, Math.floor(W));
  const key = `${n}|${style}|${cfg.scale}`;
  if (S.colsKey === key && S.cols) return S.cols;
  const B = S.peaks.max.length;
  const mins = new Float32Array(n), maxs = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    const i0 = Math.floor((i * B) / n), i1 = Math.max(i0 + 1, Math.floor(((i + 1) * B) / n));
    let lo = 0, hi = 0;
    for (let j = i0; j < i1 && j < B; j++) { if (S.peaks.min[j] < lo) lo = S.peaks.min[j]; if (S.peaks.max[j] > hi) hi = S.peaks.max[j]; }
    mins[i] = lo; maxs[i] = hi;
  }
  S.cols = { n, mins, maxs }; S.colsKey = key;
  return S.cols;
}

function draw() {
  const dpr = window.devicePixelRatio || 1;
  const W = canvas.clientWidth, H = canvas.clientHeight;
  if (!W || !H) return;
  if (canvas.width !== Math.round(W * dpr) || canvas.height !== Math.round(H * dpr)) {
    canvas.width = Math.round(W * dpr); canvas.height = Math.round(H * dpr); S.colsKey = '';
  }
  g.setTransform(dpr, 0, 0, dpr, 0, 0);
  g.clearRect(0, 0, W, H);
  const cy = H / 2, half = H / 2 - 3;
  const prog = S.buf ? clamp(position() / S.dur, 0, 1) : 0;
  const px = prog * W;

  if (!S.peaks) {
    // Sin datos todavía: línea central discreta
    g.fillStyle = colors.idle;
    const step = BAR_W + BAR_GAP;
    for (let x = 0; x < W; x += step) { g.beginPath(); g.roundRect(x, cy - 1, BAR_W, 2, 1); g.fill(); }
    return;
  }

  const { n, mins, maxs } = buildCols(W);
  const k = (cfg.scale === 'fit' ? 1 / S.ref : 1) * half;
  const style = cfg.style;

  if (style === 'smooth') {
    const path = new Path2D();
    path.moveTo(0, cy - maxs[0] * k);
    for (let i = 1; i < n; i++) path.lineTo((i * W) / n, cy - Math.max(maxs[i], 0.004) * k);
    for (let i = n - 1; i >= 0; i--) path.lineTo((i * W) / n, cy - Math.min(mins[i], -0.004) * k);
    path.closePath();
    g.fillStyle = colors.idle; g.fill(path);
    g.save(); g.beginPath(); g.rect(0, 0, px, H); g.clip(); g.fillStyle = colors.accent; g.fill(path); g.restore();
  } else {
    const isBars = style === 'bars';
    const stepX = isBars ? BAR_W + BAR_GAP : W / n;
    const bw = isBars ? BAR_W : 1.6;
    const x0 = isBars ? (W - (n * stepX - BAR_GAP)) / 2 : 0;
    for (let i = 0; i < n; i++) {
      const x = x0 + i * stepX;
      const top = cy - Math.max(maxs[i], 0.004) * k, bot = cy - Math.min(mins[i], -0.004) * k;
      g.fillStyle = x + bw / 2 <= px ? colors.accent : colors.idle;
      g.beginPath();
      if (isBars) g.roundRect(x, top, bw, Math.max(2, bot - top), 1.5); else g.rect(x, top, bw, Math.max(1.5, bot - top));
      g.fill();
    }
  }

  // Cabezal y marca de hover
  if (S.buf) {
    g.fillStyle = colors.text;
    g.globalAlpha = 0.9; g.fillRect(clamp(px - 1, 0, W - 2), 2, 2, H - 4); g.globalAlpha = 1;
  }
  if (S.hoverX !== null && S.buf) {
    g.fillStyle = colors.text; g.globalAlpha = 0.25; g.fillRect(S.hoverX - 0.5, 2, 1, H - 4); g.globalAlpha = 1;
  }
}

// Buscar tocando o arrastrando la onda
const wrap = $('#wave-wrap'), tip = $('#hover-tip');
function seekFromEvent(e) {
  const r = wrap.getBoundingClientRect();
  seek(clamp((e.clientX - r.left) / r.width, 0, 1) * S.dur);
}
wrap.addEventListener('pointerdown', (e) => {
  if (!S.buf) return;
  S.dragging = true; wrap.setPointerCapture(e.pointerId); seekFromEvent(e);
});
wrap.addEventListener('pointermove', (e) => {
  if (!S.buf) return;
  const r = wrap.getBoundingClientRect();
  const x = clamp(e.clientX - r.left, 0, r.width);
  S.hoverX = x;
  tip.hidden = false; tip.style.left = clamp(x, 22, r.width - 22) + 'px';
  tip.textContent = fmtTime((x / r.width) * S.dur);
  if (S.dragging) seekFromEvent(e); else if (!S.playing) draw();
});
wrap.addEventListener('pointerup', () => { S.dragging = false; });
wrap.addEventListener('pointerleave', () => { S.hoverX = null; tip.hidden = true; if (!S.playing) draw(); });
new ResizeObserver(() => { S.colsKey = ''; draw(); }).observe(wrap);

// ── Ajustes (tema, color, forma) ─────────────────────────────────────────────
function applyTheme() {
  document.documentElement.dataset.theme = cfg.theme;
  document.documentElement.style.setProperty('--accent', cfg.accent);
  readColors();
  api.setOverlay(OVERLAY[cfg.theme] || OVERLAY.dark);
  document.querySelectorAll('.seg').forEach((seg) => {
    seg.querySelectorAll('button').forEach((b) => b.classList.toggle('on', b.dataset.value === cfg[seg.dataset.key]));
  });
  document.querySelectorAll('.sw').forEach((s) => s.classList.toggle('on', s.dataset.color === cfg.accent));
  const custom = $('.sw-custom');
  if (custom) custom.classList.toggle('on', !ACCENTS.includes(cfg.accent));
  $('#sw-top').setAttribute('aria-checked', String(cfg.onTop));
  S.colsKey = ''; draw();
}

function buildSettings() {
  const box = $('#swatches');
  ACCENTS.forEach((c) => {
    const b = document.createElement('button');
    b.className = 'sw'; b.style.background = c; b.dataset.color = c; b.title = c;
    b.onclick = () => { cfg.accent = c; saveCfg(); applyTheme(); };
    box.appendChild(b);
  });
  const custom = document.createElement('label');
  custom.className = 'sw sw-custom'; custom.title = 'Color personalizado';
  custom.innerHTML = '<input type="color">';
  const input = custom.querySelector('input'); input.value = cfg.accent;
  input.oninput = () => { cfg.accent = input.value; saveCfg(); applyTheme(); };
  box.appendChild(custom);

  document.querySelectorAll('.seg').forEach((seg) => {
    seg.querySelectorAll('button').forEach((b) => {
      b.onclick = () => { cfg[seg.dataset.key] = b.dataset.value; saveCfg(); applyTheme(); };
    });
  });
  $('#sw-top').onclick = () => { cfg.onTop = !cfg.onTop; saveCfg(); api.setAlwaysOnTop(cfg.onTop); applyTheme(); };
}

const panel = $('#settings');
$('#btn-settings').onclick = (e) => { e.stopPropagation(); panel.hidden = !panel.hidden; };
document.addEventListener('pointerdown', (e) => { if (!panel.hidden && !panel.contains(e.target) && !e.target.closest('#btn-settings')) panel.hidden = true; });

// ── Controles ────────────────────────────────────────────────────────────────
$('#btn-play').onclick = togglePlay;
$('#btn-prev').onclick = () => { if (position() > 3 || S.idx <= 0) seek(0); else step(-1); };
$('#btn-next').onclick = () => step(1);
$('#btn-loop').onclick = () => setLoop(!cfg.loop);
$('#btn-open').onclick = openDialog;
$('#btn-open-big').onclick = openDialog;
$('#btn-norm').onclick = () => { cfg.normalize = !cfg.normalize; saveCfg(); applyNormalization(); };
$('#btn-mute').onclick = () => { S.muted = !S.muted; applyVolume(); };
$('#volume').oninput = (e) => { cfg.volume = parseFloat(e.target.value); S.muted = false; saveCfg(); applyVolume(); };

window.addEventListener('keydown', (e) => {
  if (e.target instanceof HTMLInputElement && e.target.type === 'color') return;
  const mod = e.ctrlKey || e.metaKey;
  if (mod && e.key.toLowerCase() === 'o') { e.preventDefault(); openDialog(); return; }
  if (mod || e.altKey) return;
  switch (e.key) {
    case ' ': e.preventDefault(); togglePlay(); break;
    case 'ArrowLeft': e.preventDefault(); seek(position() - (e.shiftKey ? 15 : 5)); break;
    case 'ArrowRight': e.preventDefault(); seek(position() + (e.shiftKey ? 15 : 5)); break;
    case 'ArrowUp': e.preventDefault(); cfg.volume = clamp(cfg.volume + 0.05, 0, 1); S.muted = false; saveCfg(); applyVolume(); break;
    case 'ArrowDown': e.preventDefault(); cfg.volume = clamp(cfg.volume - 0.05, 0, 1); S.muted = false; saveCfg(); applyVolume(); break;
    case 'm': case 'M': S.muted = !S.muted; applyVolume(); break;
    case 'l': case 'L': setLoop(!cfg.loop); break;
    case 'n': case 'N': cfg.normalize = !cfg.normalize; saveCfg(); applyNormalization(); break;
    case 'PageDown': step(1); break;
    case 'PageUp': step(-1); break;
    case 'Escape': panel.hidden = true; break;
  }
});

// Arrastrar y soltar
let dragDepth = 0;
window.addEventListener('dragenter', (e) => { e.preventDefault(); dragDepth++; document.body.classList.add('dragging'); });
window.addEventListener('dragleave', () => { if (--dragDepth <= 0) { dragDepth = 0; document.body.classList.remove('dragging'); } });
window.addEventListener('dragover', (e) => e.preventDefault());
window.addEventListener('drop', (e) => {
  e.preventDefault(); dragDepth = 0; document.body.classList.remove('dragging');
  const file = e.dataTransfer.files[0];
  if (!file) return;
  const p = api.pathForFile(file);
  if (p) openPath(p);
});

api.onOpenFile((p) => openPath(p));
api.onMenuOpen(openDialog);

// ── Inicio ───────────────────────────────────────────────────────────────────
buildSettings();
applyTheme();
applyVolume();
$('#btn-loop').classList.toggle('on', cfg.loop);
if (cfg.onTop) api.setAlwaysOnTop(true);
renderLoudness();
api.initialFile().then((p) => { if (p) openPath(p); });
window.addEventListener('resize', () => draw());
