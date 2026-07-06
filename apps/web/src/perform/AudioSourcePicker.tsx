"use client";

import { useEffect, useRef, useState } from "react";
import { AudioEngine, getAudioEngine } from "@/perform/audio";

/**
 * Compact audio-source panel: microphone, audio file (play/pause/loop —
 * essential for testing without performing), tab audio where supported.
 * Used by both the motion tab and the perform HUD.
 */
export default function AudioSourcePicker() {
  const fileRef = useRef<HTMLInputElement>(null);
  const [, force] = useState(0);
  const rerender = () => force((n) => n + 1);
  const [error, setError] = useState<string | null>(null);

  // engine state lives outside React — poll it cheaply
  useEffect(() => {
    const t = setInterval(rerender, 500);
    return () => clearInterval(t);
  }, []);

  const engine = getAudioEngine();

  const run = async (fn: () => Promise<void>) => {
    try {
      setError(null);
      await fn();
    } catch (err) {
      setError(err instanceof Error ? err.message : "audio source failed");
    }
    rerender();
  };

  const srcButton = (active: boolean) =>
    `border border-hairline px-2 py-0.5 text-xs ${
      active ? "bg-ink text-paper" : "hover:bg-ink hover:text-paper"
    }`;

  return (
    <div className="flex flex-col gap-2">
      <div className="flex items-center gap-1.5">
        <span className="text-xs text-ink-faint">audio</span>
        <button
          className={srcButton(engine.sourceKind === "mic")}
          onClick={() => run(() => engine.useMic())}
        >
          mic
        </button>
        <button
          className={srcButton(engine.sourceKind === "file")}
          onClick={() => fileRef.current?.click()}
        >
          file
        </button>
        {AudioEngine.supportsTabAudio() && (
          <button
            className={srcButton(engine.sourceKind === "tab")}
            onClick={() => run(() => engine.useTab())}
          >
            tab
          </button>
        )}
        <input
          ref={fileRef}
          type="file"
          accept="audio/*"
          className="hidden"
          onChange={(e) => {
            const file = e.target.files?.[0];
            e.target.value = "";
            if (file) void run(() => engine.useFile(file));
          }}
        />
      </div>
      {engine.sourceKind === "file" && (
        <div className="flex items-center gap-1.5">
          <button
            className="border border-hairline px-2 py-0.5 text-xs hover:bg-ink hover:text-paper"
            onClick={() => {
              if (engine.playing) engine.pause();
              else engine.play();
              rerender();
            }}
          >
            {engine.playing ? "pause" : "play"}
          </button>
          <button
            className={srcButton(engine.loop)}
            title="loop"
            onClick={() => {
              engine.setLoop(!engine.loop);
              rerender();
            }}
          >
            loop
          </button>
          <span className="truncate text-xs text-ink-faint">
            {engine.fileName}
          </span>
        </div>
      )}
      {error && <span className="text-xs text-accent">{error}</span>}
    </div>
  );
}
