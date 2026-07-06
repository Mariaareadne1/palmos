"use client";

import { useEffect, useRef, useState } from "react";
import { useAppStore } from "@/state/store";
import { usePersistenceStore } from "@/lib/persistence";
import type { ProjectMeta } from "@/lib/persistence/types";

/**
 * Cloud project list + magic-link auth. Rendered by TopBar ONLY when the
 * supabase adapter is active — with no env vars this component never
 * mounts and nothing supabase-related exists in the UI.
 */
export default function ProjectsMenu() {
  const adapter = usePersistenceStore((s) => s.adapter);
  const userEmail = usePersistenceStore((s) => s.userEmail);
  const setScene = useAppStore((s) => s.setScene);

  const [open, setOpen] = useState(false);
  const [email, setEmail] = useState("");
  const [status, setStatus] = useState<string | null>(null);
  const [projects, setProjects] = useState<ProjectMeta[] | null>(null);
  const rootRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (!rootRef.current?.contains(e.target as Node)) setOpen(false);
    };
    window.addEventListener("mousedown", onDown);
    return () => window.removeEventListener("mousedown", onDown);
  }, [open]);

  useEffect(() => {
    if (!open || !userEmail || !adapter?.listProjects) return;
    adapter
      .listProjects()
      .then(setProjects)
      .catch(() => setStatus("could not load projects"));
  }, [open, userEmail, adapter]);

  if (!adapter || adapter.kind !== "supabase") return null;

  return (
    <div ref={rootRef} className="relative">
      <button
        onClick={() => setOpen((o) => !o)}
        className="border border-hairline px-3 py-1 text-xs hover:bg-ink hover:text-paper"
      >
        projects
      </button>
      {open && (
        <div className="absolute right-0 top-8 z-30 w-64 border border-hairline bg-paper p-3">
          {!userEmail ? (
            <div className="flex flex-col gap-2">
              <span className="text-xs text-ink-faint">
                sign in with a magic link
              </span>
              <input
                className="field"
                type="email"
                placeholder="you@example.com"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                spellCheck={false}
              />
              <button
                className="border border-hairline px-3 py-1 text-xs hover:bg-ink hover:text-paper"
                onClick={async () => {
                  try {
                    await adapter.signIn?.(email.trim());
                    setStatus("check your inbox for the link");
                  } catch (err) {
                    setStatus(
                      err instanceof Error ? err.message : "sign-in failed",
                    );
                  }
                }}
              >
                send link
              </button>
              {status && <span className="text-xs text-accent">{status}</span>}
            </div>
          ) : (
            <div className="flex flex-col gap-2">
              <div className="flex items-center justify-between">
                <span className="truncate text-xs text-ink-faint">
                  {userEmail}
                </span>
                <button
                  className="text-xs text-ink-faint hover:text-accent"
                  onClick={async () => {
                    await adapter.signOut?.();
                    setProjects(null);
                  }}
                >
                  sign out
                </button>
              </div>
              <button
                className="border border-hairline px-3 py-1 text-left text-xs hover:bg-ink hover:text-paper"
                onClick={async () => {
                  try {
                    const scene = useAppStore.getState().scene;
                    await adapter.createProject?.(scene);
                    setStatus("saved as new project");
                    setProjects((await adapter.listProjects?.()) ?? null);
                  } catch (err) {
                    setStatus(
                      err instanceof Error ? err.message : "save failed",
                    );
                  }
                }}
              >
                save as new project
              </button>
              <div className="max-h-56 overflow-y-auto border-t border-hairline-soft pt-2">
                {projects === null ? (
                  <span className="text-xs text-ink-faint">loading…</span>
                ) : projects.length === 0 ? (
                  <span className="text-xs text-ink-faint">no projects yet</span>
                ) : (
                  projects.map((p) => (
                    <div key={p.id} className="group flex items-center">
                      <button
                        className="flex-1 truncate px-1 py-1 text-left text-xs hover:bg-paper-warm"
                        onClick={async () => {
                          try {
                            const scene = await adapter.loadProject?.(p.id);
                            if (scene) {
                              setScene(scene);
                              setOpen(false);
                            }
                          } catch {
                            setStatus("load failed");
                          }
                        }}
                      >
                        {p.name}
                        <span className="ml-2 text-ink-faint">
                          {new Date(p.updatedAt).toLocaleDateString()}
                        </span>
                      </button>
                      <button
                        title="delete project"
                        className="px-1 text-xs text-ink-faint opacity-0 hover:text-accent group-hover:opacity-100"
                        onClick={async () => {
                          await adapter.deleteProject?.(p.id).catch(() => null);
                          setProjects(
                            (await adapter.listProjects?.()) ?? null,
                          );
                        }}
                      >
                        ×
                      </button>
                    </div>
                  ))
                )}
              </div>
              {status && <span className="text-xs text-accent">{status}</span>}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
