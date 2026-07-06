"use client";

import { useState } from "react";
import type { Layer } from "@/types/scene";
import { useAppStore } from "@/state/store";
import { patchLayer, reorderLayer } from "@/state/commands";
import { findParentId, indexInParent, isGroup } from "@/lib/layers";

function fillOf(layer: Layer): string | null {
  if (layer.type === "path") return layer.fill;
  if (layer.type === "text") return layer.fill;
  return null;
}

interface RowProps {
  layer: Layer;
  depth: number;
}

function LayerRow({ layer, depth }: RowProps) {
  const selected = useAppStore((s) => s.selectedLayerIds);
  const setSelected = useAppStore((s) => s.setSelected);
  const dispatch = useAppStore((s) => s.dispatch);
  const [renaming, setRenaming] = useState(false);
  const [draft, setDraft] = useState(layer.name);
  const [dropTarget, setDropTarget] = useState(false);

  const isSelected = selected.includes(layer.id);
  const chip = fillOf(layer);

  const commitRename = () => {
    setRenaming(false);
    const name = draft.trim();
    if (name && name !== layer.name) {
      dispatch(patchLayer(layer.id, { name }, "rename"));
    } else {
      setDraft(layer.name);
    }
  };

  return (
    <>
      <div
        draggable={!renaming}
        onDragStart={(e) => {
          e.dataTransfer.setData("text/palmos-layer", layer.id);
          e.dataTransfer.effectAllowed = "move";
        }}
        onDragOver={(e) => {
          if (e.dataTransfer.types.includes("text/palmos-layer")) {
            e.preventDefault();
            setDropTarget(true);
          }
        }}
        onDragLeave={() => setDropTarget(false)}
        onDrop={(e) => {
          e.preventDefault();
          setDropTarget(false);
          const dragId = e.dataTransfer.getData("text/palmos-layer");
          if (!dragId || dragId === layer.id) return;
          const state = useAppStore.getState();
          const dragParent = findParentId(state.scene.layers, dragId);
          const targetParent = findParentId(state.scene.layers, layer.id);
          // reorder within the same parent only (keeps semantics obvious)
          if (dragParent === undefined || dragParent !== targetParent) return;
          // dropping ON a row inserts ABOVE it visually = after it in
          // graph order (list is reversed)
          const targetIndex = indexInParent(state.scene, layer.id) + 1;
          state.dispatch(reorderLayer(dragId, targetParent ?? null, targetIndex));
        }}
        onClick={(e) => {
          if (e.shiftKey) {
            setSelected(
              isSelected
                ? selected.filter((s) => s !== layer.id)
                : [...selected, layer.id],
            );
          } else {
            setSelected([layer.id]);
          }
        }}
        className={`group flex h-7 cursor-default items-center gap-1.5 border-t px-2 text-xs ${
          dropTarget ? "border-accent" : "border-transparent"
        } ${isSelected ? "bg-ink text-paper" : "hover:bg-paper-warm"}`}
        style={{ paddingLeft: 8 + depth * 14 }}
      >
        <button
          title={layer.visible ? "hide" : "show"}
          onClick={(e) => {
            e.stopPropagation();
            dispatch(
              patchLayer(layer.id, { visible: !layer.visible }, "visibility"),
            );
          }}
          className={`w-4 shrink-0 text-center ${
            layer.visible
              ? isSelected
                ? "text-paper"
                : "text-ink-faint opacity-0 group-hover:opacity-100"
              : "text-accent opacity-100"
          }`}
        >
          {layer.visible ? "●" : "○"}
        </button>
        <button
          title={layer.locked ? "unlock" : "lock"}
          onClick={(e) => {
            e.stopPropagation();
            dispatch(patchLayer(layer.id, { locked: !layer.locked }, "lock"));
          }}
          className={`w-4 shrink-0 text-center ${
            layer.locked
              ? "opacity-100"
              : "opacity-0 group-hover:opacity-100"
          } ${isSelected ? "text-paper" : "text-ink-faint"}`}
        >
          {layer.locked ? "▪" : "▫"}
        </button>
        {chip ? (
          <span
            className="h-3 w-3 shrink-0 border border-hairline-soft"
            style={{ background: chip }}
          />
        ) : (
          <span className="h-3 w-3 shrink-0 border border-hairline-soft bg-paper" />
        )}
        {renaming ? (
          <input
            autoFocus
            className="field h-5 flex-1 bg-paper text-xs text-ink"
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            onBlur={commitRename}
            onKeyDown={(e) => {
              if (e.key === "Enter") commitRename();
              if (e.key === "Escape") {
                setDraft(layer.name);
                setRenaming(false);
              }
            }}
            onClick={(e) => e.stopPropagation()}
          />
        ) : (
          <span
            className="flex-1 truncate"
            onDoubleClick={(e) => {
              e.stopPropagation();
              setDraft(layer.name);
              setRenaming(true);
            }}
          >
            {isGroup(layer) ? `▸ ${layer.name}` : layer.name}
          </span>
        )}
      </div>
      {isGroup(layer) &&
        [...layer.children]
          .reverse()
          .map((child) => (
            <LayerRow key={child.id} layer={child} depth={depth + 1} />
          ))}
    </>
  );
}

/**
 * Left panel. Graph order is bottom-to-top; the list shows top-to-bottom,
 * so the array is reversed — top of list = frontmost.
 */
export default function LayersPanel() {
  const layers = useAppStore((s) => s.scene.layers);

  return (
    <aside className="flex w-panel-l flex-col border-r border-hairline bg-paper">
      <div className="border-b border-hairline-soft px-3 py-2 text-xs text-ink-faint">
        layers
      </div>
      {layers.length === 0 ? (
        <div className="graph-paper m-3 flex flex-1 items-start justify-center border border-hairline-soft p-6">
          <p className="mt-10 max-w-[160px] text-center text-xs text-ink-faint">
            nothing here yet — draw a shape or import a design
          </p>
        </div>
      ) : (
        <div className="flex-1 overflow-y-auto py-1">
          {[...layers].reverse().map((layer) => (
            <LayerRow key={layer.id} layer={layer} depth={0} />
          ))}
        </div>
      )}
    </aside>
  );
}
