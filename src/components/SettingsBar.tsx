import React, { useState } from 'react';
import {
  Sparkles,
  Camera,
  Shapes,
  Layers,
  Contrast,
  Palette,
  ChevronDown,
  ChevronUp,
  Sliders,
  Play,
  SunMedium,
  CheckCircle2,
  Shield,
  HelpCircle,
  Crop,
  Flame,
  Wand2,
  Hexagon,
  Spline,
  Lock,
  Unlock,
  Plus,
  X,
  Maximize2,
  Tag,
} from 'lucide-react';
import { PRESETS } from '../lib/vectorizer';
import { VectorizeConfig, VectorPresetId, WhiteRemovalMode, OutputResolutionPreset } from '../types';
import { getOutputDimensionsForConfig, MIN_OUTPUT_MEGAPIXELS } from '../lib/svgRescaler';

interface SettingsBarProps {
  config: VectorizeConfig;
  onChange: (newConfig: VectorizeConfig) => void;
  onApplyToAll?: () => void;
  hasItemsInQueue: boolean;
  onProcessQueue?: () => void;
  pendingCount?: number;
  isProcessingBatch?: boolean;
}

export const SettingsBar: React.FC<SettingsBarProps> = ({
  config,
  onChange,
  onApplyToAll,
  hasItemsInQueue,
  onProcessQueue,
  pendingCount = 0,
  isProcessingBatch = false,
}) => {
  const [showAdvanced, setShowAdvanced] = useState(false);
  const [customColorInput, setCustomColorInput] = useState('#22C55E');

  const handleAddLockedColor = (hex: string) => {
    let formatted = hex.trim().toUpperCase();
    if (!formatted.startsWith('#')) formatted = '#' + formatted;
    if (/^#[0-9A-F]{6}$/i.test(formatted)) {
      const current = config.lockedPalette || [];
      if (!current.includes(formatted)) {
        onChange({
          ...config,
          lockedPalette: [...current, formatted],
        });
      }
    }
  };

  const handleRemoveLockedColor = (hex: string) => {
    const current = config.lockedPalette || [];
    onChange({
      ...config,
      lockedPalette: current.filter((c) => c !== hex),
    });
  };

  const handlePresetSelect = (presetId: VectorPresetId) => {
    const presetObj = PRESETS.find((p) => p.id === presetId);
    if (presetObj && presetObj.config) {
      onChange({
        ...config,
        ...presetObj.config,
        preset: presetId,
      });
    }
  };

  const handleBgModeSelect = (mode: 'magenta' | 'white') => {
    if (mode === 'magenta') {
      onChange({
        ...config,
        bgMode: 'magenta',
        removeBackground: true,
        makeWhiteTransparent: false,
        keepInnerWhite: false, // Requirement 5: TIDAK tercentang saat mode magenta
      });
    } else {
      onChange({
        ...config,
        bgMode: 'white',
        removeBackground: true,
        makeWhiteTransparent: true,
        keepInnerWhite: true, // Requirement 5: Begitu user memilih mode Putih, centang otomatis!
      });
    }
  };

  const handleToggleRemoveBackground = (enabled: boolean) => {
    onChange({
      ...config,
      removeBackground: enabled,
      makeWhiteTransparent: enabled && (config.bgMode === 'white'),
    });
  };

  const handleMagentaToleranceChange = (val: number) => {
    onChange({
      ...config,
      magentaTolerance: val,
    });
  };

  const handleToggleDefringe = (enabled: boolean) => {
    onChange({
      ...config,
      defringeMagenta: enabled,
    });
  };

  const handleWhiteToleranceChange = (val: number) => {
    onChange({
      ...config,
      whiteTolerance: val,
    });
  };

  const handleMaxColorsChange = (colors: number) => {
    onChange({
      ...config,
      maxColors: colors,
      snappedColorCount: colors,
    });
  };

  const handleUpscaleSelect = (upscale: 1 | 2 | 4) => {
    onChange({
      ...config,
      upscale,
    });
  };

  const handleResolutionSelect = (preset: OutputResolutionPreset) => {
    let mp = MIN_OUTPUT_MEGAPIXELS;
    if (preset === '20mp') mp = 20;
    else if (preset === '25mp') mp = 25;
    else if (preset === '30mp') mp = 30;
    else if (preset === 'custom') mp = Math.max(MIN_OUTPUT_MEGAPIXELS, config.outputMegaPixels || MIN_OUTPUT_MEGAPIXELS);
    else if (preset === 'native') mp = 0;
    else mp = MIN_OUTPUT_MEGAPIXELS;

    onChange({
      ...config,
      outputResolutionPreset: preset,
      outputMegaPixels: mp,
    });
  };

  const handleCurveModeSelect = (mode: 'spline' | 'polygon') => {
    onChange({
      ...config,
      curveStyle: mode,
      mode,
      cornerThreshold: mode === 'polygon' ? 28 : 55,
      lengthThreshold: mode === 'polygon' ? 10 : 4,
    });
  };

  const handleColorSnappingToggle = (enabled: boolean) => {
    onChange({
      ...config,
      colorSnapping: enabled,
    });
  };

  const getPresetIcon = (iconName: string) => {
    switch (iconName) {
      case 'Sparkles':
        return <Sparkles className="w-3.5 h-3.5 text-amber-500" />;
      case 'Shapes':
        return <Shapes className="w-3.5 h-3.5 text-indigo-500" />;
      case 'Palette':
        return <Palette className="w-3.5 h-3.5 text-purple-500" />;
      case 'Layers':
        return <Layers className="w-3.5 h-3.5 text-blue-500" />;
      case 'Camera':
        return <Camera className="w-3.5 h-3.5 text-rose-500" />;
      case 'Contrast':
        return <Contrast className="w-3.5 h-3.5 text-slate-700" />;
      default:
        return <Palette className="w-3.5 h-3.5" />;
    }
  };

  return (
    <div className="bg-white rounded-2xl border border-slate-200 p-4 sm:p-5 shadow-xs space-y-4">
      {/* SECTION 1: Color Snapping & Anti-Aliasing Removal (High Priority Solution) */}
      <div className="bg-gradient-to-r from-indigo-50/90 via-purple-50/70 to-blue-50/80 rounded-xl p-3.5 border border-indigo-200/80 space-y-3 shadow-2xs">
        <div className="flex flex-col md:flex-row md:items-center justify-between gap-3">
          <div className="flex items-start sm:items-center gap-3">
            <div className="w-9 h-9 rounded-xl bg-gradient-to-tr from-indigo-600 to-purple-600 text-white flex items-center justify-center shrink-0 shadow-sm shadow-indigo-600/30">
              <Wand2 className="w-5 h-5 stroke-[2.2]" />
            </div>
            <div>
              <div className="flex items-center gap-2 flex-wrap">
                <h3 className="text-xs sm:text-sm font-bold text-slate-900 flex items-center gap-1.5">
                  <span>Color Snapping (K-Means Anti-Aliasing Elimination)</span>
                </h3>
                <span className={`text-[10px] font-bold px-2 py-0.5 rounded-full ${
                  config.colorSnapping !== false
                    ? 'bg-indigo-100 text-indigo-900 border border-indigo-200'
                    : 'bg-slate-200 text-slate-700'
                }`}>
                  {config.colorSnapping !== false ? 'AKTIF (Sangat Rapi)' : 'NON-AKTIF'}
                </span>
                <span className="text-[10px] bg-emerald-100 text-emerald-800 font-bold px-1.5 py-0.5 rounded">
                  Hilangkan Halo &amp; Warna Campuran
                </span>
              </div>
              <p className="text-[11px] text-slate-600 mt-0.5">
                Mengabaikan piksel gradien tepi, mengekstrak warna murni desain, dan merapatkan setiap piksel agar garis rapi tanpa warna kotor.
              </p>
            </div>
          </div>

          {/* Snapping controls */}
          <div className="flex flex-wrap items-center gap-2.5 pl-12 md:pl-0">
            <button
              id="toggle-color-snapping-btn"
              type="button"
              onClick={() => handleColorSnappingToggle(config.colorSnapping === false ? true : false)}
              className={`px-3 py-1.5 rounded-lg text-xs font-bold transition flex items-center gap-1.5 cursor-pointer shadow-2xs ${
                config.colorSnapping !== false
                  ? 'bg-indigo-600 text-white hover:bg-indigo-700 shadow-indigo-600/20'
                  : 'bg-white text-slate-700 hover:bg-slate-100 border border-slate-300'
              }`}
            >
              <CheckCircle2 className={`w-3.5 h-3.5 ${config.colorSnapping !== false ? 'text-white' : 'text-slate-400'}`} />
              <span>{config.colorSnapping !== false ? 'Color Snapping Aktif' : 'Non-aktifkan Snapping'}</span>
            </button>

            {/* Snapped color count selector and slider */}
            {config.colorSnapping !== false && (
              <div className="flex items-center gap-2 bg-white/95 border border-indigo-200 rounded-lg px-2.5 py-1 text-[11px] text-slate-700 shadow-2xs">
                <span className="font-semibold text-slate-600">Jumlah Warna:</span>
                <input
                  type="range"
                  min="2"
                  max="32"
                  step="1"
                  value={config.snappedColorCount || config.maxColors || 12}
                  onChange={(e) => handleMaxColorsChange(parseInt(e.target.value, 10))}
                  className="w-16 sm:w-20 accent-indigo-600 cursor-pointer"
                  title="Atur target jumlah warna desain"
                />
                <span className="font-mono font-bold text-indigo-700 min-w-[20px] text-center">
                  {config.snappedColorCount || config.maxColors || 12}
                </span>
              </div>
            )}
          </div>
        </div>

        {/* Manual Palette Color Locking Row */}
        {config.colorSnapping !== false && (
          <div className="pt-2 border-t border-indigo-100/70 flex flex-wrap items-center justify-between gap-2.5 text-[11px]">
            <div className="flex items-center gap-2 flex-wrap">
              <span className="font-semibold text-slate-700 flex items-center gap-1">
                <Lock className="w-3 h-3 text-amber-500" />
                <span>Kunci Warna Palet:</span>
              </span>
              
              <div className="inline-flex items-center gap-1.5 bg-white border border-indigo-200 rounded-md px-1.5 py-0.5 shadow-2xs">
                <input
                  type="color"
                  value={customColorInput}
                  onChange={(e) => setCustomColorInput(e.target.value)}
                  className="w-5 h-5 rounded cursor-pointer border-0 p-0 bg-transparent"
                  title="Pilih warna untuk dikunci"
                />
                <input
                  type="text"
                  value={customColorInput}
                  onChange={(e) => setCustomColorInput(e.target.value)}
                  className="w-16 font-mono text-[10px] uppercase font-bold text-slate-700 focus:outline-none"
                  placeholder="#HEX"
                />
                <button
                  type="button"
                  onClick={() => handleAddLockedColor(customColorInput)}
                  className="px-2 py-0.5 rounded bg-indigo-600 hover:bg-indigo-700 text-white font-bold text-[10px] flex items-center gap-1 cursor-pointer transition"
                  title="Kunci warna ini agar wajib ada di palet"
                >
                  <Plus className="w-2.5 h-2.5" />
                  <span>Kunci</span>
                </button>
              </div>

              {config.lockedPalette && config.lockedPalette.length > 0 ? (
                <div className="flex items-center gap-1.5 flex-wrap">
                  {config.lockedPalette.map((hex) => (
                    <span
                      key={hex}
                      className="inline-flex items-center gap-1 pl-1.5 pr-1 py-0.5 rounded-full bg-white border border-amber-300 text-[10px] font-mono font-bold text-slate-800 shadow-2xs"
                    >
                      <span
                        className="w-2.5 h-2.5 rounded-full border border-slate-300"
                        style={{ backgroundColor: hex }}
                      />
                      <span>{hex}</span>
                      <button
                        type="button"
                        onClick={() => handleRemoveLockedColor(hex)}
                        className="w-3.5 h-3.5 rounded-full hover:bg-slate-200 flex items-center justify-center text-slate-500 hover:text-slate-900 cursor-pointer ml-0.5"
                        title="Hapus kunci warna"
                      >
                        <X className="w-2.5 h-2.5" />
                      </button>
                    </span>
                  ))}
                </div>
              ) : (
                <span className="text-slate-400 italic text-[10px]">
                  (Opsional: Kunci warna penting seperti hijau facet, emas logo, dsb agar tidak hilang)
                </span>
              )}
            </div>

            {config.lockedPalette && config.lockedPalette.length > 0 && (
              <button
                type="button"
                onClick={() => onChange({ ...config, lockedPalette: [] })}
                className="text-[10px] text-rose-600 hover:underline cursor-pointer"
              >
                Reset Kunci
              </button>
            )}
          </div>
        )}
      </div>

      {/* SECTION 2: Background Transparency Options (Magenta #FF00FF Default & Putih #FFFFFF Cadangan) */}
      <div className={`rounded-xl p-3.5 border transition-all shadow-2xs space-y-3 ${
        (config.bgMode ?? 'magenta') === 'magenta'
          ? 'bg-gradient-to-r from-pink-50/90 via-fuchsia-50/70 to-purple-50/80 border-pink-200/90'
          : 'bg-gradient-to-r from-emerald-50/90 via-teal-50/70 to-cyan-50/80 border-emerald-200/90'
      }`}>
        <div className="flex flex-col md:flex-row md:items-center justify-between gap-3">
          <div className="flex items-start sm:items-center gap-3">
            <div className={`w-9 h-9 rounded-xl text-white flex items-center justify-center shrink-0 shadow-sm ${
              (config.bgMode ?? 'magenta') === 'magenta'
                ? 'bg-gradient-to-tr from-pink-600 to-fuchsia-600 shadow-pink-500/30'
                : 'bg-emerald-600 shadow-emerald-600/30'
            }`}>
              {(config.bgMode ?? 'magenta') === 'magenta' ? (
                <span className="w-5 h-5 rounded-md bg-[#FF00FF] border-2 border-white/80 shadow-2xs inline-block" />
              ) : (
                <SunMedium className="w-5 h-5 stroke-[2.2]" />
              )}
            </div>
            <div>
              <div className="flex items-center gap-2 flex-wrap">
                <h3 className="text-xs sm:text-sm font-bold text-slate-900">
                  Opsi Transparan Latar Belakang
                </h3>
                <span className={`text-[10px] font-bold px-2 py-0.5 rounded-full ${
                  config.removeBackground !== false
                    ? (config.bgMode ?? 'magenta') === 'magenta'
                      ? 'bg-pink-100 text-pink-900 border border-pink-300'
                      : 'bg-emerald-200 text-emerald-900 border border-emerald-300'
                    : 'bg-slate-200 text-slate-700'
                }`}>
                  {config.removeBackground !== false ? 'AKTIF (Transparan)' : 'NON-AKTIF (Solid)'}
                </span>
                <span className={`text-[10px] font-bold px-2 py-0.5 rounded-md shadow-2xs ${
                  (config.bgMode ?? 'magenta') === 'magenta'
                    ? 'bg-fuchsia-600 text-white'
                    : 'bg-emerald-700 text-white'
                }`}>
                  {(config.bgMode ?? 'magenta') === 'magenta' ? 'Mode: Magenta #FF00FF' : 'Mode: Putih #FFFFFF'}
                </span>
              </div>
              <p className="text-[11px] text-slate-600 mt-0.5">
                {(config.bgMode ?? 'magenta') === 'magenta'
                  ? 'Menghapus background Magenta #FF00FF dengan toleransi warna & defringe tepi. Detail putih di dalam desain 100% aman.'
                  : 'Mode cadangan: Flood-fill dari tepi luar untuk gambar dengan background putih. Putih di tengah tetap solid.'}
              </p>
            </div>
          </div>

          {/* Mode Selector Buttons & On/Off Toggle */}
          <div className="flex flex-wrap items-center gap-2 pl-12 md:pl-0">
            {/* Mode Background Selector (Magenta vs Putih) */}
            <div className="inline-flex items-center p-1 bg-white/95 rounded-xl border border-slate-300/80 gap-1 shadow-2xs">
              <button
                type="button"
                id="bg-mode-magenta-btn"
                onClick={() => handleBgModeSelect('magenta')}
                className={`px-3 py-1.5 rounded-lg text-xs font-bold transition flex items-center gap-1.5 cursor-pointer ${
                  (config.bgMode ?? 'magenta') === 'magenta'
                    ? 'bg-fuchsia-600 text-white shadow-xs'
                    : 'text-slate-700 hover:text-slate-900 hover:bg-slate-100'
                }`}
                title="Magenta #FF00FF (Default untuk hampir semua gambar)"
              >
                <span className="w-3 h-3 rounded-full bg-[#FF00FF] border border-white/60 inline-block shrink-0" />
                <span>Magenta</span>
                <span className={`text-[9px] px-1 py-0.2 rounded font-extrabold ${
                  (config.bgMode ?? 'magenta') === 'magenta' ? 'bg-white/20 text-white' : 'bg-pink-100 text-pink-800'
                }`}>
                  Default
                </span>
              </button>

              <button
                type="button"
                id="bg-mode-white-btn"
                onClick={() => handleBgModeSelect('white')}
                className={`px-3 py-1.5 rounded-lg text-xs font-bold transition flex items-center gap-1.5 cursor-pointer ${
                  config.bgMode === 'white'
                    ? 'bg-emerald-600 text-white shadow-xs'
                    : 'text-slate-700 hover:text-slate-900 hover:bg-slate-100'
                }`}
                title="Putih #FFFFFF (Mode cadangan jika desain memuat warna pink/magenta)"
              >
                <span className="w-3 h-3 rounded-full bg-white border border-slate-400 inline-block shrink-0" />
                <span>Putih</span>
                <span className={`text-[9px] px-1 py-0.2 rounded font-extrabold ${
                  config.bgMode === 'white' ? 'bg-white/20 text-white' : 'bg-slate-100 text-slate-600'
                }`}>
                  Cadangan
                </span>
              </button>
            </div>

            {/* Toggle Remove Background */}
            <button
              id="toggle-remove-bg-btn"
              type="button"
              onClick={() => handleToggleRemoveBackground(config.removeBackground === false ? true : false)}
              className={`px-3 py-1.5 rounded-lg text-xs font-bold transition flex items-center gap-1.5 cursor-pointer shadow-2xs ${
                config.removeBackground !== false
                  ? (config.bgMode ?? 'magenta') === 'magenta'
                    ? 'bg-pink-600 text-white hover:bg-pink-700 shadow-pink-600/20'
                    : 'bg-emerald-600 text-white hover:bg-emerald-700 shadow-emerald-600/20'
                  : 'bg-white text-slate-700 hover:bg-slate-100 border border-slate-300'
              }`}
            >
              <CheckCircle2 className={`w-3.5 h-3.5 ${config.removeBackground !== false ? 'text-white' : 'text-slate-400'}`} />
              <span>{config.removeBackground !== false ? 'Hapus Background' : 'Latar Solid'}</span>
            </button>
          </div>
        </div>

        {/* Detailed Controls: Magenta Mode vs White Mode */}
        {config.removeBackground !== false && (
          <div className="pt-2 border-t border-slate-200/60 flex flex-wrap items-center justify-between gap-3 text-xs">
            {(config.bgMode ?? 'magenta') === 'magenta' ? (
              /* MAGENTA CONTROLS */
              <div className="flex flex-wrap items-center gap-3">
                {/* Magenta Tolerance Slider */}
                <div className="flex items-center gap-2 bg-white/95 border border-pink-200 rounded-lg px-2.5 py-1 text-[11px] text-slate-700 shadow-2xs">
                  <span className="font-semibold text-slate-700">Toleransi Magenta:</span>
                  <input
                    id="magenta-tolerance-slider"
                    type="range"
                    min="5"
                    max="30"
                    step="1"
                    value={config.magentaTolerance ?? 14}
                    onChange={(e) => handleMagentaToleranceChange(parseInt(e.target.value, 10))}
                    className="w-20 accent-pink-600 cursor-pointer"
                    title="Toleransi deteksi warna magenta (default ±14%)"
                  />
                  <span className="font-mono font-bold text-pink-700 min-w-[28px]">
                    ±{config.magentaTolerance ?? 14}%
                  </span>
                </div>

                {/* Defringe Magenta Checkbox */}
                <label
                  id="defringe-magenta-label"
                  className="flex items-center gap-1.5 bg-white border border-pink-300 px-2.5 py-1 rounded-lg text-xs font-bold text-pink-950 cursor-pointer shadow-2xs hover:bg-pink-50/50 transition"
                  title="Membersihkan piksel batas agar tidak meninggalkan sisa halo pink/magenta"
                >
                  <input
                    id="setting-defringe-magenta"
                    type="checkbox"
                    checked={config.defringeMagenta !== false}
                    onChange={(e) => handleToggleDefringe(e.target.checked)}
                    className="rounded text-pink-600 focus:ring-pink-500 w-3.5 h-3.5 cursor-pointer"
                  />
                  <span>Defringe Tepi (Hapus Halo Magenta)</span>
                </label>

                {/* White is explicitly safe notice */}
                <span className="text-[11px] text-slate-600 bg-white/80 px-2 py-0.5 rounded-md border border-pink-200 flex items-center gap-1">
                  <span className="w-2 h-2 rounded-full bg-white border border-slate-400" />
                  <span>Detail putih aman (penghapus putih dinonaktifkan di mode ini)</span>
                </span>
              </div>
            ) : (
              /* WHITE CONTROLS */
              <div className="flex flex-wrap items-center gap-3">
                {/* Checkbox: Putih di Tengah TIDAK Transparan (Auto-checked in White mode!) */}
                <label
                  id="keep-inner-white-label"
                  className="flex items-center gap-1.5 px-2.5 py-1 rounded-lg bg-white border border-emerald-300 text-xs font-bold text-emerald-950 cursor-pointer shadow-2xs hover:bg-emerald-50/60 transition"
                  title="Hanya background putih di tepi luar yang dihapus. Bagian putih di tengah (mata, gigi, baju, logo) tetap solid putih!"
                >
                  <input
                    id="setting-keep-inner-white"
                    type="checkbox"
                    checked={config.keepInnerWhite !== false}
                    onChange={(e) => {
                      const val = e.target.checked;
                      onChange({
                        ...config,
                        keepInnerWhite: val,
                        whiteRemovalMode: val ? 'floodfill' : 'global',
                      });
                    }}
                    className="rounded text-emerald-600 focus:ring-emerald-500 w-4 h-4 cursor-pointer"
                  />
                  <span className="flex items-center gap-1">
                    <span>Putih di Tengah TIDAK Transparan</span>
                    <span className="text-[10px] bg-emerald-100 text-emerald-800 px-1 rounded font-semibold">
                      Otomatis Aktif
                    </span>
                  </span>
                </label>

                {/* White Sensitivity Slider */}
                <div className="flex items-center gap-1.5 bg-white/90 border border-emerald-200 rounded-lg px-2.5 py-1 text-[11px] text-slate-700 shadow-2xs">
                  <span className="font-semibold text-slate-600">Sensitivitas Putih:</span>
                  <input
                    id="white-tolerance-slider"
                    type="range"
                    min="190"
                    max="255"
                    step="1"
                    value={config.whiteTolerance ?? 242}
                    onChange={(e) => handleWhiteToleranceChange(parseInt(e.target.value, 10))}
                    className="w-16 accent-emerald-600 cursor-pointer"
                    title="Toleransi deteksi putih (242 = normal putih & off-white)"
                  />
                  <span className="font-mono font-bold text-emerald-700">
                    {255 - (config.whiteTolerance ?? 242)}%
                  </span>
                </div>
              </div>
            )}
          </div>
        )}
      </div>

      {/* SECTION: Ukuran Output Vektor (Pilihan Minimal 15 MP untuk Standar Microstock) */}
      <div className="bg-gradient-to-r from-blue-50/80 via-indigo-50/60 to-purple-50/60 rounded-xl p-3.5 border border-indigo-200/80 flex flex-col md:flex-row md:items-center justify-between gap-3 shadow-2xs">
        <div className="flex items-start sm:items-center gap-3">
          <div className="w-9 h-9 rounded-xl bg-indigo-600 text-white flex items-center justify-center shrink-0 shadow-sm shadow-indigo-600/30">
            <Maximize2 className="w-5 h-5 stroke-[2.2]" />
          </div>
          <div>
            <div className="flex items-center gap-2 flex-wrap">
              <h3 className="text-xs sm:text-sm font-bold text-slate-900">
                Ukuran Output Vektor (Standar Microstock)
              </h3>
              <span className="text-[10px] font-bold px-2 py-0.5 rounded-full bg-indigo-100 text-indigo-800 border border-indigo-200">
                Pilihan Minimal 15 MP (Freepik &amp; Adobe Stock)
              </span>
              <span className="text-[10px] bg-white text-indigo-700 font-bold px-2 py-0.5 rounded border border-indigo-200 shadow-2xs">
                {getOutputDimensionsForConfig(1200, 900, config).label}
              </span>
            </div>
            <p className="text-[11px] text-slate-600 mt-0.5">
              Skalakan artboard &amp; koordinat kurva SVG/EPS agar memenuhi syarat minimal 15 MP tanpa pecah.
            </p>
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-1.5 pl-12 md:pl-0">
          {[
            { id: '15mp' as const, label: '15 MP', tag: 'Minimal', desc: '15.0 MP (~4,472 × 3,354 px) Standar Wajib Freepik & Microstock' },
            { id: '20mp' as const, label: '20 MP', tag: 'HD', desc: '20.0 MP (~5,164 × 3,873 px)' },
            { id: '25mp' as const, label: '25 MP', tag: 'Adobe Stock', desc: '25.0 MP (~5,773 × 4,330 px) Rekomendasi Shutterstock / Adobe Stock' },
            { id: '30mp' as const, label: '30 MP', tag: 'Ultra', desc: '30.0 MP (~6,324 × 4,743 px) Ekstra Besar' },
            { id: 'custom' as const, label: 'Kustom', tag: '≥15 MP', desc: 'Tentukan sendiri ukuran Megapixels (minimal 15 MP)' },
            { id: 'native' as const, label: 'Asli', desc: 'Dimensi 1:1 sesuai resolusi asli tracing' },
          ].map((opt) => {
            const isSelected = (config.outputResolutionPreset || '15mp') === opt.id;
            return (
              <button
                key={opt.id}
                type="button"
                id={`btn-output-res-${opt.id}`}
                onClick={() => handleResolutionSelect(opt.id)}
                className={`px-2.5 py-1 text-xs font-bold rounded-lg transition cursor-pointer flex items-center gap-1 shadow-2xs ${
                  isSelected
                    ? 'bg-indigo-600 text-white shadow-indigo-600/20'
                    : 'bg-white text-slate-700 hover:bg-slate-100 border border-slate-300'
                }`}
                title={opt.desc}
              >
                <span>{opt.label}</span>
                {opt.tag && (
                  <span className={`text-[9px] px-1 py-0.2 rounded font-extrabold ${
                    isSelected ? 'bg-white/20 text-white' : 'bg-indigo-50 text-indigo-700'
                  }`}>
                    {opt.tag}
                  </span>
                )}
              </button>
            );
          })}

          {config.outputResolutionPreset === 'custom' && (
            <div className="flex items-center gap-1 bg-white border border-indigo-300 rounded-lg px-2 py-0.5 shadow-2xs">
              <input
                id="input-custom-output-mp"
                type="number"
                min="15"
                max="100"
                step="1"
                value={config.outputMegaPixels || 15}
                onChange={(e) => {
                  const val = Math.max(15, parseInt(e.target.value, 10) || 15);
                  onChange({
                    ...config,
                    outputMegaPixels: val,
                  });
                }}
                className="w-14 text-xs font-bold text-indigo-700 focus:outline-hidden"
              />
              <span className="text-[10px] font-bold text-slate-500">MP (min 15)</span>
            </div>
          )}
        </div>
      </div>

      {/* SECTION: Format Penamaan Berkas (Kode Prefix Batch) */}
      <div className="bg-gradient-to-r from-slate-50 via-indigo-50/40 to-slate-50 rounded-xl p-3.5 border border-slate-200 flex flex-col md:flex-row md:items-center justify-between gap-3 shadow-2xs">
        <div className="flex items-start sm:items-center gap-3">
          <div className="w-9 h-9 rounded-xl bg-slate-800 text-white flex items-center justify-center shrink-0 shadow-sm shadow-slate-800/20">
            <Tag className="w-5 h-5 stroke-[2.2]" />
          </div>
          <div>
            <div className="flex items-center gap-2 flex-wrap">
              <h3 className="text-xs sm:text-sm font-bold text-slate-900">
                Kode Nama File (Batch Prefix)
              </h3>
              {config.fileCode ? (
                <span className="text-[10px] font-mono font-bold px-2 py-0.5 rounded-full bg-indigo-100 text-indigo-900 border border-indigo-200">
                  Aktif: {config.fileCode.trim()}_1_...
                </span>
              ) : (
                <span className="text-[10px] text-slate-500 font-medium px-2 py-0.5 rounded-full bg-slate-100 border border-slate-200">
                  Standar (Nama Asli)
                </span>
              )}
            </div>
            <p className="text-[11px] text-slate-600 mt-0.5">
              Ubah otomatis nama file output menjadi <code className="font-semibold text-indigo-700">[kode]_[urutan]_[nama_awal]</code> (misal: <code className="font-semibold text-indigo-700">011_1_600_01_stencil_voids_emblem</code>).
            </p>
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-2.5 pl-12 md:pl-0">
          <div className="flex items-center gap-1.5 bg-white border border-slate-300 rounded-xl px-2.5 py-1.5 shadow-2xs">
            <span className="text-[11px] font-bold text-slate-600">Kode:</span>
            <input
              id="settings-file-code-input"
              type="text"
              value={config.fileCode || ''}
              onChange={(e) => onChange({ ...config, fileCode: e.target.value })}
              placeholder="Misal: 011"
              className="w-24 sm:w-28 text-xs font-mono font-bold text-slate-900 placeholder-slate-400 focus:outline-hidden"
              title="Masukkan kode nama file (misal 011)"
            />
            {config.fileCode && (
              <button
                type="button"
                onClick={() => onChange({ ...config, fileCode: '' })}
                className="text-[10px] text-rose-500 hover:text-rose-700 font-bold ml-1 cursor-pointer"
                title="Hapus kode"
              >
                Reset
              </button>
            )}
          </div>

          <div className="flex items-center gap-1 bg-white border border-slate-300 rounded-xl px-2.5 py-1.5 shadow-2xs">
            <span className="text-[11px] font-bold text-slate-600">Mulai:</span>
            <input
              id="settings-start-number-input"
              type="number"
              min="1"
              value={config.startNumber || 1}
              onChange={(e) => onChange({ ...config, startNumber: Math.max(1, parseInt(e.target.value, 10) || 1) })}
              className="w-10 text-xs font-mono font-bold text-slate-900 focus:outline-hidden text-center"
              title="Nomor urut awal (default 1)"
            />
          </div>
        </div>
      </div>

      {/* SECTION 3: Curve Mode Toggle & Presets */}
      <div className="space-y-2">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2">
          <div className="flex items-center gap-2">
            <span className="text-xs font-bold uppercase tracking-wider text-slate-500">
              Bentuk Kurva &amp; Gaya Vektor:
            </span>
          </div>

          <div className="inline-flex items-center p-1 bg-slate-100 rounded-xl border border-slate-200 gap-1 self-start sm:self-auto">
            <button
              type="button"
              id="mode-organik-btn"
              onClick={() => handleCurveModeSelect('spline')}
              className={`px-3 py-1.5 text-xs font-bold rounded-lg transition cursor-pointer flex items-center gap-1.5 ${
                (config.curveStyle || config.mode || 'spline') === 'spline'
                  ? 'bg-white text-indigo-700 shadow-2xs font-extrabold border border-slate-200'
                  : 'text-slate-600 hover:text-slate-900'
              }`}
            >
              <Spline className="w-3.5 h-3.5 text-indigo-600" />
              <span>Organik (Kurva Spline)</span>
            </button>
            <button
              type="button"
              id="mode-geometris-btn"
              onClick={() => handleCurveModeSelect('polygon')}
              className={`px-3 py-1.5 text-xs font-bold rounded-lg transition cursor-pointer flex items-center gap-1.5 ${
                (config.curveStyle || config.mode) === 'polygon'
                  ? 'bg-white text-indigo-700 shadow-2xs font-extrabold border border-slate-200'
                  : 'text-slate-600 hover:text-slate-900'
              }`}
            >
              <Hexagon className="w-3.5 h-3.5 text-purple-600" />
              <span>Geometris (Garis Lurus Poligon)</span>
            </button>
          </div>
        </div>

        {/* Preset Buttons Grid */}
        <div className="grid grid-cols-2 sm:grid-cols-4 lg:grid-cols-7 gap-2">
          {PRESETS.map((preset) => {
            const isSelected = config.preset === preset.id;
            return (
              <button
                key={preset.id}
                id={`preset-btn-${preset.id}`}
                type="button"
                onClick={() => handlePresetSelect(preset.id)}
                className={`p-2.5 rounded-xl text-left border transition cursor-pointer flex flex-col justify-between ${
                  isSelected
                    ? 'bg-indigo-600 border-indigo-600 text-white shadow-sm shadow-indigo-600/30'
                    : 'bg-slate-50 hover:bg-slate-100 border-slate-200 text-slate-700'
                }`}
                title={preset.description}
              >
                <div className="flex items-center justify-between mb-1.5">
                  <div className={`p-1.5 rounded-lg ${isSelected ? 'bg-white/20 text-white' : 'bg-white shadow-2xs'}`}>
                    {getPresetIcon(preset.iconName)}
                  </div>
                  {preset.badge && (
                    <span
                      className={`text-[9px] font-bold px-1.5 py-0.5 rounded ${
                        isSelected
                          ? 'bg-white/20 text-white'
                          : 'bg-indigo-100 text-indigo-800'
                      }`}
                    >
                      {preset.badge}
                    </span>
                  )}
                </div>
                <div>
                  <h4 className="text-xs font-bold truncate leading-snug">
                    {preset.name}
                  </h4>
                  <p className={`text-[10px] mt-0.5 line-clamp-1 ${isSelected ? 'text-indigo-100' : 'text-slate-400'}`}>
                    {preset.id === 'monochrome' ? '2 warna (1-bit)' : `${preset.config.snappedColorCount || preset.config.maxColors || 12} warna`}
                  </p>
                </div>
              </button>
            );
          })}
        </div>
      </div>

      {/* SECTION 4: Controls, Noise Filter, Upscale & Actions */}
      <div className="pt-2 flex flex-col lg:flex-row lg:items-center justify-between gap-4 border-t border-slate-100">
        <div className="flex flex-wrap items-center gap-4">
          <div className="flex items-center gap-2 bg-slate-50 border border-slate-200 px-3 py-1.5 rounded-xl">
            <span className="text-xs font-bold text-slate-700">Filter Bintik:</span>
            <input
              id="setting-filter-speckle-slider"
              type="range"
              min="4"
              max="24"
              step="1"
              value={config.filterSpeckle ?? 10}
              onChange={(e) => onChange({ ...config, filterSpeckle: parseInt(e.target.value, 10) })}
              className="w-16 sm:w-20 accent-indigo-600 cursor-pointer"
              title="Filter bintik/noise untuk membuang micro-paths (rekomendasi 8-16 px)"
            />
            <span className="text-xs font-mono font-bold text-indigo-700 min-w-[2rem] text-right">
              {config.filterSpeckle ?? 10} px
            </span>
          </div>

          <div className="flex items-center gap-1.5">
            <span className="text-xs font-bold text-slate-500 uppercase tracking-wider flex items-center gap-1">
              <Sparkles className="w-3.5 h-3.5 text-amber-500" />
              Upscale:
            </span>
            <div className="inline-flex items-center p-1 bg-slate-100 rounded-xl border border-slate-200 gap-1">
              {[
                { val: 1 as const, label: '1x', desc: 'Ukuran raster asli' },
                { val: 2 as const, label: '2x HD', tag: 'Rekomendasi', desc: 'Resampling Lanczos 2x untuk tepi kurva mulus' },
                { val: 4 as const, label: '4x Ultra', desc: 'Super resolusi sub-pixel untuk gambar kecil' },
              ].map((up) => {
                const isSelected = (config.upscale || 1) === up.val;
                return (
                  <button
                    key={up.val}
                    type="button"
                    onClick={() => handleUpscaleSelect(up.val)}
                    className={`px-2.5 py-1 text-xs font-semibold rounded-lg transition cursor-pointer flex items-center gap-1 ${
                      isSelected
                        ? 'bg-white text-indigo-700 font-bold shadow-2xs border border-slate-200'
                        : 'text-slate-600 hover:text-slate-900'
                    }`}
                    title={up.desc}
                  >
                    <span>{up.label}</span>
                    {up.tag && (
                      <span className={`text-[9px] px-1 rounded font-bold ${
                        isSelected ? 'bg-amber-100 text-amber-800' : 'bg-slate-200 text-slate-600'
                      }`}>
                        {up.tag}
                      </span>
                    )}
                  </button>
                );
              })}
            </div>
          </div>
        </div>

        <div className="flex items-center gap-2 self-end lg:self-center">
          {hasItemsInQueue && onApplyToAll && (
            <button
              id="apply-preset-all-btn"
              type="button"
              onClick={onApplyToAll}
              className="text-xs font-semibold text-indigo-600 hover:text-indigo-800 px-3 py-1.5 rounded-lg hover:bg-indigo-50 transition cursor-pointer"
              title="Terapkan pengaturan ini ke semua gambar di antrean"
            >
              Terapkan ke Antrean
            </button>
          )}

          {hasItemsInQueue && onProcessQueue && (
            <button
              id="settings-process-queue-btn"
              type="button"
              onClick={onProcessQueue}
              disabled={isProcessingBatch}
              className="inline-flex items-center gap-1.5 px-4 py-2 text-xs font-bold text-white bg-gradient-to-r from-indigo-600 to-purple-600 hover:from-indigo-700 hover:to-purple-700 active:scale-95 rounded-xl shadow-sm shadow-indigo-600/30 transition disabled:opacity-50 cursor-pointer"
            >
              <Play className="w-3.5 h-3.5 fill-current" />
              <span>
                {isProcessingBatch
                  ? 'Memproses...'
                  : pendingCount > 0
                  ? `Mulai Vektorisasi (${pendingCount})`
                  : 'Proses Ulang Antrean'}
              </span>
            </button>
          )}

          <button
            id="toggle-advanced-settings-btn"
            type="button"
            onClick={() => setShowAdvanced(!showAdvanced)}
            className="inline-flex items-center gap-1 px-3 py-1.5 text-xs font-semibold text-slate-700 bg-slate-100 hover:bg-slate-200 rounded-xl transition cursor-pointer"
          >
            <Sliders className="w-3.5 h-3.5 text-slate-500" />
            <span>Tuning</span>
            {showAdvanced ? (
              <ChevronUp className="w-3.5 h-3.5" />
            ) : (
              <ChevronDown className="w-3.5 h-3.5" />
            )}
          </button>
        </div>
      </div>

      {/* SECTION 5: Advanced Fine-Tuning Drawer */}
      {showAdvanced && (
        <div className="pt-4 border-t border-slate-100 grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4 text-xs animate-in fade-in duration-150">
          <div className="space-y-1.5">
            <div className="flex justify-between font-semibold text-slate-700">
              <span>Bentuk Fitting Kurva</span>
              <span className="font-bold text-indigo-600 capitalize">
                {(config.curveStyle || config.mode) === 'polygon' ? 'Geometris (Polygon)' : 'Organik (Spline)'}
              </span>
            </div>
            <div className="grid grid-cols-2 gap-1 pt-1">
              <button
                type="button"
                onClick={() => handleCurveModeSelect('spline')}
                className={`py-1.5 px-2 text-[11px] font-semibold rounded-lg border transition cursor-pointer ${
                  (config.curveStyle || config.mode || 'spline') === 'spline'
                    ? 'bg-indigo-50 border-indigo-600 text-indigo-700 font-bold'
                    : 'bg-slate-50 border-slate-200 text-slate-600 hover:bg-slate-100'
                }`}
              >
                Organik (Spline)
              </button>
              <button
                type="button"
                onClick={() => handleCurveModeSelect('polygon')}
                className={`py-1.5 px-2 text-[11px] font-semibold rounded-lg border transition cursor-pointer ${
                  (config.curveStyle || config.mode) === 'polygon'
                    ? 'bg-indigo-50 border-indigo-600 text-indigo-700 font-bold'
                    : 'bg-slate-50 border-slate-200 text-slate-600 hover:bg-slate-100'
                }`}
              >
                Geometris (Poligon)
              </button>
            </div>
            <p className="text-[10px] text-slate-400">
              Gunakan "Geometris" untuk logo/teks agar garis lurus tidak bergelombang.
            </p>
          </div>

          <div className="space-y-1.5">
            <div className="flex justify-between font-semibold text-slate-700">
              <span>Ketajaman Sudut (Corner)</span>
              <span className="font-bold text-indigo-600">{config.cornerThreshold ?? 28}°</span>
            </div>
            <input
              type="range"
              min="15"
              max="90"
              step="1"
              value={config.cornerThreshold ?? 28}
              onChange={(e) => onChange({ ...config, cornerThreshold: parseInt(e.target.value, 10) })}
              className="w-full accent-indigo-600 cursor-pointer"
            />
            <div className="flex justify-between font-semibold text-slate-700 pt-1">
              <span>Panjang Segmen Lurus</span>
              <span className="font-bold text-indigo-600">{config.lengthThreshold ?? 10} px</span>
            </div>
            <input
              type="range"
              min="4"
              max="20"
              step="1"
              value={config.lengthThreshold ?? 10}
              onChange={(e) => onChange({ ...config, lengthThreshold: parseInt(e.target.value, 10) })}
              className="w-full accent-indigo-600 cursor-pointer"
            />
            <p className="text-[10px] text-slate-400">
              Sudut lebih kecil (25-30°) membuat sudut runcing/tajam. Panjang lebih tinggi membuat garis lurus panjang tanpa gerigi.
            </p>
          </div>

          <div className="space-y-1.5">
            <div className="flex justify-between font-semibold text-slate-700">
              <span>Simplifikasi Polygon (RDP)</span>
              <span className="font-bold text-indigo-600">±{config.rdpTolerance ?? 1.0} px</span>
            </div>
            <input
              id="setting-rdp-tolerance-slider"
              type="range"
              min="0.0"
              max="3.0"
              step="0.1"
              value={config.rdpTolerance ?? 1.0}
              onChange={(e) => onChange({ ...config, rdpTolerance: parseFloat(e.target.value) })}
              className="w-full accent-indigo-600 cursor-pointer"
              title="Toleransi Ramer-Douglas-Peucker untuk membuang vertex kecil dari tangga piksel"
            />
            <div className="pt-1">
              <label className="flex items-center gap-1.5 text-[11px] font-semibold text-slate-700 cursor-pointer">
                <input
                  type="checkbox"
                  checked={config.snapVertices !== false}
                  onChange={(e) => onChange({ ...config, snapVertices: e.target.checked })}
                  className="rounded text-indigo-600 focus:ring-indigo-500 w-3.5 h-3.5"
                />
                <span>Snap Vertex Bersebelahan</span>
              </label>
            </div>
            <p className="text-[10px] text-slate-400">
              RDP membuang vertex tangga piksel. Snap vertex membuat tepi antar-facet berimpit persis tanpa celah/garis tipis.
            </p>
          </div>

          <div className="space-y-1.5">
            <div className="flex justify-between font-semibold text-slate-700">
              <span>Mesin Tracing Aktif</span>
              <span className="font-bold text-indigo-600">VTracer (Rust/WASM)</span>
            </div>
            <div className="p-2 bg-slate-50 border border-slate-200 rounded-lg text-[10px] text-slate-600 space-y-0.5">
              <div>Library: <strong>@visioncortex/vtracer v1.0.0-alpha.4</strong></div>
              <div className="text-emerald-700 font-semibold">Upscale 4x Bicubic + Snapping + RDP</div>
              <div className="text-indigo-600">Geometric Coincident Precision</div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
