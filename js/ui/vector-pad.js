/**
 * @file vector-pad.js
 * @brief Braun AS 42 Precision Vector Touchpad / Kaoss Modulation Surface.
 * Features 2D coordinate modulation (Filter Cutoff / Felt Tone on X, Tape Delay / Shimmer Bloom on Y),
 * analog hairline crosshair reticle, high-DPI canvas, telemetry readouts,
 * momentary spring-return vs latched operation, and keyboard accessibility.
 * Follows Dieter Rams functionalist industrial design principles.
 */

export class BraunVectorPad {
  /**
   * @param {HTMLElement} container
   * @param {Object} [options={}]
   */
  constructor(container, options = {}) {
    if (!container) return;
    this.container = container;
    this.engine = options.engine || null;
    this.onEngage = options.onEngage || null;
    this.onChange = options.onChange || null;

    this.defaultX = options.defaultX ?? 0.50;
    this.defaultY = options.defaultY ?? 0.50;
    this.x = this.defaultX;
    this.y = this.defaultY;

    this.mode = options.mode || 'momentary'; // 'momentary' | 'latch'
    this.isEngaged = false;
    this._animId = null;

    this._render();
    this._attachEvents();
    this._applyModulation(false);
    this.draw();
  }

  _render() {
    this.container.innerHTML = '';

    this.wrapper = document.createElement('div');
    this.wrapper.className = 'braun-vector-pad-wrapper';
    this.wrapper.tabIndex = 0;
    this.wrapper.setAttribute('role', 'region');
    this.wrapper.setAttribute('aria-label', 'Braun AS 42 Vector Modulation Touchpad');

    this.wrapper.innerHTML = `
      <div class="braun-vector-header">
        <div class="braun-vector-title-group">
          <span class="braun-panel-title">AS 42 · VECTOR MODULATION</span>
          <span class="braun-vector-axis-meta">X: CUTOFF · Y: SPACE & BLOOM</span>
        </div>
        <div class="braun-vector-controls">
          <button class="braun-vector-mini-btn" id="btn-vector-mode" title="Toggle Momentary Spring / Latch Lock">
            <span class="braun-led"></span>
            <span id="vector-mode-label">MOMENTARY</span>
          </button>
          <button class="braun-vector-mini-btn" id="btn-vector-reset" title="Reset Coordinates to Center Origin">
            RESET [·]
          </button>
        </div>
      </div>

      <div class="braun-vector-surface-box" id="vector-surface">
        <canvas class="braun-vector-canvas"></canvas>
        <span class="braun-vector-axis-label label-x-min">◄ WARM FELT</span>
        <span class="braun-vector-axis-label label-x-max">BRIGHT CHIME ►</span>
        <span class="braun-vector-axis-label label-y-max">▲ SHIMMER BLOOM</span>
        <span class="braun-vector-axis-label label-y-min">DRY / INTIMATE ▼</span>
      </div>

      <div class="braun-vector-readout">
        <div class="braun-vector-coords">
          <span class="braun-vector-readout-item">X: <span class="braun-vector-readout-val" id="readout-x">1,420 Hz (50%)</span></span>
          <span style="color: var(--border-line); margin: 0 4px;">|</span>
          <span class="braun-vector-readout-item">Y: <span class="braun-vector-readout-val" id="readout-y">460 ms · SHIMMER 45%</span></span>
        </div>
        <div class="braun-vector-readout-indicator">
          <span class="braun-led" id="vector-status-led"></span>
          <span id="vector-status-text" style="font-size: 8px; font-weight: 700; letter-spacing: 0.06em;">STANDBY</span>
        </div>
      </div>
    `;

    this.container.appendChild(this.wrapper);

    this.surfaceBox = this.wrapper.querySelector('#vector-surface');
    this.canvas = this.wrapper.querySelector('.braun-vector-canvas');
    this.ctx = this.canvas && this.canvas.getContext ? this.canvas.getContext('2d') : null;

    this.modeBtn = this.wrapper.querySelector('#btn-vector-mode');
    this.modeLabel = this.wrapper.querySelector('#vector-mode-label');
    this.resetBtn = this.wrapper.querySelector('#btn-vector-reset');
    this.readoutX = this.wrapper.querySelector('#readout-x');
    this.readoutY = this.wrapper.querySelector('#readout-y');
    this.statusLed = this.wrapper.querySelector('#vector-status-led');
    this.statusText = this.wrapper.querySelector('#vector-status-text');

    this._resize();
  }

  _resize() {
    if (!this.canvas || !this.surfaceBox) return;
    const rect = this.surfaceBox.getBoundingClientRect ? this.surfaceBox.getBoundingClientRect() : { width: 340, height: 130 };
    const dpr = (typeof window !== 'undefined' && window.devicePixelRatio) ? window.devicePixelRatio : 1;
    const w = rect.width || this.surfaceBox.clientWidth || 340;
    const h = rect.height || this.surfaceBox.clientHeight || 130;

    this.canvas.width = Math.floor(w * dpr);
    this.canvas.height = Math.floor(h * dpr);
    if (this.ctx && this.ctx.scale) {
      this.ctx.scale(dpr, dpr);
    }
    this.width = w;
    this.height = h;
  }

  _attachEvents() {
    if (typeof window !== 'undefined') {
      window.addEventListener('resize', () => {
        this._resize();
        this.draw();
      });
    }

    if (this.modeBtn) {
      this.modeBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        this.toggleMode();
      });
    }

    if (this.resetBtn) {
      this.resetBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        this.resetToCenter();
      });
    }

    if (!this.surfaceBox) return;

    const handlePointerMove = (e) => {
      if (!this.isEngaged) return;
      e.preventDefault();
      const rect = this.surfaceBox.getBoundingClientRect();
      if (!rect.width || !rect.height) return;

      const clX = e.clientX ?? (e.touches && e.touches[0].clientX) ?? 0;
      const clY = e.clientY ?? (e.touches && e.touches[0].clientY) ?? 0;

      const normX = Math.max(0, Math.min(1, (clX - rect.left) / rect.width));
      // Invert Y so up = higher modulation
      const normY = Math.max(0, Math.min(1, 1.0 - (clY - rect.top) / rect.height));

      this.setCoordinates(normX, normY, true);
    };

    const handlePointerUp = (e) => {
      if (!this.isEngaged) return;
      this.isEngaged = false;
      this._updateStatusUi();

      if (this.surfaceBox.releasePointerCapture && e.pointerId !== undefined) {
        try {
          this.surfaceBox.releasePointerCapture(e.pointerId);
        } catch (err) {}
      }

      if (this.mode === 'momentary') {
        this._springReturn();
      } else {
        this.draw();
      }
    };

    this.surfaceBox.addEventListener('pointerdown', async (e) => {
      e.preventDefault();
      if (this.surfaceBox.setPointerCapture && e.pointerId !== undefined) {
        try {
          this.surfaceBox.setPointerCapture(e.pointerId);
        } catch (err) {}
      }

      if (this._animId) {
        cancelAnimationFrame(this._animId);
        this._animId = null;
      }

      this.isEngaged = true;
      this._updateStatusUi();

      if (this.onEngage) {
        await this.onEngage();
      }

      const rect = this.surfaceBox.getBoundingClientRect();
      const clX = e.clientX ?? (e.touches && e.touches[0].clientX) ?? 0;
      const clY = e.clientY ?? (e.touches && e.touches[0].clientY) ?? 0;
      const normX = Math.max(0, Math.min(1, (clX - rect.left) / rect.width));
      const normY = Math.max(0, Math.min(1, 1.0 - (clY - rect.top) / rect.height));

      this.setCoordinates(normX, normY, true);
    });

    this.surfaceBox.addEventListener('pointermove', handlePointerMove);
    this.surfaceBox.addEventListener('pointerup', handlePointerUp);
    this.surfaceBox.addEventListener('pointercancel', handlePointerUp);

    // Double-click resets to origin
    this.surfaceBox.addEventListener('dblclick', () => {
      this.resetToCenter();
    });

    // Keyboard navigation
    this.wrapper.addEventListener('keydown', (e) => {
      let step = e.shiftKey ? 0.01 : 0.04;
      let handled = false;

      if (e.key === 'ArrowLeft') {
        this.setCoordinates(Math.max(0, this.x - step), this.y, true);
        handled = true;
      } else if (e.key === 'ArrowRight') {
        this.setCoordinates(Math.min(1, this.x + step), this.y, true);
        handled = true;
      } else if (e.key === 'ArrowUp') {
        this.setCoordinates(this.x, Math.min(1, this.y + step), true);
        handled = true;
      } else if (e.key === 'ArrowDown') {
        this.setCoordinates(this.x, Math.max(0, this.y - step), true);
        handled = true;
      } else if (e.key === 'Home' || e.key === 'Escape') {
        this.resetToCenter();
        handled = true;
      }

      if (handled) {
        e.preventDefault();
        if (this.onEngage) this.onEngage();
      }
    });
  }

  toggleMode() {
    this.mode = this.mode === 'momentary' ? 'latch' : 'momentary';
    if (this.modeBtn) {
      this.modeBtn.classList.toggle('is-active', this.mode === 'latch');
    }
    if (this.modeLabel) {
      this.modeLabel.textContent = this.mode.toUpperCase();
    }
    if (this.mode === 'momentary' && !this.isEngaged) {
      this._springReturn();
    }
  }

  resetToCenter() {
    if (this._animId) {
      cancelAnimationFrame(this._animId);
      this._animId = null;
    }
    this.setCoordinates(this.defaultX, this.defaultY, true);
  }

  setCoordinates(x, y, updateEngine = true) {
    this.x = Math.max(0, Math.min(1.0, x));
    this.y = Math.max(0, Math.min(1.0, y));

    if (updateEngine) {
      this._applyModulation(true);
    }
    this._updateReadout();
    this.draw();
  }

  _updateStatusUi() {
    if (this.statusLed) {
      this.statusLed.classList.toggle('is-active', this.isEngaged);
    }
    if (this.statusText) {
      this.statusText.textContent = this.isEngaged ? 'ENGAGED' : 'STANDBY';
      this.statusText.style.color = this.isEngaged ? 'var(--braun-orange)' : 'var(--text-secondary)';
    }
    if (this.surfaceBox) {
      this.surfaceBox.classList.toggle('is-active', this.isEngaged);
    }
  }

  _updateReadout() {
    const cutoffHz = Math.round(250 * Math.pow(5500 / 250, this.x));
    const delayMs = Math.round(100 + this.y * 850);
    const shimmerPct = Math.round(15 + this.y * 70);
    const tonePct = Math.round(this.x * 100);

    if (this.readoutX) {
      this.readoutX.textContent = `${cutoffHz.toLocaleString()} Hz (${tonePct}%)`;
    }
    if (this.readoutY) {
      this.readoutY.textContent = `${delayMs} ms · SHIMMER ${shimmerPct}%`;
    }
  }

  _applyModulation(notifyChange = true) {
    if (!this.engine) return;

    // X Axis: Filter Cutoff / Felt Piano Tone (0.15 to 0.95)
    const feltTone = 0.15 + this.x * 0.80;
    this.engine.setFeltTone(feltTone);

    // Drone cutoff tracking:
    const drone1Cutoff = 200 + this.x * 3200;
    const drone2Cutoff = 350 + this.x * 3800;
    this.engine.setDroneCutoff(1, drone1Cutoff);
    this.engine.setDroneCutoff(2, drone2Cutoff);

    // Y Axis: Tape Delay Time (0.10s to 0.95s) & Shimmer Bloom
    const delayTimeSec = 0.10 + this.y * 0.85;
    this.engine.setDelayTime(delayTimeSec);

    const shimmerAmount = 0.15 + this.y * 0.70;
    this.engine.setReverbShimmer(shimmerAmount);

    const reverbWet = 0.20 + this.y * 0.45;
    this.engine.setReverbWet(reverbWet);

    if (notifyChange && this.onChange) {
      this.onChange({
        x: this.x,
        y: this.y,
        feltTone,
        cutoffHz: Math.round(250 * Math.pow(5500 / 250, this.x)),
        delayTimeSec,
        shimmerAmount,
        reverbWet
      });
    }
  }

  _springReturn() {
    if (this._animId) {
      cancelAnimationFrame(this._animId);
      this._animId = null;
    }

    const startX = this.x;
    const startY = this.y;
    const targetX = this.defaultX;
    const targetY = this.defaultY;
    const duration = 220; // 220ms smooth return
    const startTime = (typeof performance !== 'undefined') ? performance.now() : Date.now();

    const step = (currentTime) => {
      const elapsed = currentTime - startTime;
      const progress = Math.min(1.0, elapsed / duration);
      // Smooth quintic ease-out deceleration
      const ease = 1.0 - Math.pow(1.0 - progress, 4);

      const curX = startX + (targetX - startX) * ease;
      const curY = startY + (targetY - startY) * ease;

      this.setCoordinates(curX, curY, true);

      if (progress < 1.0) {
        this._animId = requestAnimationFrame(step);
      } else {
        this.setCoordinates(targetX, targetY, true);
        this._animId = null;
      }
    };

    this._animId = requestAnimationFrame(step);
  }

  draw() {
    if (!this.ctx || !this.width || !this.height) return;
    const ctx = this.ctx;
    const w = this.width;
    const h = this.height;

    // Clear background
    ctx.clearRect(0, 0, w, h);
    ctx.fillStyle = '#121415';
    ctx.fillRect(0, 0, w, h);

    // Draw Graticule Grid (Dieter Rams technical lines)
    ctx.lineWidth = 1;
    ctx.strokeStyle = 'rgba(255, 255, 255, 0.07)';
    if (ctx.setLineDash) ctx.setLineDash([2, 3]);

    // 25%, 50%, 75% horizontal & vertical grid lines
    const gridSteps = [0.25, 0.50, 0.75];
    gridSteps.forEach(ratio => {
      // Horizontal
      const yPos = Math.round(h * (1.0 - ratio)) + 0.5;
      ctx.beginPath();
      ctx.moveTo(0, yPos);
      ctx.lineTo(w, yPos);
      ctx.stroke();

      // Vertical
      const xPos = Math.round(w * ratio) + 0.5;
      ctx.beginPath();
      ctx.moveTo(xPos, 0);
      ctx.lineTo(xPos, h);
      ctx.stroke();
    });

    if (ctx.setLineDash) ctx.setLineDash([]); // Reset dashed

    // Center Origin Crosshairs
    const midX = Math.round(w * 0.5) + 0.5;
    const midY = Math.round(h * 0.5) + 0.5;
    ctx.strokeStyle = 'rgba(255, 255, 255, 0.14)';
    ctx.beginPath();
    ctx.moveTo(midX - 6, midY);
    ctx.lineTo(midX + 6, midY);
    ctx.moveTo(midX, midY - 6);
    ctx.lineTo(midX, midY + 6);
    ctx.stroke();

    // Calculate current crosshair pixel coordinates
    const px = Math.max(0, Math.min(w, this.x * w));
    const py = Math.max(0, Math.min(h, (1.0 - this.y) * h));

    // Active Reticle Crosshairs
    const orange = this.isEngaged ? '#EE592B' : 'rgba(238, 89, 43, 0.75)';
    ctx.strokeStyle = this.isEngaged ? 'rgba(238, 89, 43, 0.45)' : 'rgba(255, 255, 255, 0.18)';
    ctx.lineWidth = 1;

    // Full-span vertical hairline
    ctx.beginPath();
    ctx.moveTo(px, 0);
    ctx.lineTo(px, h);
    ctx.stroke();

    // Full-span horizontal hairline
    ctx.beginPath();
    ctx.moveTo(0, py);
    ctx.lineTo(w, py);
    ctx.stroke();

    // Outer Target Ring
    ctx.strokeStyle = orange;
    ctx.lineWidth = this.isEngaged ? 2 : 1.5;
    ctx.beginPath();
    ctx.arc(px, py, this.isEngaged ? 14 : 10, 0, Math.PI * 2);
    ctx.stroke();

    // Subtle Glow when engaged
    if (this.isEngaged && ctx.createRadialGradient) {
      const grad = ctx.createRadialGradient(px, py, 2, px, py, 24);
      grad.addColorStop(0, 'rgba(238, 89, 43, 0.45)');
      grad.addColorStop(1, 'rgba(238, 89, 43, 0)');
      ctx.fillStyle = grad;
      ctx.beginPath();
      ctx.arc(px, py, 24, 0, Math.PI * 2);
      ctx.fill();
    }

    // Inner Solid Precision Pip
    ctx.fillStyle = this.isEngaged ? '#FFF' : orange;
    ctx.beginPath();
    ctx.arc(px, py, this.isEngaged ? 3.5 : 2.5, 0, Math.PI * 2);
    ctx.fill();
  }
}
