/**
 * Visualizer: Orchestrates high-fidelity canvas rendering for
 * Waveform, Spectrogram, Axes, Playhead, and Real-time Analysers.
 */

class AudioVisualizer {
  constructor(options = {}) {
    this.waveformCanvas = options.waveformCanvas;
    this.spectrogramCanvas = options.spectrogramCanvas;
    this.timeAxisCanvas = options.timeAxisCanvas;
    this.liveMeterCanvas = options.liveMeterCanvas;
    this.tooltipEl = options.tooltipEl;

    this.audioManager = options.audioManager;
    this.fftEngine = new FFTEngine();

    // Viewport state (in seconds)
    this.viewStart = 0;
    this.viewEnd = 1.0;
    this.duration = 1.0;

    // Display configuration
    this.channelMode = 'mono'; // 'mono', 'stereo', 'left', 'right'
    this.waveformColorTheme = 'cyan'; // 'cyan', 'amber', 'emerald', 'sunset'
    this.spectrogramColormap = 'viridis'; // 'viridis', 'magma', 'inferno', 'plasma', 'turbo', 'electric', 'matrix', 'grayscale'
    this.spectrogramScale = 'linear'; // 'linear' or 'log'
    this.fftSize = 1024;
    this.windowType = 'hann';
    this.minDb = -80;
    this.maxDb = 0;

    // STFT cache
    this.stftData = null;
    this.offscreenSpectrogram = null;
    this.offscreenScaleType = null;
    this.offscreenColormap = null;
    this.isComputingSTFT = false;

    // Interaction state
    this.isDragging = false;
    this.isPanning = false;
    this.lastMouseX = 0;
    this.hoverPos = null; // { x, y, canvas: 'waveform' | 'spectrogram' }
    this.playheadTime = 0;

    // Callback on seek
    this.onSeek = options.onSeek || null;

    this._setupCanvases();
    this._setupEventListeners();
  }

  _setupCanvases() {
    this._resizeCanvases();
    window.addEventListener('resize', () => {
      this._resizeCanvases();
      this.render();
    });
  }

  _resizeCanvases() {
    const canvases = [
      this.waveformCanvas,
      this.spectrogramCanvas,
      this.timeAxisCanvas,
      this.liveMeterCanvas
    ].filter(Boolean);

    const dpr = window.devicePixelRatio || 1;

    canvases.forEach(canvas => {
      const rect = canvas.getBoundingClientRect();
      const width = Math.max(1, Math.floor(rect.width));
      const height = Math.max(1, Math.floor(rect.height));

      if (canvas.width !== width * dpr || canvas.height !== height * dpr) {
        canvas.width = width * dpr;
        canvas.height = height * dpr;
      }
    });
  }

  _setupEventListeners() {
    const canvases = [this.waveformCanvas, this.spectrogramCanvas].filter(Boolean);

    canvases.forEach(canvas => {
      // Seek / scrub on click & drag
      canvas.addEventListener('mousedown', e => {
        if (e.button === 1 || e.shiftKey) {
          // Middle click or Shift + click => Pan mode
          this.isPanning = true;
          this.lastMouseX = e.clientX;
          canvas.style.cursor = 'grabbing';
          e.preventDefault();
          return;
        }

        if (e.button === 0) {
          // Left click => Seek
          this.isDragging = true;
          this._handleSeekFromMouse(canvas, e.clientX);
        }
      });

      canvas.addEventListener('mousemove', e => {
        const rect = canvas.getBoundingClientRect();
        const clientX = e.clientX;
        const clientY = e.clientY;
        const relX = clientX - rect.left;
        const relY = clientY - rect.top;

        this.hoverPos = {
          x: relX,
          y: relY,
          width: rect.width,
          height: rect.height,
          canvas: canvas === this.waveformCanvas ? 'waveform' : 'spectrogram'
        };

        if (this.isPanning) {
          const deltaX = clientX - this.lastMouseX;
          this.lastMouseX = clientX;
          const range = this.viewEnd - this.viewStart;
          const shiftSec = -(deltaX / rect.width) * range;
          this.pan(shiftSec);
        } else if (this.isDragging) {
          this._handleSeekFromMouse(canvas, clientX);
        } else {
          this._updateTooltip(this.hoverPos);
          this.render();
        }
      });

      canvas.addEventListener('mouseleave', () => {
        this.hoverPos = null;
        if (this.tooltipEl) {
          this.tooltipEl.style.display = 'none';
        }
        this.render();
      });

      // Mouse wheel zoom
      canvas.addEventListener(
        'wheel',
        e => {
          e.preventDefault();
          const rect = canvas.getBoundingClientRect();
          const mouseFrac = Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width));
          const zoomFactor = e.deltaY < 0 ? 0.8 : 1.25;
          this.zoom(zoomFactor, mouseFrac);
        },
        { passive: false }
      );
    });

    window.addEventListener('mouseup', () => {
      this.isDragging = false;
      this.isPanning = false;
      if (this.waveformCanvas) this.waveformCanvas.style.cursor = 'crosshair';
      if (this.spectrogramCanvas) this.spectrogramCanvas.style.cursor = 'crosshair';
    });
  }

  _handleSeekFromMouse(canvas, clientX) {
    const rect = canvas.getBoundingClientRect();
    const frac = Math.max(0, Math.min(1, (clientX - rect.left) / rect.width));
    const targetTime = this.viewStart + frac * (this.viewEnd - this.viewStart);

    this.playheadTime = targetTime;
    if (this.onSeek) {
      this.onSeek(targetTime);
    }
    this.render();
  }

  /* =========================================================================
   * ZOOM & PAN METHODS
   * ========================================================================= */

  zoom(factor, centerFrac = 0.5) {
    if (this.duration <= 0) return;

    const currentRange = this.viewEnd - this.viewStart;
    const centerTime = this.viewStart + centerFrac * currentRange;
    const minRange = Math.max(0.005, this.duration * 0.001); // Maximum zoom: 5ms
    const maxRange = this.duration;

    let newRange = currentRange * factor;
    newRange = Math.max(minRange, Math.min(maxRange, newRange));

    let newStart = centerTime - centerFrac * newRange;
    let newEnd = newStart + newRange;

    if (newStart < 0) {
      newStart = 0;
      newEnd = Math.min(this.duration, newRange);
    }
    if (newEnd > this.duration) {
      newEnd = this.duration;
      newStart = Math.max(0, this.duration - newRange);
    }

    this.viewStart = newStart;
    this.viewEnd = newEnd;
    this.render();
  }

  pan(shiftSec) {
    if (this.duration <= 0) return;

    const range = this.viewEnd - this.viewStart;
    let newStart = this.viewStart + shiftSec;
    let newEnd = this.viewEnd + shiftSec;

    if (newStart < 0) {
      newStart = 0;
      newEnd = range;
    }
    if (newEnd > this.duration) {
      newEnd = this.duration;
      newStart = Math.max(0, this.duration - range);
    }

    this.viewStart = newStart;
    this.viewEnd = newEnd;
    this.render();
  }

  resetZoom() {
    this.viewStart = 0;
    this.viewEnd = this.duration || 1.0;
    this.render();
  }

  /* =========================================================================
   * DATA LOADING & RECOMPUTATION
   * ========================================================================= */

  async loadAudio(onProgress = null) {
    const meta = this.audioManager.metadata;
    if (!meta) return;

    this.duration = meta.duration;
    this.viewStart = 0;
    this.viewEnd = this.duration;
    this.playheadTime = 0;

    await this.computeSpectrogram(onProgress);
    this.render();
  }

  async computeSpectrogram(onProgress = null) {
    const meta = this.audioManager.metadata;
    if (!meta) return;

    this.isComputingSTFT = true;
    const channelData = this.audioManager.getChannelData(this.channelMode);

    try {
      this.stftData = await this.fftEngine.computeSTFT(
        channelData,
        {
          fftSize: this.fftSize,
          hopSize: Math.max(64, Math.floor(this.fftSize / 2)),
          windowType: this.windowType,
          minDb: this.minDb,
          maxDb: this.maxDb
        },
        onProgress
      );

      this._buildOffscreenSpectrogram();
    } catch (err) {
      console.error('Spectrogram computation error:', err);
    } finally {
      this.isComputingSTFT = false;
    }
  }

  /**
   * Generates offscreen canvas image containing pre-rendered STFT colormap pixels.
   */
  _buildOffscreenSpectrogram() {
    if (!this.stftData) return;

    const { frames, numFrames, numBins, minDb, maxDb } = this.stftData;
    if (!numFrames || numFrames <= 0 || !frames) return;

    const meta = this.audioManager.metadata;
    const sampleRate = meta ? meta.sampleRate : 44100;
    const nyquist = sampleRate / 2;

    const colormap = Colormaps.getColormapTable(this.spectrogramColormap);
    const isLog = this.spectrogramScale === 'log';

    // Offscreen canvas dimensions
    const width = numFrames;
    const height = 512; // High vertical frequency resolution
    const canvas = document.createElement('canvas');
    canvas.width = width;
    canvas.height = height;
    const ctx = canvas.getContext('2d');
    const imgData = ctx.createImageData(width, height);
    const data = imgData.data;

    const fMin = 20.0;
    const fMax = nyquist;
    const logRatio = Math.log(fMax / fMin);
    const dbRange = maxDb - minDb || 1;

    for (let x = 0; x < width; x++) {
      const frame = frames[x];
      if (!frame) continue;

      for (let y = 0; y < height; y++) {
        // y = 0 is top (highest frequency), y = height - 1 is bottom (lowest frequency)
        const vFrac = 1 - y / (height - 1); // 0 at bottom, 1 at top
        let freq;
        if (isLog) {
          freq = fMin * Math.exp(vFrac * logRatio);
        } else {
          freq = vFrac * nyquist;
        }

        const bin = Math.min(numBins - 1, Math.max(0, (freq / nyquist) * numBins));
        const binLow = Math.floor(bin);
        const binHigh = Math.min(numBins - 1, binLow + 1);
        const frac = bin - binLow;

        const db = frame[binLow] * (1 - frac) + frame[binHigh] * frac;
        const norm = Math.min(1.0, Math.max(0.0, (db - minDb) / dbRange));
        const colorIdx = Math.floor(norm * 255) * 3;

        const pixelIdx = (y * width + x) * 4;
        data[pixelIdx] = colormap[colorIdx];
        data[pixelIdx + 1] = colormap[colorIdx + 1];
        data[pixelIdx + 2] = colormap[colorIdx + 2];
        data[pixelIdx + 3] = 255;
      }
    }

    ctx.putImageData(imgData, 0, 0);
    this.offscreenSpectrogram = canvas;
    this.offscreenScaleType = this.spectrogramScale;
    this.offscreenColormap = this.spectrogramColormap;
  }

  /* =========================================================================
   * RENDERING PIPELINE
   * ========================================================================= */

  render() {
    this._resizeCanvases();
    this.renderWaveform();
    this.renderSpectrogram();
    this.renderTimeAxis();
    this.renderLiveMeters();
  }

  setPlayhead(time) {
    this.playheadTime = time;

    // Auto-scroll if playback moves beyond current visible viewport
    if (this.audioManager.isPlaying) {
      const range = this.viewEnd - this.viewStart;
      if (this.playheadTime > this.viewEnd) {
        this.viewStart = this.playheadTime;
        this.viewEnd = this.viewStart + range;
        if (this.viewEnd > this.duration) {
          this.viewEnd = this.duration;
          this.viewStart = Math.max(0, this.duration - range);
        }
      } else if (this.playheadTime < this.viewStart) {
        this.viewStart = this.playheadTime;
        this.viewEnd = this.viewStart + range;
      }
    }

    this.render();
  }

  /**
   * Renders high-fidelity Waveform Plot.
   */
  renderWaveform() {
    if (!this.waveformCanvas) return;
    const canvas = this.waveformCanvas;
    const ctx = canvas.getContext('2d');
    const dpr = window.devicePixelRatio || 1;
    const width = canvas.width;
    const height = canvas.height;

    ctx.clearRect(0, 0, width, height);

    // Background
    ctx.fillStyle = '#0f172a';
    ctx.fillRect(0, 0, width, height);

    const meta = this.audioManager.metadata;
    if (!meta) {
      this._renderEmptyState(ctx, width, height, 'Upload an audio file or select a sample above');
      return;
    }

    const { sampleRate } = meta;
    const totalSamples = meta.length;
    const duration = meta.duration;

    const startSec = Math.max(0, this.viewStart);
    const endSec = Math.min(duration, this.viewEnd);
    const visibleRange = endSec - startSec;
    if (visibleRange <= 0) return;

    // Amplitude grid lines
    ctx.strokeStyle = 'rgba(255, 255, 255, 0.08)';
    ctx.lineWidth = 1 * dpr;

    const ampLines = [1.0, 0.5, 0.0, -0.5, -1.0];
    ctx.font = `${10 * dpr}px Inter, system-ui, sans-serif`;
    ctx.fillStyle = 'rgba(255, 255, 255, 0.35)';
    ctx.textAlign = 'left';
    ctx.textBaseline = 'middle';

    ampLines.forEach(amp => {
      const y = (0.5 - amp * 0.45) * height;
      ctx.beginPath();
      ctx.moveTo(0, y);
      ctx.lineTo(width, y);
      ctx.stroke();

      if (amp !== 0) {
        ctx.fillText((amp > 0 ? '+' : '') + amp.toFixed(1), 8 * dpr, y);
      } else {
        ctx.fillText(' 0.0', 8 * dpr, y);
      }
    });

    // Zero-crossing center line
    ctx.strokeStyle = 'rgba(255, 255, 255, 0.2)';
    ctx.beginPath();
    ctx.moveTo(0, height * 0.5);
    ctx.lineTo(width, height * 0.5);
    ctx.stroke();

    // Render channels
    const isStereoMode = this.channelMode === 'stereo' && meta.numberOfChannels > 1;
    if (isStereoMode) {
      // Split into top (Left) and bottom (Right)
      this._renderWaveformChannel(ctx, meta.ch0, 0, 0, width, height / 2, startSec, endSec, 'L (Left)');
      this._renderWaveformChannel(ctx, meta.ch1, 0, height / 2, width, height / 2, startSec, endSec, 'R (Right)');
    } else {
      const channelData = this.audioManager.getChannelData(this.channelMode);
      this._renderWaveformChannel(ctx, channelData, 0, 0, width, height, startSec, endSec);
    }

    // Playhead line
    this._renderPlayheadLine(ctx, width, height);

    // Hover line
    if (this.hoverPos && this.hoverPos.canvas === 'waveform') {
      this._renderHoverGuide(ctx, this.hoverPos.x * dpr, height);
    }
  }

  _renderWaveformChannel(ctx, data, offsetX, offsetY, w, h, startSec, endSec, label = '') {
    if (!data) return;
    const dpr = window.devicePixelRatio || 1;
    const meta = this.audioManager.metadata;
    const sampleRate = meta.sampleRate;
    const centerY = offsetY + h * 0.5;
    const halfH = h * 0.45;

    const startSample = Math.floor(startSec * sampleRate);
    const endSample = Math.min(data.length, Math.floor(endSec * sampleRate));
    const rangeSamples = endSample - startSample;
    if (rangeSamples <= 0) return;

    // Theme colors
    let topColor, bottomColor, strokeColor;
    switch (this.waveformColorTheme) {
      case 'amber':
        topColor = 'rgba(245, 158, 11, 0.65)';
        bottomColor = 'rgba(217, 119, 6, 0.2)';
        strokeColor = '#FBBF24';
        break;
      case 'emerald':
        topColor = 'rgba(16, 185, 129, 0.65)';
        bottomColor = 'rgba(5, 150, 105, 0.2)';
        strokeColor = '#34D399';
        break;
      case 'sunset':
        topColor = 'rgba(236, 72, 153, 0.65)';
        bottomColor = 'rgba(139, 92, 246, 0.2)';
        strokeColor = '#F472B6';
        break;
      case 'cyan':
      default:
        topColor = 'rgba(6, 182, 212, 0.65)';
        bottomColor = 'rgba(14, 116, 144, 0.2)';
        strokeColor = '#38BDF8';
        break;
    }

    const minEnvelope = new Float32Array(w);
    const maxEnvelope = new Float32Array(w);
    const samplesPerPixel = rangeSamples / w;

    if (samplesPerPixel > 1) {
      // Downsampled Peak / RMS Envelope
      for (let px = 0; px < w; px++) {
        const pStart = Math.floor(startSample + px * samplesPerPixel);
        const pEnd = Math.min(data.length, Math.floor(startSample + (px + 1) * samplesPerPixel));

        let minVal = 0;
        let maxVal = 0;
        for (let s = pStart; s < pEnd; s++) {
          const val = data[s];
          if (val < minVal) minVal = val;
          if (val > maxVal) maxVal = val;
        }
        minEnvelope[px] = minVal;
        maxEnvelope[px] = maxVal;
      }

      // Draw gradient filled envelope
      const grad = ctx.createLinearGradient(0, centerY - halfH, 0, centerY + halfH);
      grad.addColorStop(0, topColor);
      grad.addColorStop(0.5, bottomColor);
      grad.addColorStop(1, topColor);

      ctx.fillStyle = grad;
      ctx.beginPath();
      for (let px = 0; px < w; px++) {
        const yTop = centerY - maxEnvelope[px] * halfH;
        if (px === 0) ctx.moveTo(offsetX + px, yTop);
        else ctx.lineTo(offsetX + px, yTop);
      }
      for (let px = w - 1; px >= 0; px--) {
        const yBottom = centerY - minEnvelope[px] * halfH;
        ctx.lineTo(offsetX + px, yBottom);
      }
      ctx.closePath();
      ctx.fill();

      // Top & Bottom boundary glow lines
      ctx.strokeStyle = strokeColor;
      ctx.lineWidth = 1 * dpr;

      ctx.beginPath();
      for (let px = 0; px < w; px++) {
        const yTop = centerY - maxEnvelope[px] * halfH;
        if (px === 0) ctx.moveTo(offsetX + px, yTop);
        else ctx.lineTo(offsetX + px, yTop);
      }
      ctx.stroke();

      ctx.beginPath();
      for (let px = 0; px < w; px++) {
        const yBottom = centerY - minEnvelope[px] * halfH;
        if (px === 0) ctx.moveTo(offsetX + px, yBottom);
        else ctx.lineTo(offsetX + px, yBottom);
      }
      ctx.stroke();
    } else {
      // Zoomed in down to sample-accurate continuous waveform
      ctx.strokeStyle = strokeColor;
      ctx.lineWidth = 1.5 * dpr;
      ctx.beginPath();

      for (let px = 0; px < w; px++) {
        const sIdx = Math.floor(startSample + px * samplesPerPixel);
        if (sIdx >= data.length) break;
        const val = data[sIdx];
        const y = centerY - val * halfH;
        if (px === 0) ctx.moveTo(offsetX + px, y);
        else ctx.lineTo(offsetX + px, y);
      }
      ctx.stroke();

      // Sample dots if heavily zoomed in
      if (samplesPerPixel < 0.25) {
        ctx.fillStyle = '#FFFFFF';
        for (let s = startSample; s < endSample; s++) {
          const px = ((s - startSample) / rangeSamples) * w;
          const y = centerY - data[s] * halfH;
          ctx.beginPath();
          ctx.arc(offsetX + px, y, 2.5 * dpr, 0, Math.PI * 2);
          ctx.fill();
        }
      }
    }

    // Channel label (if stereo)
    if (label) {
      ctx.fillStyle = 'rgba(255, 255, 255, 0.7)';
      ctx.font = `bold ${11 * dpr}px Inter, sans-serif`;
      ctx.fillText(label, offsetX + 12 * dpr, offsetY + 18 * dpr);
    }
  }

  /**
   * Renders Spectrogram Plot.
   */
  renderSpectrogram() {
    if (!this.spectrogramCanvas) return;
    const canvas = this.spectrogramCanvas;
    const ctx = canvas.getContext('2d');
    const dpr = window.devicePixelRatio || 1;
    const width = canvas.width;
    const height = canvas.height;

    ctx.clearRect(0, 0, width, height);

    if (this.isComputingSTFT) {
      this._renderLoadingState(ctx, width, height, 'Analyzing frequencies (STFT)...');
      return;
    }

    if (!this.stftData || !this.offscreenSpectrogram) {
      this._renderEmptyState(ctx, width, height, 'Spectrogram will appear once audio is loaded');
      return;
    }

    // Check if offscreen cache needs rebuild (e.g. user toggled scale or colormap)
    if (
      this.offscreenScaleType !== this.spectrogramScale ||
      this.offscreenColormap !== this.spectrogramColormap
    ) {
      this._buildOffscreenSpectrogram();
    }

    const duration = this.duration;
    const startSec = Math.max(0, this.viewStart);
    const endSec = Math.min(duration, this.viewEnd);
    const visibleRange = endSec - startSec;
    if (visibleRange <= 0) return;

    // Map time range to source offscreen coordinates
    const offW = this.offscreenSpectrogram.width;
    const offH = this.offscreenSpectrogram.height;

    const srcX = (startSec / duration) * offW;
    const srcW = (visibleRange / duration) * offW;

    // Draw offscreen spectrogram into main canvas with bilinear filtering
    ctx.imageSmoothingEnabled = true;
    ctx.imageSmoothingQuality = 'medium';
    ctx.drawImage(this.offscreenSpectrogram, srcX, 0, srcW, offH, 0, 0, width, height);

    // Overlay frequency grid lines and axis ticks
    this._renderFrequencyGrid(ctx, width, height);

    // Playhead line
    this._renderPlayheadLine(ctx, width, height);

    // Hover crosshair
    if (this.hoverPos && this.hoverPos.canvas === 'spectrogram') {
      this._renderHoverGuide(ctx, this.hoverPos.x * dpr, height);
      this._renderHorizontalGuide(ctx, this.hoverPos.y * dpr, width);
    }
  }

  _renderFrequencyGrid(ctx, width, height) {
    const dpr = window.devicePixelRatio || 1;
    const meta = this.audioManager.metadata;
    const nyquist = meta ? meta.sampleRate / 2 : 22050;
    const isLog = this.spectrogramScale === 'log';

    ctx.font = `${10 * dpr}px Inter, system-ui, sans-serif`;
    ctx.textAlign = 'right';
    ctx.textBaseline = 'middle';

    let freqTicks = [];
    if (isLog) {
      freqTicks = [100, 250, 500, 1000, 2000, 4000, 8000, 16000];
      if (nyquist >= 20000) freqTicks.push(20000);
    } else {
      const step = nyquist > 12000 ? 4000 : 2000;
      for (let f = step; f < nyquist; f += step) {
        freqTicks.push(f);
      }
    }

    const fMin = 20.0;
    const logRatio = Math.log(nyquist / fMin);

    freqTicks.forEach(freq => {
      let vFrac;
      if (isLog) {
        vFrac = Math.log(freq / fMin) / logRatio;
      } else {
        vFrac = freq / nyquist;
      }

      const y = (1.0 - vFrac) * height;
      if (y < 12 * dpr || y > height - 12 * dpr) return;

      // Subtle horizontal line
      ctx.strokeStyle = 'rgba(255, 255, 255, 0.15)';
      ctx.lineWidth = 1 * dpr;
      ctx.beginPath();
      ctx.moveTo(0, y);
      ctx.lineTo(width, y);
      ctx.stroke();

      // Label background badge for readability
      const label = freq >= 1000 ? `${freq / 1000} kHz` : `${freq} Hz`;
      const textWidth = ctx.measureText(label).width;

      ctx.fillStyle = 'rgba(15, 23, 42, 0.75)';
      ctx.fillRect(width - textWidth - 14 * dpr, y - 8 * dpr, textWidth + 8 * dpr, 16 * dpr);

      ctx.fillStyle = 'rgba(255, 255, 255, 0.85)';
      ctx.fillText(label, width - 10 * dpr, y);
    });
  }

  /**
   * Renders Time Ruler Axis below the spectrogram.
   */
  renderTimeAxis() {
    if (!this.timeAxisCanvas) return;
    const canvas = this.timeAxisCanvas;
    const ctx = canvas.getContext('2d');
    const dpr = window.devicePixelRatio || 1;
    const width = canvas.width;
    const height = canvas.height;

    ctx.clearRect(0, 0, width, height);

    ctx.fillStyle = '#0B0F19';
    ctx.fillRect(0, 0, width, height);

    const startSec = this.viewStart;
    const endSec = this.viewEnd;
    const range = endSec - startSec;
    if (range <= 0) return;

    // Pick nice time interval for ticks
    const targetTickPixels = 100 * dpr;
    const numTicks = Math.max(2, Math.floor(width / targetTickPixels));
    const rawStep = range / numTicks;

    const niceSteps = [0.001, 0.005, 0.01, 0.05, 0.1, 0.25, 0.5, 1, 2, 5, 10, 30, 60, 120, 300];
    let step = niceSteps.find(s => s >= rawStep) || 600;

    const firstTick = Math.ceil(startSec / step) * step;

    ctx.strokeStyle = 'rgba(255, 255, 255, 0.2)';
    ctx.fillStyle = 'rgba(255, 255, 255, 0.5)';
    ctx.font = `${10 * dpr}px Inter, monospace, sans-serif`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'top';

    for (let t = firstTick; t <= endSec; t += step) {
      const x = ((t - startSec) / range) * width;

      ctx.beginPath();
      ctx.moveTo(x, 0);
      ctx.lineTo(x, 6 * dpr);
      ctx.stroke();

      const label = this._formatTimeTick(t, step);
      ctx.fillText(label, x, 8 * dpr);
    }
  }

  _formatTimeTick(sec, step) {
    if (step < 0.01) {
      return `${(sec * 1000).toFixed(1)}ms`;
    }
    const mins = Math.floor(sec / 60);
    const secs = (sec % 60).toFixed(step < 0.1 ? 3 : step < 1 ? 2 : 1);
    if (mins > 0) {
      return `${mins}:${secs.padStart(step < 1 ? 5 : 4, '0')}`;
    }
    return `${secs}s`;
  }

  /**
   * Renders Playhead Line on canvas.
   */
  _renderPlayheadLine(ctx, width, height) {
    const range = this.viewEnd - this.viewStart;
    if (range <= 0) return;

    if (this.playheadTime < this.viewStart || this.playheadTime > this.viewEnd) return;

    const dpr = window.devicePixelRatio || 1;
    const x = ((this.playheadTime - this.viewStart) / range) * width;

    // Glowing vertical playhead bar
    ctx.save();
    ctx.shadowColor = '#38BDF8';
    ctx.shadowBlur = 8 * dpr;
    ctx.strokeStyle = '#FFFFFF';
    ctx.lineWidth = 2 * dpr;

    ctx.beginPath();
    ctx.moveTo(x, 0);
    ctx.lineTo(x, height);
    ctx.stroke();
    ctx.restore();

    // Small triangular handle at top
    ctx.fillStyle = '#38BDF8';
    ctx.beginPath();
    ctx.moveTo(x - 5 * dpr, 0);
    ctx.lineTo(x + 5 * dpr, 0);
    ctx.lineTo(x, 7 * dpr);
    ctx.closePath();
    ctx.fill();
  }

  _renderHoverGuide(ctx, x, height) {
    const dpr = window.devicePixelRatio || 1;
    ctx.save();
    ctx.setLineDash([4 * dpr, 4 * dpr]);
    ctx.strokeStyle = 'rgba(255, 255, 255, 0.45)';
    ctx.lineWidth = 1 * dpr;
    ctx.beginPath();
    ctx.moveTo(x, 0);
    ctx.lineTo(x, height);
    ctx.stroke();
    ctx.restore();
  }

  _renderHorizontalGuide(ctx, y, width) {
    const dpr = window.devicePixelRatio || 1;
    ctx.save();
    ctx.setLineDash([4 * dpr, 4 * dpr]);
    ctx.strokeStyle = 'rgba(255, 255, 255, 0.45)';
    ctx.lineWidth = 1 * dpr;
    ctx.beginPath();
    ctx.moveTo(0, y);
    ctx.lineTo(width, y);
    ctx.stroke();
    ctx.restore();
  }

  /**
   * Tooltip inspector on hover (shows Time, Amplitude on waveform; Time, Frequency, dB on spectrogram).
   */
  _updateTooltip(pos) {
    if (!this.tooltipEl || !pos) return;

    const range = this.viewEnd - this.viewStart;
    if (range <= 0) return;

    const fracX = Math.max(0, Math.min(1, pos.x / pos.width));
    const time = this.viewStart + fracX * range;

    const meta = this.audioManager.metadata;
    const nyquist = meta ? meta.sampleRate / 2 : 22050;

    let contentHtml = '';

    if (pos.canvas === 'waveform') {
      const fracY = pos.y / pos.height;
      const amp = (0.5 - fracY) / 0.45;
      const ampClamped = Math.max(-1, Math.min(1, amp));
      const ampDb = Math.abs(ampClamped) > 0 ? (20 * Math.log10(Math.abs(ampClamped))).toFixed(1) : '-∞';

      contentHtml = `
        <div class="tt-header">Waveform Probe</div>
        <div class="tt-row"><span>Time:</span> <strong>${time.toFixed(3)}s</strong></div>
        <div class="tt-row"><span>Amplitude:</span> <strong>${(ampClamped > 0 ? '+' : '') + ampClamped.toFixed(3)}</strong> (${ampDb} dBFS)</div>
      `;
    } else if (pos.canvas === 'spectrogram') {
      const fracY = Math.max(0, Math.min(1, pos.y / pos.height));
      const vFrac = 1.0 - fracY;

      let freq;
      if (this.spectrogramScale === 'log') {
        const fMin = 20.0;
        freq = fMin * Math.exp(vFrac * Math.log(nyquist / fMin));
      } else {
        freq = vFrac * nyquist;
      }

      // Look up dB value if STFT data is available
      let dbStr = 'N/A';
      if (this.stftData) {
        const { frames, numFrames, numBins, hopSize } = this.stftData;
        const frameIdx = Math.min(numFrames - 1, Math.max(0, Math.floor((time * meta.sampleRate) / hopSize)));
        const binIdx = Math.min(numBins - 1, Math.max(0, Math.round((freq / nyquist) * numBins)));
        if (frames[frameIdx] && frames[frameIdx][binIdx] !== undefined) {
          dbStr = `${frames[frameIdx][binIdx].toFixed(1)} dB`;
        }
      }

      const note = this._freqToNote(freq);

      contentHtml = `
        <div class="tt-header">Spectrogram Probe</div>
        <div class="tt-row"><span>Time:</span> <strong>${time.toFixed(3)}s</strong></div>
        <div class="tt-row"><span>Frequency:</span> <strong>${freq >= 1000 ? (freq / 1000).toFixed(2) + ' kHz' : Math.round(freq) + ' Hz'}</strong> ${note ? `<span class="tt-note">(${note})</span>` : ''}</div>
        <div class="tt-row"><span>Magnitude:</span> <strong>${dbStr}</strong></div>
      `;
    }

    this.tooltipEl.innerHTML = contentHtml;
    this.tooltipEl.style.display = 'block';

    // Position tooltip near cursor with boundary clamping
    const targetCanvas = pos.canvas === 'waveform' ? this.waveformCanvas : this.spectrogramCanvas;
    const canvasRect = targetCanvas.getBoundingClientRect();
    const ttWidth = 190;
    const ttHeight = 85;

    let left = canvasRect.left + pos.x + 15;
    let top = canvasRect.top + pos.y - 45;

    if (left + ttWidth > window.innerWidth - 10) {
      left = canvasRect.left + pos.x - ttWidth - 15;
    }
    if (top < 10) top = canvasRect.top + pos.y + 15;

    this.tooltipEl.style.left = `${left}px`;
    this.tooltipEl.style.top = `${top}px`;
  }

  _freqToNote(freq) {
    if (freq < 20 || freq > 8000) return '';
    const noteNames = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'];
    const midi = Math.round(69 + 12 * Math.log2(freq / 440));
    if (midi < 0 || midi > 127) return '';
    const noteName = noteNames[midi % 12];
    const octave = Math.floor(midi / 12) - 1;
    return `${noteName}${octave}`;
  }

  /**
   * Renders real-time live analyser meters (Oscilloscope & FFT Spectrum) during playback.
   */
  renderLiveMeters() {
    if (!this.liveMeterCanvas) return;
    const canvas = this.liveMeterCanvas;
    const ctx = canvas.getContext('2d');
    const dpr = window.devicePixelRatio || 1;
    const width = canvas.width;
    const height = canvas.height;

    ctx.clearRect(0, 0, width, height);

    ctx.fillStyle = '#0B0F19';
    ctx.fillRect(0, 0, width, height);

    const liveData = this.audioManager.getLiveAnalysisData();
    if (!liveData || !this.audioManager.isPlaying) {
      ctx.fillStyle = 'rgba(255, 255, 255, 0.3)';
      ctx.font = `${10 * dpr}px Inter, sans-serif`;
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText('Live Spectrum Meter (Inactive - Press Play to stream)', width / 2, height / 2);
      return;
    }

    const { freqData } = liveData;
    const barCount = Math.min(freqData.length, Math.floor(width / (3 * dpr)));
    const barWidth = width / barCount;

    // Draw Frequency Spectrum Bars
    for (let i = 0; i < barCount; i++) {
      const db = freqData[i]; // typically -100 to 0 dB
      const norm = Math.max(0, Math.min(1, (db + 90) / 90));
      const barH = norm * height;

      // Color based on height
      const r = Math.round(20 + 235 * norm);
      const g = Math.round(180 - 60 * norm);
      const b = Math.round(240 - 200 * norm);

      ctx.fillStyle = `rgb(${r}, ${g}, ${b})`;
      ctx.fillRect(i * barWidth, height - barH, barWidth - 1 * dpr, barH);
    }
  }

  _renderEmptyState(ctx, width, height, text) {
    const dpr = window.devicePixelRatio || 1;
    ctx.fillStyle = 'rgba(255, 255, 255, 0.4)';
    ctx.font = `${13 * dpr}px Inter, system-ui, sans-serif`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(text, width / 2, height / 2);
  }

  _renderLoadingState(ctx, width, height, text) {
    const dpr = window.devicePixelRatio || 1;
    ctx.fillStyle = '#0F172A';
    ctx.fillRect(0, 0, width, height);

    ctx.fillStyle = '#38BDF8';
    ctx.font = `bold ${14 * dpr}px Inter, sans-serif`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(text, width / 2, height / 2);
  }

  /**
   * Exports an image (PNG) of the requested canvas view or combined report.
   */
  exportImage(type = 'waveform') {
    if (type === 'waveform') {
      return this.waveformCanvas.toDataURL('image/png');
    } else if (type === 'spectrogram') {
      return this.spectrogramCanvas.toDataURL('image/png');
    } else if (type === 'report') {
      // Create a combined high-resolution canvas report
      const meta = this.audioManager.metadata;
      const reportCanvas = document.createElement('canvas');
      const w = 1600;
      const h = 1100;
      reportCanvas.width = w;
      reportCanvas.height = h;
      const ctx = reportCanvas.getContext('2d');

      // Dark background
      ctx.fillStyle = '#080C14';
      ctx.fillRect(0, 0, w, h);

      // Header Banner
      ctx.fillStyle = '#38BDF8';
      ctx.font = 'bold 24px -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif';
      ctx.fillText('AudioPulse — Signal Analysis Report', 40, 50);

      // Metadata info
      ctx.fillStyle = 'rgba(255, 255, 255, 0.7)';
      ctx.font = '13px -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif';
      const metaText = meta
        ? `Track: ${meta.name}  |  Duration: ${meta.duration.toFixed(2)}s  |  Sample Rate: ${meta.sampleRate} Hz  |  Channels: ${meta.numberOfChannels}  |  Peak: ${meta.peakDb.toFixed(1)} dBFS`
        : 'No Audio Metadata';
      ctx.fillText(metaText, 40, 80);

      // Waveform section header
      ctx.fillStyle = '#F8FAFC';
      ctx.font = 'bold 15px -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif';
      ctx.fillText('Waveform (Time Domain Signal)', 40, 125);
      ctx.drawImage(this.waveformCanvas, 40, 140, w - 80, 400);

      // Spectrogram section header
      ctx.fillText(`Spectrogram (STFT Frequency Domain | ${this.spectrogramScale.toUpperCase()} Scale | ${this.spectrogramColormap.toUpperCase()})`, 40, 575);
      ctx.drawImage(this.spectrogramCanvas, 40, 590, w - 80, 420);

      // Footer
      ctx.fillStyle = 'rgba(255, 255, 255, 0.4)';
      ctx.font = '12px -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif';
      ctx.textAlign = 'right';
      ctx.fillText(`AudioPulse | ${new Date().toLocaleString()}`, w - 40, h - 25);

      return reportCanvas.toDataURL('image/png');
    }
  }
}

if (typeof window !== 'undefined') {
  window.AudioVisualizer = AudioVisualizer;
}
