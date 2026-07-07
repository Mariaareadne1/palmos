import type { Layer, ModRouting, SceneGraph } from "@/types/scene";

/**
 * v1 → v2 migration (SPEC2 §9.1): adds empty `effects` to every layer,
 * `postEffects`/`styles` to the scene, and `phaseOffset`/`ratchet` to
 * every routing. Idempotent — v2 input passes through with defaults
 * backfilled, so it doubles as a loader-side normalizer.
 */

type AnyRecord = Record<string, unknown>;

function migrateLayer(raw: AnyRecord): Layer {
  const layer: AnyRecord = {
    effects: [],
    ...raw,
  };
  if (!Array.isArray(layer.effects)) layer.effects = [];
  if (layer.type === "group") {
    layer.children = Array.isArray(layer.children)
      ? (layer.children as AnyRecord[]).map(migrateLayer)
      : [];
  }
  if (layer.type === "text") {
    if (typeof layer.letterSpacing !== "number") layer.letterSpacing = 0;
    if (typeof layer.strokeOnly !== "boolean") layer.strokeOnly = false;
  }
  return layer as unknown as Layer;
}

function migrateRouting(raw: AnyRecord): ModRouting {
  return {
    phaseOffset: 0,
    ratchet: false,
    ...raw,
  } as unknown as ModRouting;
}

export function migrateScene(raw: unknown): SceneGraph {
  const s = raw as AnyRecord;
  return {
    ...s,
    layers: Array.isArray(s.layers)
      ? (s.layers as AnyRecord[]).map(migrateLayer)
      : [],
    routings: Array.isArray(s.routings)
      ? (s.routings as AnyRecord[]).map(migrateRouting)
      : [],
    postEffects: Array.isArray(s.postEffects) ? s.postEffects : [],
    styles: Array.isArray(s.styles) ? s.styles : [],
    version: 2,
  } as SceneGraph;
}
