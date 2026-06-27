import React from 'react';
import { useWindowControls } from '../../hooks/useTauri';
import '../../styles/components/TitleBar.css';

// System close, minimize, maximize icon path data (like real Windows controls)
const MinimizeIcon = () => (
  <svg width="10" height="1" viewBox="0 0 10 1" fill="currentColor">
    <rect width="10" height="1" />
  </svg>
);

const MaximizeIcon = () => (
  <svg width="10" height="10" viewBox="0 0 10 10" fill="none" stroke="currentColor" strokeWidth="1">
    <rect x="0.5" y="0.5" width="9" height="9" />
  </svg>
);

const CloseIcon = () => (
  <svg width="10" height="10" viewBox="0 0 10 10" fill="none" stroke="currentColor" strokeWidth="1">
    <path d="M1 1L9 9M9 1L1 9" />
  </svg>
);

const IconHistory = () => (
  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <circle cx="12" cy="12" r="10" />
    <polyline points="12 6 12 12 16 14" />
  </svg>
);

const IconSettings = () => (
  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <circle cx="12" cy="12" r="3" />
    <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83-2.83l.06-.06A1.65 1.65 0 0 0 4.68 15a1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 2.83-2.83l.06.06A1.65 1.65 0 0 0 9 4.68a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 2.83l-.06.06A1.65 1.65 0 0 0 19.4 9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z" />
  </svg>
);

const IconImport = () => (
  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
    <polyline points="17 8 12 3 7 8" />
    <line x1="12" y1="3" x2="12" y2="15" />
  </svg>
);

interface TitleBarProps {
  onOpenHistory?: () => void;
  onOpenSettings?: () => void;
  onImport?: () => void;
}

const TitleBar: React.FC<TitleBarProps> = ({ onOpenHistory, onOpenSettings, onImport }) => {
  const { close, minimize, toggleMaximize, startDragging } = useWindowControls();

  return (
    <div
      className="titlebar"
      role="banner"
      onMouseDown={(e) => {
        if ((e.target as HTMLElement).closest('.titlebar__actions, .titlebar__win-controls')) return;
        startDragging();
      }}
    >
      <div className="titlebar__brand">
        <div className="titlebar__app-icon">
          <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round">
            <polyline points="4 17 10 11 4 5" />
            <line x1="12" y1="19" x2="20" y2="19" />
          </svg>
        </div>
        <span className="titlebar__title">xCompress</span>
      </div>

      <div className="titlebar__actions">
        <button id="btn-import" className="titlebar__icon-btn" onClick={onImport} title="Import files" aria-label="Import"><IconImport /></button>
        <button id="btn-history" className="titlebar__icon-btn" onClick={onOpenHistory} title="History" aria-label="History"><IconHistory /></button>
        <button id="btn-settings" className="titlebar__icon-btn" onClick={onOpenSettings} title="Settings" aria-label="Settings"><IconSettings /></button>
      </div>

      <div className="titlebar__win-controls">
        <button className="win-btn win-btn--minimize" onClick={minimize} title="Minimize" aria-label="Minimize">
          <MinimizeIcon />
        </button>
        <button className="win-btn win-btn--maximize" onClick={toggleMaximize} title="Maximize" aria-label="Maximize">
          <MaximizeIcon />
        </button>
        <button className="win-btn win-btn--close" onClick={close} title="Close" aria-label="Close">
          <CloseIcon />
        </button>
      </div>
    </div>
  );
};

export default TitleBar;
