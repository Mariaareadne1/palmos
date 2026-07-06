"use client";

import { useEffect } from "react";
import TopBar from "@/components/TopBar";
import LayersPanel from "@/components/LayersPanel";
import Inspector from "@/components/Inspector";
import CanvasArea from "@/components/CanvasArea";
import { initPersistence } from "@/lib/persistence";
import { useShortcuts } from "@/editor/useShortcuts";

export default function AppShell() {
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
    </div>
  );
}
