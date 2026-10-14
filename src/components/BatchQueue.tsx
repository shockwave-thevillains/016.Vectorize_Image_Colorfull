import React, { useState } from 'react';
import {
  Sparkles,
  Download,
  Trash2,
  Eye,
  RotateCcw,
  FileCode,
  FileBox,
  Layers,
  Archive,
  ChevronDown,
  AlertCircle,
  SunMedium,
  CheckCircle2,
  Maximize2,
  Tag,
  Hash,
} from 'lucide-react';
import { ImageQueueItem } from '../types';
import { formatBytes, downloadFile } from '../lib/vectorizer';
import { BatchZipMode } from '../lib/zipExporter';
import { formatFileName, getCleanBaseName } from '../lib/fileNameHelper';

interface BatchQueueProps {
  items: ImageQueueItem[];
  isProcessingBatch: boolean;
  onProcessItem: (itemId: string) => void;
  onProcessAll: () => void;
  onRemoveItem: (itemId: string) => void;
  onClearAll: () => void;
  onOpenPreview: (item: ImageQueueItem) => void;
  onBatchDownloadZip: (mode: BatchZipMode) => void;
  isExportingZip: boolean;
  fileCode?: string;
  onFileCodeChange?: (code: string) => void;
  startNumber?: number;
  onStartNumberChange?: (num: number) => void;
}

export const BatchQueue: React.FC<BatchQueueProps> = ({
  items,
  isProcessingBatch,
  onProcessItem,
  onProcessAll,
  onRemoveItem,
  onClearAll,
  onOpenPreview,
  onBatchDownloadZip,
  isExportingZip,
  fileCode = '',
  onFileCodeChange,
  startNumber = 1,
  onStartNumberChange,
}) => {
  const [zipDropdownOpen, setZipDropdownOpen] = useState(false);

  const completedCount = items.filter((i) => i.status === 'completed').length;
  const pendingCount = items.filter((i) => i.status === 'idle' || i.status === 'error').length;

  const handleDownloadSingleSvg = (item: ImageQueueItem, index: number, e: React.MouseEvent) => {
    e.stopPropagation();
    if (!item.result) return;
    const num = (startNumber || 1) + index;
    const effectiveCode = fileCode || item.config.fileCode;
    const filename = formatFileName(item.name, num, effectiveCode, 'svg');
    downloadFile(item.result.svgString, filename, 'image/svg+xml');
  };

  const handleDownloadSingleEps = (item: ImageQueueItem, index: number, e: React.MouseEvent) => {
    e.stopPropagation();
    if (!item.result) return;
    const num = (startNumber || 1) + index;
    const effectiveCode = fileCode || item.config.fileCode;
    const filename = formatFileName(item.name, num, effectiveCode, 'eps');
    downloadFile(item.result.epsString, filename, 'application/postscript');
  };

  const sampleBaseName = items[0] ? getCleanBaseName(items[0].name) : '600_01_stencil_voids_emblem';

  return (
    <div className="space-y-4">
      {/* Batch Control Toolbar */}
      <div className="bg-white rounded-2xl border border-slate-200 p-4 sm:p-5 shadow-xs flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <div className="flex items-center gap-2">
            <h2 className="text-base font-bold text-slate-900">
              Daftar Antrean Gambar
            </h2>
            <span className="px-2.5 py-0.5 text-xs font-bold rounded-full bg-slate-100 text-slate-700 border border-slate-200">
              {items.length} {items.length === 1 ? 'gambar' : 'gambar'}
            </span>
          </div>
          <p className="text-xs text-slate-500 mt-0.5">
            {completedCount} selesai di-vektorisasi, {pendingCount} menunggu diproses
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          {pendingCount > 0 && (
            <button
              id="batch-process-all-btn"
              type="button"
              disabled={isProcessingBatch}
              onClick={onProcessAll}
              className="inline-flex items-center gap-2 px-4 py-2 rounded-xl text-xs font-bold text-white bg-gradient-to-r from-indigo-600 to-purple-600 hover:from-indigo-700 hover:to-purple-700 active:scale-95 transition disabled:opacity-50 shadow-sm shadow-indigo-600/20 cursor-pointer"
            >
              <Sparkles className="w-4 h-4" />
              <span>{isProcessingBatch ? 'Memproses Batch...' : `Vektorisasi Semua (${pendingCount})`}</span>
            </button>
          )}

          {completedCount > 0 && (
            <div className="relative">
              <button
                id="batch-download-zip-menu-btn"
                type="button"
                disabled={isExportingZip}
                onClick={() => setZipDropdownOpen(!zipDropdownOpen)}
                className="inline-flex items-center gap-1.5 px-4 py-2 rounded-xl text-xs font-bold bg-emerald-50 hover:bg-emerald-100 border border-emerald-300 text-emerald-800 transition active:scale-95 disabled:opacity-50 shadow-2xs cursor-pointer"
              >
                <Archive className="w-4 h-4 text-emerald-600" />
                <span>{isExportingZip ? 'Menyiapkan ZIP...' : `Download Semua ZIP (${completedCount})`}</span>
                <ChevronDown className="w-3.5 h-3.5" />
              </button>

              {zipDropdownOpen && (
                <>
                  <div
                    className="fixed inset-0 z-20"
                    onClick={() => setZipDropdownOpen(false)}
                  />
                  <div className="absolute right-0 mt-2 w-64 bg-white rounded-2xl shadow-xl border border-slate-200 py-2 z-30 text-xs font-medium">
                    <button
                      id="download-zip-all-btn"
                      type="button"
                      onClick={() => {
                        setZipDropdownOpen(false);
                        onBatchDownloadZip('all');
                      }}
                      className="w-full text-left px-4 py-2.5 hover:bg-indigo-50/60 flex items-center justify-between text-slate-800 cursor-pointer"
                    >
                      <div className="flex items-center gap-2">
                        <Archive className="w-4 h-4 text-emerald-600" />
                        <div>
                          <span className="font-bold block">SVG + EPS (.zip)</span>
                          <span className="text-[10px] text-slate-400">Termasuk kedua format vektor</span>
                        </div>
                      </div>
                      <span className="text-[9px] bg-emerald-100 text-emerald-800 px-1.5 py-0.5 rounded font-bold">
                        Lengkap
                      </span>
                    </button>

                    <button
                      id="download-zip-svg-btn"
                      type="button"
                      onClick={() => {
                        setZipDropdownOpen(false);
                        onBatchDownloadZip('svg_only');
                      }}
                      className="w-full text-left px-4 py-2.5 hover:bg-slate-50 flex items-center gap-2 text-slate-700 cursor-pointer"
                    >
                      <FileCode className="w-4 h-4 text-indigo-500" />
                      <div>
                        <span className="font-semibold block">Hanya File SVG (.zip)</span>
                        <span className="text-[10px] text-slate-400">Format web SVG</span>
                      </div>
                    </button>

                    <button
                      id="download-zip-eps-btn"
                      type="button"
                      onClick={() => {
                        setZipDropdownOpen(false);
                        onBatchDownloadZip('eps_only');
                      }}
                      className="w-full text-left px-4 py-2.5 hover:bg-slate-50 flex items-center gap-2 text-slate-700 cursor-pointer"
                    >
                      <FileBox className="w-4 h-4 text-amber-500" />
                      <div>
                        <span className="font-semibold block">Hanya File EPS (.zip)</span>
                        <span className="text-[10px] text-slate-400">Format cetak Adobe Illustrator / Corel</span>
                      </div>
                    </button>
                  </div>
                </>
              )}
            </div>
          )}

          <button
            id="clear-all-queue-btn"
            type="button"
            onClick={onClearAll}
            className="p-2 text-slate-400 hover:text-rose-600 hover:bg-rose-50 rounded-xl transition cursor-pointer"
            title="Hapus semua gambar"
          >
            <Trash2 className="w-4 h-4" />
          </button>
        </div>
      </div>

      {/* File Name Code & Numbering Prefix Toolbar */}
      <div className="bg-gradient-to-r from-indigo-50/90 via-purple-50/70 to-slate-50/90 rounded-2xl border border-indigo-100 p-3.5 sm:p-4 shadow-2xs flex flex-col md:flex-row md:items-center justify-between gap-3">
        <div className="flex flex-wrap items-center gap-3">
          <div className="flex items-center gap-2">
            <div className="w-8 h-8 rounded-lg bg-indigo-600 text-white flex items-center justify-center shadow-xs">
              <Tag className="w-4 h-4" />
            </div>
            <div>
              <span className="text-xs font-bold text-slate-800 flex items-center gap-1.5">
                Kode Nama File (Batch Prefix)
              </span>
              <p className="text-[10px] text-slate-500">
                Pola penamaan otomatis: <code className="text-indigo-700 font-semibold">[kode]_[urutan]_[nama_awal]</code>
              </p>
            </div>
          </div>

          <div className="flex items-center gap-2 pl-10 sm:pl-0">
            <div className="relative">
              <input
                id="batch-file-code-input"
                type="text"
                value={fileCode || ''}
                onChange={(e) => onFileCodeChange?.(e.target.value)}
                placeholder="Misal: 011"
                className="w-28 sm:w-36 px-3 py-1.5 text-xs font-mono font-bold bg-white border border-indigo-200 rounded-xl text-slate-900 placeholder-slate-400 focus:outline-hidden focus:ring-2 focus:ring-indigo-500/30 focus:border-indigo-500 shadow-2xs transition"
                title="Masukkan kode file (misal 011)"
              />
            </div>

            <div className="flex items-center gap-1 bg-white border border-slate-200 px-2 py-1 rounded-xl shadow-2xs text-xs" title="Nomor urut mulai (default 1)">
              <span className="text-[10px] text-slate-400 font-medium">Mulai:</span>
              <input
                id="batch-start-number-input"
                type="number"
                min="1"
                value={startNumber || 1}
                onChange={(e) => onStartNumberChange?.(Math.max(1, parseInt(e.target.value, 10) || 1))}
                className="w-10 text-xs font-mono font-bold text-slate-800 focus:outline-hidden text-center"
              />
            </div>

            {fileCode && (
              <button
                type="button"
                onClick={() => onFileCodeChange?.('')}
                className="text-xs text-rose-600 hover:text-rose-700 font-medium px-1.5 py-1 rounded hover:bg-rose-50 cursor-pointer transition"
                title="Reset kode file"
              >
                Reset
              </button>
            )}
          </div>
        </div>

        <div className="text-xs flex items-center gap-2 pl-10 md:pl-0 flex-wrap">
          <span className="text-[11px] text-slate-400 font-medium">Contoh Hasil:</span>
          {fileCode ? (
            <div className="inline-flex items-center gap-1.5 bg-white border border-indigo-200 px-2.5 py-1 rounded-lg shadow-2xs font-mono text-xs">
              <span className="font-extrabold text-indigo-700">
                {fileCode.trim()}_{startNumber || 1}_{sampleBaseName}
              </span>
              <span className="text-slate-400">,</span>
              <span className="text-indigo-600/70">
                {fileCode.trim()}_{(startNumber || 1) + 1}_...
              </span>
              <span className="text-[10px] text-emerald-700 font-sans font-bold bg-emerald-50 px-1.5 py-0.2 rounded border border-emerald-200 ml-1">
                {items.length} file
              </span>
            </div>
          ) : (
            <span className="text-slate-500 italic text-xs">
              Belum ada kode (file memakai nama asli: {sampleBaseName}.svg)
            </span>
          )}
        </div>
      </div>

      {/* Queue Items List */}
      <div className="space-y-3">
        {items.map((item, index) => {
          const isCompleted = item.status === 'completed';
          const isProcessing = item.status === 'processing';
          const isError = item.status === 'error';
          const itemNumber = (startNumber || 1) + index;
          const effectiveCode = fileCode || item.config.fileCode;
          const cleanBase = getCleanBaseName(item.name);
          const formattedName = formatFileName(item.name, itemNumber, effectiveCode);

          return (
            <div
              key={item.id}
              id={`queue-item-${item.id}`}
              className={`bg-white rounded-2xl border p-4 transition-all duration-200 flex flex-col md:flex-row md:items-center justify-between gap-4 ${
                isCompleted
                  ? 'border-slate-200 hover:border-indigo-300 shadow-xs'
                  : isProcessing
                  ? 'border-indigo-300 bg-indigo-50/20 shadow-md ring-1 ring-indigo-200'
                  : isError
                  ? 'border-rose-200 bg-rose-50/30'
                  : 'border-slate-200'
              }`}
            >
              {/* Left Column */}
              <div className="flex items-center gap-3.5 min-w-0 flex-1">
                <div
                  onClick={() => isCompleted && onOpenPreview(item)}
                  className={`relative w-16 h-16 sm:w-20 sm:h-20 rounded-xl overflow-hidden bg-slate-100 border border-slate-200 shrink-0 ${
                    isCompleted ? 'cursor-pointer group' : ''
                  }`}
                  style={{
                    backgroundImage: 'linear-gradient(45deg, #e2e8f0 25%, transparent 25%), linear-gradient(-45deg, #e2e8f0 25%, transparent 25%), linear-gradient(45deg, transparent 75%, #e2e8f0 75%), linear-gradient(-45deg, transparent 75%, #e2e8f0 75%)',
                    backgroundSize: '12px 12px',
                    backgroundPosition: '0 0, 0 6px, 6px -6px, -6px 0px',
                  }}
                >
                  <img
                    src={item.previewUrl}
                    alt={item.name}
                    className="w-full h-full object-cover"
                  />
                  {isCompleted && (
                    <div className="absolute inset-0 bg-indigo-900/60 opacity-0 group-hover:opacity-100 transition flex items-center justify-center text-white backdrop-blur-2xs">
                      <Eye className="w-5 h-5" />
                    </div>
                  )}
                  {isProcessing && (
                    <div className="absolute inset-0 bg-indigo-900/50 backdrop-blur-xs flex items-center justify-center text-white">
                      <div className="w-5 h-5 border-2 border-white border-t-transparent rounded-full animate-spin" />
                    </div>
                  )}
                </div>

                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className="text-xs font-mono text-slate-400">
                      #{itemNumber}
                    </span>
                    {effectiveCode ? (
                      <div className="flex items-center gap-1.5 min-w-0">
                        <span className="text-[11px] font-mono font-extrabold px-2 py-0.5 rounded-md bg-indigo-100 text-indigo-900 border border-indigo-200 shrink-0">
                          {effectiveCode.trim()}_{itemNumber}
                        </span>
                        <h3
                          className="text-sm font-bold text-slate-900 truncate max-w-xs sm:max-w-sm"
                          title={`${formattedName} (Asal: ${item.name})`}
                        >
                          <span className="text-indigo-600 font-mono font-bold mr-0.5">{effectiveCode.trim()}_{itemNumber}_</span>
                          {cleanBase}
                        </h3>
                      </div>
                    ) : (
                      <h3
                        className="text-sm font-bold text-slate-900 truncate max-w-xs sm:max-w-sm"
                        title={item.name}
                      >
                        {item.name}
                      </h3>
                    )}
                    <span className="text-[11px] px-2 py-0.5 rounded-md bg-indigo-50 text-indigo-700 font-bold border border-indigo-100">
                      {item.config.preset}
                    </span>
                    {item.config.removeBackground !== false && (item.config.bgMode ?? 'white') === 'magenta' && (
                      <span className="text-[10px] px-2 py-0.5 rounded-md bg-pink-50 text-pink-700 font-bold border border-pink-200 flex items-center gap-1">
                        <span className="w-2 h-2 rounded-full bg-[#FF00FF] border border-pink-300 shrink-0" />
                        <span>Magenta Transparan (±{item.config.magentaTolerance ?? 14}%)</span>
                      </span>
                    )}
                    {item.config.removeBackground !== false && item.config.bgMode === 'white' && (
                      <span className="text-[10px] px-2 py-0.5 rounded-md bg-emerald-50 text-emerald-800 font-bold border border-emerald-200 flex items-center gap-1">
                        <SunMedium className="w-3 h-3 text-emerald-600" />
                        <span>
                          {item.config.keepInnerWhite !== false
                            ? 'Putih Transparan (Tengah Aman)'
                            : 'Semua Putih Transparan'}
                          {(item.config.whiteRegionOverrides?.length ?? 0) > 0 &&
                            ` · ${item.config.whiteRegionOverrides!.length} area diubah`}
                          {item.config.removeShadow ? ' · tanpa bayangan' : ''}
                        </span>
                      </span>
                    )}
                    {item.config.upscale && item.config.upscale > 1 && (
                      <span className="text-[10px] px-2 py-0.5 rounded-md bg-amber-50 text-amber-800 font-bold border border-amber-200 flex items-center gap-0.5">
                        <Sparkles className="w-2.5 h-2.5 text-amber-600" />
                        <span>{item.config.upscale}x</span>
                      </span>
                    )}
                    {(item.result?.gradientCount ?? 0) > 0 && (
                      <span
                        className="text-[10px] px-2 py-0.5 rounded-md bg-rose-50 text-rose-800 font-bold border border-rose-200"
                        title="Area yang menjadi gradient vektor asli (linear/radial)"
                      >
                        {item.result!.gradientCount} gradien
                        {(item.result!.gradientFallbackCount ?? 0) > 0 && ` · ${item.result!.gradientFallbackCount} pita`}
                      </span>
                    )}
                    {item.result?.usedFallback && (
                      <span
                        className="text-[10px] px-2 py-0.5 rounded-md bg-rose-100 text-rose-800 font-bold border border-rose-300"
                        title={item.result.warnings?.[0]}
                      >
                        Fallback ImageTracer — proses ulang
                      </span>
                    )}
                  </div>

                  <div className="flex flex-wrap items-center gap-x-2.5 gap-y-1 mt-1 text-xs text-slate-500">
                    <span>
                      {item.width} × {item.height}px
                    </span>
                    <span className="text-slate-300">•</span>
                    <span>{formatBytes(item.originalSize)}</span>
                    {effectiveCode && (
                      <>
                        <span className="text-slate-300">•</span>
                        <span className="text-[11px] text-slate-400">
                          Asal: {item.name}
                        </span>
                      </>
                    )}
                    {item.result && (
                      <>
                        <span className="text-slate-300">•</span>
                        <span className="font-bold text-indigo-700 flex items-center gap-1">
                          <Layers className="w-3 h-3" />
                          {item.result.colorCount} warna
                          <span className="text-[10px] font-normal text-indigo-600 bg-indigo-50 px-1 py-0.5 rounded border border-indigo-100">
                            ({item.result.rawColorCount ?? item.result.colorCount} → {item.result.mergedColorCount ?? item.result.colorCount})
                          </span>
                        </span>
                        <span className="text-slate-300">•</span>
                        <span className="font-bold text-indigo-700 bg-indigo-50 px-1.5 py-0.5 rounded border border-indigo-200 text-[10px] flex items-center gap-1">
                          <Maximize2 className="w-3 h-3 text-indigo-600" />
                          <span>
                            {item.result.outputMegaPixels
                              ? `${item.result.outputMegaPixels} MP (${item.result.width}×${item.result.height})`
                              : `${item.result.width}×${item.result.height} px`}
                          </span>
                        </span>
                        <span className="text-slate-300">•</span>
                        <span className="text-slate-600">
                          {item.result.pathCount} path kurva
                        </span>
                        <span className="text-slate-300">•</span>
                        {item.result.qualityScore === 'warning' ? (
                          <span className="text-amber-700 font-bold bg-amber-50 px-1.5 py-0.5 rounded border border-amber-200 text-[10px]">
                            Path Tinggi ({item.result.pathCount})
                          </span>
                        ) : (
                          <span className="text-emerald-700 font-bold bg-emerald-50 px-1.5 py-0.5 rounded border border-emerald-200 text-[10px]">
                            Rapi ({item.result.pathCount} path)
                          </span>
                        )}
                        <span className="text-slate-300">•</span>
                        <span className="text-emerald-700 font-semibold">
                          SVG: {formatBytes(item.result.svgSize)} • EPS: {formatBytes(item.result.epsSize)}
                        </span>
                      </>
                    )}
                  </div>

                  {isProcessing && (
                    <div className="mt-2.5 max-w-md">
                      <div className="flex justify-between text-[11px] text-indigo-700 font-semibold mb-1">
                        <span>Menelusuri kurva multi-warna &amp; menghasilkan EPS...</span>
                        <span>{item.progress}%</span>
                      </div>
                      <div className="w-full h-1.5 bg-indigo-100 rounded-full overflow-hidden">
                        <div
                          className="h-full bg-indigo-600 transition-all duration-300 rounded-full"
                          style={{ width: `${item.progress}%` }}
                        />
                      </div>
                    </div>
                  )}

                  {isError && (
                    <div className="mt-1 flex items-center gap-1 text-xs text-rose-600 font-medium">
                      <AlertCircle className="w-3.5 h-3.5 shrink-0" />
                      <span>{item.error || 'Vektorisasi gagal'}</span>
                    </div>
                  )}
                </div>
              </div>

              {/* Right Column */}
              <div className="flex items-center gap-2 self-end md:self-auto shrink-0 pt-2 md:pt-0 border-t md:border-t-0 border-slate-100 w-full md:w-auto justify-end">
                {isCompleted && item.result && (
                  <>
                    <button
                      id={`inspect-item-btn-${item.id}`}
                      type="button"
                      onClick={() => onOpenPreview(item)}
                      className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-xl text-xs font-bold text-indigo-700 bg-indigo-50 hover:bg-indigo-100 transition cursor-pointer"
                      title="Bandingkan Gambar Asli vs Vektor (Slider Interaktif)"
                    >
                      <Eye className="w-3.5 h-3.5" />
                      <span>Bandingkan</span>
                    </button>
                    <button
                      id={`download-svg-btn-${item.id}`}
                      type="button"
                      onClick={(e) => handleDownloadSingleSvg(item, index, e)}
                      className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-xl text-xs font-semibold text-slate-700 bg-slate-100 hover:bg-slate-200 transition cursor-pointer"
                      title={`Unduh berkas SVG (${formattedName}.svg)`}
                    >
                      <Download className="w-3.5 h-3.5 text-indigo-600" />
                      <span>SVG</span>
                    </button>
                    <button
                      id={`download-eps-btn-${item.id}`}
                      type="button"
                      onClick={(e) => handleDownloadSingleEps(item, index, e)}
                      className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-xl text-xs font-semibold text-slate-700 bg-slate-100 hover:bg-slate-200 transition cursor-pointer"
                      title={`Unduh berkas EPS Level 3 (${formattedName}.eps)`}
                    >
                      <Download className="w-3.5 h-3.5 text-amber-600" />
                      <span>EPS</span>
                    </button>
                  </>
                )}

                {item.status === 'idle' && (
                  <button
                    id={`process-item-btn-${item.id}`}
                    type="button"
                    disabled={isProcessingBatch}
                    onClick={() => onProcessItem(item.id)}
                    className="inline-flex items-center gap-1.5 px-4 py-1.5 rounded-xl text-xs font-bold text-white bg-indigo-600 hover:bg-indigo-700 transition disabled:opacity-50 cursor-pointer shadow-2xs"
                  >
                    <Sparkles className="w-3.5 h-3.5" />
                    <span>Vektorisasi</span>
                  </button>
                )}

                {isError && (
                  <button
                    id={`retry-item-btn-${item.id}`}
                    type="button"
                    onClick={() => onProcessItem(item.id)}
                    className="inline-flex items-center gap-1.5 px-3.5 py-1.5 rounded-xl text-xs font-semibold text-rose-700 bg-rose-100 hover:bg-rose-200 transition cursor-pointer"
                  >
                    <RotateCcw className="w-3.5 h-3.5" />
                    <span>Coba Lagi</span>
                  </button>
                )}

                <button
                  id={`remove-item-btn-${item.id}`}
                  type="button"
                  onClick={() => onRemoveItem(item.id)}
                  className="p-2 text-slate-400 hover:text-rose-600 hover:bg-slate-100 rounded-xl transition cursor-pointer"
                  title="Hapus gambar dari antrean"
                >
                  <Trash2 className="w-3.5 h-3.5" />
                </button>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
};
