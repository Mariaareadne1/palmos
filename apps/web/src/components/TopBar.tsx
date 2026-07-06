"use client";

import { useAppStore } from "@/state/store";

/** Serialize the scene graph and download it as {name}.palmos.json. */
function exportJson() {
  const scene = useAppStore.getState().scene;
  const blob = new Blob([JSON.stringify(scene, null, 2)], {
    type: "application/json",
  });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `${scene.name}.palmos.json`;
  a.click();
  URL.revokeObjectURL(url);
}

export default function TopBar() {
  const name = useAppStore((s) => s.scene.name);
  const mode = useAppStore((s) => s.mode);
  const setSceneName = useAppStore((s) => s.setSceneName);
  const setMode = useAppStore((s) => s.setMode);

  return (
    <header className="flex h-10 items-center border-b border-hairline bg-paper px-3">
      <span className="mr-3 select-none text-sm font-bold lowercase">
        palmós
      </span>
      <input
        className="w-48 border border-transparent bg-transparent px-1 text-sm hover:border-hairline-soft focus:border-ink"
        value={name}
        onChange={(e) => setSceneName(e.target.value)}
        aria-label="project name"
        spellCheck={false}
      />
      <div className="mx-auto flex items-center gap-0 border border-hairline">
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
        <button
          onClick={exportJson}
          className="border border-hairline px-3 py-1 text-xs hover:bg-ink hover:text-paper"
        >
          export
        </button>
      </div>
    </header>
  );
}
