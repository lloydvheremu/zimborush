/**
 * Seeded instanced prop scatter for ZimboRush (design doc §14.8; task 17).
 *
 * Produces the two prop families the frozen seam knows about, as
 * `IPropSource` implementations:
 *
 *   - trees: 2 instanced variants, target 120 instances, 50 tris/instance cap
 *   - rocks: 3 instanced variants, target  70 instances, 35 tris/instance cap
 *
 * Each variant owns its own geometry, so the renderer issues exactly one
 * `InstancedMesh` / draw call per variant: 2 tree draws + 3 rock draws = 5.
 * `IPropSource.variantCount` is what drives that mapping, and the variant
 * geometry arrays below always have exactly `variantCount` entries
 * (index == `PropRecord.variant`).
 *
 * Determinism (design §3): every position, rotation, scale and variant comes
 * from `core/rng` streams derived with `hashSeed(seed, streamId)`. Trees and
 * rocks use different stream ids, so changing one family's seed cannot move
 * the other. There is no `Math.random` in this file.
 *
 * Layout rules:
 *   - every prop keeps `roadClearanceM` plus its footprint away from the road
 *     centreline (measured against the sampled plan-view spline), so no prop
 *     ever sits on the road corridor;
 *   - props stay `marginM` inside the terrain bounds;
 *   - `y` is exactly `terrain.heightAt(x, z)`;
 *   - candidates come from a shuffled jittered grid plus a minimum-spacing
 *     rejection rule, which keeps the scatter spread out rather than clumped.
 *
 * Colour note: variant geometries bake their derived tints into the vertex
 * colour attribute as linear-sRGB floats (three's default colour-managed
 * pipeline), so one `vertexColors` material per variant is enough and
 * `tintCount` stays 1.
 */
import { BufferGeometry, Float32BufferAttribute } from 'three';

import { createRng, hashSeed } from '../../core/rng';
import type { Rng } from '../../core/rng';
import type { ColorSource, HexColor } from '../../renderer/contracts';
import type {
  BuiltGeometry,
  IPropSource,
  ISplineSource,
  ITerrainSource,
  PropRecord,
  SpawnContext,
  Vec3Mut,
} from '../../world/contracts';

/** Stable slot ids (frozen contract `IPropSource.id`). */
export const TREE_SOURCE_ID = 'trees';
export const ROCK_SOURCE_ID = 'rocks';

/** One instanced draw call per variant (design §5); 2 + 3 = 5 draws total. */
export const TREE_VARIANT_COUNT = 2;
export const ROCK_VARIANT_COUNT = 3;

/** Independent rng stream ids, matching the example in `core/rng.ts`. */
export const TREE_STREAM = 1;
export const ROCK_STREAM = 2;

/** Instance targets from design §5 / §14.8. */
export const TREE_TARGET_INSTANCES = 120;
export const ROCK_TARGET_INSTANCES = 70;

/** Per-instance triangle ceilings from design §5; enforced by the builders. */
export const TREE_TRIANGLES_PER_INSTANCE = 50;
export const ROCK_TRIANGLES_PER_INSTANCE = 35;

export type PropFamily = 'tree' | 'rock';

/** Placement parameters per family. Tuned to look spread out, not gridded. */
interface FamilyConfig {
  readonly streamId: number;
  readonly variantCount: number;
  readonly targetInstances: number;
  /** Jittered-grid cell, metres. One candidate per cell, order shuffled. */
  readonly cellSizeM: number;
  /** Keep-out margin from the terrain bounds, metres. */
  readonly marginM: number;
  /** Extra clearance beyond `roadClearanceM` so the prop body stays off the shoulder. */
  readonly footprintM: number;
  /** Minimum centre-to-centre distance between same-family props, metres. */
  readonly minSpacingM: number;
  readonly scaleMin: number;
  readonly scaleMax: number;
}

const FAMILIES: Readonly<Record<PropFamily, FamilyConfig>> = {
  tree: {
    streamId: TREE_STREAM,
    variantCount: TREE_VARIANT_COUNT,
    targetInstances: TREE_TARGET_INSTANCES,
    cellSizeM: 20,
    marginM: 14,
    footprintM: 3.5,
    minSpacingM: 9,
    scaleMin: 0.8,
    scaleMax: 1.25,
  },
  rock: {
    streamId: ROCK_STREAM,
    variantCount: ROCK_VARIANT_COUNT,
    targetInstances: ROCK_TARGET_INSTANCES,
    cellSizeM: 26,
    marginM: 10,
    footprintM: 1.8,
    minSpacingM: 5,
    scaleMin: 0.7,
    scaleMax: 1.3,
  },
};

const TAU = Math.PI * 2;

/** Road polyline resolution for clearance tests, metres. */
const ROAD_SAMPLE_STEP_M = 2;

export interface ScatterRequest {
  readonly family: PropFamily;
  /** Base seed; each family derives its own stream from it (see `hashSeed`). */
  readonly baseSeed: number;
  readonly terrain: ITerrainSource;
  readonly spline: ISplineSource;
  readonly roadClearanceM: number;
}

interface RoadSamples {
  readonly xs: Float64Array;
  readonly zs: Float64Array;
  readonly halfWidths: Float64Array;
  readonly count: number;
}

interface RoadProbe {
  readonly distM: number;
  readonly halfWidthM: number;
}

/**
 * Deterministic scatter for one family. Exported so tests can vary a single
 * family's seed and observe that the other family's layout is unaffected.
 */
export function scatterProps(request: ScatterRequest): PropRecord[] {
  const family = FAMILIES[request.family];
  const rng = createRng(hashSeed(request.baseSeed, family.streamId));
  const road = sampleRoad(request.spline);

  const bounds = request.terrain.bounds;
  const minX = bounds.minX + family.marginM;
  const maxX = bounds.maxX - family.marginM;
  const minZ = bounds.minZ + family.marginM;
  const maxZ = bounds.maxZ - family.marginM;

  const records: PropRecord[] = [];
  const clearanceM = request.roadClearanceM + family.footprintM;
  const spacing2 = family.minSpacingM * family.minSpacingM;

  const tryAccept = (x: number, z: number): void => {
    if (x < minX || x > maxX || z < minZ || z > maxZ) return;
    const probe = probeRoad(road, x, z);
    if (probe.distM <= probe.halfWidthM + clearanceM) return;
    for (let i = 0; i < records.length; i++) {
      const dx = records[i].x - x;
      const dz = records[i].z - z;
      if (dx * dx + dz * dz < spacing2) return;
    }
    records.push(makeRecord(rng, family, request.terrain, x, z));
  };

  const cols = Math.floor((maxX - minX) / family.cellSizeM);
  const rows = Math.floor((maxZ - minZ) / family.cellSizeM);
  const order = shuffledIndices(rng, cols * rows);
  const half = family.cellSizeM / 2;

  for (let k = 0; k < order.length && records.length < family.targetInstances; k++) {
    const cell = order[k];
    const col = cell % cols;
    const row = (cell - col) / cols;
    const x = minX + (col + 0.5) * family.cellSizeM + rng.range(-half, half);
    const z = minZ + (row + 0.5) * family.cellSizeM + rng.range(-half, half);
    tryAccept(x, z);
  }

  // Fallback for pathological seeds: keep sampling uniformly until the target
  // is met or the attempt budget runs out. Deterministic either way.
  const attemptCap = family.targetInstances * 20;
  for (let i = 0; i < attemptCap && records.length < family.targetInstances; i++) {
    tryAccept(rng.range(minX, maxX), rng.range(minZ, maxZ));
  }

  return records;
}

/** Trees source: 2 variants, one instanced draw each. */
export function createTreeSource(): IPropSource {
  return {
    id: TREE_SOURCE_ID,
    variantCount: TREE_VARIANT_COUNT,
    build: (ctx: SpawnContext): PropRecord[] =>
      scatterProps({
        family: 'tree',
        baseSeed: ctx.seed,
        terrain: ctx.terrain,
        spline: ctx.spline,
        roadClearanceM: ctx.roadClearanceM,
      }),
  };
}

/** Rocks source: 3 variants, one instanced draw each. */
export function createRockSource(): IPropSource {
  return {
    id: ROCK_SOURCE_ID,
    variantCount: ROCK_VARIANT_COUNT,
    build: (ctx: SpawnContext): PropRecord[] =>
      scatterProps({
        family: 'rock',
        baseSeed: ctx.seed,
        terrain: ctx.terrain,
        spline: ctx.spline,
        roadClearanceM: ctx.roadClearanceM,
      }),
  };
}

/**
 * Per-variant geometry for the tree source. `result[i]` is the geometry for
 * `PropRecord.variant === i`; `result.length === variantCount`, so building one
 * `InstancedMesh` per entry yields exactly the 2 budgeted tree draw calls.
 */
export function createTreeVariantGeometries(colors: ColorSource): BuiltGeometry[] {
  const trunk = hexToLinearRgb(colors.derived({ kind: 'treeTrunk' }));
  const foliage = hexToLinearRgb(colors.derived({ kind: 'foliageVariant' }));
  return [
    variantGeometry(buildConifer(trunk, foliage), 'tree-conifer', TREE_TRIANGLES_PER_INSTANCE),
    variantGeometry(buildBroadleaf(trunk, foliage), 'tree-broadleaf', TREE_TRIANGLES_PER_INSTANCE),
  ];
}

/**
 * Per-variant geometry for the rock source, same contract as the tree builder:
 * 3 entries => 3 instanced draw calls.
 */
export function createRockVariantGeometries(colors: ColorSource): BuiltGeometry[] {
  const lighter = hexToLinearRgb(colors.derived({ kind: 'rockVariant', level: 0 }));
  const darker = hexToLinearRgb(colors.derived({ kind: 'rockVariant', level: 1 }));
  return [
    variantGeometry(buildBoulder(lighter), 'rock-boulder', ROCK_TRIANGLES_PER_INSTANCE),
    variantGeometry(buildSlab(darker), 'rock-slab', ROCK_TRIANGLES_PER_INSTANCE, (geometry) => {
      geometry.scale(1.7, 1, 0.9);
      geometry.computeBoundingSphere();
    }),
    variantGeometry(buildPebble(darker), 'rock-pebble', ROCK_TRIANGLES_PER_INSTANCE),
  ];
}

function makeRecord(
  rng: Rng,
  family: FamilyConfig,
  terrain: ITerrainSource,
  x: number,
  z: number,
): PropRecord {
  return {
    variant: rng.int(0, family.variantCount),
    x,
    y: terrain.heightAt(x, z),
    z,
    rotation: rng.range(0, TAU),
    scale: rng.range(family.scaleMin, family.scaleMax),
  };
}

function sampleRoad(spline: ISplineSource): RoadSamples {
  const count = Math.max(8, Math.ceil(spline.lengthM / ROAD_SAMPLE_STEP_M));
  const xs = new Float64Array(count);
  const zs = new Float64Array(count);
  const halfWidths = new Float64Array(count);
  const out: Vec3Mut = { x: 0, y: 0, z: 0 };
  const stepM = spline.lengthM / count;
  for (let i = 0; i < count; i++) {
    const s = i * stepM;
    spline.pointAt(s, out);
    xs[i] = out.x;
    zs[i] = out.z;
    halfWidths[i] = spline.halfWidthAt(s);
  }
  return { xs, zs, halfWidths, count };
}

/** Point-to-polyline distance with the half-width at the nearest segment. */
function probeRoad(road: RoadSamples, x: number, z: number): RoadProbe {
  const { xs, zs, count } = road;
  let bestD2 = Infinity;
  let bestIndex = 0;
  for (let i = 0; i < count; i++) {
    const j = i + 1 === count ? 0 : i + 1;
    const ax = xs[i];
    const az = zs[i];
    const abx = xs[j] - ax;
    const abz = zs[j] - az;
    const len2 = abx * abx + abz * abz;
    let t = len2 > 0 ? ((x - ax) * abx + (z - az) * abz) / len2 : 0;
    t = t < 0 ? 0 : t > 1 ? 1 : t;
    const dx = x - (ax + t * abx);
    const dz = z - (az + t * abz);
    const d2 = dx * dx + dz * dz;
    if (d2 < bestD2) {
      bestD2 = d2;
      bestIndex = i;
    }
  }
  return { distM: Math.sqrt(bestD2), halfWidthM: road.halfWidths[bestIndex] };
}

function shuffledIndices(rng: Rng, count: number): number[] {
  const indices = new Array<number>(count);
  for (let i = 0; i < count; i++) indices[i] = i;
  for (let i = count - 1; i > 0; i--) {
    // Fisher-Yates, seeded: the same stream always visits cells in the same order.
    const j = rng.int(0, i + 1);
    const tmp = indices[i];
    indices[i] = indices[j];
    indices[j] = tmp;
  }
  return indices;
}

// ---------------------------------------------------------------------------
// Low-poly variant geometry
// ---------------------------------------------------------------------------

type Vec3 = readonly [number, number, number];
type Rgb = readonly [number, number, number];

interface MeshData {
  positions: number[];
  normals: number[];
  colors: number[];
}

function emptyMesh(): MeshData {
  return { positions: [], normals: [], colors: [] };
}

function faceNormal(a: Vec3, b: Vec3, c: Vec3): Vec3 {
  const ux = b[0] - a[0];
  const uy = b[1] - a[1];
  const uz = b[2] - a[2];
  const vx = c[0] - a[0];
  const vy = c[1] - a[1];
  const vz = c[2] - a[2];
  const nx = uy * vz - uz * vy;
  const ny = uz * vx - ux * vz;
  const nz = ux * vy - uy * vx;
  const len = Math.sqrt(nx * nx + ny * ny + nz * nz) || 1;
  return [nx / len, ny / len, nz / len];
}

/**
 * Appends one flat-shaded triangle with per-face normal and a uniform colour,
 * flipping the winding when it would face away from `outward`. Winding is
 * therefore derived from geometry, not hand-authored.
 */
function pushFace(mesh: MeshData, a: Vec3, b: Vec3, c: Vec3, rgb: Rgb, outward: Vec3): void {
  let normal = faceNormal(a, b, c);
  let second = b;
  let third = c;
  if (normal[0] * outward[0] + normal[1] * outward[1] + normal[2] * outward[2] < 0) {
    second = c;
    third = b;
    normal = [-normal[0], -normal[1], -normal[2]];
  }
  mesh.positions.push(a[0], a[1], a[2], second[0], second[1], second[2], third[0], third[1], third[2]);
  mesh.normals.push(normal[0], normal[1], normal[2], normal[0], normal[1], normal[2], normal[0], normal[1], normal[2]);
  mesh.colors.push(rgb[0], rgb[1], rgb[2], rgb[0], rgb[1], rgb[2], rgb[0], rgb[1], rgb[2]);
}

function ringRadius(
  base: number,
  mul: readonly number[] | undefined,
  index: number,
  segments: number,
): number {
  if (!mul || mul.length === 0) return base;
  return base * mul[(index % segments) % mul.length];
}

function ringVertex(segments: number, index: number, radius: number, y: number): Vec3 {
  const t = (index / segments) * TAU;
  return [Math.cos(t) * radius, y, Math.sin(t) * radius];
}

/** Cone side faces: ring at `yBase`, apex at `yApex` (may point down). */
function pushCone(
  mesh: MeshData,
  segments: number,
  baseRadius: number,
  yBase: number,
  yApex: number,
  rgb: Rgb,
  mul?: readonly number[],
): void {
  const apex: Vec3 = [0, yApex, 0];
  for (let i = 0; i < segments; i++) {
    const p0 = ringVertex(segments, i, ringRadius(baseRadius, mul, i, segments), yBase);
    const p1 = ringVertex(segments, i + 1, ringRadius(baseRadius, mul, i + 1, segments), yBase);
    const cx = (p0[0] + p1[0] + apex[0]) / 3;
    const cz = (p0[2] + p1[2] + apex[2]) / 3;
    pushFace(mesh, p0, p1, apex, rgb, [cx, 0, cz]);
  }
}

/** Frustum side wall between two rings, no caps. */
function pushFrustum(
  mesh: MeshData,
  segments: number,
  rBottom: number,
  rTop: number,
  y0: number,
  y1: number,
  rgb: Rgb,
  mul?: readonly number[],
): void {
  for (let i = 0; i < segments; i++) {
    const b0 = ringVertex(segments, i, ringRadius(rBottom, mul, i, segments), y0);
    const b1 = ringVertex(segments, i + 1, ringRadius(rBottom, mul, i + 1, segments), y0);
    const t0 = ringVertex(segments, i, ringRadius(rTop, mul, i, segments), y1);
    const t1 = ringVertex(segments, i + 1, ringRadius(rTop, mul, i + 1, segments), y1);
    const cx = (b0[0] + b1[0] + t1[0] + t0[0]) / 4;
    const cz = (b0[2] + b1[2] + t1[2] + t0[2]) / 4;
    pushFace(mesh, b0, b1, t1, rgb, [cx, 0, cz]);
    pushFace(mesh, b0, t1, t0, rgb, [cx, 0, cz]);
  }
}

/** Upward-facing n-gon cap, fanned from the centre. */
function pushTopCap(
  mesh: MeshData,
  segments: number,
  radius: number,
  y: number,
  rgb: Rgb,
  mul?: readonly number[],
): void {
  const hub: Vec3 = [0, y, 0];
  for (let i = 0; i < segments; i++) {
    const p0 = ringVertex(segments, i, ringRadius(radius, mul, i, segments), y);
    const p1 = ringVertex(segments, i + 1, ringRadius(radius, mul, i + 1, segments), y);
    pushFace(mesh, hub, p0, p1, rgb, [0, 1, 0]);
  }
}

function triangleCount(mesh: MeshData): number {
  return mesh.positions.length / 9;
}

function createGeometry(mesh: MeshData): BufferGeometry {
  const geometry = new BufferGeometry();
  geometry.setAttribute('position', new Float32BufferAttribute(mesh.positions, 3));
  geometry.setAttribute('normal', new Float32BufferAttribute(mesh.normals, 3));
  geometry.setAttribute('color', new Float32BufferAttribute(mesh.colors, 3));
  geometry.computeBoundingSphere();
  return geometry;
}

function variantGeometry(
  mesh: MeshData,
  name: string,
  triCeiling: number,
  transform?: (geometry: BufferGeometry) => void,
): BuiltGeometry {
  const tris = triangleCount(mesh);
  if (tris > triCeiling) {
    throw new Error(`${name}: ${tris} triangles exceed the ${triCeiling}-triangle per-instance budget`);
  }
  const geometry = createGeometry(mesh);
  if (transform) {
    transform(geometry);
  }
  // All tints are baked into the vertex colour attribute, so a single
  // vertexColors material draws the whole variant: tintCount stays 1.
  return { geometry, name, tintCount: 1 };
}

/** Conifer: square trunk + four stacked hexagonal foliage tiers. 32 triangles. */
function buildConifer(trunk: Rgb, foliage: Rgb): MeshData {
  const mesh = emptyMesh();
  pushFrustum(mesh, 4, 0.22, 0.17, 0, 1.5, trunk);
  pushCone(mesh, 6, 1.5, 1.15, 3.05, foliage);
  pushCone(mesh, 6, 1.18, 2.05, 3.9, foliage);
  pushCone(mesh, 6, 0.86, 2.95, 4.75, foliage);
  pushCone(mesh, 6, 0.5, 3.8, 5.5, foliage);
  return mesh;
}

/** Broadleaf: square trunk + three stacked hexagonal bipyramid canopy lobes. 44 triangles. */
function buildBroadleaf(trunk: Rgb, foliage: Rgb): MeshData {
  const mesh = emptyMesh();
  pushFrustum(mesh, 4, 0.24, 0.18, 0, 1.9, trunk);
  pushCone(mesh, 6, 1.65, 2.35, 3.75, foliage);
  pushCone(mesh, 6, 1.65, 2.35, 1.55, foliage);
  pushCone(mesh, 6, 1.25, 3.3, 4.5, foliage);
  pushCone(mesh, 6, 1.25, 3.3, 2.55, foliage);
  pushCone(mesh, 6, 0.85, 4.0, 5.05, foliage);
  pushCone(mesh, 6, 0.85, 4.0, 3.3, foliage);
  return mesh;
}

/** Boulder: two irregular frusta + top cap. 25 triangles. */
function buildBoulder(rgb: Rgb): MeshData {
  const mesh = emptyMesh();
  const mul = [1, 0.84, 1.12, 0.9, 1.06];
  pushFrustum(mesh, 5, 1.15, 0.97, 0, 0.55, rgb, mul);
  pushFrustum(mesh, 5, 0.97, 0.5, 0.55, 0.98, rgb, mul);
  pushTopCap(mesh, 5, 0.5, 0.98, rgb, mul);
  return mesh;
}

/** Slab: low irregular hexagonal frustum, stretched along X by the caller. 18 triangles. */
function buildSlab(rgb: Rgb): MeshData {
  const mesh = emptyMesh();
  const mul = [1.25, 0.9, 1.1, 0.85, 1.15, 0.95];
  pushFrustum(mesh, 6, 0.95, 0.6, 0, 0.36, rgb, mul);
  pushTopCap(mesh, 6, 0.6, 0.36, rgb, mul);
  return mesh;
}

/** Pebble: squat irregular square frustum. 12 triangles. */
function buildPebble(rgb: Rgb): MeshData {
  const mesh = emptyMesh();
  const mul = [1.15, 0.88, 1.05, 0.82];
  pushFrustum(mesh, 4, 0.52, 0.28, 0, 0.3, rgb, mul);
  pushTopCap(mesh, 4, 0.28, 0.3, rgb, mul);
  return mesh;
}

function srgbToLinear(channel: number): number {
  return channel <= 0.04045 ? channel / 12.92 : Math.pow((channel + 0.055) / 1.055, 2.4);
}

/** '#RRGGBB' → linear-sRGB floats, matching three's colour-managed pipeline. */
function hexToLinearRgb(hex: HexColor): Rgb {
  const value = hex.startsWith('#') ? hex.slice(1) : hex;
  const n = Number.parseInt(value, 16);
  const r = ((n >> 16) & 0xff) / 255;
  const g = ((n >> 8) & 0xff) / 255;
  const b = (n & 0xff) / 255;
  return [srgbToLinear(r), srgbToLinear(g), srgbToLinear(b)];
}
