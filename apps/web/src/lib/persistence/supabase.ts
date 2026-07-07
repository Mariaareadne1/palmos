/**
 * Supabase persistence backend.
 *
 * IMPORTANT: this module must only ever be loaded via the dynamic
 * `import()` in ./index.ts, guarded by the env-var check — when the env
 * vars are absent nothing here (including the supabase-js import)
 * executes (SPEC §5 step 3).
 */
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import type { SceneGraph } from "@/types/scene";
import { isSceneGraph, normalizeScene } from "@/lib/scene-io";
import { loadLocalScene, saveLocalScene } from "./local";
import type { PersistenceAdapter, ProjectMeta } from "./types";

interface ProjectRow {
  id: string;
  name: string;
  scene: unknown;
  updated_at: string;
}

export class SupabaseAdapter implements PersistenceAdapter {
  readonly kind = "supabase" as const;
  private client: SupabaseClient;
  /** Row id of the project the current scene is bound to. */
  private currentProjectId: string | null = null;
  /** Serializes saves so two in-flight autosaves can't double-insert. */
  private saveChain: Promise<void> = Promise.resolve();

  constructor(url: string, anonKey: string) {
    this.client = createClient(url, anonKey);
  }

  async init(): Promise<SceneGraph | null> {
    const { data } = await this.client.auth.getSession();
    if (!data.session) {
      // signed out: behave like the local adapter until sign-in
      return loadLocalScene();
    }
    const { data: rows } = await this.client
      .from("projects")
      .select("id, name, scene, updated_at")
      .order("updated_at", { ascending: false })
      .limit(1);
    const row = rows?.[0] as ProjectRow | undefined;
    if (row && isSceneGraph(row.scene)) {
      this.currentProjectId = row.id;
      return normalizeScene(row.scene);
    }
    return loadLocalScene();
  }

  save(scene: SceneGraph): Promise<void> {
    // always mirror locally — survives being offline / signed out
    saveLocalScene(scene);
    // chain cloud writes: a second autosave firing while the first is
    // still inserting must not create a duplicate project row
    this.saveChain = this.saveChain
      .catch(() => undefined)
      .then(() => this.saveToCloud(scene));
    return this.saveChain;
  }

  private async saveToCloud(scene: SceneGraph): Promise<void> {
    const { data } = await this.client.auth.getSession();
    if (!data.session) return;
    if (this.currentProjectId) {
      const { error } = await this.client
        .from("projects")
        .update({ name: scene.name, scene })
        .eq("id", this.currentProjectId);
      if (error) throw new Error(error.message);
    } else {
      this.currentProjectId = await this.createProject(scene);
    }
  }

  async signIn(email: string): Promise<void> {
    const { error } = await this.client.auth.signInWithOtp({
      email,
      options: { emailRedirectTo: window.location.origin },
    });
    if (error) throw new Error(error.message);
  }

  async signOut(): Promise<void> {
    await this.client.auth.signOut();
    this.currentProjectId = null;
  }

  onAuthChange(cb: (email: string | null) => void): () => void {
    const { data } = this.client.auth.onAuthStateChange((_event, session) => {
      cb(session?.user?.email ?? null);
    });
    return () => data.subscription.unsubscribe();
  }

  async listProjects(): Promise<ProjectMeta[]> {
    const { data, error } = await this.client
      .from("projects")
      .select("id, name, updated_at")
      .order("updated_at", { ascending: false });
    if (error) throw new Error(error.message);
    return (data ?? []).map((r) => ({
      id: r.id as string,
      name: r.name as string,
      updatedAt: r.updated_at as string,
    }));
  }

  async loadProject(id: string): Promise<SceneGraph> {
    const { data, error } = await this.client
      .from("projects")
      .select("id, name, scene, updated_at")
      .eq("id", id)
      .single();
    if (error) throw new Error(error.message);
    const row = data as ProjectRow;
    if (!isSceneGraph(row.scene)) throw new Error("stored scene is invalid");
    this.currentProjectId = row.id;
    return normalizeScene(row.scene);
  }

  async createProject(scene: SceneGraph): Promise<string> {
    const { data: userData } = await this.client.auth.getUser();
    const owner = userData.user?.id;
    if (!owner) throw new Error("not signed in");
    const { data, error } = await this.client
      .from("projects")
      .insert({ owner, name: scene.name, scene })
      .select("id")
      .single();
    if (error) throw new Error(error.message);
    this.currentProjectId = data.id as string;
    return this.currentProjectId;
  }

  async deleteProject(id: string): Promise<void> {
    const { error } = await this.client.from("projects").delete().eq("id", id);
    if (error) throw new Error(error.message);
    if (this.currentProjectId === id) this.currentProjectId = null;
  }
}
