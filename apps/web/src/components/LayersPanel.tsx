"use client";

import { useAppStore } from "@/state/store";

/**
 * Left panel: layers, top of list = frontmost (reverse of graph order).
 * Rows get visibility/lock/reorder in Step 2 — this renders real graph
 * state from day one.
 */
export default function LayersPanel() {
  const layers = useAppStore((s) => s.scene.layers);
  const selected = useAppStore((s) => s.selectedLayerIds);
  const setSelected = useAppStore((s) => s.setSelected);

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
        <ul className="flex-1 overflow-y-auto py-1">
          {[...layers].reverse().map((layer) => (
            <li key={layer.id}>
              <button
                onClick={() => setSelected([layer.id])}
                className={`block w-full px-3 py-1.5 text-left text-xs ${
                  selected.includes(layer.id)
                    ? "bg-ink text-paper"
                    : "hover:bg-paper-warm"
                }`}
              >
                {layer.name}
              </button>
            </li>
          ))}
        </ul>
      )}
    </aside>
  );
}
