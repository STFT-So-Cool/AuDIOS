# AudioPulse Studio — Audio Waveform & Spectrogram Analyzer

An interactive, high-performance web application designed for audio analysis, featuring synchronized **Waveform** and **STFT Spectrogram** plots, full playback controls, zoom/pan navigation, real-time frequency inspection, and export options.

## Features

- 📁 **Universal Audio File Input**:
  - Drag-and-drop or browse files (`.mp3`, `.wav`, `.ogg`, `.flac`, `.aac`, `.m4a`).
  - Web Audio API hardware-accelerated decoding.
- ⚡ **Instant Demo Audio Synthesizers**:
  - **Logarithmic Chirp / Sine Sweep** (25 Hz to 18 kHz): Classic diagnostic sweep showcasing a diagonal spectrogram signature.
  - **Harmonic Chords (C Major Triad with Overtones)**: Shows discrete horizontal harmonic bands.
  - **DTMF Dial Tones**: Demonstrates dual-frequency pairs.
  - **Drum Transients**: Shows broadband percussion bursts and low-frequency kicks.
  - **Live Microphone Recording**: Record directly through your microphone.
- 🌊 **High-Fidelity Waveform Plot**:
  - Dual-mode visualization: sample-accurate continuous waveforms when zoomed in, peak/RMS envelope when zoomed out.
  - Channel routing: Mixed Mono, Split Stereo (Left / Right), Left Only, Right Only.
  - Color themes: Neon Cyan, Amber Glow, Matrix Green, Sunset Violet.
  - Amplitude grid lines (+1.0, +0.5, 0.0, -0.5, -1.0 dBFS) and zero-crossing indicator.
- 🌈 **STFT Spectrogram Plot**:
  - In-place Cooley-Tukey Radix-2 Fast Fourier Transform with precomputed twiddle and bit-reversal lookup tables.
  - Window functions: **Hann**, **Hamming**, **Blackman**, and **Rectangular**.
  - Configurable FFT sizes: 512, 1024, 2048, and 4096.
  - Color palettes: **Viridis**, **Magma**, **Plasma**, **Inferno**, **Google Turbo**, **Electric Cyan**, **Matrix Green**, and **Grayscale**.
  - Frequency scaling: **Linear** (Hz) or **Logarithmic** (Perceptual / Octave).
  - Dynamic range controls: Adjustable Min dB and Max dB floor/ceiling sliders.
- 🔍 **Interactive Probe Tooltip**:
  - Hovering over the waveform shows exact timestamp and amplitude.
  - Hovering over the spectrogram shows timestamp, exact frequency (Hz/kHz), nearest musical note (e.g. A4, C5), and power in decibels (dB).
- 🧭 **Synchronized Navigation**:
  - Real-time playhead synchronized across both Waveform and Spectrogram.
  - Mouse wheel zoom in/out centered around the cursor.
  - Click or drag anywhere on either canvas to scrub / seek audio.
  - Shift + Drag to pan across the timeline.
- 📊 **Real-time Live Meter**:
  - Live frequency spectrum meter during audio playback.
- 💾 **Export Capabilities**:
  - Export Waveform as PNG.
  - Export Spectrogram as PNG.
  - Export Full High-Resolution Combined Analysis Report (includes metadata, waveform, and spectrogram).

## Running the Website Locally

## Authentication & Database

- 🔐 **Log In / Sign Up**: Simple, clean authentication without OTP verification.
- 🗄️ **MongoDB Database**: Automatically manages users and sessions in `mongodb://127.0.0.1:27017/audiopulse_db`.
  - Passwords are securely hashed with `bcryptjs`.
  - HTTP-only cookie-based sessions with 7-day automatic TTL expiration.
- 👤 **Session Display**: Displays the logged-in user in the studio header with one-click Log Out.

## Running the Application

### Option 1: Full App with MongoDB Authentication (Recommended)
Make sure MongoDB is running (default port 27017), then:
```bash
npm start
# or: node server.js
```
Open **[http://localhost:3000](http://localhost:3000)** in your browser. Unauthenticated visits will direct you to the clean Log In / Sign Up page.

### Option 2: Standalone Static Server (No Auth)
```bash
python -m http.server 8080
```
Open `http://localhost:8080/index.html`.

## Keyboard Shortcuts

| Key | Action |
| --- | --- |
| `Space` | Play / Pause |
| `Click / Drag` | Seek to timestamp |
| `Shift + Drag` | Pan timeline |
| `Mouse Wheel` or `+` / `-` | Zoom In / Out |
| `F` or `Escape` | Reset / Fit View |
| `Left / Right Arrow` | Seek ±1 second |
| `M` | Mute / Unmute |
