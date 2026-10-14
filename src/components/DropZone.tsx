import React, { useRef, useState } from 'react';
import { UploadCloud, Image as ImageIcon, Sparkles, Plus, CheckCircle2 } from 'lucide-react';
import { SAMPLE_IMAGES, SampleImage } from '../lib/sampleImages';

interface DropZoneProps {
  onFilesSelected: (files: File[]) => void;
  onSampleSelected: (sample: SampleImage) => void;
  isCompact?: boolean;
}

export const DropZone: React.FC<DropZoneProps> = ({
  onFilesSelected,
  onSampleSelected,
  isCompact = false,
}) => {
  const [isDragOver, setIsDragOver] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const handleDragOver = (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setIsDragOver(true);
  };

  const handleDragLeave = (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setIsDragOver(false);
  };

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setIsDragOver(false);

    if (e.dataTransfer.files && e.dataTransfer.files.length > 0) {
      const validFiles: File[] = [];
      for (let i = 0; i < e.dataTransfer.files.length; i++) {
        const file = e.dataTransfer.files[i];
        if (file.type.startsWith('image/')) {
          validFiles.push(file);
        }
      }
      if (validFiles.length > 0) {
        onFilesSelected(validFiles);
      }
    }
  };

  const handleFileInputChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files && e.target.files.length > 0) {
      const validFiles = Array.from(e.target.files).filter((file) =>
        file.type.startsWith('image/')
      );
      if (validFiles.length > 0) {
        onFilesSelected(validFiles);
      }
      e.target.value = '';
    }
  };

  if (isCompact) {
    return (
      <div className="flex flex-col sm:flex-row items-center gap-3">
        <div
          id="compact-drop-zone"
          onDragOver={handleDragOver}
          onDragLeave={handleDragLeave}
          onDrop={handleDrop}
          onClick={() => fileInputRef.current?.click()}
          className={`flex-1 border-2 border-dashed rounded-xl p-3.5 text-center cursor-pointer transition flex items-center justify-center gap-2.5 ${
            isDragOver
              ? 'border-indigo-500 bg-indigo-50/80 text-indigo-700'
              : 'border-slate-300 hover:border-indigo-400 bg-white hover:bg-slate-50 text-slate-700 shadow-xs'
          }`}
        >
          <input
            ref={fileInputRef}
            type="file"
            multiple
            accept="image/*"
            className="hidden"
            onChange={handleFileInputChange}
          />
          <div className="w-7 h-7 rounded-lg bg-indigo-50 text-indigo-600 flex items-center justify-center">
            <Plus className="w-4 h-4 stroke-[2.5]" />
          </div>
          <span className="text-xs font-bold text-slate-800">
            Unggah Gambar Lainnya (Batch)
          </span>
          <span className="text-xs text-slate-400 hidden md:inline">
            atau tarik gambar ke area ini
          </span>
        </div>

        {/* Quick sample add pills */}
        <div className="flex items-center gap-1.5 overflow-x-auto py-1 max-w-full">
          <span className="text-[11px] font-semibold text-slate-400 shrink-0">Contoh:</span>
          {SAMPLE_IMAGES.slice(0, 3).map((sample) => (
            <button
              key={sample.id}
              type="button"
              onClick={() => onSampleSelected(sample)}
              className="px-2.5 py-1 rounded-lg text-[11px] font-semibold bg-white hover:bg-indigo-50 border border-slate-200 text-slate-700 hover:text-indigo-600 transition shrink-0 cursor-pointer shadow-2xs"
            >
              + {sample.category}
            </button>
          ))}
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {/* Main Drag & Drop Box */}
      <div
        id="batch-drop-zone"
        onDragOver={handleDragOver}
        onDragLeave={handleDragLeave}
        onDrop={handleDrop}
        onClick={() => fileInputRef.current?.click()}
        className={`relative border-2 border-dashed rounded-2xl p-8 sm:p-10 text-center cursor-pointer transition-all duration-200 group ${
          isDragOver
            ? 'border-indigo-600 bg-indigo-50/90 scale-[1.01]'
            : 'border-slate-300 hover:border-indigo-500 bg-white hover:bg-slate-50/70 shadow-sm'
        }`}
      >
        <input
          ref={fileInputRef}
          type="file"
          multiple
          accept="image/*"
          className="hidden"
          onChange={handleFileInputChange}
        />

        <div className="max-w-lg mx-auto flex flex-col items-center">
          <div
            className={`w-16 h-16 rounded-2xl flex items-center justify-center mb-4 transition-transform group-hover:scale-110 duration-200 ${
              isDragOver
                ? 'bg-indigo-600 text-white shadow-lg shadow-indigo-600/30'
                : 'bg-gradient-to-br from-indigo-50 to-purple-50 text-indigo-600 border border-indigo-100 shadow-sm'
            }`}
          >
            <UploadCloud className="w-8 h-8 stroke-[1.8]" />
          </div>

          <h2 className="text-lg sm:text-xl font-bold text-slate-900 mb-1">
            Tarik &amp; Lepas Gambar Anda ke Sini
          </h2>
          <p className="text-xs sm:text-sm text-slate-500 mb-5 leading-relaxed">
            Dukung <strong>gambar multi-warna / full color</strong> menjadi vektor SVG &amp; EPS. Dilengkapi fitur otomatis <strong>ubah background putih jadi transparan</strong>!
          </p>

          <button
            type="button"
            className="px-5 py-2.5 rounded-xl bg-gradient-to-r from-indigo-600 to-purple-600 hover:from-indigo-700 hover:to-purple-700 text-white text-xs sm:text-sm font-bold shadow-md shadow-indigo-500/20 transition active:scale-95 inline-flex items-center gap-2 cursor-pointer"
          >
            <ImageIcon className="w-4 h-4" />
            <span>Pilih Berkas Gambar (Bisa Batch)</span>
          </button>

          <div className="flex flex-wrap items-center justify-center gap-2 mt-5 text-[11px] font-medium text-slate-400">
            <span className="px-2 py-0.5 bg-slate-100 border border-slate-200 rounded">PNG</span>
            <span className="px-2 py-0.5 bg-slate-100 border border-slate-200 rounded">JPG</span>
            <span className="px-2 py-0.5 bg-slate-100 border border-slate-200 rounded">JPEG</span>
            <span className="px-2 py-0.5 bg-slate-100 border border-slate-200 rounded">WEBP</span>
            <span className="px-2 py-0.5 bg-slate-100 border border-slate-200 rounded">BMP</span>
            <span className="px-2 py-0.5 bg-slate-100 border border-slate-200 rounded">GIF</span>
            <span>• Mendukung Vektor Multi-Warna &amp; Transparansi</span>
          </div>
        </div>
      </div>

      {/* Built-in Sample Image Cards for 1-click test */}
      <div className="bg-white rounded-2xl border border-slate-200 p-4 sm:p-5 shadow-xs">
        <div className="flex items-center justify-between mb-3">
          <div className="flex items-center gap-2">
            <Sparkles className="w-4 h-4 text-amber-500" />
            <span className="text-xs font-bold uppercase tracking-wider text-slate-700">
              Atau coba langsung dengan contoh gambar multi-warna:
            </span>
          </div>
          <span className="text-[11px] text-slate-400 hidden sm:inline">
            Klik salah satu untuk menguji fitur multi-warna &amp; transparan
          </span>
        </div>

        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
          {SAMPLE_IMAGES.map((sample) => (
            <button
              key={sample.id}
              id={`sample-btn-${sample.id}`}
              type="button"
              onClick={() => onSampleSelected(sample)}
              className="text-left p-3 rounded-xl border border-slate-200 hover:border-indigo-400 hover:bg-indigo-50/40 transition group flex flex-col justify-between cursor-pointer shadow-2xs hover:shadow-xs"
            >
              <div>
                <div className="flex items-center justify-between gap-1 mb-1">
                  <span className="text-[10px] font-bold uppercase px-1.5 py-0.5 rounded bg-indigo-50 text-indigo-700">
                    {sample.category}
                  </span>
                  {sample.hasWhiteBg && (
                    <span className="text-[9px] font-semibold text-emerald-600 bg-emerald-50 px-1 py-0.5 rounded">
                      Bg Putih
                    </span>
                  )}
                </div>
                <h4 className="text-xs font-bold text-slate-900 group-hover:text-indigo-600 transition truncate">
                  {sample.name.replace('.png', '')}
                </h4>
                <p className="text-[11px] text-slate-500 mt-1 line-clamp-2">
                  {sample.description}
                </p>
              </div>
              <span className="text-[10px] font-semibold text-indigo-600 mt-2.5 flex items-center gap-1 group-hover:translate-x-0.5 transition-transform">
                <span>Muat &amp; Uji Vektor</span>
                <span>→</span>
              </span>
            </button>
          ))}
        </div>
      </div>
    </div>
  );
};
