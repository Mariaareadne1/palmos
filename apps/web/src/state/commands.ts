import type { GroupLayer, Layer, SceneGraph } from "@/types/scene";
import {
  findLayer,
  findParentId,
  indexInParent,
  insertLayer,
  isGroup,
  removeLayers,
  updateLayer,
} from "@/lib/layers";

/**
 * The command layer — the only way the scene graph mutates (SPEC §0
 * rule 3 / §5 step 2). Commands are pure: apply/revert take a scene and
 * return a new one, so they are trivially unit-testable and the undo
 * stack is just an array of these.
 */
export interface Command {
  label: string;
  apply(scene: SceneGraph): SceneGraph;
  revert(scene: SceneGraph): SceneGraph;
}

// ---------- generic layer patch (rename, style, transform, text…) ----------

type LayerPatch = Partial<Layer>;

/**
 * Patch any properties of a layer, capturing the previous values of
 * exactly the patched keys on first apply. Covers rename, set-style,
 * set-transform, set-text, visibility and lock.
 */
export function patchLayer(
  id: string,
  patch: LayerPatch,
  label = "edit layer",
): Command {
  let prev: LayerPatch | null = null;
  return {
    label,
    apply(scene) {
      return {
        ...scene,
        layers: updateLayer(scene.layers, id, (layer) => {
          if (prev === null) {
            prev = {};
            for (const key of Object.keys(patch) as (keyof Layer)[]) {
              (prev as Record<string, unknown>)[key] = layer[key];
            }
          }
          return { ...layer, ...patch } as Layer;
        }),
      };
    },
    revert(scene) {
      if (prev === null) return scene;
      return {
        ...scene,
        layers: updateLayer(
          scene.layers,
          id,
          (layer) => ({ ...layer, ...prev }) as Layer,
        ),
      };
    },
  };
}

// ---------- scene-level patch (name, background, palette, size) ----------

type ScenePatch = Partial<
  Pick<SceneGraph, "name" | "background" | "palette" | "width" | "height">
>;

export function patchScene(patch: ScenePatch, label = "edit scene"): Command {
  let prev: ScenePatch | null = null;
  return {
    label,
    apply(scene) {
      if (prev === null) {
        prev = {};
        for (const key of Object.keys(patch) as (keyof ScenePatch)[]) {
          (prev as Record<string, unknown>)[key] = scene[key];
        }
      }
      return { ...scene, ...patch };
    },
    revert(scene) {
      return prev === null ? scene : { ...scene, ...prev };
    },
  };
}

// ---------- add / delete ----------

export interface LayerPlacement {
  layer: Layer;
  parentId: string | null;
  index: number;
}

export function addLayers(
  placements: LayerPlacement[],
  label = "add layer",
): Command {
  return {
    label,
    apply(scene) {
      let layers = scene.layers;
      for (const p of placements) {
        layers = insertLayer(layers, p.layer, p.parentId, p.index);
      }
      return { ...scene, layers };
    },
    revert(scene) {
      const ids = new Set(placements.map((p) => p.layer.id));
      return { ...scene, layers: removeLayers(scene.layers, ids) };
    },
  };
}

export function deleteLayers(ids: string[], label = "delete"): Command {
  let removed: LayerPlacement[] | null = null;
  let savedRoutings: SceneGraph["routings"] | null = null;
  return {
    label,
    apply(scene) {
      // Capture placements (parent + index) so revert restores exactly.
      removed = ids
        .map((id) => {
          const layer = findLayer(scene.layers, id);
          const parentId = findParentId(scene.layers, id);
          if (!layer || parentId === undefined) return null;
          return { layer, parentId, index: indexInParent(scene, id) };
        })
        .filter((p): p is LayerPlacement => p !== null);
      // Routings pointing at deleted layers go too — and come back on revert.
      savedRoutings = scene.routings.filter((r) => ids.includes(r.layerId));
      return {
        ...scene,
        layers: removeLayers(scene.layers, new Set(ids)),
        routings: scene.routings.filter((r) => !ids.includes(r.layerId)),
      };
    },
    revert(scene) {
      if (!removed) return scene;
      let layers = scene.layers;
      for (const p of removed) {
        layers = insertLayer(layers, p.layer, p.parentId, p.index);
      }
      return {
        ...scene,
        layers,
        routings: savedRoutings
          ? [...scene.routings, ...savedRoutings]
          : scene.routings,
      };
    },
  };
}

// ---------- reorder ----------

export function reorderLayer(
  id: string,
  toParentId: string | null,
  toIndex: number,
  label = "reorder",
): Command {
  let from: { parentId: string | null; index: number } | null = null;
  return {
    label,
    apply(scene) {
      const layer = findLayer(scene.layers, id);
      const parentId = findParentId(scene.layers, id);
      if (!layer || parentId === undefined) return scene;
      from = { parentId, index: indexInParent(scene, id) };
      let layers = removeLayers(scene.layers, new Set([id]));
      // Removing from the same parent before the target index shifts it.
      let index = toIndex;
      if (parentId === toParentId && from.index < toIndex) index -= 1;
      layers = insertLayer(layers, layer, toParentId, index);
      return { ...scene, layers };
    },
    revert(scene) {
      if (!from) return scene;
      const layer = findLayer(scene.layers, id);
      if (!layer) return scene;
      let layers = removeLayers(scene.layers, new Set([id]));
      layers = insertLayer(layers, layer, from.parentId, from.index);
      return { ...scene, layers };
    },
  };
}

// ---------- group / ungroup ----------

export function groupLayers(
  ids: string[],
  makeId: () => string,
  label = "group",
): Command {
  let groupId: string | null = null;
  let placements: LayerPlacement[] | null = null;
  return {
    label,
    apply(scene) {
      // Group top-level-only for predictability: all ids must share a parent.
      const parents = new Set(ids.map((id) => findParentId(scene.layers, id)));
      if (parents.size !== 1) return scene;
      const parentId = [...parents][0];
      if (parentId === undefined) return scene;

      const members = ids
        .map((id) => findLayer(scene.layers, id))
        .filter((l): l is Layer => l !== null);
      if (members.length < 2) return scene;

      placements = members.map((layer) => ({
        layer,
        parentId,
        index: indexInParent(scene, layer.id),
      }));
      // Keep graph (bottom-to-top) order inside the group.
      const ordered = [...placements].sort((a, b) => a.index - b.index);
      const insertAt = Math.min(...placements.map((p) => p.index));

      groupId = groupId ?? makeId();
      const group: GroupLayer = {
        id: groupId,
        name: "group",
        type: "group",
        transform: { x: 0, y: 0, scaleX: 1, scaleY: 1, rotation: 0 },
        opacity: 1,
        visible: true,
        locked: false,
        children: ordered.map((p) => p.layer),
      };
      let layers = removeLayers(scene.layers, new Set(ids));
      layers = insertLayer(layers, group, parentId, insertAt);
      return { ...scene, layers };
    },
    revert(scene) {
      if (!groupId || !placements) return scene;
      let layers = removeLayers(scene.layers, new Set([groupId]));
      for (const p of [...placements].sort((a, b) => a.index - b.index)) {
        layers = insertLayer(layers, p.layer, p.parentId, p.index);
      }
      return { ...scene, layers };
    },
  };
}

export function ungroupLayer(id: string, label = "ungroup"): Command {
  let saved: { group: GroupLayer; parentId: string | null; index: number } | null =
    null;
  return {
    label,
    apply(scene) {
      const layer = findLayer(scene.layers, id);
      const parentId = findParentId(scene.layers, id);
      if (!layer || !isGroup(layer) || parentId === undefined) return scene;
      saved = { group: layer, parentId, index: indexInParent(scene, id) };
      let layers = removeLayers(scene.layers, new Set([id]));
      layer.children.forEach((child, i) => {
        layers = insertLayer(layers, child, parentId, saved!.index + i);
      });
      return { ...scene, layers };
    },
    revert(scene) {
      if (!saved) return scene;
      const childIds = new Set(saved.group.children.map((c) => c.id));
      let layers = removeLayers(scene.layers, childIds);
      layers = insertLayer(layers, saved.group, saved.parentId, saved.index);
      return { ...scene, layers };
    },
  };
}

// ---------- routings (motion tab, Step 4 — lives with the graph) ----------

export function addRouting(routing: SceneGraph["routings"][number]): Command {
  return {
    label: "add motion",
    apply(scene) {
      return { ...scene, routings: [...scene.routings, routing] };
    },
    revert(scene) {
      return {
        ...scene,
        routings: scene.routings.filter((r) => r.id !== routing.id),
      };
    },
  };
}

export function patchRouting(
  id: string,
  patch: Partial<SceneGraph["routings"][number]>,
): Command {
  let prev: Partial<SceneGraph["routings"][number]> | null = null;
  return {
    label: "edit motion",
    apply(scene) {
      return {
        ...scene,
        routings: scene.routings.map((r) => {
          if (r.id !== id) return r;
          if (prev === null) {
            prev = {};
            for (const key of Object.keys(patch) as (keyof typeof patch)[]) {
              (prev as Record<string, unknown>)[key] = r[key];
            }
          }
          return { ...r, ...patch };
        }),
      };
    },
    revert(scene) {
      if (prev === null) return scene;
      return {
        ...scene,
        routings: scene.routings.map((r) =>
          r.id === id ? { ...r, ...prev } : r,
        ),
      };
    },
  };
}

export function removeRouting(id: string): Command {
  let saved: { routing: SceneGraph["routings"][number]; index: number } | null =
    null;
  return {
    label: "remove motion",
    apply(scene) {
      const index = scene.routings.findIndex((r) => r.id === id);
      if (index === -1) return scene;
      saved = { routing: scene.routings[index], index };
      return { ...scene, routings: scene.routings.filter((r) => r.id !== id) };
    },
    revert(scene) {
      if (!saved) return scene;
      const routings = [...scene.routings];
      routings.splice(saved.index, 0, saved.routing);
      return { ...scene, routings };
    },
  };
}

// ---------- batch ----------

/** Compose several commands into one undo step (multi-select edits). */
export function batch(commands: Command[], label: string): Command {
  return {
    label,
    apply(scene) {
      return commands.reduce((s, c) => c.apply(s), scene);
    },
    revert(scene) {
      return [...commands].reverse().reduce((s, c) => c.revert(s), scene);
    },
  };
}
