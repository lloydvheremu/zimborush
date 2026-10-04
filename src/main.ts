import { PerspectiveCamera } from 'three';
import { loadEager } from './assets/loader';
import { probeCadence } from './core/cadence';
import { FixedLoop, SIM_HZ } from './core/loop';
import { QualityLadder } from './core/quality';
import { Telemetry } from './core/telemetry';
import type { QualityState } from './core/quality';
import { SceneGraph } from './renderer/sceneGraph';
import { WebGL2Renderer } from './renderer/webgl2';
import type { TierId } from './renderer/IRenderer';
import { createHeightfield } from './game/track/heightfield';
import { createRoad } from './game/track/road';
import { buildTerrainGeometry } from './game/track/terrain';
import { buildRoadGeometry } from './game/track/roadMesh';
import { buildDistantHills } from './game/track/hills';
import { createSky } from './game/sky';
import { StyleColorSource, completeStyle } from './styles/styleConfig';
import { compose, emptyProviders } from './world/compose';
import { WorldView } from './world/view';

/**
 * Opaque tier label passed to the renderer. "default" is a placeholder —
 * not a decision; the concrete tier set is settled elsewhere.
 */
const TIER: TierId = 'default';

const FOV_DEG = 70;
const NEAR = 0.1;
const FAR = 500;

/** World seed. Fixed so tracks and benchmarks are reproducible (design §3). */
const WORLD_SEED = 2026;

/** Camera framing for the step-3 look. */
const CAM = {
  /** Height above the road surface at the start of the lap. */
  eyeHeightM: 1.35,
  /** Distance ahead along the road to look at. */
  lookAheadM: 26,
  /** Extra height of the look-ahead point. */
  lookHeightM: 0.9,
} as const;

/** URL switches. All optional; the game runs identically without any of them. */
interface BootOptions {
  /** Busy-wait this many ms per rendered frame, to force the ladder down. */
  burnMs: number;
  /** Remove ladder warmup/hold delays so transitions are observable quickly. */
  noSettle: boolean;
  /** Force a ladder stage at boot. */
  forceStage: StageForceId | null;
  /** Show the telemetry overlay from the first frame. */
  showTelemetry: boolean;
  /**
   * Where the camera sits. 'start' = at the lap origin looking along the road
   * (the default). 'overview' = pulled back, to judge the whole scene.
   */
  view: 'start' | 'overview';
  /** Override the world seed, for comparing track seeds side by side. */
  seed: number;
}

type StageForceId = 0 | 0.5 | 1 | 2 | 3 | 4 | 5 | 6 | 7;

function parseNumber(raw: string | null, fallback: number): number {
  if (raw === null || raw === '') {
    return fallback;
  }
  const n = Number(raw);
  return Number.isFinite(n) && n >= 0 ? n : fallback;
}

function parseStage(raw: string | null): StageForceId | null {
  if (raw === null || raw === '') {
    return null;
  }
  const n = Number(raw);
  if (n === 0 || n === 0.5 || n === 1 || n === 2 || n === 3 || n === 4 || n === 5 || n === 6 || n === 7) {
    return n;
  }
  return null;
}

function readBootOptions(): BootOptions {
  const params = new URLSearchParams(window.location.search);
  const view = params.get('view') === 'overview' ? 'overview' : 'start';
  return {
    burnMs: parseNumber(params.get('burn'), 0),
    noSettle: params.get('ladder') === 'nosettle',
    forceStage: parseStage(params.get('stage')),
    showTelemetry: params.get('telemetry') === '1',
    view,
    seed: parseNumber(params.get('seed'), WORLD_SEED),
  };
}

function requireCanvas(): HTMLCanvasElement {
  const canvas = document.querySelector<HTMLCanvasElement>('canvas');
  if (canvas === null) {
    throw new Error('main: no <canvas> element found in index.html');
  }
  return canvas;
}

/**
 * SINGLE ISOLATED FUNCTION — the whole WebGL2 availability policy.
 * Returns true when WebGL2 is available. When it is not, replaces the page
 * with a short plain-text message and returns false; the caller then stops
 * booting. Nothing throws on this path. v1 requires WebGL2; there is no
 * other backend. If that policy ever changes, change only this function.
 */
function ensureWebGL2OrStop(): boolean {
  const probe = document.createElement('canvas'); // throwaway probe; the real canvas stays untouched
  if (probe.getContext('webgl2') === null) {
    document.body.textContent =
      'ZimboRush needs WebGL2. This browser does not provide it, so the game cannot start here.';
    return false;
  }
  return true;
}

/** Mutable per-frame scratch. One instance, so the frame path allocates nothing. */
interface FrameContext {
  burnMs: number;
}

async function start(): Promise<void> {
  const canvas = requireCanvas();
  if (!ensureWebGL2OrStop()) {
    return; // message shown; stop quietly — no throw
  }

  const options = readBootOptions();

  // Eager phase and cadence probe run IN PARALLEL: the probe is a bare rAF loop
  // with no rendering work, so it measures panel cadence while the fetches are
  // still in flight, and the first frame waits for both (design doc §9).
  const eagerPromise = loadEager();
  const cadencePromise = probeCadence();
  const eager = await eagerPromise;
  const cadence = await cadencePromise;

  // Complete the style: the JSON carries id + clearColor today; the rest of the
  // config (palette, fog, lights) arrives here with documented defaults.
  const style = completeStyle(eager.style as never);
  const colors = new StyleColorSource(style);

  console.log(
    `[ZimboRush] cadence R=${cadence.rateHz} Hz raw=${cadence.rawHz.toFixed(2)} ` +
      `snapped=${cadence.snapped} samples=${cadence.samples} tag=${cadence.tag} ` +
      `target T=${cadence.targetHz} fps`,
  );

  const renderer = new WebGL2Renderer();
  renderer.init(canvas, style, TIER);

  // Scene assembly through the frozen seams. Every object attaches to a named
  // slot, so draw order is fixed by the slot list rather than by merge order.
  const graph = new SceneGraph();
  const sky = createSky(graph, style);

  const providers = emptyProviders();
  providers.terrain = createHeightfield(options.seed);
  providers.spline = createRoad(options.seed);
  providers.colors = colors;
  providers.terrainGeometry = buildTerrainGeometry(providers.terrain, colors, {
    x: style.sun.azimuthDeg !== undefined ? 0.42 : 0.42,
    y: 0.62,
    z: 0.55,
  }).geometry;
  const builtRoad = buildRoadGeometry(options.seed, colors);
  providers.roadGeometry = builtRoad.geometry;
  providers.roadTintCount = builtRoad.tintCount;
  const builtHills = buildDistantHills(colors, { seed: options.seed });
  providers.hillGeometry = builtHills.geometry;

  const world = compose(providers);
  const view = new WorldView(graph, world, builtRoad.tintCount, builtHills.tintCount);
  view.attach();

  // Hand the assembled scene to the renderer. Until this call the renderer
  // draws its step-1 placeholder, which is why the world stayed invisible.
  renderer.setScene(graph.root);

  const renderStats = view.totals;
  console.log(
    `[ZimboRush] world seed=${options.seed} road=${world.spline.lengthM.toFixed(1)}m ` +
      `tris=${renderStats.triangles} meshes=${renderStats.meshes} ` +
      `skyTris=${sky.stats.triangles} skyDraws=${sky.stats.drawCalls} lights=${sky.stats.lightCount}`,
  );

  const camera = new PerspectiveCamera(
    FOV_DEG,
    window.innerWidth / window.innerHeight,
    NEAR,
    FAR,
  );

  // Camera placement: on the road at the lap origin, looking along the curve.
  // This is the step-3 framing; the FP rig replaces it at step 5.
  const placeCamera = (): void => {
    if (options.view === 'overview') {
      // Pulled back and up, still looking at the road start.
      const p = { x: 0, y: 0, z: 0 };
      world.spline.pointAt(0, p);
      const ground = world.terrain.heightAt(p.x, p.z);
      camera.position.set(p.x + 60, ground + 55, p.z + 60);
      camera.lookAt(p.x, ground, p.z);
      return;
    }
    const start = { x: 0, y: 0, z: 0 };
    const ahead = { x: 0, y: 0, z: 0 };
    world.spline.pointAt(0, start);
    world.spline.pointAt(CAM.lookAheadM, ahead);
    const eye = world.terrain.heightAt(start.x, start.z) + CAM.eyeHeightM;
    const target = world.terrain.heightAt(ahead.x, ahead.z) + CAM.lookHeightM;
    camera.position.set(start.x, eye, start.z);
    camera.lookAt(ahead.x, target, ahead.z);
  };
  placeCamera();

  // Quality ladder. Dust and MSAA are inert in this step (no dust sprites, and
  // setMsaa is a step-4 stub), so both start disabled; the stage machine still
  // descends and logs in the locked order.
  const ladder = new QualityLadder({
    targetHz: cadence.targetHz,
    cadenceHz: cadence.rateHz,
    dustEnabledAtStart: false,
    msaaEnabledAtStart: false,
    noSettle: options.noSettle,
  });

  const telemetry = new Telemetry({
    stats: () => renderer.stats(),
    quality: () => ladder.current,
    cadenceHz: () => cadence.rateHz,
    cadenceSnapped: () => cadence.snapped,
    cadenceTag: () => cadence.tag,
    targetHz: () => cadence.targetHz,
    stageName: () => ladder.stageName,
    stepsLastFrame: () => loop.stepsLastFrame,
  });
  telemetry.mount();
  if (options.showTelemetry) {
    telemetry.toggle();
  }

  const frame: FrameContext = {
    burnMs: options.burnMs,
  };

  /** Applied only when the ladder changes stage, never per frame. */
  function applyQuality(state: QualityState): void {
    renderer.setRenderScale(state.renderScale);
    // Prop distance and dust have no consumers yet (steps 5-8). MSAA is a
    // step-4 stub: setMsaa throws, so it is deliberately not called here.
    void state.propDistanceScale;
    void state.dustEnabled;
    void state.msaaEnabled;
    void state.halfRateRender;
  }

  if (options.forceStage !== null) {
    applyQuality(ladder.forceStage(options.forceStage));
  }

  // Fixed-timestep simulation with interpolated rendering (design doc §8).
  // The sim is empty in this step, so `step()` carries no gameplay work; the
  // loop still runs it at exactly SIM_HZ and renders with an interpolation
  // factor, which is what step 5 will consume.
  const loop = new FixedLoop();
  loop.start({
    step: (_dt: number): void => {
      // The simulation body arrives at step 5 (bike, rival, camera rig). The
      // loop already calls this at exactly SIM_HZ so the timing contract is real.
    },
    render: (alpha: number, frameDtMs: number): void => {
      // ?burn=N — busy-wait to force the ladder down deterministically.
      if (frame.burnMs > 0) {
        const until = performance.now() + frame.burnMs;
        while (performance.now() < until) {
          /* deliberate burn */
        }
      }

      renderer.render(camera);

      const nowMs = performance.now();
      ladder.update(frameDtMs);
      if (ladder.consumeTransition()) {
        applyQuality(ladder.current);
      }
      telemetry.frame(frameDtMs, nowMs);
      void alpha; // consumed by the camera/bike rig at step 5
    },
  });

  // Window resize: re-size the drawing buffer and the camera projection.
  // The closure is created once at boot, never per frame.
  const onResize = (): void => {
    const w = window.innerWidth;
    const h = window.innerHeight;
    renderer.resize(w, h);
    camera.aspect = w / h;
    camera.updateProjectionMatrix();
  };
  window.addEventListener('resize', onResize);

  // Re-probe cadence on these two triggers only (design doc §9).
  const reprobe = (): void => {
    void probeCadence().then((fresh) => {
      console.log(
        `[ZimboRush] cadence re-probe R=${fresh.rateHz} Hz snapped=${fresh.snapped} tag=${fresh.tag}`,
      );
    });
  };
  document.addEventListener('visibilitychange', () => {
    if (document.hidden !== true) {
      reprobe();
    }
  });
  window.addEventListener('orientationchange', reprobe);

  console.log(
    `[ZimboRush] loop started sim=${SIM_HZ}Hz burn=${options.burnMs}ms ` +
      `ladder=${options.noSettle ? 'nosettle' : 'normal'} ` +
      `stage=${options.forceStage === null ? '0' : String(options.forceStage)} view=${options.view}`,
  );
}

// Boot. A boot failure (e.g. style fetch) is reported on one console line.
start().catch((reason: unknown) => {
  console.error('[ZimboRush] boot failed:', reason);
});
