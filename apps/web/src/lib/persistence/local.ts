import type { SceneGraph } from "@/types/scene";
import { isSceneGraph } from "@/lib/scene-io";
import type { PersistenceAdapter } from "./types";

export const STORAGE_KEY = "palmos:scene";

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

export class LocalAdapter implements PersistenceAdapter {
  readonly kind = "local" as const;

  async init(): Promise<SceneGraph | null> {
    return loadLocalScene();
  }

  async save(scene: SceneGraph): Promise<void> {
    saveLocalScene(scene);
  }
}
