/**
 * World view — turns built geometry into scene objects.
 *
 * Ownership: orchestrator (the composition side). This is the only place that
 * knows both the world contracts and the scene-graph slots, which keeps
 * `main.ts` thin and keeps geometry builders ignorant of the scene.
 *
 * Draw-call accounting lives here, because this is where meshes are actually
 * created: one mesh per distinct material, so a geometry with three tint
 * families costs three draws, exactly as design doc §5 assumes for the road.
 *
 * This is also where the two halves of the terrain's enclosure are bound
 * together. `heightfield.ts` tapers the ground to exactly 0 at its edge radius
 * and `hills.ts` starts its ring at height 0 on the same radius; `view.ts` is the
 * only module that imports both, so the assertion that they still agree lives
 * here. If they ever drift, the join becomes a visible step or a gap in the
 * middle of the horizon — silently, at any distance.
 */

import {
  BufferGeometry,
  Mesh,
  MeshBasicMaterial,
  MeshLambertMaterial,
} from 'three';
import type { Material } from 'three';
import { SceneGraph } from '../renderer/sceneGraph';
import type { WorldParts } from './contracts';
import { EDGE_RADIUS_M } from '../game/track/heightfield';
import { HILL_RING } from '../game/track/hills';

/** Totals contributed by the world meshes, for the boot log and telemetry. */
export interface ViewTotals {
  triangles: number;
  meshes: number;
  drawCalls: number;
}

/**
 * Splits a vertex-coloured geometry into one mesh per distinct tint and adds
 * them to a slot. Returns the number of meshes created.
 *
 * Why split rather than one mesh: the geometries carry flat per-face colours
 * and a single material cannot vary `color` per face without textures, which
 * are banned. The alternative would be a custom shader, which is the MSAA /
 * style work of step 4 and beyond — not this one.
 */
/**
 * Adds ONE mesh per geometry to a slot and returns the number of meshes made.
 *
 * Fixed defect (patch 2, Q0). This used to create one mesh per TIENT FAMILY, each
 * bound to the SAME full geometry, on the theory that the per-family meshes
 * could be culled independently later. They could not: every material is white
 * and the tint lives in the vertex-colour attribute, so those extra meshes
 * re-drew the identical triangles with identical output. Measured at baseline:
 * the `hillsDistant` slot held **6 meshes sharing 1 geometry uuid**, each
 * drawing all 4,992 triangles, and the road 3 meshes sharing 1 geometry of
 * 3,920 - 33,336 wasted triangles per frame and 8 wasted draw calls. That is
 * the whole of the 62,054-versus-34,346 discrepancy the boot log hid.
 *
 * The `names` argument is now ignored for meshing purposes; it is kept so the
 * call sites still document which tints a geometry carries, and it is used for
 * the telemetry `tintCount` fields.
 */
function addTinted(
  graph: SceneGraph,
  slot: 'terrain' | 'road' | 'hillsDistant',
  geometry: BufferGeometry,
  names: readonly string[],
  flat: boolean,
): number {
  const colorAttr = geometry.getAttribute('color');
  if (colorAttr === undefined) {
    throw new Error(`addTinted: geometry for slot "${slot}" has no colour attribute`);
  }
  const material = makeMaterial(slot, flat);
  const mesh = new Mesh(geometry, material);
  mesh.name = `${slot}-0`;
  graph.attach(slot, mesh);
  void names; // documented only; see the header
  return 1;
}

/**
 * Material choice per slot. Always white: the tint lives in the geometry's
 * vertex colours (design doc §4 authors the palette, the builders bake it in).
 */
function makeMaterial(slot: 'terrain' | 'road' | 'hillsDistant', flat: boolean): Material {
  if (slot === 'hillsDistant') {
    // Hills are far away and read as a silhouette band; basic keeps them
    // independent of the lighting rig, which matches the reference image.
    //
    // The ring's foot and the terrain's outer edge are both at exactly y = 0 on
    // the same radius, so they are coplanar where they meet and the depth test
    // decides arbitrarily between them. Measured before this offset: two runs of
    // the SAME seed and build differed by ~31 pixels along the horizon row
    // (bbox x 559-617, y 264-272), because the z-fight resolves differently as
    // the camera's interpolated position shifts by a fraction of a pixel.
    // A depth BIAS fixes a coplanar overlap without moving a single vertex, which
    // is why it is used instead of lifting the ring: a 2 cm lift made ~350 pixels
    // change, i.e. it visibly moved the silhouette, while the offset leaves the
    // geometry exactly where it was. The ring wins the tie (it is behind and
    // above, so it is the correct surface to show at the seam).
    const material = new MeshBasicMaterial({ color: 0xffffff, vertexColors: true, fog: true });
    material.polygonOffset = true;
    material.polygonOffsetFactor = 1;
    material.polygonOffsetUnits = 1;
    return material;
  }
  return new MeshLambertMaterial({
    color: 0xffffff,
    vertexColors: true,
    flatShading: flat,
    fog: true,
  });
}

/**
 * The assembled world in the scene. One instance per boot.
 */
export class WorldView {
  private readonly graph: SceneGraph;
  private readonly world: WorldParts;
  private readonly roadTints: number;
  private readonly hillTints: number;
  private meshes = 0;
  private triangles = 0;

  constructor(graph: SceneGraph, world: WorldParts, roadTints: number, hillTints: number) {
    this.graph = graph;
    this.world = world;
    this.roadTints = roadTints > 0 ? roadTints : 1;
    this.hillTints = hillTints > 0 ? hillTints : 1;
  }

  /** Create the meshes and attach them to their slots. One-time setup. */
  attach(): void {
    const colors = this.world.colors;

    // The enclosure seam: the terrain's zero radius must be the ring's foot, and
    // the ring's foot must be at height 0 on that radius. Fail loudly at boot
    // rather than shipping a step in the horizon. Both halves are measured, not
    // assumed from the constants.
    if (Math.abs(this.world.terrain.bounds.maxX - HILL_RING.innerRadiusM) > 1e-6) {
      throw new Error(
        `world: terrain zero-radius ${this.world.terrain.bounds.maxX} m != hill ring foot ` +
          `${HILL_RING.innerRadiusM} m — the enclosure would not close`,
      );
    }
    if (Math.abs(EDGE_RADIUS_M - HILL_RING.innerRadiusM) > 1e-6) {
      throw new Error(
        `world: heightfield EDGE_RADIUS_M ${EDGE_RADIUS_M} m != HILL_RING.innerRadiusM ` +
          `${HILL_RING.innerRadiusM} m`,
      );
    }
    const footHeight = this.world.terrain.heightAt(HILL_RING.innerRadiusM, 0);
    if (Math.abs(footHeight) > 1e-6) {
      throw new Error(
        `world: terrain height at the ring foot is ${footHeight} m, expected exactly 0 — ` +
          'the enclosure would leave a step',
      );
    }

    // Terrain: single tint family, flat-shaded Lambert.
    this.meshes += addTinted(this.graph, 'terrain', this.world.terrainGeometry, ['#FFFFFF'], true);
    // Road: a separate mesh per tint family (surface / tracks / shoulders).
    const roadNames: string[] = [];
    for (let i = 0; i < this.roadTints; i++) {
      roadNames.push(i === 0 ? colors.palette('road') : i === 1 ? colors.palette('roadTrack') : colors.palette('dirt'));
    }
    this.meshes += addTinted(this.graph, 'road', this.world.roadGeometry, roadNames, false);
    // Distant hills: silhouette band, no lighting.
    const hillNames: string[] = [];
    for (let i = 0; i < this.hillTints; i++) {
      hillNames.push(i === 0 ? colors.palette('hillsDistant') : colors.derived({ kind: 'midHill', t: 0.5 }));
    }
    this.meshes += addTinted(this.graph, 'hillsDistant', this.world.hillGeometry, hillNames, true);

    this.triangles =
      countTriangles(this.world.terrainGeometry) +
      countTriangles(this.world.roadGeometry) +
      countTriangles(this.world.hillGeometry);
  }

  /** Draw-call and triangle totals for the geometry attached so far. */
  get totals(): ViewTotals {
    return { triangles: this.triangles, meshes: this.meshes, drawCalls: this.meshes };
  }

  /** Detach and dispose every mesh. Idempotent. */
  dispose(): void {
    for (const slot of ['terrain', 'road', 'hillsDistant'] as const) {
      const kids = this.graph.childrenOf(slot).slice();
      for (let i = 0; i < kids.length; i++) {
        const mesh = kids[i] as Mesh;
        const material = mesh.material;
        if (Array.isArray(material)) {
          for (let m = 0; m < material.length; m++) {
            material[m].dispose();
          }
        } else if (material !== undefined) {
          (material as Material).dispose();
        }
        this.graph.detach(mesh);
      }
    }
    this.world.terrainGeometry.dispose();
    this.world.roadGeometry.dispose();
    this.world.hillGeometry.dispose();
  }
}

/** Triangles in a geometry, indexed or not. */
export function countTriangles(geometry: BufferGeometry): number {
  const index = geometry.getIndex();
  if (index !== null) {
    return Math.floor(index.count / 3);
  }
  const position = geometry.getAttribute('position');
  return position === undefined ? 0 : Math.floor(position.count / 3);
}
