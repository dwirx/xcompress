// ═══════════════════════════════════════════════════════════════
// components/StatusBar/StatusBar.tsx
// Bottom info strip — saved, files processed, offline indicator
// ═══════════════════════════════════════════════════════════════
import React from 'react';
import { formatBytes } from '../../types';
import '../../styles/components/CompressButton.css';

const ShieldIcon = () => (
  <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"/>
  </svg>
);

interface StatusBarProps {
  totalSaved: number;    // bytes
  doneCount: number;
  isCompressing: boolean;
}

const StatusBar: React.FC<StatusBarProps> = ({ totalSaved, doneCount, isCompressing }) => (
  <div className="status-bar" role="status" aria-live="polite">
    <div className="status-bar__left">
      {/* Offline indicator */}
      <div className="status-bar__item">
        <div className="status-bar__dot" style={{ background: '#22c55e' }} />
        100% Offline
      </div>

      <div className="status-bar__divider" />

      {/* Shield */}
      <div className="status-bar__item">
        <ShieldIcon />
        Private
      </div>
    </div>

    {/* Right: savings */}
    <div className="status-bar__left">
      {isCompressing && (
        <>
          <div className="status-bar__item">
            <div className="status-bar__dot" style={{ background: '#6366f1', animation: 'pulse-ring 1s infinite' }} />
            Compressing…
          </div>
          <div className="status-bar__divider" />
        </>
      )}
      {doneCount > 0 && (
        <div className="status-bar__item status-bar__item--highlight">
          Saved {formatBytes(totalSaved)} · {doneCount} file{doneCount !== 1 ? 's' : ''}
        </div>
      )}
    </div>
  </div>
);

export default StatusBar;
