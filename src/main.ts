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
import { createFlyRig } from './game/bench/scripted';
import { createBikePhysics } from './game/bike/physics';
import { createPose, NEUTRAL_INPUT } from './game/bike/state';
import type { BikeInput, InterpolatedPose } from './game/bike/state';
import type { WorldParts } from './world/contracts';
import type { Mesh } from 'three';

/** The rival mesh from its slot, resolved once at boot. */
function rivalMeshOf(graph: SceneGraph): Mesh | null {
  const kids = graph.childrenOf('rival');
  for (let i = 0; i < kids.length; i++) {
    const k = kids[i];
    if ((k as Mesh).isMesh === true) {
      return k as Mesh;
    }
  }
  return null;
}
import { createEngineAudio } from './audio/engine';
import { KeyboardInput } from './game/input/keyboard';
import { StyleColorSource, completeStyle } from './styles/styleConfig';
import { compose, emptyProviders } from './world/compose';
import { WorldView } from './world/view';
import { ActorsView } from './world/actors';
import { RiderHud } from './game/hud/speed';

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
  /** Multisample count override; -1 keeps the style's value (design doc §8). */
  msaa: number;
  /** Drive the deterministic fly-through instead of the playable bike (§12). */
  fly: boolean;
  /** Enable keyboard input, or run hands-off (auto-throttle). */
  play: boolean;
  /**
   * Hold full throttle with no steering. Used to verify the ride and camera
   * without a keyboard, and as a repeatable input for bench runs.
   */
  auto: boolean;
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
    msaa: params.get('msaa') === null ? -1 : parseNumber(params.get('msaa'), -1),
    fly: params.get('fly') === '1',
    play: params.get('play') !== '0',
    auto: params.get('auto') === '1',
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

/**
 * First-person camera rig on an interpolated bike pose (design doc §11): eye
 * above the bars, looking along the heading, with roll from lean. Writes into
 * the camera in place — no allocation.
 */
function placeBikeCamera(
  camera: PerspectiveCamera,
  pose: InterpolatedPose,
  world: WorldParts,
): void {
  const ground = world.terrain.heightAt(pose.x, pose.z);
  camera.position.set(pose.x, ground + CAM.eyeHeightM, pose.z);
  // Look along the heading. Heading is a yaw about Y; forward is (sin, 0, cos).
  const fx = Math.sin(pose.heading);
  const fz = Math.cos(pose.heading);
  const aheadGround = world.terrain.heightAt(pose.x + fx * CAM.lookAheadM, pose.z + fz * CAM.lookAheadM);
  camera.lookAt(
    pose.x + fx * CAM.lookAheadM,
    aheadGround + CAM.lookHeightM,
    pose.z + fz * CAM.lookAheadM,
  );
  // Lean into turns: roll is a fraction of lean, capped so it never reads as
  // falling over. Applied about the local forward axis via rotation.z in the
  // camera's own space after lookAt.
  const roll = Math.max(-MAX_CAM_ROLL_RAD, Math.min(MAX_CAM_ROLL_RAD, pose.lean * CAM_ROLL_SCALE));
  camera.rotateZ(roll);
}

/** Fraction of bike lean carried into camera roll (design doc §11). */
const CAM_ROLL_SCALE = 0.35;
/** Cap on camera roll, ~6 degrees (design doc §11). */
const MAX_CAM_ROLL_RAD = (6 * Math.PI) / 180;

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

  // MSAA (design doc §8/§14.4): ?msaa=N overrides the style value so this step
  // can compare N against 0 on the identical fly path. -1 means "use the style".
  // Context antialias stays false either way.

  // Scene assembly through the frozen seams. Every object attaches to a named
  // slot, so draw order is fixed by the slot list rather than by merge order.
  const graph = new SceneGraph();
  const sky = createSky(graph, style);

  {
    const msaa = options.msaa >= 0 ? options.msaa : style.msaa;
    renderer.setMsaa(msaa);
    console.log(
      msaa > 0
        ? `[ZimboRush] msaa=${msaa} target=${renderer.msaaRenderTarget !== null ? 'built' : 'MISSING'}`
        : '[ZimboRush] msaa=0 (direct to canvas, no resolve pass)',
    );
  }

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

  // Actors: rival, scattered props, blob shadows, dust (steps 7-8).
  const actors = new ActorsView(graph, world.terrain, world.spline, colors, options.seed);
  actors.attach({ dust: true });
  // The rival mesh is looked up once, not per frame.
  const rivalMesh = rivalMeshOf(graph);

  // Hand the assembled scene to the renderer. Until this call the renderer
  // draws its step-1 placeholder, which is why the world stayed invisible.
  renderer.setScene(graph.root);

  // --- Simulation: bike physics (step 5/6) or the deterministic fly-through ---
  const input = new KeyboardInput();
  if (options.play && !options.fly) {
    input.attach();
  }
  if (options.auto) {
    input.setAutoThrottle(true);
  }
  const bike = createBikePhysics(world.terrain, world.spline, {});
  const pose = createPose();
  // Empty prop list is valid until scatter arrives at step 8: the list is a
  // generator whose first radius of 0 terminates it.
  const noProps = { propAt: () => 0 };

  const fly = createFlyRig(world.spline, world.terrain, {});
  const hud = new RiderHud();
  hud.mount();
  const audio = createEngineAudio();
  if (options.play && !options.fly) {
    // Audio is gesture-gated: browsers refuse an AudioContext without one.
    const resume = (): void => {
      audio.start();
      window.removeEventListener('pointerdown', resume);
      window.removeEventListener('keydown', resume);
    };
    window.addEventListener('pointerdown', resume);
    window.addEventListener('keydown', resume);
  }

  console.log(
    `[ZimboRush] sim=${options.fly ? 'fly-through' : 'bike'} ` +
      `flySpeed=${fly.speedMps.toFixed(1)}m/s loop=${fly.loopSeconds}s ` +
      `rideHeight=${bike.state().y.toFixed(2)}m props=0`,
  );

  const renderStats = view.totals;
  const actorStats = actors.totalsSnapshot;
  console.log(
    `[ZimboRush] world seed=${options.seed} road=${world.spline.lengthM.toFixed(1)}m ` +
      `tris=${renderStats.triangles} meshes=${renderStats.meshes} ` +
      `skyTris=${sky.stats.triangles} skyDraws=${sky.stats.drawCalls} lights=${sky.stats.lightCount}`,
  );
  console.log(
    `[ZimboRush] actors rivalTris=${actorStats.rivalTriangles} propTris=${actorStats.propTriangles} ` +
      `instances=${actorStats.propInstances} blobTris=${actorStats.blobTriangles} dustTris=${actorStats.dustTriangles} ` +
      `draws=${actorStats.drawCalls} shadowDiscs=${actors.shadows.discs.length}`,
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
  // Elapsed simulated seconds. Advanced only inside step(), never in render(),
  // so the fly-through stays a pure function of simulation time.
  let simSeconds = 0;
  loop.start({
    step: (dt: number): void => {
      simSeconds += dt;
      if (options.fly) {
        return; // the fly rig is sampled in render(), from simSeconds
      }
      const riderInput: BikeInput = options.play ? input.update(dt) : NEUTRAL_INPUT;
      bike.step(dt, riderInput, noProps);
      actors.step(dt, bike.state().roadS);
    },
    render: (alpha: number, frameDtMs: number): void => {
      // ?burn=N — busy-wait to force the ladder down deterministically.
      if (frame.burnMs > 0) {
        const until = performance.now() + frame.burnMs;
        while (performance.now() < until) {
          /* deliberate burn */
        }
      }

      if (options.fly) {
        fly.update(camera, simSeconds);
      } else {
        // Interpolated render pose between the previous and current sim states
        // (design doc §8): smooth on any display rate, correct at half-rate.
        bike.interpolate(alpha, pose);
        placeBikeCamera(camera, pose, world);
        hud.frame(pose.speed);
        audio.setSpeed(pose.speed);
      }

      // Rival and FX follow the simulation, not the render rate.
      actors.frame(frameDtMs / 1000, rivalMesh, camera.position.x, camera.position.z);

      renderer.render(camera);

      const nowMs = performance.now();
      ladder.update(frameDtMs);
      if (ladder.consumeTransition()) {
        applyQuality(ladder.current);
      }
      telemetry.frame(frameDtMs, nowMs);
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
