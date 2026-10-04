/**
 * Performance telemetry overlay (design doc §12).
 *
 * Shows: average fps, worst and p95 frame time, draw calls, triangles, transfer
 * MB, JS heap where the browser exposes it, and the frozen cadence R with its
 * snapped flag and the current ladder stage.
 *
 * Allocation discipline: `frame()` runs on every rendered frame and only writes
 * into preallocated typed arrays. The DOM text is rebuilt at `REFRESH_MS` (4 Hz)
 * from those buffers, using the same single text node, so the per-frame path
 * stays free of allocations and of layout work.
 *
 * Toggled with F3, the backquote key, or a 3-finger tap on touch devices.
 */

import type { RenderStats } from '../renderer/IRenderer';
import type { QualityState } from './quality';

/** Frame-time ring buffer length (~4 s at 60 fps). */
const RING = 256;

/** How often the overlay text is rebuilt, in ms. */
const REFRESH_MS = 250;

/** Sources the overlay reads from. All return reused objects. */
export interface TelemetrySources {
  /** Backend stats for the last frame (reused object). */
  stats(): RenderStats;
  /** Current ladder state (reused object). */
  quality(): QualityState;
  /** Frozen cadence result. */
  cadenceHz(): number;
  cadenceSnapped(): boolean;
  cadenceTag(): string;
  targetHz(): number;
  /** Current ladder stage name. */
  stageName(): string;
  /** Simulated steps the last rendered frame consumed. */
  stepsLastFrame(): number;
}

/** Keys that toggle the overlay, matched on `event.key`. */
const TOGGLE_KEYS = ['F3', '`', '~'];

type MemoryInfo = { usedJSHeapSize: number };

export class Telemetry {
  private readonly sources: TelemetrySources;
  private readonly ring = new Float32Array(RING);
  private readonly scratch = new Float32Array(RING);
  private ringCount = 0;
  private ringHead = 0;
  private framesSinceRefresh = 0;
  private accumMs = 0;
  private lastRefreshMs = 0;
  private visible = false;

  private el: HTMLDivElement | null = null;
  /** Reused text node content cache, to avoid touching the DOM when unchanged. */
  private lastText = '';
  private touchPoints = 0;

  constructor(sources: TelemetrySources) {
    this.sources = sources;
  }

  get isVisible(): boolean {
    return this.visible;
  }

  /** Create the overlay element and attach its toggle listeners. */
  mount(): void {
    if (this.el !== null) {
      return;
    }
    const el = document.createElement('div');
    el.id = 'zimborush-telemetry';
    el.style.cssText = [
      'position:fixed',
      'top:8px',
      'left:8px',
      'margin:0',
      'padding:6px 8px',
      'font:12px/1.45 ui-monospace,SFMono-Regular,Menlo,Consolas,monospace',
      'color:#fff',
      'background:rgba(0,0,0,0.55)',
      'white-space:pre',
      'pointer-events:none',
      'z-index:10',
      'display:none',
    ].join(';');
    document.body.appendChild(el);
    this.el = el;

    window.addEventListener('keydown', this.onKeyDown);
    window.addEventListener('touchstart', this.onTouchStart, { passive: true });
  }

  toggle(): void {
    this.visible = !this.visible;
    const el = this.el;
    if (el !== null) {
      el.style.display = this.visible ? 'block' : 'none';
      if (this.visible) {
        // Force an immediate rebuild so the overlay is never blank on toggle.
        this.lastRefreshMs = 0;
        this.lastText = '';
      }
    }
  }

  /**
   * Feed one rendered frame. Zero allocation: typed-array writes only, with the
   * DOM text rebuilt at most every `REFRESH_MS`.
   */
  frame(frameDtMs: number, nowMs: number): void {
    if (!Number.isFinite(frameDtMs) || frameDtMs <= 0) {
      return;
    }
    this.ring[this.ringHead] = frameDtMs;
    this.ringHead = (this.ringHead + 1) % RING;
    if (this.ringCount < RING) {
      this.ringCount++;
    }
    this.framesSinceRefresh++;
    this.accumMs += frameDtMs;

    if (!this.visible) {
      this.lastRefreshMs = nowMs;
      return;
    }
    if (nowMs - this.lastRefreshMs < REFRESH_MS) {
      return;
    }
    this.lastRefreshMs = nowMs;
    this.rebuild(nowMs);
  }

  /** Rebuild the overlay text from the ring buffer. Runs at 4 Hz, not per frame. */
  private rebuild(nowMs: number): void {
    const el = this.el;
    if (el === null) {
      return;
    }
    const count = this.ringCount;
    const avgMs = count > 0 ? this.accumMs / Math.max(1, this.framesSinceRefresh) : 0;
    this.framesSinceRefresh = 0;
    this.accumMs = 0;

    // Worst over the ring.
    let worstMs = 0;
    for (let i = 0; i < count; i++) {
      const v = this.ring[i];
      if (v > worstMs) {
        worstMs = v;
      }
    }

    // p95 from a copy. In-place sort of a preallocated buffer: no new arrays.
    let p95Ms = 0;
    if (count > 0) {
      for (let i = 0; i < count; i++) {
        this.scratch[i] = this.ring[i];
      }
      const view = this.scratch.subarray(0, count);
      view.sort();
      const idx = Math.min(count - 1, Math.floor(count * 0.95));
      p95Ms = view[idx];
    }

    const stats = this.sources.stats();
    const quality = this.sources.quality();
    const targetHz = this.sources.targetHz();
    const cadenceHz = this.sources.cadenceHz();
    const snapped = this.sources.cadenceSnapped();
    const tag = this.sources.cadenceTag();
    const heapMb = readHeapMb();
    const transferMb = readTransferMb();

    const fps = avgMs > 0 ? 1000 / avgMs : 0;
    const lines = [
      `ZimboRush  backend=${stats.backend}  ${fps.toFixed(1)} fps (avg)  [F3]`,
      `frame  avg ${avgMs.toFixed(2)}  p95 ${p95Ms.toFixed(2)}  worst ${worstMs.toFixed(2)} ms`,
      `target ${(1000 / targetHz).toFixed(2)} ms (${targetHz.toFixed(0)} fps)  ` +
        `R ${cadenceHz.toFixed(0)} Hz${snapped ? '' : ' unsnapped'} (${tag})`,
      `draws ${stats.drawCalls}  tris ${stats.triangles}  steps ${this.sources.stepsLastFrame()}`,
      `stage ${String(quality.stage)} ${this.sources.stageName()}  ` +
        `scale ${quality.renderScale.toFixed(2)}  msaa ${quality.msaaEnabled ? 'on' : 'off'}  ` +
        `dust ${quality.dustEnabled ? 'on' : 'off'}`,
      `transfer ${transferMb.toFixed(2)} MB  heap ${heapMb >= 0 ? `${heapMb.toFixed(1)} MB` : 'n/a'}`,
    ];
    const text = lines.join('\n');
    if (text !== this.lastText) {
      el.textContent = text;
      this.lastText = text;
    }
    void nowMs;
  }

  /** Detach listeners and remove the element. Idempotent. */
  dispose(): void {
    window.removeEventListener('keydown', this.onKeyDown);
    window.removeEventListener('touchstart', this.onTouchStart);
    if (this.el !== null) {
      this.el.remove();
      this.el = null;
    }
    this.visible = false;
    this.lastText = '';
  }

  private readonly onKeyDown = (event: KeyboardEvent): void => {
    for (let i = 0; i < TOGGLE_KEYS.length; i++) {
      if (event.key === TOGGLE_KEYS[i]) {
        event.preventDefault();
        this.toggle();
        return;
      }
    }
  };

  private readonly onTouchStart = (event: TouchEvent): void => {
    // 3-finger tap. Tracked locally so the listener never allocates.
    const n = event.touches.length;
    if (n === 3 && this.touchPoints !== 3) {
      this.toggle();
      this.touchPoints = 3;
    } else if (n !== 3) {
      this.touchPoints = n;
    }
  };
}

/** Used JS heap in MB, or -1 when the browser does not expose it. */
function readHeapMb(): number {
  const perf = performance as Performance & { memory?: MemoryInfo };
  const mem = perf.memory;
  if (mem === undefined || typeof mem.usedJSHeapSize !== 'number') {
    return -1; // Firefox/Safari: degrade gracefully, report n/a
  }
  return mem.usedJSHeapSize / 1048576;
}

/**
 * Bytes actually transferred so far, in MB, from the Resource Timing API.
 * Same-origin only, so this measures the game itself and nothing external.
 */
function readTransferMb(): number {
  const entries = performance.getEntriesByType('resource');
  let total = 0;
  for (let i = 0; i < entries.length; i++) {
    const entry = entries[i] as PerformanceResourceTiming;
    const size = entry.transferSize;
    if (typeof size === 'number' && size > 0) {
      total += size;
    }
  }
  return total / 1048576;
}
