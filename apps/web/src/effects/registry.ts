import { Filter, GlProgram, UniformGroup, defaultFilterVert } from "pixi.js";
import type { Effect } from "@/types/scene";

/**
 * The effect registry (SPEC2 §9.2). Every effect declares its params;
 * the inspector auto-generates UI from these definitions and the mod
 * matrix resolves param ranges from them — no hand-built panels.
 *
 * Two execution classes:
 *  - gpu:  one GLSL fragment, hosted by both edit previews and perform
 *  - bake: worker-computed vector output (implementations live in the
 *          worker bundle — see bake/implementations.ts)
 */

export type ParamValue = number | string | boolean;

export interface ParamDef {
  name: string;
  label: string;
  type: "number" | "color" | "select" | "boolean";
  min?: number;
  max?: number;
  step?: number;
  default: ParamValue;
  options?: string[];
}

interface EffectDefBase {
  kind: string;
  name: string;
  params: ParamDef[];
}

export interface GpuEffectDef extends EffectDefBase {
  class: "gpu";
  fragment: string;
  /** effect samples uTime each frame (grain animated, displace speed…) */
  animated?: boolean;
}

export interface BakeEffectDef extends EffectDefBase {
  class: "bake";
}

export type EffectDef = GpuEffectDef | BakeEffectDef;

const registry = new Map<string, EffectDef>();

export function registerEffect(def: EffectDef): void {
  registry.set(def.kind, def);
}

export function getEffectDef(kind: string): EffectDef | undefined {
  return registry.get(kind);
}

export function allEffectDefs(): EffectDef[] {
  return [...registry.values()];
}

export function gpuEffectDefs(): GpuEffectDef[] {
  return allEffectDefs().filter((d): d is GpuEffectDef => d.class === "gpu");
}

export function bakeEffectDefs(): BakeEffectDef[] {
  return allEffectDefs().filter((d): d is BakeEffectDef => d.class === "bake");
}

export function defaultParams(def: EffectDef): Record<string, ParamValue> {
  const out: Record<string, ParamValue> = {};
  for (const p of def.params) out[p.name] = p.default;
  return out;
}

/** min/max range for a numeric param — the mod matrix sweeps ±40% of it. */
export function paramRange(
  kind: string,
  param: string,
): { min: number; max: number } | null {
  const def = registry.get(kind);
  const p = def?.params.find((x) => x.name === param);
  if (!p || p.type !== "number") return null;
  return { min: p.min ?? 0, max: p.max ?? 1 };
}

// ---------- generic param → uniform plumbing ----------

const uName = (param: string) => `u${param[0].toUpperCase()}${param.slice(1)}`;

function hexToVec3(hex: string): [number, number, number] {
  const h = hex.replace("#", "");
  const full = h.length === 3 ? h.split("").map((c) => c + c).join("") : h;
  return [
    parseInt(full.slice(0, 2), 16) / 255,
    parseInt(full.slice(2, 4), 16) / 255,
    parseInt(full.slice(4, 6), 16) / 255,
  ];
}

/**
 * Create a Filter instance for a GPU effect. GlProgram.from caches
 * compiled programs by source, so after the startup warmup pass this
 * never recompiles — instances only carry per-layer uniform values.
 */
export function makeGpuFilter(def: GpuEffectDef): Filter {
  const uniforms: Record<string, { value: unknown; type: string }> = {
    uTime: { value: 0, type: "f32" },
  };
  for (const p of def.params) {
    const key = uName(p.name);
    if (p.type === "number") {
      uniforms[key] = { value: p.default as number, type: "f32" };
    } else if (p.type === "boolean") {
      uniforms[key] = { value: p.default ? 1 : 0, type: "f32" };
    } else if (p.type === "select") {
      uniforms[key] = {
        value: Math.max(0, p.options?.indexOf(p.default as string) ?? 0),
        type: "f32",
      };
    } else {
      uniforms[key] = { value: hexToVec3(p.default as string), type: "vec3<f32>" };
    }
  }
  return new Filter({
    glProgram: GlProgram.from({
      vertex: defaultFilterVert,
      fragment: def.fragment,
      name: `palmos-${def.kind}`,
    }),
    resources: {
      effectUniforms: new UniformGroup(
        uniforms as ConstructorParameters<typeof UniformGroup>[0],
      ),
    },
  });
}

/**
 * Push params (+ modulation offsets on numeric params) into a filter's
 * uniforms. Offsets are ±40%-of-range sweeps, clamped (SPEC2 §9.1).
 */
export function applyEffectParams(
  filter: Filter,
  def: GpuEffectDef,
  effect: Effect,
  offsets?: Record<string, number>,
  timeSec?: number,
): void {
  const group = filter.resources.effectUniforms as UniformGroup;
  const u = group.uniforms as Record<string, unknown>;
  if (timeSec !== undefined) u.uTime = timeSec;
  for (const p of def.params) {
    const key = uName(p.name);
    const raw = effect.params[p.name] ?? p.default;
    if (p.type === "number") {
      let v = typeof raw === "number" ? raw : Number(raw);
      const offset = offsets?.[p.name];
      if (offset) {
        v = Math.min(p.max ?? Infinity, Math.max(p.min ?? -Infinity, v + offset));
      }
      u[key] = v;
    } else if (p.type === "boolean") {
      u[key] = raw ? 1 : 0;
    } else if (p.type === "select") {
      u[key] = Math.max(0, p.options?.indexOf(String(raw)) ?? 0);
    } else {
      u[key] = hexToVec3(String(raw));
    }
  }
}

// ---------- step-9 foundational effects ----------

registerEffect({
  kind: "invert",
  name: "invert",
  class: "gpu",
  params: [
    {
      name: "amount",
      label: "amount",
      type: "number",
      min: 0,
      max: 1,
      step: 0.01,
      default: 1,
    },
  ],
  fragment: /* glsl */ `
in vec2 vTextureCoord;
out vec4 finalColor;
uniform sampler2D uTexture;
uniform float uTime;
uniform float uAmount;

void main() {
  vec4 c = texture(uTexture, vTextureCoord);
  vec3 rgb = c.a > 0.0 ? c.rgb / c.a : c.rgb;
  rgb = mix(rgb, 1.0 - rgb, uAmount);
  finalColor = vec4(rgb * c.a, c.a);
}
`,
});

registerEffect({
  kind: "posterizeTrace",
  name: "posterize trace",
  class: "bake",
  params: [
    {
      name: "levels",
      label: "levels",
      type: "number",
      min: 2,
      max: 8,
      step: 1,
      default: 4,
    },
    {
      name: "simplify",
      label: "simplify",
      type: "number",
      min: 0,
      max: 4,
      step: 0.1,
      default: 1,
    },
    {
      name: "seed",
      label: "seed",
      type: "number",
      min: 0,
      max: 9999,
      step: 1,
      default: 1,
    },
  ],
});
