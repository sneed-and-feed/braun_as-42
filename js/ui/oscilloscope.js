/**
 * @file oscilloscope.js
 * @brief Braun CRT phosphor vector oscilloscope, spectrum analyzer, and Lissajous phase goniometer.
 * Features realistic phosphor persistence decay, precision graticule, and vector beam glow.
 */

export class BraunOscilloscope {
  /**
   * @param {HTMLCanvasElement} canvas
   * @param {AnalyserNode} analyser
   */
  constructor(canvas, analyser = null) {
    if (!canvas) {
      return;
    }
    this.canvas = canvas;
    this.ctx = canvas.getContext ? canvas.getContext('2d') : null;
    this.analyser = analyser;
    this.mode = 'WAVEFORM'; // 'WAVEFORM', 'SPECTRUM', 'LISSAJOUS'
    this.isRunning = false;
    this.isPowered = false;
    this.hasNativeData = false;
    this.animationFrameId = null;

    // Buffer arrays
    const fftSize = this.analyser ? this.analyser.fftSize : 2048;
    const binCount = this.analyser ? this.analyser.frequencyBinCount : 1024;
    this.timeData = new Uint8Array(fftSize);
    this.timeData.fill(128);
    this.timeDataR = null;
    this.freqData = new Uint8Array(binCount);

    // Phosphor color: Braun vintage phosphor amber/green
    this.phosphorColor = '#24FF6A'; // Braun lab green
    this.phosphorGlow = 'rgba(36, 255, 106, 0.45)';
    this.gridColor = 'rgba(255, 255, 255, 0.08)';

    // Pre-allocate FFT scratch buffers for native spectrum mode
    this._fftReal = null;
    this._fftImag = null;

    this._resize();
    if (typeof window !== 'undefined') {
      window.addEventListener('resize', () => this._resize());
    }
    if (typeof ResizeObserver !== 'undefined' && this.canvas && this.canvas.parentElement) {
      this._resizeObserver = new ResizeObserver(() => this._resize());
      this._resizeObserver.observe(this.canvas.parentElement);
    }
  }

  setAnalyser(analyser) {
    this.analyser = analyser;
    if (this.analyser) {
      this.timeData = new Uint8Array(this.analyser.fftSize);
      this.timeData.fill(128);
      this.freqData = new Uint8Array(this.analyser.frequencyBinCount);
      this.hasNativeData = false;
      if (!this.isRunning) {
        this.start();
      }
    } else {
      this.draw();
    }
  }

  setPower(isPowered) {
    this.isPowered = Boolean(isPowered);
    this.silentFrames = 0;
    if (!this.isRunning) {
      this.start();
    }
    this.draw();
  }

  pushAudioData(dataL, dataR = null) {
    if (!dataL || dataL.length === 0) return;
    this.hasNativeData = true;

    const len = dataL.length;
    if (this.timeData.length !== len) {
      this.timeData = new Uint8Array(len);
    }
    for (let i = 0; i < len; i++) {
      this.timeData[i] = dataL[i];
    }

    if (dataR && dataR.length > 0) {
      const rLen = dataR.length;
      if (!this.timeDataR || this.timeDataR.length !== rLen) {
        this.timeDataR = new Uint8Array(rLen);
      }
      for (let i = 0; i < rLen; i++) {
        this.timeDataR[i] = dataR[i];
      }
    } else {
      this.timeDataR = null;
    }

    this.dataLength = len;

    if (!this.isPowered) {
      this.isPowered = true;
    }

    if (this.mode === 'SPECTRUM' && !this.analyser) {
      this._computeSpectrumFromTimeData();
    }

    this.silentFrames = 0;
    if (!this.isRunning) {
      this.start();
    }
  }

  _resize() {
    if (!this.canvas || !this.ctx) return;
    const rect = this.canvas.getBoundingClientRect ? this.canvas.getBoundingClientRect() : { width: 288, height: 180 };
    const dpr = (typeof window !== 'undefined' && window.devicePixelRatio) ? window.devicePixelRatio : 1;
    const w = rect.width || this.canvas.clientWidth || 288;
    const h = rect.height || this.canvas.clientHeight || 180;
    this.canvas.width = Math.floor(w * dpr);
    this.canvas.height = Math.floor(h * dpr);
    if (this.ctx.scale) {
      this.ctx.scale(dpr, dpr);
    }
    this.width = w;
    this.height = h;

    // Solid opaque background on resize to prevent transparent black canvas
    this.ctx.fillStyle = '#121414';
    this.ctx.fillRect(0, 0, w, h);
    this.draw();
  }

  setMode(mode) {
    this.mode = mode;
    if (this.mode === 'SPECTRUM' && this.hasNativeData && !this.analyser) {
      this._computeSpectrumFromTimeData();
    }
    this.draw();
  }

  setColor(color, glow) {
    this.phosphorColor = color;
    this.phosphorGlow = glow;
  }

  start() {
    if (this.isRunning) return;
    this.isRunning = true;
    this.lastRenderTime = 0;
    this.silentFrames = 0;

    const render = (timestamp) => {
      if (!this.isRunning) return;

      const now = timestamp || (typeof performance !== 'undefined' ? performance.now() : Date.now());
      const elapsed = now - this.lastRenderTime;

      // Minimum interval before any check or draw:
      // Active: ~40 FPS (25ms). Settled silence (>15 frames): 10 FPS (100ms). Deep silence (>60 frames): 5 FPS (200ms).
      // Throttling prevents high-refresh displays (120/144/240Hz) from wasting CPU/GPU rasterization cycles.
      const interval = (this.silentFrames > 60) ? 200 : (this.silentFrames > 15) ? 100 : 25;

      if (elapsed >= interval) {
        const isSilent = this.checkSilence();
        if (isSilent) {
          this.silentFrames = Math.min(100, (this.silentFrames || 0) + 1);
        } else {
          this.silentFrames = 0;
        }

        this.lastRenderTime = now;
        this.draw();
      }

      if (typeof requestAnimationFrame !== 'undefined') {
        this.animationFrameId = requestAnimationFrame(render);
      }
    };

    if (typeof requestAnimationFrame !== 'undefined') {
      this.animationFrameId = requestAnimationFrame(render);
    }
  }

  checkSilence() {
    if (this.analyser) {
      this.analyser.getByteTimeDomainData(this.timeData);
    }
    const len = (this.hasNativeData && this.dataLength) ? this.dataLength : this.timeData.length;
    // Use prime step (11) to avoid aliasing harmonic zero-crossings
    for (let i = 0; i < len; i += 11) {
      if (Math.abs(this.timeData[i] - 128) > 2) {
        return false;
      }
    }
    return true;
  }

  stop() {
    this.isRunning = false;
    if (this.animationFrameId) {
      if (typeof cancelAnimationFrame !== 'undefined') {
        cancelAnimationFrame(this.animationFrameId);
      }
      this.animationFrameId = null;
    }
  }

  draw() {
    if (!this.ctx) return;
    const ctx = this.ctx;
    const w = this.width || 288;
    const h = this.height || 180;

    // Semi-transparent clearing for CRT phosphor persistence trail
    ctx.fillStyle = 'rgba(18, 20, 20, 0.28)';
    ctx.fillRect(0, 0, w, h);

    // Draw precision graticule grid
    this._drawGrid(ctx, w, h);

    if (!this.isPowered) {
      // Draw subtle standby CRT beam with hardware-accelerated vector glow
      ctx.save();
      ctx.beginPath();
      ctx.moveTo(0, h / 2);
      ctx.lineTo(w, h / 2);
      ctx.strokeStyle = this.phosphorGlow;
      ctx.lineWidth = 3.0;
      ctx.stroke();
      ctx.strokeStyle = this.phosphorColor;
      ctx.lineWidth = 1.4;
      ctx.stroke();
      ctx.restore();
      return;
    }

    if (this.mode === 'WAVEFORM') {
      this._drawWaveform(ctx, w, h);
    } else if (this.mode === 'SPECTRUM') {
      this._drawSpectrum(ctx, w, h);
    } else if (this.mode === 'LISSAJOUS') {
      this._drawLissajous(ctx, w, h);
    }
  }

  _drawGrid(ctx, w, h) {
    ctx.save();
    ctx.strokeStyle = this.gridColor;
    ctx.lineWidth = 1;

    // Batch 8x6 grid divisions into single path (reduces 14 stroke calls to 1)
    const cols = 8;
    const rows = 6;
    ctx.beginPath();
    for (let i = 1; i < cols; i++) {
      const x = Math.floor((w / cols) * i) + 0.5;
      ctx.moveTo(x, 0);
      ctx.lineTo(x, h);
    }
    for (let j = 1; j < rows; j++) {
      const y = Math.floor((h / rows) * j) + 0.5;
      ctx.moveTo(0, y);
      ctx.lineTo(w, y);
    }
    ctx.stroke();

    // Center crosshairs with tick marks
    ctx.strokeStyle = 'rgba(255, 255, 255, 0.16)';
    ctx.beginPath();
    ctx.moveTo(0, h / 2);
    ctx.lineTo(w, h / 2);
    ctx.moveTo(w / 2, 0);
    ctx.lineTo(w / 2, h);
    ctx.stroke();

    ctx.restore();
  }

  _drawWaveform(ctx, w, h) {
    ctx.save();
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';

    ctx.beginPath();

    const len = (this.hasNativeData && this.dataLength) ? this.dataLength : this.timeData.length;
    let startIdx = 0;
    const searchLimit = Math.min(Math.floor(len / 2), Math.max(0, len - 2));
    for (let i = 0; i < searchLimit; i++) {
      if (this.timeData[i] < 128 && this.timeData[i + 1] >= 128) {
        startIdx = i;
        break;
      }
    }

    const maxSamples = this.hasNativeData ? (len - startIdx) : Math.min(len - startIdx, 1024);
    const samplesToDraw = Math.max(2, maxSamples);
    const sliceWidth = w / (samplesToDraw - 1);
    let x = 0;

    for (let i = 0; i < samplesToDraw; i++) {
      const v = this.timeData[startIdx + i] / 128.0; // 0.0 to 2.0 (1.0 = center)
      const y = (v * h) / 2;

      if (i === 0) {
        ctx.moveTo(x, y);
      } else {
        ctx.lineTo(x, y);
      }
      x += sliceWidth;
    }

    // Hardware-accelerated two-pass vector glow (avoids heavy software-rasterized shadowBlur)
    ctx.strokeStyle = this.phosphorGlow;
    ctx.lineWidth = 3.6;
    ctx.stroke();

    ctx.strokeStyle = this.phosphorColor;
    ctx.lineWidth = 1.6;
    ctx.stroke();

    ctx.restore();
  }

  _computeSpectrumFromTimeData() {
    const len = (this.hasNativeData && this.dataLength) ? this.dataLength : this.timeData.length;
    let N = 1;
    while ((N << 1) <= len && (N << 1) <= 512) {
      N <<= 1;
    }
    if (N < 16) return;

    if (!this._fftReal || this._fftReal.length !== N) {
      this._fftReal = new Float32Array(N);
      this._fftImag = new Float32Array(N);
    }
    const real = this._fftReal;
    const imag = this._fftImag;

    // Apply Hann window and map uint8 [0..255] to [-1.0..1.0]
    for (let i = 0; i < N; i++) {
      const window = 0.5 * (1 - Math.cos((2 * Math.PI * i) / (N - 1)));
      real[i] = ((this.timeData[i] - 128) / 128.0) * window;
      imag[i] = 0.0;
    }

    // Bit-reversal permutation
    let j = 0;
    for (let i = 0; i < N - 1; i++) {
      if (i < j) {
        const tr = real[i]; real[i] = real[j]; real[j] = tr;
        const ti = imag[i]; imag[i] = imag[j]; imag[j] = ti;
      }
      let k = N >> 1;
      while (k <= j) {
        j -= k;
        k >>= 1;
      }
      j += k;
    }

    // Cooley-Tukey decimation-in-time radix-2 FFT
    for (let lenStep = 2; lenStep <= N; lenStep <<= 1) {
      const halfLen = lenStep >> 1;
      const angle = (-2 * Math.PI) / lenStep;
      const wStepR = Math.cos(angle);
      const wStepI = Math.sin(angle);
      for (let i = 0; i < N; i += lenStep) {
        let wr = 1.0;
        let wi = 0.0;
        for (let m = 0; m < halfLen; m++) {
          const uR = real[i + m];
          const uI = imag[i + m];
          const vR = real[i + m + halfLen] * wr - imag[i + m + halfLen] * wi;
          const vI = real[i + m + halfLen] * wi + imag[i + m + halfLen] * wr;
          real[i + m] = uR + vR;
          imag[i + m] = uI + vI;
          real[i + m + halfLen] = uR - vR;
          imag[i + m + halfLen] = uI - vI;
          const nextWr = wr * wStepR - wi * wStepI;
          wi = wr * wStepI + wi * wStepR;
          wr = nextWr;
        }
      }
    }

    // Map magnitudes to frequency bins with logarithmic dB scaling
    const halfN = N >> 1;
    if (!this.freqData || this.freqData.length !== halfN) {
      this.freqData = new Uint8Array(halfN);
    }
    for (let k = 0; k < halfN; k++) {
      const mag = Math.sqrt(real[k] * real[k] + imag[k] * imag[k]) / (halfN / 2);
      const db = 20 * Math.log10(Math.max(mag, 1e-4));
      const norm = Math.max(0, Math.min(255, Math.round(((db + 60) / 60) * 255)));
      this.freqData[k] = norm;
    }
  }

  _drawSpectrum(ctx, w, h) {
    if (this.analyser) {
      this.analyser.getByteFrequencyData(this.freqData);
    } else if (this.hasNativeData) {
      this._computeSpectrumFromTimeData();
    }

    ctx.save();
    ctx.fillStyle = this.phosphorColor;

    const numBars = 48;
    const barWidth = (w / numBars) - 1.5;
    const totalBins = this.freqData ? this.freqData.length : 1;

    for (let i = 0; i < numBars; i++) {
      const normIdx = i / numBars;
      // Perceptual frequency warp (f(t) = t^1.4 gives rich bass resolution while spanning to Nyquist)
      const binIdx = Math.min(totalBins - 1, Math.floor(Math.pow(normIdx, 1.4) * totalBins));
      const val = this.freqData ? (this.freqData[binIdx] / 255.0) : 0;
      const barHeight = val * (h - 20);
      const x = i * (barWidth + 1.5);
      const y = h - barHeight - 4;

      // Authentic vintage phosphor bar: minimum 2px baseline indicator
      ctx.fillRect(x, y, barWidth, Math.max(2, barHeight));
    }
    ctx.restore();
  }

  _drawLissajous(ctx, w, h) {
    ctx.save();
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';

    ctx.beginPath();
    const cx = w / 2;
    const cy = h / 2;
    const radius = Math.min(w, h) * 0.42;

    const len = (this.hasNativeData && this.dataLength) ? this.dataLength : this.timeData.length;

    if (this.timeDataR) {
      // True stereo phase goniometer (X = Left, Y = Right rotated 45 degrees)
      const rLen = Math.min(len, this.timeDataR.length);
      for (let i = 0; i < rLen; i += 2) {
        const xVal = (this.timeData[i] - 128) / 128.0;
        const yVal = (this.timeDataR[i] - 128) / 128.0;

        const px = cx + (xVal - yVal) * radius * 0.707;
        const py = cy + (xVal + yVal) * radius * 0.707;

        if (i === 0) {
          ctx.moveTo(px, py);
        } else {
          ctx.lineTo(px, py);
        }
      }
    } else {
      // Quarter-phase offset mono Lissajous fallback
      const phaseOffset = Math.max(1, Math.floor(len / 4));
      const drawLen = len - phaseOffset;
      for (let i = 0; i < drawLen; i += 2) {
        const xVal = (this.timeData[i] - 128) / 128.0;
        const yVal = (this.timeData[i + phaseOffset] - 128) / 128.0;

        const px = cx + (xVal - yVal) * radius * 0.707;
        const py = cy + (xVal + yVal) * radius * 0.707;

        if (i === 0) {
          ctx.moveTo(px, py);
        } else {
          ctx.lineTo(px, py);
        }
      }
    }

    // Hardware-accelerated two-pass vector glow
    ctx.strokeStyle = this.phosphorGlow;
    ctx.lineWidth = 3.2;
    ctx.stroke();

    ctx.strokeStyle = this.phosphorColor;
    ctx.lineWidth = 1.4;
    ctx.stroke();

    ctx.restore();
  }

  destroy() {
    this.stop();
    if (this._resizeObserver) {
      this._resizeObserver.disconnect();
      this._resizeObserver = null;
    }
  }
}
