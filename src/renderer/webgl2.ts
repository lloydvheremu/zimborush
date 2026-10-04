import {
  IcosahedronGeometry,
  Mesh,
  MeshBasicMaterial,
  Scene,
  WebGLRenderer,
} from 'three';
import type { Camera } from 'three';
import type { IRenderer, RenderStats, StyleConfig, TierId } from './IRenderer';

/** Colour of the placeholder proof mesh — not an art direction decision. */
const PLACEHOLDER_COLOR = '#8A6A4F';

/**
 * TODO(DPR) — PLACEHOLDER, NOT A DECISION.
 * Test devices and the DPR policy are deferred by the owner. Until they are
 * settled, the placeholder policy is: min(devicePixelRatio, 2).
 */
function placeholderDpr(): number {
  return Math.min(window.devicePixelRatio || 1, 2);
}

/** WebGL2 adapter on top of three.js' WebGLRenderer. */
export class WebGL2Renderer implements IRenderer {
  private renderer?: WebGLRenderer;
  private scene?: Scene;
  private placeholderMesh?: Mesh;
  private placeholderGeometry?: IcosahedronGeometry;
  private placeholderMaterial?: MeshBasicMaterial;
  private cssW = 1;
  private cssH = 1;
  private renderScale = 1;
  private readonly statsObject: RenderStats = { backend: 'webgl2', drawCalls: 0, triangles: 0 };

  init(canvas: HTMLCanvasElement, style: StyleConfig, _tier: TierId): void {
    // _tier: accepted per the interface; no tier-dependent behaviour exists in this step.
    if (this.renderer !== undefined) {
      throw new Error('WebGL2Renderer.init: already initialized — call dispose() first.');
    }

    // Context-level antialias is OFF by requirement; multisampling is a
    // render-target concern, not a context-creation flag.
    const renderer = new WebGLRenderer({ canvas, antialias: false });
    this.renderer = renderer;

    const cssW = canvas.clientWidth > 0 ? canvas.clientWidth : window.innerWidth;
    const cssH = canvas.clientHeight > 0 ? canvas.clientHeight : window.innerHeight;
    this.cssW = cssW;
    this.cssH = cssH;
    const dpr = placeholderDpr();
    renderer.setPixelRatio(dpr * this.renderScale);
    renderer.setSize(cssW, cssH, false); // the page stylesheet owns the CSS size
    renderer.setClearColor(style.clearColor);

    // PLACEHOLDER SCENE — exists only to prove the pipeline renders; it is
    // not game content.
    const scene = new Scene();
    const geometry = new IcosahedronGeometry(1.1, 0);
    const material = new MeshBasicMaterial({ color: PLACEHOLDER_COLOR });
    const mesh = new Mesh(geometry, material);
    mesh.position.set(0, 1.15, 0);
    this.placeholderGeometry = geometry;
    this.placeholderMaterial = material;
    this.placeholderMesh = mesh;
    scene.add(mesh);
    this.scene = scene;

    // Boot log — exactly one line.
    const gl = renderer.getContext();
    console.log(
      `[ZimboRush] backend=webgl2 glVersion=${String(gl.getParameter(gl.VERSION))} ` +
        `glRenderer=${String(gl.getParameter(gl.RENDERER))} ` +
        `maxTextureSize=${String(gl.getParameter(gl.MAX_TEXTURE_SIZE))} dpr=${dpr}`,
    );
  }

  /**
   * Replace the placeholder scene with the real one. The placeholder exists
   * only to prove the pipeline in step 1; owning it here would keep the world
   * invisible, so the composition root hands over the assembled scene instead.
   * Idempotent: disposing the placeholder twice is safe.
   */
  setScene(scene: Scene): void {
    if (this.scene === scene) {
      return;
    }
    this.disposePlaceholder();
    this.scene = scene;
  }

  realize(_diff: unknown): void {
    throw new Error('WebGL2Renderer.realize: not implemented until step 3');
  }

  render(camera: Camera): void {
    const renderer = this.requireRenderer();
    // Placeholder spin — mutation only; nothing is allocated per frame.
    const mesh = this.placeholderMesh;
    if (mesh !== undefined) {
      mesh.rotation.y = performance.now() * 0.0006;
    }
    renderer.render(this.requireScene(), camera);
    // Capture this frame's stats immediately after drawing: three resets
    // info.render at the start of the next render, so `stats()` would otherwise
    // report the wrong frame to the telemetry overlay.
    const info = renderer.info;
    this.statsObject.drawCalls = info.render.calls;
    this.statsObject.triangles = info.render.triangles;
  }

  resize(cssW: number, cssH: number): void {
    const renderer = this.requireRenderer();
    if (!Number.isFinite(cssW) || cssW <= 0 || !Number.isFinite(cssH) || cssH <= 0) {
      throw new RangeError('WebGL2Renderer.resize: cssW and cssH must be finite and > 0');
    }
    this.cssW = cssW;
    this.cssH = cssH;
    // DPR is re-read on every resize so display moves are picked up
    // (still the placeholder policy — see TODO above).
    renderer.setPixelRatio(placeholderDpr() * this.renderScale);
    renderer.setSize(cssW, cssH, false);
  }

  setRenderScale(s: number): void {
    if (!Number.isFinite(s) || s <= 0) {
      throw new RangeError('WebGL2Renderer.setRenderScale: s must be finite and > 0');
    }
    this.renderScale = s;
    this.resize(this.cssW, this.cssH);
  }

  setMsaa(_samples: number): void {
    throw new Error('WebGL2Renderer.setMsaa: not implemented until step 4');
  }

  stats(): RenderStats {
    // Same object every call, mutated in place — zero allocation. Values are
    // those of the last rendered frame (see render()).
    return this.statsObject;
  }

  /**
   * Release the step-1 placeholder only. Split out of `dispose()` so `setScene`
   * can drop the placeholder without tearing down the live renderer.
   */
  private disposePlaceholder(): void {
    this.placeholderMesh = undefined;
    if (this.placeholderGeometry !== undefined) {
      this.placeholderGeometry.dispose();
      this.placeholderGeometry = undefined;
    }
    if (this.placeholderMaterial !== undefined) {
      this.placeholderMaterial.dispose();
      this.placeholderMaterial = undefined;
    }
    this.scene = undefined;
  }

  dispose(): void {
    // Idempotent: safe before init and after a previous dispose.
    this.disposePlaceholder();
    if (this.renderer !== undefined) {
      this.renderer.dispose();
      this.renderer = undefined;
    }
  }

  private requireRenderer(): WebGLRenderer {
    if (this.renderer === undefined) {
      throw new Error('WebGL2Renderer: not initialized — call init() first.');
    }
    return this.renderer;
  }

  private requireScene(): Scene {
    if (this.scene === undefined) {
      throw new Error('WebGL2Renderer: scene is missing — init() was not called.');
    }
    return this.scene;
  }
}
