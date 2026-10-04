/**
 * Speed HUD (design doc §3: "Minimal HUD: a speed number only").
 *
 * A plain DOM overlay — no canvas, no framework. It is a single text node whose
 * content is only touched when the displayed integer changes, so the per-frame
 * cost is one string comparison rather than a DOM write.
 *
 * The HUD reads the simulation's speed; it has no bearing on physics, which is
 * what keeps gameplay independent of presentation.
 */

/** Speed unit. Design doc §Scope says the HUD is a speed number; km/h reads best. */
const MPS_TO_KMH = 3.6;

export class RiderHud {
  private el: HTMLDivElement | null = null;
  private lastText = '';
  private visible = true;

  /** Create the element. Idempotent. */
  mount(): void {
    if (this.el !== null) {
      return;
    }
    const el = document.createElement('div');
    el.id = 'zimborush-hud';
    el.style.cssText = [
      'position:fixed',
      'right:14px',
      'bottom:10px',
      'margin:0',
      'padding:0',
      'font:600 44px/1 ui-monospace,SFMono-Regular,Menlo,Consolas,monospace',
      'color:#fff',
      'text-shadow:0 2px 6px rgba(0,0,0,0.55)',
      'letter-spacing:0.02em',
      'pointer-events:none',
      'user-select:none',
      'z-index:5',
    ].join(';');
    document.body.appendChild(el);
    this.el = el;
  }

  /**
   * Update from the interpolated speed in metres per second. Called per frame;
   * the DOM is written only when the rounded value actually changes.
   */
  frame(speedMps: number): void {
    const el = this.el;
    if (el === null || !this.visible) {
      return;
    }
    const kmh = Number.isFinite(speedMps) ? Math.max(0, Math.round(speedMps * MPS_TO_KMH)) : 0;
    // Small string build per changed integer only — not every frame.
    const text = `${kmh}`;
    if (text !== this.lastText) {
      el.textContent = text;
      this.lastText = text;
    }
  }

  /** Show or hide the HUD. */
  setVisible(visible: boolean): void {
    this.visible = visible;
    if (this.el !== null) {
      this.el.style.display = visible ? 'block' : 'none';
    }
  }

  /** Detach the element. Idempotent. */
  dispose(): void {
    if (this.el !== null) {
      this.el.remove();
      this.el = null;
    }
    this.lastText = '';
  }
}
