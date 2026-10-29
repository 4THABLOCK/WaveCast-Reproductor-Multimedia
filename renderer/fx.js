/* Wave Cast – efectos visuales de pantalla completa que reaccionan a la música.
 * Los efectos solo LEEN el audio con un AnalyserNode en paralelo: no tocan la señal que suena. */
(function (root) {
  'use strict';

  const EFFECTS = [
    { id: 'liquid', name: 'Líquido', gl: true },
    { id: 'aurora', name: 'Aurora', gl: true },
    { id: 'tunnel', name: 'Túnel', gl: true },
    { id: 'orbs', name: 'Orbes' },
    { id: 'ring', name: 'Círculo' },
    { id: 'particles', name: 'Partículas' },
    { id: 'bars', name: 'Barras' },
  ];

  const TAU = Math.PI * 2;
  const clamp = (v, a, b) => Math.min(b, Math.max(a, v));

  // ── Color ──────────────────────────────────────────────────────────────────
  function hexToHsl(hex) {
    hex = String(hex).replace('#', '');
    if (hex.length === 3) hex = hex.split('').map((c) => c + c).join('');
    const r = parseInt(hex.slice(0, 2), 16) / 255, g = parseInt(hex.slice(2, 4), 16) / 255, b = parseInt(hex.slice(4, 6), 16) / 255;
    const mx = Math.max(r, g, b), mn = Math.min(r, g, b), l = (mx + mn) / 2, d = mx - mn;
    let h = 0, s = 0;
    if (d) {
      s = l > 0.5 ? d / (2 - mx - mn) : d / (mx + mn);
      if (mx === r) h = (g - b) / d + (g < b ? 6 : 0);
      else if (mx === g) h = (b - r) / d + 2;
      else h = (r - g) / d + 4;
      h *= 60;
    }
    return [h, s, l];
  }
  function hslToRgb(h, s, l) {
    h = ((h % 360) + 360) % 360;
    const f = (n) => {
      const k = (n + h / 30) % 12, a = s * Math.min(l, 1 - l);
      return l - a * Math.max(-1, Math.min(k - 3, 9 - k, 1));
    };
    return [f(0), f(8), f(4)];
  }
  function palette(hex) {
    const [h, s0, l0] = hexToHsl(hex);
    const s = clamp(s0, 0.55, 0.95), l = clamp(l0, 0.52, 0.62);
    const c = (dh, dl) => hslToRgb(h + dh, s, clamp(l + dl, 0.2, 0.8));
    return { h, s, l, c1: c(0, 0), c2: c(48, 0.06), c3: c(-52, -0.08) };
  }
  const rgbs = (c, k = 1) => `${Math.round(c[0] * 255 * k)},${Math.round(c[1] * 255 * k)},${Math.round(c[2] * 255 * k)}`;

  // ── Shaders ────────────────────────────────────────────────────────────────
  const VERT = 'attribute vec2 p;void main(){gl_Position=vec4(p,0.,1.);}';
  const HEAD = 'precision highp float;uniform vec2 r;uniform float t,beat;uniform vec4 a;uniform vec3 c1,c2,c3;';
  const NOISE = `
float hh(vec2 p){p=fract(p*vec2(123.34,456.21));p+=dot(p,p+45.32);return fract(p.x*p.y);}
float nn(vec2 p){vec2 i=floor(p),f=fract(p);f=f*f*(3.-2.*f);
  return mix(mix(hh(i),hh(i+vec2(1.,0.)),f.x),mix(hh(i+vec2(0.,1.)),hh(i+vec2(1.,1.)),f.x),f.y);}
float fbm(vec2 p){float v=0.,s=.5;for(int i=0;i<5;i++){v+=s*nn(p);p=p*2.02+vec2(3.1,1.7);s*=.5;}return v;}`;

  const SHADERS = {
    // a = (graves, medios, agudos, nivel)
    liquid: HEAD + NOISE + `
void main(){
  vec2 uv=(gl_FragCoord.xy-.5*r)/min(r.x,r.y);
  uv+=.035*a.x*vec2(sin(t*3.+uv.y*6.),cos(t*2.7+uv.x*6.));
  float tt=t*.12, w=1.8+a.x*1.2;
  vec2 q=vec2(fbm(uv*1.5+tt),fbm(uv*1.5+vec2(5.2,1.3)-tt));
  vec2 s=vec2(fbm(uv*1.5+w*q+vec2(1.7,9.2)+tt*1.4),fbm(uv*1.5+w*q+vec2(8.3,2.8)-tt*1.1));
  float f=fbm(uv*1.3+(2.2+a.x*1.8)*s);
  vec3 col=mix(c3*.22,c1,clamp(f*f*2.4,0.,1.));
  col=mix(col,c2,clamp(dot(q,q)*1.2,0.,1.));
  col+=vec3(1.)*pow(clamp(f,0.,1.),4.)*(.25+a.z*.9);
  col*=.6+.7*a.w+.5*beat;
  col*=1.-.33*dot(uv,uv);
  gl_FragColor=vec4(col,1.);
}`,
    aurora: HEAD + `
void main(){
  vec2 uv=gl_FragCoord.xy/r;
  vec2 p=(gl_FragCoord.xy-.5*r)/min(r.x,r.y);
  vec3 col=mix(vec3(.008,.012,.03),c3*.2,uv.y*.9);
  for(int i=0;i<5;i++){
    float fi=float(i);
    float amp=.10+.22*a.y+.10*a.x;
    float y=sin(p.x*(1.4+fi*.55)+t*(.35+fi*.11)+fi*1.7)*amp+sin(p.x*3.1-t*.5+fi)*.04*(1.+a.z*2.)+(fi-2.)*.17;
    float d=abs(p.y-y);
    float g=pow((.012+.01*a.w)/(d+.012),1.4)*.55;
    vec3 cc=mix(c1,c2,fi/4.);
    if(i>2) cc=mix(c2,c3,(fi-2.)/2.);
    col+=cc*g*(.5+.5*a.w+.4*beat);
  }
  col*=1.-.2*dot(p,p);
  col=1.-exp(-col*1.3);
  gl_FragColor=vec4(col,1.);
}`,
    tunnel: HEAD + `
void main(){
  vec2 p=(gl_FragCoord.xy-.5*r)/min(r.x,r.y);
  float rad=length(p)+1e-3, ang=atan(p.y,p.x);
  float z=.35/rad+t*.5;
  float v=sin(ang*5.+z*6.+a.x*3.)*.5+.5;
  float w=sin(ang*3.-z*4.+t*.4)*.5+.5;
  float rings=1.-smoothstep(0.,.35,abs(fract(z*1.2)-.5)-.1+a.x*.15);
  vec3 col=mix(c3*.3,c1,v);
  col=mix(col,c2,w*.6);
  col*=.35+.9*rings+.5*a.w;
  col*=smoothstep(0.,.35,rad);
  col+=c2*exp(-rad*6.)*(.5*a.x+.6*beat);
  gl_FragColor=vec4(col,1.);
}`,
  };

  // ── Motor ──────────────────────────────────────────────────────────────────
  const NB = 96;   // barras del espectro

  class Engine {
    constructor(o) {
      this.glc = o.gl; this.c2 = o.c2d; this.ctx = this.c2.getContext('2d');
      this.getAnalyser = o.getAnalyser; this.isPlaying = o.isPlaying;
      this.effect = 'liquid'; this.pal = palette('#7c5cff');
      this.running = false; this.t = 0; this.last = 0; this.raf = 0;
      this.freq = new Uint8Array(1024);
      this.spec = new Float32Array(NB);
      this.s = { bass: 0, mid: 0, treb: 0, level: 0, beat: 0 };
      this.pk = { b: 0.3, m: 0.3, t: 0.3, all: 0.3 };
      this.prevBass = 0; this.lastBeat = 0;
      this.parts = []; this.progs = {}; this.failed = {};
      this.size = { w: 0, h: 0 };
      this.hasGL = false;
      this.initGL();
    }

    initGL() {
      try {
        const gl = this.glc.getContext('webgl', { antialias: false, alpha: false, powerPreference: 'high-performance' });
        if (!gl) return;
        const buf = gl.createBuffer();
        gl.bindBuffer(gl.ARRAY_BUFFER, buf);
        gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 3, -1, -1, 3]), gl.STATIC_DRAW);
        this.gl = gl; this.hasGL = true;
      } catch { this.gl = null; this.hasGL = false; }
    }

    program(id) {
      if (this.progs[id]) return this.progs[id];
      const gl = this.gl;
      const sh = (type, src) => {
        const s = gl.createShader(type); gl.shaderSource(s, src); gl.compileShader(s);
        if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) throw new Error(gl.getShaderInfoLog(s));
        return s;
      };
      const prog = gl.createProgram();
      gl.attachShader(prog, sh(gl.VERTEX_SHADER, VERT));
      gl.attachShader(prog, sh(gl.FRAGMENT_SHADER, SHADERS[id]));
      gl.bindAttribLocation(prog, 0, 'p');
      gl.linkProgram(prog);
      if (!gl.getProgramParameter(prog, gl.LINK_STATUS)) throw new Error(gl.getProgramInfoLog(prog));
      const u = {};
      ['r', 't', 'beat', 'a', 'c1', 'c2', 'c3'].forEach((n) => (u[n] = gl.getUniformLocation(prog, n)));
      return (this.progs[id] = { prog, u });
    }

    setAccent(hex) { this.pal = palette(hex); }

    setEffect(id) {
      const e = EFFECTS.find((x) => x.id === id) || EFFECTS[0];
      let use = e.id;
      if (e.gl) {
        try { if (!this.hasGL) throw new Error('sin WebGL'); this.program(e.id); }
        catch (err) { console.warn('Efecto no disponible:', e.id, err.message || err); this.failed[e.id] = true; use = 'orbs'; }
      }
      this.effect = use; this.parts.length = 0;
      const gl = EFFECTS.find((x) => x.id === use).gl;
      this.glc.style.display = gl ? 'block' : 'none';
      this.c2.style.display = gl ? 'none' : 'block';
      this.size.w = 0;                       // fuerza resize + limpieza
      return use;
    }

    resize() {
      const host = this.c2.parentElement, cw = host.clientWidth, ch = host.clientHeight;
      if (!cw || !ch) return false;
      if (cw === this.size.w && ch === this.size.h) return true;
      this.size = { w: cw, h: ch };
      const dpr = Math.min(window.devicePixelRatio || 1, 1.5);
      this.c2.width = Math.round(cw * dpr); this.c2.height = Math.round(ch * dpr);
      this.dpr = dpr;
      this.glc.width = Math.max(2, Math.round(cw * 0.5)); this.glc.height = Math.max(2, Math.round(ch * 0.5));
      if (this.gl) this.gl.viewport(0, 0, this.glc.width, this.glc.height);
      this.ctx.fillStyle = '#05060a'; this.ctx.fillRect(0, 0, this.c2.width, this.c2.height);
      return true;
    }

    start() {
      if (this.running) return;
      this.running = true; this.last = performance.now(); this.size.w = 0;
      const loop = (now) => {
        if (!this.running) return;
        const dt = Math.min(0.05, Math.max(0.001, (now - this.last) / 1000)); this.last = now;
        try { this.step(dt); } catch (err) { console.error(err); }
        this.raf = requestAnimationFrame(loop);
      };
      this.raf = requestAnimationFrame(loop);
    }
    stop() { this.running = false; cancelAnimationFrame(this.raf); }

    // ── Análisis del audio ────────────────────────────────────────────────
    analyze(dt, playing) {
      const an = this.getAnalyser && this.getAnalyser();
      const live = !!(an && playing);
      const f = this.freq;
      if (live) an.getByteFrequencyData(f);
      const band = (a, b) => { let s = 0; for (let i = a; i < b; i++) s += f[i]; return s / ((b - a) * 255); };
      const raw = live ? { b: band(1, 12), m: band(12, 90), t: band(90, 420) } : { b: 0, m: 0, t: 0 };
      const S = this.s, pk = this.pk;
      const idle = 0.05 + 0.03 * Math.sin(this.t * 0.9);
      const rel = (k) => {
        pk[k] = Math.max(raw[k], pk[k] - dt * 0.05, 0.25);
        return Math.pow(clamp(raw[k] / pk[k], 0, 1), 1.5);
      };
      const tgt = { bass: Math.max(idle, rel('b')), mid: Math.max(idle * 0.8, rel('m')), treb: Math.max(idle * 0.6, rel('t')) };
      const sm = (cur, to) => cur + (to - cur) * (1 - Math.exp(-dt * (to > cur ? 26 : 5)));
      S.bass = sm(S.bass, tgt.bass); S.mid = sm(S.mid, tgt.mid); S.treb = sm(S.treb, tgt.treb);
      S.level = S.bass * 0.5 + S.mid * 0.35 + S.treb * 0.15;

      const now = performance.now();
      if (live && tgt.bass > 0.55 && tgt.bass - this.prevBass > 0.08 && now - this.lastBeat > 180) { S.beat = 1; this.lastBeat = now; }
      this.prevBass = tgt.bass;
      S.beat *= Math.exp(-dt * 6);

      // espectro en NB barras (escala log) con picos relativos
      let mx = 0;
      const vals = new Float32Array(NB);
      for (let i = 0; i < NB; i++) {
        const lo = 1 + Math.floor(Math.pow(i / NB, 2) * 600);
        const hi = Math.max(lo + 1, 1 + Math.floor(Math.pow((i + 1) / NB, 2) * 600));
        let v = 0;
        if (live) for (let j = lo; j < hi; j++) if (f[j] > v) v = f[j];
        vals[i] = v / 255; if (vals[i] > mx) mx = vals[i];
      }
      this.pk.all = Math.max(mx, this.pk.all - dt * 0.05, 0.3);
      for (let i = 0; i < NB; i++) {
        const to = live ? Math.pow(clamp(vals[i] / this.pk.all, 0, 1), 1.3) : 0.03 + 0.02 * Math.sin(this.t + i * 0.3);
        this.spec[i] = sm(this.spec[i], to);
      }
    }

    step(dt) {
      this.analyze(dt, this.isPlaying());
      this.t += dt * (0.3 + this.s.level * 1.7);
      if (!this.resize()) return;
      const e = EFFECTS.find((x) => x.id === this.effect);
      if (e.gl) return this.drawGL();
      const w = this.c2.width, h = this.c2.height;
      this.ctx.setTransform(1, 0, 0, 1, 0, 0);
      ({ orbs: this.drawOrbs, ring: this.drawRing, particles: this.drawParticles, bars: this.drawBars })[this.effect].call(this, w, h, dt);
    }

    drawGL() {
      const gl = this.gl, { prog, u } = this.program(this.effect), S = this.s, p = this.pal;
      gl.useProgram(prog);
      gl.enableVertexAttribArray(0); gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0);
      gl.uniform2f(u.r, this.glc.width, this.glc.height);
      gl.uniform1f(u.t, this.t); gl.uniform1f(u.beat, S.beat);
      gl.uniform4f(u.a, S.bass, S.mid, S.treb, S.level);
      gl.uniform3fv(u.c1, p.c1); gl.uniform3fv(u.c2, p.c2); gl.uniform3fv(u.c3, p.c3);
      gl.drawArrays(gl.TRIANGLES, 0, 3);
    }

    // ── Efectos 2D ────────────────────────────────────────────────────────
    drawOrbs(w, h) {
      const c = this.ctx, S = this.s, p = this.pal, t = this.t, m = Math.min(w, h);
      c.globalCompositeOperation = 'source-over'; c.fillStyle = '#05060a'; c.fillRect(0, 0, w, h);
      c.globalCompositeOperation = 'lighter';
      const cols = [p.c1, p.c2, p.c3];
      for (let i = 0; i < 7; i++) {
        const ph = i * 1.7;
        const x = w * (0.5 + 0.36 * Math.sin(t * 0.33 + ph * 1.3) * Math.cos(t * 0.17 + ph));
        const y = h * (0.5 + 0.34 * Math.cos(t * 0.29 + ph * 0.9) * Math.sin(t * 0.21 + ph * 1.4));
        const rad = m * (0.2 + 0.05 * (i % 3)) * (1 + S.bass * 0.5 + S.beat * 0.25);
        const col = rgbs(cols[i % 3]);
        const g = c.createRadialGradient(x, y, 0, x, y, rad);
        g.addColorStop(0, `rgba(${col},${0.5 + 0.35 * S.level})`);
        g.addColorStop(1, `rgba(${col},0)`);
        c.fillStyle = g; c.beginPath(); c.arc(x, y, rad, 0, TAU); c.fill();
      }
      c.globalCompositeOperation = 'source-over';
    }

    drawRing(w, h) {
      const c = this.ctx, S = this.s, p = this.pal, t = this.t, m = Math.min(w, h);
      c.globalCompositeOperation = 'source-over'; c.fillStyle = 'rgba(3,4,8,.22)'; c.fillRect(0, 0, w, h);
      const cx = w / 2, cy = h / 2, R = m * 0.2 * (1 + S.bass * 0.18 + S.beat * 0.08);
      const g = c.createRadialGradient(cx, cy, 0, cx, cy, R * 1.25);
      g.addColorStop(0, `rgba(${rgbs(p.c1)},${0.12 + 0.3 * S.bass})`); g.addColorStop(1, `rgba(${rgbs(p.c1)},0)`);
      c.fillStyle = g; c.beginPath(); c.arc(cx, cy, R * 1.25, 0, TAU); c.fill();
      c.lineCap = 'round'; c.lineWidth = Math.max(2, m * 0.008);
      const n = NB * 2, rot = t * 0.15;
      for (let k = 0; k < n; k++) {
        const idx = k < NB ? k : n - 1 - k, v = this.spec[idx];
        const ang = rot + (k / n) * TAU, ca = Math.cos(ang), sa = Math.sin(ang), len = m * (0.02 + 0.24 * v);
        c.strokeStyle = `hsl(${p.h + (k / n) * 90 - 20},${Math.round(p.s * 100)}%,${Math.round(55 + 15 * v)}%)`;
        c.beginPath(); c.moveTo(cx + ca * R, cy + sa * R); c.lineTo(cx + ca * (R + len), cy + sa * (R + len)); c.stroke();
      }
      c.strokeStyle = `rgba(255,255,255,${0.25 + 0.4 * S.beat})`; c.lineWidth = Math.max(1.5, m * 0.004);
      c.beginPath(); c.arc(cx, cy, R * 0.96, 0, TAU); c.stroke();
    }

    drawParticles(w, h, dt) {
      const c = this.ctx, S = this.s, p = this.pal, m = Math.min(w, h), cx = w / 2, cy = h / 2;
      c.globalCompositeOperation = 'source-over'; c.fillStyle = 'rgba(3,4,8,.16)'; c.fillRect(0, 0, w, h);
      const spawn = Math.round(2 + S.level * 8 + (S.beat > 0.6 ? 30 : 0));
      for (let i = 0; i < spawn && this.parts.length < 700; i++) {
        const a = Math.random() * TAU, r0 = m * 0.03 * Math.random();
        this.parts.push({ x: cx + Math.cos(a) * r0, y: cy + Math.sin(a) * r0, a, v: m * (0.08 + Math.random() * 0.22), life: 1.6 + Math.random() * 1.6, age: 0, s: 0.8 + Math.random() * 1.8, hue: Math.random() * 100 - 30, sw: (Math.random() - 0.5) * 0.9 });
      }
      c.globalCompositeOperation = 'lighter';
      const boost = 1 + S.level * 2.6 + S.beat;
      for (let i = this.parts.length - 1; i >= 0; i--) {
        const q = this.parts[i];
        q.age += dt; if (q.age > q.life) { this.parts.splice(i, 1); continue; }
        q.a += q.sw * dt * (1 + S.mid); q.x += Math.cos(q.a) * q.v * dt * boost; q.y += Math.sin(q.a) * q.v * dt * boost;
        const k = 1 - q.age / q.life;
        c.fillStyle = `hsla(${p.h + q.hue},${Math.round(p.s * 100)}%,${Math.round(60 + 15 * S.treb)}%,${k * 0.9})`;
        c.beginPath(); c.arc(q.x, q.y, q.s * this.dpr * (1 + S.treb * 1.5) * (0.5 + k), 0, TAU); c.fill();
      }
      c.globalCompositeOperation = 'source-over';
    }

    drawBars(w, h) {
      const c = this.ctx, S = this.s, p = this.pal;
      c.globalCompositeOperation = 'source-over'; c.fillStyle = 'rgba(3,4,8,.3)'; c.fillRect(0, 0, w, h);
      const n = 64, total = w * 0.84, slot = total / n, bw = slot * 0.62, x0 = (w - total) / 2, base = h * 0.62;
      for (let i = 0; i < n; i++) {
        const v = this.spec[Math.min(NB - 1, Math.floor((i / n) * NB))];
        const bh = h * 0.42 * Math.pow(v, 0.9) * (1 + S.beat * 0.12) + 4 * this.dpr;
        const x = x0 + i * slot, col = `hsl(${p.h + (i / n) * 80 - 20},${Math.round(p.s * 100)}%,${Math.round(58 + 10 * v)}%)`;
        c.fillStyle = col; c.beginPath(); c.roundRect(x, base - bh, bw, bh, bw / 2); c.fill();
        c.globalAlpha = 0.18; c.beginPath(); c.roundRect(x, base + 4 * this.dpr, bw, bh * 0.55, bw / 2); c.fill(); c.globalAlpha = 1;
      }
    }
  }

  root.FX = { EFFECTS, Engine, palette };
})(typeof self !== 'undefined' ? self : this);
