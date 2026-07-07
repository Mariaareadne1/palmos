import type { ModRouting, SceneGraph } from "@/types/scene";
import { Smoother, type FeatureFrame } from "@/perform/features";
import { paramRange } from "@/effects/registry";

/**
 * Ephemeral per-layer property offsets computed from live audio. These
 * are overlays applied at render time — NEVER written back to the scene
 * graph (SPEC.md §2).
 */
export interface PropertyOffsets {
  dx: number;
  dy: number;
  scale: number;
  rotation: number;
  opacity: number;
  hue: number;
  blur: number;
}

export function zeroOffsets(): PropertyOffsets {
  return { dx: 0, dy: 0, scale: 1, rotation: 0, opacity: 0, hue: 0, blur: 0 };
}

const CORE_TARGETS = new Set([
  "x",
  "y",
  "scale",
  "rotation",
  "opacity",
  "hue",
  "blur",
]);

/** SPEC2 §9.3: the four-way live "reactivity focus" HUD control. */
export type ReactivityFocus = "calm" | "pulse" | "chaos" | "strobe";

export interface ModulationResult {
  /** transform/style offsets, keyed by layer id */
  transform: Map<string, PropertyOffsets>;
  /** layer effect param offsets: layerId → { "effectId:param": offset } */
  effects: Map<string, Record<string, number>>;
  /** document post-fx offsets: "effectId:param" → offset */
  post: Record<string, number>;
  /** shader-layer customParam offsets: layerId → { param: offset } */
  shader: Map<string, Record<string, number>>;
  /** growth playback progress: layerId → 0–1 */
  growth: Map<string, number>;
}

function emptyResult(): ModulationResult {
  return {
    transform: new Map(),
    effects: new Map(),
    post: {},
    shader: new Map(),
    growth: new Map(),
  };
}

const MAX_DELAY_FRAMES = 40; // phaseOffset=1 → ~0.66s delay at 60fps

/**
 * Per-routing EMA state + a shared ring buffer of recent FeatureFrames
 * so phase-offset routings can read a slightly delayed sample without a
 * second audio path (SPEC2 §9.3).
 */
export class SmootherBank {
  private smoothers = new Map<string, Smoother>();
  private ratchetMax = new Map<string, number>();
  private history: FeatureFrame[] = [];

  pushFrame(frame: FeatureFrame): void {
    this.history.push(frame);
    if (this.history.length > MAX_DELAY_FRAMES + 1) this.history.shift();
  }

  /** feature value `phaseOffset` back in time (0 = current). */
  delayed(
    source: keyof FeatureFrame,
    phaseOffset: number,
    current: number,
  ): number {
    if (phaseOffset <= 0 || this.history.length === 0) return current;
    const back = Math.round(phaseOffset * MAX_DELAY_FRAMES);
    const idx = this.history.length - 1 - back;
    if (idx < 0) return this.history[0]?.[source] ?? current;
    return this.history[idx]?.[source] ?? current;
  }

  smoother(id: string): Smoother {
    let s = this.smoothers.get(id);
    if (!s) {
      s = new Smoother();
      this.smoothers.set(id, s);
    }
    return s;
  }

  ratchet(id: string, value: number): number {
    const prev = this.ratchetMax.get(id) ?? 0;
    const next = Math.max(prev, value);
    this.ratchetMax.set(id, next);
    return next;
  }

  prune(validIds: Set<string>): void {
    for (const id of this.smoothers.keys()) {
      if (!validIds.has(id)) this.smoothers.delete(id);
    }
    for (const id of this.ratchetMax.keys()) {
      if (!validIds.has(id)) this.ratchetMax.delete(id);
    }
  }

  clear(): void {
    this.smoothers.clear();
    this.ratchetMax.clear();
    this.history = [];
  }
}

/** Reactivity-focus scalar transform over a routing's amount/smoothing. */
function focusAdjust(
  focus: ReactivityFocus,
  routing: ModRouting,
): { amount: number; smoothing: number } {
  let amount = routing.amount;
  let smoothing = routing.smoothing;
  switch (focus) {
    case "calm":
      amount *= 0.5;
      smoothing = Math.min(1, smoothing * 2);
      break;
    case "chaos":
      amount *= 1.5;
      if (!routing.ratchet) smoothing *= 0.5;
      break;
    case "strobe":
      // onset-driven targets stay full; everything else is dialed way down
      if (routing.source !== "onset") amount *= 0.2;
      break;
    case "pulse":
    default:
      break;
  }
  return { amount, smoothing };
}

/**
 * Per-target scaling of `amount` (bipolar; `invert` flips sign) — the
 * SPEC.md table for core targets, and ±40%-of-range for effect/post/
 * shader params (range from the registry, SPEC2 §9.1).
 */
export function applyModulation(
  graph: Pick<SceneGraph, "width" | "height" | "postEffects" | "layers">,
  features: FeatureFrame,
  routings: ModRouting[],
  bank: SmootherBank,
  intensity = 1,
  focus: ReactivityFocus = "pulse",
): ModulationResult {
  bank.pushFrame(features);
  const result = emptyResult();

  for (const r of routings) {
    const rawNow = features[r.source] ?? 0;
    const raw = bank.delayed(r.source, r.phaseOffset, rawNow);
    const adj = focusAdjust(focus, r);
    let v = bank.smoother(r.id).process(raw, adj.smoothing);
    if (r.ratchet) v = bank.ratchet(r.id, v);
    const amount = adj.amount * (r.invert ? -1 : 1) * intensity;
    const drive = v * amount;

    // --- growthProgress: a 0–1 reveal, not an offset ---
    if (r.target === "growthProgress") {
      const cur = result.growth.get(r.layerId) ?? 0;
      result.growth.set(r.layerId, Math.min(1, Math.max(0, cur + drive)));
      continue;
    }

    // --- effect / post / shader param offsets ---
    if (r.target.startsWith("effect:") || r.target.startsWith("post:")) {
      const [scope, effectId, param] = r.target.split(":");
      const kind = findEffectKind(graph, scope, r.layerId, effectId);
      const range = kind ? paramRange(kind, param) : null;
      const span = range ? (range.max - range.min) * 0.4 : 0.4;
      const offset = drive * span;
      if (scope === "post") {
        result.post[`${effectId}:${param}`] =
          (result.post[`${effectId}:${param}`] ?? 0) + offset;
      } else {
        const m = result.effects.get(r.layerId) ?? {};
        m[`${effectId}:${param}`] = (m[`${effectId}:${param}`] ?? 0) + offset;
        result.effects.set(r.layerId, m);
      }
      continue;
    }
    if (r.target.startsWith("shader:")) {
      const param = r.target.slice("shader:".length);
      const m = result.shader.get(r.layerId) ?? {};
      // shader customParams are 0–1; |amount|=1 sweeps ±0.4
      m[param] = (m[param] ?? 0) + drive * 0.4;
      result.shader.set(r.layerId, m);
      continue;
    }

    // --- core transform/style targets ---
    if (!CORE_TARGETS.has(r.target)) continue;
    let o = result.transform.get(r.layerId);
    if (!o) {
      o = zeroOffsets();
      result.transform.set(r.layerId, o);
    }
    switch (r.target) {
      case "x":
        o.dx += drive * 0.15 * graph.width;
        break;
      case "y":
        o.dy += drive * 0.15 * graph.height;
        break;
      case "scale":
        o.scale *= 1 + drive * 0.5;
        break;
      case "rotation":
        o.rotation += drive * 45;
        break;
      case "opacity":
        o.opacity += drive;
        break;
      case "hue":
        o.hue += drive * 180;
        break;
      case "blur":
        o.blur = Math.max(0, o.blur + drive * 24);
        break;
    }
  }
  return result;
}

/** resolve an effect's kind so we can look up its param range. */
function findEffectKind(
  graph: Pick<SceneGraph, "postEffects" | "layers">,
  scope: string,
  layerId: string,
  effectId: string,
): string | null {
  if (scope === "post") {
    return graph.postEffects.find((e) => e.id === effectId)?.kind ?? null;
  }
  const layer = findLayerShallow(graph.layers, layerId);
  return layer?.effects.find((e) => e.id === effectId)?.kind ?? null;
}

function findLayerShallow(
  layers: SceneGraph["layers"],
  id: string,
): SceneGraph["layers"][number] | null {
  for (const layer of layers) {
    if (layer.id === id) return layer;
    if (layer.type === "group") {
      const hit = findLayerShallow(layer.children, id);
      if (hit) return hit;
    }
  }
  return null;
}
