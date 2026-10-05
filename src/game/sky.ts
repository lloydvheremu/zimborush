/**
 * Sunset sky + lighting rig — design doc §4 (art direction) and §5 (budgets).
 *
 * Draw-call-producing objects (3 — the §5 allowance is "sky dome, sun disc
 * (emissive), merged cloud slabs — 3 draws"):
 *
 *   1. `skyDome` — full sphere, radius 400 m, vertex-colour gradient
 *      skyHorizon → skyMid → skyZenith, fog-independent.
 *   2. `sunDisc` — unlit solid-colour icosahedron. An unlit sphere has no
 *      shading, so it reads as a disc and is visible without any light.
 *   3. `clouds`  — one `InstancedMesh` carrying 3 stretched slabs derived from
 *      `sunDisc` lightened 10 % (design doc §4's cloud rule).
 *
 * Triangle counts, as reported by `countTriangles` (which follows
 * `geometry.index ? index.count / 3 : position.count / 3`):
 *
 *   dome   SphereGeometry(400, 24, 14)        → 624
 *   sun    IcosahedronGeometry(22, 1)         →  80
 *   clouds SphereGeometry(1, 8, 4) × 3 slabs  → 144
 *   total                                      → 848 (budget 1500)
 *
 * Lights (2 of the style's "at most 3 lights"): a `DirectionalLight` for the
 * sun whose direction comes from the config's azimuth/elevation, and a
 * `HemisphereLight` fill whose colours come from the config. No other light is
 * added here.
 *
 * Scale and placement: the dome is centred on the world origin — the centre of
 * the design doc's ~96×96 m corridor — and the sun disc orbits that centre at a
 * fixed distance, because the camera never leaves the corridor. From any
 * corridor position (≤ ~68 m from the centre, the corner of a 96 m square)
 * every sky vertex stays within ~468 m of the camera and the sun-disc bounding
 * sphere within ~460 m of it, both inside the camera's 500 m far plane. So
 * nothing sky-related is ever far-clipped. A dome glued to the camera was
 * rejected: it would sit in the fog line and break the fixed horizon the
 * distant hills are designed to melt into.
 *
 * Everything here is one-time setup. The module deliberately ships NO update
 * function: the rig is static relative to the world, and static geometry means
 * per-frame allocation is structurally impossible (see `SkyRig`). The only
 * other entry points are `disposeSky` and the boot-time `logSkyBudget`.
 *
 * Determinism: the cloud layout is a hand-authored constant table — no RNG —
 * so two builds produce byte-identical output (design doc §3 repeatability).
 * `core/rng.ts` (the shared determinism seam) is intentionally not imported:
 * there is nothing to randomise yet.
 *
 * Frozen seams: objects attach through `SceneGraph.attach` only. The one
 * scene-level touch is `graph.root.fog = <Fog>` — `root` is the seam's public
 * getter for the renderer, and fog is a Scene property, not a slot child; no
 * other scene mutation happens here and sceneGraph.ts is untouched.
 */

import {
  BackSide,
  Color,
  DirectionalLight,
  Float32BufferAttribute,
  Fog,
  HemisphereLight,
  IcosahedronGeometry,
  InstancedMesh,
  Matrix4,
  Mesh,
  MeshBasicMaterial,
  SphereGeometry,
  Vector3,
} from 'three';
import type { BufferGeometry, Scene } from 'three';
import type { FullStyleConfig, HexColor } from '../renderer/contracts';
import type { SceneGraph } from '../renderer/sceneGraph';

/** Dome radius in metres. Sized so the far side of the sphere is never beyond
 * the camera far plane (1200 m, main.ts): 400 + ~175 m of world excursion leaves
 * ~600 m of margin. The world grew when the hills moved out to a 192 m foot and
 * a 780 m rim (P4), so the ring, not the dome, is now the closest thing to the
 * far plane; keeping the dome at 400 m also keeps its facets at the same angular
 * size as the reference. */
const DOME_RADIUS_M = 400;

/** Dome sphere segmentation. 24×14 is the design-doc facet scale — large
 * gentle facets, matching the reference image — at 624 triangles. */
const DOME_WIDTH_SEGMENTS = 24;
const DOME_HEIGHT_SEGMENTS = 14;

/** Dome centre in world metres — the world origin, i.e. the centre of the
 * design doc's corridor. Centre-fixed rather than camera-fixed, so the
 * horizon sits at one stable world position for terrain and hills. If the real
 * world centre turns out to be elsewhere (a track-layer decision, not this
 * file's), move THIS constant and re-check the far-plane margin: camera
 * excursion (now up to ~175 m, the corridor's own radius is 192 m) + radius
 * (400 m) must stay under the 1200 m far plane. */
const DOME_CENTER = new Vector3(0, 0, 0);

/** Sun disc radius and its distance from the dome centre. The disc subtends
 * ~6.8° from the corridor — stylised, but it is the sunset focal point. The
 * 370 m orbit keeps the disc bounding sphere well inside the 1200 m far plane
 * from every corridor position (370 + 192 + 22 = 584 m). */
const SUN_DISC_RADIUS_M = 22;
const SUN_DISC_ORBIT_M = 370;

/** Dome gradient stops, as fractions of the horizon→zenith quarter turn
 * (u = 0 at the horizon, u = 1 at the zenith). Geometry, not colour — the
 * three colours themselves come from the style config. */
const SKY_HORIZON_BAND_U = 0.06;
const SKY_MID_U = 0.3;

/** Design doc §4: "clouds = sunDisc lightened ~10 %". Interpreted as a 10 %
 * lerp toward white in linear RGB — the only derived colour this task owns
 * (the style layer's own `cloud` rule arrives with task 11). */
const CLOUD_LIGHTEN_TOWARD_WHITE = 0.1;

/** Cloud prototype sphere, scaled per instance by the slab table below. */
const CLOUD_PROTOTYPE_WIDTH_SEGMENTS = 8;
const CLOUD_PROTOTYPE_HEIGHT_SEGMENTS = 4;

/** One cloud slab. Half-extents in metres (`sx`/`sy`/`sz` scale the unit
 * prototype), yaw in radians. */
interface CloudSlab {
  readonly x: number;
  readonly y: number;
  readonly z: number;
  readonly sx: number;
  readonly sy: number;
  readonly sz: number;
  readonly yaw: number;
}

/**
 * Cloud slabs (3 — the design doc allows 0–3). Placement is authored, not
 * random: on the sun's side of the sky (sun bearing 76°, elevation ~14°) and
 * low enough to catch the warm horizon band, but far enough from the disc that
 * it can never eclipse it. Every slab's furthest corner stays inside the 400 m
 * dome — worst case ≈ 355 m.
 */
const CLOUD_SLABS: readonly CloudSlab[] = [
  // Ahead-left, large and high — the dominant slab, read as a silhouette as
  // the track bends left.
  { x: -60, y: 80, z: -220, sx: 60, sy: 9, sz: 34, yaw: 0.05 },
  // Front-right, low — on the warm side, ~20° of sky away from the disc.
  { x: 250, y: 58, z: -160, sx: 44, sy: 8, sz: 28, yaw: -0.35 },
  // Behind-left, mid-height — visible when the track turns back.
  { x: -170, y: 67, z: 80, sx: 40, sy: 7, sz: 26, yaw: -0.15 },
];

/** Design-doc §5 budgets for this rig. Asserted at boot so a future edit to a
 * segment count cannot silently break the mobile budget. */
const SKY_TRIANGLE_BUDGET = 1500;
const SKY_CLOUD_SLAB_MAX = 3;
/** Draw calls this rig produces: dome, sun disc, cloud layer. */
const SKY_DRAW_CALLS = 3;

/** Fallback horizon colour — the only hardcoded hex in this file. It is the
 * design doc §4 ESTIMATE for `palette.skyHorizon`, used only while the style
 * JSON (task 11) does not yet carry the key, so a partial config can never
 * render a black or blown-out sky. Replace-by-config, never by edit here. */
const FALLBACK_SKY_HORIZON: HexColor = '#FFC46B';

/** Object names, unique within their scene-graph slots. */
const DOME_NAME = 'skyDome';
const SUN_DISC_NAME = 'sunDisc';
const CLOUD_LAYER_NAME = 'clouds';
const SUN_LIGHT_NAME = 'sunLight';
const HEMI_LIGHT_NAME = 'hemiLight';

const HALF_PI = Math.PI / 2;
const DEG_TO_RAD = Math.PI / 180;

/** The style keys this rig reads. */
type SkyPaletteKey = 'skyHorizon' | 'skyMid' | 'skyZenith' | 'sunDisc';

/**
 * Read one sky colour from the style config, falling back to the documented
 * horizon ESTIMATE when the key is missing or blank (style JSON evolves
 * independently of this file). Same fallback for every key keeps the sky warm
 * even from a degenerate config.
 */
function paletteKey(config: FullStyleConfig, key: SkyPaletteKey): HexColor {
  const value = config.palette[key];
  return typeof value === 'string' && value.trim() !== '' ? value : FALLBACK_SKY_HORIZON;
}

/**
 * Colour from a style string. `.setStyle` decodes sRGB into the renderer's
 * working space exactly as three's colour management expects, so these are
 * the same numbers every other material in the game sees for the same hex.
 */
function colorFromCss(css: HexColor): Color {
  return new Color().setStyle(css);
}

/**
 * Triangle count of a geometry: `index ? index.count / 3 : position.count / 3`.
 * `drawnCopies` multiplies for instanced draws — the index counts one copy.
 */
function countTriangles(geometry: BufferGeometry, drawnCopies = 1): number {
  const index = geometry.getIndex();
  const perCopy =
    index === null
      ? geometry.getAttribute('position').count / 3
      : index.count / 3;
  return perCopy * drawnCopies;
}

/**
 * Writes the three-stop warm gradient into the dome's vertices as a `color`
 * attribute (the design doc's "indexed geometry with vertex colours" — no
 * textures anywhere). The stop positions are geometric constants; only the
 * colours come from the style config. Below the horizon the dome stays at the
 * horizon colour: that band sits under the terrain and is only ever seen as
 * the fog-matching base the distant hills melt into.
 */
function paintDomeGradient(
  geometry: SphereGeometry,
  horizon: Color,
  mid: Color,
  zenith: Color,
): void {
  const positions = geometry.getAttribute('position');
  const colors = new Float32Array(positions.count * 3);
  const scratch = new Color();
  for (let i = 0; i < positions.count; i++) {
    const normalisedY = Math.min(1, Math.max(-1, positions.getY(i) / DOME_RADIUS_M));
    // u: 0 at the horizon, 1 at the zenith; negative elevations clamp to 0.
    const u = Math.max(0, Math.asin(normalisedY)) / HALF_PI;
    if (u >= SKY_MID_U) {
      scratch.copy(mid).lerp(zenith, (u - SKY_MID_U) / (1 - SKY_MID_U));
    } else if (u >= SKY_HORIZON_BAND_U) {
      scratch
        .copy(horizon)
        .lerp(mid, (u - SKY_HORIZON_BAND_U) / (SKY_MID_U - SKY_HORIZON_BAND_U));
    } else {
      scratch.copy(horizon);
    }
    colors[i * 3] = scratch.r;
    colors[i * 3 + 1] = scratch.g;
    colors[i * 3 + 2] = scratch.b;
  }
  geometry.setAttribute('color', new Float32BufferAttribute(colors, 3));
}

/** Measured budget of one assembled rig — real counts, not estimates. */
export interface SkyStats {
  /** Total triangles across all three draw-call-producing objects. */
  readonly triangles: number;
  /** Draw calls produced (dome + sun disc + cloud layer). */
  readonly drawCalls: number;
  readonly domeTriangles: number;
  readonly sunTriangles: number;
  /** All slabs of the single instanced cloud draw. */
  readonly cloudTriangles: number;
  readonly cloudSlabCount: number;
  readonly domeRadiusM: number;
  /** Lights this rig adds to the scene (design-doc cap: 3). */
  readonly lightCount: number;
  readonly fog: { readonly color: HexColor; readonly nearM: number; readonly farM: number };
}

/**
 * A built rig. All fields are static objects owned by this module; nothing
 * here is touched per frame, and there is no update method to call. `disposeSky`
 * releases everything.
 */
export interface SkyRig {
  /** The scene this rig configured; used by `disposeSky` to drop the fog. */
  readonly scene: Scene;
  readonly dome: Mesh<SphereGeometry, MeshBasicMaterial>;
  readonly clouds: InstancedMesh<SphereGeometry, MeshBasicMaterial>;
  readonly sunDisc: Mesh<IcosahedronGeometry, MeshBasicMaterial>;
  /** Directional sun key light; its position is the direction toward the sun. */
  readonly sun: DirectionalLight;
  /** Hemisphere fill light. */
  readonly hemi: HemisphereLight;
  /**
   * Fog for the whole scene: skyHorizon colour, config near/far in metres.
   * `createSky` assigns it to `scene.fog` so the setting actually applies.
   */
  readonly fog: Fog;
  readonly domeGeometry: SphereGeometry;
  readonly sunGeometry: IcosahedronGeometry;
  readonly cloudGeometry: SphereGeometry;
  readonly stats: SkyStats;
}

/**
 * Builds the sunset sky and lighting rig and attaches it through the frozen
 * scene-graph seam: dome + clouds + hemisphere light to the `sky` slot, sun
 * disc + directional light to the `sun` slot. One-time setup; deterministic;
 * throws early on a config that cannot produce a valid rig (non-finite sun
 * angles, fog with nearM >= farM, or a budget overshoot).
 */
export function createSky(graph: SceneGraph, config: FullStyleConfig): SkyRig {
  const { azimuthDeg, elevationDeg } = config.sun;
  if (!Number.isFinite(azimuthDeg) || !Number.isFinite(elevationDeg)) {
    throw new Error(
      `createSky: sun azimuthDeg (${azimuthDeg}) and elevationDeg (${elevationDeg}) must be finite`,
    );
  }
  const { nearM, farM } = config.fog;
  if (!Number.isFinite(nearM) || !Number.isFinite(farM) || nearM >= farM) {
    throw new Error(
      `createSky: fog must be finite with nearM < farM (got nearM ${nearM}, farM ${farM})`,
    );
  }

  const horizonCss = paletteKey(config, 'skyHorizon');
  const midCss = paletteKey(config, 'skyMid');
  const zenithCss = paletteKey(config, 'skyZenith');
  const sunCss = paletteKey(config, 'sunDisc');

  // Fog colour is the palette horizon by the design-doc rule "fog =
  // skyHorizon" — the same value the dome's bottom band uses, so terrain,
  // hills and sky melt into one warm horizon line.
  const fog = new Fog(horizonCss, nearM, farM);

  // --- 1. sky dome --------------------------------------------------------
  const domeGeometry = new SphereGeometry(
    DOME_RADIUS_M,
    DOME_WIDTH_SEGMENTS,
    DOME_HEIGHT_SEGMENTS,
  );
  paintDomeGradient(
    domeGeometry,
    colorFromCss(horizonCss),
    colorFromCss(midCss),
    colorFromCss(zenithCss),
  );
  const domeMaterial = new MeshBasicMaterial({
    vertexColors: true, // the gradient lives in vertex colours — no textures
    fog: false, // a sky backdrop must not be fogged
    side: BackSide, // viewed from inside the sphere
    depthWrite: false, // never occludes; slot order draws it first regardless
  });
  const dome = new Mesh(domeGeometry, domeMaterial);
  dome.name = DOME_NAME;
  dome.position.copy(DOME_CENTER);
  // Within the 'sky' slot: dome behind the cloud layer. Across slots the
  // slot's own renderOrder (sky = 0, sun = 1) already orders everything,
  // because three inherits a Group's renderOrder as groupOrder.
  dome.renderOrder = 1;

  // --- 2. sun disc + sun light -------------------------------------------
  // Direction from the world toward the sun: position-style vector, so the
  // light placed at it illuminates the scene from the configured bearing and
  // the disc sits on exactly that sight line. Azimuth 0 = +Z, positive turns
  // toward +X (mirrored from compass headings so they stay readable).
  const direction = new Vector3(
    Math.sin(azimuthDeg * DEG_TO_RAD) * Math.cos(elevationDeg * DEG_TO_RAD),
    Math.sin(elevationDeg * DEG_TO_RAD),
    -Math.cos(azimuthDeg * DEG_TO_RAD) * Math.cos(elevationDeg * DEG_TO_RAD),
  );
  const sunGeometry = new IcosahedronGeometry(SUN_DISC_RADIUS_M, 1);
  const sunMaterial = new MeshBasicMaterial({
    // Emissive by construction: an unlit material emits its colour unchanged,
    // so the disc reads bright with no lights in the scene at all.
    color: sunCss,
    fog: false, // the sunset focal point must not wash out
    depthWrite: false, // occluded correctly by clouds/hills drawn after it
  });
  const sunDisc = new Mesh(sunGeometry, sunMaterial);
  sunDisc.name = SUN_DISC_NAME;
  sunDisc.position.copy(DOME_CENTER).addScaledVector(direction, SUN_DISC_ORBIT_M);
  sunDisc.renderOrder = 1;

  // --- 3. cloud layer -----------------------------------------------------
  const cloudGeometry = new SphereGeometry(
    1,
    CLOUD_PROTOTYPE_WIDTH_SEGMENTS,
    CLOUD_PROTOTYPE_HEIGHT_SEGMENTS,
  );
  const cloudColor = colorFromCss(sunCss).lerp(
    new Color(1, 1, 1),
    CLOUD_LIGHTEN_TOWARD_WHITE,
  );
  // Fog stays on (three's default for every material): distant slabs soften
  // into the horizon colour exactly like terrain does.
  const cloudMaterial = new MeshBasicMaterial({ color: cloudColor });
  const clouds = new InstancedMesh(cloudGeometry, cloudMaterial, CLOUD_SLABS.length);
  clouds.name = CLOUD_LAYER_NAME;
  const instanceMatrix = new Matrix4();
  const instanceScale = new Vector3();
  const instancePosition = new Vector3();
  let cloudIndex = 0;
  for (const slab of CLOUD_SLABS) {
    instancePosition.set(slab.x, slab.y, slab.z);
    instanceScale.set(slab.sx, slab.sy, slab.sz);
    instanceMatrix.makeRotationY(slab.yaw).scale(instanceScale).setPosition(instancePosition);
    clouds.setMatrixAt(cloudIndex, instanceMatrix);
    cloudIndex += 1;
  }
  clouds.instanceMatrix.needsUpdate = true;
  clouds.renderOrder = 2; // in front of the dome, behind nothing else in 'sky'

  // --- lighting (2 of the style's "at most 3 lights") ---------------------
  const sun = new DirectionalLight(config.sun.color, config.sun.intensity);
  sun.name = SUN_LIGHT_NAME;
  sun.position.copy(direction); // position-style direction; target stays at origin
  const hemi = new HemisphereLight(config.hemi.sky, config.hemi.ground, config.hemi.intensity);
  hemi.name = HEMI_LIGHT_NAME;

  // --- scene-level config + attach through the frozen seam ----------------
  // `root` is the seam's getter for the renderer; fog belongs to the Scene
  // itself, never to a slot. Note for the orchestrator: task 9
  // (atmosphere.ts, mist band) may take this over at runtime — last writer
  // wins and both are configured from the same `fog = skyHorizon` rule.
  graph.root.fog = fog;
  graph.attach('sky', dome);
  graph.attach('sky', clouds);
  graph.attach('sky', hemi);
  graph.attach('sun', sunDisc);
  graph.attach('sun', sun);

  // --- measured budget + boot-time invariants -----------------------------
  const domeTriangles = countTriangles(domeGeometry);
  const sunTriangles = countTriangles(sunGeometry);
  const cloudTriangles = countTriangles(cloudGeometry, CLOUD_SLABS.length);
  if (cloudTriangles % CLOUD_SLABS.length !== 0) {
    throw new Error('createSky: cloud prototype geometry is not uniform per instance');
  }
  if (CLOUD_SLABS.length > SKY_CLOUD_SLAB_MAX) {
    throw new Error(
      `createSky: ${CLOUD_SLABS.length} cloud slabs exceed the design-doc maximum ${SKY_CLOUD_SLAB_MAX}`,
    );
  }
  const triangles = domeTriangles + sunTriangles + cloudTriangles;
  if (triangles > SKY_TRIANGLE_BUDGET) {
    throw new Error(
      `createSky: triangle budget exceeded — ${triangles} > ${SKY_TRIANGLE_BUDGET}`,
    );
  }

  const stats: SkyStats = {
    triangles,
    drawCalls: SKY_DRAW_CALLS,
    domeTriangles,
    sunTriangles,
    cloudTriangles,
    cloudSlabCount: CLOUD_SLABS.length,
    domeRadiusM: DOME_RADIUS_M,
    lightCount: 2,
    fog: { color: horizonCss, nearM, farM },
  };

  return {
    scene: graph.root,
    dome,
    clouds,
    sunDisc,
    sun,
    hemi,
    fog,
    domeGeometry,
    sunGeometry,
    cloudGeometry,
    stats,
  };
}

/**
 * Releases every geometry and material this rig owns and detaches all five
 * objects from their slots. Idempotent. One-time teardown, never per frame.
 */
export function disposeSky(rig: SkyRig): void {
  if (rig.scene.fog === rig.fog) {
    // Leave no orphan fog behind: only clear it if it is still ours.
    rig.scene.fog = null;
  }
  rig.dome.removeFromParent();
  rig.clouds.removeFromParent();
  rig.sunDisc.removeFromParent();
  rig.sun.removeFromParent();
  rig.hemi.removeFromParent();
  rig.domeGeometry.dispose();
  rig.sunGeometry.dispose();
  rig.cloudGeometry.dispose();
  const materials: readonly MeshBasicMaterial[] = [
    rig.dome.material,
    rig.sunDisc.material,
    rig.clouds.material,
  ];
  for (const material of materials) {
    material.dispose();
  }
}

/**
 * Boot-time debug line: prints the measured rig budget and the fog setup, so
 * the orchestrator's behaviour check has a machine-readable marker without
 * needing to open a browser. Not part of the frame path.
 */
export function logSkyBudget(rig: SkyRig): void {
  const s = rig.stats;
  console.log(
    `[sky] ${s.drawCalls} draws, ${s.triangles} tris ` +
      `(dome ${s.domeTriangles}, sun ${s.sunTriangles}, clouds ${s.cloudTriangles} ` +
      `in ${s.cloudSlabCount} slabs); lights ${s.lightCount}; ` +
      `fog ${s.fog.color} ${s.fog.nearM}-${s.fog.farM} m; dome radius ${s.domeRadiusM} m`,
  );
}
