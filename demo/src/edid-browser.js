import { LitElement, html, css } from 'lit';
import { IndexLoader } from './index-loader.js';
import { BucketLoader } from './bucket-loader.js';
import './search-tabs.js';
import './results-table.js';
import './edid-detail.js';

/**
 * Main EDID browser component.
 * Coordinates search tabs, index loading, and results display.
 */
export class EdidBrowser extends LitElement {
  static properties = {
    baseUrl: { type: String, attribute: 'data-base-url' },
    activeTab: { type: String, state: true },
    searchQuery: { type: String, state: true },
    results: { type: Array, state: true },
    isSearching: { type: Boolean, state: true },
    isLoadingIndex: { type: Boolean, state: true },
    _status: { type: Object, state: true },
    _selectedEdid: { type: Object, state: true },
    _layoutMode: { type: String, state: true },  // 'wide', 'stacked', 'mobile'
    _showDetail: { type: Boolean, state: true }, // For mobile slide navigation
  };

  static styles = css`
    :host {
      display: flex;
      flex-direction: column;
      height: 100%;
      min-height: 0;
    }

    .search-section {
      padding: 0.75rem 1rem;
      background: var(--color-surface, #16213e);
      border-bottom: 1px solid var(--color-border, #2a2a4e);
      flex-shrink: 0;
    }

    /* Main content area - holds results and detail */
    .main-content {
      flex: 1;
      min-height: 0;
      display: flex;
      overflow: hidden;
    }

    /* Wide layout: side by side with fixed results width */
    :host([layout="wide"]) .main-content {
      flex-direction: row;
    }

    :host([layout="wide"]) .results-section {
      width: 450px;
      flex-shrink: 0;
      border-right: 1px solid var(--color-border, #2a2a4e);
    }

    :host([layout="wide"]) .detail-section {
      flex: 1;
      min-width: 0;
    }

    /* Stacked layout: results top with fixed height, detail below */
    :host([layout="stacked"]) .main-content {
      flex-direction: column;
    }

    :host([layout="stacked"]) .results-section {
      height: 300px;
      flex-shrink: 0;
      border-bottom: 1px solid var(--color-border, #2a2a4e);
    }

    :host([layout="stacked"]) .detail-section {
      flex: 1;
      min-height: 0;
    }

    /* Mobile layout: slide between screens */
    :host([layout="mobile"]) .main-content {
      position: relative;
      overflow: hidden;
    }

    :host([layout="mobile"]) .results-section,
    :host([layout="mobile"]) .detail-section {
      position: absolute;
      top: 0;
      left: 0;
      right: 0;
      bottom: 0;
      transition: transform 0.3s ease-in-out;
    }

    :host([layout="mobile"]) .results-section {
      transform: translateX(0);
    }

    :host([layout="mobile"][show-detail]) .results-section {
      transform: translateX(-100%);
    }

    :host([layout="mobile"]) .detail-section {
      transform: translateX(100%);
    }

    :host([layout="mobile"][show-detail]) .detail-section {
      transform: translateX(0);
    }

    .results-section {
      overflow-y: auto;
      background: var(--color-bg, #1a1a2e);
    }

    .detail-section {
      overflow-y: auto;
      background: var(--color-surface, #16213e);
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

    .status-time {
      color: var(--color-text-muted, #666);
    }
  `;

  constructor() {
    super();
    this.baseUrl = '../data/';
    this.activeTab = 'products';
    this.searchQuery = '';
    this.results = [];
    this.isSearching = false;
    this.isLoadingIndex = false;
    this.indexLoader = null;
    this.bucketLoader = null;
    this._status = { message: 'Ready', type: 'info', timestamp: Date.now() };
    this._selectedEdid = null;
    this._layoutMode = 'wide';
    this._showDetail = false;
    this._resizeObserver = null;
  }

  connectedCallback() {
    super.connectedCallback();
    this.indexLoader = new IndexLoader(this.baseUrl);
    this.bucketLoader = new BucketLoader(this.baseUrl);

    // Preload manifest for bucket lookups
    this.bucketLoader.loadManifest();

    // Progressive background loading - smallest/most useful first
    this._preloadIndexes();

    // Set up resize observer for responsive layout
    this._resizeObserver = new ResizeObserver(entries => {
      for (const entry of entries) {
        this._updateLayout(entry.contentRect.width, entry.contentRect.height);
      }
    });
    this._resizeObserver.observe(this);

    // Initial layout check
    requestAnimationFrame(() => {
      const rect = this.getBoundingClientRect();
      this._updateLayout(rect.width, rect.height);
    });
  }

  disconnectedCallback() {
    super.disconnectedCallback();
    if (this._resizeObserver) {
      this._resizeObserver.disconnect();
      this._resizeObserver = null;
    }
  }

  _updateLayout(width, height) {
    let mode;
    if (width < 600) {
      mode = 'mobile';
    } else if (width >= 1000) {
      mode = 'wide';
    } else {
      // Between 600-1000px: use stacked if tall enough, otherwise mobile-like
      mode = height >= 600 ? 'stacked' : 'mobile';
    }

    if (mode !== this._layoutMode) {
      this._layoutMode = mode;
      this.setAttribute('layout', mode);
    }

    // Update show-detail attribute for mobile sliding
    if (this._showDetail) {
      this.setAttribute('show-detail', '');
    } else {
      this.removeAttribute('show-detail');
    }
  }

  async _preloadIndexes() {
    const loadOrder = ['products', 'vendors', 'sizes', 'codes', 'paths'];

    for (const name of loadOrder) {
      try {
        this._setStatus(`Preloading ${name} index...`, 'loading');
        await this.indexLoader.load(name);
        this._setStatus(`Loaded ${name} index`, 'success');
      } catch (err) {
        console.warn(`Failed to preload ${name}:`, err);
        this._setStatus(`Failed to preload ${name}: ${err.message}`, 'warning');
      }
    }
    this._setStatus('All indexes loaded', 'success');
  }

  _setStatus(message, type = 'info') {
    this._status = { message, type, timestamp: Date.now() };
  }

  _onStatus(e) {
    this._status = e.detail;
  }

  _onEdidSelect(e) {
    this._selectedEdid = e.detail.edid;
    // On mobile, slide to detail screen
    if (this._layoutMode === 'mobile') {
      this._showDetail = true;
      this.setAttribute('show-detail', '');
    }
  }

  _onDetailBack() {
    this._showDetail = false;
    this.removeAttribute('show-detail');
  }

  _formatTime(timestamp) {
    const date = new Date(timestamp);
    return date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' });
  }

  render() {
    return html`
      <div class="search-section">
        <search-tabs
          .activeTab=${this.activeTab}
          .indexLoader=${this.indexLoader}
          @tab-change=${this._onTabChange}
          @search=${this._onSearch}
        ></search-tabs>
      </div>
      <div class="main-content">
        <div class="results-section">
          <results-table
            .results=${this.results}
            .isLoading=${this.isSearching}
            .isLoadingIndex=${this.isLoadingIndex}
            .indexLoader=${this.indexLoader}
            .bucketLoader=${this.bucketLoader}
            .activeTab=${this.activeTab}
            @status=${this._onStatus}
            @edid-select=${this._onEdidSelect}
          ></results-table>
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
        <span class="status-time">${this._formatTime(this._status.timestamp)}</span>
      </div>
    `;
  }

  _onTabChange(e) {
    this.activeTab = e.detail.tab;
    this.results = [];
    this.searchQuery = '';
    this._setStatus(`Switched to ${e.detail.tab}`, 'info');
  }

  async _onSearch(e) {
    const { tab, query } = e.detail;
    if (!query.trim()) {
      this.results = [];
      return;
    }

    this.searchQuery = query;
    this._setStatus(`Searching "${query}"...`, 'loading');

    try {
      // Check if index needs loading
      const indexState = this.indexLoader.getState(tab);
      if (indexState !== 'loaded') {
        this.isLoadingIndex = true;
        this._setStatus(`Loading ${tab} index...`, 'loading');
      }

      // Load index if not already loaded
      const index = await this.indexLoader.load(tab);
      this.isLoadingIndex = false;

      // Now search
      this.isSearching = true;
      const matches = index.search(query);
      this.results = matches;
      this._setStatus(`Found ${matches.length} results for "${query}"`, 'success');
    } catch (err) {
      console.error('Search failed:', err);
      this.results = [];
      this._setStatus(`Search failed: ${err.message}`, 'error');
    } finally {
      this.isSearching = false;
      this.isLoadingIndex = false;
    }
  }
}

customElements.define('edid-browser', EdidBrowser);
