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
    this.animationFrameId = null;

    // Buffer arrays
    const fftSize = this.analyser ? this.analyser.fftSize : 2048;
    const binCount = this.analyser ? this.analyser.frequencyBinCount : 1024;
    this.timeData = new Uint8Array(fftSize);
    this.freqData = new Uint8Array(binCount);

    // Phosphor color: Braun vintage phosphor amber/green
    this.phosphorColor = '#24FF6A'; // Braun lab green
    this.phosphorGlow = 'rgba(36, 255, 106, 0.45)';
    this.gridColor = 'rgba(255, 255, 255, 0.08)';

    this._resize();
    if (typeof window !== 'undefined') {
      window.addEventListener('resize', () => this._resize());
    }
  }

  setAnalyser(analyser) {
    this.analyser = analyser;
    if (this.analyser) {
      this.timeData = new Uint8Array(this.analyser.fftSize);
      this.freqData = new Uint8Array(this.analyser.frequencyBinCount);
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
  }

  setMode(mode) {
    this.mode = mode;
  }

  setColor(color, glow) {
    this.phosphorColor = color;
    this.phosphorGlow = glow;
  }

  start() {
    if (this.isRunning) return;
    this.isRunning = true;

    const render = () => {
      if (!this.isRunning) return;
      this.draw();
      if (typeof requestAnimationFrame !== 'undefined') {
        this.animationFrameId = requestAnimationFrame(render);
      }
    };

    if (typeof requestAnimationFrame !== 'undefined') {
      this.animationFrameId = requestAnimationFrame(render);
    }
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

    if (!this.analyser) {
      // Draw subtle standby CRT beam
      ctx.save();
      ctx.strokeStyle = this.phosphorColor;
      ctx.shadowColor = this.phosphorGlow;
      ctx.shadowBlur = 4;
      ctx.lineWidth = 1.5;
      ctx.beginPath();
      ctx.moveTo(0, h / 2);
      ctx.lineTo(w, h / 2);
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

    // 8x6 grid divisions
    const cols = 8;
    const rows = 6;
    for (let i = 1; i < cols; i++) {
      const x = Math.floor((w / cols) * i) + 0.5;
      ctx.beginPath();
      ctx.moveTo(x, 0);
      ctx.lineTo(x, h);
      ctx.stroke();
    }
    for (let j = 1; j < rows; j++) {
      const y = Math.floor((h / rows) * j) + 0.5;
      ctx.beginPath();
      ctx.moveTo(0, y);
      ctx.lineTo(w, y);
      ctx.stroke();
    }

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
    this.analyser.getByteTimeDomainData(this.timeData);

    ctx.save();
    ctx.strokeStyle = this.phosphorColor;
    ctx.shadowColor = this.phosphorGlow;
    ctx.shadowBlur = 8;
    ctx.lineWidth = 1.8;
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';

    ctx.beginPath();

    // Analog edge trigger stabilization: find the first rising zero-crossing
    // Locks periodic waveforms into a steady rock-solid CRT trace instead of jittering
    let startIdx = 0;
    const searchLimit = Math.min(1024, this.timeData.length - 2);
    for (let i = 0; i < searchLimit; i++) {
      if (this.timeData[i] < 128 && this.timeData[i + 1] >= 128) {
        startIdx = i;
        break;
      }
    }

    const samplesToDraw = Math.min(this.timeData.length - startIdx, 1024);
    const sliceWidth = w / samplesToDraw;
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

    ctx.stroke();
    ctx.restore();
  }

  _drawSpectrum(ctx, w, h) {
    this.analyser.getByteFrequencyData(this.freqData);

    ctx.save();
    ctx.fillStyle = this.phosphorColor;
    ctx.shadowColor = this.phosphorGlow;
    ctx.shadowBlur = 6;

    const numBars = 48;
    const barWidth = (w / numBars) - 1.5;
    const step = Math.floor(this.freqData.length / (numBars * 1.6));

    for (let i = 0; i < numBars; i++) {
      const val = this.freqData[i * step] / 255.0;
      const barHeight = val * (h - 20);
      const x = i * (barWidth + 1.5);
      const y = h - barHeight - 4;

      ctx.fillRect(x, y, barWidth, barHeight);
    }
    ctx.restore();
  }

  _drawLissajous(ctx, w, h) {
    this.analyser.getByteTimeDomainData(this.timeData);

    ctx.save();
    ctx.strokeStyle = this.phosphorColor;
    ctx.shadowColor = this.phosphorGlow;
    ctx.shadowBlur = 9;
    ctx.lineWidth = 1.5;

    ctx.beginPath();
    const cx = w / 2;
    const cy = h / 2;
    const radius = Math.min(w, h) * 0.42;

    // Use quarter-phase offset between X and Y to construct phase goniometer
    const phaseOffset = Math.floor(this.timeData.length / 4);
    for (let i = 0; i < this.timeData.length - phaseOffset; i += 2) {
      const xVal = (this.timeData[i] - 128) / 128.0;
      const yVal = (this.timeData[i + phaseOffset] - 128) / 128.0;

      // Rotate 45 degrees for standard goniometer orientation
      const px = cx + (xVal - yVal) * radius * 0.707;
      const py = cy + (xVal + yVal) * radius * 0.707;

      if (i === 0) {
        ctx.moveTo(px, py);
      } else {
        ctx.lineTo(px, py);
      }
    }
    ctx.stroke();
    ctx.restore();
  }
}
