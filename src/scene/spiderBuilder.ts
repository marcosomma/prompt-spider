import type { Scene } from "@babylonjs/core/scene";
import { Mesh } from "@babylonjs/core/Meshes/mesh";
import type { AbstractMesh } from "@babylonjs/core/Meshes/abstractMesh";
import { CreateSphere } from "@babylonjs/core/Meshes/Builders/sphereBuilder";
import { CreateTube } from "@babylonjs/core/Meshes/Builders/tubeBuilder";
import { CreateLines } from "@babylonjs/core/Meshes/Builders/linesBuilder";
import { CreatePlane } from "@babylonjs/core/Meshes/Builders/planeBuilder";
import type { LinesMesh } from "@babylonjs/core/Meshes/linesMesh";
import { StandardMaterial } from "@babylonjs/core/Materials/standardMaterial";
import { DynamicTexture } from "@babylonjs/core/Materials/Textures/dynamicTexture";
import { Vector3 } from "@babylonjs/core/Maths/math.vector";
import { Color3 } from "@babylonjs/core/Maths/math.color";
import { TransformNode } from "@babylonjs/core/Meshes/transformNode";
import type { Analysis } from "../analysis/types";
import { PALETTES, hexToRgb, rampColor, type Rgb, type ScenePalette, type Theme } from "./palette";

/** Identifies one node of the spider: leg k, chunk i. */
export interface NodeRef {
  readonly leg: number;
  readonly chunk: number;
}

export interface SpiderGeometry {
  readonly bodyRadius: number;
  readonly innerRadius: number;
  readonly outerRadius: number;
  /** Ground distance between consecutive rings. */
  readonly spacing: number;
  /** Height a node reaches at score 1. */
  readonly height: number;
}

/**
 * Builds the spider for one analysis.
 *
 * Geometry: the body sits at the origin. Leg k leaves the body at angle θk.
 * Along leg k, joint i sits at ground radius r(i) — the same for every leg —
 * so the joints of chunk i form a ring around the body. The joint is lifted
 * to y = height × score, so a leg bends upward wherever the chunk scores high
 * on that analysis. Thus every leg visits every chunk exactly once, in reading
 * order, from body outwards.
 */
export class SpiderBuilder {
  readonly geometry: SpiderGeometry;
  private readonly root: TransformNode;
  private readonly palette: ScenePalette;
  private readonly nodes: Mesh[][] = [];
  private readonly segments: Mesh[][] = [];
  private readonly rings: LinesMesh[] = [];
  private readonly dropLines: LinesMesh[] = [];
  private readonly materials = new Map<string, StandardMaterial>();
  private readonly nodeRefs = new WeakMap<AbstractMesh, NodeRef>();

  constructor(
    private readonly scene: Scene,
    readonly analysis: Analysis,
    theme: Theme,
  ) {
    this.palette = PALETTES[theme];
    this.geometry = computeGeometry(analysis.chunks.length);
    this.root = new TransformNode("spider", scene);
    this.build();
  }

  /** Maps a picked mesh back to its leg/chunk, if it is a node. */
  refOf(mesh: AbstractMesh | null | undefined): NodeRef | null {
    return mesh ? (this.nodeRefs.get(mesh) ?? null) : null;
  }

  /** Highlights every node of one chunk (one per leg) and shows their drop lines. */
  highlightChunk(chunk: number | null): void {
    this.highlightChunks(chunk === null ? [] : [chunk]);
  }

  /** Highlights several chunks at once, e.g. the evidence behind an insight or a metric. */
  highlightChunks(indices: readonly number[]): void {
    this.clearDropLines();
    const selected = new Set(indices);
    const highlight = hexToRgb(this.palette.highlight);
    this.nodes.forEach((legNodes) =>
      legNodes.forEach((node, i) => {
        const on = selected.has(i);
        node.renderOverlay = on;
        node.overlayColor = toColor3(highlight);
        node.overlayAlpha = 0.45;
        node.scaling.setAll(on ? 1.3 : 1);
      }),
    );
    this.rings.forEach((ring, i) => {
      ring.alpha = selected.has(i) ? 0.95 : this.palette.gridAlpha;
    });
    // Drop lines make the height legible; draw them only for a handful of chunks to avoid clutter.
    if (selected.size > 0 && selected.size <= 6) {
      for (const chunk of selected) {
        this.nodes.forEach((legNodes) => {
          const node = legNodes[chunk];
          if (!node) return;
          const foot = new Vector3(node.position.x, 0, node.position.z);
          const line = CreateLines("drop", { points: [foot, node.position.clone()] }, this.scene);
          line.color = toColor3(highlight);
          line.alpha = 0.5;
          line.isPickable = false;
          line.parent = this.root;
          this.dropLines.push(line);
        });
      }
    }
  }

  /** Dims every leg except one; `null` restores all. */
  soloLeg(leg: number | null): void {
    const apply = (meshes: Mesh[][]): void =>
      meshes.forEach((legMeshes, k) => legMeshes.forEach((m) => (m.visibility = leg === null || leg === k ? 1 : 0.12)));
    apply(this.nodes);
    apply(this.segments);
  }

  dispose(): void {
    this.clearDropLines();
    this.root.dispose(false, true);
    this.materials.forEach((m) => m.dispose());
    this.materials.clear();
  }

  private build(): void {
    const { chunks, legs } = this.analysis;
    const K = legs.length;
    const N = chunks.length;
    const g = this.geometry;

    this.buildBody();
    for (let i = 0; i < N; i += 1) this.buildRing(i);

    for (let k = 0; k < K; k += 1) {
      const leg = legs[k]!;
      const theta = legAngle(k, K);
      const ramp = leg.polarity === "focus" ? this.palette.focusRamp : this.palette.diluteRamp;
      const legNodes: Mesh[] = [];
      const legSegments: Mesh[] = [];
      let previous = polar(g.bodyRadius, theta, 0);

      for (let i = 0; i < N; i += 1) {
        const score = leg.scores[i]!;
        const point = polar(ringRadius(i, N, g), theta, g.height * score);
        const previousScore = i === 0 ? score : leg.scores[i - 1]!;
        const segment = CreateTube(
          `seg-${k}-${i}`,
          { path: [previous, point], radius: 0.022 + 0.055 * ((score + previousScore) / 2), tessellation: 12, cap: Mesh.CAP_ALL },
          this.scene,
        );
        segment.material = this.materialFor(ramp, (score + previousScore) / 2);
        segment.isPickable = false;
        segment.parent = this.root;
        segment.freezeWorldMatrix();
        legSegments.push(segment);

        const node = CreateSphere(`node-${k}-${i}`, { diameter: 2 * nodeRadius(score, g), segments: 16 }, this.scene);
        node.position = point;
        node.material = this.materialFor(ramp, score);
        node.parent = this.root;
        this.nodeRefs.set(node, { leg: k, chunk: i });
        legNodes.push(node);
        previous = point;
      }

      this.nodes.push(legNodes);
      this.segments.push(legSegments);
      this.buildLegLabel(leg.label, leg.polarity === "dilute", theta);
    }
  }

  private buildBody(): void {
    const body = CreateSphere("body", { diameter: this.geometry.bodyRadius * 2, segments: 24 }, this.scene);
    const material = new StandardMaterial("body-mat", this.scene);
    material.diffuseColor = toColor3(hexToRgb(this.palette.body));
    material.specularColor = new Color3(0.15, 0.15, 0.15);
    body.material = material;
    body.isPickable = false;
    body.parent = this.root;
    this.materials.set("body", material);

    const label = this.makeLabel(this.analysis.profile.label, 0.42, this.palette.textPrimary);
    label.position = new Vector3(0, this.geometry.bodyRadius + 1.1, 0);
    label.parent = this.root;
  }

  private buildRing(index: number): void {
    const N = this.analysis.chunks.length;
    const r = ringRadius(index, N, this.geometry);
    const points: Vector3[] = [];
    const steps = 96;
    for (let s = 0; s <= steps; s += 1) {
      const a = (s / steps) * Math.PI * 2;
      points.push(new Vector3(r * Math.cos(a), 0, r * Math.sin(a)));
    }
    const ring = CreateLines(`ring-${index}`, { points }, this.scene);
    ring.color = toColor3(hexToRgb(this.palette.grid));
    ring.alpha = this.palette.gridAlpha;
    ring.isPickable = false;
    ring.parent = this.root;
    ring.freezeWorldMatrix();
    this.rings.push(ring);

    if (!shouldLabelRing(index, N)) return;
    // Chunk numbers sit in the gap just before the first leg so they never collide with nodes.
    // Alternate heights keep neighbouring numbers apart when the gap is seen edge-on.
    const K = this.analysis.legs.length;
    const gapAngle = legAngle(0, K) + Math.PI / K;
    const label = this.makeLabel(String(index + 1), 0.28, this.palette.textSecondary);
    label.position = polar(r, gapAngle, index % 2 === 0 ? 0.02 : 0.38);
    label.parent = this.root;
  }

  private buildLegLabel(text: string, dilutes: boolean, theta: number): void {
    const label = this.makeLabel(dilutes ? `${text} ↓` : text, 0.42, this.palette.textPrimary);
    label.position = polar(this.geometry.outerRadius + 0.9, theta, 0.05);
    label.parent = this.root;
  }

  private makeLabel(text: string, worldHeight: number, color: string): Mesh {
    const fontPx = 64;
    const font = `600 ${fontPx}px system-ui, -apple-system, "Segoe UI", sans-serif`;
    const probe = new DynamicTexture("probe", { width: 8, height: 8 }, this.scene, false);
    const ctx = probe.getContext();
    ctx.font = font;
    const textWidth = Math.ceil(ctx.measureText(text).width) + 16;
    probe.dispose();

    const texture = new DynamicTexture(`label-${text}`, { width: textWidth, height: fontPx * 1.4 }, this.scene, true);
    texture.hasAlpha = true;
    texture.drawText(text, 8, fontPx * 1.05, font, color, "transparent", true, true);

    const plane = CreatePlane(`label-plane-${text}`, { width: (worldHeight * textWidth) / (fontPx * 1.4), height: worldHeight }, this.scene);
    const material = new StandardMaterial(`label-mat-${text}`, this.scene);
    material.diffuseTexture = texture;
    material.opacityTexture = texture;
    material.emissiveColor = Color3.White();
    material.disableLighting = true;
    material.backFaceCulling = false;
    plane.material = material;
    plane.billboardMode = Mesh.BILLBOARDMODE_ALL;
    plane.isPickable = false;
    this.materials.set(`label-${text}-${this.materials.size}`, material);
    return plane;
  }

  /** One shared material per quantised ramp step keeps the material count small. */
  private materialFor(ramp: readonly string[], t: number): StandardMaterial {
    const step = Math.round(t * 15);
    const key = `${ramp[0]}-${step}`;
    let material = this.materials.get(key);
    if (!material) {
      material = new StandardMaterial(key, this.scene);
      material.diffuseColor = toColor3(rampColor(ramp, step / 15));
      material.specularColor = new Color3(0.2, 0.2, 0.2);
      material.specularPower = 48;
      material.freeze();
      this.materials.set(key, material);
    }
    return material;
  }

  private clearDropLines(): void {
    this.dropLines.forEach((l) => l.dispose());
    this.dropLines.length = 0;
  }
}

export function computeGeometry(chunkCount: number): SpiderGeometry {
  const bodyRadius = 0.55;
  const innerRadius = 1.2;
  const spacing = chunkCount <= 12 ? 0.6 : chunkCount <= 20 ? 0.5 : chunkCount <= 35 ? 0.4 : 0.3;
  const outerRadius = innerRadius + Math.max(1, chunkCount) * spacing;
  return { bodyRadius, innerRadius, outerRadius, spacing, height: Math.min(2.6, 1.4 + outerRadius * 0.15) };
}

/** Node radius grows with score but never past 40% of the ring spacing, so neighbours stay apart. */
export function nodeRadius(score: number, g: SpiderGeometry): number {
  return Math.min(0.07 + 0.17 * score, g.spacing * 0.4);
}

/** Ground radius of the ring for chunk i; identical for every leg. */
export function ringRadius(index: number, count: number, g: SpiderGeometry): number {
  if (count <= 1) return (g.innerRadius + g.outerRadius) / 2;
  return g.innerRadius + ((g.outerRadius - g.innerRadius) * index) / (count - 1);
}

/** Every ring is numbered on short prompts; long prompts number the first, last and every fifth ring. */
export function shouldLabelRing(index: number, count: number): boolean {
  if (count <= 24) return true;
  return index === 0 || index === count - 1 || (index + 1) % 5 === 0;
}

/** Leg 0 points away from the default camera; legs proceed clockwise seen from above. */
export function legAngle(index: number, count: number): number {
  return Math.PI / 2 - (index / count) * Math.PI * 2;
}

function polar(radius: number, theta: number, y: number): Vector3 {
  return new Vector3(radius * Math.cos(theta), y, radius * Math.sin(theta));
}

function toColor3(rgb: Rgb): Color3 {
  return new Color3(rgb.r, rgb.g, rgb.b);
}
