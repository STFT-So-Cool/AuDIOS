class AudioManager {
  constructor() {
    this.ctx = null;
    this.audioBuffer = null;
    this.sourceNode = null;
    this.gainNode = null;
    this.analyserNode = null;

    this.isPlaying = false;
    this.playbackStartTime = 0;
    this.playbackOffset = 0;
    this.playbackRate = 1.0;
    this.volume = 1.0;
    this.isMuted = false;
    this.isLooping = false;

    this.metadata = null;
    this.onPlaybackUpdate = null;
    this.onPlaybackEnded = null;
    this._rafId = null;
  }

  ensureAudioContext() {
    if (!this.ctx) {
      const AudioCtx = window.AudioContext || window.webkitAudioContext;
      this.ctx = new AudioCtx();

      this.gainNode = this.ctx.createGain();
      this.gainNode.gain.value = this.volume;

      this.analyserNode = this.ctx.createAnalyser();
      this.analyserNode.fftSize = 1024;
      this.analyserNode.smoothingTimeConstant = 0.8;

      this.gainNode.connect(this.analyserNode);
      this.analyserNode.connect(this.ctx.destination);
    }
    return this.ctx;
  }

  async loadFromFile(file) {
    this.ensureAudioContext();
    this.stop();

    const arrayBuffer = await file.arrayBuffer();
    const audioBuffer = await this.ctx.decodeAudioData(arrayBuffer);
    return this._setAudioBuffer(audioBuffer, file.name, file.size);
  }

  async loadAudioBuffer(audioBuffer, name = 'Synthesized Audio') {
    this.ensureAudioContext();
    this.stop();
    return this._setAudioBuffer(audioBuffer, name, audioBuffer.length * 4);
  }

  _setAudioBuffer(audioBuffer, name, sizeInBytes) {
    this.audioBuffer = audioBuffer;
    this.playbackOffset = 0;

    const numChannels = audioBuffer.numberOfChannels;
    const sampleRate = audioBuffer.sampleRate;
    const duration = audioBuffer.duration;
    const length = audioBuffer.length;

    let peak = 0;
    let maxVal = -Infinity;
    let minVal = Infinity;
    let sumSquares = 0;

    const ch0 = audioBuffer.getChannelData(0);
    const hasStereo = numChannels > 1;
    const ch1 = hasStereo ? audioBuffer.getChannelData(1) : null;
    const monoData = new Float32Array(length);

    for (let i = 0; i < length; i++) {
      const sample = hasStereo ? (ch0[i] + ch1[i]) * 0.5 : ch0[i];
      monoData[i] = sample;

      if (sample > maxVal) maxVal = sample;
      if (sample < minVal) minVal = sample;

      const abs = Math.abs(sample);
      if (abs > peak) peak = abs;
      sumSquares += sample * sample;
    }

    if (length === 0) {
      maxVal = 0;
      minVal = 0;
    }

    const rms = Math.sqrt(sumSquares / length);
    const peakToPeak = maxVal - minVal;
    const peakDb = peak > 0 ? 20 * Math.log10(peak) : -100;
    const maxValDb = Math.abs(maxVal) > 0 ? 20 * Math.log10(Math.abs(maxVal)) : -100;
    const minValDb = Math.abs(minVal) > 0 ? 20 * Math.log10(Math.abs(minVal)) : -100;
    const rmsDb = rms > 0 ? 20 * Math.log10(rms) : -100;

    this.metadata = {
      name,
      sizeBytes: sizeInBytes,
      duration,
      sampleRate,
      numberOfChannels: numChannels,
      length,
      peak,
      peakDb,
      maxVal,
      maxValDb,
      minVal,
      minValDb,
      peakToPeak,
      rms,
      rmsDb,
      monoData,
      ch0,
      ch1
    };

    return this.metadata;
  }

  getChannelData(mode = 'mono') {
    if (!this.metadata) return null;

    if (mode === 'left' || mode === '0') {
      return this.metadata.ch0;
    } else if (mode === 'right' || mode === '1') {
      return this.metadata.ch1 || this.metadata.ch0;
    } else {
      return this.metadata.monoData;
    }
  }

  async play() {
    if (!this.audioBuffer) return;
    await this.ensureAudioContext();
    if (this.ctx && this.ctx.state === 'suspended') {
      try {
        await this.ctx.resume();
      } catch (e) {
        console.warn('AudioContext resume failed:', e);
      }
    }

    if (this.isPlaying) return;

    if (this.playbackOffset >= this.audioBuffer.duration) {
      this.playbackOffset = 0;
    }

    this.sourceNode = this.ctx.createBufferSource();
    this.sourceNode.buffer = this.audioBuffer;
    this.sourceNode.playbackRate.value = this.playbackRate;
    this.sourceNode.loop = this.isLooping;

    this.sourceNode.connect(this.gainNode);

    this.playbackStartTime = this.ctx.currentTime;
    this.sourceNode.start(0, this.playbackOffset);
    this.isPlaying = true;

    this.sourceNode.onended = () => {
      if (!this.isLooping && this.isPlaying) {
        this.stop();
        if (this.onPlaybackEnded) this.onPlaybackEnded();
      }
    };

    this._startTracking();
  }

  pause() {
    if (!this.isPlaying) return;

    this.playbackOffset = this.getCurrentTime();
    this._stopSourceNode();
    this.isPlaying = false;
    this._stopTracking();

    if (this.onPlaybackUpdate) {
      this.onPlaybackUpdate(this.playbackOffset);
    }
  }

  stop() {
    this._stopSourceNode();
    this.isPlaying = false;
    this.playbackOffset = 0;
    this._stopTracking();

    if (this.onPlaybackUpdate) {
      this.onPlaybackUpdate(0);
    }
  }

  seek(targetTime) {
    if (!this.audioBuffer) return;

    const clampedTime = Math.max(0, Math.min(targetTime, this.audioBuffer.duration));
    const wasPlaying = this.isPlaying;

    if (wasPlaying) {
      this._stopSourceNode();
    }

    this.playbackOffset = clampedTime;

    if (wasPlaying) {
      this.play();
    } else if (this.onPlaybackUpdate) {
      this.onPlaybackUpdate(clampedTime);
    }
  }

  getCurrentTime() {
    if (!this.isPlaying) {
      return this.playbackOffset;
    }
    const elapsed = (this.ctx.currentTime - this.playbackStartTime) * this.playbackRate;
    let time = this.playbackOffset + elapsed;

    if (this.isLooping && this.audioBuffer) {
      time = time % this.audioBuffer.duration;
    } else if (this.audioBuffer && time > this.audioBuffer.duration) {
      time = this.audioBuffer.duration;
    }
    return time;
  }

  setVolume(val) {
    this.volume = Math.max(0, Math.min(1, val));
    if (this.gainNode && !this.isMuted) {
      this.gainNode.gain.setValueAtTime(this.volume, this.ctx.currentTime);
    }
  }

  toggleMute() {
    this.isMuted = !this.isMuted;
    if (this.gainNode) {
      const target = this.isMuted ? 0 : this.volume;
      this.gainNode.gain.setValueAtTime(target, this.ctx.currentTime);
    }
    return this.isMuted;
  }

  setPlaybackRate(rate) {
    this.playbackRate = Math.max(0.25, Math.min(4.0, rate));
    if (this.isPlaying) {
      this.playbackOffset = this.getCurrentTime();
      this.playbackStartTime = this.ctx.currentTime;
      if (this.sourceNode) {
        this.sourceNode.playbackRate.setValueAtTime(this.playbackRate, this.ctx.currentTime);
      }
    }
  }

  setLoop(loop) {
    this.isLooping = Boolean(loop);
    if (this.sourceNode) {
      this.sourceNode.loop = this.isLooping;
    }
  }

  _stopSourceNode() {
    if (this.sourceNode) {
      try {
        this.sourceNode.onended = null;
        this.sourceNode.stop();
        this.sourceNode.disconnect();
      } catch (err) {}
      this.sourceNode = null;
    }
  }

  _startTracking() {
    this._stopTracking();
    const update = () => {
      if (this.isPlaying) {
        const time = this.getCurrentTime();
        if (this.onPlaybackUpdate) {
          this.onPlaybackUpdate(time);
        }
        this._rafId = requestAnimationFrame(update);
      }
    };
    this._rafId = requestAnimationFrame(update);
  }

  _stopTracking() {
    if (this._rafId) {
      cancelAnimationFrame(this._rafId);
      this._rafId = null;
    }
  }

  getLiveAnalysisData() {
    if (!this.analyserNode) return null;

    const fftSize = this.analyserNode.fftSize;
    const timeData = new Float32Array(fftSize);
    const freqData = new Float32Array(this.analyserNode.frequencyBinCount);

    this.analyserNode.getFloatTimeDomainData(timeData);
    this.analyserNode.getFloatFrequencyData(freqData);

    return { timeData, freqData, sampleRate: this.ctx ? this.ctx.sampleRate : 44100 };
  }

  generateChirp(duration = 4.0, sampleRate = 44100) {
    const ctx = this.ensureAudioContext();
    const length = Math.floor(duration * sampleRate);
    const buffer = ctx.createBuffer(1, length, sampleRate);
    const data = buffer.getChannelData(0);

    const f0 = 25.0;
    const f1 = 18000.0;
    const k = Math.pow(f1 / f0, 1.0 / duration);

    for (let i = 0; i < length; i++) {
      const t = i / sampleRate;
      const phase = (2 * Math.PI * f0 * (Math.pow(k, t) - 1)) / Math.log(k);
      let env = 1.0;
      if (t < 0.05) env = t / 0.05;
      if (t > duration - 0.05) env = (duration - t) / 0.05;

      data[i] = 0.7 * Math.sin(phase) * env;
    }

    return this.loadAudioBuffer(buffer, 'Logarithmic Chirp (25Hz - 18kHz)');
  }

  generateMusicalChord(duration = 4.0, sampleRate = 44100) {
    const ctx = this.ensureAudioContext();
    const length = Math.floor(duration * sampleRate);
    const buffer = ctx.createBuffer(2, length, sampleRate);
    const left = buffer.getChannelData(0);
    const right = buffer.getChannelData(1);

    const notes = [261.63, 329.63, 392.0, 493.88, 523.25];
    const harmonics = [1.0, 0.5, 0.25, 0.12];

    for (let i = 0; i < length; i++) {
      const t = i / sampleRate;
      let leftSample = 0;
      let rightSample = 0;

      const env = Math.exp(-0.75 * t) * (t < 0.02 ? t / 0.02 : 1.0);

      notes.forEach((freq, nIdx) => {
        const vibrato = 1.0 + 0.003 * Math.sin(2 * Math.PI * 5 * t);
        const actualFreq = freq * vibrato;

        let noteTone = 0;
        harmonics.forEach((hGain, hIdx) => {
          const hFreq = actualFreq * (hIdx + 1);
          noteTone += hGain * Math.sin(2 * Math.PI * hFreq * t);
        });

        const pan = (nIdx / (notes.length - 1)) * 2 - 1;
        const leftPan = Math.cos(((pan + 1) * Math.PI) / 4);
        const rightPan = Math.sin(((pan + 1) * Math.PI) / 4);

        leftSample += noteTone * leftPan * 0.18;
        rightSample += noteTone * rightPan * 0.18;
      });

      left[i] = leftSample * env;
      right[i] = rightSample * env;
    }

    return this.loadAudioBuffer(buffer, 'Harmonic Chord (C-Major Overtones)');
  }

  generateDTMF(sampleRate = 44100) {
    const ctx = this.ensureAudioContext();
    const dtmfKeys = [
      { low: 697, high: 1209, key: '1' },
      { low: 697, high: 1477, key: '3' },
      { low: 770, high: 1336, key: '5' },
      { low: 852, high: 1209, key: '7' },
      { low: 852, high: 1477, key: '9' },
      { low: 941, high: 1336, key: '0' }
    ];

    const toneDuration = 0.35;
    const pauseDuration = 0.15;
    const totalDuration = dtmfKeys.length * (toneDuration + pauseDuration);
    const length = Math.floor(totalDuration * sampleRate);

    const buffer = ctx.createBuffer(1, length, sampleRate);
    const data = buffer.getChannelData(0);

    let offset = 0;
    dtmfKeys.forEach(item => {
      const toneSamples = Math.floor(toneDuration * sampleRate);
      for (let i = 0; i < toneSamples; i++) {
        const t = i / sampleRate;
        let env = 1.0;
        if (t < 0.008) env = t / 0.008;
        if (t > toneDuration - 0.008) env = (toneDuration - t) / 0.008;

        const s1 = Math.sin(2 * Math.PI * item.low * t);
        const s2 = Math.sin(2 * Math.PI * item.high * t);
        data[offset + i] = 0.45 * (s1 + s2) * env;
      }
      offset += toneSamples + Math.floor(pauseDuration * sampleRate);
    });

    return this.loadAudioBuffer(buffer, 'DTMF Phone Dial Tones (1-3-5-7-9-0)');
  }

  generatePercussion(duration = 3.5, sampleRate = 44100) {
    const ctx = this.ensureAudioContext();
    const length = Math.floor(duration * sampleRate);
    const buffer = ctx.createBuffer(1, length, sampleRate);
    const data = buffer.getChannelData(0);

    const beatSec = 0.5;
    const numBeats = Math.floor(duration / beatSec);

    for (let beat = 0; beat < numBeats; beat++) {
      const beatTime = beat * beatSec;
      const beatSample = Math.floor(beatTime * sampleRate);

      if (beat % 2 === 0) {
        const kickLen = Math.floor(0.28 * sampleRate);
        for (let i = 0; i < kickLen && beatSample + i < length; i++) {
          const t = i / sampleRate;
          const phase = 2 * Math.PI * (35 * t + (125 / -28) * (Math.exp(-28 * t) - 1));
          const env = Math.exp(-12 * t);
          data[beatSample + i] += 0.85 * Math.sin(phase) * env;
        }
      }

      if (beat % 2 === 1) {
        const snareLen = Math.floor(0.25 * sampleRate);
        for (let i = 0; i < snareLen && beatSample + i < length; i++) {
          const t = i / sampleRate;
          const tone = Math.sin(2 * Math.PI * 180 * t) * Math.exp(-20 * t);
          const noise = (Math.random() * 2 - 1) * Math.exp(-15 * t);
          data[beatSample + i] += 0.65 * (tone * 0.4 + noise * 0.6);
        }
      }

      const hihatTimes = [beatTime, beatTime + 0.25];
      hihatTimes.forEach(hTime => {
        const hSample = Math.floor(hTime * sampleRate);
        const hLen = Math.floor(0.06 * sampleRate);
        let lastNoise = 0;
        for (let i = 0; i < hLen && hSample + i < length; i++) {
          const t = i / sampleRate;
          const raw = Math.random() * 2 - 1;
          const hpNoise = raw - lastNoise * 0.85;
          lastNoise = raw;
          const env = Math.exp(-60 * t);
          data[hSample + i] += 0.35 * hpNoise * env;
        }
      });
    }

    let max = 0;
    for (let i = 0; i < length; i++) {
      if (Math.abs(data[i]) > max) max = Math.abs(data[i]);
    }
    if (max > 0.95) {
      const scale = 0.95 / max;
      for (let i = 0; i < length; i++) data[i] *= scale;
    }

    return this.loadAudioBuffer(buffer, 'Synthesized Drum Beat (120 BPM)');
  }
}

if (typeof window !== 'undefined') {
  window.AudioManager = AudioManager;
}
