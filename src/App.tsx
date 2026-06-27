import { useState, useCallback, useMemo, useEffect } from 'react';
import './styles/globals.css';
import './App.css';

import TitleBar       from './components/TitleBar';
import FileGrid       from './components/FileGrid';
import SettingsPanel  from './components/SettingsPanel';
import CompressButton from './components/CompressButton';
import StatusBar      from './components/StatusBar';

import type { CompressFile, CompressionSettings, FileType } from './types';
import { DEFAULT_SETTINGS, getFileType } from './types';
import {
  useGpuDetect,
  useCompressor,
  useFolderPicker,
  isTauri,
} from './hooks/useTauri';

const PlusIcon = () => (
  <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round">
    <line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/>
  </svg>
);

interface Toast {
  id: string;
  message: string;
  type: 'success' | 'error' | 'info';
}

let toastId = 0;

function App() {
  const [files, setFiles]       = useState<CompressFile[]>([]);
  const [settings, setSettings] = useState<CompressionSettings>(DEFAULT_SETTINGS);
  const [isCompressing, setIsCompressing] = useState(false);
  const [toasts, setToasts]     = useState<Toast[]>([]);
  const [isDragOver, setIsDragOver] = useState(false);

  const gpu                   = useGpuDetect();
  const { pickFolder }        = useFolderPicker();

  const addToast = useCallback((message: string, type: Toast['type'] = 'info') => {
    const id = `toast-${toastId++}`;
    setToasts(prev => [...prev, { id, message, type }]);
    setTimeout(() => setToasts(prev => prev.filter(t => t.id !== id)), 4000);
  }, []);

  const handleFilesAdded = useCallback((newFiles: CompressFile[]) => {
    setFiles(prev => {
      const existing = new Set(prev.map(f => `${f.name}-${f.size}`));
      const unique = newFiles.filter(f => !existing.has(`${f.name}-${f.size}`));
      return [...prev, ...unique];
    });
  }, []);

  // Global window drag and drop handlers to fallback in browser
  const handleDragOverGlobal = useCallback((e: DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    if (!isTauri()) {
      setIsDragOver(true);
    }
  }, []);

  const handleDragLeaveGlobal = useCallback((e: DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    if (!isTauri()) {
      setIsDragOver(false);
    }
  }, []);

  const handleDropGlobal = useCallback((e: DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    if (!isTauri()) {
      setIsDragOver(false);
    }
  }, []);

  useEffect(() => {
    window.addEventListener('dragover', handleDragOverGlobal);
    window.addEventListener('dragleave', handleDragLeaveGlobal);
    window.addEventListener('drop', handleDropGlobal);
    return () => {
      window.removeEventListener('dragover', handleDragOverGlobal);
      window.removeEventListener('dragleave', handleDragLeaveGlobal);
      window.removeEventListener('drop', handleDropGlobal);
    };
  }, [handleDragOverGlobal, handleDragLeaveGlobal, handleDropGlobal]);

  // Tauri native drag and drop listeners
  useEffect(() => {
    if (!isTauri()) return;

    let unlistenDragDrop: (() => void) | null = null;
    let unlistenDragEnter: (() => void) | null = null;
    let unlistenDragLeave: (() => void) | null = null;

    const setupTauriDragDrop = async () => {
      const { listen } = await import('@tauri-apps/api/event');
      const { invoke } = await import('@tauri-apps/api/core');

      unlistenDragEnter = await listen<any>('tauri://drag-enter', () => {
        setIsDragOver(true);
      });

      unlistenDragLeave = await listen<any>('tauri://drag-leave', () => {
        setIsDragOver(false);
      });

      unlistenDragDrop = await listen<any>('tauri://drag-drop', async (event) => {
        setIsDragOver(false);
        const paths = event.payload.paths as string[];
        if (!paths || paths.length === 0) return;

        const newFilesList: CompressFile[] = [];
        let localCounter = 0;
        
        for (const filePath of paths) {
          const parts = filePath.split(/[/\\]/);
          const name = parts[parts.length - 1];
          const ext = name.split('.').pop()?.toLowerCase() ?? '';
          const type = getFileType('', ext);
          
          let size = 0;
          try {
            size = await invoke<number>('get_file_size', { path: filePath });
          } catch (e) {
            console.error("Gagal mendapatkan ukuran file:", e);
          }

          newFilesList.push({
            id: `file-${Date.now()}-${localCounter++}`,
            name,
            path: filePath,
            size,
            type,
            mimeType: '',
            extension: ext,
            status: 'idle',
            progress: 0,
          });
        }

        handleFilesAdded(newFilesList);
      });
    };

    setupTauriDragDrop();

    return () => {
      if (unlistenDragDrop) unlistenDragDrop();
      if (unlistenDragEnter) unlistenDragEnter();
      if (unlistenDragLeave) unlistenDragLeave();
    };
  }, [handleFilesAdded]);

  const handleProgress = useCallback((id: string, progress: number) => {
    setFiles(prev => prev.map(f =>
      f.id === id ? { ...f, status: 'compressing' as const, progress } : f
    ));
  }, []);

  const handleDone = useCallback((id: string, compressedSize: number) => {
    setFiles(prev => prev.map(f =>
      f.id === id ? { ...f, status: 'done' as const, progress: 100, compressedSize } : f
    ));
  }, []);

  const handleError = useCallback((id: string, msg: string) => {
    setFiles(prev => prev.map(f =>
      f.id === id ? { ...f, status: 'error' as const, progress: 0, error: msg } : f
    ));
    addToast(`Error: ${msg}`, 'error');
  }, [addToast]);

  const { compressFile } = useCompressor({
    gpu,
    onProgress: handleProgress,
    onDone: handleDone,
    onError: handleError,
  });

  const doneFiles  = useMemo(() => files.filter(f => f.status === 'done'), [files]);
  const totalSaved = useMemo(() =>
    doneFiles.reduce((acc, f) => acc + (f.size - (f.compressedSize ?? f.size)), 0),
    [doneFiles]
  );
  
  const overallPct = useMemo(() => {
    if (files.length === 0) return 0;
    const sum = files.reduce((acc, f) =>
      acc + (f.status === 'done' ? 100 : f.progress), 0
    );
    return sum / files.length;
  }, [files]);

  const fileTypesPresent = useMemo<FileType[]>(() => {
    const types = new Set<FileType>();
    files.forEach(f => {
      types.add(f.type);
    });
    return Array.from(types);
  }, [files]);

  const handleRemoveFile = useCallback((id: string) => {
    setFiles(prev => {
      const file = prev.find(f => f.id === id);
      if (file?.previewUrl) URL.revokeObjectURL(file.previewUrl);
      return prev.filter(f => f.id !== id);
    });
  }, []);

  const handleClearFiles = useCallback(() => {
    setFiles(prev => {
      prev.forEach(f => { if (f.previewUrl) URL.revokeObjectURL(f.previewUrl); });
      return [];
    });
  }, []);

  const handleSettingsChange = useCallback(<K extends keyof CompressionSettings>(
    key: K, value: CompressionSettings[K]
  ) => {
    setSettings(prev => ({ ...prev, [key]: value }));
  }, []);

  const handleChangeOutputFolder = useCallback(async () => {
    const folder = await pickFolder();
    if (folder) {
      handleSettingsChange('outputFolder', 'Custom');
      handleSettingsChange('outputFolderPath', folder);
    }
  }, [pickFolder, handleSettingsChange]);

  const handleCompress = useCallback(async () => {
    if (files.length === 0 || isCompressing) return;

    const pendingFiles = files.filter(f => f.status === 'idle' || f.status === 'error');
    if (pendingFiles.length === 0) return;

    setIsCompressing(true);

    setFiles(prev => prev.map(f =>
      pendingFiles.find(pf => pf.id === f.id)
        ? { ...f, status: 'queued' as const, progress: 0 }
        : f
    ));

    const outputDir = settings.outputFolder === 'Custom'
      ? settings.outputFolderPath
      : '';

    for (const file of pendingFiles) {
      try {
        await compressFile(file, settings, outputDir);
      } catch (e) {
        handleError(file.id, String(e));
      }
    }

    setIsCompressing(false);
    const successCount = pendingFiles.length;
    addToast(`✓ ${successCount} file berhasil dikompresi!`, 'success');
  }, [files, isCompressing, settings, compressFile, handleError, addToast]);

  return (
    <div className={`app ${isDragOver ? 'app--drag-over' : ''}`} role="application" aria-label="xCompress">
      <div className="toast-container" aria-live="polite" aria-label="Notifications">
        {toasts.map(toast => (
          <div key={toast.id} className={`toast toast--${toast.type}`}>
            {toast.message}
          </div>
        ))}
      </div>

      <TitleBar
        onImport={() => document.getElementById('drop-zone')?.click()}
        onOpenHistory={() => addToast('Fitur Riwayat akan hadir di v0.2', 'info')}
        onOpenSettings={() => addToast('Fitur Pengaturan Global akan hadir di v0.2', 'info')}
      />

      <div className="app__body">
        <div className="app__left">
          {files.length > 0 && (
            <div className="app__left-toolbar">
              <h2>{files.length} file dalam antrean</h2>
              <div className="app__left-toolbar-actions">
                <button
                  id="btn-add-more"
                  className="toolbar-btn toolbar-btn--accent"
                  onClick={() => document.getElementById('drop-zone')?.click()}
                  type="button"
                >
                  <PlusIcon /> Tambah File
                </button>
                <button
                  id="btn-clear-all"
                  className="toolbar-btn"
                  onClick={handleClearFiles}
                  disabled={isCompressing}
                  type="button"
                >
                  Bersihkan Semua
                </button>
              </div>
            </div>
          )}

          <FileGrid
            files={files}
            onFilesAdded={handleFilesAdded}
            onRemoveFile={handleRemoveFile}
          />

          <StatusBar
            totalSaved={totalSaved}
            doneCount={doneFiles.length}
            isCompressing={isCompressing}
          />
        </div>

        <div className="app__right">
          <SettingsPanel
            fileCount={files.length}
            settings={settings}
            gpu={gpu}
            onSettingsChange={handleSettingsChange}
            onClearFiles={handleClearFiles}
            onChangeOutputFolder={handleChangeOutputFolder}
            fileTypesPresent={fileTypesPresent}
          />
          <div className="app__compress-wrap">
            <CompressButton
              fileCount={files.filter(f => f.status === 'idle' || f.status === 'error').length}
              isCompressing={isCompressing}
              overallProgress={overallPct}
              doneCount={doneFiles.length}
              onClick={handleCompress}
            />
          </div>
        </div>
      </div>
    </div>
  );
}

export default App;
