"use client";

import TopBar from "@/components/TopBar";
import LayersPanel from "@/components/LayersPanel";
import Inspector from "@/components/Inspector";
import CanvasArea from "@/components/CanvasArea";

export default function AppShell() {
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
