"use client";

import { useEffect, useRef, useState } from "react";
import { useAppStore } from "@/state/store";
import { patchScene } from "@/state/commands";
import {
  exportSceneJson,
  exportSceneSvg,
  importSceneFile,
} from "@/lib/scene-io";
import { importImage } from "@/lib/importBus";
import { stageRegistry } from "@/editor/stageRegistry";
import ProjectsMenu from "@/components/ProjectsMenu";

/** PNG at 2× scene resolution, cropped to the artboard. */
function exportPng() {
  const stage = stageRegistry.current;
  const { scene, viewport } = useAppStore.getState();
  if (!stage) return;
  const url = stage.toDataURL({
    x: viewport.x,
    y: viewport.y,
    width: scene.width * viewport.scale,
    height: scene.height * viewport.scale,
    pixelRatio: 2 / viewport.scale,
  });
  const a = document.createElement("a");
  a.href = url;
  a.download = `${scene.name}.png`;
  a.click();
}

export default function TopBar() {
  const name = useAppStore((s) => s.scene.name);
  const mode = useAppStore((s) => s.mode);
  const zoom = useAppStore((s) => s.viewport.scale);
  const canUndo = useAppStore((s) => s.undoStack.length > 0);
  const canRedo = useAppStore((s) => s.redoStack.length > 0);
  const dispatch = useAppStore((s) => s.dispatch);
  const undo = useAppStore((s) => s.undo);
  const redo = useAppStore((s) => s.redo);
  const setMode = useAppStore((s) => s.setMode);
  const setScene = useAppStore((s) => s.setScene);

  const [nameDraft, setNameDraft] = useState(name);
  useEffect(() => setNameDraft(name), [name]);

  const [exportOpen, setExportOpen] = useState(false);
  const exportRef = useRef<HTMLDivElement>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (!exportOpen) return;
    const onDown = (e: MouseEvent) => {
      if (!exportRef.current?.contains(e.target as Node)) setExportOpen(false);
    };
    window.addEventListener("mousedown", onDown);
    return () => window.removeEventListener("mousedown", onDown);
  }, [exportOpen]);

  const commitName = () => {
    const trimmed = nameDraft.trim();
    if (trimmed && trimmed !== name) {
      dispatch(patchScene({ name: trimmed }, "rename project"));
    } else {
      setNameDraft(name);
    }
  };

  return (
    <header className="flex h-10 items-center border-b border-hairline bg-paper px-3">
      <span className="mr-3 select-none text-sm font-bold lowercase">
        palmós
      </span>
      <input
        className="w-44 border border-transparent bg-transparent px-1 text-sm hover:border-hairline-soft focus:border-ink"
        value={nameDraft}
        onChange={(e) => setNameDraft(e.target.value)}
        onBlur={commitName}
        onKeyDown={(e) => e.key === "Enter" && (e.target as HTMLElement).blur()}
        aria-label="project name"
        spellCheck={false}
      />
      <div className="ml-4 flex items-center gap-1">
        <button
          onClick={undo}
          disabled={!canUndo}
          title="undo (⌘z)"
          className="px-1.5 py-0.5 text-xs disabled:opacity-30"
        >
          ↺
        </button>
        <button
          onClick={redo}
          disabled={!canRedo}
          title="redo (⇧⌘z)"
          className="px-1.5 py-0.5 text-xs disabled:opacity-30"
        >
          ↻
        </button>
        <span className="ml-2 w-12 text-xs text-ink-faint">
          {Math.round(zoom * 100)}%
        </span>
      </div>
      <div className="mx-auto flex items-center border border-hairline">
        {(["edit", "perform"] as const).map((m) => (
          <button
            key={m}
            onClick={() => setMode(m)}
            className={`px-4 py-1 text-xs ${
              mode === m
                ? m === "perform"
                  ? "bg-accent-2 text-paper"
                  : "bg-ink text-paper"
                : "bg-paper text-ink hover:text-accent"
            }`}
          >
            {m}
          </button>
        ))}
      </div>
      <div className="flex items-center gap-2">
        <ProjectsMenu />
        <input
          ref={fileRef}
          type="file"
          accept=".json,application/json,image/png,image/jpeg"
          className="hidden"
          onChange={async (e) => {
            const file = e.target.files?.[0];
            e.target.value = "";
            if (!file) return;
            if (file.type.startsWith("image/")) {
              // screenshots go through the reconstruction service
              importImage(file);
              return;
            }
            try {
              setScene(await importSceneFile(file));
            } catch {
              // surfaced via canvas drop-error path is nicer, but keep quiet here
            }
          }}
        />
        <button
          onClick={() => fileRef.current?.click()}
          className="border border-hairline px-3 py-1 text-xs hover:bg-ink hover:text-paper"
        >
          import
        </button>
        <div ref={exportRef} className="relative">
          <button
            onClick={() => setExportOpen((o) => !o)}
            className="border border-hairline px-3 py-1 text-xs hover:bg-ink hover:text-paper"
          >
            export
          </button>
          {exportOpen && (
            <div className="absolute right-0 top-8 z-30 flex w-28 flex-col border border-hairline bg-paper">
              {(
                [
                  ["json", () => exportSceneJson(useAppStore.getState().scene)],
                  ["svg", () => exportSceneSvg(useAppStore.getState().scene)],
                  ["png 2x", exportPng],
                ] as const
              ).map(([label, fn]) => (
                <button
                  key={label}
                  onClick={() => {
                    fn();
                    setExportOpen(false);
                  }}
                  className="px-3 py-1.5 text-left text-xs hover:bg-ink hover:text-paper"
                >
                  {label}
                </button>
              ))}
            </div>
          )}
        </div>
      </div>
    </header>
  );
}
