import { LitElement, html, css } from 'lit';
import { IndexLoader } from './index-loader.js';
import { BucketLoader } from './bucket-loader.js';
import './search-tabs.js';
import './results-table.js';

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

    .results-section {
      flex: 1;
      min-height: 0;
      overflow-y: auto;
      background: var(--color-bg, #1a1a2e);
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
  }

  connectedCallback() {
    super.connectedCallback();
    this.indexLoader = new IndexLoader(this.baseUrl);
    this.bucketLoader = new BucketLoader(this.baseUrl);

    // Preload manifest for bucket lookups
    this.bucketLoader.loadManifest();

    // Progressive background loading - smallest/most useful first
    this._preloadIndexes();
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
    // Future: This will trigger showing the detail panel
    // On mobile, this would slide to a new screen
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
