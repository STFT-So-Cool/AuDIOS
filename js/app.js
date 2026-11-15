/**
 * AudioPulse Studio - Main Application Controller
 */

document.addEventListener('DOMContentLoaded', () => {
  // 0. Verify User Authentication with MongoDB Backend
  const userProfileBar = document.getElementById('userProfileBar');
  const loggedInUsername = document.getElementById('loggedInUsername');
  const logoutBtn = document.getElementById('logoutBtn');

  fetch('/api/me')
    .then(res => res.json())
    .then(data => {
      if (!data.authenticated) {
        window.location.href = '/login.html';
      } else if (userProfileBar && loggedInUsername) {
        loggedInUsername.textContent = data.user.username;
        userProfileBar.style.display = 'flex';
      }
    })
    .catch(() => {
      // In standalone / offline mode, keep accessible
    });

  if (logoutBtn) {
    logoutBtn.addEventListener('click', async () => {
      try {
        await fetch('/api/logout', { method: 'POST' });
      } catch (err) {}
      window.location.href = '/login.html';
    });
  }

  // 1. Initialize Audio Engine & Visualizer
  const audioManager = new AudioManager();

  const waveformCanvas = document.getElementById('waveformCanvas');
  const spectrogramCanvas = document.getElementById('spectrogramCanvas');
  const timeAxisCanvas = document.getElementById('timeAxisCanvas');
  const liveMeterCanvas = document.getElementById('liveMeterCanvas');
  const tooltipEl = document.getElementById('probeTooltip');

  const visualizer = new AudioVisualizer({
    waveformCanvas,
    spectrogramCanvas,
    timeAxisCanvas,
    liveMeterCanvas,
    tooltipEl,
    audioManager,
    onSeek: targetTime => {
      audioManager.seek(targetTime);
      updateTimeDisplay(targetTime);
    }
  });

  // 2. DOM Elements
  const dropZone = document.getElementById('dropZone');
  const fileInput = document.getElementById('fileInput');
  const browseBtn = document.getElementById('browseBtn');

  // Sample Buttons
  const sampleChirp = document.getElementById('sampleChirp');
  const sampleChord = document.getElementById('sampleChord');
  const sampleDTMF = document.getElementById('sampleDTMF');
  const samplePercussion = document.getElementById('samplePercussion');
  const micRecordBtn = document.getElementById('micRecordBtn');

  // Player controls
  const playPauseBtn = document.getElementById('playPauseBtn');
  const playIcon = document.getElementById('playIcon');
  const pauseIcon = document.getElementById('pauseIcon');
  const stopBtn = document.getElementById('stopBtn');
  const loopBtn = document.getElementById('loopBtn');
  const timeDisplay = document.getElementById('timeDisplay');
  const volumeSlider = document.getElementById('volumeSlider');
  const muteBtn = document.getElementById('muteBtn');
  const muteIcon = document.getElementById('muteIcon');
  const playbackSpeed = document.getElementById('playbackSpeed');

  // Zoom controls
  const zoomInBtn = document.getElementById('zoomInBtn');
  const zoomOutBtn = document.getElementById('zoomOutBtn');
  const fitZoomBtn = document.getElementById('fitZoomBtn');

  // Analysis settings
  const channelModeSelect = document.getElementById('channelModeSelect');
  const waveformThemeSelect = document.getElementById('waveformThemeSelect');
  const colormapSelect = document.getElementById('colormapSelect');
  const scaleSelect = document.getElementById('scaleSelect');
  const fftSizeSelect = document.getElementById('fftSizeSelect');
  const windowTypeSelect = document.getElementById('windowTypeSelect');
  const minDbSlider = document.getElementById('minDbSlider');
  const maxDbSlider = document.getElementById('maxDbSlider');
  const minDbVal = document.getElementById('minDbVal');
  const maxDbVal = document.getElementById('maxDbVal');

  // Progress overlay
  const progressOverlay = document.getElementById('progressOverlay');
  const progressBar = document.getElementById('progressBar');
  const progressText = document.getElementById('progressText');

  // Export buttons
  const exportWaveformBtn = document.getElementById('exportWaveformBtn');
  const exportSpectrogramBtn = document.getElementById('exportSpectrogramBtn');
  const exportReportBtn = document.getElementById('exportReportBtn');

  // Metadata tags
  const metaContainer = document.getElementById('metaContainer');
  const metaFileName = document.getElementById('metaFileName');
  const metaDuration = document.getElementById('metaDuration');
  const metaSampleRate = document.getElementById('metaSampleRate');
  const metaChannels = document.getElementById('metaChannels');
  const metaPeak = document.getElementById('metaPeak');
  const metaRms = document.getElementById('metaRms');

  // State
  let isRecordingMic = false;
  let mediaRecorder = null;
  let micAudioChunks = [];

  /* =========================================================================
   * FILE UPLOAD & DRAG/DROP
   * ========================================================================= */

  browseBtn.addEventListener('click', () => fileInput.click());

  dropZone.addEventListener('click', e => {
    if (e.target !== browseBtn) {
      fileInput.click();
    }
  });

  dropZone.addEventListener('keydown', e => {
    if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault();
      fileInput.click();
    }
  });

  fileInput.addEventListener('change', async e => {
    const file = e.target.files[0];
    if (file) {
      await loadFile(file);
    }
  });

  ['dragenter', 'dragover'].forEach(eventName => {
    dropZone.addEventListener(eventName, e => {
      e.preventDefault();
      dropZone.classList.add('drag-active');
    });
  });

  ['dragleave', 'drop'].forEach(eventName => {
    dropZone.addEventListener(eventName, e => {
      e.preventDefault();
      dropZone.classList.remove('drag-active');
    });
  });

  dropZone.addEventListener('drop', async e => {
    const file = e.dataTransfer.files[0];
    if (file && file.type.startsWith('audio/')) {
      await loadFile(file);
    } else if (file) {
      // Even if mime-type is generic, try loading (e.g. .wav / .mp3)
      await loadFile(file);
    }
  });

  async function loadFile(file) {
    showProgress('Loading & decoding audio file...', 0);
    try {
      showProgress('Decoding audio stream...', 0.3);
      await audioManager.loadFromFile(file);
      await processAndDisplayAudio();
    } catch (err) {
      console.error(err);
      alert(`Could not load audio file "${file.name}". Please ensure it is a valid audio format (MP3, WAV, OGG, FLAC, AAC).`);
    } finally {
      hideProgress();
    }
  }

  /* =========================================================================
   * SYNTHESIZED SAMPLES
   * ========================================================================= */

  sampleChirp.addEventListener('click', async () => {
    showProgress('Generating Logarithmic Sine Sweep (25Hz - 18kHz)...', 0.2);
    try {
      await audioManager.generateChirp();
      await processAndDisplayAudio();
    } catch (err) {
      console.error(err);
      alert('Failed to generate chirp: ' + err.message);
    } finally {
      hideProgress();
    }
  });

  sampleChord.addEventListener('click', async () => {
    showProgress('Synthesizing Harmonic Chord (C-Major Overtones)...', 0.2);
    try {
      await audioManager.generateMusicalChord();
      await processAndDisplayAudio();
    } catch (err) {
      console.error(err);
      alert('Failed to generate chord: ' + err.message);
    } finally {
      hideProgress();
    }
  });

  sampleDTMF.addEventListener('click', async () => {
    showProgress('Generating DTMF Dial Tones (1-3-5-7-9-0)...', 0.2);
    try {
      await audioManager.generateDTMF();
      await processAndDisplayAudio();
    } catch (err) {
      console.error(err);
      alert('Failed to generate DTMF: ' + err.message);
    } finally {
      hideProgress();
    }
  });

  samplePercussion.addEventListener('click', async () => {
    showProgress('Synthesizing Drum Pattern & Transients...', 0.2);
    try {
      await audioManager.generatePercussion();
      await processAndDisplayAudio();
    } catch (err) {
      console.error(err);
      alert('Failed to generate percussion: ' + err.message);
    } finally {
      hideProgress();
    }
  });

  /* =========================================================================
   * MICROPHONE RECORDING
   * ========================================================================= */

  micRecordBtn.addEventListener('click', async () => {
    if (!isRecordingMic) {
      try {
        const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
        mediaRecorder = new MediaRecorder(stream);
        micAudioChunks = [];

        mediaRecorder.ondataavailable = e => {
          if (e.data.size > 0) micAudioChunks.push(e.data);
        };

        mediaRecorder.onstop = async () => {
          const audioBlob = new Blob(micAudioChunks, { type: 'audio/webm' });
          stream.getTracks().forEach(t => t.stop());
          showProgress('Decoding microphone recording...', 0.3);
          const file = new File([audioBlob], 'Microphone_Recording.webm', { type: 'audio/webm' });
          await audioManager.loadFromFile(file);
          await processAndDisplayAudio();
          hideProgress();
        };

        mediaRecorder.start();
        isRecordingMic = true;
        micRecordBtn.classList.add('recording');
        micRecordBtn.innerHTML = `
          <svg class="icon animate-pulse" viewBox="0 0 24 24" fill="currentColor">
            <rect x="6" y="6" width="12" height="12" rx="2" />
          </svg>
          Stop Recording...
        `;
      } catch (err) {
        alert('Microphone access denied or not supported in this browser.');
      }
    } else {
      if (mediaRecorder && mediaRecorder.state !== 'inactive') {
        mediaRecorder.stop();
      }
      isRecordingMic = false;
      micRecordBtn.classList.remove('recording');
      micRecordBtn.innerHTML = `
        <svg class="icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
          <path d="M12 2a3 3 0 0 0-3 3v7a3 3 0 0 0 6 0V5a3 3 0 0 0-3-3Z"/>
          <path d="M19 10v2a7 7 0 0 1-14 0v-2"/>
          <line x1="12" x2="12" y1="19" y2="22"/>
        </svg>
        Record Mic
      `;
    }
  });

  /* =========================================================================
   * AUDIO PROCESSING & METADATA DISPLAY
   * ========================================================================= */

  async function processAndDisplayAudio() {
    const meta = audioManager.metadata;
    if (!meta) return;

    // Display metadata banner
    metaContainer.classList.remove('hidden');
    metaFileName.textContent = meta.name;
    metaDuration.textContent = `${meta.duration.toFixed(2)}s`;
    metaSampleRate.textContent = `${(meta.sampleRate / 1000).toFixed(1)} kHz`;
    metaChannels.textContent = meta.numberOfChannels === 1 ? '1 (Mono)' : `${meta.numberOfChannels} (Stereo)`;
    metaPeak.textContent = `${meta.peakDb.toFixed(1)} dBFS`;
    metaRms.textContent = `${meta.rmsDb.toFixed(1)} dBFS`;

    // Disable stereo option if audio is mono
    if (meta.numberOfChannels === 1 && channelModeSelect.value === 'stereo') {
      channelModeSelect.value = 'mono';
      visualizer.channelMode = 'mono';
    }

    // Trigger visualizer pipeline with progress callback
    await visualizer.loadAudio(ratio => {
      showProgress(`Computing Short-Time Fourier Transform (${Math.round(ratio * 100)}%)...`, ratio);
    });

    // Reset playback UI
    updatePlayPauseState(false);
    updateTimeDisplay(0);
    enableControls(true);
  }

  function enableControls(enabled) {
    playPauseBtn.disabled = !enabled;
    stopBtn.disabled = !enabled;
    loopBtn.disabled = !enabled;
    zoomInBtn.disabled = !enabled;
    zoomOutBtn.disabled = !enabled;
    fitZoomBtn.disabled = !enabled;
    exportWaveformBtn.disabled = !enabled;
    exportSpectrogramBtn.disabled = !enabled;
    exportReportBtn.disabled = !enabled;
  }

  /* =========================================================================
   * PLAYBACK CONTROLS
   * ========================================================================= */

  playPauseBtn.addEventListener('click', () => {
    if (!audioManager.audioBuffer) return;
    if (audioManager.isPlaying) {
      audioManager.pause();
      updatePlayPauseState(false);
    } else {
      audioManager.play();
      updatePlayPauseState(true);
    }
  });

  stopBtn.addEventListener('click', () => {
    audioManager.stop();
    visualizer.setPlayhead(0);
    updatePlayPauseState(false);
    updateTimeDisplay(0);
  });

  loopBtn.addEventListener('click', () => {
    const isLooping = !audioManager.isLooping;
    audioManager.setLoop(isLooping);
    loopBtn.classList.toggle('active', isLooping);
  });

  volumeSlider.addEventListener('input', e => {
    const val = parseFloat(e.target.value);
    audioManager.setVolume(val);
    if (audioManager.isMuted && val > 0) {
      audioManager.toggleMute();
      muteBtn.classList.remove('muted');
    }
  });

  muteBtn.addEventListener('click', () => {
    const isMuted = audioManager.toggleMute();
    muteBtn.classList.toggle('muted', isMuted);
    if (isMuted) {
      muteIcon.innerHTML = `
        <polygon points="11 5 6 9 2 9 2 15 6 15 11 19 11 5" />
        <line x1="23" y1="9" x2="17" y2="15" />
        <line x1="17" y1="9" x2="23" y2="15" />
      `;
    } else {
      muteIcon.innerHTML = `
        <polygon points="11 5 6 9 2 9 2 15 6 15 11 19 11 5" />
        <path d="M19.07 4.93a10 10 0 0 1 0 14.14M15.54 8.46a5 5 0 0 1 0 7.07" />
      `;
    }
  });

  playbackSpeed.addEventListener('change', e => {
    const rate = parseFloat(e.target.value);
    audioManager.setPlaybackRate(rate);
  });

  audioManager.onPlaybackUpdate = time => {
    visualizer.setPlayhead(time);
    updateTimeDisplay(time);
  };

  audioManager.onPlaybackEnded = () => {
    updatePlayPauseState(false);
  };

  function updatePlayPauseState(isPlaying) {
    if (isPlaying) {
      playIcon.style.display = 'none';
      pauseIcon.style.display = 'block';
      playPauseBtn.setAttribute('aria-label', 'Pause audio');
      playPauseBtn.title = 'Pause (Space)';
    } else {
      playIcon.style.display = 'block';
      pauseIcon.style.display = 'none';
      playPauseBtn.setAttribute('aria-label', 'Play audio');
      playPauseBtn.title = 'Play (Space)';
    }
  }

  function updateTimeDisplay(current) {
    const dur = audioManager.audioBuffer ? audioManager.audioBuffer.duration : 0;
    timeDisplay.textContent = `${formatTime(current)} / ${formatTime(dur)}`;
  }

  function formatTime(sec) {
    const mins = Math.floor(sec / 60);
    const secs = (sec % 60).toFixed(2);
    return `${mins}:${secs.padStart(5, '0')}`;
  }

  /* =========================================================================
   * ZOOM & VIEWPORT BUTTONS
   * ========================================================================= */

  zoomInBtn.addEventListener('click', () => visualizer.zoom(0.7, 0.5));
  zoomOutBtn.addEventListener('click', () => visualizer.zoom(1.4, 0.5));
  fitZoomBtn.addEventListener('click', () => visualizer.resetZoom());

  /* =========================================================================
   * VISUALIZATION SETTINGS
   * ========================================================================= */

  channelModeSelect.addEventListener('change', async e => {
    visualizer.channelMode = e.target.value;
    showProgress('Recomputing channel spectrogram...', 0.5);
    await visualizer.computeSpectrogram();
    visualizer.render();
    hideProgress();
  });

  waveformThemeSelect.addEventListener('change', e => {
    visualizer.waveformColorTheme = e.target.value;
    visualizer.renderWaveform();
  });

  colormapSelect.addEventListener('change', e => {
    visualizer.spectrogramColormap = e.target.value;
    visualizer.render();
  });

  scaleSelect.addEventListener('change', e => {
    visualizer.spectrogramScale = e.target.value;
    visualizer.render();
  });

  fftSizeSelect.addEventListener('change', async e => {
    visualizer.fftSize = parseInt(e.target.value, 10);
    showProgress(`Recomputing STFT with FFT size ${visualizer.fftSize}...`, 0.2);
    await visualizer.computeSpectrogram(ratio => showProgress(`Computing STFT (${Math.round(ratio * 100)}%)...`, ratio));
    visualizer.render();
    hideProgress();
  });

  windowTypeSelect.addEventListener('change', async e => {
    visualizer.windowType = e.target.value;
    showProgress(`Applying ${e.target.value.toUpperCase()} window...`, 0.2);
    await visualizer.computeSpectrogram(ratio => showProgress(`Computing STFT (${Math.round(ratio * 100)}%)...`, ratio));
    visualizer.render();
    hideProgress();
  });

  minDbSlider.addEventListener('input', e => {
    const val = parseInt(e.target.value, 10);
    if (val >= visualizer.maxDb) {
      e.target.value = visualizer.maxDb - 5;
      return;
    }
    visualizer.minDb = val;
    minDbVal.textContent = `${val} dB`;
    visualizer._buildOffscreenSpectrogram();
    visualizer.renderSpectrogram();
  });

  maxDbSlider.addEventListener('input', e => {
    const val = parseInt(e.target.value, 10);
    if (val <= visualizer.minDb) {
      e.target.value = visualizer.minDb + 5;
      return;
    }
    visualizer.maxDb = val;
    maxDbVal.textContent = `${val} dB`;
    visualizer._buildOffscreenSpectrogram();
    visualizer.renderSpectrogram();
  });

  /* =========================================================================
   * EXPORT BUTTONS
   * ========================================================================= */

  function triggerDownload(dataUrl, filename) {
    const link = document.createElement('a');
    link.download = filename;
    link.href = dataUrl;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  }

  exportWaveformBtn.addEventListener('click', () => {
    const dataUrl = visualizer.exportImage('waveform');
    triggerDownload(dataUrl, `waveform_${Date.now()}.png`);
  });

  exportSpectrogramBtn.addEventListener('click', () => {
    const dataUrl = visualizer.exportImage('spectrogram');
    triggerDownload(dataUrl, `spectrogram_${Date.now()}.png`);
  });

  exportReportBtn.addEventListener('click', () => {
    const dataUrl = visualizer.exportImage('report');
    triggerDownload(dataUrl, `audio_analysis_report_${Date.now()}.png`);
  });

  /* =========================================================================
   * KEYBOARD SHORTCUTS
   * ========================================================================= */

  window.addEventListener('keydown', e => {
    // Avoid interfering with inputs/selects
    if (['INPUT', 'SELECT', 'TEXTAREA'].includes(e.target.tagName)) return;

    switch (e.code) {
      case 'Space':
        e.preventDefault();
        playPauseBtn.click();
        break;
      case 'KeyM':
        muteBtn.click();
        break;
      case 'ArrowLeft':
        e.preventDefault();
        audioManager.seek(visualizer.playheadTime - (e.shiftKey ? 5 : 1));
        break;
      case 'ArrowRight':
        e.preventDefault();
        audioManager.seek(visualizer.playheadTime + (e.shiftKey ? 5 : 1));
        break;
      case 'Equal':
      case 'NumpadAdd':
        e.preventDefault();
        visualizer.zoom(0.7, 0.5);
        break;
      case 'Minus':
      case 'NumpadSubtract':
        e.preventDefault();
        visualizer.zoom(1.4, 0.5);
        break;
      case 'KeyF':
      case 'Escape':
        visualizer.resetZoom();
        break;
    }
  });

  /* =========================================================================
   * PROGRESS OVERLAY HELPERS
   * ========================================================================= */

  let progressSafetyTimer = null;

  function showProgress(text, ratio = 0) {
    if (progressSafetyTimer) clearTimeout(progressSafetyTimer);
    progressOverlay.classList.remove('hidden');
    progressText.textContent = text;
    progressBar.style.width = `${Math.min(100, Math.max(0, ratio * 100))}%`;

    // Safety timeout: automatically dismiss if any task unexpectedly hangs
    progressSafetyTimer = setTimeout(() => {
      hideProgress();
    }, 10000);
  }

  function hideProgress() {
    if (progressSafetyTimer) {
      clearTimeout(progressSafetyTimer);
      progressSafetyTimer = null;
    }
    progressOverlay.classList.add('hidden');
    progressBar.style.width = '0%';
  }

  const closeProgressBtn = document.getElementById('closeProgressBtn');
  if (closeProgressBtn) {
    closeProgressBtn.addEventListener('click', hideProgress);
  }

  // Allow clicking overlay backdrop or pressing Escape to dismiss
  progressOverlay.addEventListener('click', e => {
    if (e.target === progressOverlay) hideProgress();
  });
});
