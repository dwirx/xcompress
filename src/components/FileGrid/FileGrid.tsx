// ═══════════════════════════════════════════════════════════════
// components/FileGrid/FileGrid.tsx
// Scrollable grid of file cards + drop zone when empty
// ═══════════════════════════════════════════════════════════════
import React from 'react';
import type { CompressFile } from '../../types';
import FileCard from './FileCard';
import DropZone from '../DropZone';
import '../../styles/components/FileGrid.css';

interface FileGridProps {
  files: CompressFile[];
  onFilesAdded: (files: CompressFile[]) => void;
  onRemoveFile: (id: string) => void;
  onAddFolder?: () => void;
  selectedIds: Set<string>;
  onToggleSelected: (id: string) => void;
}

const FileGrid: React.FC<FileGridProps> = ({
  files,
  onFilesAdded,
  onRemoveFile,
  onAddFolder,
  selectedIds,
  onToggleSelected,
}) => {
  if (files.length === 0) {
    return (
      <div style={{ flex: 1, display: 'flex', padding: 'var(--space-4)', overflow: 'hidden' }}>
        <DropZone onFilesAdded={onFilesAdded} onAddFolder={onAddFolder} />
      </div>
    );
  }

  return (
    <div
      id="file-grid"
      className="file-grid"
      role="list"
      aria-label={`${files.length} file${files.length !== 1 ? 's' : ''} queued`}
    >
      {files.map((file) => (
        <div key={file.id} role="listitem">
          <FileCard
            file={file}
            onRemove={onRemoveFile}
            isSelected={selectedIds.has(file.id)}
            onSelect={onToggleSelected}
          />
        </div>
      ))}
    </div>
  );
};

export default FileGrid;
