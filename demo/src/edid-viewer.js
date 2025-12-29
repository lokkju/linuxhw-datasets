import { LitElement, html, css } from 'lit';
import { decodeEdid } from './edid-decoder.js';

/**
 * Standalone EDID viewer component.
 * Takes raw EDID bytes and displays comprehensive decoded information.
 *
 * @element edid-viewer
 * @prop {Uint8Array} edidData - Raw EDID bytes to decode and display
 * @prop {string} hash - Optional hash/ID to display in header
 * @prop {string} githubUrl - Optional GitHub URL for the EDID source file
 * @fires back - Dispatched when back button is clicked (for mobile view)
 */
export class EdidViewer extends LitElement {
  static properties = {
    edidData: { type: Object, attribute: false },
    hash: { type: String },
    githubUrl: { type: String, attribute: 'github-url' },
    showBack: { type: Boolean, attribute: 'show-back' },
    _decoded: { type: Object, state: true },
    _expandedSections: { type: Object, state: true },
    _activeTab: { type: String, state: true },
    _copied: { type: Boolean, state: true },
  };

  static styles = css`
    :host {
      display: flex;
      flex-direction: column;
      height: 100%;
      background: var(--edid-viewer-bg, var(--color-surface, #16213e));
      color: var(--edid-viewer-text, var(--color-text, #eee));
      font-family: var(--edid-viewer-font, system-ui, sans-serif);
    }

    .header {
      padding: 0.75rem 1rem;
      border-bottom: 1px solid var(--color-border, #2a2a4e);
      display: flex;
      align-items: center;
      gap: 0.75rem;
      flex-shrink: 0;
    }

    .back-btn {
      display: none;
      padding: 0.375rem 0.5rem;
      border: none;
      background: transparent;
      color: var(--color-text, #eee);
      cursor: pointer;
      font-size: 1rem;
    }

    :host([show-back]) .back-btn {
      display: block;
    }

    .header-title {
      font-size: 0.875rem;
      font-family: ui-monospace, monospace;
      color: var(--color-text, #eee);
    }

    .header-spacer {
      flex: 1;
    }

    .github-link {
      display: flex;
      align-items: center;
      gap: 0.375rem;
      padding: 0.25rem 0.5rem;
      color: var(--color-text-muted, #888);
      text-decoration: none;
      font-size: 0.75rem;
      border: 1px solid var(--color-border, #2a2a4e);
      border-radius: var(--radius, 4px);
      transition: all 0.15s;
    }

    .github-link:hover {
      color: var(--color-text, #eee);
      border-color: var(--color-text-muted, #888);
    }

    .github-icon {
      width: 14px;
      height: 14px;
    }

    .tabs {
      display: flex;
      border-bottom: 1px solid var(--color-border, #2a2a4e);
      flex-shrink: 0;
    }

    .tab {
      padding: 0.5rem 1rem;
      border: none;
      background: transparent;
      color: var(--color-text-muted, #888);
      font-size: 0.8125rem;
      cursor: pointer;
      position: relative;
    }

    .tab:hover {
      color: var(--color-text, #eee);
    }

    .tab[data-active="true"] {
      color: var(--color-text, #eee);
    }

    .tab[data-active="true"]::after {
      content: '';
      position: absolute;
      bottom: -1px;
      left: 0;
      right: 0;
      height: 2px;
      background: var(--color-accent, #e94560);
    }

    .content {
      flex: 1;
      overflow-y: auto;
      padding: 1rem;
      min-height: 0;
    }

    .empty {
      display: flex;
      align-items: center;
      justify-content: center;
      height: 100%;
      color: var(--color-text-muted, #888);
      font-size: 0.875rem;
    }

    .warning {
      margin-bottom: 1rem;
      padding: 0.75rem;
      background: rgba(251, 191, 36, 0.1);
      border: 1px solid #fbbf24;
      border-radius: var(--radius, 4px);
      color: #fbbf24;
      font-size: 0.8125rem;
    }

    .warning strong {
      display: block;
      margin-bottom: 0.375rem;
    }

    .warning ul {
      margin: 0;
      padding-left: 1.25rem;
    }

    .warning li {
      margin-bottom: 0.125rem;
    }

    .section {
      margin-bottom: 1.25rem;
    }

    .section-title {
      font-size: 0.6875rem;
      color: var(--color-text-muted, #888);
      text-transform: uppercase;
      letter-spacing: 0.1em;
      margin-bottom: 0.5rem;
      padding-bottom: 0.25rem;
      border-bottom: 1px solid var(--color-border, #2a2a4e);
      display: flex;
      align-items: center;
      gap: 0.5rem;
      cursor: pointer;
    }

    .section-title:hover {
      color: var(--color-text, #eee);
    }

    .section-toggle {
      font-size: 0.75rem;
      transition: transform 0.2s;
    }

    .section-toggle.collapsed {
      transform: rotate(-90deg);
    }

    .section-content {
      overflow: hidden;
    }

    .section-content.collapsed {
      display: none;
    }

    .grid {
      display: grid;
      grid-template-columns: 120px 1fr;
      gap: 0.375rem 1rem;
      font-size: 0.8125rem;
    }

    .grid.wide {
      grid-template-columns: 160px 1fr;
    }

    .label {
      color: var(--color-text-muted, #888);
      text-align: right;
    }

    .value {
      color: var(--color-text, #eee);
      font-family: ui-monospace, monospace;
    }

    .value.highlight {
      color: var(--color-accent, #e94560);
    }

    .value.success {
      color: #4ade80;
    }

    .value.warning {
      color: #fbbf24;
    }

    .list {
      list-style: none;
      margin: 0;
      padding: 0;
      font-size: 0.8125rem;
    }

    .list li {
      padding: 0.25rem 0;
      border-bottom: 1px solid var(--color-border, #2a2a4e);
    }

    .list li:last-child {
      border-bottom: none;
    }

    .badge {
      display: inline-block;
      padding: 0.125rem 0.375rem;
      background: var(--color-accent, #e94560);
      color: white;
      font-size: 0.625rem;
      border-radius: 2px;
      margin-left: 0.5rem;
      text-transform: uppercase;
    }

    .timing-card {
      background: var(--color-bg, #1a1a2e);
      border: 1px solid var(--color-border, #2a2a4e);
      border-radius: var(--radius, 4px);
      padding: 0.75rem;
      margin-bottom: 0.5rem;
      font-size: 0.75rem;
    }

    .timing-card .timing-main {
      font-size: 0.875rem;
      font-weight: 500;
      margin-bottom: 0.375rem;
    }

    .timing-card .timing-detail {
      color: var(--color-text-muted, #888);
    }

    .audio-format, .video-mode {
      display: flex;
      justify-content: space-between;
      align-items: center;
      padding: 0.375rem 0;
      border-bottom: 1px solid var(--color-border, #2a2a4e);
      font-size: 0.8125rem;
    }

    .audio-format:last-child, .video-mode:last-child {
      border-bottom: none;
    }

    .audio-format .format-name, .video-mode .mode-name {
      font-weight: 500;
    }

    .audio-format .format-details, .video-mode .mode-details {
      color: var(--color-text-muted, #888);
      font-size: 0.75rem;
    }

    /* Hex view styles */
    .hex-container {
      display: flex;
      flex-direction: column;
      height: 100%;
      gap: 0.5rem;
    }

    .hex-header {
      display: flex;
      justify-content: space-between;
      align-items: center;
    }

    .hex-label {
      font-size: 0.75rem;
      color: var(--color-text-muted, #888);
      text-transform: uppercase;
      letter-spacing: 0.05em;
    }

    .copy-btn {
      display: flex;
      align-items: center;
      gap: 0.375rem;
      padding: 0.375rem 0.625rem;
      border: 1px solid var(--color-border, #2a2a4e);
      background: transparent;
      color: var(--color-text-muted, #888);
      font-size: 0.75rem;
      border-radius: var(--radius, 4px);
      cursor: pointer;
      transition: all 0.15s;
    }

    .copy-btn:hover {
      color: var(--color-text, #eee);
      border-color: var(--color-text-muted, #888);
    }

    .copy-btn[data-copied] {
      color: #4ade80;
      border-color: #4ade80;
    }

    .copy-icon {
      width: 14px;
      height: 14px;
    }

    .hex-textarea {
      flex: 1;
      width: 100%;
      min-height: 200px;
      padding: 0.75rem;
      border: 1px solid var(--color-border, #2a2a4e);
      background: var(--color-bg, #1a1a2e);
      color: var(--color-text, #eee);
      font-family: ui-monospace, monospace;
      font-size: 0.75rem;
      line-height: 1.5;
      resize: none;
      border-radius: var(--radius, 4px);
      box-sizing: border-box;
    }

    .hex-textarea:focus {
      outline: none;
      border-color: var(--color-accent, #e94560);
    }
  `;

  constructor() {
    super();
    this.edidData = null;
    this.hash = '';
    this.githubUrl = '';
    this.showBack = false;
    this._decoded = null;
    this._expandedSections = {
      identification: true,
      display: true,
      manufacture: true,
      edidInfo: true,
      timings: false,
      audio: false,
      video: false,
      hdmi: false,
      hdr: false,
      colorimetry: false,
    };
    this._activeTab = 'decoded';
    this._copied = false;
  }

  willUpdate(changedProps) {
    if (changedProps.has('edidData')) {
      this._decoded = this.edidData ? decodeEdid(this.edidData) : null;
    }
  }

  _toggleSection(section) {
    this._expandedSections = {
      ...this._expandedSections,
      [section]: !this._expandedSections[section],
    };
  }

  _onBack() {
    this.dispatchEvent(new CustomEvent('back', { bubbles: true, composed: true }));
  }

  render() {
    if (!this.edidData) {
      return html`<div class="empty">No EDID data to display</div>`;
    }

    return html`
      <div class="header">
        <button class="back-btn" @click=${this._onBack}>&#9664; Back</button>
        <span class="header-title">${this.hash || 'EDID Data'}</span>
        <span class="header-spacer"></span>
        ${this.githubUrl ? html`
          <a class="github-link" href=${this.githubUrl} target="_blank" rel="noopener">
            <svg class="github-icon" viewBox="0 0 24 24" fill="currentColor">
              <path d="M12 0C5.37 0 0 5.37 0 12c0 5.31 3.435 9.795 8.205 11.385.6.105.825-.255.825-.57 0-.285-.015-1.23-.015-2.235-3.015.555-3.795-.735-4.035-1.41-.135-.345-.72-1.41-1.23-1.695-.42-.225-1.02-.78-.015-.795.945-.015 1.62.87 1.845 1.23 1.08 1.815 2.805 1.305 3.495.99.105-.78.42-1.305.765-1.605-2.67-.3-5.46-1.335-5.46-5.925 0-1.305.465-2.385 1.23-3.225-.12-.3-.54-1.53.12-3.18 0 0 1.005-.315 3.3 1.23.96-.27 1.98-.405 3-.405s2.04.135 3 .405c2.295-1.56 3.3-1.23 3.3-1.23.66 1.65.24 2.88.12 3.18.765.84 1.23 1.905 1.23 3.225 0 4.605-2.805 5.625-5.475 5.925.435.375.81 1.095.81 2.22 0 1.605-.015 2.895-.015 3.3 0 .315.225.69.825.57A12.02 12.02 0 0024 12c0-6.63-5.37-12-12-12z"/>
            </svg>
            Source
          </a>
        ` : ''}
      </div>
      <div class="tabs">
        <button
          class="tab"
          data-active=${this._activeTab === 'decoded'}
          @click=${() => this._activeTab = 'decoded'}
        >Decoded</button>
        <button
          class="tab"
          data-active=${this._activeTab === 'hex'}
          @click=${() => this._activeTab = 'hex'}
        >EDID Hex</button>
        <button
          class="tab"
          data-active=${this._activeTab === 'hex-spaced'}
          @click=${() => this._activeTab = 'hex-spaced'}
        >edid-decode Hex</button>
      </div>
      <div class="content">
        ${this._activeTab === 'decoded' ? this._renderDecoded() : this._renderHex(this._activeTab === 'hex-spaced')}
      </div>
    `;
  }

  _renderDecoded() {
    const d = this._decoded;
    if (!d) return html`<div class="empty">Failed to decode EDID</div>`;
    if (d.error) return html`<div class="warning"><strong>Decode Error:</strong> ${d.error}</div>`;

    const issues = this._getDecodingIssues();

    return html`
      ${issues.length > 0 ? html`
        <div class="warning">
          <strong>Decoding Issues:</strong>
          <ul>${issues.map(issue => html`<li>${issue}</li>`)}</ul>
        </div>
      ` : ''}

      ${this._renderSection('identification', 'Identification', this._renderIdentification())}
      ${this._renderSection('display', 'Display', this._renderDisplay())}
      ${this._renderSection('manufacture', 'Manufacture', this._renderManufacture())}
      ${this._renderSection('edidInfo', 'EDID Data', this._renderEdidInfo())}
      ${d.detailedTimings?.length > 0 || d.standardTimings?.length > 0
        ? this._renderSection('timings', 'Timings', this._renderTimings())
        : ''}
      ${d.audioFormats?.length > 0
        ? this._renderSection('audio', `Audio Formats (${d.audioFormats.length})`, this._renderAudioFormats())
        : ''}
      ${d.videoModes?.length > 0
        ? this._renderSection('video', `Video Modes (${d.videoModes.length})`, this._renderVideoModes())
        : ''}
      ${d.hdmiInfo
        ? this._renderSection('hdmi', 'HDMI', this._renderHdmi())
        : ''}
      ${d.hdrInfo
        ? this._renderSection('hdr', 'HDR', this._renderHdr())
        : ''}
      ${d.colorimetry
        ? this._renderSection('colorimetry', 'Colorimetry', this._renderColorimetry())
        : ''}
    `;
  }

  _renderSection(key, title, content) {
    const expanded = this._expandedSections[key];
    return html`
      <div class="section">
        <div class="section-title" @click=${() => this._toggleSection(key)}>
          <span class="section-toggle ${expanded ? '' : 'collapsed'}">&#9660;</span>
          ${title}
        </div>
        <div class="section-content ${expanded ? '' : 'collapsed'}">
          ${content}
        </div>
      </div>
    `;
  }

  _renderIdentification() {
    const d = this._decoded;
    return html`
      <div class="grid">
        ${this.hash ? html`
          <span class="label">MD5 Hash</span>
          <span class="value">${this.hash}</span>
        ` : ''}
        <span class="label">Manufacturer</span>
        <span class="value">${d.manufacturerId || '?'}</span>
        <span class="label">Product Code</span>
        <span class="value">${d.productCodeHex || '?'}</span>
        ${d.monitorName ? html`
          <span class="label">Monitor Name</span>
          <span class="value highlight">${d.monitorName}</span>
        ` : ''}
        ${d.serialString ? html`
          <span class="label">Serial String</span>
          <span class="value">${d.serialString}</span>
        ` : ''}
        ${d.serialNumber ? html`
          <span class="label">Serial Number</span>
          <span class="value">${d.serialNumberHex}</span>
        ` : ''}
      </div>
    `;
  }

  _renderDisplay() {
    const d = this._decoded;
    const diag = this._calcDiagonal();

    return html`
      <div class="grid">
        <span class="label">Resolution</span>
        <span class="value highlight">
          ${d.preferredResolution
            ? `${d.preferredResolution.width} x ${d.preferredResolution.height}${d.preferredResolution.interlaced ? 'i' : 'p'}`
            : '?'}
        </span>
        <span class="label">Physical Size</span>
        <span class="value">
          ${d.screenSizeCm
            ? `${d.screenSizeCm.widthCm * 10} x ${d.screenSizeCm.heightCm * 10} mm`
            : '?'}
        </span>
        <span class="label">Diagonal</span>
        <span class="value">${diag}</span>
        <span class="label">Type</span>
        <span class="value">${d.videoInput?.digital ? 'Digital' : (d.videoInput?.digital === false ? 'Analog' : '?')}</span>
        ${d.videoInput?.interface && d.videoInput.interface !== 'analog' && d.videoInput.interface !== 'digital' ? html`
          <span class="label">Interface</span>
          <span class="value">${d.videoInput.interface}</span>
        ` : ''}
        ${d.videoInput?.bitDepth ? html`
          <span class="label">Bit Depth</span>
          <span class="value">${d.videoInput.bitDepth}-bit</span>
        ` : ''}
        ${d.gamma ? html`
          <span class="label">Gamma</span>
          <span class="value">${d.gamma.toFixed(2)}</span>
        ` : ''}
        ${d.displayParams?.displayType ? html`
          <span class="label">Color Space</span>
          <span class="value">${d.displayParams.displayType}</span>
        ` : ''}
        ${d.displayParams?.sRGB ? html`
          <span class="label">sRGB</span>
          <span class="value success">Yes</span>
        ` : ''}
      </div>
    `;
  }

  _renderManufacture() {
    const d = this._decoded;
    return html`
      <div class="grid">
        <span class="label">Year</span>
        <span class="value">${d.year || '?'}</span>
        ${d.week && d.week !== 0 ? html`
          <span class="label">Week</span>
          <span class="value">${d.week}</span>
        ` : ''}
      </div>
    `;
  }

  _renderEdidInfo() {
    const d = this._decoded;
    return html`
      <div class="grid">
        <span class="label">Version</span>
        <span class="value">${d.edidVersion || '?'}</span>
        <span class="label">Size</span>
        <span class="value">${this.edidData?.length || '?'} bytes</span>
        <span class="label">Extensions</span>
        <span class="value">${d.extensionCount ?? '?'}</span>
        <span class="label">Header Valid</span>
        <span class="value ${d.headerValid ? 'success' : 'warning'}">${d.headerValid ? 'Yes' : 'No'}</span>
        <span class="label">Checksum Valid</span>
        <span class="value ${d.checksumValid ? 'success' : 'warning'}">${d.checksumValid ? 'Yes' : 'No'}</span>
        ${d.rangeLimits ? html`
          <span class="label">V-Rate Range</span>
          <span class="value">${d.rangeLimits.minVRate}-${d.rangeLimits.maxVRate} Hz</span>
          <span class="label">H-Rate Range</span>
          <span class="value">${d.rangeLimits.minHRate}-${d.rangeLimits.maxHRate} kHz</span>
          <span class="label">Max Pixel Clk</span>
          <span class="value">${d.rangeLimits.maxPixelClock} MHz</span>
        ` : ''}
      </div>
    `;
  }

  _renderTimings() {
    const d = this._decoded;
    return html`
      ${d.detailedTimings?.length > 0 ? html`
        <div style="margin-bottom: 1rem;">
          <div style="font-size: 0.75rem; color: var(--color-text-muted); margin-bottom: 0.5rem;">
            Detailed Timings
          </div>
          ${d.detailedTimings.map((t, i) => html`
            <div class="timing-card">
              <div class="timing-main">
                ${t.hActive} x ${t.vActive}${t.interlaced ? 'i' : 'p'}
                ${i === 0 ? html`<span class="badge">Preferred</span>` : ''}
              </div>
              <div class="timing-detail">
                ${t.pixelClockMHz.toFixed(2)} MHz |
                ${t.hSizeMm} x ${t.vSizeMm} mm |
                ${(t.pixelClockKHz * 1000 / (t.hTotal * t.vTotal)).toFixed(2)} Hz
              </div>
            </div>
          `)}
        </div>
      ` : ''}

      ${d.standardTimings?.length > 0 ? html`
        <div style="margin-bottom: 1rem;">
          <div style="font-size: 0.75rem; color: var(--color-text-muted); margin-bottom: 0.5rem;">
            Standard Timings
          </div>
          <ul class="list">
            ${d.standardTimings.map(t => html`
              <li>${t.xResolution} x ? (${t.aspectRatio}) @ ${t.refreshRate} Hz</li>
            `)}
          </ul>
        </div>
      ` : ''}

      ${d.establishedTimings?.length > 0 ? html`
        <div>
          <div style="font-size: 0.75rem; color: var(--color-text-muted); margin-bottom: 0.5rem;">
            Established Timings
          </div>
          <ul class="list">
            ${d.establishedTimings.map(t => html`<li>${t}</li>`)}
          </ul>
        </div>
      ` : ''}
    `;
  }

  _renderAudioFormats() {
    const d = this._decoded;
    return html`
      ${d.audioFormats.map(af => html`
        <div class="audio-format">
          <div>
            <div class="format-name">${af.format}</div>
            <div class="format-details">${af.channels} ch</div>
          </div>
          <div style="text-align: right;">
            <div class="format-details">${af.sampleRates?.join(', ')}</div>
            ${af.bitDepths ? html`
              <div class="format-details">${af.bitDepths.join(', ')}</div>
            ` : ''}
            ${af.maxBitrate ? html`
              <div class="format-details">${af.maxBitrate} kbps max</div>
            ` : ''}
          </div>
        </div>
      `)}
    `;
  }

  _renderVideoModes() {
    const d = this._decoded;
    return html`
      ${d.videoModes.map(vm => html`
        <div class="video-mode">
          <div>
            <div class="mode-name">
              ${vm.format}
              ${vm.native ? html`<span class="badge">Native</span>` : ''}
            </div>
            <div class="mode-details">VIC ${vm.vic}</div>
          </div>
          <div style="text-align: right;">
            <div class="mode-details">${vm.rate || ''}</div>
            <div class="mode-details">${vm.aspect || ''}</div>
          </div>
        </div>
      `)}
    `;
  }

  _renderHdmi() {
    const d = this._decoded;
    const h = d.hdmiInfo;
    if (!h) return '';

    return html`
      <div class="grid wide">
        <span class="label">Version</span>
        <span class="value">${h.vendor || 'HDMI'}</span>
        ${h.physicalAddress ? html`
          <span class="label">Physical Address</span>
          <span class="value">${h.physicalAddress}</span>
        ` : ''}
        ${h.maxTmdsClockMHz ? html`
          <span class="label">Max TMDS Clock</span>
          <span class="value">${h.maxTmdsClockMHz} MHz</span>
        ` : ''}
        ${h.maxTmdsCharacterRate ? html`
          <span class="label">Max Char Rate</span>
          <span class="value">${h.maxTmdsCharacterRate} MHz</span>
        ` : ''}
        ${h.dc30bit ? html`
          <span class="label">Deep Color 30-bit</span>
          <span class="value success">Yes</span>
        ` : ''}
        ${h.dc36bit ? html`
          <span class="label">Deep Color 36-bit</span>
          <span class="value success">Yes</span>
        ` : ''}
        ${h.dc48bit ? html`
          <span class="label">Deep Color 48-bit</span>
          <span class="value success">Yes</span>
        ` : ''}
        ${h.dcY444 ? html`
          <span class="label">DC YCbCr 4:4:4</span>
          <span class="value success">Yes</span>
        ` : ''}
        ${h.scdc ? html`
          <span class="label">SCDC</span>
          <span class="value success">Yes</span>
        ` : ''}
        ${h.rrCapable ? html`
          <span class="label">Read Request</span>
          <span class="value success">Yes</span>
        ` : ''}
      </div>
    `;
  }

  _renderHdr() {
    const d = this._decoded;
    const h = d.hdrInfo;
    if (!h) return '';

    return html`
      <div class="grid wide">
        ${h.eotfs?.length > 0 ? html`
          <span class="label">EOTFs</span>
          <span class="value">${h.eotfs.join(', ')}</span>
        ` : ''}
        ${h.staticMetadataTypes?.length > 0 ? html`
          <span class="label">Metadata Types</span>
          <span class="value">${h.staticMetadataTypes.join(', ')}</span>
        ` : ''}
        ${h.maxLuminance !== undefined ? html`
          <span class="label">Max Luminance</span>
          <span class="value">${h.maxLuminance}</span>
        ` : ''}
        ${h.maxFrameAvgLuminance !== undefined ? html`
          <span class="label">Max Frame Avg</span>
          <span class="value">${h.maxFrameAvgLuminance}</span>
        ` : ''}
        ${h.minLuminance !== undefined ? html`
          <span class="label">Min Luminance</span>
          <span class="value">${h.minLuminance}</span>
        ` : ''}
      </div>
    `;
  }

  _renderColorimetry() {
    const d = this._decoded;
    const c = d.colorimetry;
    if (!c) return '';

    const supported = [];
    if (c.bt2020Rgb) supported.push('BT.2020 RGB');
    if (c.bt2020Ycc) supported.push('BT.2020 YCC');
    if (c.bt2020cYcc) supported.push('BT.2020 cYCC');
    if (c.dcip3) supported.push('DCI-P3');
    if (c.xvYcc601) supported.push('xvYCC601');
    if (c.xvYcc709) supported.push('xvYCC709');
    if (c.sYcc601) supported.push('sYCC601');
    if (c.opYcc601) supported.push('opYCC601');
    if (c.opRgb) supported.push('opRGB');

    return html`
      <ul class="list">
        ${supported.map(s => html`<li>${s}</li>`)}
      </ul>
    `;
  }

  _calcDiagonal() {
    const d = this._decoded;
    if (!d?.screenSizeCm?.widthCm || !d?.screenSizeCm?.heightCm) return '?';
    const inches = Math.sqrt(d.screenSizeCm.widthCm ** 2 + d.screenSizeCm.heightCm ** 2) / 2.54;
    return `${inches.toFixed(1)}"`;
  }

  _getDecodingIssues() {
    const issues = [];
    const d = this._decoded;

    if (!this.edidData || this.edidData.length === 0) {
      issues.push('No raw EDID data available');
      return issues;
    }

    if (d?.error) {
      issues.push(d.error);
      return issues;
    }

    if (d?.headerValid === false) {
      issues.push('Invalid EDID header (expected 00 FF FF FF FF FF FF 00)');
    }

    if (d?.checksumValid === false) {
      issues.push('Invalid checksum - EDID data may be corrupted');
    }

    if (!d?.manufacturerId) {
      issues.push('Could not decode manufacturer ID');
    }

    if (!d?.preferredResolution) {
      issues.push('No preferred resolution found in timing descriptors');
    }

    if (d?.screenSizeCm?.widthCm === 0 && d?.screenSizeCm?.heightCm === 0) {
      issues.push('Screen size not specified (0x0 cm)');
    }

    return issues;
  }

  _getHexString(spaced = false) {
    if (!this.edidData) return '';
    const bytes = this.edidData;
    const lines = [];

    for (let i = 0; i < bytes.length; i += 16) {
      const chunk = Array.from(bytes.slice(i, i + 16));
      const line = chunk
        .map(b => b.toString(16).padStart(2, '0'))
        .join(spaced ? ' ' : '');
      lines.push(line);
    }

    return lines.join('\n');
  }

  async _copyHex(spaced) {
    const hexString = this._getHexString(spaced);
    try {
      await navigator.clipboard.writeText(hexString);
      this._copied = true;
      setTimeout(() => { this._copied = false; }, 2000);
    } catch (err) {
      console.error('Failed to copy:', err);
    }
  }

  _renderHex(spaced = false) {
    if (!this.edidData) {
      return html`<div class="empty">No raw EDID data available</div>`;
    }

    const hexString = this._getHexString(spaced);

    return html`
      <div class="hex-container">
        <div class="hex-header">
          <span class="hex-label">${this.edidData.length} bytes, 16 bytes/line</span>
          <button class="copy-btn" @click=${() => this._copyHex(spaced)} ?data-copied=${this._copied}>
            <svg class="copy-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
              ${this._copied
                ? html`<polyline points="20 6 9 17 4 12"></polyline>`
                : html`<rect x="9" y="9" width="13" height="13" rx="2" ry="2"></rect>
                       <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"></path>`
              }
            </svg>
            ${this._copied ? 'Copied!' : 'Copy'}
          </button>
        </div>
        <textarea class="hex-textarea" readonly .value=${hexString}></textarea>
      </div>
    `;
  }
}

customElements.define('edid-viewer', EdidViewer);
