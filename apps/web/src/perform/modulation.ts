import type { ModRouting, SceneGraph } from "@/types/scene";
import { Smoother, type FeatureFrame } from "@/perform/features";

/**
 * Ephemeral per-layer property offsets computed from live audio. These
 * are overlays applied at render time by the perform renderer — they are
 * NEVER written back to the scene graph (SPEC §2).
 */
export interface PropertyOffsets {
  dx: number;        // px
  dy: number;        // px
  scale: number;     // multiplicative, 1 = unchanged
  rotation: number;  // degrees, additive
  opacity: number;   // additive, clamp when applying
  hue: number;       // degrees of hue-rotate on fill
  blur: number;      // px, >= 0
}

export function zeroOffsets(): PropertyOffsets {
  return { dx: 0, dy: 0, scale: 1, rotation: 0, opacity: 0, hue: 0, blur: 0 };
}

/** Per-routing EMA state, keyed by routing id — survives across frames. */
export class SmootherBank {
  private map = new Map<string, Smoother>();

  get(id: string): Smoother {
    let s = this.map.get(id);
    if (!s) {
      s = new Smoother();
      this.map.set(id, s);
    }
    return s;
  }

  prune(validIds: Set<string>): void {
    for (const id of this.map.keys()) {
      if (!validIds.has(id)) this.map.delete(id);
    }
  }

  clear(): void {
    this.map.clear();
  }
}

/**
 * Per-target scaling of `amount` (bipolar; `invert` flips sign) — the
 * table from SPEC §5 step 4:
 *
 *   x, y      ±15% of canvas dimension at |amount| = 1
 *   scale     ×(1 ± 0.5)
 *   rotation  ±45°
 *   opacity   ±1 (clamped when applied)
 *   hue       ±180°
 *   blur      0→24 px (unipolar)
 */
export function applyModulation(
  graph: Pick<SceneGraph, "width" | "height">,
  features: FeatureFrame,
  routings: ModRouting[],
  bank: SmootherBank,
  intensity = 1,
): Map<string, PropertyOffsets> {
  const out = new Map<string, PropertyOffsets>();

  for (const r of routings) {
    const raw = features[r.source] ?? 0;
    const v = bank.get(r.id).process(raw, r.smoothing);
    const amount = r.amount * (r.invert ? -1 : 1) * intensity;
    const drive = v * amount;

    let o = out.get(r.layerId);
    if (!o) {
      o = zeroOffsets();
      out.set(r.layerId, o);
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
  return out;
}
