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
    _upstream: { type: Object, state: true },    // { commit, date } from manifest
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
      flex-direction: row;  /* Default to wide layout */
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
      flex: 1 1 auto;
    }

    /* Stacked layout: results top with fixed height, detail below */
    :host([layout="stacked"]) .main-content {
      flex-direction: column;
    }

    :host([layout="stacked"]) .results-section {
      width: auto;
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
      width: auto;
      min-width: 0;
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
      /* Default to wide layout */
      width: 450px;
      flex-shrink: 0;
    }

    .detail-section {
      overflow-y: auto;
      background: var(--color-surface, #16213e);
      /* Take remaining space */
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
    this._upstream = null;
  }

  connectedCallback() {
    super.connectedCallback();

    // Set default layout immediately
    this.setAttribute('layout', 'wide');

    this.indexLoader = new IndexLoader(this.baseUrl);
    this.bucketLoader = new BucketLoader(this.baseUrl);

    // Preload manifest for bucket lookups and get upstream info
    this.bucketLoader.loadManifest().then(manifest => {
      if (manifest?.upstream) {
        this._upstream = manifest.upstream;
      }
    });

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
    // Ignore bogus measurements (component not yet laid out)
    if (width < 100) return;

    let mode;
    if (width < 600) {
      mode = 'mobile';
    } else {
      mode = 'wide';
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
        const index = await this.indexLoader.load(name);

        // Show initial results for first (active) tab
        if (name === this.activeTab) {
          this.results = index.entries;
          this._setStatus(`Showing ${index.entries.length} ${name}`, 'success');
        } else {
          this._setStatus(`Loaded ${name} index`, 'success');
        }
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
        <span class="status-source">${this._renderUpstreamInfo()}</span>
      </div>
    `;
  }

  _onTabChange(e) {
    this.activeTab = e.detail.tab;
    this.results = [];
    this.searchQuery = '';
    this._setStatus(`Switched to ${e.detail.tab}`, 'info');
    // Load initial results for new tab
    this._loadInitialResults(e.detail.tab);
  }

  async _loadInitialResults(tab) {
    // Hash tab doesn't have an index - requires search
    if (tab === 'hashes') {
      this.results = [];
      this._setStatus('Enter a hex prefix to search by MD5 hash', 'info');
      return;
    }

    try {
      const index = await this.indexLoader.load(tab);
      // Show all entries (already sorted alphabetically)
      this.results = index.entries;
      this._setStatus(`Showing ${index.entries.length} ${tab}`, 'success');
    } catch (err) {
      console.error('Failed to load initial results:', err);
    }
  }

  async _onSearch(e) {
    const { tab, query } = e.detail;

    this.searchQuery = query;

    // Hash search is handled differently - direct bucket scan
    if (tab === 'hashes') {
      await this._searchByHash(query);
      return;
    }

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

      // Search or show all
      this.isSearching = true;
      if (!query.trim()) {
        this.results = index.entries;
        this._setStatus(`Showing ${index.entries.length} ${tab}`, 'success');
      } else {
        const matches = index.search(query);
        this.results = matches;
        this._setStatus(`Found ${matches.length} results for "${query}"`, 'success');
      }
    } catch (err) {
      console.error('Search failed:', err);
      this.results = [];
      this._setStatus(`Search failed: ${err.message}`, 'error');
    } finally {
      this.isSearching = false;
      this.isLoadingIndex = false;
    }
  }

  async _searchByHash(query) {
    const prefix = query.trim().toLowerCase().replace(/[^0-9a-f]/g, '');

    if (!prefix) {
      this.results = [];
      this._setStatus('Enter a hex prefix to search by MD5 hash', 'info');
      return;
    }

    if (prefix.length < 2) {
      this.results = [];
      this._setStatus('Enter at least 2 hex characters for hash search', 'info');
      return;
    }

    this.isSearching = true;
    this._setStatus(`Searching for hashes starting with "${prefix}"...`, 'loading');

    try {
      // First 2 chars determine the bucket
      const bucketPrefix = parseInt(prefix.slice(0, 2), 16);

      // Load the bucket
      const bucket = await this.bucketLoader.load(bucketPrefix);

      // Get all entries and filter by prefix
      const matches = [];
      for (let i = 0; i < bucket.entryCount; i++) {
        const entry = bucket.getEntry(i);
        if (entry.md5Hex.startsWith(prefix)) {
          matches.push({
            key: entry.md5Hex,
            // For hash results, we store the entry directly for display
            _hashEntry: entry,
          });
        }
        // Stop if we have enough matches
        if (matches.length >= 100) break;
      }

      this.results = matches;
      const moreText = matches.length >= 100 ? '100+' : matches.length;
      this._setStatus(`Found ${moreText} hashes starting with "${prefix}"`, 'success');
    } catch (err) {
      console.error('Hash search failed:', err);
      this.results = [];
      this._setStatus(`Hash search failed: ${err.message}`, 'error');
    } finally {
      this.isSearching = false;
    }
  }
}

customElements.define('edid-browser', EdidBrowser);
