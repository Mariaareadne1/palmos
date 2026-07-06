"use client";

import { useEffect } from "react";
import TopBar from "@/components/TopBar";
import LayersPanel from "@/components/LayersPanel";
import Inspector from "@/components/Inspector";
import CanvasArea from "@/components/CanvasArea";
import { initLocalPersistence } from "@/lib/persistence";
import { useShortcuts } from "@/editor/useShortcuts";

export default function AppShell() {
  useShortcuts();

  // hydrate from localStorage, then autosave (debounced) on scene changes
  useEffect(() => initLocalPersistence(), []);

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
