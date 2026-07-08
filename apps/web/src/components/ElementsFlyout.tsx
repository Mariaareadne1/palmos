"use client";

import { useEffect, useState } from "react";
import { useAppStore } from "@/state/store";
import { addLayers } from "@/state/commands";
import { GENERATORS, getGenerator } from "@/design/generators";
import { defaultParams } from "@/effects/registry";

/**
 * The `elements` browser (SPEC2 §12.1, keyboard E): a flyout of parametric
 * generators. Picking one drops its output group on the canvas, selected,
 * with params editable in the inspector's generator section.
 */
export default function ElementsFlyout() {
  const [open, setOpen] = useState(false);
  const dispatch = useAppStore((s) => s.dispatch);
  const setSelected = useAppStore((s) => s.setSelected);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement;
      if (t.tagName === "INPUT" || t.tagName === "TEXTAREA" || t.isContentEditable)
        return;
      if (e.key.toLowerCase() === "e" && !e.metaKey && !e.ctrlKey) {
        e.preventDefault();
        setOpen((o) => !o);
      } else if (e.key === "Escape") {
        setOpen(false);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  const insert = (key: string) => {
    const gen = getGenerator(key);
    if (!gen) return;
    const scene = useAppStore.getState().scene;
    // param defaults reuse the effect-registry helper shape
    const params = defaultParams({ kind: gen.key, name: gen.name, class: "bake", params: gen.params });
    const grpLayer = gen.generate(params, scene.palette);
    // center on the artboard
    grpLayer.transform = {
      ...grpLayer.transform,
      x: scene.width * 0.5 - 200,
      y: scene.height * 0.5 - 200,
    };
    dispatch(addLayers([{ layer: grpLayer, parentId: null, index: scene.layers.length }], `add ${gen.name}`));
    setSelected([grpLayer.id]);
    setOpen(false);
  };

  return (
    <>
      <button
        title="elements (e)"
        onClick={() => setOpen((o) => !o)}
        className={`border border-hairline px-3 py-1 text-xs ${
          open ? "bg-ink text-paper" : "hover:bg-ink hover:text-paper"
        }`}
      >
        elements
      </button>
      {open && (
        <div className="absolute left-1/2 top-12 z-40 w-[440px] -translate-x-1/2 border border-hairline bg-paper p-3">
          <div className="mb-2 flex items-center justify-between">
            <span className="text-xs text-ink-faint">elements</span>
            <button className="text-xs text-ink-faint hover:text-accent" onClick={() => setOpen(false)}>
              esc
            </button>
          </div>
          <div className="grid grid-cols-3 gap-2">
            {GENERATORS.map((g) => (
              <button
                key={g.key}
                onClick={() => insert(g.key)}
                className="graph-paper flex h-16 items-end border border-hairline-soft p-2 text-left text-xs hover:border-accent"
              >
                {g.name}
              </button>
            ))}
          </div>
        </div>
      )}
    </>
  );
}
