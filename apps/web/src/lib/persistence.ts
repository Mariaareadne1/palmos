import type { SceneGraph } from "@/types/scene";
import { useAppStore } from "@/state/store";
import { sceneToSvg } from "@/lib/svg";

const STORAGE_KEY = "palmos:scene";
const AUTOSAVE_DEBOUNCE_MS = 500;

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

export function loadLocalScene(): SceneGraph | null {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    const parsed: unknown = JSON.parse(raw);
    return isSceneGraph(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

export function saveLocalScene(scene: SceneGraph): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(scene));
  } catch {
    // quota errors etc. — autosave is best-effort
  }
}

/**
 * Hydrate from localStorage, then start the debounced autosave
 * subscription. Called once on the client (AppShell effect); subscribing
 * only after hydration means the empty boot scene never clobbers a save.
 */
export function initLocalPersistence(): () => void {
  const saved = loadLocalScene();
  if (saved) useAppStore.getState().setScene(saved);

  let timer: ReturnType<typeof setTimeout> | null = null;
  const unsubscribe = useAppStore.subscribe((state, prev) => {
    if (state.scene === prev.scene) return;
    if (timer) clearTimeout(timer);
    timer = setTimeout(() => saveLocalScene(state.scene), AUTOSAVE_DEBOUNCE_MS);
  });
  return () => {
    if (timer) clearTimeout(timer);
    unsubscribe();
  };
}

// ---------- file export / import ----------

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
