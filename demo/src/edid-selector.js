import { LitElement, html, css } from 'lit';
import { IndexLoader } from './index-loader.js';
import { BucketLoader } from './bucket-loader.js';
import './search-tabs.js';
import './results-table.js';

/**
 * EDID selector component - search and browse interface.
 * Self-contained component that manages index loading and search state.
 *
 * @element edid-selector
 * @prop {string} baseUrl - Base URL for data files (default: '../data/')
 * @prop {string} activeTab - Currently active search tab
 * @fires edid-select - Dispatched when an EDID is selected, detail: { edid }
 * @fires status - Dispatched with status updates, detail: { message, type }
 */
export class EdidSelector extends LitElement {
  static properties = {
    baseUrl: { type: String, attribute: 'base-url' },
    activeTab: { type: String, attribute: 'active-tab' },
    _results: { type: Array, state: true },
    _isSearching: { type: Boolean, state: true },
    _isLoadingIndex: { type: Boolean, state: true },
    _searchQuery: { type: String, state: true },
  };

  static styles = css`
    :host {
      display: flex;
      flex-direction: column;
      height: 100%;
      min-height: 0;
      background: var(--color-bg, #1a1a2e);
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
    }
  `;

  constructor() {
    super();
    this.baseUrl = '../data/';
    this.activeTab = 'products';
    this._results = [];
    this._isSearching = false;
    this._isLoadingIndex = false;
    this._searchQuery = '';
    this._indexLoader = null;
    this._bucketLoader = null;
  }

  connectedCallback() {
    super.connectedCallback();

    this._indexLoader = new IndexLoader(this.baseUrl);
    this._bucketLoader = new BucketLoader(this.baseUrl);

    // Preload manifest for bucket lookups
    this._bucketLoader.loadManifest().catch(err => {
      console.warn('Failed to load manifest:', err);
    });

    // Load indexes progressively
    this._preloadIndexes();
  }

  get indexLoader() {
    return this._indexLoader;
  }

  get bucketLoader() {
    return this._bucketLoader;
  }

  async _preloadIndexes() {
    const loadOrder = ['products', 'vendors', 'sizes', 'codes', 'paths'];

    for (const name of loadOrder) {
      try {
        this._emitStatus(`Preloading ${name} index...`, 'loading');
        const index = await this._indexLoader.load(name);

        // Show initial results for active tab
        if (name === this.activeTab) {
          this._results = index.entries;
          this._emitStatus(`Showing ${index.entries.length} ${name}`, 'success');
        } else {
          this._emitStatus(`Loaded ${name} index`, 'success');
        }
      } catch (err) {
        console.warn(`Failed to preload ${name}:`, err);
        this._emitStatus(`Failed to preload ${name}: ${err.message}`, 'warning');
      }
    }
    this._emitStatus('All indexes loaded', 'success');
  }

  _emitStatus(message, type = 'info') {
    this.dispatchEvent(new CustomEvent('status', {
      detail: { message, type, timestamp: Date.now() },
      bubbles: true,
      composed: true,
    }));
  }

  _onTabChange(e) {
    this.activeTab = e.detail.tab;
    this._results = [];
    this._searchQuery = '';
    this._emitStatus(`Switched to ${e.detail.tab}`, 'info');
    this._loadInitialResults(e.detail.tab);
  }

  async _loadInitialResults(tab) {
    // Hash tab doesn't have an index
    if (tab === 'hashes') {
      this._results = [];
      this._emitStatus('Enter a hex prefix to search by MD5 hash', 'info');
      return;
    }

    try {
      const index = await this._indexLoader.load(tab);
      this._results = index.entries;
      this._emitStatus(`Showing ${index.entries.length} ${tab}`, 'success');
    } catch (err) {
      console.error('Failed to load initial results:', err);
      this._emitStatus(`Failed to load ${tab}: ${err.message}`, 'error');
    }
  }

  async _onSearch(e) {
    const { tab, query } = e.detail;
    this._searchQuery = query;

    // Hash search uses direct bucket scan
    if (tab === 'hashes') {
      await this._searchByHash(query);
      return;
    }

    try {
      // Check if index needs loading
      const indexState = this._indexLoader.getState(tab);
      if (indexState !== 'loaded') {
        this._isLoadingIndex = true;
        this._emitStatus(`Loading ${tab} index...`, 'loading');
      }

      const index = await this._indexLoader.load(tab);
      this._isLoadingIndex = false;

      this._isSearching = true;
      if (!query.trim()) {
        this._results = index.entries;
        this._emitStatus(`Showing ${index.entries.length} ${tab}`, 'success');
      } else {
        const matches = index.search(query);
        this._results = matches;
        this._emitStatus(`Found ${matches.length} results for "${query}"`, 'success');
      }
    } catch (err) {
      console.error('Search failed:', err);
      this._results = [];
      this._emitStatus(`Search failed: ${err.message}`, 'error');
    } finally {
      this._isSearching = false;
      this._isLoadingIndex = false;
    }
  }

  async _searchByHash(query) {
    const prefix = query.trim().toLowerCase().replace(/[^0-9a-f]/g, '');

    if (!prefix) {
      this._results = [];
      this._emitStatus('Enter a hex prefix to search by MD5 hash', 'info');
      return;
    }

    if (prefix.length < 2) {
      this._results = [];
      this._emitStatus('Enter at least 2 hex characters for hash search', 'info');
      return;
    }

    this._isSearching = true;
    this._emitStatus(`Searching for hashes starting with "${prefix}"...`, 'loading');

    try {
      const bucketPrefix = parseInt(prefix.slice(0, 2), 16);
      const bucket = await this._bucketLoader.load(bucketPrefix);

      const matches = [];
      for (let i = 0; i < bucket.entryCount; i++) {
        const entry = bucket.getEntry(i);
        if (entry.md5Hex.startsWith(prefix)) {
          matches.push({
            key: entry.md5Hex,
            _hashEntry: entry,
          });
        }
        if (matches.length >= 100) break;
      }

      this._results = matches;
      const moreText = matches.length >= 100 ? '100+' : matches.length;
      this._emitStatus(`Found ${moreText} hashes starting with "${prefix}"`, 'success');
    } catch (err) {
      console.error('Hash search failed:', err);
      this._results = [];
      this._emitStatus(`Hash search failed: ${err.message}`, 'error');
    } finally {
      this._isSearching = false;
    }
  }

  _onEdidSelect(e) {
    // Re-emit the event
    this.dispatchEvent(new CustomEvent('edid-select', {
      detail: e.detail,
      bubbles: true,
      composed: true,
    }));
  }

  _onStatus(e) {
    // Re-emit status from child components
    this.dispatchEvent(new CustomEvent('status', {
      detail: e.detail,
      bubbles: true,
      composed: true,
    }));
  }

  render() {
    return html`
      <div class="search-section">
        <search-tabs
          .activeTab=${this.activeTab}
          .indexLoader=${this._indexLoader}
          @tab-change=${this._onTabChange}
          @search=${this._onSearch}
        ></search-tabs>
      </div>
      <div class="results-section">
        <results-table
          .results=${this._results}
          .isLoading=${this._isSearching}
          .isLoadingIndex=${this._isLoadingIndex}
          .indexLoader=${this._indexLoader}
          .bucketLoader=${this._bucketLoader}
          .activeTab=${this.activeTab}
          @status=${this._onStatus}
          @edid-select=${this._onEdidSelect}
        ></results-table>
      </div>
    `;
  }
}

customElements.define('edid-selector', EdidSelector);
