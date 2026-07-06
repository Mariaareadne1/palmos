"use client";

import dynamic from "next/dynamic";
import { useState } from "react";
import { useAppStore } from "@/state/store";
import { importSceneFile } from "@/lib/persistence";
import Toolbar from "@/editor/Toolbar";

// Konva touches `window` — client-only.
const EditorCanvas = dynamic(() => import("@/editor/EditorCanvas"), {
  ssr: false,
});

/** Center region: konva stage + tool strip; accepts .palmos.json drops. */
export default function CanvasArea() {
  const setScene = useAppStore((s) => s.setScene);
  const [dropping, setDropping] = useState(false);
  const [error, setError] = useState<string | null>(null);

  return (
    <main
      className="relative flex-1 overflow-hidden"
      onDragOver={(e) => {
        if ([...e.dataTransfer.items].some((i) => i.kind === "file")) {
          e.preventDefault();
          setDropping(true);
        }
      }}
      onDragLeave={() => setDropping(false)}
      onDrop={async (e) => {
        e.preventDefault();
        setDropping(false);
        const file = e.dataTransfer.files[0];
        if (!file || !file.name.endsWith(".json")) return;
        try {
          setScene(await importSceneFile(file));
          setError(null);
        } catch (err) {
          setError(err instanceof Error ? err.message : "import failed");
          setTimeout(() => setError(null), 4000);
        }
      }}
    >
      <EditorCanvas />
      <Toolbar />
      {dropping && (
        <div className="pointer-events-none absolute inset-3 z-20 flex items-center justify-center border border-accent bg-paper/80">
          <span className="text-xs text-accent">drop .palmos.json to load</span>
        </div>
      )}
      {error && (
        <div className="absolute bottom-3 left-1/2 z-20 -translate-x-1/2 border border-accent bg-paper px-3 py-1.5 text-xs text-accent">
          {error}
        </div>
      )}
    </main>
  );
}
