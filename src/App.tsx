import { useState, useCallback, useMemo, useEffect, useRef } from 'react';
import './styles/globals.css';
import './App.css';

import TitleBar       from './components/TitleBar';
import FileGrid       from './components/FileGrid';
import SettingsPanel  from './components/SettingsPanel';
import CompressButton from './components/CompressButton';
import StatusBar      from './components/StatusBar';

import type { CompressFile, CompressionSettings, FileType } from './types';
import { DEFAULT_SETTINGS, formatBytes, getFileType } from './types';
import {
  useGpuDetect,
  useCompressor,
  useFolderPicker,
  isTauri,
  getMediaInfo,
  getPreviewUrl,
  hasGhostscript,
  expandPaths,
  type QueuedFileInfo,
} from './hooks/useTauri';

const PlusIcon = () => (
  <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round">
    <line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/>
  </svg>
);

const FolderPlusIcon = () => (
  <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
    <path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z"/>
    <line x1="12" y1="11" x2="12" y2="17"/>
    <line x1="9" y1="14" x2="15" y2="14"/>
  </svg>
);

interface Toast {
  id: string;
  message: string;
  type: 'success' | 'error' | 'info' | 'warning';
}

let toastId = 0;
const APP_STATE_STORAGE_KEY = 'xcompress.appState.v1';

type PersistedFile = Omit<CompressFile, 'previewUrl' | 'outputPreviewUrl'>;

interface PersistedAppState {
  files: PersistedFile[];
  settings: CompressionSettings;
  selectedFileIds: string[];
}

function fileForStorage(file: CompressFile): PersistedFile {
  const { previewUrl: _previewUrl, outputPreviewUrl: _outputPreviewUrl, ...storedFile } = file;
  if (storedFile.status === 'compressing' || storedFile.status === 'queued') {
    storedFile.status = 'idle';
    storedFile.progress = 0;
  }
  return storedFile;
}

function App() {
  const [files, setFiles]       = useState<CompressFile[]>([]);
  const [settings, setSettings] = useState<CompressionSettings>(DEFAULT_SETTINGS);
  const [isCompressing, setIsCompressing] = useState(false);
  const [toasts, setToasts]     = useState<Toast[]>([]);
  const [isDragOver, setIsDragOver] = useState(false);
  const [selectedFileIds, setSelectedFileIds] = useState<Set<string>>(new Set());
  const [activeBatchIds, setActiveBatchIds] = useState<Set<string>>(new Set());
  const hasRestoredStateRef = useRef(false);

  const gpu                   = useGpuDetect();
  const { pickFolder }        = useFolderPicker();

  const addToast = useCallback((message: string, type: Toast['type'] = 'info') => {
    const id = `toast-${toastId++}`;
    setToasts(prev => [...prev, { id, message, type }]);
    setTimeout(() => setToasts(prev => prev.filter(t => t.id !== id)), 4000);
  }, []);

  const handleFilesAdded = useCallback((newFiles: CompressFile[]) => {
    const hasPdf = newFiles.some(file => file.type === 'pdf');
    if (hasPdf) {
      void (async () => {
        const available = await hasGhostscript();
        if (!available) {
          addToast('PDF compression needs Ghostscript. Install Ghostscript before compressing PDF files.', 'warning');
        }
      })();
    }

    setFiles(prev => {
      const existing = new Set(prev.map(f => `${f.path}-${f.size}`));
      const unique = newFiles.filter(f => !existing.has(`${f.path}-${f.size}`));
      if (unique.length > 0) {
        setSelectedFileIds(current => {
          const next = new Set(current);
          unique.forEach(file => next.add(file.id));
          return next;
        });
      }
      return [...prev, ...unique];
    });
  }, [addToast]);

  const createFileFromQueuedInfo = useCallback(async (info: QueuedFileInfo, index: number): Promise<CompressFile> => {
    const mediaInfo = await getMediaInfo(info.path);
    const previewUrl = await getPreviewUrl(info.path, info.fileType);

    return {
      id: `file-${Date.now()}-${index}`,
      name: info.name,
      path: info.path,
      size: info.size,
      type: info.fileType,
      mimeType: '',
      extension: info.extension,
      status: 'idle',
      progress: 0,
      previewUrl,
      width: mediaInfo?.width,
      height: mediaInfo?.height,
    };
  }, []);

  useEffect(() => {
    let cancelled = false;

    const restoreState = async () => {
      try {
        const rawState = localStorage.getItem(APP_STATE_STORAGE_KEY);
        if (!rawState) return;

        const saved = JSON.parse(rawState) as Partial<PersistedAppState>;
        if (saved.settings) {
          setSettings({ ...DEFAULT_SETTINGS, ...saved.settings });
        }

        const savedFiles = Array.isArray(saved.files) ? saved.files : [];
        const restoredFiles = await Promise.all(savedFiles.map(async (file) => {
          const status = file.status === 'compressing' || file.status === 'queued' ? 'idle' : file.status;
          const previewUrl = await getPreviewUrl(file.path, file.type);
          const outputPreviewUrl = file.outputPath ? await getPreviewUrl(file.outputPath, file.type) : undefined;
          const mediaInfo = await getMediaInfo(file.path);
          const outputInfo = file.outputPath ? await getMediaInfo(file.outputPath) : null;

          return {
            ...file,
            status,
            progress: status === 'done' ? 100 : 0,
            previewUrl,
            outputPreviewUrl,
            width: file.width ?? mediaInfo?.width,
            height: file.height ?? mediaInfo?.height,
            compressedWidth: file.compressedWidth ?? outputInfo?.width,
            compressedHeight: file.compressedHeight ?? outputInfo?.height,
          } satisfies CompressFile;
        }));

        if (cancelled) return;

        setFiles(restoredFiles);
        const restoredIds = new Set(restoredFiles.map(file => file.id));
        setSelectedFileIds(new Set((saved.selectedFileIds ?? []).filter(id => restoredIds.has(id))));
      } catch (error) {
        console.error('Gagal memulihkan state xCompress:', error);
        localStorage.removeItem(APP_STATE_STORAGE_KEY);
      } finally {
        hasRestoredStateRef.current = true;
      }
    };

    void restoreState();

    return () => { cancelled = true; };
  }, []);

  useEffect(() => {
    if (!hasRestoredStateRef.current || isCompressing) return;

    const stateToSave: PersistedAppState = {
      files: files.map(fileForStorage),
      settings,
      selectedFileIds: Array.from(selectedFileIds),
    };

    localStorage.setItem(APP_STATE_STORAGE_KEY, JSON.stringify(stateToSave));
  }, [files, isCompressing, selectedFileIds, settings]);

  const addPathsFromTauri = useCallback(async (paths: string[]) => {
    const expanded = await expandPaths(paths);
    if (expanded.length === 0) {
      addToast('Tidak ada file media yang didukung di path tersebut.', 'warning');
      return;
    }
    const filesToAdd = await Promise.all(expanded.map((info, index) => createFileFromQueuedInfo(info, index)));
    handleFilesAdded(filesToAdd);
    if (expanded.length > paths.length) {
      addToast(`Menambahkan ${expanded.length} file dari folder.`, 'info');
    }
  }, [addToast, createFileFromQueuedInfo, handleFilesAdded]);

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
        await addPathsFromTauri(paths);
      });
    };

    setupTauriDragDrop();

    return () => {
      if (unlistenDragDrop) unlistenDragDrop();
      if (unlistenDragEnter) unlistenDragEnter();
      if (unlistenDragLeave) unlistenDragLeave();
    };
  }, [addPathsFromTauri, handleFilesAdded]);

  const handleProgress = useCallback((id: string, progress: number) => {
    setFiles(prev => prev.map(f =>
      f.id === id ? { ...f, status: 'compressing' as const, progress } : f
    ));
  }, []);

  const handleDone = useCallback((id: string, compressedSize: number, outputPath?: string) => {
    setFiles(prev => prev.map(f =>
      f.id === id ? { ...f, status: 'done' as const, progress: 100, compressedSize, outputPath } : f
    ));

    if (outputPath) {
      void (async () => {
        const info = await getMediaInfo(outputPath);
        const outputExt = outputPath.split('.').pop()?.toLowerCase() ?? '';
        const outputPreviewUrl = await getPreviewUrl(outputPath, getFileType('', outputExt));
        setFiles(prev => {
          return prev.map(f => f.id === id ? {
            ...f,
            compressedWidth: info?.width,
            compressedHeight: info?.height,
            outputPreviewUrl,
          } : f);
        });
      })();
    }
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
  const selectedPendingFiles = useMemo(
    () => files.filter(f => selectedFileIds.has(f.id) && (f.status === 'idle' || f.status === 'error')),
    [files, selectedFileIds]
  );
  const selectableFiles = useMemo(
    () => files.filter(f => f.status !== 'compressing'),
    [files]
  );
  const selectedFile = useMemo(
    () => files.find(f => selectedFileIds.has(f.id)) ?? null,
    [files, selectedFileIds]
  );
  const latestDoneFile = useMemo(
    () => [...files].reverse().find(f => f.status === 'done' && f.outputPath) ?? null,
    [files]
  );
  const outputSummaryFile = selectedFile?.status === 'done' && selectedFile.outputPath ? selectedFile : latestDoneFile;
  const totalSaved = useMemo(() =>
    doneFiles.reduce((acc, f) => acc + (f.size - (f.compressedSize ?? f.size)), 0),
    [doneFiles]
  );
  
  const overallPct = useMemo(() => {
    const progressFiles = isCompressing && activeBatchIds.size > 0
      ? files.filter(f => activeBatchIds.has(f.id))
      : files;
    if (progressFiles.length === 0) return 0;
    const sum = progressFiles.reduce((acc, f) =>
      acc + (f.status === 'done' || f.status === 'error' ? 100 : f.progress), 0
    );
    return sum / progressFiles.length;
  }, [activeBatchIds, files, isCompressing]);

  const activeBatchDoneCount = useMemo(() => {
    if (!isCompressing || activeBatchIds.size === 0) return doneFiles.length;
    return files.filter(f => activeBatchIds.has(f.id) && (f.status === 'done' || f.status === 'error')).length;
  }, [activeBatchIds, doneFiles.length, files, isCompressing]);

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
      if (file?.previewUrl?.startsWith('blob:')) URL.revokeObjectURL(file.previewUrl);
      if (file?.outputPreviewUrl?.startsWith('blob:')) URL.revokeObjectURL(file.outputPreviewUrl);
      return prev.filter(f => f.id !== id);
    });
    setSelectedFileIds(prev => {
      const next = new Set(prev);
      next.delete(id);
      return next;
    });
  }, []);

  const handleClearFiles = useCallback(() => {
    setFiles(prev => {
      prev.forEach(f => { if (f.previewUrl?.startsWith('blob:')) URL.revokeObjectURL(f.previewUrl); });
      prev.forEach(f => { if (f.outputPreviewUrl?.startsWith('blob:')) URL.revokeObjectURL(f.outputPreviewUrl); });
      return [];
    });
    setSelectedFileIds(new Set());
    localStorage.removeItem(APP_STATE_STORAGE_KEY);
  }, []);

  const handleToggleSelected = useCallback((id: string) => {
    if (isCompressing) return;
    setSelectedFileIds(prev => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }, [isCompressing]);

  const handleSelectAll = useCallback(() => {
    setSelectedFileIds(new Set(selectableFiles.map(file => file.id)));
  }, [selectableFiles]);

  const handleUnselectAll = useCallback(() => {
    setSelectedFileIds(new Set());
  }, []);

  const handleRevealOutputSummary = useCallback(async () => {
    if (!isTauri() || !outputSummaryFile?.outputPath) return;
    const { invoke } = await import('@tauri-apps/api/core');
    await invoke('reveal_in_explorer', { path: outputSummaryFile.outputPath }).catch(console.error);
  }, [outputSummaryFile]);

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

  const handleAddFolder = useCallback(async () => {
    const folder = await pickFolder();
    if (folder) {
      await addPathsFromTauri([folder]);
    }
  }, [addPathsFromTauri, pickFolder]);

  const handleCompress = useCallback(async () => {
    if (files.length === 0 || isCompressing) return;

    const pendingFiles = selectedPendingFiles;
    if (pendingFiles.length === 0) {
      addToast('Pilih minimal satu file yang belum dikompresi.', 'warning');
      return;
    }

    setIsCompressing(true);
    setActiveBatchIds(new Set(pendingFiles.map(file => file.id)));

    setFiles(prev => prev.map(f =>
      pendingFiles.find(pf => pf.id === f.id)
        ? { ...f, status: 'queued' as const, progress: 0 }
        : f
    ));

    const outputDir = settings.outputFolder === 'Custom'
      ? settings.outputFolderPath
      : '';

    const concurrency = Math.min(4, Math.max(2, Math.floor((navigator.hardwareConcurrency || 4) / 2)));
    let nextIndex = 0;
    let successCount = 0;

    const worker = async () => {
      while (nextIndex < pendingFiles.length) {
        const file = pendingFiles[nextIndex++];
        try {
          await compressFile(file, settings, outputDir);
          successCount += 1;
        } catch (e) {
          handleError(file.id, String(e));
        }
      }
    };

    await Promise.all(Array.from({ length: Math.min(concurrency, pendingFiles.length) }, () => worker()));

    setIsCompressing(false);
    setActiveBatchIds(new Set());
    addToast(`✓ ${successCount} dari ${pendingFiles.length} file berhasil dikompresi.`, successCount > 0 ? 'success' : 'error');
  }, [files.length, isCompressing, selectedPendingFiles, settings, compressFile, handleError, addToast]);

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
              <div className="app__left-title">
                <h2>{files.length} file dalam antrean</h2>
                <span>{selectedFileIds.size} dipilih · {selectedPendingFiles.length} siap compress</span>
              </div>
              <div className="app__left-toolbar-actions">
                <button
                  className="toolbar-btn"
                  onClick={handleSelectAll}
                  disabled={isCompressing || selectableFiles.length === 0 || selectedFileIds.size === selectableFiles.length}
                  type="button"
                >
                  Select All
                </button>
                <button
                  className="toolbar-btn"
                  onClick={handleUnselectAll}
                  disabled={isCompressing || selectedFileIds.size === 0}
                  type="button"
                >
                  Unselect
                </button>
                <button
                  id="btn-add-more"
                  className="toolbar-btn toolbar-btn--accent"
                  onClick={() => document.getElementById('drop-zone')?.click()}
                  type="button"
                >
                  <PlusIcon /> Tambah File
                </button>
                {isTauri() && (
                  <button
                    id="btn-add-folder"
                    className="toolbar-btn"
                    onClick={handleAddFolder}
                    disabled={isCompressing}
                    type="button"
                  >
                    <FolderPlusIcon /> Tambah Folder
                  </button>
                )}
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
            onAddFolder={isTauri() ? handleAddFolder : undefined}
            selectedIds={selectedFileIds}
            onToggleSelected={handleToggleSelected}
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
              fileCount={isCompressing ? activeBatchIds.size : selectedPendingFiles.length}
              isCompressing={isCompressing}
              overallProgress={overallPct}
              doneCount={activeBatchDoneCount}
              onClick={handleCompress}
            />
            {outputSummaryFile && (
              <div className="output-summary">
                <div className="output-summary__head">
                  <div className="output-summary__status">Output file</div>
                  <button className="output-summary__open" onClick={handleRevealOutputSummary} type="button">
                    Open Folder
                  </button>
                </div>
                <div className="output-summary__filename" title={outputSummaryFile.name}>
                  {outputSummaryFile.outputPath?.split(/[\\/]/).pop() ?? outputSummaryFile.name}
                </div>
                <div className="output-summary__row">
                  <span>Output size</span>
                  <strong>{formatBytes(outputSummaryFile.compressedSize ?? outputSummaryFile.size)}</strong>
                </div>
                <div className="output-summary__row">
                  <span>Size reduced</span>
                  <strong>{formatBytes(Math.max(0, outputSummaryFile.size - (outputSummaryFile.compressedSize ?? outputSummaryFile.size)))}</strong>
                </div>
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

export default App;
