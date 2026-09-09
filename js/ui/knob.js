/**
 * @file knob.js
 * @brief Precision Dieter Rams / Braun rotary control component.
 * Machined aluminum styling, radial indicator, logarithmic/linear scaling,
 * double-click direct entry, mouse/touch/wheel support, and keyboard accessibility.
 */

export class BraunKnob {
  /**
   * @param {HTMLElement} container
   * @param {Object} options
   */
  constructor(container, options = {}) {
    if (!container) {
      return;
    }
    this.container = container;
    this.id = options.id || `knob-${Math.random().toString(36).substr(2, 9)}`;
    this.label = options.label || 'CONTROL';
    this.min = options.min ?? 0;
    this.max = options.max ?? 100;
    this.step = options.step ?? 1;
    this.unit = options.unit || '';
    this.isLog = options.isLog ?? false;
    this.defaultValue = options.value ?? (this.min + (this.max - this.min) / 2);
    this.value = this.defaultValue;
    this.precision = options.precision ?? (this.step < 1 ? 2 : 0);
    this.size = options.size || 'medium'; // 'small', 'medium', 'large'
    this.color = options.color || 'var(--color-knob-accent)';
    this.onChange = options.onChange || null;

    this.startAngle = -140; // degrees
    this.endAngle = 140;   // degrees
    this.angleRange = this.endAngle - this.startAngle; // 280 deg

    this.container.innerHTML = '';
    this._render();
    this._attachEvents();
    this.setValue(this.value, false);
  }

  _render() {
    this.element = document.createElement('div');
    this.element.className = `braun-knob-wrapper braun-knob-${this.size}`;
    this.element.tabIndex = 0;
    this.element.setAttribute('role', 'slider');
    this.element.setAttribute('aria-label', this.label);
    this.element.setAttribute('aria-valuemin', this.min);
    this.element.setAttribute('aria-valuemax', this.max);
    this.element.setAttribute('aria-valuenow', this.value);

    this.element.innerHTML = `
      <div class="braun-knob-label">${this.label}</div>
      <div class="braun-knob-assembly">
        <svg class="braun-knob-scale" viewBox="0 0 100 100">
          <circle class="braun-knob-track" cx="50" cy="50" r="42" />
          <circle class="braun-knob-fill" cx="50" cy="50" r="42" />
        </svg>
        <div class="braun-knob-cap">
          <div class="braun-knob-indicator"></div>
        </div>
      </div>
      <div class="braun-knob-value-display">
        <span class="braun-knob-value-text">${this.formatValue(this.value)}</span><span class="braun-knob-unit">${this.unit}</span>
      </div>
      <input type="text" class="braun-knob-direct-input" style="display:none;" />
    `;

    this.container.appendChild(this.element);

    this.cap = this.element.querySelector('.braun-knob-cap');
    this.fillCircle = this.element.querySelector('.braun-knob-fill');
    this.valueText = this.element.querySelector('.braun-knob-value-text');
    this.directInput = this.element.querySelector('.braun-knob-direct-input');

    // Arc length for SVG fill: radius 42 -> circumference ~ 263.89
    // Angle range is 280 out of 360 deg = 0.7777 of circle ~ 205.25
    this.circumference = 2 * Math.PI * 42;
    this.arcLength = (this.angleRange / 360) * this.circumference;
    if (this.fillCircle) {
      this.fillCircle.style.strokeDasharray = `${this.arcLength} ${this.circumference}`;
      this.fillCircle.style.strokeDashoffset = `${this.arcLength}`;
      this.fillCircle.setAttribute('stroke-dasharray', `${this.arcLength} ${this.circumference}`);
      this.fillCircle.setAttribute('stroke-dashoffset', `${this.arcLength}`);
    }
  }

  _attachEvents() {
    let isDragging = false;
    let startY = 0;
    let startVal = 0;
    let dragMode = null; // 'pointer' | 'touch' | 'mouse'
    let activeTouchId = null;
    let activePointerId = null;

    const onPointerDown = (e) => {
      if (e.target === this.directInput) return;
      if (isDragging) return;
      if (typeof e.preventDefault === 'function') {
        e.preventDefault();
      }
      if (this._animFrameId) {
        if (typeof cancelAnimationFrame === 'function') cancelAnimationFrame(this._animFrameId);
        else clearTimeout(this._animFrameId);
        this._animFrameId = null;
      }

      // Track touch identifier or pointer ID specifically to prevent multi-touch collisions
      if (e.pointerId !== undefined && (e.type === 'pointerdown' || e.pointerType)) {
        dragMode = 'pointer';
        activePointerId = e.pointerId;
        startY = e.clientY ?? 0;
        try {
          if (this.element.setPointerCapture && e.pointerId != null) {
            this.element.setPointerCapture(e.pointerId);
          }
        } catch (err) {}
      } else if (e.changedTouches && e.changedTouches.length > 0) {
        dragMode = 'touch';
        activeTouchId = e.changedTouches[0].identifier;
        startY = e.changedTouches[0].clientY;
      } else if (e.touches && e.touches.length > 0) {
        dragMode = 'touch';
        activeTouchId = e.touches[0].identifier;
        startY = e.touches[0].clientY;
      } else {
        dragMode = 'mouse';
        startY = e.clientY || 0;
      }

      isDragging = true;
      startVal = this.value;
      this.element.classList.add('is-active');

      const applyDeltaY = (currentY, shiftKey) => {
        const deltaY = startY - currentY;
        const sensitivity = shiftKey ? 0.1 : 1.0;
        const pixelRange = 160;

        let normalizedChange = (deltaY / pixelRange) * sensitivity;
        let normVal = this.toNormalized(startVal) + normalizedChange;
        normVal = Math.max(0, Math.min(1, normVal));

        const newVal = this.fromNormalized(normVal);
        this.setValue(newVal, true);
      };

      const onMouseMove = (ev) => {
        if (!isDragging || dragMode !== 'mouse') return;
        applyDeltaY(ev.clientY, ev.shiftKey);
      };

      const onPointerMove = (ev) => {
        if (!isDragging || dragMode !== 'pointer') return;
        if (activePointerId !== null && ev.pointerId !== undefined && ev.pointerId !== activePointerId) {
          return; // Ignore other pointers
        }
        applyDeltaY(ev.clientY, ev.shiftKey);
      };

      const onTouchMove = (ev) => {
        if (!isDragging || dragMode !== 'touch') return;
        if (activeTouchId === null || !ev.touches) return;
        let matchedTouch = null;
        for (let i = 0; i < ev.touches.length; i++) {
          if (ev.touches[i].identifier === activeTouchId) {
            matchedTouch = ev.touches[i];
            break;
          }
        }
        if (matchedTouch) {
          applyDeltaY(matchedTouch.clientY, ev.shiftKey);
        }
      };

      const cleanup = () => {
        if (!isDragging) return;
        isDragging = false;
        try {
          if (this.element.releasePointerCapture && activePointerId != null) {
            this.element.releasePointerCapture(activePointerId);
          }
        } catch (err) {}
        dragMode = null;
        activeTouchId = null;
        activePointerId = null;
        this.element.classList.remove('is-active');

        if (typeof window !== 'undefined') {
          window.removeEventListener('mousemove', onMouseMove);
          window.removeEventListener('mouseup', onMouseUp);
          window.removeEventListener('pointermove', onPointerMove);
          window.removeEventListener('pointerup', onPointerUp);
          window.removeEventListener('pointercancel', onPointerCancel);
          window.removeEventListener('touchmove', onTouchMove);
          window.removeEventListener('touchend', onTouchEnd);
          window.removeEventListener('touchcancel', onTouchCancel);
        }
      };

      const onMouseUp = () => {
        if (!isDragging || dragMode !== 'mouse') return;
        cleanup();
      };

      const onPointerUp = (ev) => {
        if (!isDragging || dragMode !== 'pointer') return;
        if (activePointerId !== null && ev && ev.pointerId !== undefined && ev.pointerId !== activePointerId) {
          return;
        }
        cleanup();
      };

      const onPointerCancel = (ev) => {
        if (!isDragging || dragMode !== 'pointer') return;
        if (activePointerId !== null && ev && ev.pointerId !== undefined && ev.pointerId !== activePointerId) {
          return;
        }
        cleanup();
      };

      const onTouchEnd = (ev) => {
        if (!isDragging || dragMode !== 'touch') return;
        if (activeTouchId !== null && ev && ev.changedTouches) {
          let matched = false;
          for (let i = 0; i < ev.changedTouches.length; i++) {
            if (ev.changedTouches[i].identifier === activeTouchId) {
              matched = true;
              break;
            }
          }
          if (!matched) return; // Different touch lifted
        }
        cleanup();
      };

      const onTouchCancel = (ev) => {
        if (!isDragging || dragMode !== 'touch') return;
        if (activeTouchId !== null && ev && ev.changedTouches) {
          let matched = false;
          for (let i = 0; i < ev.changedTouches.length; i++) {
            if (ev.changedTouches[i].identifier === activeTouchId) {
              matched = true;
              break;
            }
          }
          if (!matched) return;
        }
        cleanup();
      };

      if (typeof window !== 'undefined') {
        window.addEventListener('mousemove', onMouseMove);
        window.addEventListener('mouseup', onMouseUp);
        window.addEventListener('pointermove', onPointerMove, { passive: false });
        window.addEventListener('pointerup', onPointerUp);
        window.addEventListener('pointercancel', onPointerCancel);
        window.addEventListener('touchmove', onTouchMove, { passive: false });
        window.addEventListener('touchend', onTouchEnd);
        window.addEventListener('touchcancel', onTouchCancel);
      }
    };

    this.element.addEventListener('mousedown', onPointerDown);
    this.element.addEventListener('touchstart', onPointerDown, { passive: false });
    this.element.addEventListener('pointerdown', onPointerDown);

    // Mouse wheel support
    this.element.addEventListener('wheel', (e) => {
      e.preventDefault();
      const direction = e.deltaY < 0 ? 1 : -1;
      const stepFactor = e.shiftKey ? 0.2 : 1.0;
      if (this.isLog) {
        const deltaNorm = direction * 0.025 * stepFactor;
        const normVal = Math.max(0, Math.min(1, this.toNormalized(this.value) + deltaNorm));
        this.setValue(this.fromNormalized(normVal), true);
      } else {
        const stepSize = (this.step || (this.max - this.min) / 100) * stepFactor;
        this.setValue(this.value + direction * stepSize, true);
      }
    }, { passive: false });

    // Keyboard accessibility
    this.element.addEventListener('keydown', (e) => {
      let deltaLinear = 0;
      let deltaNorm = 0;
      const stepSize = this.step || (this.max - this.min) / 50;

      if (e.key === 'ArrowUp' || e.key === 'ArrowRight') {
        deltaLinear = stepSize;
        deltaNorm = 0.02;
      } else if (e.key === 'ArrowDown' || e.key === 'ArrowLeft') {
        deltaLinear = -stepSize;
        deltaNorm = -0.02;
      } else if (e.key === 'PageUp') {
        deltaLinear = stepSize * 5;
        deltaNorm = 0.10;
      } else if (e.key === 'PageDown') {
        deltaLinear = -stepSize * 5;
        deltaNorm = -0.10;
      } else if (e.key === 'Home') {
        this.setValue(this.min, true);
        return;
      } else if (e.key === 'End') {
        this.setValue(this.max, true);
        return;
      }

      if (deltaNorm !== 0) {
        e.preventDefault();
        if (this.isLog) {
          const normVal = Math.max(0, Math.min(1, this.toNormalized(this.value) + deltaNorm));
          this.setValue(this.fromNormalized(normVal), true);
        } else {
          this.setValue(this.value + deltaLinear, true);
        }
      }
    });

    // Double-click direct numerical entry
    if (this.directInput) {
      this.element.addEventListener('dblclick', () => {
        this.directInput.style.display = 'block';
        this.directInput.value = this.value;
        if (typeof this.directInput.focus === 'function') this.directInput.focus();
        if (typeof this.directInput.select === 'function') this.directInput.select();
      });

      this.directInput.addEventListener('keydown', (e) => {
        if (e.key === 'Enter') {
          const num = parseFloat(this.directInput.value);
          if (!isNaN(num)) {
            this.setValue(num, true);
          }
          this.directInput.style.display = 'none';
        } else if (e.key === 'Escape') {
          this.directInput.style.display = 'none';
        }
      });

      this.directInput.addEventListener('blur', () => {
        this.directInput.style.display = 'none';
      });
    }
  }

  toNormalized(val) {
    if (this.isLog) {
      const minLog = Math.log(Math.max(1e-4, this.min));
      const maxLog = Math.log(this.max);
      return (Math.log(Math.max(1e-4, val)) - minLog) / (maxLog - minLog);
    }
    return (val - this.min) / (this.max - this.min);
  }

  fromNormalized(norm) {
    if (this.isLog) {
      const minLog = Math.log(Math.max(1e-4, this.min));
      const maxLog = Math.log(this.max);
      return Math.exp(minLog + norm * (maxLog - minLog));
    }
    return this.min + norm * (this.max - this.min);
  }

  formatValue(val) {
    if (this.precision === 0) return Math.round(val).toString();
    return val.toFixed(this.precision);
  }

  setValue(val, triggerCallback = true) {
    let clamped = Math.max(this.min, Math.min(this.max, val));
    if (this.step && !this.isLog) {
      clamped = Math.round((clamped - this.min) / this.step) * this.step + this.min;
      clamped = Math.max(this.min, Math.min(this.max, clamped));
    }

    this.value = clamped;
    this.element.setAttribute('aria-valuenow', this.value);

    const norm = this.toNormalized(this.value);
    const angle = this.startAngle + norm * this.angleRange;

    // Rotate cap indicator
    if (this.cap) {
      this.cap.style.transform = `rotate(${angle}deg)`;
    }

    // Update SVG stroke fill
    if (this.fillCircle) {
      const offset = this.arcLength * (1 - norm);
      this.fillCircle.style.strokeDashoffset = `${offset}`;
      this.fillCircle.setAttribute('stroke-dashoffset', `${offset}`);
    }

    // Update text
    if (this.valueText) {
      this.valueText.textContent = this.formatValue(this.value);
    }

    if (triggerCallback && this.onChange) {
      this.onChange(this.value);
    }
  }

  /**
   * Smoothly animate knob rotation to target value using cubic easing
   * @param {number} targetVal
   * @param {number} [duration=300] - Duration in ms
   * @param {Function} [onComplete=null]
   * @param {boolean} [triggerOnChangeDuring=false] - Whether to fire onChange during animation frames
   * @param {boolean} [triggerOnChangeAtEnd=true] - Whether to fire onChange upon animation completion
   */
  animateTo(targetVal, duration = 300, onComplete = null, triggerOnChangeDuring = false, triggerOnChangeAtEnd = true) {
    if (this._animFrameId) {
      if (typeof cancelAnimationFrame === 'function') cancelAnimationFrame(this._animFrameId);
      else clearTimeout(this._animFrameId);
      this._animFrameId = null;
    }

    const startNorm = this.toNormalized(this.value);
    const targetNorm = Math.max(0, Math.min(1, this.toNormalized(targetVal)));

    // Set immediately if duration is zero or difference is negligible
    if (duration <= 0 || Math.abs(startNorm - targetNorm) < 1e-4) {
      this.setValue(targetVal, triggerOnChangeAtEnd);
      if (onComplete) onComplete();
      return;
    }

    const startTime = (typeof performance !== 'undefined' && performance.now) ? performance.now() : Date.now();
    const easeOutCubic = (t) => 1 - Math.pow(1 - t, 3);

    const step = (currentTime) => {
      const now = (typeof currentTime === 'number' && currentTime > 0) ? currentTime : ((typeof performance !== 'undefined' && performance.now) ? performance.now() : Date.now());
      const elapsed = Math.max(0, now - startTime);
      const progress = Math.min(1.0, elapsed / duration);
      const eased = easeOutCubic(progress);

      const currentNorm = startNorm + (targetNorm - startNorm) * eased;
      const currentVal = this.fromNormalized(currentNorm);
      this.setValue(currentVal, triggerOnChangeDuring);

      if (progress < 1.0) {
        if (typeof requestAnimationFrame === 'function') {
          this._animFrameId = requestAnimationFrame(step);
        } else {
          this._animFrameId = setTimeout(() => step(Date.now()), 16);
        }
      } else {
        this.setValue(targetVal, triggerOnChangeAtEnd);
        this._animFrameId = null;
        if (onComplete) onComplete();
      }
    };

    if (typeof requestAnimationFrame === 'function') {
      this._animFrameId = requestAnimationFrame(step);
    } else {
      this._animFrameId = setTimeout(() => step(Date.now()), 16);
    }
  }
}

