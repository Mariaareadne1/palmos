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
