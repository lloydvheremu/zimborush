/**
 * Keyboard input for the rider (design doc §11).
 *
 * W/S throttle and brake, A/D steer. The input object is mutated in place and
 * handed to the physics step, so the frame path allocates nothing.
 *
 * Touch input (auto-throttle, screen halves steer, both thumbs brake) is
 * specified in the design doc but its ergonomics are explicitly UNVERIFIED
 * pending a playtest; it is deliberately not implemented here rather than
 * shipping an untested guess.
 */

import type { BikeInput } from '../bike/state';

/** Throttle ramp per second while the key is held. */
const THROTTLE_RATE = 4;
/** How fast throttle returns to zero when released. */
const RELEASE_RATE = 8;
/** Steering input is a target; it reaches it at this rate. */
const STEER_RATE = 6;

/**
 * Keyboard state mapped into a `BikeInput`. `update(dt)` smooths toward the
 * currently-held keys so the bike does not snap between full-lock and neutral.
 */
export class KeyboardInput {
  private readonly input: BikeInput = {
    throttle: 0,
    brake: 0,
    steer: 0,
  };
  private throttleKey = false;
  private brakeKey = false;
  private leftKey = false;
  private rightKey = false;
  /** When true, throttle is applied automatically (hands-off / bench modes). */
  private autoThrottle = false;

  /** The live input object. Reused — callers must not retain it. */
  get value(): BikeInput {
    return this.input;
  }

  attach(): void {
    window.addEventListener('keydown', this.onKeyDown);
    window.addEventListener('keyup', this.onKeyUp);
    window.addEventListener('blur', this.onBlur);
  }

  detach(): void {
    window.removeEventListener('keydown', this.onKeyDown);
    window.removeEventListener('keyup', this.onKeyUp);
    window.removeEventListener('blur', this.onBlur);
  }

  /** Hands-off mode: hold full throttle with no steering. */
  setAutoThrottle(on: boolean): void {
    this.autoThrottle = on;
  }

  /** Smooth the input toward the held keys. Called once per simulation step. */
  update(dt: number): BikeInput {
    const targetThrottle = this.autoThrottle ? 1 : this.throttleKey ? 1 : 0;
    const targetBrake = this.brakeKey ? 1 : 0;
    const targetSteer = (this.rightKey ? 1 : 0) - (this.leftKey ? 1 : 0);

    this.input.throttle = approach(this.input.throttle, targetThrottle, dt, THROTTLE_RATE, RELEASE_RATE);
    this.input.brake = approach(this.input.brake, targetBrake, dt, RELEASE_RATE, RELEASE_RATE);
    this.input.steer = approach(this.input.steer, targetSteer, dt, STEER_RATE, STEER_RATE);
    return this.input;
  }

  private readonly onKeyDown = (event: KeyboardEvent): void => {
    const k = event.key;
    if (k === 'w' || k === 'W' || k === 'ArrowUp') {
      this.throttleKey = true;
    } else if (k === 's' || k === 'S' || k === 'ArrowDown') {
      this.brakeKey = true;
    } else if (k === 'a' || k === 'A' || k === 'ArrowLeft') {
      this.leftKey = true;
    } else if (k === 'd' || k === 'D' || k === 'ArrowRight') {
      this.rightKey = true;
    } else {
      return;
    }
    // Stop arrow keys from scrolling the canvas page.
    event.preventDefault();
  };

  private readonly onKeyUp = (event: KeyboardEvent): void => {
    const k = event.key;
    if (k === 'w' || k === 'W' || k === 'ArrowUp') {
      this.throttleKey = false;
    } else if (k === 's' || k === 'S' || k === 'ArrowDown') {
      this.brakeKey = false;
    } else if (k === 'a' || k === 'A' || k === 'ArrowLeft') {
      this.leftKey = false;
    } else if (k === 'd' || k === 'D' || k === 'ArrowRight') {
      this.rightKey = false;
    }
  };

  /** Losing focus must not leave a key stuck down. */
  private readonly onBlur = (): void => {
    this.throttleKey = false;
    this.brakeKey = false;
    this.leftKey = false;
    this.rightKey = false;
  };
}

/** Move `current` toward `target`, using different rates for rise and fall. */
function approach(current: number, target: number, dt: number, rise: number, fall: number): number {
  const rate = target > current ? rise : fall;
  const step = rate * dt;
  if (Math.abs(target - current) <= step) {
    return target;
  }
  return current + Math.sign(target - current) * step;
}
