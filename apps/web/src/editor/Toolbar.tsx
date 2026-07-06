"use client";

import { useAppStore, type Tool } from "@/state/store";

const TOOLS: { tool: Tool; key: string; label: string }[] = [
  { tool: "select", key: "v", label: "select" },
  { tool: "rect", key: "r", label: "rectangle" },
  { tool: "ellipse", key: "o", label: "ellipse" },
  { tool: "text", key: "t", label: "text" },
];

/** Vertical tool strip on the canvas's left edge. */
export default function Toolbar() {
  const tool = useAppStore((s) => s.tool);
  const setTool = useAppStore((s) => s.setTool);

  return (
    <div className="absolute left-3 top-3 z-10 flex flex-col border border-hairline bg-paper">
      {TOOLS.map((t) => (
        <button
          key={t.tool}
          title={`${t.label} (${t.key})`}
          onClick={() => setTool(t.tool)}
          className={`flex h-8 w-8 items-center justify-center text-xs uppercase ${
            tool === t.tool ? "bg-ink text-paper" : "hover:text-accent"
          }`}
        >
          {t.key}
        </button>
      ))}
    </div>
  );
}
