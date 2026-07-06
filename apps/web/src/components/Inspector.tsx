"use client";

import { useState } from "react";
import { useAppStore } from "@/state/store";

type Tab = "properties" | "motion";

/**
 * Right panel: context-sensitive inspector. `properties` edits the
 * selected layer (Step 2), `motion` edits its audio routings (Step 4).
 */
export default function Inspector() {
  const [tab, setTab] = useState<Tab>("properties");
  const selected = useAppStore((s) => s.selectedLayerIds);
  const scene = useAppStore((s) => s.scene);

  return (
    <aside className="flex w-panel-r flex-col border-l border-hairline bg-paper">
      <div className="flex border-b border-hairline-soft">
        {(["properties", "motion"] as const).map((t) => (
          <button
            key={t}
            onClick={() => setTab(t)}
            className={`px-3 py-2 text-xs ${
              tab === t
                ? "border-b border-ink text-ink"
                : "text-ink-faint hover:text-ink"
            }`}
          >
            {t}
          </button>
        ))}
      </div>
      <div className="flex-1 overflow-y-auto p-3">
        {selected.length === 0 ? (
          <div className="mt-10 text-center text-xs text-ink-faint">
            {tab === "properties" ? "no selection" : "select a layer to route motion"}
          </div>
        ) : (
          <div className="text-xs text-ink-faint">
            {selected.length} selected
          </div>
        )}
      </div>
      <div className="border-t border-hairline-soft px-3 py-2 text-xs text-ink-faint">
        {scene.width} × {scene.height}
      </div>
    </aside>
  );
}
