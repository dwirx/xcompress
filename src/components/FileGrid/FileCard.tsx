// ═══════════════════════════════════════════════════════════════
// components/FileGrid/FileCard.tsx — v3 with Before/After & Open File
// ═══════════════════════════════════════════════════════════════
import React, { useEffect, useMemo, useState } from 'react';
import { createPortal } from 'react-dom';
import type { CompressFile } from '../../types';
import { formatBytes, getSavingsPct } from '../../types';
import { getPreviewUrl, isTauri } from '../../hooks/useTauri';

// ── Icons ─────────────────────────────────────────────────────
const VideoIcon = () => (
  <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round">
    <polygon points="23 7 16 12 23 17 23 7"/><rect x="1" y="5" width="15" height="14" rx="2" ry="2"/>
  </svg>
);
const ImageIcon = () => (
  <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round">
    <rect x="3" y="3" width="18" height="18" rx="2"/>
    <circle cx="8.5" cy="8.5" r="1.5"/>
    <polyline points="21 15 16 10 5 21"/>
  </svg>
);
const PdfIcon = () => (
  <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round">
    <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/>
    <polyline points="14 2 14 8 20 8"/>
    <line x1="9" y1="15" x2="15" y2="15"/>
  </svg>
);
const GifIcon = () => (
  <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round">
    <rect x="3" y="3" width="18" height="18" rx="2"/>
    <path d="M10 9H8a2 2 0 0 0-2 2v2a2 2 0 0 0 2 2h2v-2h-1"/>
    <line x1="13" y1="9" x2="13" y2="15"/>
    <path d="M16 9h2v2h-2v2h2"/>
  </svg>
);
const CheckIcon = () => (
  <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round">
    <polyline points="20 6 9 17 4 12"/>
  </svg>
);
const ErrorIcon = () => (
  <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round">
    <line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/>
  </svg>
);
const XIcon = () => (
  <svg width="9" height="9" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round">
    <line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/>
  </svg>
);
const FolderIcon = () => (
  <svg width="8" height="8" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
    <path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z"/>
  </svg>
);
const PlayIcon = () => (
  <svg width="8" height="8" viewBox="0 0 24 24" fill="currentColor">
    <polygon points="5 3 19 12 5 21 5 3"/>
  </svg>
);
const ExpandIcon = () => (
  <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round">
    <polyline points="15 3 21 3 21 9"/>
    <polyline points="9 21 3 21 3 15"/>
    <line x1="21" y1="3" x2="14" y2="10"/>
    <line x1="3" y1="21" x2="10" y2="14"/>
  </svg>
);
const PlayOverlayIcon = () => (
  <div style={{
    width: 36, height: 36,
    borderRadius: '50%',
    background: 'rgba(0,0,0,0.55)',
    backdropFilter: 'blur(4px)',
    border: '1px solid rgba(255,255,255,0.2)',
    display: 'flex', alignItems: 'center', justifyContent: 'center',
  }}>
    <svg width="14" height="14" viewBox="0 0 24 24" fill="white">
      <polygon points="5 3 19 12 5 21 5 3"/>
    </svg>
  </div>
);

const PreviewMedia: React.FC<{ src: string; type: CompressFile['type']; alt: string; className: string; controls?: boolean }> = ({
  src,
  type,
  alt,
  className,
  controls = false,
}) => {
  if (type === 'video') {
    return (
      <video
        className={className}
        src={src}
        muted
        controls={controls}
        playsInline
        preload="metadata"
      />
    );
  }

  return <img className={className} src={src} alt={alt} loading="lazy" />;
};

// ── Circular progress ring ────────────────────────────────────
const ProgressRing: React.FC<{ progress: number }> = ({ progress }) => {
  const r = 18;
  const circ = 2 * Math.PI * r;
  const offset = circ - (progress / 100) * circ;
  return (
    <div className="file-card__progress-circle">
      <svg width="46" height="46" viewBox="0 0 46 46">
        <circle className="file-card__progress-track" cx="23" cy="23" r={r} />
        <circle className="file-card__progress-fill"  cx="23" cy="23" r={r}
          strokeDasharray={circ}
          strokeDashoffset={offset}
        />
      </svg>
      <div className="file-card__progress-text">{Math.round(progress)}%</div>
    </div>
  );
};

// ── Props ─────────────────────────────────────────────────────
interface FileCardProps {
  file: CompressFile;
  onRemove: (id: string) => void;
  isSelected: boolean;
  onSelect: (id: string) => void;
}

// ── Component ─────────────────────────────────────────────────
const FileCard: React.FC<FileCardProps> = ({ file, onRemove, isSelected, onSelect }) => {
  const {
    id,
    name,
    size,
    compressedSize,
    outputPath,
    type,
    extension,
    status,
    progress,
    previewUrl,
    path,
    width,
    height,
    compressedWidth,
    compressedHeight,
  } = file;
  const savings = compressedSize ? getSavingsPct(size, compressedSize) : 0;
  const [comparePosition, setComparePosition] = useState(50);
  const [resolvedOutputPreview, setResolvedOutputPreview] = useState<string | undefined>(file.outputPreviewUrl);
  const [isPreviewOpen, setIsPreviewOpen] = useState(false);
  const canPreview = ['image', 'gif', 'video'].includes(type);

  useEffect(() => {
    let cancelled = false;
    setResolvedOutputPreview(file.outputPreviewUrl);

    if (!file.outputPreviewUrl && outputPath && canPreview) {
      getPreviewUrl(outputPath, type).then((url) => {
        if (!cancelled) setResolvedOutputPreview(url);
      });
    }

    return () => { cancelled = true; };
  }, [canPreview, file.outputPreviewUrl, outputPath, type]);

  const dimensionLabel = useMemo(() => {
    const shownWidth = status === 'done' ? (compressedWidth ?? width) : width;
    const shownHeight = status === 'done' ? (compressedHeight ?? height) : height;
    return shownWidth && shownHeight ? `${shownWidth}×${shownHeight}` : null;
  }, [compressedHeight, compressedWidth, height, status, width]);
  const outputExtension = useMemo(() => {
    const outputName = outputPath?.split(/[\\/]/).pop();
    return outputName?.includes('.') ? outputName.split('.').pop()?.toUpperCase() : extension.toUpperCase();
  }, [extension, outputPath]);
  const beforeLabel = `Before: ${formatBytes(size)}, ${extension.toUpperCase()}`;
  const afterLabel = `After: ${formatBytes(compressedSize ?? size)}, ${outputExtension ?? extension.toUpperCase()}`;

  const handleRemove = (e: React.MouseEvent) => { e.stopPropagation(); onRemove(id); };
  const handleSelect = (e: React.MouseEvent) => {
    e.stopPropagation();
    onSelect(id);
  };

  const setCompareFromPointer = (event: React.PointerEvent<HTMLElement>) => {
    const bounds = event.currentTarget.getBoundingClientRect();
    if (bounds.width <= 0) return;
    const nextPosition = ((event.clientX - bounds.left) / bounds.width) * 100;
    setComparePosition(Math.min(100, Math.max(0, nextPosition)));
  };

  const handleComparePointerDown = (event: React.PointerEvent<HTMLElement>) => {
    event.preventDefault();
    event.stopPropagation();
    setCompareFromPointer(event);
    event.currentTarget.setPointerCapture(event.pointerId);
  };

  const handleComparePointerMove = (event: React.PointerEvent<HTMLElement>) => {
    if (!event.currentTarget.hasPointerCapture(event.pointerId)) return;
    setCompareFromPointer(event);
  };

  const handleComparePointerUp = (event: React.PointerEvent<HTMLElement>) => {
    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId);
    }
  };

  const handleCompareKeyDown = (event: React.KeyboardEvent<HTMLElement>) => {
    if (event.key === 'ArrowLeft' || event.key === 'ArrowDown') {
      event.preventDefault();
      setComparePosition(position => Math.max(0, position - 2));
    } else if (event.key === 'ArrowRight' || event.key === 'ArrowUp') {
      event.preventDefault();
      setComparePosition(position => Math.min(100, position + 2));
    } else if (event.key === 'Home') {
      event.preventDefault();
      setComparePosition(0);
    } else if (event.key === 'End') {
      event.preventDefault();
      setComparePosition(100);
    }
  };

  const handleOpenPreview = (e: React.MouseEvent) => {
    e.stopPropagation();
    if (previewUrl && canPreview) setIsPreviewOpen(true);
  };

  useEffect(() => {
    if (!isPreviewOpen) return;

    const handleEscape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setIsPreviewOpen(false);
    };

    document.addEventListener('keydown', handleEscape);
    return () => document.removeEventListener('keydown', handleEscape);
  }, [isPreviewOpen]);

  const handleReveal = async (e: React.MouseEvent) => {
    e.stopPropagation();
    if (!isTauri()) return;
    const { invoke } = await import('@tauri-apps/api/core');
    await invoke('reveal_in_explorer', { path: outputPath || path }).catch(console.error);
  };

  const handleOpenFile = async (e: React.MouseEvent) => {
    e.stopPropagation();
    if (!isTauri() || !outputPath) return;
    try {
      const { openPath } = await import('@tauri-apps/plugin-opener');
      await openPath(outputPath);
    } catch (err) {
      console.error("Gagal membuka berkas:", err);
    }
  };

  const PlaceholderIcon = type === 'video' ? VideoIcon
    : type === 'pdf' ? PdfIcon
    : type === 'gif' ? GifIcon
    : ImageIcon;

  const cardClass = [
    'file-card',
    isSelected ? 'file-card--selected' : '',
    status === 'done' ? 'file-card--done' : '',
    status === 'error' ? 'file-card--error' : '',
  ].filter(Boolean).join(' ');

  const previewModal = isPreviewOpen && previewUrl && typeof document !== 'undefined'
    ? createPortal(
      <div
        className="file-preview-modal"
        onClick={() => setIsPreviewOpen(false)}
        role="dialog"
        aria-modal="true"
        aria-label={`Preview ${name}`}
      >
        <div className="file-preview-modal__panel" onClick={(e) => e.stopPropagation()}>
          <div className="file-preview-modal__header">
            <div>
              <div className="file-preview-modal__title">{name}</div>
              <div className="file-preview-modal__meta">
                {dimensionLabel ? `${dimensionLabel} · ` : ''}{formatBytes(compressedSize ?? size)}
                {status === 'done' && compressedSize ? ` · -${savings}%` : ''}
              </div>
            </div>
            <button
              className="file-preview-modal__close"
              onClick={() => setIsPreviewOpen(false)}
              type="button"
              aria-label="Tutup preview"
            >
              <XIcon />
            </button>
          </div>

          {status === 'done' && resolvedOutputPreview ? (
            <div
              className="file-preview-modal__compare"
              role="slider"
              tabIndex={0}
              aria-label={`Drag the slider to compare before and after for ${name}`}
              aria-valuemin={0}
              aria-valuemax={100}
              aria-valuenow={Math.round(comparePosition)}
              onPointerDown={handleComparePointerDown}
              onPointerMove={handleComparePointerMove}
              onPointerUp={handleComparePointerUp}
              onPointerCancel={handleComparePointerUp}
              onKeyDown={handleCompareKeyDown}
            >
              <PreviewMedia src={previewUrl} type={type} alt={`${name} before`} className="file-preview-modal__media" controls={type === 'video'} />
              <div
                className="file-preview-modal__compare-after"
                style={{ clipPath: `inset(0 0 0 ${comparePosition}%)` }}
              >
                <PreviewMedia src={resolvedOutputPreview} type={type} alt={`${name} after`} className="file-preview-modal__media" controls={type === 'video'} />
              </div>
              <div className="file-preview-modal__divider" style={{ left: `${comparePosition}%` }} />
              <div className="file-preview-modal__label file-preview-modal__label--before">{beforeLabel}</div>
              <div className="file-preview-modal__label file-preview-modal__label--after">{afterLabel}</div>
              <div className="file-preview-modal__hint">Drag the slider to compare before and after</div>
            </div>
          ) : (
            <div className="file-preview-modal__single">
              <PreviewMedia src={previewUrl} type={type} alt={name} className="file-preview-modal__media" controls={type === 'video'} />
            </div>
          )}
        </div>
      </div>,
      document.body
    )
    : null;

  return (
    <>
    <div
      id={`file-card-${id}`}
      className={cardClass}
      onClick={() => onSelect(id)}
      role="button"
      tabIndex={0}
      aria-label={`${name}, ${formatBytes(size)}, status: ${status}`}
      onKeyDown={(e) => e.key === 'Enter' && onSelect(id)}
    >
      {/* Thumbnail / Placeholder */}
      {status === 'done' && previewUrl && resolvedOutputPreview && canPreview ? (
        <div className="file-card__compare" onClick={handleOpenPreview} title="Preview besar">
          <PreviewMedia src={previewUrl} type={type} alt={`${name} before`} className="file-card__thumb file-card__thumb--compare" />
          <div
            className="file-card__compare-after"
            style={{ clipPath: `inset(0 0 0 ${comparePosition}%)` }}
          >
            <PreviewMedia src={resolvedOutputPreview} type={type} alt={`${name} after`} className="file-card__thumb file-card__thumb--compare" />
          </div>
          <div className="file-card__compare-divider" style={{ left: `${comparePosition}%` }} />
          <div className="file-card__compare-label file-card__compare-label--before">{beforeLabel}</div>
          <div className="file-card__compare-label file-card__compare-label--after">{afterLabel}</div>
          <input
            className="file-card__compare-range"
            type="range"
            min={0}
            max={100}
            value={comparePosition}
            onClick={(e) => e.stopPropagation()}
            onPointerDown={(e) => e.stopPropagation()}
            onChange={(e) => setComparePosition(Number(e.target.value))}
            aria-label={`Compare before and after for ${name}`}
          />
        </div>
      ) : previewUrl && canPreview ? (
        <div className="file-card__preview-bg" onClick={handleOpenPreview} title="Preview besar">
          <PreviewMedia src={previewUrl} type={type} alt={name} className="file-card__thumb" />
        </div>
      ) : (
        <div className="file-card__placeholder">
          <div className="file-card__placeholder-icon"><PlaceholderIcon /></div>
          <div className="file-card__placeholder-ext">{extension}</div>
        </div>
      )}

      {/* Video play hint */}
      {type === 'video' && status !== 'done' && (
        <div className="file-card__play"><PlayOverlayIcon /></div>
      )}

      {previewUrl && canPreview && (
        <button
          className="file-card__preview-open"
          onClick={handleOpenPreview}
          type="button"
          title="Preview besar"
          aria-label={`Preview ${name}`}
        >
          <ExpandIcon />
        </button>
      )}

      {/* Type + size tag (before compression) */}
      {status !== 'done' && (
        <div className="file-card__type-tag">
          {extension.toUpperCase()} · {formatBytes(size)}
        </div>
      )}

      {dimensionLabel && (
        <div className="file-card__dimension-tag">
          {dimensionLabel}
        </div>
      )}

      {/* Compressing overlay */}
      {status === 'compressing' && (
        <div className="file-card__progress-overlay">
          <ProgressRing progress={progress} />
          <div style={{ fontSize: '9px', color: 'rgba(255,255,255,0.5)', fontWeight: 500 }}>
            Mengompresi…
          </div>
        </div>
      )}

      {/* Done / Error badge */}
      {status === 'done' && (
        <div className="file-card__status file-card__status--done"><CheckIcon /></div>
      )}
      {status === 'error' && (
        <div className="file-card__status file-card__status--error"><ErrorIcon /></div>
      )}

      {/* Savings badge */}
      {status === 'done' && savings > 0 && (
        <div className="savings-badge">-{savings}%</div>
      )}

      <button
        className={`file-card__selection${isSelected ? ' file-card__selection--active' : ''}`}
        onClick={handleSelect}
        type="button"
        title={isSelected ? 'Unselect file' : 'Select file'}
        aria-label={isSelected ? `Unselect ${name}` : `Select ${name}`}
      >
        {isSelected && <CheckIcon />}
      </button>

      {/* Action buttons (Reveal Folder + Open File) on hover */}
      {status === 'done' && (
        <div className="file-card__reveal-actions">
          <button className="file-card__reveal" onClick={handleReveal} type="button" title="Buka folder tujuan">
            <FolderIcon /> Folder
          </button>
          {outputPath && (
            <button className="file-card__reveal file-card__reveal--play" onClick={handleOpenFile} type="button" title="Buka file hasil kompresi">
              <PlayIcon /> Buka
            </button>
          )}
        </div>
      )}

      {/* Remove button */}
      {status !== 'compressing' && (
        <button
          className="file-card__remove"
          onClick={handleRemove}
          aria-label={`Remove ${name}`}
          title="Remove"
          type="button"
        >
          <XIcon />
        </button>
      )}

      {/* Footer: filename & size comparison */}
      <div className="file-card__footer">
        <div className="file-card__name" title={name}>{name}</div>
        {status === 'done' && compressedSize && (
          <div className="file-card__comparison">
            <span className="file-card__original-size">{formatBytes(size)}</span>
            <span className="file-card__arrow">→</span>
            <span className="file-card__compressed-size">{formatBytes(compressedSize)}</span>
          </div>
        )}
      </div>
    </div>
    {previewModal}
    </>
  );
};

export default FileCard;
