/// <reference lib="webworker" />
/**
 * Runs vtracer (Rust → WebAssembly) — or the shared-contour tracer (`options.engine === 'contour'`) —
 * off the main thread so the UI stays responsive.
 * Message in : { id, rgba: ArrayBuffer, width, height, options }
 * Message out: { id, ok: true, svg, ms } | { id, ok: false, error }
 */
import { initVtracer, vectorize_rgba } from '../vendor/vtracer/vtracer_wasm.js';
import wasmUrl from '../vendor/vtracer/vtracer_wasm_bg.wasm?url';
import { traceContoursToSvg } from '../lib/contourTracer';

let ready: Promise<void> | null = null;

self.onmessage = async (event: MessageEvent) => {
  const { id, rgba, width, height, options } = event.data;
  try {
    const t0 = performance.now();
    let svg: string;
    if (options?.engine === 'contour') {
      svg = traceContoursToSvg(new Uint8Array(rgba), width, height, options);
    } else {
      ready ??= initVtracer(wasmUrl);
      await ready;
      svg = vectorize_rgba(new Uint8Array(rgba), width, height, options);
    }
    self.postMessage({ id, ok: true, svg, ms: Math.round(performance.now() - t0) });
  } catch (err: any) {
    self.postMessage({ id, ok: false, error: String(err?.message || err) });
  }
};
