import type { LegDefinition, LegId } from "../types";
import { directive } from "./directive";
import { constraint } from "./constraint";
import { specificity } from "./specificity";
import { emphasis } from "./emphasis";
import { outputShape } from "./outputShape";
import { roleFrame } from "./roleFrame";
import { structure } from "./structure";
import { position } from "./position";
import { reinforcement } from "./reinforcement";
import { contextLoad } from "./contextLoad";
import { hedging } from "./hedging";

/**
 * The spider's legs, in the order they are drawn around the body.
 * Focus legs come first, diluting legs last so they sit together visually.
 */
export const LEGS: readonly LegDefinition[] = [
  directive,
  constraint,
  specificity,
  emphasis,
  outputShape,
  roleFrame,
  structure,
  position,
  reinforcement,
  contextLoad,
  hedging,
];

export const LEG_BY_ID: ReadonlyMap<LegId, LegDefinition> = new Map(LEGS.map((leg) => [leg.id, leg]));

export { positionWeight } from "./position";
