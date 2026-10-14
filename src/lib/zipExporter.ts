import JSZip from 'jszip';
import { ImageQueueItem } from '../types';
import { formatFileName } from './fileNameHelper';

export type BatchZipMode = 'all' | 'svg_only' | 'eps_only';

export async function exportBatchAsZip(
  items: ImageQueueItem[],
  mode: BatchZipMode = 'all',
  onProgress?: (percent: number, currentFile: string) => void,
  fileCode?: string,
  startNumber: number = 1
): Promise<void> {
  const completedItems = items.filter((item) => item.status === 'completed' && item.result);

  if (completedItems.length === 0) {
    throw new Error('Belum ada gambar yang selesai di-vektorisasi untuk di-download.');
  }

  const zip = new JSZip();
  const folderName = `vectorize_export_${new Date().toISOString().slice(0, 10)}`;
  const root = zip.folder(folderName) || zip;

  let totalFiles = 0;
  if (mode === 'all') totalFiles = completedItems.length * 2;
  else totalFiles = completedItems.length;

  let processedCount = 0;

  for (let i = 0; i < completedItems.length; i++) {
    const item = completedItems[i];
    if (!item.result) continue;

    const itemIndex = startNumber + i;
    const effectiveCode = fileCode || item.config.fileCode;
    const baseName = formatFileName(item.name, itemIndex, effectiveCode);

    if (mode === 'all' || mode === 'svg_only') {
      const svgFileName = `${baseName}.svg`;
      root.file(svgFileName, item.result.svgString);
      processedCount++;
      onProgress?.(Math.round((processedCount / totalFiles) * 80), svgFileName);
    }

    if (mode === 'all' || mode === 'eps_only') {
      const epsFileName = `${baseName}.eps`;
      root.file(epsFileName, item.result.epsString);
      processedCount++;
      onProgress?.(Math.round((processedCount / totalFiles) * 80), epsFileName);
    }
  }

  const manifest = `Vectorize Multi-Color Studio Export
===================================================
Tanggal Export : ${new Date().toLocaleString('id-ID')}
Mode Download  : ${mode.toUpperCase()}
Total Gambar   : ${completedItems.length}
${fileCode ? `Kode File      : ${fileCode} (Pola: ${fileCode}_1_..., ${fileCode}_2_... dst)` : ''}

Daftar Berkas Vektor:
${completedItems
  .map(
    (item, idx) => {
      const num = startNumber + idx;
      const effectiveCode = fileCode || item.config.fileCode;
      const formatted = formatFileName(item.name, num, effectiveCode);
      return `- ${formatted} (Asal: ${item.name} | ${item.result?.width}x${item.result?.height}px [${item.result?.outputMegaPixels ? `${item.result.outputMegaPixels} MP` : `${(((item.result?.width || 0) * (item.result?.height || 0)) / 1000000).toFixed(1)} MP`}], ${item.result?.colorCount} warna, ${item.result?.pathCount} path kurva, Transparansi: ${item.config.removeBackground !== false ? ((item.config.bgMode ?? 'magenta') === 'magenta' ? 'Magenta Transparan' : 'Putih Transparan') : 'Solid'})`;
    }
  )
  .join('\n')}

Format:
- SVG: Standar W3C Scalable Vector Graphics
- EPS: Encapsulated PostScript Level 2/3 (Kompatibel dengan Adobe Illustrator, CorelDraw, Inkscape)
`;

  root.file('manifest.txt', manifest);

  onProgress?.(85, 'Mengompres arsip ZIP...');

  const content = await zip.generateAsync(
    {
      type: 'blob',
      compression: 'DEFLATE',
      compressionOptions: { level: 6 },
    },
    (metadata) => {
      onProgress?.(85 + Math.round(metadata.percent * 0.15), 'Menyiapkan berkas ZIP...');
    }
  );

  onProgress?.(100, 'Selesai!');

  const url = URL.createObjectURL(content);
  const a = document.createElement('a');
  a.href = url;
  const cleanCode = (fileCode || completedItems[0]?.config?.fileCode)?.trim().replace(/_+$/, '');
  const prefix = cleanCode ? `${cleanCode}_` : '';
  a.download = `${prefix}${folderName}_${mode}.zip`;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  setTimeout(() => URL.revokeObjectURL(url), 1500);
}
