import type { ParamValue } from "@/effects/registry";

/**
 * Bridges the effects-tab "bake to layers" button to EditorCanvas, which
 * owns the Konva stage needed to rasterize the source layer. One handler,
 * registered by the canvas on mount (same pattern as importBus).
 */
export interface BakeCommand {
  layerId: string;
  kind: string;
  params: Record<string, ParamValue>;
  seed: number;
}

type Handler = (cmd: BakeCommand) => void;

let handler: Handler | null = null;

export function onBakeRequest(h: Handler): () => void {
  handler = h;
  return () => {
    if (handler === h) handler = null;
  };
}

export function requestBake(cmd: BakeCommand): void {
  handler?.(cmd);
}
