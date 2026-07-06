import { nanoid } from "nanoid";
import type { SceneGraph } from "@/types/scene";

/** Default artboard: portrait poster proportions. */
export function createEmptyScene(): SceneGraph {
  return {
    id: nanoid(),
    name: "untitled",
    width: 800,
    height: 1000,
    background: "#ffffff",
    layers: [],
    routings: [],
    palette: ["#0a0a0a", "#ffffff", "#ff5c1f"],
    version: 1,
  };
}
