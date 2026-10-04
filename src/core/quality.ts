/**
 * Quality ladder state machine (design doc §9).
 *
 * One-way per session: stages descend in a fixed order and never climb back
 * within a run. "Frozen R" (the cadence probe, re-probed only on visibility
 * regain or orientation change) is what makes this meaningful — because R comes
 * from an idle measurement, sustained overload during gameplay is genuinely
 * recognised as overload instead of being mistaken for a slower display.
 *
 * Protection list: sim rate and the ladder order are the only things this class
 * owns. Sky, sun, road, rival, FP bike and the palette are protected by
 * construction — no stage touches them.
 *
 * Descending requires BOTH a slow rolling window and that the `holdMs` settle
 * period has elapsed since the previous descent, so one bad window (a GC hitch)
 * cannot cascade the ladder downward.
 */

/** Stage ids, in descent order. */
export const Stage = {
  Default: 0,
  DustOff: 0.5,
  Scale1: 1,
  Scale2: 2,
  Scale3: 3,
  Scale4: 4,
  PropDistance: 5,
  MsaaOff: 6,
  HalfRate: 7,
} as const;
export type StageId = (typeof Stage)[keyof typeof Stage];

/** Human-readable stage names for the transition log and the overlay. */
const STAGE_NAMES: Record<string, string> = {
  '0': 'default',
  '0.5': 'dust-off',
  '1': 'render-scale 0.9',
  '2': 'render-scale 0.8',
  '3': 'render-scale 0.7',
  '4': 'render-scale 0.6',
  '5': 'prop-distance 0.6',
  '6': 'msaa off',
  '7': 'render R/2',
};

/** Rolling window and settle delays (ESTIMATE — design doc §9). */
const WARMUP_MS = 10_000;
const WINDOW_MS = 5_000;
const HOLD_MS = 5_000;

/** Trigger multiples of the target frame time. */
const SOON_FACTOR = 1.2; // stage 0.5 onward
const LATE_FACTOR = 1.5; // stage 7 — half-rate

/** Ordered descent, so "next" is always well defined. */
const DESCENT: StageId[] = [
  Stage.Default,
  Stage.DustOff,
  Stage.Scale1,
  Stage.Scale2,
  Stage.Scale3,
  Stage.Scale4,
  Stage.PropDistance,
  Stage.MsaaOff,
  Stage.HalfRate,
];

/** What the ladder is allowed to change. The session applies these. */
export interface QualityState {
  stage: StageId;
  renderScale: number;
  propDistanceScale: number;
  dustEnabled: boolean;
  msaaEnabled: boolean;
  halfRateRender: boolean;
}

export interface LadderOptions {
  /** Performance target T = min(R, 60) from the cadence probe. */
  targetHz: number;
  /** Display cadence R, used only for the R ≥ 60 half-rate guard. */
  cadenceHz: number;
  /** Style/tier default for dust, so stage 0.5 knows whether it can act. */
  dustEnabledAtStart: boolean;
  /** True when the tier enables MSAA at stage 0. */
  msaaEnabledAtStart: boolean;
  /** Skip warmup and settle delays (`?ladder=nosettle`) — test affordance. */
  noSettle?: boolean;
  /** Log every stage transition to the console (off in the bench harness). */
  logTransitions?: boolean;
}

/**
 * Ladder state machine driven by real frame times. Contains no rendering code:
 * it publishes a `QualityState` and the session applies it.
 */
export class QualityLadder {
  private readonly targetHz: number;
  private readonly cadenceHz: number;
  private readonly logTransitions: boolean;
  private readonly warmupMs: number;
  private readonly holdMs: number;
  private readonly windowLengthMs: number;

  private stageIndex = 0;
  private elapsedMs = 0;
  private windowMs = 0;
  private windowFrames = 0;
  private windowAccumMs = 0;
  /** Frames still to skip before another descent is allowed. */
  private holdRemainingMs = 0;

  /** Reused state object — callers must not retain it. */
  private readonly state: QualityState;

  /** Set when the ladder moves; the session reads and clears it. */
  private pendingTransition = false;

  constructor(options: LadderOptions) {
    this.targetHz = options.targetHz > 0 ? options.targetHz : 60;
    this.cadenceHz = options.cadenceHz > 0 ? options.cadenceHz : 60;
    this.logTransitions = options.logTransitions !== false;
    const noSettle = options.noSettle === true;
    this.warmupMs = noSettle ? 0 : WARMUP_MS;
    this.holdMs = noSettle ? 0 : HOLD_MS;
    this.windowLengthMs = noSettle ? 500 : WINDOW_MS;
    this.state = {
      stage: Stage.Default,
      renderScale: 1,
      propDistanceScale: 1,
      dustEnabled: options.dustEnabledAtStart,
      msaaEnabled: options.msaaEnabledAtStart,
      halfRateRender: false,
    };
  }

  get current(): QualityState {
    return this.state;
  }

  get stageName(): string {
    return STAGE_NAMES[String(this.state.stage)] ?? 'unknown';
  }

  /** Target frame time in ms for the frozen target rate. */
  get targetFrameMs(): number {
    return 1000 / this.targetHz;
  }

  /** Rolling average frame time over the current window, in ms. */
  get rollingAvgMs(): number {
    return this.windowFrames > 0 ? this.windowAccumMs / this.windowFrames : 0;
  }

  /** True when a stage change happened since the previous call; then cleared. */
  consumeTransition(): boolean {
    const had = this.pendingTransition;
    this.pendingTransition = false;
    return had;
  }

  /**
   * Feed one rendered frame. Returns the current state (reused object). Called
   * from the render hook; allocates nothing.
   */
  update(frameDtMs: number): QualityState {
    if (!Number.isFinite(frameDtMs) || frameDtMs <= 0) {
      return this.state;
    }

    this.elapsedMs += frameDtMs;
    if (this.elapsedMs < this.warmupMs) {
      return this.state;
    }

    if (this.holdRemainingMs > 0) {
      this.holdRemainingMs -= frameDtMs;
    }

    this.windowFrames++;
    this.windowAccumMs += frameDtMs;
    this.windowMs += frameDtMs;

    if (this.windowMs < this.windowLengthMs) {
      return this.state;
    }

    const avgMs = this.windowAccumMs / this.windowFrames;
    this.windowFrames = 0;
    this.windowAccumMs = 0;
    this.windowMs = 0;

    if (this.stageIndex >= DESCENT.length - 1) {
      return this.state; // stage 7 is terminal: no further descent
    }
    if (this.holdRemainingMs > 0) {
      return this.state; // still settling since the previous descent
    }

    const nextStage = DESCENT[this.stageIndex + 1];
    const isTerminalStep = nextStage === Stage.HalfRate;
    const thresholdMs = this.targetFrameMs * (isTerminalStep ? LATE_FACTOR : SOON_FACTOR);
    // Half-rate rendering only makes sense when the display has frames to spare.
    const allowed = !isTerminalStep || this.cadenceHz >= 60;

    if (allowed && avgMs > thresholdMs) {
      this.stageIndex++;
      this.applyStage(DESCENT[this.stageIndex], avgMs);
      this.holdRemainingMs = this.holdMs;
    }

    return this.state;
  }

  /** Apply a stage to the published state and log the transition. */
  private applyStage(stage: StageId, avgMs: number): void {
    this.state.stage = stage;
    if (stage <= Stage.DustOff) {
      this.state.renderScale = 1;
    } else if (stage === Stage.Scale1) {
      this.state.renderScale = 0.9;
    } else if (stage === Stage.Scale2) {
      this.state.renderScale = 0.8;
    } else if (stage === Stage.Scale3) {
      this.state.renderScale = 0.7;
    } else {
      // Stages 4-7 all sit at the floor scale; 5 and 6 cut other costs.
      this.state.renderScale = 0.6;
    }
    this.state.propDistanceScale = stage >= Stage.PropDistance ? 0.6 : 1;
    if (stage >= Stage.MsaaOff) {
      this.state.msaaEnabled = false;
    }
    this.state.halfRateRender = stage === Stage.HalfRate;
    if (stage >= Stage.DustOff) {
      this.state.dustEnabled = false;
    }
    this.pendingTransition = true;

    if (this.logTransitions) {
      console.log(
        `[ZimboRush] ladder → ${String(stage)} (${this.stageName}) ` +
          `avg=${avgMs.toFixed(2)}ms target=${this.targetFrameMs.toFixed(2)}ms`,
      );
    }
  }

  /** Force a stage, for tests and the `?stage=` affordance. */
  forceStage(stage: StageId): QualityState {
    for (let i = 0; i < DESCENT.length; i++) {
      if (DESCENT[i] === stage) {
        this.stageIndex = i;
        this.applyStage(DESCENT[i], this.targetFrameMs);
        this.holdRemainingMs = this.holdMs;
        return this.state;
      }
    }
    throw new Error(`QualityLadder.forceStage: unknown stage ${String(stage)}`);
  }
}
