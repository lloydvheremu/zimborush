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
  if (names.length <= 1) {
    const material = makeMaterial(slot, flat);
    const mesh = new Mesh(geometry, material);
    mesh.name = `${slot}-0`;
    graph.attach(slot, mesh);
    return 1;
  }

  // Multi-tint: one mesh per tint family. The geometry already carries its tint
  // in the vertex-colour attribute, so every material stays WHITE — setting a
  // material colour too would multiply the tint by itself (measured: the road
  // rendered ~35% too dark). The per-family meshes exist so the families can be
  // cut independently later; they share one geometry, so no vertex data is
  // duplicated.
  let created = 0;
  for (let i = 0; i < names.length; i++) {
    const material = makeMaterial(slot, flat);
    const mesh = new Mesh(geometry, material);
    mesh.name = `${slot}-${i}`;
    graph.attach(slot, mesh);
    created++;
  }
  return created;
}

/**
 * Material choice per slot. Always white: the tint lives in the geometry's
 * vertex colours (design doc §4 authors the palette, the builders bake it in).
 */
function makeMaterial(slot: 'terrain' | 'road' | 'hillsDistant', flat: boolean): Material {
  if (slot === 'hillsDistant') {
    // Hills are far away and read as a silhouette band; basic keeps them
    // independent of the lighting rig, which matches the reference image.
    return new MeshBasicMaterial({ color: 0xffffff, vertexColors: true, fog: true });
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

    // Terrain: single tint family, flat-shaded Lambert.
    this.meshes += addTinted(this.graph, 'terrain', this.world.terrainGeometry, ['#FFFFFF'], true);
    // Road: a separate mesh per tint family (surface / tracks / shoulders).
    const roadNames: string[] = [];
    for (let i = 0; i < this.roadTints; i++) {
      roadNames.push(i === 0 ? colors.palette('road') : i === 1 ? colors.palette('roadTrack') : colors.palette('terrainShade'));
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
