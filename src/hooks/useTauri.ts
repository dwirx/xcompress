// ═══════════════════════════════════════════════════════════════
// hooks/useTauri.ts
// Wrapper around Tauri invoke + event listeners
// Falls back to mock in browser (non-Tauri) environment
// ═══════════════════════════════════════════════════════════════
import { useState, useEffect, useRef, useCallback } from 'react';
import type { GpuInfo, CompressFile, CompressionSettings } from '../types';

// ── Detect if running inside Tauri ───────────────────────────
export const isTauri = (): boolean => {
  return typeof window !== 'undefined' && '__TAURI_INTERNALS__' in window;
};

// ── Lazy-load Tauri modules ───────────────────────────────────
async function tauriInvoke<T>(cmd: string, args?: Record<string, unknown>): Promise<T> {
  const { invoke } = await import('@tauri-apps/api/core');
  return invoke<T>(cmd, args);
}

async function tauriListen<T>(event: string, cb: (payload: T) => void) {
  const { listen } = await import('@tauri-apps/api/event');
  return listen<T>(event, (e) => cb(e.payload));
}

// ── Progress event shape from Rust ───────────────────────────
interface ProgressEvent {
  id: string;
  progress: number;
  status: 'compressing' | 'done' | 'error' | 'cancelled';
  compressedSize?: number;
  outputPath?: string;
  errorMsg?: string;
}

// ── GPU Info from Rust ────────────────────────────────────────
interface RustGpuInfo {
  gpuType: string;
  label: string;
  encoder: string;
  available: boolean;
}

export interface MediaInfo {
  width?: number;
  height?: number;
  duration?: number;
}

export interface QueuedFileInfo {
  path: string;
  name: string;
  size: number;
  fileType: CompressFile['type'];
  extension: string;
}

export async function expandPaths(paths: string[]): Promise<QueuedFileInfo[]> {
  if (!isTauri()) return [];
  try {
    return await tauriInvoke<QueuedFileInfo[]>('expand_paths', { paths });
  } catch {
    return [];
  }
}

export async function getMediaInfo(path: string): Promise<MediaInfo | null> {
  if (!isTauri()) return null;
  try {
    return await tauriInvoke<MediaInfo>('get_media_info', { path });
  } catch {
    return null;
  }
}

export async function hasGhostscript(): Promise<boolean> {
  if (!isTauri()) return true;
  try {
    return await tauriInvoke<boolean>('has_ghostscript');
  } catch {
    return false;
  }
}

export async function getPreviewUrl(path: string, type: CompressFile['type']): Promise<string | undefined> {
  if (!isTauri() || !['image', 'gif', 'video'].includes(type)) return undefined;
  const { convertFileSrc } = await import('@tauri-apps/api/core');
  return convertFileSrc(path);
}

export async function prepareVideoPreview(path: string): Promise<string | undefined> {
  if (!isTauri()) return undefined;
  const { convertFileSrc } = await import('@tauri-apps/api/core');
  const previewPath = await tauriInvoke<string>('prepare_video_preview', { path });
  return convertFileSrc(previewPath);
}

// ═══════════════════════════════════════════════════════════════
// Hook: useGpuDetect
// ═══════════════════════════════════════════════════════════════
export function useGpuDetect() {
  const [gpu, setGpu] = useState<GpuInfo | null>(null);

  useEffect(() => {
    (async () => {
      if (isTauri()) {
        try {
          const info = await tauriInvoke<RustGpuInfo>('detect_gpu');
          setGpu({
            type: info.gpuType as GpuInfo['type'],
            label: info.label,
            encoder: info.encoder,
            available: info.available,
          });
        } catch {
          setGpu({ type: 'cpu', label: 'Software (libx264)', encoder: 'libx264', available: true });
        }
      } else {
        // Browser mock
        setGpu({ type: 'cpu', label: 'Browser preview mode', encoder: 'libx264', available: true });
      }
    })();
  }, []);

  return gpu;
}

// ═══════════════════════════════════════════════════════════════
// Hook: useCompressor
// ═══════════════════════════════════════════════════════════════
interface UseCompressorOptions {
  gpu: GpuInfo | null;
  onProgress: (id: string, progress: number) => void;
  onDone: (id: string, compressedSize: number, outputPath?: string) => void;
  onError: (id: string, msg: string) => void;
  onCancelled: (id: string) => void;
}

export function useCompressor({ gpu, onProgress, onDone, onError, onCancelled }: UseCompressorOptions) {
  const unlistenRef = useRef<(() => void) | null>(null);

  // Setup event listener
  useEffect(() => {
    if (!isTauri()) return;
    let unlisten: (() => void) | null = null;
    tauriListen<ProgressEvent>('compress_progress', (payload) => {
      if (payload.status === 'compressing') {
        onProgress(payload.id, payload.progress);
      } else if (payload.status === 'done') {
        onDone(payload.id, payload.compressedSize ?? 0, payload.outputPath);
      } else if (payload.status === 'error') {
        onError(payload.id, payload.errorMsg ?? 'Unknown error');
      } else if (payload.status === 'cancelled') {
        onCancelled(payload.id);
      }
    }).then((fn) => { unlisten = fn; unlistenRef.current = fn; });
    return () => { unlisten?.(); };
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const compressFile = useCallback(async (
    file: CompressFile,
    settings: CompressionSettings,
    outputDir: string,
  ) => {
    if (!isTauri()) {
      // Mock compression for browser preview
      await mockCompress(file, onProgress, onDone);
      return;
    }

    const crf = settings.qualityPreset === 'highest' ? 18
      : settings.qualityPreset === 'high'    ? 21
      : settings.qualityPreset === 'balanced' ? 24
      : settings.qualityPreset === 'small' ? 28 : 31;

    await tauriInvoke('compress_file', {
      request: {
        id: file.id,
        inputPath: file.path,
        outputPath: outputDir,
        fileType: file.type,
        videoFormat: settings.videoFormat,
        videoQuality: settings.videoQuality,
        crfValue: crf,
        targetKb: settings.targetFileSizeKb,
        resolution: settings.videoResolution,
        removeAudio: settings.removeAudio,
        imageQuality: settings.imageQuality,
        imageFormat: settings.imageFormat,
        pdfQuality: settings.pdfQuality,
        encoder: settings.videoEncoder,
      },
    });
  }, [gpu, onProgress, onDone, onError]);

  const cancelCompression = useCallback(async (ids: string[] = []) => {
    if (!isTauri()) return;
    await tauriInvoke('cancel_compression', { ids });
  }, []);

  return { compressFile, cancelCompression };
}

// ── Mock for browser preview ──────────────────────────────────
async function mockCompress(
  file: CompressFile,
  onProgress: (id: string, p: number) => void,
  onDone: (id: string, sz: number) => void,
) {
  for (let p = 0; p <= 95; p += 5) {
    await new Promise(r => setTimeout(r, 40));
    onProgress(file.id, p);
  }
  onDone(file.id, Math.round(file.size * 0.28));
}

// ═══════════════════════════════════════════════════════════════
// Hook: useFolderPicker
// ═══════════════════════════════════════════════════════════════
export function useFolderPicker() {
  const pickFolder = useCallback(async (): Promise<string | null> => {
    if (!isTauri()) return null;
    try {
      return await tauriInvoke<string | null>('pick_folder');
    } catch {
      return null;
    }
  }, []);

  return { pickFolder };
}

// ═══════════════════════════════════════════════════════════════
// Hook: useWindowControls (for custom titlebar)
// ═══════════════════════════════════════════════════════════════
export function useWindowControls() {
  const close = useCallback(async () => {
    if (!isTauri()) return;
    const { getCurrentWindow } = await import('@tauri-apps/api/window');
    await getCurrentWindow().close();
  }, []);

  const minimize = useCallback(async () => {
    if (!isTauri()) return;
    const { getCurrentWindow } = await import('@tauri-apps/api/window');
    await getCurrentWindow().minimize();
  }, []);

  const toggleMaximize = useCallback(async () => {
    if (!isTauri()) return;
    const { getCurrentWindow } = await import('@tauri-apps/api/window');
    await getCurrentWindow().toggleMaximize();
  }, []);

  const startDragging = useCallback(async () => {
    if (!isTauri()) return;
    const { getCurrentWindow } = await import('@tauri-apps/api/window');
    await getCurrentWindow().startDragging();
  }, []);

  return { close, minimize, toggleMaximize, startDragging };
}
