// node test/lufs.test.js
const { measure, peaks } = require('../renderer/lufs.js');

let failed = 0;
function check(name, got, want, tol) {
  const ok = Math.abs(got - want) <= tol;
  if (!ok) failed++;
  console.log(`${ok ? 'OK  ' : 'FAIL'} ${name}: ${got.toFixed(3)} (esperado ${want} ±${tol})`);
}

function sine(fs, seconds, amp, freq = 997, startSec = 0, endSec = seconds) {
  const n = Math.round(fs * seconds);
  const x = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    const t = i / fs;
    if (t >= startSec && t < endSec) x[i] = amp * Math.sin(2 * Math.PI * freq * t);
  }
  return x;
}
const db = (d) => Math.pow(10, d / 20);

// Referencias EBU Tech 3341 / BS.1770: seno de 997 Hz.
for (const fs of [44100, 48000, 96000]) {
  const s = sine(fs, 20, db(-20));
  check(`estéreo -20 dBFS @${fs}`, measure([s, s], fs).lufs, -20.0, 0.1);
  check(`mono (1 canal) -20 dBFS @${fs}`, measure([s], fs).lufs, -23.01, 0.1);
}

// Compuerta absoluta: 10 s de tono y 10 s de silencio dan la sonoridad del tono.
{
  const fs = 48000;
  const s = sine(fs, 20, db(-23), 997, 0, 10);
  check('silencio excluido por la compuerta', measure([s, s], fs).lufs, -23.0, 0.15);
}

// Compuerta relativa: parte fuerte (-20) + parte muy baja (-45) debe medir ≈ la fuerte.
{
  const fs = 48000;
  const a = sine(fs, 10, db(-20));
  const b = sine(fs, 10, db(-45));
  const s = new Float32Array(a.length + b.length);
  s.set(a, 0); s.set(b, a.length);
  check('compuerta relativa', measure([s, s], fs).lufs, -20.0, 0.15);
}

// Pico y silencio total
{
  const fs = 48000;
  const s = sine(fs, 2, 0.5);
  check('pico de muestra', measure([s], fs).peak, 0.5, 0.001);
  const z = new Float32Array(fs * 2);
  const r = measure([z, z], fs);
  const ok = r.lufs === -Infinity;
  if (!ok) failed++;
  console.log(`${ok ? 'OK  ' : 'FAIL'} silencio total = -Infinity (${r.lufs})`);
}

// Forma de onda
{
  const x = new Float32Array([0, 0.5, -0.25, 1, -1, 0.1, 0, 0]);
  const p = peaks([x], 4);
  const ok = p.max[0] === 0.5 && p.min[0] === 0 && p.max[1] === 1 && p.min[1] === -0.25 && p.min[2] === -1 && Math.abs(p.max[2] - 0.1) < 1e-6;
  if (!ok) failed++;
  console.log(`${ok ? 'OK  ' : 'FAIL'} peaks por cubeta`, Array.from(p.min), Array.from(p.max));
}

console.log(failed ? `\n${failed} prueba(s) fallaron` : '\nTodas las pruebas pasaron');
process.exit(failed ? 1 : 0);
