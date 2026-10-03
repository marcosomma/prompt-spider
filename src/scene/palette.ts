/**
 * Colour roles for the scene, in both themes. Values come from the
 * validated reference palette: blue is the sequential hue for *focus* legs,
 * orange (the next categorical slot) for *diluting* legs. Score is encoded
 * twice, by colour and by node size, so colour never carries it alone.
 */

export type Theme = "light" | "dark";

export interface ScenePalette {
  readonly surface: string;
  readonly textPrimary: string;
  readonly textSecondary: string;
  readonly grid: string;
  /** Opacity of the chunk rings; the light surface needs more than the dark one. */
  readonly gridAlpha: number;
  readonly body: string;
  /** Low → high score for focus legs. */
  readonly focusRamp: readonly string[];
  /** Low → high score for diluting legs. */
  readonly diluteRamp: readonly string[];
  readonly highlight: string;
}

export const PALETTES: Readonly<Record<Theme, ScenePalette>> = {
  light: {
    surface: "#fcfcfb",
    textPrimary: "#0b0b0b",
    textSecondary: "#52514e",
    grid: "#7d7c76",
    gridAlpha: 0.85,
    body: "#3d3d3a",
    // Starts mid-ramp: the palest steps vanish on a white surface under lighting.
    focusRamp: ["#86b6ef", "#6da7ec", "#5598e7", "#3987e5", "#2a78d6", "#256abf", "#1c5cab", "#104281"],
    diluteRamp: ["#f09c72", "#ee8552", "#eb6834", "#e46330", "#c94f1f", "#a03d14", "#772c0e", "#521d08"],
    highlight: "#0b0b0b",
  },
  dark: {
    surface: "#1a1a19",
    textPrimary: "#ffffff",
    textSecondary: "#c3c2b7",
    grid: "#3d3d3a",
    gridAlpha: 0.35,
    body: "#c3c2b7",
    // Stops short of the lightest steps: on a dark surface they read as white and the two hues merge.
    focusRamp: ["#184f95", "#1c5cab", "#256abf", "#2a78d6", "#3987e5", "#5598e7", "#6da7ec", "#86b6ef"],
    diluteRamp: ["#772c0e", "#a03d14", "#c94f1f", "#d95926", "#e46330", "#eb6834", "#ee8552", "#f09c72"],
    highlight: "#ffffff",
  },
};

export interface Rgb {
  readonly r: number;
  readonly g: number;
  readonly b: number;
}

export function hexToRgb(hex: string): Rgb {
  const value = Number.parseInt(hex.replace("#", ""), 16);
  return { r: ((value >> 16) & 255) / 255, g: ((value >> 8) & 255) / 255, b: (value & 255) / 255 };
}

export function rgbToCss(rgb: Rgb, alpha = 1): string {
  const c = (v: number) => Math.round(v * 255);
  return `rgba(${c(rgb.r)}, ${c(rgb.g)}, ${c(rgb.b)}, ${alpha})`;
}

/** Piecewise-linear interpolation along a ramp for t in [0, 1]. */
export function rampColor(ramp: readonly string[], t: number): Rgb {
  const clamped = t < 0 ? 0 : t > 1 ? 1 : t;
  const scaled = clamped * (ramp.length - 1);
  const i = Math.min(ramp.length - 2, Math.floor(scaled));
  const f = scaled - i;
  const a = hexToRgb(ramp[i]!);
  const b = hexToRgb(ramp[i + 1]!);
  return { r: a.r + (b.r - a.r) * f, g: a.g + (b.g - a.g) * f, b: a.b + (b.b - a.b) * f };
}
