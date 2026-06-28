// ═══════════════════════════════════════════════════════════════
// types/index.ts — Shared TypeScript types for xCompress
// ═══════════════════════════════════════════════════════════════

export type FileType = 'video' | 'image' | 'gif' | 'pdf' | 'unknown';

export type FileStatus = 'idle' | 'queued' | 'compressing' | 'done' | 'error';

export type QualityPreset = 'highest' | 'high' | 'balanced' | 'small' | 'tiny';

export type VideoFormat = 'MP4' | 'MOV' | 'MKV' | 'WebM';
export type ImageFormat = 'JPEG' | 'PNG' | 'WebP';
export type VideoResolution = 'Same as input' | '4K' | '1080p' | '720p' | '480p';
export type ImageQuality = 'Highest' | 'Good' | 'Balanced' | 'Small';
export type PdfQuality = 'Highest' | 'Good' | 'Balanced' | 'Small';
export type VideoQuality = 'CRF' | 'File size';
export type OutputFolder = 'Same as input' | 'Desktop' | 'Custom';
export type GpuType = 'nvidia' | 'intel' | 'amd' | 'cpu';
export type VideoEncoder = 'auto' | 'best' | 'h265Cpu' | 'h265Gpu' | 'h264Gpu' | 'h264Cpu';

// ── Individual compressed file ───────────────────────────────
export interface CompressFile {
  id: string;
  name: string;
  path: string;
  size: number;           // bytes — original
  compressedSize?: number; // bytes — after compression
  outputPath?: string;     // bytes — path to final compressed file
  outputPreviewUrl?: string;
  width?: number;
  height?: number;
  compressedWidth?: number;
  compressedHeight?: number;
  type: FileType;
  mimeType: string;
  extension: string;
  status: FileStatus;
  progress: number;       // 0–100
  error?: string;
  previewUrl?: string;    // object URL for thumbnail
  thumbnail?: string;     // base64 / data-url
}

// ── Compression settings (right panel state) ─────────────────
export interface CompressionSettings {
  // Output
  outputFolder: OutputFolder;
  outputFolderPath: string;
  removeInputFiles: boolean;

  // Video
  videoQuality: VideoQuality;
  targetFileSizeKb: number;
  videoResolution: VideoResolution;
  videoFormat: VideoFormat;
  videoEncoder: VideoEncoder;
  removeAudio: boolean;

  // Image
  imageQuality: ImageQuality;
  imageFormat: ImageFormat;
  keepImageSize: boolean;

  // PDF
  pdfQuality: PdfQuality;

  // Global quality preset
  qualityPreset: QualityPreset;
}

// ── GPU / hardware info ───────────────────────────────────────
export interface GpuInfo {
  type: GpuType;
  label: string;         // e.g. "RTX 4070", "Arc A770", "Radeon RX 7800"
  encoder: string;       // e.g. "h264_nvenc", "h264_qsv", "h264_amf"
  available: boolean;
}

// ── App-level state ───────────────────────────────────────────
export interface AppState {
  files: CompressFile[];
  settings: CompressionSettings;
  gpu: GpuInfo | null;
  isCompressing: boolean;
  totalSaved: number;    // bytes saved across all done files
}

// ── Default settings ──────────────────────────────────────────
export const DEFAULT_SETTINGS: CompressionSettings = {
  outputFolder: 'Same as input',
  outputFolderPath: '',
  removeInputFiles: false,
  videoQuality: 'CRF',
  targetFileSizeKb: 50 * 1024,
  videoResolution: 'Same as input',
  videoFormat: 'MP4',
  videoEncoder: 'auto',
  removeAudio: false,
  imageQuality: 'Good',
  imageFormat: 'JPEG',
  keepImageSize: true,
  pdfQuality: 'Balanced',
  qualityPreset: 'balanced',
};

// ── Helpers ───────────────────────────────────────────────────
export function formatBytes(bytes: number): string {
  if (bytes === 0) return '0 B';
  const k = 1024;
  const sizes = ['B', 'KB', 'MB', 'GB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return `${parseFloat((bytes / Math.pow(k, i)).toFixed(1))} ${sizes[i]}`;
}

export function getSavingsPct(original: number, compressed: number): number {
  if (!original || !compressed) return 0;
  return Math.round(((original - compressed) / original) * 100);
}

export function getFileType(mimeType: string, ext: string): FileType {
  if (mimeType.startsWith('video/') || ['mp4','mov','mkv','webm','avi','m4v','mpg','mpeg','3gp','mts','m2ts'].includes(ext)) return 'video';
  if (mimeType === 'image/gif' || ext === 'gif') return 'gif';
  if (mimeType.startsWith('image/') || ['jpg','jpeg','png','webp','heic','heif','tif','tiff','bmp','dng','cr2','nef','arw','rw2','raf','orf'].includes(ext)) return 'image';
  if (mimeType === 'application/pdf' || ext === 'pdf') return 'pdf';
  return 'unknown';
}

export function getFileTypeLabel(_type: FileType, ext: string): string {
  return ext.toUpperCase();
}
