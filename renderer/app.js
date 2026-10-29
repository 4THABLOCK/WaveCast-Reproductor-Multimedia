'use strict';
/* Wave Cast – lógica del reproductor.
 * El audio se reproduce tal cual (AudioBuffer → ganancia → salida): sin compresor, limitador ni EQ.
 * La normalización solo cambia la ganancia general. Los efectos visuales leen la señal en paralelo. */

const api = window.wavecast;
const $ = (s) => document.querySelector(s);
const $$ = (s) => Array.from(document.querySelectorAll(s));
const TARGET_LUFS = -14;
const HEADROOM_DB = 1;                 // margen de picos al subir la ganancia (≈ −1 dBFS)
const PEAK_BUCKETS = 3000;
const SKIP_STEPS = [3, 5, 10, 15, 20, 30, 45, 60];
const AUDIO_EXT = /\.(wav|mp3|flac|ogg|m4a|aac|opus)$/i;

document.body.dataset.platform = api.platform;

// ── Íconos ───────────────────────────────────────────────────────────────────
const ICON = {
  home: '<path d="M4 11l8-7 8 7v8a1 1 0 0 1-1 1h-4v-6H9v6H5a1 1 0 0 1-1-1z"/>',
  expand: '<path d="M4 9V4h5M20 9V4h-5M4 15v5h5M20 15v5h-5"/>',
  sliders: '<path d="M4 7h10M18 7h2M4 17h2M10 17h10"/><circle cx="16" cy="7" r="2"/><circle cx="8" cy="17" r="2"/>',
  shuffle: '<path d="M3 7h3.5c2 0 3.2.9 4.3 2.6l2.4 3.8c1.1 1.7 2.3 2.6 4.3 2.6H21M3 17h3.5c2 0 3.2-.9 4.3-2.6M13.2 9.6C14.3 7.9 15.5 7 17.5 7H21M18.5 4.5L21 7l-2.5 2.5M18.5 14.5L21 17l-2.5 2.5"/>',
  repeat: '<path d="M17 3l3 3-3 3M4 11V9a3 3 0 0 1 3-3h13M7 21l-3-3 3-3M20 13v2a3 3 0 0 1-3 3H4"/>',
  repeat1: '<path d="M17 3l3 3-3 3M4 11V9a3 3 0 0 1 3-3h13M7 21l-3-3 3-3M20 13v2a3 3 0 0 1-3 3H4"/><text x="12" y="14.6">1</text>',
  prev: '<path class="fill" d="M7 5h2v14H7zM20 5.5v13L10 12z"/>',
  next: '<path class="fill" d="M15 5h2v14h-2zM4 5.5v13L14 12z"/>',
  play: '<path class="fill" d="M8 5.2v13.6a.6.6 0 0 0 .9.5l10.8-6.8a.6.6 0 0 0 0-1L8.9 4.7a.6.6 0 0 0-.9.5z"/>',
  pause: '<path class="fill" d="M7 5h3.6v14H7zM13.4 5H17v14h-3.6z"/>',
  volume: '<path class="fill" d="M4 9v6h4l5 4V5L8 9z"/><path d="M16.5 8.5a5 5 0 0 1 0 7M19 6a8.5 8.5 0 0 1 0 12"/>',
  volume0: '<path class="fill" d="M4 9v6h4l5 4V5L8 9z"/><path d="M17 9.5l4 5M21 9.5l-4 5"/>',
  search: '<circle cx="11" cy="11" r="6.5"/><path d="M20 20l-4.2-4.2"/>',
  file: '<path d="M6 3h8l5 5v13H6z"/><path d="M14 3v5h5"/>',
  folder: '<path d="M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V7z"/>',
  plus: '<path d="M12 5v14M5 12h14"/>',
  trash: '<path d="M5 7h14M10 7V4h4v3M7 7l1 13h8l1-13M10 11v6M14 11v6"/>',
  close: '<path d="M6 6l12 12M18 6L6 18"/>',
  heart: '<path d="M12 20s-7.5-4.6-7.5-10A4.3 4.3 0 0 1 12 7.3 4.3 4.3 0 0 1 19.5 10c0 5.4-7.5 10-7.5 10z"/>',
  queueAdd: '<path d="M4 7h11M4 12h7M4 17h7M17 13v6M14 16h6"/>',
  note: '<path d="M9 18V6l10-2v12"/><circle cx="7" cy="18" r="2.2"/><circle cx="17" cy="16" r="2.2"/>',
};
const svg = (n) => `<svg viewBox="0 0 24 24">${ICON[n] || ''}</svg>`;
const skipSvg = (dir, n) => dir < 0
  ? `<svg viewBox="0 0 24 24"><path d="M12 4.5A7.5 7.5 0 1 1 4.5 12M15 1.5l-3 3 3 3"/><text x="12" y="15.4">${n}</text></svg>`
  : `<svg viewBox="0 0 24 24"><path d="M12 4.5A7.5 7.5 0 1 0 19.5 12M9 1.5l3 3-3 3"/><text x="12" y="15.4">${n}</text></svg>`;
$$('[data-icon]').forEach((el) => { el.innerHTML = svg(el.dataset.icon); });

// ── Ajustes y datos guardados ────────────────────────────────────────────────
const DEFAULTS = { theme: 'dark', accent: '#7c5cff', style: 'bars', scale: 'real', view: 'wave', normalize: false, volume: 0.8, repeat: 'off', shuffle: false, onTop: false, skip: 10, fx: 'liquid', showLufs: true };
const ACCENTS = ['#7c5cff', '#38bdf8', '#2dd4bf', '#a3e635', '#fbbf24', '#fb923c', '#fb7185', '#f472b6'];
const OVERLAY = { dark: { color: '#0f1115', symbolColor: '#e8eaf0' }, midnight: { color: '#000000', symbolColor: '#e8eaf0' }, light: { color: '#f4f5f8', symbolColor: '#1b1e27' } };
const load = (k, d) => { try { const v = JSON.parse(localStorage.getItem(k)); return v == null ? d : v; } catch { return d; } };
const save = (k, v) => { try { localStorage.setItem(k, JSON.stringify(v)); } catch {} };

let cfg = { ...DEFAULTS, ...load('wavecast.settings', {}) };
const saveCfg = () => save('wavecast.settings', cfg);

// ── Estado ───────────────────────────────────────────────────────────────────
const S = {
  ctx: null, normGain: null, volGain: null, src: null, analyser: null,
  buf: null, dur: 0, path: null, title: '', info: '',
  playing: false, offset: 0, startedAt: 0,
  peaks: null, ref: 1, lufs: null, peak: 0, gainDb: 0, limited: false,
  cols: null, colsKey: '', token: 0, hoverX: null, dragging: false, muted: false,
  list: [], ci: -1,                         // contexto de reproducción (carpeta / lista) y posición
  queue: load('wavecast.queue', []),        // cola explícita ("a continuación")
  history: load('wavecast.history', []),    // [{path,title,dur,ts}]
  favs: load('wavecast.favs', []),          // [{path,title,dur}]
  played: [], seen: new Set(),
  tab: 'history', query: '', remaining: false, immersive: false, dragFrom: -1,
};
const saveQueue = () => save('wavecast.queue', S.queue);
const saveHistory = () => save('wavecast.history', S.history);
const saveFavs = () => save('wavecast.favs', S.favs);

// ── Utilidades ───────────────────────────────────────────────────────────────
const clamp = (v, a, b) => Math.min(b, Math.max(a, v));
function fmtTime(sec) {
  sec = Math.max(0, Math.floor(sec || 0));
  const h = Math.floor(sec / 3600), m = Math.floor((sec % 3600) / 60), s = sec % 60;
  return h ? `${h}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}` : `${m}:${String(s).padStart(2, '0')}`;
}
const fmtNum = (v, d = 1) => v.toLocaleString('es', { minimumFractionDigits: d, maximumFractionDigits: d }).replace('-', '−');
const baseName = (p) => p.split(/[\\/]/).pop();
const titleOf = (p) => baseName(p).replace(/\.[^.]+$/, '');
const folderOf = (p) => p.split(/[\\/]/).slice(-2, -1)[0] || '';
function ago(ts) {
  const m = Math.floor((Date.now() - ts) / 60000);
  if (m < 1) return 'ahora';
  if (m < 60) return `hace ${m} min`;
  const h = Math.floor(m / 60);
  if (h < 24) return `hace ${h} h`;
  if (h < 48) return 'ayer';
  return new Date(ts).toLocaleDateString('es', { day: 'numeric', month: 'short' });
}
let toastTimer = 0;
function toast(msg) {
  const t = $('#toast'); t.textContent = msg; t.hidden = false;
  clearTimeout(toastTimer); toastTimer = setTimeout(() => (t.hidden = true), 2600);
}

// ── Formato real del archivo ─────────────────────────────────────────────────
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
          const channels = dv.getUint16(o + 10, true), sampleRate = dv.getUint32(o + 12, true), bits = dv.getUint16(o + 22, true);
          if (fmt === 0xfffe && size >= 26) fmt = dv.getUint16(o + 32, true);
          return { kind: 'WAV', sampleRate, bits, channels, float: fmt === 3 };
        }
        o += 8 + size + (size & 1);
      }
    }
    if (u8.length > 22 && tag(0) === 'fLaC') {
      const v = (dv.getUint8(18) << 12) | (dv.getUint8(19) << 4) | (dv.getUint8(20) >> 4);
      const channels = ((dv.getUint8(20) >> 1) & 7) + 1;
      const bits = (((dv.getUint8(20) & 1) << 4) | (dv.getUint8(21) >> 4)) + 1;
      return { kind: 'FLAC', sampleRate: v, bits, channels };
    }
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
  try { S.ctx = new AudioContext(sampleRate ? { sampleRate, latencyHint: 'playback' } : { latencyHint: 'playback' }); }
  catch { S.ctx = new AudioContext({ latencyHint: 'playback' }); }
  S.normGain = S.ctx.createGain();
  S.volGain = S.ctx.createGain();
  S.normGain.connect(S.volGain).connect(S.ctx.destination);
  // Rama paralela solo de lectura para los efectos visuales (no va a la salida).
  S.analyser = S.ctx.createAnalyser();
  S.analyser.fftSize = 2048; S.analyser.smoothingTimeConstant = 0.8;
  S.src = null;
  applyVolume(); applyNormalization();
}

const volCurve = (v) => v * v;
function applyVolume() {
  if (S.volGain) S.volGain.gain.setTargetAtTime(S.muted ? 0 : volCurve(cfg.volume), S.ctx.currentTime, 0.015);
  const v = S.muted ? 0 : cfg.volume, r = $('#volume');
  r.value = v; r.style.setProperty('--fill', v * 100 + '%');
  $('#btn-mute').innerHTML = svg(v === 0 ? 'volume0' : 'volume');
}

function position() {
  if (!S.buf) return 0;
  if (!S.playing) return S.offset;
  const t = S.offset + (S.ctx.currentTime - S.startedAt);
  return cfg.repeat === 'one' ? t % S.dur : Math.min(t, S.dur);
}

function stopSource() {
  if (S.src) { S.src.onended = null; try { S.src.stop(); } catch {} try { S.src.disconnect(); } catch {} S.src = null; }
}
function startSource() {
  stopSource();
  const src = S.ctx.createBufferSource();
  src.buffer = S.buf; src.loop = cfg.repeat === 'one';
  src.connect(S.normGain); src.connect(S.analyser);
  src.onended = () => { if (S.src === src) onTrackEnded(); };
  src.start(0, clamp(S.offset, 0, Math.max(0, S.dur - 0.001)));
  S.src = src; S.startedAt = S.ctx.currentTime;
}

async function play() {
  if (!S.buf) return;
  if (S.ctx.state === 'suspended') { try { await S.ctx.resume(); } catch {} }
  if (S.offset >= S.dur - 0.05) S.offset = 0;
  startSource();
  S.playing = true;
  updatePlayIcons(); loop();
}
function pause() {
  if (!S.playing) return;
  S.offset = position(); stopSource(); S.playing = false;
  updatePlayIcons(); refresh(true);
}
const togglePlay = () => { if (S.buf) (S.playing ? pause() : play()); };

function seek(sec) {
  if (!S.buf) return;
  S.offset = clamp(sec, 0, S.dur);
  if (S.playing) startSource();
  refresh(true);
}
const skip = (dir) => seek(position() + dir * cfg.skip);

function onTrackEnded() {
  S.playing = false; S.offset = 0; S.src = null;
  const n = pickNext();
  if (n) { pushPlayed(); startTrack(n.p, n.fromQueue ? { queue: true } : { keep: true }); return; }
  updatePlayIcons(); refresh(true);
}

// ── Orden de reproducción: cola, aleatorio, repetir ──────────────────────────
function pickNext() {
  if (S.queue.length) { const p = S.queue.shift(); saveQueue(); return { p, fromQueue: true }; }
  const L = S.list;
  if (!L.length) return null;
  if (cfg.shuffle && L.length > 1) {
    let c = L.filter((x) => x !== S.path && !S.seen.has(x));
    if (!c.length) {
      if (cfg.repeat !== 'all') return null;
      S.seen.clear(); c = L.filter((x) => x !== S.path);
    }
    return { p: c[Math.floor(Math.random() * c.length)] };
  }
  if (S.ci >= 0 && S.ci < L.length - 1) return { p: L[S.ci + 1] };
  if (cfg.repeat === 'all') return { p: L[0] };
  return null;
}
function pushPlayed() { if (S.path) { S.played.push(S.path); if (S.played.length > 100) S.played.shift(); } }
function goNext() {
  const n = pickNext();
  if (!n) { toast('No hay más canciones'); return; }
  pushPlayed(); startTrack(n.p, n.fromQueue ? { queue: true } : { keep: true });
}
function goPrev() {
  if (position() > 3) return seek(0);
  if (S.played.length) return startTrack(S.played.pop(), { keep: true });
  if (S.ci > 0) return startTrack(S.list[S.ci - 1], { keep: true });
  seek(0);
}

function cycleRepeat() {
  if (S.playing) { S.offset = position(); S.startedAt = S.ctx.currentTime; }
  cfg.repeat = cfg.repeat === 'off' ? 'all' : cfg.repeat === 'all' ? 'one' : 'off';
  saveCfg();
  if (S.src) S.src.loop = cfg.repeat === 'one';
  renderModes();
  toast(cfg.repeat === 'off' ? 'Repetir: desactivado' : cfg.repeat === 'all' ? 'Repetir: toda la lista' : 'Repetir: esta canción');
}
function toggleShuffle() { cfg.shuffle = !cfg.shuffle; S.seen.clear(); saveCfg(); renderModes(); toast(cfg.shuffle ? 'Aleatorio activado' : 'Aleatorio desactivado'); }
function renderModes() {
  const r = $('#btn-repeat');
  r.innerHTML = svg(cfg.repeat === 'one' ? 'repeat1' : 'repeat');
  r.classList.toggle('on', cfg.repeat !== 'off');
  r.title = cfg.repeat === 'off' ? 'Repetir (R)' : cfg.repeat === 'all' ? 'Repetir lista (R)' : 'Repetir canción (R)';
  $('#btn-shuffle').classList.toggle('on', cfg.shuffle);
}

// ── Normalización a −14 LUFS (solo ganancia, sin compresión) ─────────────────
function applyNormalization() {
  S.gainDb = 0; S.limited = false;
  if (cfg.normalize && S.lufs !== null && isFinite(S.lufs)) {
    let g = TARGET_LUFS - S.lufs;
    const peakDb = S.peak > 0 ? 20 * Math.log10(S.peak) : -Infinity;
    const maxUp = -HEADROOM_DB - peakDb;
    if (g > maxUp) { g = Math.max(0, maxUp); S.limited = true; }
    S.gainDb = g;
  }
  if (S.normGain) S.normGain.gain.setTargetAtTime(Math.pow(10, S.gainDb / 20), S.ctx.currentTime, 0.03);
  renderLoudness();
}
function renderLoudness() {
  const btn = $('#btn-norm'), val = $('#lufs-val'), sub = $('#norm-sub');
  btn.setAttribute('aria-checked', String(cfg.normalize));
  $('#lufs-readout').classList.toggle('analyzing', !!S.buf && S.lufs === null);
  if (!S.buf) { val.textContent = '—'; sub.textContent = 'Normalizar −14'; return; }
  if (S.lufs === null) { val.textContent = '…'; sub.textContent = 'Midiendo…'; return; }
  if (!isFinite(S.lufs)) { val.textContent = '−∞'; sub.textContent = 'Silencio'; return; }
  val.textContent = fmtNum(S.lufs);
  if (!cfg.normalize) { sub.textContent = 'Normalizar −14'; return; }
  sub.textContent = `${S.gainDb > 0.05 ? '+' : ''}${fmtNum(S.gainDb)} dB` + (S.limited ? ' · límite de picos' : '');
}

// ── Análisis en segundo plano (LUFS + forma de onda) ─────────────────────────
let worker = null, workerBroken = false;
function onAnalysis(m) {
  if (m.id !== S.token) return;
  if (m.error) { S.lufs = -Infinity; renderLoudness(); return; }
  S.lufs = m.lufs; S.peak = m.peak; S.peaks = { min: m.min, max: m.max };
  let mx = 0.0001;
  for (let i = 0; i < m.max.length; i++) mx = Math.max(mx, m.max[i], -m.min[i]);
  S.ref = mx; S.colsKey = '';
  applyNormalization(); refresh(true);
}
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
function analyzeInline(buf, token) {
  setTimeout(() => {
    if (token !== S.token) return;
    try {
      const ch = [];
      for (let c = 0; c < buf.numberOfChannels; c++) ch.push(buf.getChannelData(c));
      const r = Lufs.measure(ch, buf.sampleRate), p = Lufs.peaks(ch, PEAK_BUCKETS);
      onAnalysis({ id: token, lufs: r.lufs, peak: r.peak, min: p.min, max: p.max });
    } catch (err) { onAnalysis({ id: token, error: String(err) }); }
  }, 30);
}
function analyze(buf, token) {
  if (!workerBroken) {
    try {
      if (!worker) worker = makeWorker();
      const ch = [];
      for (let c = 0; c < buf.numberOfChannels; c++) ch.push(buf.getChannelData(c).slice());
      worker.postMessage({ id: token, channels: ch, sampleRate: buf.sampleRate, buckets: PEAK_BUCKETS }, ch.map((c) => c.buffer));
      return;
    } catch { workerBroken = true; worker = null; }
  }
  analyzeInline(buf, token);
}

// ── Abrir y empezar una pista ────────────────────────────────────────────────
// opts: { ctx:[...] nueva lista | keep:true conserva la lista | queue:true viene de la cola | autoplay:false }
async function startTrack(p, opts = {}) {
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
    S.title = titleOf(p); S.info = describe(f, info, buf);
    S.seen.add(p);

    if (opts.ctx) { S.list = opts.ctx; S.ci = opts.ctx.indexOf(p); S.seen = new Set([p]); S.played = []; }
    else if (opts.keep) { S.ci = S.list.indexOf(p); }
    else if (!opts.queue) {
      S.list = [p]; S.ci = 0; S.seen = new Set([p]);
      api.siblings(p).then((l) => { if (token === S.token && l.length) { S.list = l; S.ci = Math.max(0, l.indexOf(p)); renderHome(); } });
    }

    addHistory(p, S.title, S.dur);
    document.body.classList.add('has-file');
    document.title = `${S.title} — Wave Cast`;
    $('#track-title').textContent = S.title; $('#track-title').title = baseName(p);
    $('#track-info').textContent = S.info;
    $('#im-name').textContent = S.title; $('#im-info').textContent = S.info;
    renderLoudness(); updatePlayIcons(); refresh(true); renderHome();

    analyze(buf, token);
    if (opts.autoplay !== false) play();
  } catch (err) {
    console.error(err);
    if (token === S.token) toast('No se pudo abrir el archivo (¿se movió o se borró?)');
  }
}
const openPath = (p) => startTrack(p);

function describe(f, info, buf) {
  const ext = (f.name.split('.').pop() || '').toUpperCase();
  const parts = [info ? info.kind : ext];
  if (info && info.kind === 'WAV') parts.push(info.float ? `${info.bits}-bit float` : `${info.bits}-bit`);
  else if (info && info.kind === 'FLAC') parts.push(`${info.bits}-bit`);
  else if (!info || info.kind === 'MP3') parts.push(`${Math.round((f.data.byteLength * 8) / buf.duration / 1000)} kbps`);
  parts.push(`${(((info && info.sampleRate) || buf.sampleRate) / 1000).toLocaleString('es', { maximumFractionDigits: 1 })} kHz`);
  const ch = (info && info.channels) || buf.numberOfChannels;
  parts.push(ch === 1 ? 'Mono' : ch === 2 ? 'Estéreo' : `${ch} canales`);
  return parts.join(' · ');
}

function playList(files, andClose = true) {
  if (!files.length) return;
  S.queue = []; saveQueue();
  startTrack(files[0], { ctx: files });
  if (andClose) closeHome();
}
async function dlgOpenFiles() { const l = await api.openDialog(true); if (l.length) playList(l); }
async function dlgOpenFolder() { const l = await api.openFolder(); if (l.length) playList(l); else toast('No hay audios en esa carpeta'); }
async function dlgAddQueue() {
  const l = await api.openDialog(true);
  if (!l.length) return;
  if (!S.buf) { playList(l, false); return; }
  S.queue.push(...l); saveQueue(); renderHome(); toast(`${l.length} añadida${l.length > 1 ? 's' : ''} a la cola`);
}
async function dlgOpenOne() { const p = await api.openDialog(false); if (p) { S.queue = []; saveQueue(); startTrack(p); closeHome(); } }

// ── Historial, favoritos, cola ───────────────────────────────────────────────
function addHistory(path, title, dur) {
  S.history = S.history.filter((h) => h.path !== path);
  S.history.unshift({ path, title, dur, ts: Date.now() });
  if (S.history.length > 300) S.history.length = 300;
  saveHistory();
}
const isFav = (p) => S.favs.some((f) => f.path === p);
function toggleFav(p, title, dur) {
  if (isFav(p)) S.favs = S.favs.filter((f) => f.path !== p);
  else S.favs.unshift({ path: p, title: title || titleOf(p), dur: dur || 0 });
  saveFavs(); renderHome();
}
function enqueue(p) { S.queue.push(p); saveQueue(); renderHome(); toast('Añadida a la cola'); }

// ── Home ─────────────────────────────────────────────────────────────────────
function openHome(tab) {
  if (tab) S.tab = tab;
  $('#home').hidden = false; $('#btn-home').classList.add('on');
  $('#settings').hidden = true;
  renderHome();
}
function closeHome() { $('#home').hidden = true; $('#btn-home').classList.remove('on'); }
const toggleHome = () => ($('#home').hidden ? openHome() : closeHome());

function eqHtml(live) { return `<span class="eq${live ? ' live' : ''}"><i></i><i></i><i></i></span>`; }
function act(icon, title, fn, cls = '') {
  const b = document.createElement('button');
  b.title = title; b.setAttribute('aria-label', title); b.className = cls; b.innerHTML = svg(icon);
  b.addEventListener('click', (e) => { e.stopPropagation(); fn(); });
  return b;
}

function buildRow(it, o = {}) {
  const el = document.createElement('div');
  el.className = 'row' + (o.now ? ' now' : '');
  el.setAttribute('role', 'listitem');
  const ico = document.createElement('div'); ico.className = 'row-ico';
  ico.innerHTML = o.now ? eqHtml(S.playing) : o.num != null ? String(o.num) : svg('note');
  if (!o.now && o.num == null) ico.firstChild.style.cssText = 'width:16px;height:16px';
  const main = document.createElement('div'); main.className = 'row-main';
  const t = document.createElement('div'); t.className = 'row-title'; t.textContent = it.title || titleOf(it.path);
  const s = document.createElement('div'); s.className = 'row-sub'; s.textContent = o.sub || folderOf(it.path);
  main.append(t, s);
  const actions = document.createElement('div'); actions.className = 'row-actions';
  (o.actions || []).forEach((a) => actions.appendChild(a));
  el.append(ico, main, actions);
  el.addEventListener('click', o.onClick);
  if (o.drag != null) {
    el.draggable = true;
    el.addEventListener('dragstart', (e) => { S.dragFrom = o.drag; el.classList.add('dragging'); e.dataTransfer.effectAllowed = 'move'; e.dataTransfer.setData('text/plain', 'q'); });
    el.addEventListener('dragend', () => { el.classList.remove('dragging'); $$('.row.over').forEach((r) => r.classList.remove('over')); S.dragFrom = -1; });
    el.addEventListener('dragover', (e) => { if (S.dragFrom >= 0) { e.preventDefault(); el.classList.add('over'); } });
    el.addEventListener('dragleave', () => el.classList.remove('over'));
    el.addEventListener('drop', (e) => {
      if (S.dragFrom < 0) return;
      e.preventDefault(); e.stopPropagation();
      const from = S.dragFrom, to = o.drag;
      if (from !== to) { const [m] = S.queue.splice(from, 1); S.queue.splice(to, 0, m); saveQueue(); }
      S.dragFrom = -1; renderHome();
    });
  }
  return el;
}

function sec(text) { const d = document.createElement('div'); d.className = 'sec'; d.textContent = text; return d; }
function emptyMsg(title, sub) { const d = document.createElement('div'); d.className = 'list-empty'; d.innerHTML = `<b></b><span></span>`; d.firstChild.textContent = title; d.lastChild.textContent = sub; return d; }

function renderHome() {
  const home = $('#home');
  if (home.hidden) return;
  $$('#tabs button').forEach((b) => b.classList.toggle('on', b.dataset.tab === S.tab));
  $('#q-count').textContent = S.queue.length ? String(S.queue.length) : '';
  const list = $('#list'), top = list.scrollTop;
  list.textContent = '';
  const q = S.query.trim().toLowerCase();
  const match = (it) => !q || (it.title || titleOf(it.path)).toLowerCase().includes(q) || folderOf(it.path).toLowerCase().includes(q);
  const LIMIT = 400;
  const frag = document.createDocumentFragment();
  const clear = $('#t-clear'), clearLbl = $('#t-clear-label');

  if (S.tab === 'history') {
    clear.hidden = !S.history.length; clearLbl.textContent = 'Borrar historial';
    const items = S.history.filter(match);
    items.slice(0, LIMIT).forEach((h) => {
      const now = h.path === S.path;
      frag.appendChild(buildRow(h, {
        now, sub: [folderOf(h.path), h.dur ? fmtTime(h.dur) : '', ago(h.ts)].filter(Boolean).join(' · '),
        onClick: () => (now ? togglePlay() : startTrack(h.path)),
        actions: [
          act('heart', isFav(h.path) ? 'Quitar de favoritos' : 'Añadir a favoritos', () => toggleFav(h.path, h.title, h.dur), isFav(h.path) ? 'fav-on' : ''),
          act('queueAdd', 'Añadir a la cola', () => enqueue(h.path)),
          act('close', 'Quitar del historial', () => { S.history = S.history.filter((x) => x.path !== h.path); saveHistory(); renderHome(); }),
        ],
      }));
    });
    if (!items.length) frag.appendChild(q ? emptyMsg('Sin resultados', `Nada coincide con “${S.query}”`) : emptyMsg('Aún no hay nada', 'Lo que reproduzcas aparecerá aquí'));
  } else if (S.tab === 'favs') {
    clear.hidden = true;
    const items = S.favs.filter(match);
    items.slice(0, LIMIT).forEach((h) => {
      const now = h.path === S.path;
      frag.appendChild(buildRow(h, {
        now, sub: [folderOf(h.path), h.dur ? fmtTime(h.dur) : ''].filter(Boolean).join(' · '),
        onClick: () => (now ? togglePlay() : startTrack(h.path)),
        actions: [
          act('heart', 'Quitar de favoritos', () => toggleFav(h.path), 'fav-on'),
          act('queueAdd', 'Añadir a la cola', () => enqueue(h.path)),
        ],
      }));
    });
    if (!items.length) frag.appendChild(q ? emptyMsg('Sin resultados', `Nada coincide con “${S.query}”`) : emptyMsg('Sin favoritos', 'Toca el corazón en cualquier canción del historial'));
  } else {
    clear.hidden = !S.queue.length; clearLbl.textContent = 'Vaciar cola';
    let any = false;
    if (S.path && match({ path: S.path, title: S.title })) {
      any = true; frag.appendChild(sec('Sonando'));
      frag.appendChild(buildRow({ path: S.path, title: S.title }, { now: true, sub: S.info, onClick: togglePlay }));
    }
    const upNext = S.queue.map((p, i) => ({ p, i })).filter((x) => match({ path: x.p }));
    if (upNext.length) {
      any = true; frag.appendChild(sec(`A continuación · ${S.queue.length}`));
      upNext.slice(0, LIMIT).forEach(({ p, i }) => frag.appendChild(buildRow({ path: p }, {
        num: i + 1, drag: i,
        onClick: () => { S.queue.splice(i, 1); saveQueue(); pushPlayed(); startTrack(p, { queue: true }); },
        actions: [act('close', 'Quitar de la cola', () => { S.queue.splice(i, 1); saveQueue(); renderHome(); })],
      })));
    }
    const rest = S.ci >= 0 && !cfg.shuffle ? S.list.slice(S.ci + 1) : [];
    const restM = rest.filter((p) => match({ path: p }));
    if (restM.length) {
      any = true; frag.appendChild(sec(cfg.repeat === 'all' ? 'Después (se repite)' : 'Después'));
      restM.slice(0, LIMIT).forEach((p) => frag.appendChild(buildRow({ path: p }, {
        onClick: () => { pushPlayed(); startTrack(p, { keep: true }); },
        actions: [act('queueAdd', 'Añadir a la cola', () => enqueue(p))],
      })));
    }
    if (!any) frag.appendChild(q ? emptyMsg('Sin resultados', `Nada coincide con “${S.query}”`) : emptyMsg('La cola está vacía', 'Añade canciones con el botón + o con “Añadir a la cola”'));
  }
  list.appendChild(frag);
  list.scrollTop = top;
  renderMini();
}

function renderMini() {
  $('#mini-title').textContent = S.buf ? S.title : 'Nada en reproducción';
  $('#mini-sub').textContent = S.buf ? S.info : 'Elige algo del historial o abre un archivo';
}

// ── Interfaz: iconos, tiempos, progreso ──────────────────────────────────────
function updatePlayIcons() {
  const ic = svg(S.playing ? 'pause' : 'play'), label = S.playing ? 'Pausar' : 'Reproducir';
  ['#btn-play', '#im-play', '#mini-play'].forEach((s) => { const b = $(s); b.innerHTML = ic; b.setAttribute('aria-label', label); });
  $('#btn-play').title = `${label} (Espacio)`;
  $('#immersive').classList.toggle('paused', !S.playing);
  if (S.immersive) poke();
  $$('.eq').forEach((e) => e.classList.toggle('live', S.playing));
}
function renderSkip() {
  const n = cfg.skip;
  [['#btn-back', -1], ['#im-back', -1], ['#btn-fwd', 1], ['#im-fwd', 1]].forEach(([s, d]) => {
    const b = $(s); b.innerHTML = skipSvg(d, n); b.title = `${d < 0 ? 'Retroceder' : 'Adelantar'} ${n} s`; b.setAttribute('aria-label', b.title);
  });
  $('#skip-val').textContent = `${n} s`;
}

let lastTxt = {};
function setTxt(id, v) { if (lastTxt[id] !== v) { lastTxt[id] = v; $(id).textContent = v; } }
function durText(pos) { return S.remaining ? '−' + fmtTime(Math.ceil(Math.max(0, S.dur - pos))) : fmtTime(S.dur); }

function refresh(force) {
  const pos = position(), p = S.buf ? clamp(pos / S.dur, 0, 1) : 0;
  setTxt('#t-cur', fmtTime(pos)); setTxt('#t-dur', durText(pos));
  if (cfg.view === 'bar') {
    $('#bar-fill').style.width = p * 100 + '%'; $('#bar-thumb').style.left = p * 100 + '%';
  } else drawWave(p);
  $('#mini-prog i').style.width = p * 100 + '%';
  if (S.immersive) { setTxt('#im-cur', fmtTime(pos)); setTxt('#im-dur', durText(pos)); $('#im-bar i').style.width = p * 100 + '%'; }
}
function loop() {
  if (!S.playing) return;
  refresh();
  requestAnimationFrame(loop);
}
$('#t-dur').onclick = $('#im-dur').onclick = () => { S.remaining = !S.remaining; refresh(true); };

// ── Forma de onda ────────────────────────────────────────────────────────────
const canvas = $('#wave'), g = canvas.getContext('2d');
let colors = {};
function readColors() {
  const cs = getComputedStyle(document.documentElement);
  colors = { accent: cs.getPropertyValue('--accent').trim(), idle: cs.getPropertyValue('--idle').trim(), text: cs.getPropertyValue('--text').trim() };
}
const BAR_W = 3, BAR_GAP = 2;
function buildCols(W) {
  const style = cfg.style;
  const n = style === 'bars' ? Math.max(1, Math.floor((W + BAR_GAP) / (BAR_W + BAR_GAP))) : style === 'lines' ? Math.max(1, Math.floor(W / 3)) : Math.max(1, Math.floor(W));
  const key = `${n}|${style}|${cfg.scale}`;
  if (S.colsKey === key && S.cols) return S.cols;
  const B = S.peaks.max.length, mins = new Float32Array(n), maxs = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    const i0 = Math.floor((i * B) / n), i1 = Math.max(i0 + 1, Math.floor(((i + 1) * B) / n));
    let lo = 0, hi = 0;
    for (let j = i0; j < i1 && j < B; j++) { if (S.peaks.min[j] < lo) lo = S.peaks.min[j]; if (S.peaks.max[j] > hi) hi = S.peaks.max[j]; }
    mins[i] = lo; maxs[i] = hi;
  }
  S.cols = { n, mins, maxs }; S.colsKey = key;
  return S.cols;
}
function drawWave(prog) {
  const dpr = window.devicePixelRatio || 1, W = canvas.clientWidth, H = canvas.clientHeight;
  if (!W || !H) return;
  if (canvas.width !== Math.round(W * dpr) || canvas.height !== Math.round(H * dpr)) { canvas.width = Math.round(W * dpr); canvas.height = Math.round(H * dpr); S.colsKey = ''; }
  g.setTransform(dpr, 0, 0, dpr, 0, 0); g.clearRect(0, 0, W, H);
  const cy = H / 2, half = H / 2 - 2, px = prog * W;
  if (!S.peaks) {
    g.fillStyle = colors.idle;
    for (let x = 0; x < W; x += BAR_W + BAR_GAP) { g.beginPath(); g.roundRect(x, cy - 1, BAR_W, 2, 1); g.fill(); }
    return;
  }
  const { n, mins, maxs } = buildCols(W), k = (cfg.scale === 'fit' ? 1 / S.ref : 1) * half, style = cfg.style;
  if (style === 'smooth') {
    const path = new Path2D();
    path.moveTo(0, cy - maxs[0] * k);
    for (let i = 1; i < n; i++) path.lineTo((i * W) / n, cy - Math.max(maxs[i], 0.004) * k);
    for (let i = n - 1; i >= 0; i--) path.lineTo((i * W) / n, cy - Math.min(mins[i], -0.004) * k);
    path.closePath();
    g.fillStyle = colors.idle; g.fill(path);
    g.save(); g.beginPath(); g.rect(0, 0, px, H); g.clip(); g.fillStyle = colors.accent; g.fill(path); g.restore();
  } else {
    const isBars = style === 'bars', stepX = isBars ? BAR_W + BAR_GAP : W / n, bw = isBars ? BAR_W : 1.6;
    const x0 = isBars ? (W - (n * stepX - BAR_GAP)) / 2 : 0;
    for (let i = 0; i < n; i++) {
      const x = x0 + i * stepX, top = cy - Math.max(maxs[i], 0.004) * k, bot = cy - Math.min(mins[i], -0.004) * k;
      g.fillStyle = x + bw / 2 <= px ? colors.accent : colors.idle;
      g.beginPath();
      if (isBars) g.roundRect(x, top, bw, Math.max(2, bot - top), 1.5); else g.rect(x, top, bw, Math.max(1.5, bot - top));
      g.fill();
    }
  }
  if (S.buf) { g.fillStyle = colors.text; g.globalAlpha = 0.9; g.fillRect(clamp(px - 1, 0, W - 2), 1, 2, H - 2); g.globalAlpha = 1; }
  if (S.hoverX !== null && S.buf) { g.fillStyle = colors.text; g.globalAlpha = 0.25; g.fillRect(S.hoverX - 0.5, 1, 1, H - 2); g.globalAlpha = 1; }
}

// Buscar tocando o arrastrando (onda o barra)
const wrap = $('#wave-wrap'), tip = $('#hover-tip');
const seekFromEvent = (e) => { const r = wrap.getBoundingClientRect(); seek(clamp((e.clientX - r.left) / r.width, 0, 1) * S.dur); };
wrap.addEventListener('pointerdown', (e) => { if (!S.buf) return; S.dragging = true; wrap.classList.add('drag'); wrap.setPointerCapture(e.pointerId); seekFromEvent(e); });
wrap.addEventListener('pointermove', (e) => {
  if (!S.buf) return;
  const r = wrap.getBoundingClientRect(), x = clamp(e.clientX - r.left, 0, r.width);
  S.hoverX = x; tip.hidden = false; tip.style.left = clamp(x, 22, r.width - 22) + 'px';
  tip.textContent = fmtTime((x / r.width) * S.dur);
  if (S.dragging) seekFromEvent(e); else if (!S.playing) refresh(true);
});
wrap.addEventListener('pointerup', () => { S.dragging = false; wrap.classList.remove('drag'); });
wrap.addEventListener('pointerleave', () => { S.hoverX = null; tip.hidden = true; if (!S.playing) refresh(true); });
new ResizeObserver(() => { S.colsKey = ''; refresh(true); }).observe(wrap);

// ── Ajustes ──────────────────────────────────────────────────────────────────
function applyTheme() {
  document.documentElement.dataset.theme = cfg.theme;
  document.documentElement.style.setProperty('--accent', cfg.accent);
  document.body.dataset.view = cfg.view;
  document.body.classList.toggle('no-lufs', !cfg.showLufs);
  readColors();
  api.setOverlay(OVERLAY[cfg.theme] || OVERLAY.dark);
  $$('.seg').forEach((seg) => seg.querySelectorAll('button').forEach((b) => b.classList.toggle('on', b.dataset.value === cfg[seg.dataset.key])));
  $$('.sw').forEach((s) => s.classList.toggle('on', s.dataset.color === cfg.accent));
  const custom = $('.sw-custom'); if (custom) custom.classList.toggle('on', !ACCENTS.includes(cfg.accent));
  $('#sw-top').setAttribute('aria-checked', String(cfg.onTop));
  $('#sw-lufs').setAttribute('aria-checked', String(cfg.showLufs));
  if (engine) engine.setAccent(cfg.accent);
  S.colsKey = ''; refresh(true);
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
  custom.className = 'sw sw-custom'; custom.title = 'Color personalizado'; custom.innerHTML = '<input type="color">';
  const input = custom.querySelector('input'); input.value = cfg.accent;
  input.oninput = () => { cfg.accent = input.value; saveCfg(); applyTheme(); };
  box.appendChild(custom);
  $$('.seg').forEach((seg) => seg.querySelectorAll('button').forEach((b) => { b.onclick = () => { cfg[seg.dataset.key] = b.dataset.value; saveCfg(); applyTheme(); }; }));
  $('#sw-top').onclick = () => { cfg.onTop = !cfg.onTop; saveCfg(); api.setAlwaysOnTop(cfg.onTop); applyTheme(); };
  $('#sw-lufs').onclick = () => { cfg.showLufs = !cfg.showLufs; saveCfg(); applyTheme(); };
  const stepSkip = (d) => {
    let i = SKIP_STEPS.indexOf(cfg.skip); if (i < 0) i = 2;
    cfg.skip = SKIP_STEPS[clamp(i + d, 0, SKIP_STEPS.length - 1)]; saveCfg(); renderSkip();
  };
  $('#skip-minus').onclick = () => stepSkip(-1); $('#skip-plus').onclick = () => stepSkip(1);
}
const panel = $('#settings');
$('#btn-settings').onclick = (e) => { e.stopPropagation(); panel.hidden = !panel.hidden; };
document.addEventListener('pointerdown', (e) => { if (!panel.hidden && !panel.contains(e.target) && !e.target.closest('#btn-settings')) panel.hidden = true; });

// ── Pantalla completa con efectos ────────────────────────────────────────────
let engine = null, idleTimer = 0;
function ensureEngine() {
  if (engine) return;
  engine = new FX.Engine({ gl: $('#fxgl'), c2d: $('#fx2d'), getAnalyser: () => S.analyser, isPlaying: () => S.playing });
}
function buildFxButtons() {
  const box = $('#im-fx'); box.textContent = '';
  FX.EFFECTS.forEach((e, i) => {
    const b = document.createElement('button'); b.textContent = e.name; b.dataset.fx = e.id; b.title = `Efecto ${i + 1} (tecla ${i + 1})`;
    b.onclick = (ev) => { ev.stopPropagation(); chooseFx(e.id); };
    box.appendChild(b);
  });
}
function chooseFx(id) {
  cfg.fx = id; saveCfg();
  const used = engine ? engine.setEffect(id) : id;
  $$('#im-fx button').forEach((b) => b.classList.toggle('on', b.dataset.fx === used));
}
function poke() {
  const el = $('#immersive'); el.classList.remove('idle');
  clearTimeout(idleTimer);
  idleTimer = setTimeout(() => { if (S.immersive && S.playing) el.classList.add('idle'); }, 2600);
}
function enterImmersive() {
  if (S.immersive) return;
  S.immersive = true; closeHome(); panel.hidden = true;
  $('#immersive').hidden = false;
  api.setFullscreen(true);
  ensureEngine(); engine.setAccent(cfg.accent); chooseFx(cfg.fx); engine.start();
  $('#im-name').textContent = S.title || 'Wave Cast'; $('#im-info').textContent = S.info || '';
  poke(); refresh(true);
}
function exitImmersive(fromOS) {
  if (!S.immersive) return;
  S.immersive = false; $('#immersive').hidden = true;
  if (engine) engine.stop();
  clearTimeout(idleTimer);
  if (!fromOS) api.setFullscreen(false);
  setTimeout(() => refresh(true), 60);
}
const toggleImmersive = () => (S.immersive ? exitImmersive() : enterImmersive());
$('#immersive').addEventListener('mousemove', poke);
$('#immersive').addEventListener('click', (e) => { if (e.target.id === 'immersive' || e.target.tagName === 'CANVAS') togglePlay(); });
$('#im-bar').addEventListener('pointerdown', (e) => {
  if (!S.buf) return;
  const bar = e.currentTarget, move = (ev) => { const r = bar.getBoundingClientRect(); seek(clamp((ev.clientX - r.left) / r.width, 0, 1) * S.dur); };
  bar.setPointerCapture(e.pointerId); move(e);
  const up = () => { bar.removeEventListener('pointermove', move); bar.removeEventListener('pointerup', up); };
  bar.addEventListener('pointermove', move); bar.addEventListener('pointerup', up);
});
api.onFullscreen((on) => { if (!on && S.immersive) exitImmersive(true); });

// ── Controles ────────────────────────────────────────────────────────────────
const bind = (sel, fn) => { $(sel).onclick = fn; };
bind('#btn-play', togglePlay); bind('#im-play', togglePlay); bind('#mini-play', togglePlay);
bind('#btn-prev', goPrev); bind('#im-prev', goPrev); bind('#mini-prev', goPrev);
bind('#btn-next', goNext); bind('#im-next', goNext); bind('#mini-next', goNext);
bind('#btn-back', () => skip(-1)); bind('#im-back', () => skip(-1));
bind('#btn-fwd', () => skip(1)); bind('#im-fwd', () => skip(1));
bind('#btn-repeat', cycleRepeat); bind('#btn-shuffle', toggleShuffle);
bind('#btn-home', toggleHome); bind('#btn-fs', toggleImmersive); bind('#im-close', () => exitImmersive());
bind('#btn-open-big', dlgOpenOne); bind('#btn-open-home', () => openHome('history'));
bind('#mini-info', closeHome);
bind('#btn-norm', () => { cfg.normalize = !cfg.normalize; saveCfg(); applyNormalization(); });
bind('#btn-mute', () => { S.muted = !S.muted; applyVolume(); });
$('#volume').oninput = (e) => { cfg.volume = parseFloat(e.target.value); S.muted = false; saveCfg(); applyVolume(); };
bind('#t-open', dlgOpenFiles); bind('#t-folder', dlgOpenFolder); bind('#t-add', dlgAddQueue);
bind('#t-clear', () => {
  if (S.tab === 'history') { S.history = []; saveHistory(); }
  else if (S.tab === 'queue') { S.queue = []; saveQueue(); }
  renderHome();
});
$$('#tabs button').forEach((b) => { b.onclick = () => { S.tab = b.dataset.tab; renderHome(); }; });
$('#q').addEventListener('input', (e) => { S.query = e.target.value; renderHome(); });

function adjustVolume(d) { cfg.volume = clamp(cfg.volume + d, 0, 1); S.muted = false; saveCfg(); applyVolume(); }
window.addEventListener('keydown', (e) => {
  const t = e.target;
  if (t instanceof HTMLInputElement && t.type === 'text') {
    if (e.key === 'Escape') { if (t.value) { t.value = ''; S.query = ''; renderHome(); } else t.blur(); }
    return;
  }
  if (t instanceof HTMLInputElement && t.type === 'color') return;
  const mod = e.ctrlKey || e.metaKey;
  if (mod && e.key.toLowerCase() === 'o') { e.preventDefault(); dlgOpenOne(); return; }
  if (mod && e.key.toLowerCase() === 'f' && !$('#home').hidden) { e.preventDefault(); $('#q').focus(); return; }
  if (mod || e.altKey) return;
  if (S.immersive) poke();
  const num = parseInt(e.key, 10);
  if (S.immersive && num >= 1 && num <= FX.EFFECTS.length) { chooseFx(FX.EFFECTS[num - 1].id); return; }
  switch (e.key) {
    case ' ': e.preventDefault(); togglePlay(); break;
    case 'ArrowLeft': e.preventDefault(); skip(e.shiftKey ? -3 : -1); break;
    case 'ArrowRight': e.preventDefault(); skip(e.shiftKey ? 3 : 1); break;
    case 'ArrowUp': e.preventDefault(); adjustVolume(0.05); break;
    case 'ArrowDown': e.preventDefault(); adjustVolume(-0.05); break;
    case 'm': case 'M': S.muted = !S.muted; applyVolume(); break;
    case 'r': case 'R': cycleRepeat(); break;
    case 's': case 'S': toggleShuffle(); break;
    case 'n': case 'N': cfg.normalize = !cfg.normalize; saveCfg(); applyNormalization(); break;
    case 'f': case 'F': toggleImmersive(); break;
    case 'h': case 'H': if (!S.immersive) toggleHome(); break;
    case 'e': case 'E': if (S.immersive) { const i = FX.EFFECTS.findIndex((x) => x.id === cfg.fx); chooseFx(FX.EFFECTS[(i + 1) % FX.EFFECTS.length].id); } break;
    case 'PageDown': goNext(); break;
    case 'PageUp': goPrev(); break;
    case 'Escape': if (S.immersive) exitImmersive(); else if (!panel.hidden) panel.hidden = true; else if (!$('#home').hidden) closeHome(); break;
  }
});

// Arrastrar y soltar archivos o carpetas
let dragDepth = 0;
const hasFiles = (e) => e.dataTransfer && Array.from(e.dataTransfer.types || []).includes('Files');
window.addEventListener('dragenter', (e) => { if (!hasFiles(e)) return; e.preventDefault(); dragDepth++; document.body.classList.add('dragging'); });
window.addEventListener('dragleave', (e) => { if (!hasFiles(e)) return; if (--dragDepth <= 0) { dragDepth = 0; document.body.classList.remove('dragging'); } });
window.addEventListener('dragover', (e) => { if (hasFiles(e)) e.preventDefault(); });
window.addEventListener('drop', async (e) => {
  if (!hasFiles(e)) return;
  e.preventDefault(); dragDepth = 0; document.body.classList.remove('dragging');
  const paths = Array.from(e.dataTransfer.files).map((f) => api.pathForFile(f)).filter(Boolean);
  const files = await api.expand(paths);
  if (!files.length) { toast('No encontré audios para reproducir'); return; }
  if (files.length === 1 && paths.length === 1 && AUDIO_EXT.test(paths[0])) { S.queue = []; saveQueue(); startTrack(files[0]); closeHome(); }
  else playList(files);
});

api.onOpenFile((p) => { S.queue = []; saveQueue(); startTrack(p); closeHome(); });
api.onMenuOpen(dlgOpenOne);

// ── Inicio ───────────────────────────────────────────────────────────────────
buildSettings(); buildFxButtons();
applyTheme(); applyVolume(); renderModes(); renderSkip(); renderLoudness(); updatePlayIcons();
if (cfg.onTop) api.setAlwaysOnTop(true);
api.initialFile().then((p) => { if (p) startTrack(p); });
window.addEventListener('resize', () => refresh(true));
