"use client";

import { useAppStore } from "@/state/store";

/**
 * Center canvas region. Step 2 replaces the artboard div with the
 * react-konva stage; the graph-paper backdrop and letterboxed artboard
 * framing stay.
 */
export default function CanvasArea() {
  const scene = useAppStore((s) => s.scene);

  return (
    <main className="graph-paper relative flex flex-1 items-center justify-center overflow-hidden bg-paper-warm">
      <div
        className="border border-hairline"
        style={{
          width: scene.width * 0.6,
          height: scene.height * 0.6,
          background: scene.background,
        }}
        aria-label="artboard"
      />
    </main>
  );
}
