import type { GroupLayer, Layer, SceneGraph } from "@/types/scene";

/**
 * Immutable tree utilities for the scene graph. Every function returns
 * new objects along the mutated path and shares everything else, so
 * commands stay cheap and React re-renders stay narrow.
 */

export function isGroup(layer: Layer): layer is GroupLayer {
  return layer.type === "group";
}

export function findLayer(layers: Layer[], id: string): Layer | null {
  for (const layer of layers) {
    if (layer.id === id) return layer;
    if (isGroup(layer)) {
      const hit = findLayer(layer.children, id);
      if (hit) return hit;
    }
  }
  return null;
}

/** Parent group id (`null` = scene root), or undefined if id not found. */
export function findParentId(
  layers: Layer[],
  id: string,
  parentId: string | null = null,
): string | null | undefined {
  for (const layer of layers) {
    if (layer.id === id) return parentId;
    if (isGroup(layer)) {
      const hit = findParentId(layer.children, id, layer.id);
      if (hit !== undefined) return hit;
    }
  }
  return undefined;
}

/** Map over the tree, replacing the layer with matching id. */
export function updateLayer(
  layers: Layer[],
  id: string,
  fn: (layer: Layer) => Layer,
): Layer[] {
  return layers.map((layer) => {
    if (layer.id === id) return fn(layer);
    if (isGroup(layer)) {
      const children = updateLayer(layer.children, id, fn);
      if (children !== layer.children) return { ...layer, children };
    }
    return layer;
  });
}

export function removeLayers(layers: Layer[], ids: Set<string>): Layer[] {
  const out: Layer[] = [];
  for (const layer of layers) {
    if (ids.has(layer.id)) continue;
    if (isGroup(layer)) {
      const children = removeLayers(layer.children, ids);
      out.push(children === layer.children ? layer : { ...layer, children });
    } else {
      out.push(layer);
    }
  }
  return out;
}

/** Insert at index under parentId (null = root). Index clamps. */
export function insertLayer(
  layers: Layer[],
  layer: Layer,
  parentId: string | null,
  index: number,
): Layer[] {
  if (parentId === null) {
    const i = Math.max(0, Math.min(index, layers.length));
    return [...layers.slice(0, i), layer, ...layers.slice(i)];
  }
  return updateLayer(layers, parentId, (parent) => {
    if (!isGroup(parent)) return parent;
    const i = Math.max(0, Math.min(index, parent.children.length));
    return {
      ...parent,
      children: [
        ...parent.children.slice(0, i),
        layer,
        ...parent.children.slice(i),
      ],
    };
  });
}

/** Index of layer within its parent's children array. */
export function indexInParent(scene: SceneGraph, id: string): number {
  const parentId = findParentId(scene.layers, id);
  if (parentId === undefined) return -1;
  const siblings =
    parentId === null
      ? scene.layers
      : (findLayer(scene.layers, parentId) as GroupLayer).children;
  return siblings.findIndex((l) => l.id === id);
}

/** Depth-first flatten (parents before children), with depth. */
export function flattenLayers(
  layers: Layer[],
  depth = 0,
): { layer: Layer; depth: number }[] {
  const out: { layer: Layer; depth: number }[] = [];
  for (const layer of layers) {
    out.push({ layer, depth });
    if (isGroup(layer)) out.push(...flattenLayers(layer.children, depth + 1));
  }
  return out;
}

/** Deep-clone a layer with fresh ids (for duplicate). */
export function cloneWithNewIds(
  layer: Layer,
  makeId: () => string,
): Layer {
  const base = { ...layer, id: makeId(), name: `${layer.name} copy` };
  if (isGroup(layer)) {
    return {
      ...(base as GroupLayer),
      children: layer.children.map((c) => cloneWithNewIds(c, makeId)),
    };
  }
  return base as Layer;
}
