import { create } from "zustand";
import type { SceneGraph } from "@/types/scene";
import { createEmptyScene } from "@/lib/scene";

export type Mode = "edit" | "perform";

interface AppState {
  scene: SceneGraph;
  selectedLayerIds: string[];
  mode: Mode;
  setScene: (scene: SceneGraph) => void;
  setSceneName: (name: string) => void;
  setMode: (mode: Mode) => void;
  setSelected: (ids: string[]) => void;
}

/**
 * The scene graph here is the single source of truth (SPEC §0 rule 3).
 * Edit mode mutates it (via the command layer), perform mode reads it,
 * reconstruction results replace it. Nothing else describes a design.
 */
export const useAppStore = create<AppState>((set) => ({
  scene: createEmptyScene(),
  selectedLayerIds: [],
  mode: "edit",
  setScene: (scene) => set({ scene, selectedLayerIds: [] }),
  setSceneName: (name) =>
    set((s) => ({ scene: { ...s.scene, name } })),
  setMode: (mode) => set({ mode }),
  setSelected: (selectedLayerIds) => set({ selectedLayerIds }),
}));
