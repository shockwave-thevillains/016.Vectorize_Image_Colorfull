/**
 * Helper utility for file naming formatting with custom prefix codes and sequence indices.
 * Requirement:
 * "tambahkan kode nama file, jadi misal jika saya input kode 011,
 *  maka nama file akan berubah menjadi 011_1_nama file awal, misal 600_01_stencil_voids_emblem,
 *  dan nantinya akan menyesuaikan 011_1, 011_2, dst sejumlah banyaknya file"
 */

/**
 * Cleans the base name of a file by removing its extension and stripping forbidden characters.
 */
export function getCleanBaseName(fileName: string): string {
  if (!fileName) return 'vector_output';
  return fileName
    .replace(/\.[^/.]+$/, '') // remove extension (.png, .jpg, etc.)
    .trim()
    .replace(/[^a-zA-Z0-9_\-\s]/g, '_')
    .replace(/\s+/g, '_');
}

/**
 * Formats a file name according to user prefix code and sequence index.
 * If fileCode is "011", index is 1, originalName is "600_01_stencil_voids_emblem.jpg":
 * Result without ext: "011_1_600_01_stencil_voids_emblem"
 * Result with ext 'svg': "011_1_600_01_stencil_voids_emblem.svg"
 * If fileCode is empty:
 * Result: "600_01_stencil_voids_emblem.svg"
 */
export function formatFileName(
  originalName: string,
  index: number = 1,
  fileCode?: string,
  extension?: string
): string {
  const baseName = getCleanBaseName(originalName);
  const cleanCode = fileCode ? fileCode.trim().replace(/_+$/, '') : '';

  let formatted = baseName;
  if (cleanCode) {
    formatted = `${cleanCode}_${index}_${baseName}`;
  }

  if (extension) {
    const cleanExt = extension.replace(/^\./, '');
    return `${formatted}.${cleanExt}`;
  }

  return formatted;
}
