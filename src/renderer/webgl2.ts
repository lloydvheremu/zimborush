import {
  IcosahedronGeometry,
  Mesh,
  MeshBasicMaterial,
  OrthographicCamera,
  PlaneGeometry,
  Scene,
  WebGLRenderTarget,
  WebGLRenderer,
} from 'three';
import type { Camera } from 'three';
import type { IRenderer, RenderStats, StyleConfig, TierId } from './IRenderer';

/**
 * WebGL2 adapter on top of three.js' WebGLRenderer.
 *
 * Antialiasing policy (design doc §8): the CONTEXT is always created with
 * `antialias: false`. When the style's `msaa` is > 0 the scene renders into a
 * multisampled offscreen render target that is resolved and copied to the
 * canvas in one fullscreen pass; when `msaa` is 0 the scene draws straight to
 * the default framebuffer with no extra pass. That difference is why the
 * quality ladder cuts MSAA late — it removes a pass, not a prop.
 */

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

export class WebGL2Renderer implements IRenderer {
  private renderer?: WebGLRenderer;
  private scene?: Scene;
  private placeholderGeometry?: IcosahedronGeometry;
  private placeholderMaterial?: MeshBasicMaterial;
  private cssW = 1;
  private cssH = 1;
  private renderScale = 1;

  // --- MSAA state (all built once per sample-count change, never per frame) ---
  private msaaCount = 0;
  private msaaTarget?: WebGLRenderTarget;
  private blitScene?: Scene;
  private blitCamera?: OrthographicCamera;
  private blitMaterial?: MeshBasicMaterial;
  private blitGeometry?: PlaneGeometry;
  private blitMesh?: Mesh;

  /** Reused stats object — callers must not retain it. */
  private readonly statsObject: RenderStats = { backend: 'webgl2', drawCalls: 0, triangles: 0 };

  init(canvas: HTMLCanvasElement, style: StyleConfig, _tier: TierId): void {
    // _tier: accepted per the interface; no tier-dependent behaviour exists yet.
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
    // replaced by setScene() once the world is assembled. Not game content.
    const scene = new Scene();
    const geometry = new IcosahedronGeometry(1.1, 0);
    const material = new MeshBasicMaterial({ color: PLACEHOLDER_COLOR });
    const mesh = new Mesh(geometry, material);
    mesh.position.set(0, 1.15, 0);
    this.placeholderGeometry = geometry;
    this.placeholderMaterial = material;
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
   */
  setScene(scene: Scene): void {
    if (this.scene === scene) {
      return;
    }
    this.disposePlaceholder();
    this.scene = scene;
  }

  /**
   * Multisample sample count. 0 disables the offscreen pass entirely, which is
   * what the ladder's stage-6 cut relies on. Recreates the target at runtime;
   * no context loss. Idempotent for an unchanged count.
   */
  setMsaa(samples: number): void {
    if (!Number.isFinite(samples) || samples < 0) {
      throw new RangeError('WebGL2Renderer.setMsaa: samples must be finite and >= 0');
    }
    const next = Math.floor(samples);
    if (next === this.msaaCount) {
      return;
    }
    this.msaaCount = next;
    this.disposeMsaa();
    if (next > 0) {
      this.buildMsaa();
    }
  }

  /** Multisample count in effect (0 = direct-to-canvas). */
  get msaaSamples(): number {
    return this.msaaCount;
  }

  /** The offscreen target, or null when MSAA is off. For verification only. */
  get msaaRenderTarget(): WebGLRenderTarget | null {
    return this.msaaTarget ?? null;
  }

  realize(_diff: unknown): void {
    throw new Error('WebGL2Renderer.realize: not implemented until the style system requires it');
  }

  render(camera: Camera): void {
    const renderer = this.requireRenderer();

    if (this.msaaCount > 0) {
      // MSAA path: scene -> multisampled target, then resolve + copy to canvas.
      const target = this.requireMsaa();
      renderer.setRenderTarget(target);
      renderer.render(this.requireScene(), camera);
      renderer.setRenderTarget(null);

      const blitMaterial = this.blitMaterial;
      const blitScene = this.blitScene;
      const blitCamera = this.blitCamera;
      if (blitMaterial === undefined || blitScene === undefined || blitCamera === undefined) {
        throw new Error('WebGL2Renderer: MSAA copy pass missing — call setMsaa() again.');
      }
      // three resolves the multisampled target when its texture is read.
      if (blitMaterial.map !== target.texture) {
        blitMaterial.map = target.texture;
        blitMaterial.needsUpdate = true;
      }
      renderer.render(blitScene, blitCamera);
    } else {
      renderer.setRenderTarget(null);
      renderer.render(this.requireScene(), camera);
    }

    // Capture this frame's stats immediately after drawing: three resets
    // info.render at the start of the next render, so reading later would
    // report the wrong frame. With MSAA the copy pass is counted too, which is
    // the honest cost of the feature.
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
    // The target must track the drawing buffer, or the copy pass would stretch
    // a stale resolution onto the canvas.
    if (this.msaaCount > 0) {
      this.disposeMsaa();
      this.buildMsaa();
    }
  }

  setRenderScale(s: number): void {
    if (!Number.isFinite(s) || s <= 0) {
      throw new RangeError('WebGL2Renderer.setRenderScale: s must be finite and > 0');
    }
    this.renderScale = s;
    this.resize(this.cssW, this.cssH);
  }

  stats(): RenderStats {
    // Same object every call, mutated in place — zero allocation. Values are
    // those of the last rendered frame (see render()).
    return this.statsObject;
  }

  dispose(): void {
    // Idempotent: safe before init and after a previous dispose.
    this.disposeMsaa();
    this.disposePlaceholder();
    if (this.renderer !== undefined) {
      this.renderer.dispose();
      this.renderer = undefined;
    }
  }

  /** Build the multisampled target and the resolve/copy pass, once. */
  private buildMsaa(): void {
    const dpr = placeholderDpr() * this.renderScale;
    const w = Math.max(1, Math.floor(this.cssW * dpr));
    const h = Math.max(1, Math.floor(this.cssH * dpr));

    const target = new WebGLRenderTarget(w, h, {
      // three resolves a multisampled target automatically when read.
      samples: this.msaaCount,
      depthBuffer: true,
      stencilBuffer: false,
    });
    target.texture.name = 'zimborush-msaa';
    this.msaaTarget = target;

    // Fullscreen copy pass: one quad in one draw call.
    //
    // A MeshBasicMaterial with `map` is used rather than a hand-written
    // ShaderMaterial on purpose: the scene writes LINEAR values into the render
    // target, and the canvas expects sRGB. three's standard material pipeline
    // performs that conversion; a raw `texture2D` blit does not, which rendered
    // the whole frame markedly darker (measured #320D03 vs #7A401D for the
    // dominant colour).
    const blitMaterial = new MeshBasicMaterial({
      map: target.texture,
      depthTest: false,
      depthWrite: false,
      toneMapped: false,
    });
    const blitGeometry = new PlaneGeometry(2, 2);
    const blitMesh = new Mesh(blitGeometry, blitMaterial);
    blitMesh.frustumCulled = false; // the quad is already in clip space
    const blitScene = new Scene();
    blitScene.add(blitMesh);
    const blitCamera = new OrthographicCamera(-1, 1, 1, -1, 0, 1);

    this.blitScene = blitScene;
    this.blitCamera = blitCamera;
    this.blitMaterial = blitMaterial;
    this.blitGeometry = blitGeometry;
    this.blitMesh = blitMesh;
  }

  /** Release the MSAA target and copy pass. Idempotent. */
  private disposeMsaa(): void {
    if (this.msaaTarget !== undefined) {
      this.msaaTarget.dispose();
      this.msaaTarget = undefined;
    }
    if (this.blitMesh !== undefined) {
      this.blitMesh.removeFromParent();
      this.blitMesh = undefined;
    }
    if (this.blitGeometry !== undefined) {
      this.blitGeometry.dispose();
      this.blitGeometry = undefined;
    }
    if (this.blitMaterial !== undefined) {
      this.blitMaterial.dispose();
      this.blitMaterial = undefined;
    }
    this.blitScene = undefined;
    this.blitCamera = undefined;
  }

  /** Release the step-1 placeholder only, leaving the live renderer intact. */
  private disposePlaceholder(): void {
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

  private requireMsaa(): WebGLRenderTarget {
    if (this.msaaTarget === undefined) {
      throw new Error('WebGL2Renderer: MSAA target missing — call setMsaa() first.');
    }
    return this.msaaTarget;
  }

  private requireRenderer(): WebGLRenderer {
    if (this.renderer === undefined) {
      throw new Error('WebGL2Renderer: not initialized — call init() first.');
    }
    return this.renderer;
  }

  private requireScene(): Scene {
    if (this.scene === undefined) {
      throw new Error('WebGL2Renderer: scene is missing — call init() or setScene() first.');
    }
    return this.scene;
  }
}
