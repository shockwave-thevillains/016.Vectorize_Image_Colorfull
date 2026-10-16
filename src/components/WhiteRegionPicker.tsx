import React, { useEffect, useMemo, useRef, useState } from 'react';
import { MousePointerClick, RotateCcw, Play, Eye, EyeOff } from 'lucide-react';
import { VectorizeConfig, WhiteRegionOverride } from '../types';
import { computeWhiteBackgroundMask, regionAtPoint, BackgroundMaskResult } from '../lib/whiteRegions';

interface WhiteRegionPickerProps {
  imageSrc: string;
  config: VectorizeConfig;
  isProcessing: boolean;
  /** Dipanggil dengan konfigurasi baru (override area, putih dalam, bayangan) → vektorisasi ulang */
  onApply: (patch: Pick<VectorizeConfig, 'whiteRegionOverrides' | 'keepInnerWhite' | 'removeShadow'>) => void;
}

/** Sisi terpanjang kanvas pemilih (cukup detail untuk diklik, tetap ringan). */
const MAX_PICKER_DIM = 1400;

/**
 * Pemilih area putih: setiap area putih terhubung bisa diklik untuk dihapus (transparan) atau
 * dipertahankan. Tampilan memakai fungsi yang sama dengan pipeline, jadi apa yang terlihat di sini
 * sama dengan yang akan diproses.
 */
export const WhiteRegionPicker: React.FC<WhiteRegionPickerProps> = ({ imageSrc, config, isProcessing, onApply }) => {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [source, setSource] = useState<ImageData | null>(null);
  const [overrides, setOverrides] = useState<WhiteRegionOverride[]>(config.whiteRegionOverrides || []);
  const [keepInnerWhite, setKeepInnerWhite] = useState<boolean>(config.keepInnerWhite !== false);
  const [removeShadow, setRemoveShadow] = useState<boolean>(config.removeShadow === true);
  const [hoverRegion, setHoverRegion] = useState<number>(-1);
  const [showOriginal, setShowOriginal] = useState<boolean>(false);

  // Sinkron bila item diproses ulang dari luar
  useEffect(() => {
    setOverrides(config.whiteRegionOverrides || []);
    setKeepInnerWhite(config.keepInnerWhite !== false);
    setRemoveShadow(config.removeShadow === true);
  }, [config.whiteRegionOverrides, config.keepInnerWhite, config.removeShadow]);

  useEffect(() => {
    let cancelled = false;
    const img = new Image();
    img.onload = () => {
      if (cancelled) return;
      const w0 = img.naturalWidth || img.width;
      const h0 = img.naturalHeight || img.height;
      const k = Math.min(1, MAX_PICKER_DIM / Math.max(w0, h0));
      const w = Math.max(1, Math.round(w0 * k));
      const h = Math.max(1, Math.round(h0 * k));
      const c = document.createElement('canvas');
      c.width = w;
      c.height = h;
      const ctx = c.getContext('2d', { willReadFrequently: true });
      if (!ctx) return;
      ctx.drawImage(img, 0, 0, w, h);
      setSource(ctx.getImageData(0, 0, w, h));
    };
    img.src = imageSrc;
    return () => {
      cancelled = true;
    };
  }, [imageSrc]);

  const analysis: BackgroundMaskResult | null = useMemo(() => {
    if (!source) return null;
    return computeWhiteBackgroundMask(source, {
      whiteTolerance: config.whiteTolerance,
      keepInnerWhite,
      whiteRegionOverrides: overrides,
      removeShadow,
      shadowMinLight: config.shadowMinLight,
    });
  }, [source, overrides, keepInnerWhite, removeShadow, config.whiteTolerance, config.shadowMinLight]);

  // Gambar kanvas: piksel terhapus = kotak-kotak, putih dipertahankan = rona hijau tipis.
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas || !source || !analysis) return;
    canvas.width = source.width;
    canvas.height = source.height;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    const out = new ImageData(new Uint8ClampedArray(source.data), source.width, source.height);
    if (!showOriginal) {
      const { labels, regions } = analysis.map;
      const d = out.data;
      for (let p = 0; p < labels.length; p++) {
        const i = p * 4;
        const x = p % source.width;
        const y = (p / source.width) | 0;
        const l = labels[p];
        const hovered = l !== -1 && l === hoverRegion;
        if (analysis.mask[p]) {
          const checker = ((x >> 3) + (y >> 3)) & 1 ? 205 : 238;
          d[i] = hovered ? 255 : checker;
          d[i + 1] = hovered ? 120 : checker;
          d[i + 2] = hovered ? 140 : checker;
          d[i + 3] = 255;
        } else if (l !== -1 && !regions[l].removed) {
          // putih dipertahankan
          d[i] = hovered ? 110 : 214;
          d[i + 1] = hovered ? 231 : 250;
          d[i + 2] = hovered ? 183 : 232;
          d[i + 3] = 255;
        }
      }
    }
    ctx.putImageData(out, 0, 0);
  }, [source, analysis, hoverRegion, showOriginal]);

  const pointFromEvent = (e: React.MouseEvent<HTMLCanvasElement>) => {
    const rect = e.currentTarget.getBoundingClientRect();
    return {
      x: Math.min(1, Math.max(0, (e.clientX - rect.left) / rect.width)),
      y: Math.min(1, Math.max(0, (e.clientY - rect.top) / rect.height)),
    };
  };

  const handleClick = (e: React.MouseEvent<HTMLCanvasElement>) => {
    if (!analysis) return;
    const pt = pointFromEvent(e);
    const id = regionAtPoint(analysis.map, pt.x, pt.y);
    if (id < 0) return;
    const region = analysis.map.regions[id];
    const nextAction: WhiteRegionOverride['action'] = region.removed ? 'keep' : 'remove';
    const defaultRemoved = region.touchesBorder || region.seeThrough ? true : !keepInnerWhite;
    // buang override lama untuk area yang sama, lalu tambah bila berbeda dari default
    const rest = overrides.filter((o) => regionAtPoint(analysis.map, o.x, o.y) !== id);
    if ((nextAction === 'remove') !== defaultRemoved) {
      rest.push({ x: Number(pt.x.toFixed(5)), y: Number(pt.y.toFixed(5)), action: nextAction });
    }
    setOverrides(rest);
  };

  const handleMove = (e: React.MouseEvent<HTMLCanvasElement>) => {
    if (!analysis) return;
    const pt = pointFromEvent(e);
    const id = regionAtPoint(analysis.map, pt.x, pt.y, 1);
    if (id !== hoverRegion) setHoverRegion(id);
  };

  const stats = useMemo(() => {
    if (!analysis) return { removed: 0, kept: 0, overridden: 0 };
    let removed = 0, kept = 0, overridden = 0;
    for (const r of analysis.map.regions) {
      if (r.area < 4) continue; // titik putih 1–3 piksel tidak dihitung
      if (r.removed) removed++;
      else kept++;
      if (r.overridden) overridden++;
    }
    return { removed, kept, overridden };
  }, [analysis]);

  const dirty =
    JSON.stringify(overrides) !== JSON.stringify(config.whiteRegionOverrides || []) ||
    keepInnerWhite !== (config.keepInnerWhite !== false) ||
    removeShadow !== (config.removeShadow === true);

  const hovered = analysis && hoverRegion >= 0 ? analysis.map.regions[hoverRegion] : null;

  if ((config.bgMode ?? 'white') !== 'white' || config.removeBackground === false) {
    return (
      <div className="w-full h-full flex items-center justify-center p-6 text-center text-sm text-slate-300">
        Pemilih area putih hanya tersedia di mode background <strong className="mx-1 text-white">Putih</strong> dengan
        "Hapus Background" aktif.
      </div>
    );
  }

  return (
    <div className="w-full h-full flex flex-col lg:flex-row gap-4 p-4 overflow-auto">
      <div className="flex-1 min-h-0 flex items-center justify-center">
        {source ? (
          <canvas
            id="white-region-canvas"
            ref={canvasRef}
            onClick={handleClick}
            onMouseMove={handleMove}
            onMouseLeave={() => setHoverRegion(-1)}
            className="max-w-full max-h-[62vh] w-auto h-auto rounded-lg shadow-lg cursor-crosshair bg-white"
            style={{ imageRendering: source.width < 700 ? 'pixelated' : 'auto' }}
          />
        ) : (
          <span className="text-xs text-slate-400">Memuat gambar…</span>
        )}
      </div>

      <aside className="lg:w-72 shrink-0 bg-white rounded-xl p-4 space-y-3 text-xs text-slate-700 self-start">
        <div className="flex items-center gap-2 text-slate-900 font-bold text-sm">
          <MousePointerClick className="w-4 h-4 text-emerald-600" />
          Klik area putih
        </div>
        <p className="text-[11px] text-slate-600 leading-relaxed">
          Klik sebuah area untuk membalik pilihannya: <strong>dihapus</strong> (transparan) ↔{' '}
          <strong>dipertahankan</strong> (tetap putih solid).
        </p>
        <div className="space-y-1.5 text-[11px]">
          <div className="flex items-center gap-2">
            <span
              className="w-4 h-4 rounded border border-slate-300"
              style={{ backgroundImage: 'repeating-conic-gradient(#cdcdcd 0% 25%, #eeeeee 0% 50%)', backgroundSize: '8px 8px' }}
            />
            Dihapus (transparan) — {stats.removed} area
          </div>
          <div className="flex items-center gap-2">
            <span className="w-4 h-4 rounded border border-emerald-300 bg-[#d6fae8]" />
            Putih dipertahankan — {stats.kept} area
          </div>
          {stats.overridden > 0 && (
            <div className="text-emerald-700 font-semibold">{stats.overridden} area diubah manual</div>
          )}
        </div>

        <div className="min-h-[34px] rounded-lg bg-slate-50 border border-slate-200 px-2 py-1.5 text-[11px]">
          {hovered ? (
            <span>
              Area {hovered.touchesBorder ? 'background luar' : hovered.seeThrough ? 'background tembus' : 'putih dalam'} · {hovered.area.toLocaleString('id-ID')} px ·{' '}
              <strong className={hovered.removed ? 'text-rose-600' : 'text-emerald-700'}>
                {hovered.removed ? 'dihapus' : 'dipertahankan'}
              </strong>
            </span>
          ) : (
            <span className="text-slate-400">Arahkan kursor ke area putih…</span>
          )}
        </div>

        <label className="flex items-center gap-2 font-semibold cursor-pointer">
          <input
            type="checkbox"
            checked={keepInnerWhite}
            onChange={(e) => setKeepInnerWhite(e.target.checked)}
            className="rounded text-emerald-600 w-4 h-4"
          />
          Default: pertahankan putih di dalam objek
        </label>
        <label className="flex items-center gap-2 font-semibold cursor-pointer">
          <input
            type="checkbox"
            checked={removeShadow}
            onChange={(e) => setRemoveShadow(e.target.checked)}
            className="rounded text-slate-700 w-4 h-4"
          />
          Hapus bayangan lembut
        </label>

        <div className="flex flex-wrap gap-2 pt-1">
          <button
            type="button"
            onClick={() => setShowOriginal((v) => !v)}
            className="px-2.5 py-1.5 rounded-lg border border-slate-300 font-bold hover:bg-slate-50 flex items-center gap-1 cursor-pointer"
          >
            {showOriginal ? <EyeOff className="w-3.5 h-3.5" /> : <Eye className="w-3.5 h-3.5" />}
            {showOriginal ? 'Tampilkan pilihan' : 'Lihat asli'}
          </button>
          <button
            type="button"
            onClick={() => setOverrides([])}
            disabled={overrides.length === 0}
            className="px-2.5 py-1.5 rounded-lg border border-slate-300 font-bold hover:bg-slate-50 flex items-center gap-1 disabled:opacity-40 cursor-pointer"
          >
            <RotateCcw className="w-3.5 h-3.5" />
            Reset klik
          </button>
        </div>

        <button
          id="apply-white-regions-btn"
          type="button"
          disabled={!dirty || isProcessing}
          onClick={() => onApply({ whiteRegionOverrides: overrides, keepInnerWhite, removeShadow })}
          className="w-full px-3 py-2 rounded-lg bg-emerald-600 text-white font-bold hover:bg-emerald-700 disabled:opacity-40 flex items-center justify-center gap-1.5 cursor-pointer"
        >
          <Play className="w-3.5 h-3.5" />
          {isProcessing ? 'Memproses…' : 'Terapkan & Vektorisasi Ulang'}
        </button>
      </aside>
    </div>
  );
};
