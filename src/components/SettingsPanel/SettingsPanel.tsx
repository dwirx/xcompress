import React from 'react';
import type { CompressionSettings, GpuInfo, FileType } from '../../types';
import '../../styles/components/SettingsPanel.css';

interface SettingsPanelProps {
  fileCount: number;
  settings: CompressionSettings;
  gpu: GpuInfo | null;
  onSettingsChange: <K extends keyof CompressionSettings>(key: K, value: CompressionSettings[K]) => void;
  onClearFiles: () => void;
  onChangeOutputFolder: () => void;
  fileTypesPresent?: FileType[]; // Added to detect which files are queued
}

const SettingsPanel: React.FC<SettingsPanelProps> = ({
  fileCount,
  settings,
  gpu,
  onSettingsChange,
  onClearFiles,
  onChangeOutputFolder,
  fileTypesPresent = ['video', 'image'], // default fallback for preview
}) => {
  return (
    <div className="settings-panel">
      {/* Queued Stats Section */}
      <div className="settings-section">
        <div className="settings-section__title">Antrean File</div>
        <div className="settings-row">
          <div className="file-count-badge">
            Total: <span>{fileCount}</span> file
          </div>
          {fileCount > 0 && (
            <button className="settings-btn" onClick={onClearFiles}>
              Kosongkan
            </button>
          )}
        </div>
        {fileCount > 0 && (
          <div className="filetype-summary">
            {fileTypesPresent.includes('video') && (
              <span className="filetype-chip filetype-chip--video">
                <span className="filetype-chip__dot" /> Video
              </span>
            )}
            {fileTypesPresent.includes('image') && (
              <span className="filetype-chip filetype-chip--image">
                <span className="filetype-chip__dot" /> Gambar
              </span>
            )}
            {fileTypesPresent.includes('gif') && (
              <span className="filetype-chip filetype-chip--gif">
                <span className="filetype-chip__dot" /> GIF
              </span>
            )}
            {fileTypesPresent.includes('pdf') && (
              <span className="filetype-chip filetype-chip--pdf">
                <span className="filetype-chip__dot" /> PDF
              </span>
            )}
          </div>
        )}
      </div>

      {/* GPU acceleration status */}
      <div className="settings-section">
        <div className="settings-section__title">Hardware Accelerator</div>
        <div className="settings-row">
          <span className="settings-label">Encoder Aktif</span>
          {gpu ? (
            <span className={`gpu-badge gpu-badge--${gpu.type}`}>
              <span className="gpu-dot" /> {gpu.label}
            </span>
          ) : (
            <span className="gpu-badge gpu-badge--cpu">
              <span className="gpu-dot" /> Mendeteksi...
            </span>
          )}
        </div>
      </div>

      {/* Video settings */}
      <div className="settings-section">
        <div className="settings-section__title">Pengaturan Video</div>
        
        <div className="settings-row" style={{ marginBottom: '8px' }}>
          <span className="settings-label">Format Target</span>
          <select
            className="settings-select"
            value={settings.videoFormat}
            onChange={(e) => onSettingsChange('videoFormat', e.target.value as any)}
          >
            <option value="MP4">MP4 (Sangat Kompatibel)</option>
            <option value="WebM">WebM (Optimal Web)</option>
            <option value="MKV">MKV</option>
            <option value="MOV">MOV (Original)</option>
          </select>
        </div>

        <div className="settings-row" style={{ marginBottom: '8px' }}>
          <span className="settings-label">Resolusi</span>
          <select
            className="settings-select"
            value={settings.videoResolution}
            onChange={(e) => onSettingsChange('videoResolution', e.target.value as any)}
          >
            <option value="Same as input">Asli / Sama</option>
            <option value="1080p">1080p (Full HD)</option>
            <option value="720p">720p (HD)</option>
            <option value="480p">480p</option>
          </select>
        </div>

        <div className="settings-row" style={{ marginBottom: '8px' }}>
          <span className="settings-label">Metode Kualitas</span>
          <select
            className="settings-select"
            value={settings.videoQuality}
            onChange={(e) => onSettingsChange('videoQuality', e.target.value as any)}
          >
            <option value="CRF">Preset Kualitas</option>
            <option value="File size">Target Ukuran File</option>
          </select>
        </div>

        {settings.videoQuality === 'CRF' ? (
          <div style={{ marginTop: '8px' }}>
            <span className="settings-label" style={{ display: 'block', marginBottom: '6px' }}>Tingkat Kompresi</span>
            <div className="quality-presets">
              {(['highest', 'high', 'balanced', 'small'] as const).map((preset) => {
                const active = settings.qualityPreset === preset;
                const labels = {
                  highest: { name: 'Super', sub: 'Min Loss' },
                  high: { name: 'Tinggi', sub: 'Bagus' },
                  balanced: { name: 'Medium', sub: 'Standard' },
                  small: { name: 'Kecil', sub: 'Hemat' }
                };
                return (
                  <button
                    key={preset}
                    className={`quality-preset-btn ${active ? 'quality-preset-btn--active' : ''}`}
                    onClick={() => onSettingsChange('qualityPreset', preset)}
                    type="button"
                  >
                    <span className="quality-preset-btn__label">{labels[preset].name}</span>
                    <span className="quality-preset-btn__sub">{labels[preset].sub}</span>
                  </button>
                );
              })}
            </div>
          </div>
        ) : (
          <div className="settings-row" style={{ marginTop: '8px' }}>
            <span className="settings-label">Target Maksimum</span>
            <div className="settings-input-group">
              <input
                type="number"
                className="settings-input"
                value={Math.round(settings.targetFileSizeKb / 1024)}
                onChange={(e) => onSettingsChange('targetFileSizeKb', Number(e.target.value) * 1024)}
                min={1}
              />
              <span className="settings-unit">MB</span>
            </div>
          </div>
        )}

        <div className="settings-row" style={{ marginTop: '10px' }}>
          <span className="settings-label">Hapus Audio</span>
          <label className="settings-toggle">
            <input
              type="checkbox"
              checked={settings.removeAudio}
              onChange={(e) => onSettingsChange('removeAudio', e.target.checked)}
            />
            <span className="settings-toggle__track" />
            <span className="settings-toggle__thumb" />
          </label>
        </div>
      </div>

      {/* Image / PDF settings */}
      <div className="settings-section">
        <div className="settings-section__title">Pengaturan Gambar & PDF</div>
        <div className="settings-row" style={{ marginBottom: '8px' }}>
          <span className="settings-label">Format Gambar</span>
          <select
            className="settings-select"
            value={settings.imageFormat}
            onChange={(e) => onSettingsChange('imageFormat', e.target.value as any)}
          >
            <option value="JPEG">JPEG</option>
            <option value="PNG">PNG</option>
            <option value="WebP">WebP</option>
          </select>
        </div>
        <div className="settings-row" style={{ marginBottom: '8px' }}>
          <span className="settings-label">Kualitas Gambar</span>
          <select
            className="settings-select"
            value={settings.imageQuality}
            onChange={(e) => onSettingsChange('imageQuality', e.target.value as any)}
          >
            <option value="Highest">Sangat Tinggi</option>
            <option value="Good">Bagus</option>
            <option value="Balanced">Medium</option>
            <option value="Small">Ukuran Terkecil</option>
          </select>
        </div>
        <div className="settings-row">
          <span className="settings-label">Kualitas PDF</span>
          <select
            className="settings-select"
            value={settings.pdfQuality}
            onChange={(e) => onSettingsChange('pdfQuality', e.target.value as any)}
          >
            <option value="Highest">Prepress (300dpi)</option>
            <option value="Good">Printer (150dpi)</option>
            <option value="Balanced">Ebook (150dpi)</option>
            <option value="Small">Screen (72dpi)</option>
          </select>
        </div>
      </div>

      {/* Output folder settings */}
      <div className="settings-section" style={{ borderBottom: 'none' }}>
        <div className="settings-section__title">Folder Output</div>
        <div className="settings-row" style={{ marginBottom: '4px' }}>
          <span className="settings-label">Penyimpanan</span>
          <select
            className="settings-select"
            value={settings.outputFolder}
            onChange={(e) => onSettingsChange('outputFolder', e.target.value as any)}
          >
            <option value="Same as input">Folder Asli</option>
            <option value="Custom">Folder Khusus</option>
          </select>
        </div>
        {settings.outputFolder === 'Custom' && (
          <div style={{ marginTop: '8px' }}>
            <button className="settings-btn" onClick={onChangeOutputFolder} style={{ width: '100%' }}>
              Pilih Folder...
            </button>
            <div className="settings-path" title={settings.outputFolderPath}>
              {settings.outputFolderPath || 'Belum dipilih'}
            </div>
          </div>
        )}
      </div>
    </div>
  );
};

export default SettingsPanel;
