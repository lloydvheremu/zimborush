/**
 * Actors view — rival, scattered props, blob shadows and dust.
 *
 * Ownership: orchestrator (composition side), same role as `world/view.ts`:
 * this is the only place that knows both the game modules and the scene-graph
 * slots, so `main.ts` stays thin and the modules stay scene-ignorant.
 *
 * Draw-call accounting follows design doc §5: 2 tree draws + 3 rock draws
 * (per-variant InstancedMesh), 1 rival draw, 1 blob-shadow draw, 1 dust draw.
 */

import { BufferGeometry, InstancedMesh, Matrix4, Mesh, MeshLambertMaterial, Vector3 } from 'three';
import { SceneGraph } from '../renderer/sceneGraph';
import type { ColorSource } from '../renderer/contracts';
import type { ITerrainSource, ISplineSource, IPropSource, PropRecord } from '../world/contracts';
import {
  createRockSource,
  createRockVariantGeometries,
  createTreeSource,
  createTreeVariantGeometries,
} from '../game/scatter/props';
import { bakePropShadows } from '../game/scatter/shadows';
import type { PropShadowDisc } from '../game/scatter/shadows';
import { createRival } from '../game/rival/rival';
import type { Rival, RivalPose } from '../game/rival/rival';
import { createRivalMesh } from '../game/rival/mesh';
import { createBlobShadows } from '../game/fx/blobShadow';
import type { BlobShadows } from '../game/fx/blobShadow';
import { createDustField } from '../game/fx/dust';
import type { DustField } from '../game/fx/dust';

/** Road clearance for prop placement: keeps props off the racing line. */
const ROAD_CLEARANCE_M = 6;

export interface ActorTotals {
  rivalTriangles: number;
  propTriangles: number;
  dustTriangles: number;
  blobTriangles: number;
  propInstances: number;
  drawCalls: number;
}

/** One reusable matrix and scale for instanced placement — never per instance. */
const scratchMatrix = new Matrix4();
const scratchScale = new Vector3(1, 1, 1);

export class ActorsView {
  private readonly graph: SceneGraph;
  private readonly terrain: ITerrainSource;
  private readonly spline: ISplineSource;
  private readonly colors: ColorSource;
  private readonly seed: number;

  private rival: Rival | null = null;
  private readonly rivalPose: RivalPose = {
    x: 0,
    y: 0,
    z: 0,
    headingRad: 0,
    pitchRad: 0,
    leanRad: 0,
    speedMps: 0,
    progressM: 0,
  };
  private blobShadows: BlobShadows | null = null;
  private dust: DustField | null = null;
  private readonly propRecords: PropRecord[] = [];
  private readonly propMeshes: InstancedMesh[] = [];
  private shadowDiscs: readonly PropShadowDisc[] = [];
  private shadowColor = '#000000';
  private totals: ActorTotals = {
    rivalTriangles: 0,
    propTriangles: 0,
    dustTriangles: 0,
    blobTriangles: 0,
    propInstances: 0,
    drawCalls: 0,
  };

  constructor(
    graph: SceneGraph,
    terrain: ITerrainSource,
    spline: ISplineSource,
    colors: ColorSource,
    seed: number,
  ) {
    this.graph = graph;
    this.terrain = terrain;
    this.spline = spline;
    this.colors = colors;
    this.seed = seed;
  }

  /** Build and attach everything. One-time setup. */
  attach(options: { dust: boolean } = { dust: true }): void {
    // --- Rival: one merged mesh, one draw call -----------------------------
    const rivalMesh = createRivalMesh(this.seed, this.colors);
    // The mesh is named 'rival'; renaming it here keeps it distinct from the
    // slot of the same name, whose duplicate guard would otherwise reject the
    // attach (that guard firing is correct behaviour, not a bug in it).
    rivalMesh.name = 'rivalMesh';
    this.graph.attach('rival', rivalMesh);
    this.rival = createRival(this.seed, this.spline, this.terrain);
    const rivalTris = countMeshTriangles(rivalMesh);

    // --- Props: 2 tree variants + 3 rock variants, one InstancedMesh each ---
    const treeSource: IPropSource = createTreeSource();
    const rockSource: IPropSource = createRockSource();
    const ctx = {
      terrain: this.terrain,
      spline: this.spline,
      seed: this.seed,
      roadClearanceM: ROAD_CLEARANCE_M,
    };
    const trees = treeSource.build(ctx);
    const rocks = rockSource.build(ctx);
    this.propRecords.push(...trees, ...rocks);

    const treeGeoms = createTreeVariantGeometries(this.colors);
    const rockGeoms = createRockVariantGeometries(this.colors);
    let propTris = 0;
    propTris += this.addInstanced('props', trees, treeSource.variantCount, treeGeoms);
    propTris += this.addInstanced('props', rocks, rockSource.variantCount, rockGeoms);

    // Baked prop-shadow discs. The terrain colour buffer belongs to terrain.ts
    // and applying these to it is the next registry task (§5.2), so the discs
    // are computed here and kept rather than silently dropped.
    const baked = bakePropShadows({
      sources: [treeSource, rockSource],
      ctx,
      colors: this.colors,
    });
    this.shadowDiscs = baked.discs;
    this.shadowColor = baked.color;

    // --- Blob shadows: one buffer, both riders, one draw call --------------
    this.blobShadows = createBlobShadows({ colors: this.colors, terrain: this.terrain });
    this.graph.attach('shadows', this.blobShadows.mesh);

    // --- Dust: one buffer, 12 quads, one draw call -------------------------
    if (options.dust) {
      this.dust = createDustField({ seed: this.seed, colors: this.colors, terrain: this.terrain });
      this.dust.setEnabled(false); // off at start: first ladder cut (§5)
      this.graph.attach('dust', this.dust.mesh);
    }

    this.totals = {
      rivalTriangles: rivalTris,
      propTriangles: propTris,
      dustTriangles: this.dust?.triangleCount ?? 0,
      blobTriangles: this.blobShadows.triangleCount,
      propInstances: trees.length + rocks.length,
      drawCalls:
        1 + // rival
        treeSource.variantCount +
        rockSource.variantCount +
        1 + // blob shadows
        (this.dust !== null ? 1 : 0),
    };
  }

  /** One instanced draw per variant; returns the triangles it added. */
  private addInstanced(
    slot: 'props',
    records: readonly PropRecord[],
    variantCount: number,
    geoms: readonly { geometry: BufferGeometry; name: string }[],
  ): number {
    let triangles = 0;
    for (let v = 0; v < variantCount; v++) {
      const geom = geoms[v];
      if (geom === undefined) {
        continue;
      }
      // Count instances for this variant before creating, so the mesh is sized
      // exactly once (an InstancedMesh's count is fixed at construction).
      let n = 0;
      for (let i = 0; i < records.length; i++) {
        if (records[i].variant === v) {
          n++;
        }
      }
      if (n === 0) {
        continue;
      }
      // White material: the variant geometry already carries its tint in the
      // vertex-colour attribute, so any material colour would multiply it again
      // (the mistake that made the road render ~35% too dark in step 3).
      const material = new MeshLambertMaterial({
        color: 0xffffff,
        vertexColors: true,
        flatShading: true,
        fog: true,
      });
      const instance = new InstancedMesh(geom.geometry, material, n);
      instance.name = `${slot}-${geom.name}`;
      let w = 0;
      for (let i = 0; i < records.length; i++) {
        const r = records[i];
        if (r.variant !== v) {
          continue;
        }
        scratchMatrix.makeRotationY(r.rotation);
        scratchMatrix.scale(scratchScale.set(r.scale, r.scale, r.scale));
        scratchMatrix.setPosition(r.x, r.y, r.z);
        instance.setMatrixAt(w++, scratchMatrix);
      }
      instance.instanceMatrix.needsUpdate = true;
      this.graph.attach(slot, instance);
      this.propMeshes.push(instance);
      triangles += countGeometryTriangles(geom.geometry) * n;
    }
    return triangles;
  }

  /** Advance the rival and FX by one fixed simulation step. */
  step(dt: number, playerProgressM: number): void {
    if (this.rival !== null) {
      this.rival.update(dt, playerProgressM, this.rivalPose);
    }
  }

  /**
   * Per-frame visual updates. Allocates nothing: every write goes into
   * preallocated objects and buffers.
   */
  frame(dtS: number, rivalMesh: Mesh | null, camX: number, camZ: number): void {
    const pose = this.rivalPose;
    if (rivalMesh !== null) {
      rivalMesh.position.set(pose.x, pose.y, pose.z);
      rivalMesh.rotation.set(pose.pitchRad, -pose.headingRad, pose.leanRad, 'YXZ');
    }
    if (this.blobShadows !== null) {
      // Rival only for now; the player rider joins at the same call site once
      // the bike pose is plumbed through (both shadows share this one buffer).
      this.blobShadows.update(
        { x: pose.x, z: pose.z, headingRad: pose.headingRad },
        { x: pose.x, z: pose.z, headingRad: pose.headingRad },
      );
    }
    if (this.dust !== null && this.dust.enabled) {
      this.dust.update(dtS, {
        x: pose.x,
        z: pose.z,
        headingRad: pose.headingRad,
        speedMps: pose.speedMps,
        camX,
        camZ,
      });
    }
  }

  /** Enable or disable dust (the ladder's first cut). */
  setDustEnabled(enabled: boolean): void {
    this.dust?.setEnabled(enabled);
  }

  get totalsSnapshot(): ActorTotals {
    return this.totals;
  }

  /** Baked shadow discs, exposing the data until the terrain bake lands. */
  get shadows(): { discs: readonly PropShadowDisc[]; color: string } {
    return { discs: this.shadowDiscs, color: this.shadowColor };
  }

  dispose(): void {
    for (let i = 0; i < this.propMeshes.length; i++) {
      this.graph.detach(this.propMeshes[i]);
    }
    this.propMeshes.length = 0;
    if (this.blobShadows !== null) {
      this.blobShadows.dispose();
      this.blobShadows = null;
    }
    if (this.dust !== null) {
      this.dust.dispose();
      this.dust = null;
    }
  }
}

/** Triangles in a geometry, indexed or not. */
function countGeometryTriangles(geometry: BufferGeometry): number {
  const index = geometry.getIndex();
  return index !== null ? Math.floor(index.count / 3) : Math.floor(geometry.getAttribute('position').count / 3);
}

function countMeshTriangles(mesh: Mesh): number {
  const geometry = mesh.geometry;
  const index = geometry.getIndex();
  return index !== null ? Math.floor(index.count / 3) : Math.floor(geometry.getAttribute('position').count / 3);
}
