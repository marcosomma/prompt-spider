import type { LegDefinition, PositionCurve } from "../types";
import { clamp01 } from "../text";

/**
 * Primacy/recency curve ("lost in the middle"). The curve is a property of the
 * model profile; small models sag more in the middle than frontier ones.
 */
export function positionWeight(index: number, count: number, curve: PositionCurve): number {
  if (count <= 1) return 1;
  const tau = Math.max(1, curve.tau * count);
  const fromStart = Math.exp(-index / tau);
  const fromEnd = Math.exp(-(count - 1 - index) / tau);
  return clamp01(curve.floor + curve.primacy * fromStart + curve.recency * fromEnd);
}

export const position: LegDefinition = {
  id: "position",
  label: "Position",
  polarity: "focus",
  description: "Where the chunk sits: openings and endings get more attention than the middle, more so on smaller models.",
  explainer: {
    what: "Where this piece sits in the prompt: at the beginning, at the end, or somewhere in the middle.",
    why: "Models pay more attention to the start and the end of a prompt. Smaller models in particular tend to lose what sits in the middle of a long text.",
    high: "The first and last lines of the prompt.",
    low: "A rule in the middle of a long prompt.",
  },
  score({ chunks, profile }) {
    const n = chunks.length;
    return chunks.map((chunk) => {
      let w = positionWeight(chunk.index, n, profile.position);
      // A heading inherits a little of the salience of what follows: it is a landmark.
      if (chunk.kind === "heading") w = clamp01(w + 0.1);
      return w;
    });
  },
};
