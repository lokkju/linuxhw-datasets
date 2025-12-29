import { LitElement, html, css } from 'lit';

/**
 * EDID detail panel showing raw hex and decoded data.
 */
export class EdidDetail extends LitElement {
  static properties = {
    edid: { type: Object },
    mobile: { type: Boolean, reflect: true },
    _activeTab: { type: String, state: true },
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

    .hex-dump {
      font-family: ui-monospace, monospace;
      font-size: 0.75rem;
      line-height: 1.5;
      white-space: pre;
      color: var(--color-text, #eee);
    }

    .hex-line {
      display: flex;
      gap: 1rem;
    }

    .hex-offset {
      color: var(--color-text-muted, #888);
      min-width: 4ch;
    }

    .hex-bytes {
      letter-spacing: 0.25em;
    }

    .hex-ascii {
      color: var(--color-text-muted, #888);
    }

    .decoded-section {
      margin-bottom: 1rem;
    }

    .decoded-title {
      font-size: 0.75rem;
      color: var(--color-text-muted, #888);
      text-transform: uppercase;
      letter-spacing: 0.05em;
      margin-bottom: 0.5rem;
    }

    .decoded-grid {
      display: grid;
      grid-template-columns: auto 1fr;
      gap: 0.25rem 1rem;
      font-size: 0.8125rem;
    }

    .decoded-label {
      color: var(--color-text-muted, #888);
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

  _renderRaw() {
    if (!this.edid.rawEdid) {
      return html`<div class="empty">No raw EDID data available</div>`;
    }

    const bytes = this.edid.rawEdid;
    const lines = [];

    for (let i = 0; i < bytes.length; i += 16) {
      const offset = i.toString(16).padStart(4, '0');
      const chunk = bytes.slice(i, i + 16);

      const hexPart = Array.from(chunk)
        .map(b => b.toString(16).padStart(2, '0'))
        .join(' ');

      const asciiPart = Array.from(chunk)
        .map(b => (b >= 0x20 && b < 0x7f) ? String.fromCharCode(b) : '.')
        .join('');

      lines.push({ offset, hex: hexPart, ascii: asciiPart });
    }

    return html`
      <div class="hex-dump">
        ${lines.map(line => html`
          <div class="hex-line">
            <span class="hex-offset">${line.offset}</span>
            <span class="hex-bytes">${line.hex}</span>
            <span class="hex-ascii">${line.ascii}</span>
          </div>
        `)}
      </div>
    `;
  }
}

customElements.define('edid-detail', EdidDetail);
