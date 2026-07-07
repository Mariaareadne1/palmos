import type { Effect, Layer, SceneGraph } from "@/types/scene";
import { getEffectDef } from "./registry";

export interface TargetOption {
  value: string;   // ModTarget
  label: string;
}

export interface TargetGroup {
  group: "transform" | "style" | "effects" | "post" | "shader" | "growth";
  options: TargetOption[];
}

const CORE: TargetOption[] = [
  { value: "x", label: "x" },
  { value: "y", label: "y" },
  { value: "scale", label: "scale" },
  { value: "rotation", label: "rotation" },
  { value: "opacity", label: "opacity" },
  { value: "hue", label: "hue" },
  { value: "blur", label: "blur" },
];

function numericParamTargets(
  effect: Effect,
  scope: "effect" | "post",
): TargetOption[] {
  const def = getEffectDef(effect.kind);
  if (!def) return [];
  return def.params
    .filter((p) => p.type === "number")
    .map((p) => ({
      value: `${scope}:${effect.id}:${p.name}`,
      label: `${def.name}.${p.label}`,
    }));
}

/**
 * The grouped target list the motion-tab dropdown shows for a selection:
 * transform / style / effects / post / shader / growth (SPEC2 §9.1).
 */
export function modTargetsForLayer(
  layer: Layer | null,
  postEffects: SceneGraph["postEffects"],
): TargetGroup[] {
  const groups: TargetGroup[] = [{ group: "transform", options: CORE }];

  if (layer) {
    const effectOpts = layer.effects.flatMap((e) =>
      numericParamTargets(e, "effect"),
    );
    if (effectOpts.length) {
      groups.push({ group: "effects", options: effectOpts });
    }
    if (layer.type === "shader") {
      const shaderOpts = Object.keys(layer.customParams).map((k) => ({
        value: `shader:${k}`,
        label: `shader.${k}`,
      }));
      if (shaderOpts.length) groups.push({ group: "shader", options: shaderOpts });
    }
    if (layer.type === "group" && layer.growthSteps?.length) {
      groups.push({
        group: "growth",
        options: [{ value: "growthProgress", label: "growth progress" }],
      });
    }
  }

  const postOpts = postEffects.flatMap((e) => numericParamTargets(e, "post"));
  if (postOpts.length) groups.push({ group: "post", options: postOpts });

  return groups;
}

/** Human label for a stored target value (may reference deleted effects). */
export function targetLabel(target: string): string {
  if (target.startsWith("effect:") || target.startsWith("post:")) {
    const [, , param] = target.split(":");
    return param ?? target;
  }
  if (target.startsWith("shader:")) return target.slice(7);
  return target;
}
