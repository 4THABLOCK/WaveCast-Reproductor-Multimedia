/*
 * Medición de sonoridad (ITU-R BS.1770-4 / EBU R128) y picos para la forma de onda.
 * Funciona tanto en un Worker (importScripts) como en Node (para las pruebas).
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) {
    module.exports = factory();
  } else {
    root.Lufs = factory();
    // Permite recrear este mismo código dentro de un Worker creado desde un Blob.
    root.Lufs.factorySource = factory.toString();
  }
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  // Coeficientes del filtro K (shelf de agudos + pasa-altos) para cualquier frecuencia de muestreo.
  function kWeighting(fs) {
    const f1 = 1681.974450955533, G = 3.999843853973347, Q1 = 0.7071752369554196;
    let K = Math.tan(Math.PI * f1 / fs);
    const Vh = Math.pow(10, G / 20);
    const Vb = Math.pow(Vh, 0.4996667741545416);
    let a0 = 1 + K / Q1 + K * K;
    const s1 = {
      b0: (Vh + Vb * K / Q1 + K * K) / a0,
      b1: 2 * (K * K - Vh) / a0,
      b2: (Vh - Vb * K / Q1 + K * K) / a0,
      a1: 2 * (K * K - 1) / a0,
      a2: (1 - K / Q1 + K * K) / a0,
    };
    const f2 = 38.13547087602444, Q2 = 0.5003270373238773;
    K = Math.tan(Math.PI * f2 / fs);
    a0 = 1 + K / Q2 + K * K;
    const s2 = {
      b0: 1, b1: -2, b2: 1,
      a1: 2 * (K * K - 1) / a0,
      a2: (1 - K / Q2 + K * K) / a0,
    };
    return { s1, s2 };
  }

  function channelWeights(n) {
    if (n === 6) return [1, 1, 1, 0, 1.41, 1.41];
    if (n === 5) return [1, 1, 1, 1.41, 1.41];
    const w = [];
    for (let i = 0; i < n; i++) w.push(1);
    return w;
  }

  // Sonoridad integrada (LUFS) con compuertas absoluta (-70) y relativa (-10).
  // channels: array de Float32Array. Devuelve { lufs, peak } (peak = pico de muestra, 0..1+).
  function measure(channels, fs) {
    const nch = channels.length;
    const n = nch ? channels[0].length : 0;
    if (!n) return { lufs: -Infinity, peak: 0 };

    const { s1, s2 } = kWeighting(fs);
    const seg = Math.max(1, Math.round(0.1 * fs));       // paso de 100 ms
    const nseg = Math.floor(n / seg);
    const weights = channelWeights(nch);
    const segE = new Float64Array(Math.max(nseg, 1));    // energía ponderada por segmento
    let peak = 0;
    let totalE = 0;                                      // por si el audio dura < 400 ms

    for (let c = 0; c < nch; c++) {
      const x = channels[c];
      const w = weights[c];
      let x1 = 0, x2 = 0, y1 = 0, y2 = 0;                // etapa 1
      let u1 = 0, u2 = 0, z1 = 0, z2 = 0;                // etapa 2
      let acc = 0, k = 0, pos = 0, whole = 0;
      for (let i = 0; i < n; i++) {
        const s = x[i];
        const a = s < 0 ? -s : s;
        if (a > peak) peak = a;
        const y = s1.b0 * s + s1.b1 * x1 + s1.b2 * x2 - s1.a1 * y1 - s1.a2 * y2;
        x2 = x1; x1 = s; y2 = y1; y1 = y;
        const z = s2.b0 * y + s2.b1 * u1 + s2.b2 * u2 - s2.a1 * z1 - s2.a2 * z2;
        u2 = u1; u1 = y; z2 = z1; z1 = z;
        const sq = z * z;
        acc += sq;
        whole += sq;
        if (++pos === seg) {
          if (k < nseg) segE[k] += w * acc / seg;
          k++; acc = 0; pos = 0;
        }
      }
      totalE += w * whole / n;
    }

    const toLufs = (e) => (e > 0 ? -0.691 + 10 * Math.log10(e) : -Infinity);

    if (nseg < 4) return { lufs: toLufs(totalE), peak };  // clip muy corto: sin compuertas

    const nb = nseg - 3;                                   // bloques de 400 ms, solapados 75 %
    const E = new Float64Array(nb);
    for (let b = 0; b < nb; b++) E[b] = (segE[b] + segE[b + 1] + segE[b + 2] + segE[b + 3]) / 4;

    let sum = 0, cnt = 0;
    const absGate = Math.pow(10, (-70 + 0.691) / 10);
    for (let b = 0; b < nb; b++) if (E[b] > absGate) { sum += E[b]; cnt++; }
    if (!cnt) return { lufs: -Infinity, peak };

    const relGate = Math.pow(10, (toLufs(sum / cnt) - 10 + 0.691) / 10);
    sum = 0; cnt = 0;
    for (let b = 0; b < nb; b++) if (E[b] > absGate && E[b] > relGate) { sum += E[b]; cnt++; }
    return { lufs: cnt ? toLufs(sum / cnt) : -Infinity, peak };
  }

  // Máximos y mínimos por "cubeta" (entre todos los canales) para dibujar la onda tal cual es.
  function peaks(channels, buckets) {
    const n = channels.length ? channels[0].length : 0;
    const min = new Float32Array(buckets);
    const max = new Float32Array(buckets);
    if (!n) return { min, max };
    for (let b = 0; b < buckets; b++) {
      const i0 = Math.floor(b * n / buckets);
      const i1 = Math.max(i0 + 1, Math.floor((b + 1) * n / buckets));
      let lo = 0, hi = 0;
      for (let c = 0; c < channels.length; c++) {
        const x = channels[c];
        for (let i = i0; i < i1 && i < n; i++) {
          const s = x[i];
          if (s < lo) lo = s;
          if (s > hi) hi = s;
        }
      }
      min[b] = lo; max[b] = hi;
    }
    return { min, max };
  }

  return { measure, peaks, kWeighting };
});
