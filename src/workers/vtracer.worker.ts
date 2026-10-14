/// <reference lib="webworker" />
/**
 * Runs vtracer (Rust → WebAssembly) off the main thread so the UI stays responsive.
 * Message in : { id, rgba: ArrayBuffer, width, height, options }
 * Message out: { id, ok: true, svg, ms } | { id, ok: false, error }
 */
import { initVtracer, vectorize_rgba } from '../vendor/vtracer/vtracer_wasm.js';
import wasmUrl from '../vendor/vtracer/vtracer_wasm_bg.wasm?url';

let ready: Promise<void> | null = null;

self.onmessage = async (event: MessageEvent) => {
  const { id, rgba, width, height, options } = event.data;
  try {
    ready ??= initVtracer(wasmUrl);
    await ready;
    const t0 = performance.now();
    const svg = vectorize_rgba(new Uint8Array(rgba), width, height, options);
    self.postMessage({ id, ok: true, svg, ms: Math.round(performance.now() - t0) });
  } catch (err: any) {
    self.postMessage({ id, ok: false, error: String(err?.message || err) });
  }
};
