import React, { useState, useRef, useEffect } from 'react';
import {
  X,
  Download,
  Copy,
  Check,
  ZoomIn,
  ZoomOut,
  Maximize2,
  Code,
  FileBox,
  Split,
  Columns,
  Sparkles,
  Sliders,
  Layers,
  Clock,
  HardDrive,
  SunMedium,
  Droplet,
  Grid,
  Lock,
  Unlock,
  Image as ImageIcon,
} from 'lucide-react';
import { ImageQueueItem, VectorizeConfig, OutputResolutionPreset } from '../types';
import { formatBytes, downloadFile } from '../lib/vectorizer';
import {
  getOutputDimensionsForConfig,
  scaleSvg,
  renderSvgToPngBlob,
  MIN_OUTPUT_MEGAPIXELS,
} from '../lib/svgRescaler';
import { convertSvgToEps } from '../lib/epsConverter';
import { formatFileName, getCleanBaseName } from '../lib/fileNameHelper';

interface VectorPreviewModalProps {
  item: ImageQueueItem | null;
  itemIndex?: number;
  fileCode?: string;
  onClose: () => void;
  onReVectorize: (itemId: string, newConfig: VectorizeConfig) => void;
  isProcessing: boolean;
}

export const VectorPreviewModal: React.FC<VectorPreviewModalProps> = ({
  item,
  itemIndex = 1,
  fileCode = '',
  onClose,
  onReVectorize,
  isProcessing,
}) => {
  const [activeTab, setActiveTab] = useState<'compare' | 'svg' | 'eps' | 'stats'>('compare');
  const [viewMode, setViewMode] = useState<'split' | 'sideBySide'>('split');
  const [sliderPosition, setSliderPosition] = useState<number>(50); // percentage 0..100
  const [zoomLevel, setZoomLevel] = useState<number>(1);
  const [copiedType, setCopiedType] = useState<'svg' | 'eps' | 'hex' | null>(null);
  const [copiedColorHex, setCopiedColorHex] = useState<string | null>(null);
  const [previewBg, setPreviewBg] = useState<'checker' | 'white' | 'dark' | 'navy'>('checker');
  const [modalConfig, setModalConfig] = useState<VectorizeConfig | null>(null);
  const [showConfigDrawer, setShowConfigDrawer] = useState<boolean>(false);
  const [outputPreset, setOutputPreset] = useState<OutputResolutionPreset>(
    item?.config.outputResolutionPreset || '15mp'
  );
  const [customMP, setCustomMP] = useState<number>(
    Math.max(MIN_OUTPUT_MEGAPIXELS, item?.config.outputMegaPixels || MIN_OUTPUT_MEGAPIXELS)
  );
  const [isExportingPng, setIsExportingPng] = useState<boolean>(false);

  const containerRef = useRef<HTMLDivElement>(null);
  const isDraggingSlider = useRef<boolean>(false);

  useEffect(() => {
    if (item) {
      setModalConfig({ ...item.config });
      setOutputPreset(item.config.outputResolutionPreset || '15mp');
      setCustomMP(Math.max(MIN_OUTPUT_MEGAPIXELS, item.config.outputMegaPixels || MIN_OUTPUT_MEGAPIXELS));
    }
  }, [item]);

  if (!item || !item.result) return null;

  const result = item.result;

  const currentResolution = getOutputDimensionsForConfig(result.width, result.height, {
    outputResolutionPreset: outputPreset,
    outputMegaPixels: customMP,
  });

  const getExportSvg = () => {
    if (currentResolution.isNative) return result.svgString;
    return scaleSvg(result.svgString, currentResolution.width, currentResolution.height);
  };

  const getExportEps = () => {
    if (currentResolution.isNative) return result.epsString;
    const epsTitle = `${item.name.replace(/\.[^/.]+$/, '')}.eps`;
    const scaledSvg = getExportSvg();
    const isMagentaMode = (item.config.bgMode ?? 'magenta') === 'magenta';
    const isWhiteMode = item.config.bgMode === 'white';
    const skipWhite = Boolean(isWhiteMode && item.config.keepInnerWhite === false);
    const skipMagenta = Boolean(isMagentaMode && item.config.removeBackground !== false);
    return convertSvgToEps(
      scaledSvg,
      epsTitle,
      skipWhite,
      skipMagenta,
      item.config.magentaTolerance ?? 14
    );
  };

  const handleSelectOutputPreset = (preset: OutputResolutionPreset) => {
    setOutputPreset(preset);
    let mp = MIN_OUTPUT_MEGAPIXELS;
    if (preset === '20mp') mp = 20;
    else if (preset === '25mp') mp = 25;
    else if (preset === '30mp') mp = 30;
    else if (preset === 'custom') mp = Math.max(MIN_OUTPUT_MEGAPIXELS, customMP);
    else if (preset === 'native') mp = 0;
    else mp = MIN_OUTPUT_MEGAPIXELS;

    if (modalConfig) {
      setModalConfig({
        ...modalConfig,
        outputResolutionPreset: preset,
        outputMegaPixels: mp,
      });
    }
  };

  const handleToggleLockColor = (hex: string) => {
    if (!modalConfig) return;
    const currentLocked = modalConfig.lockedPalette || [];
    const isAlready = currentLocked.includes(hex);
    const updated = isAlready ? currentLocked.filter((c) => c !== hex) : [...currentLocked, hex];
    const newCfg: VectorizeConfig = {
      ...modalConfig,
      lockedPalette: updated,
    };
    setModalConfig(newCfg);
  };

  const handleSliderMove = (clientX: number) => {
    if (!containerRef.current) return;
    const rect = containerRef.current.getBoundingClientRect();
    const x = Math.max(0, Math.min(clientX - rect.left, rect.width));
    const percent = (x / rect.width) * 100;
    setSliderPosition(percent);
  };

  const handleMouseDown = (e: React.MouseEvent) => {
    isDraggingSlider.current = true;
    handleSliderMove(e.clientX);
  };

  const handleMouseMove = (e: React.MouseEvent) => {
    if (isDraggingSlider.current) {
      handleSliderMove(e.clientX);
    }
  };

  const handleMouseUp = () => {
    isDraggingSlider.current = false;
  };

  const handleTouchMove = (e: React.TouchEvent) => {
    if (e.touches.length > 0) {
      handleSliderMove(e.touches[0].clientX);
    }
  };

  const handleCopyCode = async (type: 'svg' | 'eps') => {
    const text = type === 'svg' ? result.svgString : result.epsString;
    await navigator.clipboard.writeText(text);
    setCopiedType(type);
    setTimeout(() => setCopiedType(null), 2000);
  };

  const handleCopyHex = async (hex: string) => {
    await navigator.clipboard.writeText(hex);
    setCopiedColorHex(hex);
    setTimeout(() => setCopiedColorHex(null), 1500);
  };

  const handleToggleColorTransparency = (hex: string) => {
    if (!modalConfig) return;
    const current = modalConfig.transparentColors || [];
    const isAlready = current.includes(hex);
    const updated = isAlready ? current.filter((c) => c !== hex) : [...current, hex];
    const newCfg: VectorizeConfig = {
      ...modalConfig,
      transparentColors: updated,
    };
    setModalConfig(newCfg);
    onReVectorize(item.id, newCfg);
  };

  const effectiveCode = fileCode || item.config.fileCode;
  const formattedBaseName = formatFileName(item.name, itemIndex, effectiveCode);

  const handleDownloadSvg = () => {
    const filename = `${formattedBaseName}.svg`;
    downloadFile(getExportSvg(), filename, 'image/svg+xml');
  };

  const handleDownloadEps = () => {
    const filename = `${formattedBaseName}.eps`;
    downloadFile(getExportEps(), filename, 'application/postscript');
  };

  const handleDownloadPng = async () => {
    try {
      setIsExportingPng(true);
      const svgToRender = getExportSvg();
      const blob = await renderSvgToPngBlob(svgToRender, currentResolution.width, currentResolution.height);
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `${formattedBaseName}.png`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      setTimeout(() => URL.revokeObjectURL(url), 1500);
    } catch (err: any) {
      console.error('Failed to export PNG:', err);
    } finally {
      setIsExportingPng(false);
    }
  };

  const handleApplyModalConfig = () => {
    if (modalConfig) {
      onReVectorize(item.id, modalConfig);
    }
  };

  const getBackgroundStyle = () => {
    switch (previewBg) {
      case 'white':
        return { backgroundColor: '#ffffff' };
      case 'dark':
        return { backgroundColor: '#0f172a' };
      case 'navy':
        return { backgroundColor: '#1e1b4b' };
      case 'checker':
      default:
        return {
          backgroundColor: '#ffffff',
          backgroundImage:
            'linear-gradient(45deg, #e2e8f0 25%, transparent 25%), linear-gradient(-45deg, #e2e8f0 25%, transparent 25%), linear-gradient(45deg, transparent 75%, #e2e8f0 75%), linear-gradient(-45deg, transparent 75%, #e2e8f0 75%)',
          backgroundSize: '16px 16px',
          backgroundPosition: '0 0, 0 8px, 8px -8px, -8px 0px',
        };
    }
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-2 sm:p-4 bg-slate-900/80 backdrop-blur-sm"
      onMouseUp={handleMouseUp}
    >
      <div
        id="vector-preview-modal-dialog"
        className="bg-white rounded-2xl w-full max-w-5xl h-[92vh] flex flex-col overflow-hidden shadow-2xl border border-slate-200 animate-in fade-in zoom-in-95 duration-200"
      >
        {/* Modal Header */}
        <div className="px-5 py-3 border-b border-slate-200 bg-slate-50 flex items-center justify-between shrink-0">
          <div className="flex items-center gap-3 min-w-0">
            <div className="w-8 h-8 rounded-lg bg-gradient-to-tr from-indigo-600 to-purple-600 text-white flex items-center justify-center font-bold text-xs shadow-2xs">
              SVG
            </div>
            <div className="min-w-0">
              <h2 className="text-sm sm:text-base font-bold text-slate-900 truncate flex items-center gap-2">
                <span>{formattedBaseName}</span>
                {effectiveCode && (
                  <span className="text-[10px] font-mono font-extrabold px-2 py-0.5 rounded-md bg-indigo-100 text-indigo-900 border border-indigo-200">
                    Kode: {effectiveCode.trim()}_{itemIndex}
                  </span>
                )}
                {item.config.removeBackground !== false && (item.config.bgMode ?? 'magenta') === 'magenta' && (
                  <span className="text-[10px] font-bold px-2 py-0.5 rounded-full bg-pink-100 text-pink-800 border border-pink-300 flex items-center gap-1">
                    <span className="w-2 h-2 rounded-full bg-[#FF00FF] border border-pink-400" />
                    <span>Magenta Transparan (±{item.config.magentaTolerance ?? 14}%)</span>
                  </span>
                )}
                {item.config.removeBackground !== false && item.config.bgMode === 'white' && (
                  <span className="text-[10px] font-bold px-2 py-0.5 rounded-full bg-emerald-100 text-emerald-800 border border-emerald-200 flex items-center gap-1">
                    <SunMedium className="w-3 h-3 text-emerald-600" />
                    <span>Putih Transparan</span>
                  </span>
                )}
              </h2>
              <div className="flex items-center gap-2 text-xs text-slate-500 flex-wrap">
                {effectiveCode && (
                  <>
                    <span className="text-[11px] text-slate-400">Asal: {item.name}</span>
                    <span>•</span>
                  </>
                )}
                <span className="font-bold text-indigo-700 bg-indigo-50 px-2 py-0.5 rounded border border-indigo-200">
                  {currentResolution.width.toLocaleString('id-ID')} × {currentResolution.height.toLocaleString('id-ID')} px ({currentResolution.megaPixels} MP)
                </span>
                <span>•</span>
                <span className="font-semibold text-indigo-700">{result.colorCount} warna</span>
                <span>•</span>
                <span>{result.pathCount} path kurva</span>
                <span>•</span>
                <span className="inline-flex items-center gap-1 font-semibold text-indigo-700 bg-indigo-50 px-2 py-0.5 rounded-full border border-indigo-200 text-[10px]">
                  <span>@visioncortex/vtracer WASM</span>
                </span>
                {result.qualityScore === 'warning' ? (
                  <span className="inline-flex items-center gap-1 font-bold text-amber-800 bg-amber-50 px-2 py-0.5 rounded-full border border-amber-300 text-[10px]" title={result.qualityMessage}>
                    <span>⚠ {result.pathCount} path</span>
                  </span>
                ) : (
                  <span className="inline-flex items-center gap-1 font-bold text-emerald-700 bg-emerald-50 px-2 py-0.5 rounded-full border border-emerald-200 text-[10px]">
                    <span>✓ Rapi ({result.pathCount} path)</span>
                  </span>
                )}
              </div>
            </div>
          </div>

          <div className="flex items-center gap-2 flex-wrap justify-end">
            <div className="inline-flex items-center p-0.5 bg-slate-100 rounded-xl border border-slate-200 text-xs font-bold gap-1">
              <span className="text-[10px] text-slate-500 uppercase px-1.5 flex items-center gap-1">
                <Maximize2 className="w-3 h-3 text-indigo-600" />
                <span className="hidden sm:inline">Ukuran:</span>
              </span>
              {[
                { id: '15mp' as const, label: '15 MP' },
                { id: '20mp' as const, label: '20 MP' },
                { id: '25mp' as const, label: '25 MP' },
                { id: '30mp' as const, label: '30 MP' },
                { id: 'native' as const, label: 'Asli' },
              ].map((r) => {
                const isSelected = outputPreset === r.id;
                return (
                  <button
                    key={r.id}
                    type="button"
                    onClick={() => handleSelectOutputPreset(r.id)}
                    className={`px-2 py-0.5 rounded-lg text-[11px] font-bold transition cursor-pointer ${
                      isSelected
                        ? 'bg-indigo-600 text-white shadow-2xs'
                        : 'text-slate-600 hover:text-slate-900 hover:bg-slate-200'
                    }`}
                  >
                    {r.label}
                  </button>
                );
              })}
            </div>

            <button
              id="modal-download-svg-btn"
              onClick={handleDownloadSvg}
              className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-bold rounded-xl bg-indigo-600 hover:bg-indigo-700 text-white shadow-sm transition active:scale-95 cursor-pointer"
              title={`Download berkas SVG (${currentResolution.width} × ${currentResolution.height} px, ${currentResolution.megaPixels} MP)`}
            >
              <Download className="w-3.5 h-3.5" />
              <span>SVG ({currentResolution.isNative ? 'Asli' : `${currentResolution.megaPixels} MP`})</span>
            </button>

            <button
              id="modal-download-eps-btn"
              onClick={handleDownloadEps}
              className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-bold rounded-xl bg-amber-600 hover:bg-amber-700 text-white shadow-sm transition active:scale-95 cursor-pointer"
              title={`Download berkas EPS Level 3 (${currentResolution.width} × ${currentResolution.height} px, ${currentResolution.megaPixels} MP)`}
            >
              <Download className="w-3.5 h-3.5" />
              <span>EPS ({currentResolution.isNative ? 'Asli' : `${currentResolution.megaPixels} MP`})</span>
            </button>

            <button
              id="modal-download-png-btn"
              onClick={handleDownloadPng}
              disabled={isExportingPng}
              className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-bold rounded-xl bg-emerald-600 hover:bg-emerald-700 disabled:bg-emerald-400 text-white shadow-sm transition active:scale-95 cursor-pointer"
              title={`Download raster PNG resolusi tinggi (${currentResolution.width} × ${currentResolution.height} px, ${currentResolution.megaPixels} MP)`}
            >
              <ImageIcon className="w-3.5 h-3.5" />
              <span>{isExportingPng ? 'Rendering...' : `PNG (${currentResolution.isNative ? 'Asli' : `${currentResolution.megaPixels} MP`})`}</span>
            </button>

            <button
              id="modal-close-btn"
              onClick={onClose}
              className="p-1.5 text-slate-400 hover:text-slate-700 hover:bg-slate-200 rounded-xl transition cursor-pointer"
            >
              <X className="w-5 h-5" />
            </button>
          </div>
        </div>

        {/* Modal Tabs Bar */}
        <div className="px-5 py-2 border-b border-slate-200 bg-white flex items-center justify-between flex-wrap gap-2 shrink-0">
          <div className="flex items-center gap-1">
            <button
              id="tab-compare-btn"
              onClick={() => setActiveTab('compare')}
              className={`px-3 py-1.5 text-xs font-bold rounded-lg transition cursor-pointer ${
                activeTab === 'compare'
                  ? 'bg-slate-900 text-white shadow-2xs'
                  : 'text-slate-600 hover:bg-slate-100'
              }`}
            >
              Bandingkan Vektor
            </button>
            <button
              id="tab-svg-btn"
              onClick={() => setActiveTab('svg')}
              className={`px-3 py-1.5 text-xs font-bold rounded-lg transition flex items-center gap-1.5 cursor-pointer ${
                activeTab === 'svg'
                  ? 'bg-slate-900 text-white shadow-2xs'
                  : 'text-slate-600 hover:bg-slate-100'
              }`}
            >
              <Code className="w-3.5 h-3.5" />
              <span>Kode SVG</span>
            </button>
            <button
              id="tab-eps-btn"
              onClick={() => setActiveTab('eps')}
              className={`px-3 py-1.5 text-xs font-bold rounded-lg transition flex items-center gap-1.5 cursor-pointer ${
                activeTab === 'eps'
                  ? 'bg-slate-900 text-white shadow-2xs'
                  : 'text-slate-600 hover:bg-slate-100'
              }`}
            >
              <FileBox className="w-3.5 h-3.5" />
              <span>Kode EPS</span>
            </button>
            <button
              id="tab-stats-btn"
              onClick={() => setActiveTab('stats')}
              className={`px-3 py-1.5 text-xs font-bold rounded-lg transition cursor-pointer ${
                activeTab === 'stats'
                  ? 'bg-slate-900 text-white shadow-2xs'
                  : 'text-slate-600 hover:bg-slate-100'
              }`}
            >
              Spesifikasi
            </button>
          </div>

          {activeTab === 'compare' && (
            <div className="flex items-center gap-2 text-xs flex-wrap">
              <div className="flex items-center bg-slate-100 p-0.5 rounded-lg border border-slate-200">
                <span className="text-[10px] font-semibold text-slate-500 px-1.5 hidden sm:inline">Latar:</span>
                <button
                  type="button"
                  onClick={() => setPreviewBg('checker')}
                  className={`px-2 py-1 rounded-md text-[11px] font-semibold transition cursor-pointer flex items-center gap-1 ${
                    previewBg === 'checker'
                      ? 'bg-white text-slate-900 shadow-2xs font-bold'
                      : 'text-slate-600 hover:text-slate-900'
                  }`}
                  title="Papan Catur (Transparansi)"
                >
                  <Grid className="w-3 h-3 text-indigo-600" />
                  <span>Catur</span>
                </button>
                <button
                  type="button"
                  onClick={() => setPreviewBg('white')}
                  className={`px-2 py-1 rounded-md text-[11px] font-semibold transition cursor-pointer ${
                    previewBg === 'white'
                      ? 'bg-white text-slate-900 shadow-2xs font-bold'
                      : 'text-slate-600 hover:text-slate-900'
                  }`}
                  title="Latar Putih"
                >
                  <span>Putih</span>
                </button>
                <button
                  type="button"
                  onClick={() => setPreviewBg('dark')}
                  className={`px-2 py-1 rounded-md text-[11px] font-semibold transition cursor-pointer ${
                    previewBg === 'dark'
                      ? 'bg-white text-slate-900 shadow-2xs font-bold'
                      : 'text-slate-600 hover:text-slate-900'
                  }`}
                  title="Latar Gelap"
                >
                  <span>Gelap</span>
                </button>
              </div>

              <div className="flex items-center bg-slate-100 p-0.5 rounded-lg border border-slate-200">
                <button
                  onClick={() => setViewMode('split')}
                  className={`px-2 py-1 rounded-md transition flex items-center gap-1 font-medium cursor-pointer ${
                    viewMode === 'split'
                      ? 'bg-white text-slate-900 shadow-2xs font-bold'
                      : 'text-slate-600 hover:text-slate-900'
                  }`}
                  title="Mode Split Slider"
                >
                  <Split className="w-3 h-3" />
                  <span>Split</span>
                </button>
                <button
                  onClick={() => setViewMode('sideBySide')}
                  className={`px-2 py-1 rounded-md transition flex items-center gap-1 font-medium cursor-pointer ${
                    viewMode === 'sideBySide'
                      ? 'bg-white text-slate-900 shadow-2xs font-bold'
                      : 'text-slate-600 hover:text-slate-900'
                  }`}
                  title="Mode Berdampingan"
                >
                  <Columns className="w-3 h-3" />
                  <span>Dua Kolom</span>
                </button>
              </div>

              <div className="flex items-center bg-slate-100 p-0.5 rounded-lg border border-slate-200">
                <button
                  onClick={() => setZoomLevel((z) => Math.max(0.5, z - 0.25))}
                  className="p-1 text-slate-600 hover:text-slate-900 cursor-pointer"
                  title="Perkecil"
                >
                  <ZoomOut className="w-3.5 h-3.5" />
                </button>
                <span className="px-1.5 font-mono text-[11px] text-slate-700 min-w-[2.8rem] text-center font-bold">
                  {Math.round(zoomLevel * 100)}%
                </span>
                <button
                  onClick={() => setZoomLevel((z) => Math.min(3, z + 0.25))}
                  className="p-1 text-slate-600 hover:text-slate-900 cursor-pointer"
                  title="Perbesar"
                >
                  <ZoomIn className="w-3.5 h-3.5" />
                </button>
                <button
                  onClick={() => setZoomLevel(1)}
                  className="p-1 text-slate-600 hover:text-slate-900 border-l border-slate-200 cursor-pointer"
                  title="Reset 100%"
                >
                  <Maximize2 className="w-3 h-3" />
                </button>
              </div>

              <button
                id="modal-re-vectorize-toggle"
                onClick={() => setShowConfigDrawer(!showConfigDrawer)}
                className={`px-2.5 py-1 rounded-lg border text-xs font-bold flex items-center gap-1 transition cursor-pointer ${
                  showConfigDrawer
                    ? 'bg-indigo-50 border-indigo-300 text-indigo-700'
                    : 'bg-white border-slate-200 text-slate-700 hover:bg-slate-50'
                }`}
              >
                <Sliders className="w-3.5 h-3.5 text-indigo-600" />
                <span>Atur Warna &amp; Transparansi</span>
              </button>
            </div>
          )}
        </div>

        {/* In-Modal Fine-Tuning Drawer */}
        {showConfigDrawer && modalConfig && (
          <div className="p-3.5 bg-gradient-to-r from-indigo-50/80 via-purple-50/60 to-emerald-50/80 border-b border-indigo-100 flex flex-wrap items-center justify-between gap-3 text-xs animate-in slide-in-from-top-2 duration-150">
            <div className="flex flex-wrap items-center gap-3">
              <label className="flex items-center gap-1.5 bg-white border border-indigo-300 px-2.5 py-1 rounded-lg cursor-pointer shadow-2xs">
                <input
                  type="checkbox"
                  checked={modalConfig.colorSnapping !== false}
                  onChange={(e) =>
                    setModalConfig({
                      ...modalConfig,
                      colorSnapping: e.target.checked,
                    })
                  }
                  className="rounded text-indigo-600 focus:ring-indigo-500 w-3.5 h-3.5"
                />
                <span className="font-bold text-indigo-950">Color Snapping (Anti-Aliasing)</span>
              </label>

              {modalConfig.colorSnapping !== false && (
                <div className="flex items-center gap-1.5 bg-white border border-indigo-200 px-2.5 py-1 rounded-lg">
                  <span className="font-semibold text-slate-700">Palet K-Means:</span>
                  <select
                    value={modalConfig.snappedColorCount || modalConfig.maxColors || 12}
                    onChange={(e) =>
                      setModalConfig({
                        ...modalConfig,
                        snappedColorCount: parseInt(e.target.value, 10),
                        maxColors: parseInt(e.target.value, 10),
                      })
                    }
                    className="bg-transparent text-indigo-700 font-bold focus:outline-none cursor-pointer"
                  >
                    <option value={4}>4 Warna</option>
                    <option value={6}>6 Warna</option>
                    <option value={8}>8 Warna (Logo/Icon)</option>
                    <option value={12}>12 Warna (Rekomendasi)</option>
                    <option value={16}>16 Warna</option>
                    <option value={24}>24 Warna (Ilustrasi)</option>
                    <option value={32}>32 Warna (Foto)</option>
                  </select>
                </div>
              )}

              {/* Background Mode: Magenta vs White */}
              <div className="flex items-center gap-1 bg-white border border-slate-300 rounded-lg p-0.5">
                <button
                  type="button"
                  onClick={() => {
                    const updated: VectorizeConfig = {
                      ...modalConfig,
                      bgMode: 'magenta',
                      removeBackground: true,
                      makeWhiteTransparent: false,
                      keepInnerWhite: false,
                    };
                    setModalConfig(updated);
                  }}
                  className={`px-2 py-0.5 rounded-md text-[11px] font-bold transition cursor-pointer flex items-center gap-1 ${
                    (modalConfig.bgMode ?? 'magenta') === 'magenta'
                      ? 'bg-fuchsia-600 text-white shadow-2xs'
                      : 'text-slate-600 hover:text-slate-900'
                  }`}
                >
                  <span className="w-2 h-2 rounded-full bg-[#FF00FF] border border-white/60" />
                  <span>Magenta</span>
                </button>
                <button
                  type="button"
                  onClick={() => {
                    const updated: VectorizeConfig = {
                      ...modalConfig,
                      bgMode: 'white',
                      removeBackground: true,
                      makeWhiteTransparent: true,
                      keepInnerWhite: true,
                    };
                    setModalConfig(updated);
                  }}
                  className={`px-2 py-0.5 rounded-md text-[11px] font-bold transition cursor-pointer flex items-center gap-1 ${
                    modalConfig.bgMode === 'white'
                      ? 'bg-emerald-600 text-white shadow-2xs'
                      : 'text-slate-600 hover:text-slate-900'
                  }`}
                >
                  <span className="w-2 h-2 rounded-full bg-white border border-slate-400" />
                  <span>Putih</span>
                </button>
              </div>

              {/* Mode-specific settings */}
              {(modalConfig.bgMode ?? 'magenta') === 'magenta' ? (
                <>
                  <div className="flex items-center gap-1.5 bg-white border border-pink-200 px-2 py-1 rounded-lg">
                    <span className="font-semibold text-slate-700">Toleransi:</span>
                    <input
                      type="range"
                      min="5"
                      max="30"
                      step="1"
                      value={modalConfig.magentaTolerance ?? 14}
                      onChange={(e) =>
                        setModalConfig({
                          ...modalConfig,
                          magentaTolerance: parseInt(e.target.value, 10),
                        })
                      }
                      className="w-16 accent-pink-600 cursor-pointer"
                    />
                    <span className="font-mono font-bold text-pink-700">
                      ±{modalConfig.magentaTolerance ?? 14}%
                    </span>
                  </div>
                  <label className="flex items-center gap-1 bg-white border border-pink-200 px-2 py-1 rounded-lg cursor-pointer">
                    <input
                      type="checkbox"
                      checked={modalConfig.defringeMagenta !== false}
                      onChange={(e) =>
                        setModalConfig({
                          ...modalConfig,
                          defringeMagenta: e.target.checked,
                        })
                      }
                      className="rounded text-pink-600 focus:ring-pink-500 w-3 h-3"
                    />
                    <span className="font-semibold text-slate-700 text-[11px]">Defringe</span>
                  </label>
                </>
              ) : (
                <label className="flex items-center gap-1.5 bg-white border border-emerald-300 px-2.5 py-1 rounded-lg cursor-pointer shadow-2xs">
                  <input
                    type="checkbox"
                    checked={modalConfig.keepInnerWhite !== false}
                    onChange={(e) => {
                      const val = e.target.checked;
                      const updated: VectorizeConfig = {
                        ...modalConfig,
                        keepInnerWhite: val,
                        whiteRemovalMode: val ? 'floodfill' : 'global',
                      };
                      setModalConfig(updated);
                    }}
                    className="rounded text-emerald-600 focus:ring-emerald-500 w-3.5 h-3.5"
                  />
                  <span className="font-bold text-emerald-950">
                    Putih di Tengah TIDAK Transparan
                  </span>
                </label>
              )}

              <div className="flex items-center gap-1.5 bg-white border border-slate-200 px-2.5 py-1 rounded-lg">
                <span className="font-semibold text-slate-700">Bentuk:</span>
                <select
                  value={(modalConfig.curveStyle || modalConfig.mode) === 'polygon' ? 'polygon' : 'spline'}
                  onChange={(e) =>
                    setModalConfig({
                      ...modalConfig,
                      curveStyle: e.target.value as any,
                      mode: e.target.value as any,
                    })
                  }
                  className="bg-transparent text-indigo-700 font-bold focus:outline-none cursor-pointer"
                >
                  <option value="spline">Organik (Kurva Spline)</option>
                  <option value="polygon">Geometris (Garis Lurus)</option>
                </select>
              </div>

              <div className="flex items-center gap-1.5 bg-white border border-slate-200 px-2.5 py-1 rounded-lg">
                <span className="font-semibold text-slate-700">Warna:</span>
                <input
                  type="range"
                  min="2"
                  max="32"
                  step="1"
                  value={modalConfig.snappedColorCount || modalConfig.maxColors || 12}
                  onChange={(e) =>
                    setModalConfig({
                      ...modalConfig,
                      maxColors: parseInt(e.target.value, 10),
                      snappedColorCount: parseInt(e.target.value, 10),
                    })
                  }
                  className="w-16 accent-indigo-600 cursor-pointer"
                />
                <span className="font-mono font-bold text-indigo-700">
                  {modalConfig.snappedColorCount || modalConfig.maxColors || 12}
                </span>
              </div>

              <div className="flex items-center gap-1.5 bg-white border border-slate-200 px-2.5 py-1 rounded-lg">
                <span className="font-semibold text-slate-700">Filter Bintik:</span>
                <input
                  type="range"
                  min="4"
                  max="24"
                  step="1"
                  value={modalConfig.filterSpeckle ?? 12}
                  onChange={(e) =>
                    setModalConfig({
                      ...modalConfig,
                      filterSpeckle: parseInt(e.target.value, 10),
                    })
                  }
                  className="w-16 accent-indigo-600 cursor-pointer"
                  title="Filter bintik/noise untuk membuang micro-paths (8-16 px)"
                />
                <span className="font-mono font-bold text-indigo-700">
                  {modalConfig.filterSpeckle ?? 12}px
                </span>
              </div>

              <div className="flex items-center gap-1.5 bg-white border border-slate-200 px-2.5 py-1 rounded-lg">
                <span className="font-semibold text-slate-700">RDP:</span>
                <input
                  type="range"
                  min="0.0"
                  max="3.0"
                  step="0.1"
                  value={modalConfig.rdpTolerance ?? 1.0}
                  onChange={(e) =>
                    setModalConfig({
                      ...modalConfig,
                      rdpTolerance: parseFloat(e.target.value),
                    })
                  }
                  className="w-16 accent-indigo-600 cursor-pointer"
                  title="Simplifikasi Polygon Ramer-Douglas-Peucker untuk membuang vertex tangga piksel"
                />
                <span className="font-mono font-bold text-indigo-700">
                  ±{(modalConfig.rdpTolerance ?? 1.0).toFixed(1)}px
                </span>
              </div>

              <label className="flex items-center gap-1.5 bg-white border border-slate-200 px-2.5 py-1 rounded-lg cursor-pointer">
                <input
                  type="checkbox"
                  checked={modalConfig.snapVertices !== false}
                  onChange={(e) =>
                    setModalConfig({
                      ...modalConfig,
                      snapVertices: e.target.checked,
                    })
                  }
                  className="rounded text-indigo-600 focus:ring-indigo-500 w-3.5 h-3.5"
                />
                <span className="font-semibold text-slate-700 text-xs">
                  Snap Vertex Berimpit
                </span>
              </label>
            </div>

            <button
              id="re-vectorize-apply-btn"
              disabled={isProcessing}
              onClick={handleApplyModalConfig}
              className="px-3.5 py-1.5 rounded-xl bg-gradient-to-r from-indigo-600 to-purple-600 hover:from-indigo-700 hover:to-purple-700 text-white font-bold transition disabled:opacity-50 flex items-center gap-1.5 shadow-sm shadow-indigo-600/20 cursor-pointer shrink-0"
            >
              <Sparkles className="w-3.5 h-3.5" />
              <span>{isProcessing ? 'Memproses...' : 'Terapkan &amp; Vektorisasi Ulang'}</span>
            </button>
          </div>
        )}

        {/* Modal Main Body */}
        <div className="flex-1 min-h-0 bg-slate-900 overflow-hidden relative">
          {activeTab === 'compare' && (
            <div className="w-full h-full flex items-center justify-center p-4 overflow-auto">
              <div
                style={{
                  transform: `scale(${zoomLevel})`,
                  transformOrigin: 'center center',
                  transition: 'transform 0.15s ease-out',
                }}
              >
                {viewMode === 'split' ? (
                  <div
                    ref={containerRef}
                    onMouseDown={handleMouseDown}
                    onMouseMove={handleMouseMove}
                    onTouchMove={handleTouchMove}
                    className="relative select-none overflow-hidden rounded-2xl shadow-2xl cursor-ew-resize border border-slate-700 max-w-3xl max-h-[70vh]"
                    style={{
                      aspectRatio: `${result.width} / ${result.height}`,
                      width: Math.min(result.width, 680),
                      ...getBackgroundStyle(),
                    }}
                  >
                    <div
                      className="absolute inset-0 w-full h-full flex items-center justify-center pointer-events-none"
                      dangerouslySetInnerHTML={{ __html: result.svgString }}
                    />
                    <div
                      className="absolute inset-0 w-full h-full overflow-hidden bg-slate-900 pointer-events-none"
                      style={{ width: `${sliderPosition}%` }}
                    >
                      <img
                        src={item.previewUrl}
                        alt="Original Raster"
                        className="absolute top-0 left-0 max-w-none h-full object-contain pointer-events-none"
                        style={{
                          width: `${Math.min(result.width, 680)}px`,
                        }}
                      />
                    </div>
                    <div
                      className="absolute top-0 bottom-0 w-0.5 bg-white shadow-xl pointer-events-none z-10"
                      style={{ left: `${sliderPosition}%` }}
                    >
                      <div className="absolute top-1/2 -translate-y-1/2 -translate-x-1/2 w-8 h-8 rounded-full bg-white text-slate-900 shadow-2xl flex items-center justify-center border-2 border-indigo-600">
                        <Split className="w-4 h-4 rotate-90 text-indigo-600" />
                      </div>
                    </div>
                    <div className="absolute top-3 left-3 bg-slate-900/85 text-white text-[10px] font-bold px-2 py-1 rounded-md backdrop-blur-xs pointer-events-none border border-white/10">
                      GAMBAR ASLI (RASTER)
                    </div>
                    <div className="absolute top-3 right-3 bg-indigo-600/90 text-white text-[10px] font-bold px-2 py-1 rounded-md backdrop-blur-xs pointer-events-none shadow-md">
                      VEKTOR SVG (MULTI-WARNA)
                    </div>
                  </div>
                ) : (
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-4 max-w-4xl max-h-[70vh]">
                    <div className="rounded-2xl overflow-hidden border border-slate-800 bg-slate-900 flex flex-col shadow-xl">
                      <div className="px-3.5 py-2 bg-slate-800/90 text-slate-300 text-xs font-bold border-b border-slate-700">
                        Gambar Asli ({item.width} × {item.height}px)
                      </div>
                      <div className="p-4 flex items-center justify-center flex-1 bg-black/40">
                        <img
                          src={item.previewUrl}
                          alt="Original"
                          className="max-h-[50vh] object-contain rounded-lg"
                        />
                      </div>
                    </div>

                    <div className="rounded-2xl overflow-hidden border border-slate-800 bg-slate-900 flex flex-col shadow-xl">
                      <div className="px-3.5 py-2 bg-indigo-950/80 text-indigo-200 text-xs font-bold flex justify-between border-b border-indigo-900/50">
                        <span>Vektor SVG ({result.colorCount} warna • {result.pathCount} path)</span>
                        <span className="text-emerald-400">{formatBytes(result.svgSize)}</span>
                      </div>
                      <div
                        className="p-4 flex items-center justify-center flex-1 overflow-hidden"
                        style={getBackgroundStyle()}
                      >
                        <div
                          className="w-full h-full max-h-[50vh] flex items-center justify-center"
                          dangerouslySetInnerHTML={{ __html: result.svgString }}
                        />
                      </div>
                    </div>
                  </div>
                )}
              </div>
            </div>
          )}

          {activeTab === 'svg' && (
            <div className="w-full h-full flex flex-col bg-slate-950 p-4">
              <div className="flex justify-between items-center mb-3">
                <span className="text-xs font-mono text-slate-400">
                  Scalable Vector Graphics (SVG W3C) • {formatBytes(result.svgSize)}
                </span>
                <button
                  id="copy-svg-code-btn"
                  onClick={() => handleCopyCode('svg')}
                  className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-xl bg-indigo-600 hover:bg-indigo-700 text-white text-xs font-bold transition cursor-pointer shadow-sm shadow-indigo-600/20"
                >
                  {copiedType === 'svg' ? (
                    <>
                      <Check className="w-3.5 h-3.5 text-emerald-300" />
                      <span>Tersalin!</span>
                    </>
                  ) : (
                    <>
                      <Copy className="w-3.5 h-3.5" />
                      <span>Salin Kode SVG</span>
                    </>
                  )}
                </button>
              </div>
              <textarea
                readOnly
                value={result.svgString}
                className="w-full flex-1 bg-slate-900 text-slate-300 font-mono text-xs p-4 rounded-xl border border-slate-800 resize-none focus:outline-none focus:ring-1 focus:ring-indigo-500 overflow-auto"
              />
            </div>
          )}

          {activeTab === 'eps' && (
            <div className="w-full h-full flex flex-col bg-slate-950 p-4">
              <div className="flex justify-between items-center mb-3">
                <div className="text-xs font-mono text-slate-400">
                  <span>Encapsulated PostScript (EPSF-3.0) • {formatBytes(result.epsSize)}</span>
                  <span className="ml-2 text-amber-400 font-semibold">Kompatibel Illustrator / CorelDraw</span>
                </div>
                <button
                  id="copy-eps-code-btn"
                  onClick={() => handleCopyCode('eps')}
                  className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-xl bg-amber-600 hover:bg-amber-700 text-white text-xs font-bold transition cursor-pointer shadow-sm shadow-amber-600/20"
                >
                  {copiedType === 'eps' ? (
                    <>
                      <Check className="w-3.5 h-3.5 text-emerald-300" />
                      <span>Tersalin!</span>
                    </>
                  ) : (
                    <>
                      <Copy className="w-3.5 h-3.5" />
                      <span>Salin PostScript EPS</span>
                    </>
                  )}
                </button>
              </div>
              <textarea
                readOnly
                value={result.epsString}
                className="w-full flex-1 bg-slate-900 text-amber-200/90 font-mono text-xs p-4 rounded-xl border border-slate-800 resize-none focus:outline-none focus:ring-1 focus:ring-amber-500 overflow-auto"
              />
            </div>
          )}

          {activeTab === 'stats' && (
            <div className="w-full h-full bg-slate-950 p-6 overflow-auto text-slate-200">
              <div className="max-w-2xl mx-auto space-y-6">
                <div>
                  <h3 className="text-lg font-bold text-white mb-1">
                    Spesifikasi Geometri &amp; Hasil Vektor
                  </h3>
                  <p className="text-xs text-slate-400">
                    Rincian matematis kurva Bézier dan pemisahan layer warna
                  </p>
                </div>

                <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
                  <div className="p-3.5 rounded-xl bg-slate-900 border border-slate-800">
                    <span className="text-[11px] text-slate-400 block mb-1">Resolusi Output Ekspor</span>
                    <span className="text-base font-bold text-white">
                      {currentResolution.width.toLocaleString('id-ID')} × {currentResolution.height.toLocaleString('id-ID')} px
                    </span>
                    <span className="text-[11px] text-indigo-300 block mt-0.5 font-bold">
                      {currentResolution.megaPixels} MP {currentResolution.megaPixels >= 15 ? '• Syarat Microstock' : ''}
                    </span>
                  </div>

                  <div className="p-3.5 rounded-xl bg-slate-900 border border-slate-800">
                    <span className="text-[11px] text-slate-400 block mb-1">Jumlah Path Kurva</span>
                    <span className="text-base font-bold text-indigo-400">
                      {result.pathCount} kurva Bézier
                    </span>
                  </div>

                  <div className="p-3.5 rounded-xl bg-slate-900 border border-slate-800">
                    <span className="text-[11px] text-slate-400 block mb-1">Palet Multi-Warna</span>
                    <span className="text-base font-bold text-emerald-400">
                      {result.colorCount} warna unik
                    </span>
                    <span className="text-[11px] text-emerald-300/90 block mt-0.5 font-medium">
                      Sebelum: <strong className="text-white">{result.rawColorCount ?? result.colorCount}</strong> → Sesudah: <strong className="text-white">{result.mergedColorCount ?? result.colorCount}</strong> (ΔE&lt;10)
                    </span>
                  </div>

                  <div className="p-3.5 rounded-xl bg-slate-900 border border-slate-800">
                    <span className="text-[11px] text-slate-400 block mb-1">Ukuran Asli Raster</span>
                    <span className="text-base font-bold text-slate-300">
                      {formatBytes(item.originalSize)}
                    </span>
                  </div>

                  <div className="p-3.5 rounded-xl bg-slate-900 border border-slate-800">
                    <span className="text-[11px] text-slate-400 block mb-1">Ukuran Berkas SVG</span>
                    <span className="text-base font-bold text-indigo-400">
                      {formatBytes(result.svgSize)}
                    </span>
                  </div>

                  <div className="p-3.5 rounded-xl bg-slate-900 border border-slate-800">
                    <span className="text-[11px] text-slate-400 block mb-1">Ukuran Berkas EPS</span>
                    <span className="text-base font-bold text-amber-400">
                      {formatBytes(result.epsSize)}
                    </span>
                  </div>
                </div>

                <div className="p-4 rounded-xl bg-gradient-to-r from-indigo-950/90 to-purple-950/90 border border-indigo-500/50 shadow-lg space-y-2.5">
                  <div className="flex items-center justify-between flex-wrap gap-2">
                    <div className="flex items-center gap-2">
                      <span className="px-2 py-0.5 rounded text-[10px] font-bold bg-indigo-500 text-white uppercase tracking-wider">
                        Mesin Aktif
                      </span>
                      <h4 className="text-sm font-bold text-white">
                        Library Tracing: @visioncortex/vtracer (Rust/WASM)
                      </h4>
                    </div>
                    <span className="text-[11px] font-mono text-emerald-400 font-bold bg-emerald-950/80 px-2 py-0.5 rounded border border-emerald-500/40">
                      WASM v1.0.0-alpha.4
                    </span>
                  </div>

                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 text-xs text-slate-300">
                    <div>• Arsitektur: <strong className="text-white">Hierarchical Stacked</strong></div>
                    <div>• Fitting Kurva: <strong className="text-indigo-300 capitalize">{item.config.curveStyle === 'polygon' ? 'Geometris (Polygon/Lurus)' : 'Organik (Bézier Spline)'}</strong></div>
                    <div>• Filter Bintik: <strong className="text-white">{item.config.filterSpeckle ?? 12} px</strong></div>
                    <div>• Color Snapping: <strong className="text-emerald-300">{result.colorSnappingUsed ? 'Aktif (K-Means)' : 'Non-aktif'}</strong></div>
                    <div>• Post-Processing: <strong className="text-white">Subpath Merging + Decimal Rounding</strong></div>
                    <div>• Background: <strong className="text-white">{item.config.makeWhiteTransparent ? (item.config.keepInnerWhite ? 'Putih Luar Transparan (Tengah Solid)' : 'Semua Putih Transparan') : 'Solid'}</strong></div>
                  </div>
                </div>

                <div className={`p-4 rounded-xl border text-xs flex items-start gap-3 ${
                  result.qualityScore === 'warning'
                    ? 'bg-amber-950/50 border-amber-500 text-amber-200'
                    : 'bg-emerald-950/40 border-emerald-600/50 text-emerald-200'
                }`}>
                  <div className="mt-0.5 text-lg">
                    {result.qualityScore === 'warning' ? '⚠' : '✓'}
                  </div>
                  <div className="space-y-1">
                    <span className="font-bold text-sm block">
                      {result.qualityScore === 'warning' ? 'Peringatan Jumlah Path & Ukuran File' : 'Indikator Kualitas: Optimal & Rapi'}
                    </span>
                    <p className="text-slate-300 leading-relaxed">
                      {result.qualityMessage || 'Kurva Bézier tergenerasi rapi tanpa anti-aliasing.'}
                    </p>
                    <div className="pt-1 flex flex-wrap gap-4 text-[11px] font-mono">
                      <span>Jumlah Path: <strong className={result.pathCount > 60 ? 'text-amber-400 font-bold' : 'text-emerald-400 font-bold'}>{result.pathCount}</strong></span>
                      <span>Jumlah Warna: <strong className="text-indigo-400 font-bold">{result.colorCount}</strong></span>
                      <span>Ukuran SVG: <strong className={result.svgSize > 120000 ? 'text-amber-400 font-bold' : 'text-emerald-400 font-bold'}>{formatBytes(result.svgSize)}</strong></span>
                    </div>
                  </div>
                </div>

                {result.warnings && result.warnings.length > 0 && (
                  <div className="p-3.5 rounded-xl bg-amber-950/60 border border-amber-600/70 text-xs text-amber-200 space-y-1.5">
                    <div className="flex items-center gap-2 font-bold text-amber-300">
                      <span>⚠ Peringatan Validasi Path:</span>
                      <span className="text-[10px] bg-amber-900/80 px-1.5 py-0.5 rounded">
                        Output mentah VTracer digunakan
                      </span>
                    </div>
                    <ul className="list-disc list-inside space-y-1 text-amber-200/90 font-mono text-[11px]">
                      {result.warnings.slice(0, 5).map((w, idx) => (
                        <li key={idx}>{w}</li>
                      ))}
                      {result.warnings.length > 5 && (
                        <li>...dan {result.warnings.length - 5} peringatan lainnya</li>
                      )}
                    </ul>
                  </div>
                )}

                <div className="p-4 rounded-xl bg-slate-900/60 border border-slate-800 text-xs space-y-2.5">
                  <div className="flex items-center gap-2 text-slate-300">
                    <Clock className="w-4 h-4 text-indigo-400" />
                    <span>Waktu Proses: <strong>{result.processingTimeMs} ms</strong></span>
                  </div>
                  <div className="flex items-center gap-2 text-slate-300">
                    <HardDrive className="w-4 h-4 text-purple-400" />
                    <span>
                      Mesin Tracing (Vector Engine): <strong className="text-indigo-300 font-mono">@visioncortex/vtracer (Rust/WASM) v1.0.0-alpha.4</strong>
                    </span>
                  </div>
                  <div className="flex items-center gap-2 text-slate-300">
                    <Sparkles className="w-4 h-4 text-amber-400" />
                    <span>
                      Color Snapping: <strong>{result.colorSnappingUsed ? 'Aktif (K-Means Anti-Aliasing Elimination)' : 'Non-aktif'}</strong>
                    </span>
                  </div>
                  <div className="flex items-center gap-2 text-slate-300">
                    <SunMedium className="w-4 h-4 text-emerald-400" />
                    <span>
                      Status Transparansi: <strong>{item.config.makeWhiteTransparent ? (item.config.keepInnerWhite ? 'Latar Putih Luar Transparan (Putih Tengah Tetap Solid)' : 'Semua Putih Transparan') : 'Latar Belakang Solid'}</strong>
                    </span>
                  </div>
                </div>
              </div>
            </div>
          )}
        </div>

        {/* Modal Bottom Palette Bar */}
        {result.palette && result.palette.length > 0 && (
          <div className="px-5 py-2.5 bg-slate-950 border-t border-slate-800 flex items-center justify-between gap-3 overflow-x-auto shrink-0">
            <div className="flex items-center gap-2 shrink-0">
              <Layers className="w-4 h-4 text-indigo-400" />
              <span className="text-xs font-bold text-slate-300">
                Palet Desain ({result.palette.length}):
              </span>
              <span className="text-[10px] text-slate-500 hidden sm:inline">
                (Klik warna untuk salin HEX • Ikon gembok untuk kunci warna • Ikon tetesan untuk buat transparan)
              </span>
            </div>

            <div className="flex items-center gap-2 flex-1 overflow-x-auto py-1">
              {result.palette.map((swatch, i) => {
                const isCustomTransparent = modalConfig?.transparentColors?.includes(swatch.hex);
                const isLocked = modalConfig?.lockedPalette?.includes(swatch.hex);
                return (
                  <div key={i} className="group relative shrink-0 flex items-center">
                    <button
                      onClick={() => handleCopyHex(swatch.hex)}
                      className={`w-7 h-7 rounded-lg border transition hover:scale-110 focus:outline-none cursor-pointer flex items-center justify-center relative ${
                        isCustomTransparent
                          ? 'border-rose-500 ring-2 ring-rose-500'
                          : isLocked
                          ? 'border-amber-400 ring-2 ring-amber-400 shadow-amber-400/30'
                          : 'border-white/20'
                      }`}
                      style={{ backgroundColor: swatch.hex }}
                      title={`Klik untuk salin ${swatch.hex} (${swatch.count} path)`}
                    >
                      {isLocked && (
                        <Lock className="w-3 h-3 text-slate-900 drop-shadow" />
                      )}
                      {isCustomTransparent && (
                        <span className="w-2 h-2 rounded-full bg-rose-500 animate-ping" />
                      )}
                      <span className="absolute -top-7 left-1/2 -translate-x-1/2 bg-slate-900 text-white text-[9px] font-mono px-1.5 py-0.5 rounded shadow opacity-0 group-hover:opacity-100 transition pointer-events-none whitespace-nowrap z-20 border border-slate-700">
                        {copiedColorHex === swatch.hex ? 'Tersalin!' : `${swatch.hex} (${swatch.count}x)`}
                      </span>
                    </button>

                    <button
                      type="button"
                      onClick={(e) => {
                        e.stopPropagation();
                        handleToggleLockColor(swatch.hex);
                      }}
                      className={`absolute -top-1.5 -left-1.5 w-4 h-4 rounded-full text-[9px] flex items-center justify-center transition shadow cursor-pointer ${
                        isLocked
                          ? 'bg-amber-400 text-slate-900 opacity-100'
                          : 'bg-slate-800 text-slate-400 opacity-0 group-hover:opacity-100 hover:text-white hover:bg-amber-500'
                      }`}
                      title={isLocked ? 'Buka kunci warna' : 'Kunci warna ini untuk K-Means'}
                    >
                      {isLocked ? <Lock className="w-2.5 h-2.5" /> : <Unlock className="w-2.5 h-2.5" />}
                    </button>

                    <button
                      type="button"
                      onClick={(e) => {
                        e.stopPropagation();
                        handleToggleColorTransparency(swatch.hex);
                      }}
                      className="absolute -bottom-1.5 -right-1.5 w-4 h-4 rounded-full bg-slate-800 text-white text-[9px] flex items-center justify-center opacity-0 group-hover:opacity-100 hover:bg-rose-600 transition shadow cursor-pointer"
                      title={isCustomTransparent ? 'Batal jadikan transparan' : 'Jadikan warna ini transparan'}
                    >
                      <Droplet className="w-2.5 h-2.5" />
                    </button>
                  </div>
                );
              })}
            </div>
          </div>
        )}
      </div>
    </div>
  );
};
