import type { ModRouting } from "@/types/scene";

/**
 * A MotionRecipe is a named bundle of routings pre-tuned for a specific
 * element or style (SPEC2 §9.3). Applied via the motion tab's "auto-route"
 * button when the selected group's `sourceGenerator` matches — it drops
 * real, hand-editable ModRoutings, never a locked black box.
 */
export type RecipeRouting = Omit<ModRouting, "id" | "layerId">;

export interface MotionRecipe {
  id: string;
  name: string;
  /** matches GroupLayer.sourceGenerator (or an effect kind, for riso etc.) */
  match: string;
  routings: RecipeRouting[];
}

const r = (
  target: string,
  source: ModRouting["source"],
  amount: number,
  smoothing: number,
  extra: Partial<RecipeRouting> = {},
): RecipeRouting => ({
  target,
  source,
  amount,
  smoothing,
  invert: false,
  phaseOffset: 0,
  ratchet: false,
  ...extra,
});

export const RECIPES: MotionRecipe[] = [
  {
    id: "wash-breathe",
    name: "breathing wash",
    match: "wash",
    // slow, heavily-smoothed swell — this element must never look twitchy
    routings: [
      r("scale", "rms", 0.4, 0.85),
      r("hue", "low", 0.3, 0.9),
      r("opacity", "mid", 0.2, 0.8),
    ],
  },
  {
    id: "splatter-hits",
    name: "spattered on hits",
    match: "splatter",
    // punchy, low-smoothed transient reaction; phaseOffset set per-instance
    // at apply time so a cluster ripples instead of pulsing in unison
    routings: [r("scale", "onset", 0.6, 0.2), r("rotation", "onset", 0.15, 0.2)],
  },
  {
    id: "brush-wobble",
    name: "living wobble",
    match: "brush",
    routings: [r("effect:displace:amount", "mid", 0.5, 0.6)],
  },
  {
    id: "botanical-sway",
    name: "sway + shimmer",
    match: "botanical",
    routings: [
      r("scale", "rms", 0.15, 0.9),
      r("effect:glow:intensity", "high", 0.3, 0.6),
    ],
  },
  {
    id: "dendrite-grow",
    name: "growth bloom",
    match: "dendrite",
    // the one place smoothing philosophy inverts: slow + ratcheted = a
    // satisfying one-way bloom across a set (SPEC2 §9.3)
    routings: [r("growthProgress", "rms", 1, 0.96, { ratchet: true })],
  },
  {
    id: "botanical-grow",
    name: "growth bloom",
    match: "botanical-lsystem",
    routings: [r("growthProgress", "rms", 1, 0.96, { ratchet: true })],
  },
  {
    id: "riso-jitter",
    name: "misprint jitter",
    match: "riso",
    routings: [r("effect:riso:misregistration", "high", 0.5, 0.3)],
  },
  {
    id: "feedback-breathe",
    name: "trail breathing",
    match: "feedback",
    routings: [
      r("post:feedback:zoom", "rms", 0.5, 0.7),
      r("post:feedback:rotate", "mid", 0.3, 0.85),
    ],
  },
  {
    id: "bloom-flash",
    name: "flash bloom",
    match: "bloom",
    routings: [r("post:bloom:intensity", "onset", 0.4, 0.15)],
  },
];

export function recipesFor(match: string | undefined): MotionRecipe[] {
  if (!match) return [];
  return RECIPES.filter((rec) => rec.match === match);
}
