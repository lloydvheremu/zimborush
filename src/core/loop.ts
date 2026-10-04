/**
 * Fixed-timestep simulation loop with interpolated rendering (design doc §8).
 *
 * The simulation always advances in whole `SIM_DT` steps so that physics and
 * gameplay are frame-rate independent; rendering happens once per animation
 * frame and consumes an interpolation factor `alpha` between the previous and
 * current simulation states. Rendering therefore stays smooth at any display
 * rate and stays correct at the ladder's half-rate stage, where the sim keeps
 * running at 60 Hz while the renderer draws every other frame.
 *
 * Zero per-frame allocation: the rAF callback is a single bound property, the
 * hooks object is supplied once at `start()`, and the tick body creates no
 * objects, arrays or closures.
 */

/** Simulation frequency, fixed. Gameplay never varies with display rate. */
export const SIM_HZ = 60;
export const SIM_DT = 1 / SIM_HZ;

/**
 * Largest frame delta the simulation will consume in one tick. A tab that was
 * backgrounded returns with a multi-second delta; consuming it whole would run
 * hundreds of catch-up steps and freeze the page, so it is clamped.
 */
const MAX_FRAME_DT_S = 0.25;

/**
 * Upper bound on simulation steps per rendered frame. Past this the backlog is
 * dropped rather than chased, which prevents the "spiral of death" where each
 * catch-up frame takes longer than the time it is trying to recover.
 */
const MAX_STEPS_PER_FRAME = 8;

/** Callbacks supplied once when the loop starts. */
export interface LoopHooks {
  /** Advance the simulation by exactly `dt` seconds (always `SIM_DT`). */
  step(dt: number): void;
  /**
   * Draw one frame. `alpha` is 0..1 between the previous and current simulation
   * state; `frameDtMs` is the real elapsed time since the previous frame, which
   * telemetry and the quality ladder measure.
   */
  render(alpha: number, frameDtMs: number): void;
}

export class FixedLoop {
  private hooks: LoopHooks | null = null;
  private running = false;
  private accumulator = 0;
  private lastTimeMs = 0;
  private rafId = 0;
  private stepsThisFrame = 0;

  get isRunning(): boolean {
    return this.running;
  }

  /** Simulation steps consumed by the most recent rendered frame. */
  get stepsLastFrame(): number {
    return this.stepsThisFrame;
  }

  get simHz(): number {
    return SIM_HZ;
  }

  /** Start stepping and rendering. Throws if the loop is already running. */
  start(hooks: LoopHooks): void {
    if (this.running) {
      throw new Error('FixedLoop.start: already running — call stop() first.');
    }
    this.hooks = hooks;
    this.running = true;
    this.accumulator = 0;
    this.lastTimeMs = performance.now();
    this.rafId = requestAnimationFrame(this.tick);
  }

  /** Stop the loop. Idempotent. */
  stop(): void {
    if (!this.running) {
      return;
    }
    this.running = false;
    cancelAnimationFrame(this.rafId);
    this.hooks = null;
  }

  /** Bound once per instance, never per frame. */
  private readonly tick = (): void => {
    if (!this.running) {
      return;
    }
    const hooks = this.hooks;
    if (hooks === null) {
      return;
    }

    const nowMs = performance.now();
    const frameDtMs = nowMs - this.lastTimeMs;
    this.lastTimeMs = nowMs;

    let frameDtS = frameDtMs / 1000;
    if (!Number.isFinite(frameDtS) || frameDtS < 0) {
      frameDtS = 0;
    } else if (frameDtS > MAX_FRAME_DT_S) {
      frameDtS = MAX_FRAME_DT_S;
    }
    this.accumulator += frameDtS;

    let steps = 0;
    while (this.accumulator >= SIM_DT) {
      if (steps >= MAX_STEPS_PER_FRAME) {
        // Drop the remaining backlog; keep only the sub-step remainder.
        this.accumulator %= SIM_DT;
        break;
      }
      hooks.step(SIM_DT);
      this.accumulator -= SIM_DT;
      steps++;
    }

    hooks.render(this.accumulator / SIM_DT, frameDtMs);
    this.stepsThisFrame = steps;
    this.rafId = requestAnimationFrame(this.tick);
  };
}
