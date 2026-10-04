/**
 * Blob shadows for the player and the rival — design doc §5 (one draw call,
 * 4 triangles) and §4 (colour = terrainShade x 0.6 at a fixed alpha ~0.35).
 *
 * Both shadows are two quads in ONE non-indexed BufferGeometry (12 vertices =
 * 4 triangles) drawn with ONE material, so the pair costs exactly one draw
 * call. Positions are rewritten in place every frame; each corner samples
 * ITerrainSource.heightAt so the shadow drapes over the terrain instead of
 * clipping into slopes. Nothing is allocated per frame and no texture is used.
 *
 * Transparency: the quads are alpha-blended with depthWrite off — cheap here
 * (4 triangles) but part of the same transparent pass that §5 rations. The
 * colour comes from the ColorSource derived rule; this module only adds the
 * fixed alpha.
 */

import {
  BufferAttribute,
  BufferGeometry,
  DoubleSide,
  DynamicDrawUsage,
  Mesh,
  MeshBasicMaterial,
} from 'three';
import type { ColorSource } from '../../renderer/contracts';
import type { ITerrainSource } from '../../world/contracts';

/** Bike-sized silhouette, shared by both riders (ESTIMATE, metres). */
const BIKE_HALF_LENGTH_M = 0.7;
const BIKE_HALF_WIDTH_M = 0.38;
/** Lift above the terrain surface, to stay clear of the draped road mesh (ESTIMATE). */
const SHADOW_LIFT_M = 0.05;
/** §4's fixed alpha (ESTIMATE). */
const SHADOW_ALPHA = 0.35;
/**
 * Documented fallback only, if the style layer returns a malformed hex: §4's
 * rule for the default palette is #8A6A4F x 0.6 = #53402F (rounded per channel).
 */
const FALLBACK_SHADOW_HEX = 0x53402f;
const HEX6 = /^#[0-9a-fA-F]{6}$/;

/** Reads `#RRGGBB`, or `fallback` when the style layer returned something else. */
function readHex6(hex: string, fallback: number): number {
  return HEX6.test(hex) ? Number.parseInt(hex.slice(1), 16) : fallback;
}

export interface BlobRider {
  /** Rider position on the plan-view plane (metres). */
  readonly x: number;
  readonly z: number;
  /** Heading in radians; the long axis runs along (sin h, 0, cos h). */
  readonly headingRad: number;
}

export interface BlobShadowOptions {
  /** Style source; the blobShadow derived rule (§4) is the only colour input. */
  colors: ColorSource;
  /** Height source for draping the quads over the terrain. */
  terrain: ITerrainSource;
}

export interface BlobShadows {
  /** The single draw item; add it to the scene once. */
  readonly mesh: Mesh;
  /** Triangles in the single buffer: 2 quads x 2 (design doc §5). */
  readonly triangleCount: number;
  update(player: BlobRider, rival: BlobRider): void;
  dispose(): void;
}

/** Creates the shared blob-shadow buffer for both riders. */
export function createBlobShadows(options: BlobShadowOptions): BlobShadows {
  const terrain = options.terrain;
  const positionArray = new Float32Array(2 * 6 * 3); // 12 vertices, 4 triangles
  const positionAttr = new BufferAttribute(positionArray, 3);
  positionAttr.setUsage(DynamicDrawUsage);

  const geometry = new BufferGeometry();
  geometry.setAttribute('position', positionAttr);

  const material = new MeshBasicMaterial({
    transparent: true,
    depthWrite: false, // a ground decal must not occlude anything
    side: DoubleSide, // visible from any post; winding is then not load-bearing
  });
  material.color.setHex(
    readHex6(options.colors.derived({ kind: 'blobShadow' }), FALLBACK_SHADOW_HEX),
  );
  material.opacity = SHADOW_ALPHA;
  material.name = 'blobShadow';

  const mesh = new Mesh(geometry, material);
  mesh.name = 'blobShadows';
  // Both shadows follow the riders; a bounding sphere baked from the initial
  // (degenerate) vertices would cull them wrongly.
  mesh.frustumCulled = false;

  function writeShadow(slot: number, rider: BlobRider): void {
    const heading = rider.headingRad;
    const forwardX = Math.sin(heading) * BIKE_HALF_LENGTH_M;
    const forwardZ = Math.cos(heading) * BIKE_HALF_LENGTH_M;
    const rightX = Math.cos(heading) * BIKE_HALF_WIDTH_M;
    const rightZ = -Math.sin(heading) * BIKE_HALF_WIDTH_M;

    const ax = rider.x - forwardX - rightX;
    const az = rider.z - forwardZ - rightZ;
    const bx = rider.x - forwardX + rightX;
    const bz = rider.z - forwardZ + rightZ;
    const cx = rider.x + forwardX + rightX;
    const cz = rider.z + forwardZ + rightZ;
    const dx = rider.x + forwardX - rightX;
    const dz = rider.z + forwardZ - rightZ;

    // Each corner follows the terrain, so the quad drapes over slopes.
    const ay = terrain.heightAt(ax, az) + SHADOW_LIFT_M;
    const by = terrain.heightAt(bx, bz) + SHADOW_LIFT_M;
    const cy = terrain.heightAt(cx, cz) + SHADOW_LIFT_M;
    const dy = terrain.heightAt(dx, dz) + SHADOW_LIFT_M;

    const o = slot * 18; // two triangles, six vertices
    positionArray[o] = ax; positionArray[o + 1] = ay; positionArray[o + 2] = az;
    positionArray[o + 3] = bx; positionArray[o + 4] = by; positionArray[o + 5] = bz;
    positionArray[o + 6] = cx; positionArray[o + 7] = cy; positionArray[o + 8] = cz;
    positionArray[o + 9] = ax; positionArray[o + 10] = ay; positionArray[o + 11] = az;
    positionArray[o + 12] = cx; positionArray[o + 13] = cy; positionArray[o + 14] = cz;
    positionArray[o + 15] = dx; positionArray[o + 16] = dy; positionArray[o + 17] = dz;
  }

  return {
    mesh,
    get triangleCount(): number {
      return 4;
    },
    update(player: BlobRider, rival: BlobRider): void {
      writeShadow(0, player);
      writeShadow(1, rival);
      positionAttr.needsUpdate = true;
    },
    dispose(): void {
      geometry.dispose();
      material.dispose();
    },
  };
}
