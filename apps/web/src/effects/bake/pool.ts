"use client";

import type {
  BakeRequest,
  BakeResult,
  BakeWorkerReply,
} from "./types";

const JOB_TIMEOUT_MS = 10_000; // SPEC2 §12.5 hard per-job timeout

interface Pending {
  resolve: (r: BakeResult) => void;
  reject: (e: Error) => void;
  worker: Worker;
  timer: ReturnType<typeof setTimeout>;
}

/**
 * One shared worker pool for all bake operations (SPEC2 §12.5): size =
 * hardwareConcurrency − 1 (min 1, max 4), queued requests, per-job
 * cancel + hard timeout. Never one worker per bake.
 */
class BakePool {
  private workers: Worker[] = [];
  private idle: Worker[] = [];
  private queue: { request: BakeRequest; pending: Omit<Pending, "worker" | "timer"> }[] =
    [];
  private inflight = new Map<string, Pending>();
  private started = false;

  private start(): void {
    if (this.started) return;
    this.started = true;
    const size = Math.max(
      1,
      Math.min(4, (navigator.hardwareConcurrency || 2) - 1),
    );
    for (let i = 0; i < size; i++) {
      const worker = new Worker(
        new URL("./bake.worker.ts", import.meta.url),
        { type: "module" },
      );
      worker.onmessage = (e: MessageEvent<BakeWorkerReply>) =>
        this.onReply(worker, e.data);
      worker.onerror = () => this.recycle(worker);
      this.workers.push(worker);
      this.idle.push(worker);
    }
  }

  run(request: BakeRequest): Promise<BakeResult> {
    this.start();
    return new Promise<BakeResult>((resolve, reject) => {
      const worker = this.idle.pop();
      if (worker) {
        this.dispatch(worker, request, { resolve, reject });
      } else {
        this.queue.push({ request, pending: { resolve, reject } });
      }
    });
  }

  private dispatch(
    worker: Worker,
    request: BakeRequest,
    pending: Omit<Pending, "worker" | "timer">,
  ): void {
    const timer = setTimeout(() => {
      // pathological params (e.g. absurd stipple density): cancel + surface
      worker.postMessage({ type: "cancel", jobId: request.jobId });
      this.finish(request.jobId, () =>
        pending.reject(new Error("bake timed out")),
      );
      this.release(worker);
    }, JOB_TIMEOUT_MS);
    this.inflight.set(request.jobId, { ...pending, worker, timer });
    worker.postMessage({ type: "run", request });
  }

  private onReply(worker: Worker, reply: BakeWorkerReply): void {
    if (reply.type === "done") {
      this.finish(reply.result.jobId, (p) => p.resolve(reply.result));
    } else {
      this.finish(reply.jobId, (p) => p.reject(new Error(reply.message)));
    }
    this.release(worker);
  }

  private finish(
    jobId: string,
    act: (p: Pick<Pending, "resolve" | "reject">) => void,
  ): void {
    const pending = this.inflight.get(jobId);
    if (!pending) return;
    clearTimeout(pending.timer);
    this.inflight.delete(jobId);
    act(pending);
  }

  private release(worker: Worker): void {
    const next = this.queue.shift();
    if (next) {
      this.dispatch(worker, next.request, next.pending);
    } else {
      this.idle.push(worker);
    }
  }

  private recycle(worker: Worker): void {
    // a crashed worker: reject its inflight job, replace it (SPEC2 §12.5
    // worker-kill recovery)
    for (const [jobId, pending] of this.inflight) {
      if (pending.worker === worker) {
        clearTimeout(pending.timer);
        pending.reject(new Error("bake worker crashed"));
        this.inflight.delete(jobId);
      }
    }
    this.workers = this.workers.filter((w) => w !== worker);
    this.idle = this.idle.filter((w) => w !== worker);
    worker.terminate();
    const replacement = new Worker(
      new URL("./bake.worker.ts", import.meta.url),
      { type: "module" },
    );
    replacement.onmessage = (e: MessageEvent<BakeWorkerReply>) =>
      this.onReply(replacement, e.data);
    replacement.onerror = () => this.recycle(replacement);
    this.workers.push(replacement);
    this.release(replacement);
  }

  cancel(jobId: string): void {
    const pending = this.inflight.get(jobId);
    if (pending) {
      pending.worker.postMessage({ type: "cancel", jobId });
      this.finish(jobId, (p) => p.reject(new Error("cancelled")));
      this.release(pending.worker);
    }
    this.queue = this.queue.filter((q) => q.request.jobId !== jobId);
  }
}

export const bakePool = new BakePool();
