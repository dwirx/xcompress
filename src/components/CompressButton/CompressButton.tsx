// ═══════════════════════════════════════════════════════════════
// components/CompressButton/CompressButton.tsx
// Primary CTA button + optional progress display
// ═══════════════════════════════════════════════════════════════
import React from 'react';
import '../../styles/components/CompressButton.css';

const BoltIcon = () => (
  <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor">
    <path d="M13 2L3 14h9l-1 8 10-12h-9l1-8z"/>
  </svg>
);

// ── Overall progress bar ──────────────────────────────────────
interface OverallProgressProps {
  progress: number;  // 0–100
  done: number;
  total: number;
}
const OverallProgress: React.FC<OverallProgressProps> = ({ progress, done, total }) => (
  <div className="overall-progress">
    <div className="overall-progress__header">
      <span className="overall-progress__label">
        Compressing {done} / {total} files…
      </span>
      <span className="overall-progress__pct">{Math.round(progress)}%</span>
    </div>
    <div className="overall-progress__track">
      <div
        className="overall-progress__fill"
        style={{ width: `${progress}%` }}
        role="progressbar"
        aria-valuenow={progress}
        aria-valuemin={0}
        aria-valuemax={100}
      />
    </div>
  </div>
);

// ── Props ─────────────────────────────────────────────────────
interface CompressButtonProps {
  fileCount: number;
  isCompressing: boolean;
  overallProgress: number;
  doneCount: number;
  onClick: () => void;
}

// ── Component ─────────────────────────────────────────────────
const CompressButton: React.FC<CompressButtonProps> = ({
  fileCount,
  isCompressing,
  overallProgress,
  doneCount,
  onClick,
}) => {
  const disabled = fileCount === 0 || isCompressing;

  return (
    <div className="compress-btn-wrap">
      {/* Progress bar shown while compressing */}
      {isCompressing && (
        <OverallProgress
          progress={overallProgress}
          done={doneCount}
          total={fileCount}
        />
      )}

      <button
        id="btn-compress"
        className={`compress-btn${isCompressing ? ' compress-btn--processing' : ''}`}
        onClick={onClick}
        disabled={disabled}
        aria-label={isCompressing ? `Compressing, ${Math.round(overallProgress)}% complete` : `Compress ${fileCount} file${fileCount !== 1 ? 's' : ''}`}
        type="button"
      >
        {isCompressing ? (
          <>
            <div className="compress-btn__spinner" />
            Compressing…
          </>
        ) : (
          <>
            <BoltIcon />
            {fileCount > 0 ? `Compress ${fileCount} File${fileCount !== 1 ? 's' : ''}` : 'Compress'}
          </>
        )}
      </button>
    </div>
  );
};

export default CompressButton;
