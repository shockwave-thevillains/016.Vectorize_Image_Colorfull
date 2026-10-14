import React, { useState, useEffect, useCallback, useRef } from 'react';
import { Header } from './components/Header';
import { DropZone } from './components/DropZone';
import { SettingsBar } from './components/SettingsBar';
import { BatchQueue } from './components/BatchQueue';
import { VectorPreviewModal } from './components/VectorPreviewModal';
import { ImageQueueItem, VectorizeConfig } from './types';
import { DEFAULT_CONFIG, vectorizeImage } from './lib/vectorizer';
import { SAMPLE_IMAGES, SampleImage } from './lib/sampleImages';
import { exportBatchAsZip, BatchZipMode } from './lib/zipExporter';
import { CheckCircle2, AlertCircle, FileArchive, Sparkles, SunMedium, Palette } from 'lucide-react';

export default function App() {
  const [queue, setQueue] = useState<ImageQueueItem[]>([]);
  const [currentConfig, setCurrentConfig] = useState<VectorizeConfig>(DEFAULT_CONFIG);
  const [isProcessingBatch, setIsProcessingBatch] = useState<boolean>(false);
  const [activeModalItem, setActiveModalItem] = useState<ImageQueueItem | null>(null);
  const [isExportingZip, setIsExportingZip] = useState<boolean>(false);
  const [zipProgress, setZipProgress] = useState<{ percent: number; message: string } | null>(null);
  const [toastMessage, setToastMessage] = useState<{ text: string; type: 'success' | 'info' | 'error' } | null>(null);
  const [fileCode, setFileCode] = useState<string>('');
  const [startNumber, setStartNumber] = useState<number>(1);

  const isBatchRunning = useRef(false);
  const queueRef = useRef<ImageQueueItem[]>(queue);
  queueRef.current = queue;

  const showToast = (text: string, type: 'success' | 'info' | 'error' = 'info') => {
    setToastMessage({ text, type });
    setTimeout(() => {
      setToastMessage(null);
    }, 4500);
  };

  // Process a single item by id
  const processItem = useCallback(
    async (itemId: string, overrideConfig?: VectorizeConfig) => {
      const targetItem = queueRef.current.find((i) => i.id === itemId);
      if (!targetItem) return;

      const configToUse = overrideConfig || targetItem.config;

      setQueue((prev) =>
        prev.map((i) =>
          i.id === itemId
            ? {
                ...i,
                config: configToUse,
                status: 'processing',
                progress: 15,
                error: undefined,
              }
            : i
        )
      );

      try {
        const result = await vectorizeImage(
          targetItem.previewUrl,
          configToUse,
          targetItem.name,
          (progress) => {
            setQueue((prev) =>
              prev.map((i) =>
                i.id === itemId ? { ...i, progress } : i
              )
            );
          }
        );

        setQueue((prev) =>
          prev.map((i) => {
            if (i.id === itemId) {
              const updated = {
                ...i,
                status: 'completed' as const,
                progress: 100,
                result,
              };
              setActiveModalItem((curr) => (curr?.id === itemId ? updated : curr));
              return updated;
            }
            return i;
          })
        );
        return result;
      } catch (err: any) {
        console.error('Vectorization error:', err);
        setQueue((prev) =>
          prev.map((i) =>
            i.id === itemId
              ? {
                  ...i,
                  status: 'error' as const,
                  progress: 0,
                  error: err?.message || 'Gagal memvektorisasi gambar',
                }
              : i
          )
        );
      }
    },
    []
  );

  // Process all pending items in queue
  const handleProcessAll = useCallback(async () => {
    if (isBatchRunning.current) return;
    isBatchRunning.current = true;
    setIsProcessingBatch(true);

    const pendingIds = queueRef.current
      .filter((item) => item.status === 'idle' || item.status === 'error')
      .map((item) => item.id);

    // 2 gambar diproses bersamaan: pre-processing gambar berikutnya (main thread)
    // berjalan sambil vtracer gambar sebelumnya bekerja di Web Worker.
    const CONCURRENCY = 2;
    let fallbackCount = 0;
    let cursor = 0;
    const runLane = async () => {
      while (cursor < pendingIds.length) {
        const id = pendingIds[cursor++];
        const result = await processItem(id);
        if (result?.usedFallback) fallbackCount++;
      }
    };
    await Promise.all(
      Array.from({ length: Math.min(CONCURRENCY, pendingIds.length) }, () => runLane())
    );

    setIsProcessingBatch(false);
    isBatchRunning.current = false;

    if (fallbackCount > 0) {
      showToast(
        `${fallbackCount} dari ${pendingIds.length} gambar jatuh ke ImageTracer (vtracer gagal). Cek badge merah & proses ulang sebelum submit.`,
        'error'
      );
    } else if (pendingIds.length > 0) {
      showToast(`Vektorisasi multi-warna selesai untuk ${pendingIds.length} gambar!`, 'success');
    }
  }, [processItem]);

  // Handle uploaded files (single or batch)
  const handleFilesSelected = async (files: File[]) => {
    const newItems: ImageQueueItem[] = [];

    for (const file of files) {
      const dataUrl = await new Promise<string>((resolve) => {
        const reader = new FileReader();
        reader.onload = () => resolve(reader.result as string);
        reader.readAsDataURL(file);
      });

      const { width, height } = await new Promise<{ width: number; height: number }>((resolve) => {
        const img = new Image();
        img.onload = () => resolve({ width: img.naturalWidth, height: img.naturalHeight });
        img.onerror = () => resolve({ width: 800, height: 600 });
        img.src = dataUrl;
      });

      const newItem: ImageQueueItem = {
        id: `img-${Date.now()}-${Math.random().toString(36).substring(2, 9)}`,
        file,
        name: file.name,
        previewUrl: dataUrl,
        originalSize: file.size,
        width,
        height,
        status: 'idle',
        progress: 0,
        config: { ...currentConfig },
      };

      newItems.push(newItem);
    }

    setQueue((prev) => [...prev, ...newItems]);
    showToast(`Berhasil menambahkan ${newItems.length} gambar. Klik "Vektorisasi" untuk memulai.`, 'info');
  };

  // Add pre-loaded sample
  const handleSampleSelected = async (sample: SampleImage) => {
    const dataUrl = sample.getDataUrl();
    const updatedConfig: VectorizeConfig = {
      ...currentConfig,
      bgMode: sample.bgType === 'magenta' ? 'magenta' : 'white',
      removeBackground: true,
      makeWhiteTransparent: sample.bgType !== 'magenta',
      keepInnerWhite: sample.bgType !== 'magenta', // Mode Putih: putih dalam dipertahankan
      whiteRegionOverrides: [],
    };
    setCurrentConfig(updatedConfig);

    const newItem: ImageQueueItem = {
      id: `sample-${Date.now()}-${sample.id}`,
      name: sample.name,
      previewUrl: dataUrl,
      originalSize: Math.round(dataUrl.length * 0.75),
      width: 600,
      height: 600,
      status: 'idle',
      progress: 0,
      config: updatedConfig,
    };

    setQueue((prev) => [newItem, ...prev]);
    showToast(`Memuat "${sample.name}" (Mode: ${updatedConfig.bgMode === 'white' ? 'Putih #FFFFFF' : 'Magenta #FF00FF'}). Siap diuji!`, 'info');
  };

  // On mount, load sample 1
  useEffect(() => {
    const defaultSample = SAMPLE_IMAGES[0];
    handleSampleSelected(defaultSample);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const handleRemoveItem = (itemId: string) => {
    setQueue((prev) => prev.filter((i) => i.id !== itemId));
    if (activeModalItem?.id === itemId) {
      setActiveModalItem(null);
    }
  };

  const handleClearAll = () => {
    setQueue([]);
    setActiveModalItem(null);
    showToast('Antrean gambar dikosongkan', 'info');
  };

  // Pilihan area putih bersifat per gambar → jangan ikut tertimpa pengaturan global.
  const withItemRegions = (cfg: VectorizeConfig, item: ImageQueueItem): VectorizeConfig => ({
    ...cfg,
    whiteRegionOverrides: item.config.whiteRegionOverrides || [],
  });

  const handleApplyConfigToQueue = () => {
    setQueue((prev) =>
      prev.map((i) => ({
        ...i,
        config: withItemRegions(currentConfig, i),
      }))
    );
    showToast('Pengaturan preset diterapkan ke seluruh gambar di antrean', 'success');
  };

  const handleConfigChange = (newConfig: VectorizeConfig) => {
    setCurrentConfig(newConfig);
    if (newConfig.fileCode !== undefined) {
      setFileCode(newConfig.fileCode);
    }
    if (newConfig.startNumber !== undefined) {
      setStartNumber(newConfig.startNumber);
    }
    // Sync idle items with new settings
    setQueue((prev) =>
      prev.map((i) => (i.status === 'idle' ? { ...i, config: withItemRegions(newConfig, i) } : i))
    );
  };

  const handleFileCodeChange = (newCode: string) => {
    setFileCode(newCode);
    setCurrentConfig((prev) => ({ ...prev, fileCode: newCode }));
  };

  const handleStartNumberChange = (num: number) => {
    setStartNumber(num);
    setCurrentConfig((prev) => ({ ...prev, startNumber: num }));
  };

  // Batch download ZIP
  const handleBatchDownloadZip = async (mode: BatchZipMode) => {
    try {
      setIsExportingZip(true);
      setZipProgress({ percent: 10, message: 'Menginisialisasi paket berkas...' });

      await exportBatchAsZip(
        queueRef.current,
        mode,
        (percent, message) => {
          setZipProgress({ percent, message });
        },
        fileCode || currentConfig.fileCode,
        startNumber || currentConfig.startNumber || 1
      );

      const codeNote = fileCode ? ` [Kode: ${fileCode}]` : '';
      showToast(`Export ZIP (${mode.toUpperCase()})${codeNote} berhasil diunduh!`, 'success');
    } catch (err: any) {
      console.error('ZIP Export Error:', err);
      showToast(err?.message || 'Gagal menghasilkan berkas ZIP', 'error');
    } finally {
      setIsExportingZip(false);
      setZipProgress(null);
    }
  };

  const completedCount = queue.filter((i) => i.status === 'completed').length;
  const pendingCount = queue.filter((i) => i.status === 'idle' || i.status === 'error').length;

  const latestUpscaleFactor = (() => {
    if (activeModalItem?.result?.actualUpscaleFactor !== undefined) {
      return activeModalItem.result.actualUpscaleFactor;
    }
    const completedWithFactor = [...queue].reverse().find((i) => i.result?.actualUpscaleFactor !== undefined);
    if (completedWithFactor?.result?.actualUpscaleFactor !== undefined) {
      return completedWithFactor.result.actualUpscaleFactor;
    }
    const targetItem = queue[queue.length - 1];
    if (targetItem && targetItem.width && targetItem.height) {
      const maxDim = Math.max(targetItem.width, targetItem.height);
      const maxWorkingDim = targetItem.config?.maxDimension || 3200;
      if (maxDim >= maxWorkingDim / 1.15 && maxDim <= maxWorkingDim) {
        return 1.0;
      }
      if (maxDim > maxWorkingDim) {
        return Number((maxWorkingDim / maxDim).toFixed(1));
      }
      const req = targetItem.config?.upscale || currentConfig.upscale || 4;
      const s = Math.min(req, maxWorkingDim / maxDim);
      return Number((s < 1.15 ? 1 : s).toFixed(1));
    }
    return currentConfig.upscale || 4;
  })();

  return (
    <div className="min-h-screen bg-slate-100 text-slate-900 flex flex-col font-sans selection:bg-indigo-500 selection:text-white">
      {/* Top Header */}
      <Header
        queueCount={queue.length}
        completedCount={completedCount}
        onBatchProcess={handleProcessAll}
        isProcessingBatch={isProcessingBatch}
        onBatchDownload={() => handleBatchDownloadZip('all')}
        whiteTransparentActive={currentConfig.makeWhiteTransparent}
        bgMode={currentConfig.bgMode}
        activeCurveMode={currentConfig.curveStyle || currentConfig.mode || 'polygon'}
        actualUpscaleFactor={latestUpscaleFactor}
        onToggleCurveMode={(mode) =>
          handleConfigChange({
            ...currentConfig,
            curveStyle: mode,
            mode,
            cornerThreshold: mode === 'polygon' ? 28 : 60,
            lengthThreshold: mode === 'polygon' ? 10 : 4,
          })
        }
      />

      {/* Main Content Area */}
      <main className="flex-1 max-w-7xl w-full mx-auto px-4 sm:px-6 lg:px-8 py-6 sm:py-8 space-y-6">
        {/* Upload Zone & Samples */}
        <section>
          <DropZone
            onFilesSelected={handleFilesSelected}
            onSampleSelected={handleSampleSelected}
            isCompact={queue.length > 0}
          />
        </section>

        {/* Global Vectorizer Settings & Presets */}
        <section>
          <SettingsBar
            config={currentConfig}
            onChange={handleConfigChange}
            onApplyToAll={handleApplyConfigToQueue}
            hasItemsInQueue={queue.length > 0}
            onProcessQueue={handleProcessAll}
            pendingCount={pendingCount}
            isProcessingBatch={isProcessingBatch}
          />
        </section>

        {/* Batch Queue & List of Images */}
        {queue.length > 0 && (
          <section>
            <BatchQueue
              items={queue}
              isProcessingBatch={isProcessingBatch}
              onProcessItem={(id) => processItem(id)}
              onProcessAll={handleProcessAll}
              onRemoveItem={handleRemoveItem}
              onClearAll={handleClearAll}
              onOpenPreview={(item) => setActiveModalItem(item)}
              onBatchDownloadZip={handleBatchDownloadZip}
              isExportingZip={isExportingZip}
              fileCode={fileCode}
              onFileCodeChange={handleFileCodeChange}
              startNumber={startNumber}
              onStartNumberChange={handleStartNumberChange}
            />
          </section>
        )}
      </main>

      {/* Footer */}
      <footer className="border-t border-slate-200 bg-white py-4 text-center text-xs text-slate-500 mt-auto">
        <div className="max-w-7xl mx-auto px-4 flex flex-col sm:flex-row items-center justify-between gap-2">
          <p className="flex items-center gap-1.5 justify-center">
            <Palette className="w-4 h-4 text-indigo-600" />
            <strong>Vectorize Colorful Studio</strong> – Vektor Multi-Warna &amp; Gradasi, Background Putih Transparan
          </p>
          <p className="text-slate-400">
            Output SVG &amp; EPS (gradient asli) • 100% di browser
          </p>
        </div>
      </footer>

      {/* Vector Preview & Comparison Modal */}
      {activeModalItem && (
        <VectorPreviewModal
          item={activeModalItem}
          itemIndex={
            queue.findIndex((i) => i.id === activeModalItem.id) >= 0
              ? (startNumber || 1) + queue.findIndex((i) => i.id === activeModalItem.id)
              : 1
          }
          fileCode={fileCode || activeModalItem.config.fileCode}
          onClose={() => setActiveModalItem(null)}
          onReVectorize={(itemId, newConfig) => processItem(itemId, newConfig)}
          isProcessing={activeModalItem.status === 'processing'}
        />
      )}

      {/* Toast Notification */}
      {toastMessage && (
        <div className="fixed bottom-5 right-5 z-50 animate-in slide-in-from-bottom-5 fade-in duration-200">
          <div
            className={`px-4 py-3 rounded-2xl shadow-xl flex items-center gap-2.5 text-xs font-bold text-white ${
              toastMessage.type === 'success'
                ? 'bg-emerald-600 shadow-emerald-600/30'
                : toastMessage.type === 'error'
                ? 'bg-rose-600 shadow-rose-600/30'
                : 'bg-slate-900 shadow-slate-900/30'
            }`}
          >
            {toastMessage.type === 'success' ? (
              <CheckCircle2 className="w-4 h-4 text-emerald-200" />
            ) : toastMessage.type === 'error' ? (
              <AlertCircle className="w-4 h-4 text-rose-200" />
            ) : (
              <Sparkles className="w-4 h-4 text-amber-300" />
            )}
            <span>{toastMessage.text}</span>
          </div>
        </div>
      )}

      {/* Batch Zip Progress Overlay */}
      {isExportingZip && zipProgress && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/60 backdrop-blur-xs">
          <div className="bg-white rounded-2xl p-6 max-w-sm w-full mx-4 shadow-2xl border border-slate-200 text-center space-y-4">
            <div className="w-12 h-12 rounded-2xl bg-emerald-100 text-emerald-600 flex items-center justify-center mx-auto">
              <FileArchive className="w-6 h-6 animate-pulse" />
            </div>
            <div>
              <h3 className="text-sm font-bold text-slate-900">
                Mengemas Berkas Vektor ZIP
              </h3>
              <p className="text-xs text-slate-500 mt-1">
                {zipProgress.message}
              </p>
            </div>
            <div className="w-full bg-slate-100 h-2 rounded-full overflow-hidden">
              <div
                className="bg-emerald-600 h-full transition-all duration-200 rounded-full"
                style={{ width: `${zipProgress.percent}%` }}
              />
            </div>
            <span className="text-xs font-mono font-bold text-slate-600">
              {zipProgress.percent}%
            </span>
          </div>
        </div>
      )}
    </div>
  );
}
