// ═══════════════════════════════════════════════════════════════
// components/DropZone/DropZone.tsx
// Drag-and-drop target for adding files
// ═══════════════════════════════════════════════════════════════
import { useState, useCallback, useRef } from 'react';
import { getFileType } from '../../types';
import type { CompressFile } from '../../types';
import '../../styles/components/DropZone.css';

const SUPPORTED_FORMATS = ['MP4', 'MOV', 'MKV', 'WebM', 'JPEG', 'PNG', 'WebP', 'HEIC', 'TIFF', 'DNG', 'GIF', 'PDF'];

const UploadCloudIcon = () => (
  <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
    <polyline points="16 16 12 12 8 16"/>
    <line x1="12" y1="12" x2="12" y2="21"/>
    <path d="M20.39 18.39A5 5 0 0 0 18 9h-1.26A8 8 0 1 0 3 16.3"/>
  </svg>
);

interface DropZoneProps {
  onFilesAdded: (files: CompressFile[]) => void;
  onAddFolder?: () => void;
}

let idCounter = 0;
async function createCompressFile(file: File): Promise<CompressFile> {
  const ext = file.name.split('.').pop()?.toLowerCase() ?? '';
  const type = getFileType(file.type, ext);
  const id = `file-${Date.now()}-${idCounter++}`;
  const previewUrl = ['image', 'gif', 'video'].includes(type) ? URL.createObjectURL(file) : undefined;
  const dimensions = await measureBrowserFile(file, type, previewUrl);

  return {
    id,
    name: file.name,
    path: (file as any).path ?? file.name,
    size: file.size,
    type,
    mimeType: file.type,
    extension: ext,
    status: 'idle',
    progress: 0,
    previewUrl,
    width: dimensions?.width,
    height: dimensions?.height,
  };
}

async function measureBrowserFile(
  file: File,
  type: CompressFile['type'],
  previewUrl?: string,
): Promise<{ width: number; height: number } | null> {
  if (!previewUrl) return null;

  if (type === 'image' || type === 'gif') {
    try {
      const bitmap = await createImageBitmap(file);
      const dimensions = { width: bitmap.width, height: bitmap.height };
      bitmap.close();
      return dimensions;
    } catch {
      return null;
    }
  }

  if (type === 'video') {
    return new Promise((resolve) => {
      const video = document.createElement('video');
      video.preload = 'metadata';
      video.onloadedmetadata = () => {
        resolve({ width: video.videoWidth, height: video.videoHeight });
      };
      video.onerror = () => resolve(null);
      video.src = previewUrl;
    });
  }

  return null;
}

const DropZone: React.FC<DropZoneProps> = ({ onFilesAdded, onAddFolder }) => {
  const [isDragOver, setIsDragOver] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  const handleDragEnter = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setIsDragOver(true);
  }, []);

  const handleDragLeave = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    // only leave if leaving the zone itself
    if (!e.currentTarget.contains(e.relatedTarget as Node)) {
      setIsDragOver(false);
    }
  }, []);

  const handleDragOver = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
  }, []);

  const handleDrop = useCallback(async (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setIsDragOver(false);
    const files = Array.from(e.dataTransfer.files);
    if (files.length > 0) {
      onFilesAdded(await Promise.all(files.map(createCompressFile)));
    }
  }, [onFilesAdded]);

  const handleClick = () => {
    inputRef.current?.click();
  };

  const handleFolderClick = (e: React.MouseEvent) => {
    e.stopPropagation();
    onAddFolder?.();
  };

  const handleInputChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(e.target.files ?? []);
    if (files.length > 0) {
      onFilesAdded(await Promise.all(files.map(createCompressFile)));
    }
    // reset so same file can be re-added
    e.target.value = '';
  };

  return (
    <div
      id="drop-zone"
      className={`drop-zone${isDragOver ? ' drop-zone--drag-over' : ''}`}
      onDragEnter={handleDragEnter}
      onDragLeave={handleDragLeave}
      onDragOver={handleDragOver}
      onDrop={handleDrop}
      onClick={handleClick}
      role="button"
      tabIndex={0}
      aria-label="Drop files here or click to browse"
      onKeyDown={(e) => e.key === 'Enter' && handleClick()}
    >
      <div className="drop-zone__icon-wrap">
        <UploadCloudIcon />
      </div>

      <div>
        <div className="drop-zone__title">
          {isDragOver ? 'Release to add files' : 'Drop files here'}
        </div>
        <div className="drop-zone__subtitle">
          or click to browse your computer. Folders can be dropped directly.
        </div>
      </div>

      {onAddFolder && (
        <button className="drop-zone__folder-btn" onClick={handleFolderClick} type="button">
          Add Folder
        </button>
      )}

      <div className="drop-zone__formats">
        {SUPPORTED_FORMATS.map((fmt) => (
          <span key={fmt} className="drop-zone__format-pill">{fmt}</span>
        ))}
      </div>

      {/* Hidden file input */}
      <input
        ref={inputRef}
        type="file"
        multiple
        accept="video/*,image/*,application/pdf,.gif,.heic,.heif,.tif,.tiff,.dng,.cr2,.nef,.arw,.rw2,.raf,.orf,.mts,.m2ts"
        onChange={handleInputChange}
        className="sr-only"
        aria-hidden="true"
        tabIndex={-1}
      />
    </div>
  );
};

export default DropZone;
