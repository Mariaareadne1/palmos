/// <reference lib="webworker" />
import { runBake } from "./implementations";
import type { BakeWorkerMessage, BakeWorkerReply } from "./types";

/**
 * Bake worker entry. Pure compute: receives (source, params, seed),
 * replies with layers. Cancellation is cooperative — we drop the reply
 * for a cancelled job (each job is short; the pool also enforces a hard
 * timeout on the host side).
 */

const cancelled = new Set<string>();

self.onmessage = async (e: MessageEvent<BakeWorkerMessage>) => {
  const msg = e.data;
  if (msg.type === "cancel") {
    cancelled.add(msg.jobId);
    return;
  }
  const { jobId, kind, params, seed, source } = msg.request;
  try {
    const out = await runBake(kind, source, params, seed);
    if (cancelled.has(jobId)) {
      cancelled.delete(jobId);
      return;
    }
    const reply: BakeWorkerReply = {
      type: "done",
      result: { jobId, ...out },
    };
    (self as unknown as Worker).postMessage(reply);
  } catch (err) {
    if (cancelled.has(jobId)) {
      cancelled.delete(jobId);
      return;
    }
    const reply: BakeWorkerReply = {
      type: "error",
      jobId,
      message: err instanceof Error ? err.message : "bake failed",
    };
    (self as unknown as Worker).postMessage(reply);
  }
};
