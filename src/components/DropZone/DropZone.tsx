// ═══════════════════════════════════════════════════════════════
// components/DropZone/DropZone.tsx
// Drag-and-drop target for adding files
// ═══════════════════════════════════════════════════════════════
import { useState, useCallback, useRef } from 'react';
import { getFileType } from '../../types';
import type { CompressFile } from '../../types';
import '../../styles/components/DropZone.css';

const SUPPORTED_FORMATS = ['MP4', 'MOV', 'MKV', 'WebM', 'JPEG', 'PNG', 'WebP', 'GIF', 'PDF', 'HEIC'];

const UploadCloudIcon = () => (
  <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
    <polyline points="16 16 12 12 8 16"/>
    <line x1="12" y1="12" x2="12" y2="21"/>
    <path d="M20.39 18.39A5 5 0 0 0 18 9h-1.26A8 8 0 1 0 3 16.3"/>
  </svg>
);

interface DropZoneProps {
  onFilesAdded: (files: CompressFile[]) => void;
}

let idCounter = 0;
function createCompressFile(file: File): CompressFile {
  const ext = file.name.split('.').pop()?.toLowerCase() ?? '';
  const type = getFileType(file.type, ext);
  const id = `file-${Date.now()}-${idCounter++}`;
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
    previewUrl: type === 'image' ? URL.createObjectURL(file) : undefined,
  };
}

const DropZone: React.FC<DropZoneProps> = ({ onFilesAdded }) => {
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

  const handleDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setIsDragOver(false);
    const files = Array.from(e.dataTransfer.files);
    if (files.length > 0) {
      onFilesAdded(files.map(createCompressFile));
    }
  }, [onFilesAdded]);

  const handleClick = () => {
    inputRef.current?.click();
  };

  const handleInputChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(e.target.files ?? []);
    if (files.length > 0) {
      onFilesAdded(files.map(createCompressFile));
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
          or click to browse your computer
        </div>
      </div>

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
        accept="video/*,image/*,application/pdf,.gif,.heic,.heif"
        onChange={handleInputChange}
        className="sr-only"
        aria-hidden="true"
        tabIndex={-1}
      />
    </div>
  );
};

export default DropZone;
