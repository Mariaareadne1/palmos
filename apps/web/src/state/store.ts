import { create } from "zustand";
import type { SceneGraph } from "@/types/scene";
import type { Command } from "@/state/commands";
import { createEmptyScene } from "@/lib/scene";

export type Mode = "edit" | "perform";
export type Tool = "select" | "rect" | "ellipse" | "text";

export interface Viewport {
  x: number;
  y: number;
  scale: number;
}

const UNDO_CAP = 100;

interface AppState {
  scene: SceneGraph;
  selectedLayerIds: string[];
  mode: Mode;
  tool: Tool;
  viewport: Viewport;
  undoStack: Command[];
  redoStack: Command[];

  /** The only mutation path for the scene graph (SPEC §0 rule 3). */
  dispatch: (command: Command) => void;
  undo: () => void;
  redo: () => void;

  /** Replace the whole graph (load/import/reconstruction) — clears history. */
  setScene: (scene: SceneGraph) => void;
  setMode: (mode: Mode) => void;
  setTool: (tool: Tool) => void;
  setSelected: (ids: string[]) => void;
  setViewport: (viewport: Viewport) => void;
}

export const useAppStore = create<AppState>((set) => ({
  scene: createEmptyScene(),
  selectedLayerIds: [],
  mode: "edit",
  tool: "select",
  viewport: { x: 0, y: 0, scale: 1 },
  undoStack: [],
  redoStack: [],

  dispatch: (command) =>
    set((s) => ({
      scene: command.apply(s.scene),
      undoStack: [...s.undoStack.slice(-(UNDO_CAP - 1)), command],
      redoStack: [],
    })),

  undo: () =>
    set((s) => {
      const command = s.undoStack[s.undoStack.length - 1];
      if (!command) return s;
      return {
        scene: command.revert(s.scene),
        undoStack: s.undoStack.slice(0, -1),
        redoStack: [...s.redoStack, command],
      };
    }),

  redo: () =>
    set((s) => {
      const command = s.redoStack[s.redoStack.length - 1];
      if (!command) return s;
      return {
        scene: command.apply(s.scene),
        undoStack: [...s.undoStack, command],
        redoStack: s.redoStack.slice(0, -1),
      };
    }),

  setScene: (scene) =>
    set({ scene, selectedLayerIds: [], undoStack: [], redoStack: [] }),
  setMode: (mode) => set({ mode }),
  setTool: (tool) => set({ tool }),
  setSelected: (selectedLayerIds) => set({ selectedLayerIds }),
  setViewport: (viewport) => set({ viewport }),
}));
