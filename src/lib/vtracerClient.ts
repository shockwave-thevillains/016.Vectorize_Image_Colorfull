/**
 * Small pool of vtracer Web Workers.
 * Each worker loads its own copy of the WASM module once, then serves jobs.
 */
interface Job {
  resolve: (r: { svg: string; ms: number }) => void;
  reject: (e: Error) => void;
}

interface PoolWorker {
  worker: Worker;
  busy: number;
}

const POOL_SIZE = Math.max(
  1,
  Math.min(3, (typeof navigator !== 'undefined' && navigator.hardwareConcurrency
    ? navigator.hardwareConcurrency
    : 2) - 1)
);

const pool: PoolWorker[] = [];
const pending = new Map<number, { job: Job; pw: PoolWorker }>();
let nextId = 1;

function createWorker(): PoolWorker {
  const worker = new Worker(new URL('../workers/vtracer.worker.ts', import.meta.url), {
    type: 'module',
  });
  const pw: PoolWorker = { worker, busy: 0 };

  worker.onmessage = (event: MessageEvent) => {
    const { id, ok, svg, ms, error } = event.data;
    const entry = pending.get(id);
    if (!entry) return;
    pending.delete(id);
    entry.pw.busy--;
    if (ok) entry.job.resolve({ svg, ms });
    else entry.job.reject(new Error(error || 'vtracer worker error'));
  };

  worker.onerror = (event: ErrorEvent) => {
    // Fail every job assigned to this worker, then drop it from the pool.
    for (const [id, entry] of pending) {
      if (entry.pw === pw) {
        pending.delete(id);
        entry.job.reject(new Error(event.message || 'vtracer worker crashed'));
      }
    }
    const idx = pool.indexOf(pw);
    if (idx !== -1) pool.splice(idx, 1);
    worker.terminate();
  };

  return pw;
}

function pickWorker(): PoolWorker {
  if (pool.length < POOL_SIZE) {
    const idle = pool.find((p) => p.busy === 0);
    if (idle) return idle;
    const pw = createWorker();
    pool.push(pw);
    return pw;
  }
  return pool.reduce((a, b) => (b.busy < a.busy ? b : a));
}

/**
 * Vectorize raw RGBA pixels in a worker. The buffer is transferred (zero-copy),
 * so the caller must not use `rgba` afterwards.
 */
export function vectorizeRgbaInWorker(
  rgba: Uint8ClampedArray,
  width: number,
  height: number,
  options: Record<string, unknown>
): Promise<{ svg: string; ms: number }> {
  return new Promise((resolve, reject) => {
    let pw: PoolWorker;
    try {
      pw = pickWorker();
    } catch (err: any) {
      reject(new Error(`Web Worker tidak tersedia: ${err?.message || err}`));
      return;
    }
    const id = nextId++;
    pw.busy++;
    pending.set(id, { job: { resolve, reject }, pw });
    const buffer = rgba.buffer as ArrayBuffer;
    pw.worker.postMessage({ id, rgba: buffer, width, height, options }, [buffer]);
  });
}

export const VTRACER_POOL_SIZE = POOL_SIZE;
