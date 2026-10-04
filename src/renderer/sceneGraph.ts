/**
 * FROZEN SEAM — scene-graph slots.
 *
 * Ownership: orchestrator. Consumers call `attach()` with their allocated
 * object; they do not add children to the root directly and do not rename or
 * reorder slots.
 *
 * Why this exists: three tasks build scene objects in the same wave. Without a
 * fixed slot list, two of them would both call `scene.add(...)` and the draw
 * order would depend on which merged first — a conflict that is invisible in a
 * textual diff and only shows up as wrong rendering on `main`.
 */

import { Group, Object3D, Scene } from 'three';

/**
 * Every named slot in the world scene. Order in this array IS the intended
 * draw order, so keep it stable: it was chosen so opaque geometry draws before
 * anything blended.
 */
export const SCENE_SLOTS = [
  'sky',
  'sun',
  'hillsDistant',
  'terrain',
  'road',
  'props',
  'shadows',
  'rival',
  'bike',
  'dust',
] as const;

export type SceneSlot = (typeof SCENE_SLOTS)[number];

/**
 * Owns the scene and its slots. Created once at boot by the composition root.
 * All methods are one-time setup, never per frame.
 */
export class SceneGraph {
  private readonly scene = new Scene();
  private readonly slots = new Map<SceneSlot, Group>();

  constructor() {
    for (let i = 0; i < SCENE_SLOTS.length; i++) {
      const name = SCENE_SLOTS[i];
      const group = new Group();
      group.name = name;
      // Render order follows the slot list, which is stable across merges.
      group.renderOrder = i;
      this.slots.set(name, group);
      this.scene.add(group);
    }
  }

  /** The underlying scene, for the renderer. */
  get root(): Scene {
    return this.scene;
  }

  /** The group for a slot. */
  slot(name: SceneSlot): Group {
    const group = this.slots.get(name);
    if (group === undefined) {
      throw new Error(`SceneGraph: unknown slot "${String(name)}"`);
    }
    return group;
  }

  /**
   * Attach an object to a named slot. Throws on a duplicate name within the
   * slot, so a merge that accidentally adds two objects under one name fails
   * loudly at boot instead of rendering twice.
   */
  attach(name: SceneSlot, object: Object3D): void {
    const group = this.slot(name);
    if (object.name !== '' && group.getObjectByName(object.name) !== undefined) {
      throw new Error(
        `SceneGraph.attach: "${object.name}" already exists in slot "${name}"`,
      );
    }
    group.add(object);
  }

  /** Detach an object from wherever it sits. */
  detach(object: Object3D): void {
    object.removeFromParent();
  }

  /** Children of a slot, for assertions and telemetry. */
  childrenOf(name: SceneSlot): readonly Object3D[] {
    return this.slot(name).children;
  }

  /** Dispose every slot's contents. Idempotent. */
  dispose(): void {
    for (const group of this.slots.values()) {
      const kids = group.children.slice();
      for (let i = 0; i < kids.length; i++) {
        kids[i].removeFromParent();
      }
    }
  }
}
