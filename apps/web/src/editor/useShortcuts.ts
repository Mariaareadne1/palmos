"use client";

import { useEffect } from "react";
import { nanoid } from "nanoid";
import { useAppStore } from "@/state/store";
import {
  addLayers,
  batch,
  deleteLayers,
  groupLayers,
  patchLayer,
  ungroupLayer,
} from "@/state/commands";
import { cloneWithNewIds, findLayer, isGroup } from "@/lib/layers";

function inTextInput(e: KeyboardEvent): boolean {
  const t = e.target as HTMLElement;
  return (
    t.tagName === "INPUT" || t.tagName === "TEXTAREA" || t.isContentEditable
  );
}

/** Global editor shortcuts (SPEC §5 step 2). Active in edit mode only. */
export function useShortcuts(): void {
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      const s = useAppStore.getState();
      if (s.mode !== "edit") return;
      if (inTextInput(e)) return;
      const meta = e.metaKey || e.ctrlKey;
      const key = e.key.toLowerCase();

      // undo / redo
      if (meta && key === "z") {
        e.preventDefault();
        if (e.shiftKey) s.redo();
        else s.undo();
        return;
      }
      // select all (top-level)
      if (meta && key === "a") {
        e.preventDefault();
        s.setSelected(s.scene.layers.filter((l) => !l.locked).map((l) => l.id));
        return;
      }
      // duplicate
      if (meta && key === "d") {
        e.preventDefault();
        if (!s.selectedLayerIds.length) return;
        const placements = s.selectedLayerIds.flatMap((id) => {
          const layer = findLayer(s.scene.layers, id);
          if (!layer) return [];
          const copy = cloneWithNewIds(layer, nanoid);
          copy.transform = {
            ...copy.transform,
            x: copy.transform.x + 10,
            y: copy.transform.y + 10,
          };
          return [{ layer: copy, parentId: null, index: s.scene.layers.length }];
        });
        if (placements.length) {
          s.dispatch(addLayers(placements, "duplicate"));
          s.setSelected(placements.map((p) => p.layer.id));
        }
        return;
      }
      // group / ungroup
      if (meta && key === "g") {
        e.preventDefault();
        if (e.shiftKey) {
          const groups = s.selectedLayerIds.filter((id) => {
            const l = findLayer(s.scene.layers, id);
            return l && isGroup(l);
          });
          if (groups.length) {
            const first = groups[0];
            const group = findLayer(s.scene.layers, first);
            const childIds =
              group && isGroup(group) ? group.children.map((c) => c.id) : [];
            s.dispatch(
              batch(groups.map((id) => ungroupLayer(id)), "ungroup"),
            );
            s.setSelected(childIds);
          }
        } else if (s.selectedLayerIds.length >= 2) {
          const cmd = groupLayers(s.selectedLayerIds, nanoid);
          s.dispatch(cmd);
          // the new group is the one layer whose id wasn't there before
          const after = useAppStore.getState().scene.layers;
          const created = after.find(
            (l) => isGroup(l) && l.children.some((c) => s.selectedLayerIds.includes(c.id)),
          );
          if (created) s.setSelected([created.id]);
        }
        return;
      }
      if (meta) return;

      // delete
      if (key === "delete" || key === "backspace") {
        e.preventDefault();
        if (s.selectedLayerIds.length) {
          s.dispatch(deleteLayers(s.selectedLayerIds));
          s.setSelected([]);
        }
        return;
      }
      // deselect
      if (key === "escape") {
        s.setSelected([]);
        return;
      }
      // nudge
      if (["arrowup", "arrowdown", "arrowleft", "arrowright"].includes(key)) {
        if (!s.selectedLayerIds.length) return;
        e.preventDefault();
        const step = e.shiftKey ? 10 : 1;
        const dx = key === "arrowleft" ? -step : key === "arrowright" ? step : 0;
        const dy = key === "arrowup" ? -step : key === "arrowdown" ? step : 0;
        const commands = s.selectedLayerIds.flatMap((id) => {
          const layer = findLayer(s.scene.layers, id);
          if (!layer || layer.locked) return [];
          return [
            patchLayer(id, {
              transform: {
                ...layer.transform,
                x: layer.transform.x + dx,
                y: layer.transform.y + dy,
              },
            }),
          ];
        });
        if (commands.length) s.dispatch(batch(commands, "nudge"));
        return;
      }
      // tools
      if (key === "v") s.setTool("select");
      else if (key === "r") s.setTool("rect");
      else if (key === "o") s.setTool("ellipse");
      else if (key === "t") s.setTool("text");
    };

    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, []);
}
