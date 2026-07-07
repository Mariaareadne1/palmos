"use client";

import { useEffect } from "react";
import dynamic from "next/dynamic";
import TopBar from "@/components/TopBar";
import LayersPanel from "@/components/LayersPanel";
import Inspector from "@/components/Inspector";
import CanvasArea from "@/components/CanvasArea";
import { initPersistence } from "@/lib/persistence";
import { useShortcuts } from "@/editor/useShortcuts";
import { useAppStore } from "@/state/store";
import "@/effects/all"; // registers the effect suite
import { gpuContext } from "@/effects/GpuContext";

// PixiJS touches `window` — client-only, loaded on first perform toggle.
const PerformOverlay = dynamic(() => import("@/perform/PerformOverlay"), {
  ssr: false,
});

export default function AppShell() {
  const mode = useAppStore((s) => s.mode);
  useShortcuts();

  // pick adapter (local by default, supabase when env vars exist),
  // hydrate, then autosave (debounced) on scene changes
  useEffect(() => initPersistence(), []);

  // warm the shared WebGL context + compile all effect shaders once, so
  // enabling an effect mid-set never hitches (SPEC2 §12.5)
  useEffect(() => {
    void gpuContext.init();
  }, []);

  return (
    <div className="flex h-screen flex-col bg-paper text-ink">
      <TopBar />
      <div className="flex min-h-0 flex-1">
        <LayersPanel />
        <CanvasArea />
        <Inspector />
      </div>
      {mode === "perform" && <PerformOverlay />}
    </div>
  );
}
