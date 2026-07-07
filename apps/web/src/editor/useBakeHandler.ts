"use client";

import { useEffect } from "react";
import { nanoid } from "nanoid";
import type Konva from "konva";
import type { GroupLayer, Layer } from "@/types/scene";
import { useAppStore } from "@/state/store";
import { addLayers, batch, patchLayer } from "@/state/commands";
import { findLayer, findParentId, indexInParent } from "@/lib/layers";
import { bakePool } from "@/effects/bake/pool";
import { onBakeRequest } from "@/effects/bake/bakeBus";
import type { RasterSource } from "@/effects/bake/types";

/**
 * Handles "bake to layers" (SPEC2 §9.2): rasterize the source layer via
 * the Konva stage, run the bake in the shared worker pool, and insert the
 * result as an editable group above the source — whose visibility is
 * toggled off, never deleted.
 */
export function useBakeHandler(
  stageRef: React.RefObject<Konva.Stage | null>,
): void {
  const dispatch = useAppStore((s) => s.dispatch);
  const setSelected = useAppStore((s) => s.setSelected);

  useEffect(
    () =>
      onBakeRequest(async ({ layerId, kind, params, seed }) => {
        const stage = stageRef.current;
        if (!stage) return;
        const state = useAppStore.getState();
        const layer = findLayer(state.scene.layers, layerId);
        if (!layer) return;

        const node = stage.findOne(`#${layerId}:inner`) as
          | Konva.Node
          | undefined;
        if (!node) return;

        // rasterize at native resolution → ImageData for the worker
        const canvas = node.toCanvas({ pixelRatio: 1 });
        const ctx = canvas.getContext("2d");
        if (!ctx || canvas.width < 1 || canvas.height < 1) return;
        const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height);
        const source: RasterSource = {
          width: canvas.width,
          height: canvas.height,
          data: imageData.data,
        };

        try {
          const result = await bakePool.run({
            jobId: nanoid(),
            kind,
            params,
            seed,
            source,
          });
          if (!result.layers.length) return;

          // position the baked group at the source layer's transform
          const group: GroupLayer = {
            id: nanoid(),
            name: `${kind} of ${layer.name}`,
            type: "group",
            transform: { ...layer.transform },
            opacity: 1,
            visible: true,
            locked: false,
            effects: [],
            sourceGenerator: kind,
            children: result.layers as Layer[],
          };

          const parentId = findParentId(state.scene.layers, layerId) ?? null;
          const index = indexInParent(state.scene, layerId) + 1;
          dispatch(
            batch(
              [
                addLayers([{ layer: group, parentId, index }], `bake ${kind}`),
                // baking never deletes the source — just hides it
                patchLayer(layerId, { visible: false }, "hide source"),
              ],
              `bake ${kind}`,
            ),
          );
          setSelected([group.id]);
        } catch (err) {
          // surfaced by the effects tab's error console in a later step;
          // for now, log so a hung/failed bake is visible in devtools
          console.warn("[palmos] bake failed:", err);
        }
      }),
    [stageRef, dispatch, setSelected],
  );
}
