/**
 * Minimal bridge: TopBar's import button hands image files to the
 * reconstruction flow that lives in CanvasArea (which owns the progress
 * UI). One handler, registered by the canvas on mount.
 */

type Handler = (file: File) => void;

let handler: Handler | null = null;

export function onImportImage(h: Handler): () => void {
  handler = h;
  return () => {
    if (handler === h) handler = null;
  };
}

export function importImage(file: File): void {
  handler?.(file);
}
