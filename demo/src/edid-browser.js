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
        await this.indexLoader.load(name);
      } catch (err) {
        console.warn(`Failed to preload ${name}:`, err);
      }
    }
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
        ></results-table>
      </div>
    `;
  }

  _onTabChange(e) {
    this.activeTab = e.detail.tab;
    this.results = [];
    this.searchQuery = '';
  }

  async _onSearch(e) {
    const { tab, query } = e.detail;
    if (!query.trim()) {
      this.results = [];
      return;
    }

    this.searchQuery = query;

    try {
      // Check if index needs loading
      const indexState = this.indexLoader.getState(tab);
      if (indexState !== 'loaded') {
        this.isLoadingIndex = true;
      }

      // Load index if not already loaded
      const index = await this.indexLoader.load(tab);
      this.isLoadingIndex = false;

      // Now search
      this.isSearching = true;
      const matches = index.search(query);
      this.results = matches;
    } catch (err) {
      console.error('Search failed:', err);
      this.results = [];
    } finally {
      this.isSearching = false;
      this.isLoadingIndex = false;
    }
  }
}

customElements.define('edid-browser', EdidBrowser);
