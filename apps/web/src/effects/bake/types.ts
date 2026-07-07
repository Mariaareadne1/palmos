import type { Layer } from "@/types/scene";
import type { ParamValue } from "@/effects/registry";

/** Serializable image the worker computes over (no DOM types cross the wire). */
export interface RasterSource {
  width: number;
  height: number;
  data: Uint8ClampedArray; // RGBA
}

export interface BakeRequest {
  jobId: string;
  kind: string;
  params: Record<string, ParamValue>;
  seed: number;
  source: RasterSource;
}

/**
 * Worker output. Bake effects emit editable layers; `scatter`/`pixelSort`
 * may emit ImageLayers where raster output is inherent (SPEC2 §10). The
 * host inserts these into a group under the source layer.
 */
export interface BakeResult {
  jobId: string;
  layers: Layer[];
  /** low-res preview PNG data URL, optional */
  preview?: string;
}

export type BakeWorkerMessage =
  | { type: "run"; request: BakeRequest }
  | { type: "cancel"; jobId: string };

export type BakeWorkerReply =
  | { type: "done"; result: BakeResult }
  | { type: "error"; jobId: string; message: string };
