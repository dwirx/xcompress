// ═══════════════════════════════════════════════════════════════
// components/FileGrid/FileGrid.tsx
// Scrollable grid of file cards + drop zone when empty
// ═══════════════════════════════════════════════════════════════
import React, { useState } from 'react';
import type { CompressFile } from '../../types';
import FileCard from './FileCard';
import DropZone from '../DropZone';
import '../../styles/components/FileGrid.css';

interface FileGridProps {
  files: CompressFile[];
  onFilesAdded: (files: CompressFile[]) => void;
  onRemoveFile: (id: string) => void;
}

const FileGrid: React.FC<FileGridProps> = ({ files, onFilesAdded, onRemoveFile }) => {
  const [selectedId, setSelectedId] = useState<string | null>(null);

  if (files.length === 0) {
    return (
      <div style={{ flex: 1, display: 'flex', padding: 'var(--space-4)', overflow: 'hidden' }}>
        <DropZone onFilesAdded={onFilesAdded} />
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
            isSelected={selectedId === file.id}
            onSelect={(id) => setSelectedId(id === selectedId ? null : id)}
          />
        </div>
      ))}
    </div>
  );
};

export default FileGrid;
