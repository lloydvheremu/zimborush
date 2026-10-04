/**
 * Deterministic self-check for the cadence probe, runnable in isolation.
 *
 * This is not part of the game bundle and is not a test framework (the Step-1
 * rules forbid adding one). It exercises `probeCadence()` for real by patching
 * `requestAnimationFrame` to emit synthetic intervals, so the median, outlier
 * rejection, snapping and tag logic can be checked without a display.
 *
 * Run from the browser console after importing, or via the dev server:
 *   const m = await import('/src/core/cadence.probe.ts'); m.runCadenceSelfCheck()
 */

import { probeCadence } from './cadence';
import type { CadenceResult } from './cadence';

interface Case {
  name: string;
  /** Synthetic interval in ms fed to each rAF callback. */
  intervalMs: number;
  expectRateHz: number;
  expectSnapped: boolean;
  expectTag: string;
}

const CASES: Case[] = [
  { name: '60 Hz panel', intervalMs: 1000 / 60, expectRateHz: 60, expectSnapped: true, expectTag: 'native' },
  { name: '90 Hz panel', intervalMs: 1000 / 90, expectRateHz: 90, expectSnapped: true, expectTag: 'native' },
  { name: '120 Hz panel', intervalMs: 1000 / 120, expectRateHz: 120, expectSnapped: true, expectTag: 'native' },
  { name: '144 Hz panel', intervalMs: 1000 / 144, expectRateHz: 144, expectSnapped: true, expectTag: 'native' },
  { name: '165 Hz panel', intervalMs: 1000 / 165, expectRateHz: 165, expectSnapped: true, expectTag: 'native' },
  { name: '30 Hz (Low Power Mode)', intervalMs: 1000 / 30, expectRateHz: 30, expectSnapped: true, expectTag: 'lowPowerSuspected' },
  // Inside the ±8% band of 60 Hz (|62-60| = 2 <= 4.8): snaps, stays native.
  { name: '62 Hz just inside 60 band', intervalMs: 1000 / 62, expectRateHz: 60, expectSnapped: true, expectTag: 'native' },
  // Outside every band (60 needs <=4.8, 90 needs <=7.2): kept raw, unsnapped.
  { name: '78 Hz falls between bands', intervalMs: 1000 / 78, expectRateHz: 78, expectSnapped: false, expectTag: 'raw' },
];

export interface SelfCheckRow {
  name: string;
  pass: boolean;
  got: string;
  want: string;
}

/** Run every case, restoring the original rAF afterwards. */
export async function runCadenceSelfCheck(): Promise<SelfCheckRow[]> {
  const realRaf = window.requestAnimationFrame;
  const realCancel = window.cancelAnimationFrame;
  const rows: SelfCheckRow[] = [];

  let virtualNow = 0;
  const realNow = performance.now.bind(performance);

  for (const c of CASES) {
    let queued: FrameRequestCallback | null = null;
    virtualNow = 1000;

    // Synthetic clock: every rAF resolves immediately with the case interval.
    window.requestAnimationFrame = ((cb: FrameRequestCallback): number => {
      queued = cb;
      return 1;
    }) as typeof window.requestAnimationFrame;
    window.cancelAnimationFrame = ((): void => {
      queued = null;
    }) as typeof window.cancelAnimationFrame;
    const patchedNow = (): number => virtualNow;
    const originalPerformanceNow = performance.now;
    (performance as { now: () => number }).now = patchedNow;

    // Drive the loop synchronously until the probe settles or we give up.
    let result: CadenceResult | null = null;
    void probeCadence().then((r) => {
      result = r;
    });
    for (let i = 0; i < 200 && result === null; i++) {
      virtualNow += c.intervalMs;
      const cb = queued as FrameRequestCallback | null;
      if (cb === null) {
        break;
      }
      queued = null;
      cb(virtualNow);
      await Promise.resolve();
    }

    (performance as { now: () => number }).now = originalPerformanceNow;

    const got = result as CadenceResult | null;
    const pass =
      got !== null &&
      Math.abs(got.rateHz - c.expectRateHz) < 0.001 &&
      got.snapped === c.expectSnapped &&
      got.tag === c.expectTag;
    rows.push({
      name: c.name,
      pass,
      got: got === null ? 'no result' : `${got.rateHz}Hz snapped=${got.snapped} tag=${got.tag}`,
      want: `${c.expectRateHz}Hz snapped=${c.expectSnapped} tag=${c.expectTag}`,
    });
  }

  window.requestAnimationFrame = realRaf;
  window.cancelAnimationFrame = realCancel;
  void realNow;

  for (const r of rows) {
    console.log(`${r.pass ? 'PASS' : 'FAIL'}  ${r.name}: got ${r.got} | want ${r.want}`);
  }
  const failed = rows.filter((r) => !r.pass).length;
  console.log(`cadence self-check: ${rows.length - failed}/${rows.length} passed`);
  return rows;
}
