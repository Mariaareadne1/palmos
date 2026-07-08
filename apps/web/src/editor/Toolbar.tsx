"use client";

import { useState } from "react";
import { useAppStore, type Tool } from "@/state/store";
import { addLayers } from "@/state/commands";
import { createShaderLayer } from "@/lib/shapes";
import { SHADER_PRESETS } from "@/effects/shaderPresets";

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
  const dispatch = useAppStore((s) => s.dispatch);
  const setSelected = useAppStore((s) => s.setSelected);
  const [shaderOpen, setShaderOpen] = useState(false);

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
      {/* custom GLSL layer (SPEC2 §11.2): pick a starter preset to insert */}
      <div className="relative border-t border-hairline-soft">
        <button
          title="custom shader layer"
          onClick={() => setShaderOpen((o) => !o)}
          onBlur={() => setTimeout(() => setShaderOpen(false), 150)}
          className={`flex h-8 w-8 items-center justify-center text-xs ${
            shaderOpen ? "bg-ink text-paper" : "hover:text-accent"
          }`}
        >
          ✦
        </button>
        {shaderOpen && (
          <div className="absolute left-9 top-0 z-30 w-36 border border-hairline bg-paper">
            <div className="border-b border-hairline-soft px-2 py-1 text-xs text-ink-faint">
              shader preset
            </div>
            {(Object.keys(SHADER_PRESETS) as (keyof typeof SHADER_PRESETS)[]).map(
              (key) => (
                <button
                  key={key}
                  className="block w-full px-2 py-1.5 text-left text-xs hover:bg-ink hover:text-paper"
                  onMouseDown={(e) => {
                    e.preventDefault();
                    const scene = useAppStore.getState().scene;
                    const size = Math.min(400, scene.width * 0.5);
                    const layer = createShaderLayer(
                      key,
                      (scene.width - size) / 2,
                      (scene.height - size) / 2,
                      size,
                      size,
                    );
                    dispatch(
                      addLayers(
                        [{ layer, parentId: null, index: scene.layers.length }],
                        "add shader",
                      ),
                    );
                    setSelected([layer.id]);
                    setShaderOpen(false);
                  }}
                >
                  {SHADER_PRESETS[key].name}
                </button>
              ),
            )}
          </div>
        )}
      </div>
    </div>
  );
}
