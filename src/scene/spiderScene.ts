import { Engine } from "@babylonjs/core/Engines/engine";
import { Scene } from "@babylonjs/core/scene";
import { ArcRotateCamera } from "@babylonjs/core/Cameras/arcRotateCamera";
import { HemisphericLight } from "@babylonjs/core/Lights/hemisphericLight";
import { DirectionalLight } from "@babylonjs/core/Lights/directionalLight";
import { Vector3 } from "@babylonjs/core/Maths/math.vector";
import { Color3, Color4 } from "@babylonjs/core/Maths/math.color";
import "@babylonjs/core/Behaviors/Cameras/autoRotationBehavior";
import "@babylonjs/core/Culling/ray";
import "@babylonjs/core/Rendering/outlineRenderer";
import { PALETTES, hexToRgb, type Theme } from "./palette";

/**
 * Owns the Babylon engine, scene, camera and lights. Knows nothing about
 * prompts: `SpiderBuilder` adds meshes to the scene it exposes.
 */
export interface SpiderScene {
  readonly scene: Scene;
  readonly camera: ArcRotateCamera;
  setTheme(theme: Theme): void;
  setAutoRotate(enabled: boolean): void;
  /** Frames a spider of the given outer radius. */
  frame(radius: number): void;
  /** Renders a PNG at the requested pixel size and returns a data URL. */
  screenshot(width: number, height: number, transparent: boolean): Promise<string>;
  resize(): void;
  dispose(): void;
}

export function createSpiderScene(canvas: HTMLCanvasElement, theme: Theme): SpiderScene {
  const engine = new Engine(canvas, true, { preserveDrawingBuffer: true, stencil: true, adaptToDeviceRatio: true });
  const scene = new Scene(engine);

  const camera = new ArcRotateCamera("camera", -Math.PI / 2, 1.0, 12, Vector3.Zero(), scene);
  camera.attachControl(canvas, true);
  camera.wheelPrecision = 30;
  camera.pinchPrecision = 60;
  camera.lowerRadiusLimit = 3;
  camera.upperRadiusLimit = 60;
  camera.upperBetaLimit = Math.PI / 2 - 0.05;
  camera.lowerBetaLimit = 0.15;
  camera.panningSensibility = 0;
  camera.minZ = 0.1;
  camera.useAutoRotationBehavior = true;
  const rotation = camera.autoRotationBehavior!;
  rotation.idleRotationSpeed = 0.12;
  rotation.idleRotationWaitTime = 0;
  rotation.idleRotationSpinupTime = 1200;
  rotation.zoomStopsAnimation = false;

  const hemi = new HemisphericLight("hemi", new Vector3(0, 1, 0), scene);
  hemi.intensity = 0.75;
  const key = new DirectionalLight("key", new Vector3(-0.6, -1, -0.4), scene);
  key.intensity = 0.65;

  let currentTheme = theme;
  const applyTheme = (next: Theme): void => {
    currentTheme = next;
    const palette = PALETTES[next];
    const surface = hexToRgb(palette.surface);
    scene.clearColor = new Color4(surface.r, surface.g, surface.b, 1);
    const ground = hexToRgb(palette.grid);
    hemi.groundColor = new Color3(ground.r, ground.g, ground.b);
  };
  applyTheme(theme);

  engine.runRenderLoop(() => scene.render());
  const observer = new ResizeObserver(() => engine.resize());
  observer.observe(canvas);

  return {
    scene,
    camera,
    setTheme: applyTheme,
    setAutoRotate(enabled) {
      camera.useAutoRotationBehavior = enabled;
      if (enabled && camera.autoRotationBehavior) {
        camera.autoRotationBehavior.idleRotationSpeed = 0.12;
        camera.autoRotationBehavior.idleRotationWaitTime = 0;
        camera.autoRotationBehavior.zoomStopsAnimation = false;
      }
    },
    frame(radius) {
      // Aim slightly below the disc: perspective enlarges the near edge, so looking a little
      // lower shifts the whole spider up in the frame and keeps that edge and its labels in view.
      camera.target = new Vector3(0, -0.6, 0);
      const aspect = engine.getRenderWidth() / Math.max(1, engine.getRenderHeight());
      const fit = aspect >= 1 ? 2.35 : 2.35 / Math.max(0.5, aspect);
      camera.radius = Math.max(camera.lowerRadiusLimit ?? 3, (radius + 1.2) * fit);
      camera.beta = 0.95;
    },
    async screenshot(width, height, transparent) {
      // Render the live canvas at the requested resolution by changing the hardware scaling
      // level, then read the pixels back. Fully synchronous, so it does not depend on the
      // animation-frame loop or on post-process shader compilation.
      const previousScaling = engine.getHardwareScalingLevel();
      const previousClear = scene.clearColor.clone();
      const cssWidth = Math.max(1, canvas.clientWidth);
      try {
        if (transparent) scene.clearColor = new Color4(0, 0, 0, 0);
        engine.setHardwareScalingLevel(cssWidth / width);
        engine.resize();
        camera.getProjectionMatrix(true);
        scene.render();
        if (engine.getRenderHeight() !== height) {
          // The canvas box does not have exactly the requested ratio; crop/pad by drawing onto a target-sized canvas.
          const target = document.createElement("canvas");
          target.width = width;
          target.height = height;
          const context = target.getContext("2d");
          if (!context) throw new Error("2D canvas is unavailable for export.");
          const srcWidth = engine.getRenderWidth();
          const srcHeight = engine.getRenderHeight();
          const scale = Math.max(width / srcWidth, height / srcHeight);
          const drawWidth = srcWidth * scale;
          const drawHeight = srcHeight * scale;
          context.drawImage(canvas, (width - drawWidth) / 2, (height - drawHeight) / 2, drawWidth, drawHeight);
          return target.toDataURL("image/png");
        }
        return canvas.toDataURL("image/png");
      } finally {
        scene.clearColor = previousClear;
        engine.setHardwareScalingLevel(previousScaling);
        engine.resize();
        applyTheme(currentTheme);
      }
    },
    resize: () => engine.resize(),
    dispose() {
      observer.disconnect();
      scene.dispose();
      engine.dispose();
    },
  };
}
