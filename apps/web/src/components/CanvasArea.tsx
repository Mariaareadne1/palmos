"use client";

import dynamic from "next/dynamic";
import { useCallback, useEffect, useRef, useState } from "react";
import { useAppStore } from "@/state/store";
import { importSceneFile } from "@/lib/scene-io";
import { reconstructImage, type JobUpdate } from "@/lib/reconstruct";
import { onImportImage } from "@/lib/importBus";
import Toolbar from "@/editor/Toolbar";

// Konva touches `window` — client-only.
const EditorCanvas = dynamic(() => import("@/editor/EditorCanvas"), {
  ssr: false,
});

interface ReconState {
  phase: "idle" | "running" | "done" | "error";
  stage?: JobUpdate["stage"];
  progress: number;
  message?: string;
}

/**
 * Center region: konva stage + tool strip. Accepts .palmos.json drops
 * anywhere, image drops/picks for reconstruction (dropzone shows on the
 * empty-canvas state per SPEC §5 step 6).
 */
export default function CanvasArea() {
  const setScene = useAppStore((s) => s.setScene);
  const isEmpty = useAppStore((s) => s.scene.layers.length === 0);
  const [dropping, setDropping] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [recon, setRecon] = useState<ReconState>({ phase: "idle", progress: 0 });
  const imageRef = useRef<HTMLInputElement>(null);

  const runReconstruction = useCallback(
    async (file: File) => {
      setRecon({ phase: "running", progress: 0, stage: "segmenting" });
      try {
        const { scene, engine } = await reconstructImage(file, (u) =>
          setRecon({
            phase: "running",
            progress: u.progress,
            stage: u.stage,
          }),
        );
        setScene(scene);
        setRecon({
          phase: "done",
          progress: 1,
          message: `reconstructed via ${engine} — ${scene.layers.length} layers`,
        });
        setTimeout(() => setRecon({ phase: "idle", progress: 0 }), 5000);
      } catch (err) {
        setRecon({
          phase: "error",
          progress: 0,
          message: err instanceof Error ? err.message : "reconstruction failed",
        });
      }
    },
    [setScene],
  );

  // top-bar `import` also accepts images — route them here
  useEffect(
    () => onImportImage((file) => void runReconstruction(file)),
    [runReconstruction],
  );

  const handleFile = useCallback(
    async (file: File) => {
      if (file.type.startsWith("image/")) {
        await runReconstruction(file);
        return;
      }
      if (file.name.endsWith(".json")) {
        try {
          setScene(await importSceneFile(file));
          setError(null);
        } catch (err) {
          setError(err instanceof Error ? err.message : "import failed");
          setTimeout(() => setError(null), 4000);
        }
      }
    },
    [runReconstruction, setScene],
  );

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
      onDrop={(e) => {
        e.preventDefault();
        setDropping(false);
        const file = e.dataTransfer.files[0];
        if (file) void handleFile(file);
      }}
    >
      <EditorCanvas />
      <Toolbar />

      <input
        ref={imageRef}
        type="file"
        accept="image/png,image/jpeg"
        className="hidden"
        onChange={(e) => {
          const file = e.target.files?.[0];
          e.target.value = "";
          if (file) void runReconstruction(file);
        }}
      />

      {/* empty-canvas state: the reconstruction dropzone */}
      {isEmpty && recon.phase === "idle" && (
        <div className="pointer-events-none absolute inset-0 flex items-center justify-center">
          <button
            onClick={() => imageRef.current?.click()}
            className="graph-paper pointer-events-auto flex h-56 w-96 flex-col items-center justify-center gap-3 border border-hairline bg-paper/85 hover:border-accent"
          >
            <span className="text-sm">drop a screenshot here</span>
            <span className="max-w-56 text-xs text-ink-faint">
              a flat graphic design becomes editable, audio-reactive layers
              in ~30 seconds
            </span>
            <span className="border border-hairline px-3 py-1 text-xs">
              choose image
            </span>
          </button>
        </div>
      )}

      {recon.phase === "running" && (
        <div className="absolute bottom-6 left-1/2 z-20 w-72 -translate-x-1/2 border border-hairline bg-paper p-3">
          <div className="mb-2 flex justify-between text-xs">
            <span>{recon.stage ?? "uploading"}…</span>
            <span className="text-ink-faint">
              {Math.round(recon.progress * 100)}%
            </span>
          </div>
          <div className="h-1 w-full border border-hairline-soft">
            <div
              className="h-full bg-accent transition-[width] duration-300"
              style={{ width: `${recon.progress * 100}%` }}
            />
          </div>
        </div>
      )}

      {recon.phase === "done" && recon.message && (
        <div className="absolute bottom-6 left-1/2 z-20 -translate-x-1/2 border border-hairline bg-paper px-3 py-1.5 text-xs">
          {recon.message}
        </div>
      )}

      {recon.phase === "error" && (
        <div className="absolute bottom-6 left-1/2 z-20 w-96 -translate-x-1/2 border border-accent bg-paper p-3">
          <p className="text-xs text-accent">{recon.message}</p>
          <button
            className="mt-2 border border-hairline px-2 py-0.5 text-xs hover:bg-ink hover:text-paper"
            onClick={() => setRecon({ phase: "idle", progress: 0 })}
          >
            dismiss
          </button>
        </div>
      )}

      {dropping && (
        <div className="pointer-events-none absolute inset-3 z-20 flex items-center justify-center border border-accent bg-paper/80">
          <span className="text-xs text-accent">
            drop an image to reconstruct · drop .palmos.json to load
          </span>
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
