import React from 'react';
import { Palette, FileArchive, Sparkles, CheckCircle2, ShieldCheck, SunMedium, Hexagon, Spline, ZoomIn } from 'lucide-react';

interface HeaderProps {
  queueCount: number;
  completedCount: number;
  onBatchProcess: () => void;
  isProcessingBatch: boolean;
  onBatchDownload: () => void;
  bgMode?: 'magenta' | 'white';
  removeBgActive?: boolean;
  whiteTransparentActive?: boolean;
  activeCurveMode: 'polygon' | 'spline';
  actualUpscaleFactor?: number;
  onToggleCurveMode?: (mode: 'polygon' | 'spline') => void;
}

export const Header: React.FC<HeaderProps> = ({
  queueCount,
  completedCount,
  onBatchProcess,
  isProcessingBatch,
  onBatchDownload,
  bgMode = 'white',
  removeBgActive = true,
  whiteTransparentActive = false,
  activeCurveMode,
  actualUpscaleFactor,
  onToggleCurveMode,
}) => {
  return (
    <header className="border-b border-slate-200 bg-white/95 backdrop-blur sticky top-0 z-30 shadow-xs">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 h-16 flex items-center justify-between">
        {/* Logo & Identity */}
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-xl bg-gradient-to-tr from-indigo-600 via-purple-600 to-pink-500 flex items-center justify-center text-white shadow-md shadow-purple-500/20">
            <Palette className="w-5 h-5 stroke-[2.2]" />
          </div>
          <div>
            <div className="flex items-center gap-2">
              <h1 className="text-base sm:text-lg font-bold text-slate-900 tracking-tight flex items-center gap-1.5">
                <span>Vectorize</span>
                <span className="text-transparent bg-clip-text bg-gradient-to-r from-indigo-600 via-purple-600 to-pink-600 font-extrabold">
                  Colorful
                </span>
              </h1>
              <span className="px-2 py-0.5 text-[10px] font-bold uppercase tracking-wider rounded-md bg-indigo-50 text-indigo-700 border border-indigo-200/80">
                SVG &amp; EPS
              </span>

              {/* Requirement 6: Label di header menampilkan mode tracing aktif yang benar-benar dipakai */}
              <div className="flex items-center gap-1.5">
                <div
                  id="header-active-mode-badge"
                  className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-lg text-xs font-bold shadow-2xs border ${
                    activeCurveMode === 'polygon'
                      ? 'bg-indigo-600 text-white border-indigo-700'
                      : 'bg-purple-600 text-white border-purple-700'
                  }`}
                  title={`Mode Tracing Aktif: ${activeCurveMode === 'polygon' ? 'Polygon (Geometris/Tegas)' : 'Spline (Organik/Lengkung)'}`}
                >
                  {activeCurveMode === 'polygon' ? (
                    <Hexagon className="w-3.5 h-3.5" />
                  ) : (
                    <Spline className="w-3.5 h-3.5" />
                  )}
                  <span>
                    Mode: <strong>{activeCurveMode === 'polygon' ? 'Polygon' : 'Spline'}</strong>
                  </span>
                </div>

                <div className="inline-flex items-center p-0.5 bg-slate-100 border border-slate-200 rounded-lg text-[10px] font-semibold">
                  <button
                    type="button"
                    id="header-mode-polygon-btn"
                    onClick={() => onToggleCurveMode?.('polygon')}
                    className={`px-2 py-0.5 rounded-md transition cursor-pointer ${
                      activeCurveMode === 'polygon'
                        ? 'bg-white text-indigo-700 font-bold shadow-2xs'
                        : 'text-slate-600 hover:text-slate-900'
                    }`}
                  >
                    Polygon
                  </button>
                  <button
                    type="button"
                    id="header-mode-spline-btn"
                    onClick={() => onToggleCurveMode?.('spline')}
                    className={`px-2 py-0.5 rounded-md transition cursor-pointer ${
                      activeCurveMode === 'spline'
                        ? 'bg-white text-purple-700 font-bold shadow-2xs'
                        : 'text-slate-600 hover:text-slate-900'
                    }`}
                  >
                    Spline
                  </button>
                </div>
              </div>

              {/* Requirement 6: Tampilkan faktor upscale yang benar-benar dipakai di header */}
              <div
                id="header-active-upscale-badge"
                className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-lg text-xs font-bold bg-amber-50 text-amber-900 border border-amber-300 shadow-2xs"
                title={`Faktor Upscale yang benar-benar aktif/dipakai: ${actualUpscaleFactor !== undefined ? Number(actualUpscaleFactor.toFixed(1)) : 1}x`}
              >
                <ZoomIn className="w-3.5 h-3.5 text-amber-600" />
                <span>
                  Upscale: <strong>{actualUpscaleFactor !== undefined ? Number(actualUpscaleFactor.toFixed(1)) : 1}x</strong>
                </span>
              </div>

              {removeBgActive && bgMode === 'magenta' && (
                <span id="header-bg-magenta-badge" className="hidden lg:inline-flex items-center gap-1.5 px-2.5 py-1 text-xs font-bold rounded-lg bg-pink-50 text-pink-700 border border-pink-300 shadow-2xs">
                  <span className="w-2.5 h-2.5 rounded-full bg-[#FF00FF] border border-pink-400 shrink-0" />
                  <span>Bg: Magenta Transparan</span>
                </span>
              )}

              {removeBgActive && bgMode === 'white' && (
                <span id="header-bg-white-badge" className="hidden lg:inline-flex items-center gap-1.5 px-2.5 py-1 text-xs font-bold rounded-md bg-emerald-50 text-emerald-800 border border-emerald-300 shadow-2xs">
                  <SunMedium className="w-3.5 h-3.5 text-emerald-600" />
                  <span>Bg: Putih Transparan</span>
                </span>
              )}
            </div>
            <p className="text-xs text-slate-500 hidden sm:block">
              Vektor multi-warna + gradient asli, background putih transparan, putih di dalam objek bisa dipilih per area
            </p>
          </div>
        </div>

        {/* Global Stats & Actions */}
        <div className="flex items-center gap-2 sm:gap-3">
          {queueCount > 0 && (
            <div className="hidden md:flex items-center gap-2 px-3 py-1.5 rounded-lg bg-slate-100 text-xs font-medium text-slate-700 border border-slate-200">
              <span>Antrean: <strong>{queueCount}</strong></span>
              <span className="text-slate-300">|</span>
              <span className="text-emerald-700 flex items-center gap-1">
                <CheckCircle2 className="w-3.5 h-3.5" />
                <span>Selesai: <strong>{completedCount}</strong></span>
              </span>
            </div>
          )}

          {/* Batch Process Button */}
          {queueCount > 0 && completedCount < queueCount && (
            <button
              id="header-batch-process-btn"
              onClick={onBatchProcess}
              disabled={isProcessingBatch}
              className="inline-flex items-center gap-1.5 px-3.5 py-2 text-xs font-bold rounded-xl text-white bg-indigo-600 hover:bg-indigo-700 active:scale-95 transition disabled:opacity-50 shadow-sm shadow-indigo-600/20 cursor-pointer"
            >
              <Sparkles className="w-3.5 h-3.5" />
              <span>{isProcessingBatch ? 'Memproses...' : `Vektorisasi (${queueCount - completedCount})`}</span>
            </button>
          )}

          {/* Batch Download Button */}
          {completedCount > 0 && (
            <button
              id="header-batch-download-btn"
              onClick={onBatchDownload}
              className="inline-flex items-center gap-1.5 px-3.5 py-2 text-xs font-semibold rounded-xl text-slate-800 bg-slate-100 hover:bg-slate-200 active:scale-98 transition border border-slate-300 cursor-pointer"
            >
              <FileArchive className="w-3.5 h-3.5 text-indigo-600" />
              <span>Download ZIP ({completedCount})</span>
            </button>
          )}
        </div>
      </div>
    </header>
  );
};
