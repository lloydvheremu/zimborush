/**
 * Display-cadence probe (design doc §9).
 *
 * The probe runs a bare requestAnimationFrame loop with no rendering work, in
 * parallel with the eager asset fetches, and freezes the display's refresh rate
 * `R` before the scene ever renders. That ordering is the whole point: an
 * overloaded device inflates in-game frame times, so measuring cadence from
 * gameplay frames could misread a struggling 60 Hz panel as a 30 Hz one and
 * wrongly relax every threshold. Measured while idle, overload during gameplay
 * is correctly seen as overload and the quality ladder can engage.
 *
 * Rules implemented here:
 *   - collect `MAX_SAMPLES` intervals (or `MAX_DURATION_MS`, whichever first),
 *     but only while the document is visible;
 *   - take the MEDIAN and discard outliers beyond ±25% of it;
 *   - snap to the nearest known rate within ±8%, else keep the raw value and
 *     report `snapped: false`;
 *   - R is frozen once valid. A caller re-probes only on visibility regain or
 *     orientation change. Never re-probe from in-game frame times.
 */

/** Interval samples that count as a complete run (≥ 30 per design doc §9). */
const MAX_SAMPLES = 32;

/** Hard cap: a probe that never gathers enough samples still finishes. */
const MAX_DURATION_MS = 2000;

/** Discard samples further than this fraction from the median. */
const OUTLIER_FRACTION = 0.25;

/** Snap to a known rate when within this fraction. */
const SNAP_FRACTION = 0.08;

/**
 * Panel rates we snap to. This is the design-doc §9 set exactly, plus 30.
 *
 * 60/90/120/144/165 are specified in §9. 30 is added because the iOS Low Power
 * Mode case genuinely presents at 30 Hz: snapping it keeps the tightened 30 fps
 * goal instead of a raw, jittery value. Values between rates that fall outside
 * the ±8% band stay unsnapped and are reported with `snapped: false`.
 */
const KNOWN_RATES = [30, 60, 90, 120, 144, 165];

export type CadenceTag = 'native' | 'raw' | 'assumed' | 'lowPowerSuspected';

export interface CadenceResult {
  /** Frozen refresh rate in Hz. 60 is assumed if nothing could be measured. */
  rateHz: number;
  /** True when `rateHz` matched a known rate within the snap tolerance. */
  snapped: boolean;
  /**
   * The measured rate before snapping (0 when nothing was measured). This is
   * NOT the identifier of a panel: it is the observed interval rate, so on a
   * low-power-mode device it reads ~30 while the panel may be 60.
   */
  rawHz: number;
  /** Performance target: min(R, 60) — the settled 60 fps commitment. */
  targetHz: number;
  /** Number of intervals that survived outlier rejection. */
  samples: number;
  /** Classification, for telemetry and logs. */
  tag: CadenceTag;
}

/** Working buffers, sized once. */
const samplesBuf = new Float64Array(MAX_SAMPLES);
const keptBuf = new Float64Array(MAX_SAMPLES);

function documentVisible(): boolean {
  // `document.hidden` is always defined in a real browser, but guard anyway so
  // a non-DOM host cannot make the probe spin.
  return typeof document !== 'undefined' && document.hidden !== true;
}

function medianOf(values: Float64Array, count: number): number {
  if (count === 0) {
    return 0;
  }
  // Copy the first `count` entries and sort in place. This runs once per probe,
  // not per frame, so a plain sort is fine and avoids a hand-rolled quicksort.
  const arr = Array.prototype.slice.call(values, 0, count) as number[];
  arr.sort((a: number, b: number) => a - b);
  const mid = count >> 1;
  return count % 2 === 1 ? arr[mid] : (arr[mid - 1] + arr[mid]) / 2;
}

function snap(rateHz: number): number {
  for (let i = 0; i < KNOWN_RATES.length; i++) {
    const known = KNOWN_RATES[i];
    if (Math.abs(rateHz - known) <= known * SNAP_FRACTION) {
      return known;
    }
  }
  return rateHz;
}

/**
 * Build a completed measurement. Runs once per probe (boot, or a re-probe),
 * never per frame, so returning a fresh object is fine and avoids handing out a
 * shared mutable instance that a later re-probe would silently overwrite.
 */
function finalize(measuredHz: number, kept: number): CadenceResult {
  const snappedRate = snap(measuredHz);
  const didSnap = snappedRate !== measuredHz && measuredHz > 0;
  const rateHz = measuredHz > 0 ? snappedRate : 60;

  let tag: CadenceTag;
  if (measuredHz <= 0) {
    tag = 'assumed';
  } else if (!didSnap) {
    tag = 'raw';
  } else if (rateHz === 30) {
    // 30 Hz is either a native 30 Hz panel or iOS Low Power Mode capping rAF on
    // a 60 Hz panel. No web API exposes panel rate or LPM state, so this stays
    // a heuristic (UNVERIFIED — design doc §9).
    tag = 'lowPowerSuspected';
  } else {
    tag = 'native';
  }

  return {
    rawHz: measuredHz,
    rateHz,
    snapped: didSnap,
    samples: kept,
    targetHz: Math.min(rateHz, 60),
    tag,
  };
}

/** Measures the display cadence and freezes R. */
export function probeCadence(): Promise<CadenceResult> {
  return new Promise<CadenceResult>((resolve) => {
    let count = 0;
    let prevMs = 0;
    let rafId = 0;
    let settled = false;
    const startMs = performance.now();

    const finish = (measuredHz: number, kept: number): void => {
      if (settled) {
        return;
      }
      settled = true;
      cancelAnimationFrame(rafId);
      document.removeEventListener('visibilitychange', onVisibility);
      resolve(finalize(measuredHz, kept));
    };

    const onVisibility = (): void => {
      if (documentVisible()) {
        // Re-probe from scratch: the panel or power state may have changed while
        // the tab was hidden, and throttled deltas were skipped anyway.
        prevMs = 0;
        count = 0;
      }
    };
    document.addEventListener('visibilitychange', onVisibility);

    const sample = (): void => {
      if (settled) {
        return;
      }
      const nowMs = performance.now();

      // Duration cap is checked BEFORE the visibility check. The probe defers
      // while hidden — throttled ~1 Hz deltas are not panel cadence — but boot
      // must never block forever on a backgrounded tab, so a hidden document
      // still resolves with an assumed rate and re-probes on visibility regain.
      if (nowMs - startMs > MAX_DURATION_MS) {
        finish(0, 0); // no usable measurement — R assumes 60
        return;
      }

      // A hidden document is throttled to ~1 Hz; those deltas are not panel
      // cadence, so they are skipped rather than recorded.
      if (!documentVisible()) {
        prevMs = 0;
        rafId = requestAnimationFrame(sample);
        return;
      }

      if (prevMs > 0) {
        const dtMs = nowMs - prevMs;
        if (dtMs > 0 && count < MAX_SAMPLES) {
          samplesBuf[count++] = dtMs;
        }
      }
      prevMs = nowMs;

      if (count >= MAX_SAMPLES) {
        const med = medianOf(samplesBuf, count);
        let kept = 0;
        for (let i = 0; i < count; i++) {
          const dt = samplesBuf[i];
          if (Math.abs(dt - med) <= med * OUTLIER_FRACTION) {
            keptBuf[kept++] = dt;
          }
        }
        // Average the survivors; they are already tightly clustered.
        let sum = 0;
        for (let i = 0; i < kept; i++) {
          sum += keptBuf[i];
        }
        const avgMs = kept > 0 ? sum / kept : med;
        finish(avgMs > 0 ? 1000 / avgMs : 0, kept);
        return;
      }

      rafId = requestAnimationFrame(sample);
    };

    rafId = requestAnimationFrame(sample);
  });
}
