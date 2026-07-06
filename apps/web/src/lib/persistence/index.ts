import { create } from "zustand";
import { useAppStore } from "@/state/store";
import type { PersistenceAdapter } from "./types";

const AUTOSAVE_DEBOUNCE_MS = 500;

interface PersistenceState {
  kind: "local" | "supabase";
  userEmail: string | null;
  adapter: PersistenceAdapter | null;
}

/** UI-facing persistence state (cloud controls render only for supabase). */
export const usePersistenceStore = create<PersistenceState>(() => ({
  kind: "local",
  userEmail: null,
  adapter: null,
}));

async function createAdapter(): Promise<PersistenceAdapter> {
  // NOTE (env-var trap, documented in README): shell-level env vars
  // override .env.local in Next.js — an empty NEXT_PUBLIC_SUPABASE_URL
  // exported in your shell will silently disable the cloud adapter.
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (url && key) {
    // dynamic import: supabase-js never loads when the env vars are absent
    const { SupabaseAdapter } = await import("./supabase");
    return new SupabaseAdapter(url, key);
  }
  const { LocalAdapter } = await import("./local");
  return new LocalAdapter();
}

/**
 * Pick the adapter, hydrate the scene, then start debounced autosave.
 * Subscribing only after hydration means the empty boot scene never
 * clobbers a save. Returns a cleanup for effects/tests.
 */
export function initPersistence(): () => void {
  let timer: ReturnType<typeof setTimeout> | null = null;
  let unsubscribeStore: (() => void) | null = null;
  let unsubscribeAuth: (() => void) | null = null;
  let cancelled = false;

  void (async () => {
    const adapter = await createAdapter();
    if (cancelled) return;
    usePersistenceStore.setState({ adapter, kind: adapter.kind });

    if (adapter.onAuthChange) {
      unsubscribeAuth = adapter.onAuthChange((userEmail) => {
        usePersistenceStore.setState({ userEmail });
      });
    }

    const restored = await adapter.init().catch(() => null);
    if (cancelled) return;
    if (restored) useAppStore.getState().setScene(restored);

    unsubscribeStore = useAppStore.subscribe((state, prev) => {
      if (state.scene === prev.scene) return;
      if (timer) clearTimeout(timer);
      timer = setTimeout(() => {
        adapter.save(state.scene).catch((err) => {
          console.warn("[palmos] autosave failed:", err);
        });
      }, AUTOSAVE_DEBOUNCE_MS);
    });
  })();

  return () => {
    cancelled = true;
    if (timer) clearTimeout(timer);
    unsubscribeStore?.();
    unsubscribeAuth?.();
  };
}
