import type { SceneGraph } from "@/types/scene";
import { sceneToSvg } from "@/lib/svg";

/** Minimal structural validation for imported/loaded graphs. */
export function isSceneGraph(value: unknown): value is SceneGraph {
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
    s.version === 1
  );
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
  return parsed;
}
