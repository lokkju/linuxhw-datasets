import { LitElement, html, css } from 'lit';
import './edid-selector.js';
import './edid-detail.js';

/**
 * Main EDID browser component - wrapper that coordinates selector and viewer.
 * Handles responsive layout and status display.
 *
 * @element edid-browser
 * @prop {string} baseUrl - Base URL for data files
 */
export class EdidBrowser extends LitElement {
  static properties = {
    baseUrl: { type: String, attribute: 'data-base-url' },
    _status: { type: Object, state: true },
    _selectedEdid: { type: Object, state: true },
    _layoutMode: { type: String, state: true },
    _showDetail: { type: Boolean, state: true },
    _upstream: { type: Object, state: true },
  };

  static styles = css`
    :host {
      display: flex;
      flex-direction: column;
      width: 100%;
      height: 100%;
      min-height: 0;
      max-width: 1200px;
      margin: 0 auto;
      background: var(--color-bg, #1a1a2e);
      box-shadow: 0 0 20px rgba(0, 0, 0, 0.5);
    }

    .header {
      height: 48px;
      padding: 0 1rem;
      display: flex;
      align-items: center;
      gap: 1rem;
      border-bottom: 1px solid var(--color-border, #2a2a4e);
      flex-shrink: 0;
      background: var(--color-surface, #16213e);
    }

    .header h1 {
      margin: 0;
      font-size: 1rem;
      font-weight: 600;
    }

    .header .count {
      color: var(--color-text-muted, #888);
      font-size: 0.8125rem;
    }

    .header .project-link {
      color: var(--color-accent, #e94560);
      text-decoration: none;
      font-size: 0.8125rem;
      margin-left: auto;
    }

    .header .project-link:hover {
      text-decoration: underline;
    }

    /* Main content area */
    .main-content {
      flex: 1;
      min-height: 0;
      display: flex;
      flex-direction: row;
      overflow: hidden;
    }

    /* Wide layout: side by side */
    :host([layout="wide"]) .main-content {
      flex-direction: row;
    }

    :host([layout="wide"]) .selector-section {
      width: 450px;
      flex-shrink: 0;
      border-right: 1px solid var(--color-border, #2a2a4e);
    }

    :host([layout="wide"]) .detail-section {
      flex: 1 1 auto;
    }

    /* Mobile layout: slide between screens */
    :host([layout="mobile"]) .main-content {
      position: relative;
      overflow: hidden;
    }

    :host([layout="mobile"]) .selector-section,
    :host([layout="mobile"]) .detail-section {
      width: auto;
      min-width: 0;
      position: absolute;
      top: 0;
      left: 0;
      right: 0;
      bottom: 0;
      transition: transform 0.3s ease-in-out;
    }

    :host([layout="mobile"]) .selector-section {
      transform: translateX(0);
    }

    :host([layout="mobile"][show-detail]) .selector-section {
      transform: translateX(-100%);
    }

    :host([layout="mobile"]) .detail-section {
      transform: translateX(100%);
    }

    :host([layout="mobile"][show-detail]) .detail-section {
      transform: translateX(0);
    }

    .selector-section {
      overflow: hidden;
      background: var(--color-bg, #1a1a2e);
      width: 450px;
      flex-shrink: 0;
    }

    .detail-section {
      overflow: hidden;
      background: var(--color-surface, #16213e);
      flex: 1 1 auto;
      width: 0;
    }

    .status-bar {
      height: 24px;
      padding: 0 1rem;
      background: var(--color-surface, #16213e);
      border-top: 1px solid var(--color-border, #2a2a4e);
      display: flex;
      align-items: center;
      gap: 0.5rem;
      font-size: 0.6875rem;
      color: var(--color-text-muted, #888);
      flex-shrink: 0;
    }

    .status-indicator {
      width: 6px;
      height: 6px;
      border-radius: 50%;
      background: var(--color-text-muted, #888);
    }

    .status-indicator[data-type="loading"] {
      background: var(--color-accent, #e94560);
      animation: pulse 1s ease-in-out infinite;
    }

    .status-indicator[data-type="success"] {
      background: #4ade80;
    }

    .status-indicator[data-type="warning"] {
      background: #fbbf24;
    }

    .status-indicator[data-type="error"] {
      background: var(--color-accent, #e94560);
    }

    @keyframes pulse {
      0%, 100% { opacity: 1; }
      50% { opacity: 0.4; }
    }

    .status-message {
      flex: 1;
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
    }

    .status-source {
      color: var(--color-text-muted, #666);
      font-size: 0.625rem;
    }
  `;

  constructor() {
    super();
    this.baseUrl = '../data/';
    this._status = { message: 'Ready', type: 'info', timestamp: Date.now() };
    this._selectedEdid = null;
    this._layoutMode = 'wide';
    this._showDetail = false;
    this._resizeObserver = null;
    this._upstream = null;
  }

  connectedCallback() {
    super.connectedCallback();

    // Set default layout
    this.setAttribute('layout', 'wide');

    // Fetch manifest for upstream info
    this._loadManifest();

    // Set up resize observer for responsive layout
    this._resizeObserver = new ResizeObserver(entries => {
      for (const entry of entries) {
        this._updateLayout(entry.contentRect.width);
      }
    });
    this._resizeObserver.observe(this);

    // Initial layout check
    requestAnimationFrame(() => {
      const rect = this.getBoundingClientRect();
      this._updateLayout(rect.width);
    });
  }

  disconnectedCallback() {
    super.disconnectedCallback();
    if (this._resizeObserver) {
      this._resizeObserver.disconnect();
      this._resizeObserver = null;
    }
  }

  async _loadManifest() {
    try {
      const response = await fetch(`${this.baseUrl}manifest.json`);
      if (response.ok) {
        const manifest = await response.json();
        if (manifest?.upstream) {
          this._upstream = manifest.upstream;
        }
      }
    } catch (err) {
      console.warn('Failed to load manifest:', err);
    }
  }

  _updateLayout(width) {
    if (width < 100) return;

    const mode = width < 600 ? 'mobile' : 'wide';

    if (mode !== this._layoutMode) {
      this._layoutMode = mode;
      this.setAttribute('layout', mode);
    }

    if (this._showDetail) {
      this.setAttribute('show-detail', '');
    } else {
      this.removeAttribute('show-detail');
    }
  }

  _onStatus(e) {
    this._status = e.detail;
  }

  _onEdidSelect(e) {
    this._selectedEdid = e.detail.edid;
    if (this._layoutMode === 'mobile') {
      this._showDetail = true;
      this.setAttribute('show-detail', '');
    }
  }

  _onDetailBack() {
    this._showDetail = false;
    this.removeAttribute('show-detail');
  }

  _renderUpstreamInfo() {
    if (!this._upstream) {
      return 'Powered by linuxhw/EDID';
    }
    const { commit, date } = this._upstream;
    return `Powered by linuxhw/EDID rev ${commit} @ ${date}`;
  }

  render() {
    return html`
      <div class="header">
        <h1>EDID Browser</h1>
        <span class="count">141,753 monitors</span>
        <a href="https://github.com/lokkju/edid-dataset" target="_blank" class="project-link">lokkju/edid-dataset</a>
      </div>
      <div class="main-content">
        <div class="selector-section">
          <edid-selector
            base-url=${this.baseUrl}
            @status=${this._onStatus}
            @edid-select=${this._onEdidSelect}
          ></edid-selector>
        </div>
        <div class="detail-section">
          <edid-detail
            .edid=${this._selectedEdid}
            ?mobile=${this._layoutMode === 'mobile'}
            @back=${this._onDetailBack}
          ></edid-detail>
        </div>
      </div>
      <div class="status-bar">
        <span class="status-indicator" data-type=${this._status.type}></span>
        <span class="status-message">${this._status.message}</span>
        <span class="status-source">${this._renderUpstreamInfo()}</span>
      </div>
    `;
  }
}

customElements.define('edid-browser', EdidBrowser);
