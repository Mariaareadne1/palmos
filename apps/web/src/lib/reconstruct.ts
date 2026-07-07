import type { SceneGraph } from "@/types/scene";
import { isSceneGraph, normalizeScene } from "@/lib/scene-io";

// The editor must never depend on the backend (SPEC §5 step 6) — this
// module is only exercised by the explicit image-import flow.
const BASE =
  process.env.NEXT_PUBLIC_RECONSTRUCT_URL ?? "http://localhost:8000";

const POLL_MS = 500;
const HEALTH_TIMEOUT_MS = 3000;

export class ServiceUnreachableError extends Error {
  constructor() {
    super(
      `reconstruction service unreachable at ${BASE} — start it with: ` +
        `cd services/reconstruct && uvicorn app.main:app --reload`,
    );
  }
}

export interface JobUpdate {
  status: "processing" | "done" | "error";
  progress: number;
  stage?: "segmenting" | "vectorizing" | "assembling";
  scene?: unknown;
  engine?: "sam" | "cv";
  error?: string;
}

async function serviceUp(): Promise<boolean> {
  try {
    const res = await fetch(`${BASE}/health`, {
      signal: AbortSignal.timeout(HEALTH_TIMEOUT_MS),
    });
    return res.ok;
  } catch {
    return false;
  }
}

export interface Capabilities {
  sam: boolean;
  ocr: boolean;
  enrich: boolean;
}

/** null when the service is unreachable. */
export async function fetchCapabilities(): Promise<Capabilities | null> {
  try {
    const res = await fetch(`${BASE}/health`, {
      signal: AbortSignal.timeout(HEALTH_TIMEOUT_MS),
    });
    if (!res.ok) return null;
    const body = (await res.json()) as { capabilities?: Capabilities };
    return body.capabilities ?? null;
  } catch {
    return null;
  }
}

/** Optional AI layer naming — only callable when capabilities.enrich. */
export async function enrichJob(
  jobId: string,
): Promise<{ names: Record<string, string>; tags: string[] }> {
  const res = await fetch(`${BASE}/jobs/${jobId}/enrich`, { method: "POST" });
  if (!res.ok) {
    const detail = await res
      .json()
      .then((b: { detail?: string }) => b.detail)
      .catch(() => null);
    throw new Error(detail ?? `naming failed (${res.status})`);
  }
  return (await res.json()) as { names: Record<string, string>; tags: string[] };
}

export async function reconstructImage(
  file: File,
  onUpdate: (update: JobUpdate) => void,
): Promise<{ scene: SceneGraph; engine: "sam" | "cv"; jobId: string }> {
  if (!(await serviceUp())) throw new ServiceUnreachableError();

  const form = new FormData();
  form.append("image", file);
  const res = await fetch(`${BASE}/reconstruct`, {
    method: "POST",
    body: form,
  });
  if (!res.ok) {
    const detail = await res
      .json()
      .then((b: { detail?: string }) => b.detail)
      .catch(() => null);
    throw new Error(detail ?? `upload failed (${res.status})`);
  }
  const { job_id } = (await res.json()) as { job_id: string };

  for (;;) {
    await new Promise((r) => setTimeout(r, POLL_MS));
    const poll = await fetch(`${BASE}/jobs/${job_id}`);
    if (!poll.ok) throw new Error(`job poll failed (${poll.status})`);
    const update = (await poll.json()) as JobUpdate;
    onUpdate(update);
    if (update.status === "error") {
      throw new Error(update.error ?? "reconstruction failed");
    }
    if (update.status === "done") {
      if (!isSceneGraph(update.scene)) {
        throw new Error("service returned an invalid scene");
      }
      // the service emits v1 — migrate on entry
      return {
        scene: normalizeScene(update.scene),
        engine: update.engine ?? "cv",
        jobId: job_id,
      };
    }
  }
}
