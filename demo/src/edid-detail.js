import { LitElement, html, css } from 'lit';

/**
 * EDID detail panel showing raw hex and decoded data.
 */
export class EdidDetail extends LitElement {
  static properties = {
    edid: { type: Object },
    mobile: { type: Boolean, reflect: true },
    _activeTab: { type: String, state: true },
    _copied: { type: Boolean, state: true },
  };

  static styles = css`
    :host {
      display: flex;
      flex-direction: column;
      height: 100%;
      background: var(--color-surface, #16213e);
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

    :host([mobile]) .back-btn {
      display: block;
    }

    .header-title {
      font-size: 0.875rem;
      font-family: ui-monospace, monospace;
      color: var(--color-text, #eee);
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

    .decoded-section {
      margin-bottom: 1.25rem;
    }

    .decoded-title {
      font-size: 0.6875rem;
      color: var(--color-text-muted, #888);
      text-transform: uppercase;
      letter-spacing: 0.1em;
      margin-bottom: 0.5rem;
      padding-bottom: 0.25rem;
      border-bottom: 1px solid var(--color-border, #2a2a4e);
    }

    .decoded-grid {
      display: grid;
      grid-template-columns: 100px 1fr;
      gap: 0.375rem 1rem;
      font-size: 0.8125rem;
    }

    .decoded-label {
      color: var(--color-text-muted, #888);
      text-align: right;
    }

    .decoded-value {
      color: var(--color-text, #eee);
      font-family: ui-monospace, monospace;
    }
  `;

  constructor() {
    super();
    this.edid = null;
    this.mobile = false;
    this._activeTab = 'decoded';
    this._copied = false;
  }

  _onBack() {
    this.dispatchEvent(new CustomEvent('back', { bubbles: true, composed: true }));
  }

  render() {
    if (!this.edid) {
      return html`<div class="empty">Select an EDID to view details</div>`;
    }

    return html`
      <div class="header">
        <button class="back-btn" @click=${this._onBack}>&#9664; Back</button>
        <span class="header-title">${this.edid.md5Hex}</span>
      </div>
      <div class="tabs">
        <button
          class="tab"
          data-active=${this._activeTab === 'decoded'}
          @click=${() => this._activeTab = 'decoded'}
        >Decoded</button>
        <button
          class="tab"
          data-active=${this._activeTab === 'raw'}
          @click=${() => this._activeTab = 'raw'}
        >Raw Hex</button>
      </div>
      <div class="content">
        ${this._activeTab === 'decoded' ? this._renderDecoded() : this._renderRaw()}
      </div>
    `;
  }

  _renderDecoded() {
    const e = this.edid;

    return html`
      <div class="decoded-section">
        <div class="decoded-title">Identification</div>
        <div class="decoded-grid">
          <span class="decoded-label">MD5 Hash</span>
          <span class="decoded-value">${e.md5Hex}</span>
          <span class="decoded-label">Vendor ID</span>
          <span class="decoded-value">${e.vendorId || '?'}</span>
          <span class="decoded-label">Model ID</span>
          <span class="decoded-value">${e.modelId || '?'}</span>
        </div>
      </div>

      <div class="decoded-section">
        <div class="decoded-title">Display</div>
        <div class="decoded-grid">
          <span class="decoded-label">Resolution</span>
          <span class="decoded-value">${e.widthPx || '?'} x ${e.heightPx || '?'}</span>
          <span class="decoded-label">Physical Size</span>
          <span class="decoded-value">${e.widthMm || '?'} x ${e.heightMm || '?'} mm</span>
          <span class="decoded-label">Diagonal</span>
          <span class="decoded-value">${this._calcDiagonal(e)}</span>
          <span class="decoded-label">Type</span>
          <span class="decoded-value">${e.displayType || '?'}</span>
        </div>
      </div>

      <div class="decoded-section">
        <div class="decoded-title">Manufacture</div>
        <div class="decoded-grid">
          <span class="decoded-label">Year</span>
          <span class="decoded-value">${e.year || '?'}</span>
        </div>
      </div>

      <div class="decoded-section">
        <div class="decoded-title">Data</div>
        <div class="decoded-grid">
          <span class="decoded-label">EDID Size</span>
          <span class="decoded-value">${e.rawEdid?.length || '?'} bytes</span>
          <span class="decoded-label">Global Index</span>
          <span class="decoded-value">${e._globalIndex ?? '?'}</span>
        </div>
      </div>
    `;
  }

  _calcDiagonal(e) {
    if (!e.widthMm || !e.heightMm) return '?';
    const inches = Math.sqrt(e.widthMm ** 2 + e.heightMm ** 2) / 25.4;
    return `${inches.toFixed(1)}"`;
  }

  _getHexString() {
    if (!this.edid?.rawEdid) return '';
    return Array.from(this.edid.rawEdid)
      .map(b => b.toString(16).padStart(2, '0'))
      .join(' ');
  }

  async _copyHex() {
    const hexString = this._getHexString();
    try {
      await navigator.clipboard.writeText(hexString);
      this._copied = true;
      setTimeout(() => { this._copied = false; }, 2000);
    } catch (err) {
      console.error('Failed to copy:', err);
    }
  }

  _renderRaw() {
    if (!this.edid.rawEdid) {
      return html`<div class="empty">No raw EDID data available</div>`;
    }

    const hexString = this._getHexString();

    return html`
      <div class="hex-container">
        <div class="hex-header">
          <span class="hex-label">${this.edid.rawEdid.length} bytes</span>
          <button class="copy-btn" @click=${this._copyHex} ?data-copied=${this._copied}>
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

customElements.define('edid-detail', EdidDetail);
