import type { SceneGraph } from "@/types/scene";

export interface ProjectMeta {
  id: string;
  name: string;
  updatedAt: string;
}

/**
 * One save/load surface, two backends. LocalAdapter is always available;
 * SupabaseAdapter activates only when both NEXT_PUBLIC_SUPABASE_* env
 * vars are present (SPEC §5 step 3) — its module is never even imported
 * otherwise.
 */
export interface PersistenceAdapter {
  readonly kind: "local" | "supabase";
  /** Restore the scene to boot with (or null to keep the empty scene). */
  init(): Promise<SceneGraph | null>;
  /** Autosave sink (debounced by the caller). */
  save(scene: SceneGraph): Promise<void>;

  // Cloud-only surface — present when kind === "supabase".
  signIn?(email: string): Promise<void>;
  signOut?(): Promise<void>;
  onAuthChange?(cb: (email: string | null) => void): () => void;
  listProjects?(): Promise<ProjectMeta[]>;
  loadProject?(id: string): Promise<SceneGraph>;
  /** Save the current scene as a new project; returns the row id. */
  createProject?(scene: SceneGraph): Promise<string>;
  deleteProject?(id: string): Promise<void>;
}
