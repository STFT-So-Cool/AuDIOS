/**
 * High-performance FFT and STFT (Short-Time Fourier Transform) Engine
 * for Audio Waveform and Spectrogram Analysis.
 */

class FFTEngine {
  constructor() {
    this._cache = new Map();
  }

  /**
   * Precomputes bit-reversal indices and trigonometric tables for a given FFT size.
   */
  _getTables(n) {
    if (this._cache.has(n)) {
      return this._cache.get(n);
    }

    const levels = Math.round(Math.log2(n));
    if (1 << levels !== n) {
      throw new Error(`FFT size must be a power of 2, received ${n}`);
    }

    const bitRev = new Uint32Array(n);
    for (let i = 0; i < n; i++) {
      let rev = 0;
      for (let j = 0; j < levels; j++) {
        rev = (rev << 1) | ((i >> j) & 1);
      }
      bitRev[i] = rev;
    }

    const cosTable = new Float32Array(n / 2);
    const sinTable = new Float32Array(n / 2);
    for (let i = 0; i < n / 2; i++) {
      const angle = (-2 * Math.PI * i) / n;
      cosTable[i] = Math.cos(angle);
      sinTable[i] = Math.sin(angle);
    }

    const tables = { bitRev, cosTable, sinTable, levels };
    this._cache.set(n, tables);
    return tables;
  }

  /**
   * Generates a window function of specified length.
   * Types: 'hann', 'hamming', 'blackman', 'rectangular'
   */
  static getWindow(size, type = 'hann') {
    const win = new Float32Array(size);
    const nMinus1 = size - 1;

    switch (type.toLowerCase()) {
      case 'hamming':
        for (let i = 0; i < size; i++) {
          win[i] = 0.54 - 0.46 * Math.cos((2 * Math.PI * i) / nMinus1);
        }
        break;
      case 'blackman':
        for (let i = 0; i < size; i++) {
          win[i] =
            0.42 -
            0.5 * Math.cos((2 * Math.PI * i) / nMinus1) +
            0.08 * Math.cos((4 * Math.PI * i) / nMinus1);
        }
        break;
      case 'rectangular':
        win.fill(1.0);
        break;
      case 'hann':
      default:
        for (let i = 0; i < size; i++) {
          win[i] = 0.5 * (1 - Math.cos((2 * Math.PI * i) / nMinus1));
        }
        break;
    }
    return win;
  }

  /**
   * In-place Cooley-Tukey Radix-2 Decimation-in-Time FFT.
   * @param {Float32Array} real Real component array (length must be power of 2)
   * @param {Float32Array} imag Imaginary component array (length must be power of 2)
   */
  transform(real, imag) {
    const n = real.length;
    const { bitRev, cosTable, sinTable } = this._getTables(n);

    // Bit-reversal permutation
    for (let i = 0; i < n; i++) {
      const j = bitRev[i];
      if (i < j) {
        const tr = real[i];
        real[i] = real[j];
        real[j] = tr;

        const ti = imag[i];
        imag[i] = imag[j];
        imag[j] = ti;
      }
    }

    // Cooley-Tukey butterfly stages
    for (let len = 2; len <= n; len <<= 1) {
      const half = len >> 1;
      const step = n / len;

      for (let i = 0; i < n; i += len) {
        for (let j = 0; j < half; j++) {
          const tableIdx = j * step;
          const wr = cosTable[tableIdx];
          const wi = sinTable[tableIdx];

          const k = i + j + half;
          const vr = real[k] * wr - imag[k] * wi;
          const vi = real[k] * wi + imag[k] * wr;

          const ur = real[i + j];
          const ui = imag[i + j];

          real[i + j] = ur + vr;
          imag[i + j] = ui + vi;
          real[k] = ur - vr;
          imag[k] = ui - vi;
        }
      }
    }
  }

  /**
   * Computes Short-Time Fourier Transform (STFT) with progress reporting.
   * Returns a 2D array of decibel magnitudes [frameIndex][freqBin].
   */
  async computeSTFT(audioSamples, options = {}, onProgress = null) {
    const fftSize = options.fftSize || 1024;
    const hopSize = options.hopSize || Math.floor(fftSize / 2);
    const windowType = options.windowType || 'hann';
    const minDb = options.minDb !== undefined ? options.minDb : -80;
    const maxDb = options.maxDb !== undefined ? options.maxDb : 0;

    const sampleCount = audioSamples.length;
    if (sampleCount < fftSize) {
      throw new Error(`Audio sample count (${sampleCount}) is smaller than FFT size (${fftSize})`);
    }

    const numFrames = Math.floor((sampleCount - fftSize) / hopSize) + 1;
    const numBins = fftSize / 2; // single-sided spectrum (0 to Nyquist)

    // Precompute window and tables
    const window = FFTEngine.getWindow(fftSize, windowType);
    this._getTables(fftSize);

    // STFT frames: Float32Array per frame for memory efficiency
    const frames = new Array(numFrames);
    const real = new Float32Array(fftSize);
    const imag = new Float32Array(fftSize);

    let globalMinDb = Infinity;
    let globalMaxDb = -Infinity;

    // Process in chunks to prevent UI freeze and support progress reporting
    const chunkSize = 200;
    for (let startIdx = 0; startIdx < numFrames; startIdx += chunkSize) {
      const endIdx = Math.min(startIdx + chunkSize, numFrames);

      for (let frameIdx = startIdx; frameIdx < endIdx; frameIdx++) {
        const offset = frameIdx * hopSize;

        // Apply window function
        for (let i = 0; i < fftSize; i++) {
          real[i] = audioSamples[offset + i] * window[i];
          imag[i] = 0;
        }

        // Run FFT
        this.transform(real, imag);

        // Compute magnitude and decibels for bins 0 to numBins-1
        const frameBins = new Float32Array(numBins);
        const normFactor = 2.0 / fftSize; // Amplitude scaling for single-sided spectrum

        for (let k = 0; k < numBins; k++) {
          const r = real[k];
          const im = imag[k];
          let mag = Math.sqrt(r * r + im * im) * normFactor;
          if (k === 0) mag *= 0.5; // DC bin not doubled

          const safeMag = Math.max(mag, 1e-6);
          const db = 20 * Math.log10(safeMag);

          if (db < globalMinDb) globalMinDb = db;
          if (db > globalMaxDb) globalMaxDb = db;

          frameBins[k] = db;
        }

        frames[frameIdx] = frameBins;
      }

      if (onProgress && typeof onProgress === 'function') {
        const ratio = endIdx / numFrames;
        onProgress(ratio);
        // Yield to browser event loop
        await new Promise(resolve => setTimeout(resolve, 0));
      }
    }

    return {
      frames,
      numFrames,
      numBins,
      fftSize,
      hopSize,
      globalMinDb,
      globalMaxDb,
      minDb,
      maxDb,
      windowType
    };
  }
}

/**
 * Colormaps library providing smooth perceptual color palettes for spectrogram rendering.
 */
class Colormaps {
  static get PALETTES() {
    return ['viridis', 'magma', 'inferno', 'plasma', 'turbo', 'electric', 'matrix', 'grayscale'];
  }

  static getColormapTable(name = 'viridis') {
    if (!Colormaps._cache) Colormaps._cache = {};
    const key = name.toLowerCase();
    if (Colormaps._cache[key]) return Colormaps._cache[key];

    const table = new Uint8Array(256 * 3);

    for (let i = 0; i < 256; i++) {
      const t = i / 255;
      const [r, g, b] = Colormaps._sampleColormap(key, t);
      table[i * 3] = Math.min(255, Math.max(0, Math.round(r * 255)));
      table[i * 3 + 1] = Math.min(255, Math.max(0, Math.round(g * 255)));
      table[i * 3 + 2] = Math.min(255, Math.max(0, Math.round(b * 255)));
    }

    Colormaps._cache[key] = table;
    return table;
  }

  static _sampleColormap(name, t) {
    switch (name) {
      case 'magma':
        return Colormaps._magma(t);
      case 'inferno':
        return Colormaps._inferno(t);
      case 'plasma':
        return Colormaps._plasma(t);
      case 'turbo':
        return Colormaps._turbo(t);
      case 'electric':
        return Colormaps._electric(t);
      case 'matrix':
        return Colormaps._matrix(t);
      case 'grayscale':
        return [t, t, t];
      case 'viridis':
      default:
        return Colormaps._viridis(t);
    }
  }

  // Viridis approximation polynomial
  static _viridis(t) {
    const c0 = [0.2777, 0.0055, 0.3341];
    const c1 = [0.1051, 1.4046, 1.3846];
    const c2 = [-0.3309, 0.2149, 0.0952];
    const c3 = [-4.6342, -5.7291, -5.7709];
    const c4 = [6.2283, 6.1704, 6.1362];
    const c5 = [-2.4257, -1.9791, -1.9427];

    const r = c0[0] + t * (c1[0] + t * (c2[0] + t * (c3[0] + t * (c4[0] + t * c5[0]))));
    const g = c0[1] + t * (c1[1] + t * (c2[1] + t * (c3[1] + t * (c4[1] + t * c5[1]))));
    const b = c0[2] + t * (c1[2] + t * (c2[2] + t * (c3[2] + t * (c4[2] + t * c5[2]))));
    return [r, g, b];
  }

  // Magma approximation polynomial
  static _magma(t) {
    const r = Math.min(1, Math.max(0, -0.002 + t * (1.109 + t * (2.298 + t * (-4.815 + t * 2.428)))));
    const g = Math.min(1, Math.max(0, 0.001 + t * (0.012 + t * (1.706 + t * (-2.613 + t * 1.895)))));
    const b = Math.min(1, Math.max(0, 0.015 + t * (2.138 + t * (-6.452 + t * (8.544 + t * -3.498)))));
    return [r, g, b];
  }

  // Inferno
  static _inferno(t) {
    const r = Math.min(1, Math.max(0, 0.001 + t * (0.812 + t * (2.955 + t * (-5.242 + t * 2.492)))));
    const g = Math.min(1, Math.max(0, 0.001 + t * (0.005 + t * (1.171 + t * (-1.536 + t * 1.365)))));
    const b = Math.min(1, Math.max(0, 0.015 + t * (1.859 + t * (-6.942 + t * (9.585 + t * -4.135)))));
    return [r, g, b];
  }

  // Plasma
  static _plasma(t) {
    const r = Math.min(1, Math.max(0, 0.059 + t * (2.368 + t * (-3.298 + t * 1.884))));
    const g = Math.min(1, Math.max(0, 0.012 + t * (0.428 + t * (0.334 + t * 0.168))));
    const b = Math.min(1, Math.max(0, 0.534 + t * (1.528 + t * (-5.672 + t * 3.731))));
    return [r, g, b];
  }

  // Google Turbo colormap
  static _turbo(t) {
    const r = 0.1357 + t * (4.5874 + t * (-42.3083 + t * (130.587 + t * (-150.5639 + t * 58.1375))));
    const g = 0.0914 + t * (2.1942 + t * (4.8087 + t * (-25.6209 + t * (37.3548 + t * -17.9885))));
    const b = 0.1067 + t * (12.5926 + t * (-60.1912 + t * (109.0745 + t * (-88.5067 + t * 26.8169))));
    return [Math.min(1, Math.max(0, r)), Math.min(1, Math.max(0, g)), Math.min(1, Math.max(0, b))];
  }

  // Electric Cyan Neon (Dark navy -> bright cyan -> white)
  static _electric(t) {
    if (t < 0.3) {
      const f = t / 0.3;
      return [0.03 * f, 0.08 * f, 0.35 * f + 0.05];
    } else if (t < 0.75) {
      const f = (t - 0.3) / 0.45;
      return [0.03 + 0.15 * f, 0.08 + 0.85 * f, 0.40 + 0.60 * f];
    } else {
      const f = (t - 0.75) / 0.25;
      return [0.18 + 0.82 * f, 0.93 + 0.07 * f, 1.0];
    }
  }

  // Matrix green
  static _matrix(t) {
    if (t < 0.2) {
      const f = t / 0.2;
      return [0.0, 0.15 * f, 0.02 * f];
    } else if (t < 0.8) {
      const f = (t - 0.2) / 0.6;
      return [0.1 * f, 0.15 + 0.85 * f, 0.05 + 0.15 * f];
    } else {
      const f = (t - 0.8) / 0.2;
      return [0.1 + 0.9 * f, 1.0, 0.2 + 0.8 * f];
    }
  }
}

// Export for ES modules, browser global, and Node environment
if (typeof window !== 'undefined') {
  window.FFTEngine = FFTEngine;
  window.Colormaps = Colormaps;
}
if (typeof global !== 'undefined') {
  global.FFTEngine = FFTEngine;
  global.Colormaps = Colormaps;
}
if (typeof module !== 'undefined' && module.exports) {
  module.exports = { FFTEngine, Colormaps };
}
