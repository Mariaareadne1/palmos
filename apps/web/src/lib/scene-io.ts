import type { SceneGraph } from "@/types/scene";
import { sceneToSvg } from "@/lib/svg";
import { migrateScene } from "@/lib/migrate";

/**
 * Structural validation for imported/loaded graphs. Accepts v1 (SPEC.md)
 * and v2 (SPEC2) — callers run everything through normalizeScene, so the
 * app only ever holds v2 in memory.
 */
export function isSceneGraph(value: unknown): boolean {
  if (typeof value !== "object" || value === null) return false;
  const s = value as Record<string, unknown>;
  return (
    typeof s.id === "string" &&
    typeof s.name === "string" &&
    typeof s.width === "number" &&
    typeof s.height === "number" &&
    typeof s.background === "string" &&
    Array.isArray(s.layers) &&
    Array.isArray(s.routings) &&
    Array.isArray(s.palette) &&
    (s.version === 1 || s.version === 2)
  );
}

/** Validate + migrate to v2 in one step; throws on structural mismatch. */
export function normalizeScene(value: unknown): SceneGraph {
  if (!isSceneGraph(value)) throw new Error("not a valid palmos scene");
  return migrateScene(value);
}

function download(filename: string, blob: Blob): void {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

export function exportSceneJson(scene: SceneGraph): void {
  download(
    `${scene.name}.palmos.json`,
    new Blob([JSON.stringify(scene, null, 2)], { type: "application/json" }),
  );
}

export function exportSceneSvg(scene: SceneGraph): void {
  download(
    `${scene.name}.svg`,
    new Blob([sceneToSvg(scene)], { type: "image/svg+xml" }),
  );
}

export async function importSceneFile(file: File): Promise<SceneGraph> {
  const text = await file.text();
  const parsed: unknown = JSON.parse(text);
  if (!isSceneGraph(parsed)) {
    throw new Error("not a valid .palmos.json scene");
  }
  return normalizeScene(parsed);
}
