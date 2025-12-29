import { LitElement, html, css } from 'lit';
import { IndexLoader } from './index-loader.js';
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
  };

  static styles = css`
    :host {
      display: block;
    }

    .container {
      background: var(--color-surface);
      border-radius: var(--radius);
      overflow: hidden;
    }

    .search-section {
      padding: 1rem;
      border-bottom: 1px solid var(--color-primary);
    }

    .results-section {
      min-height: 400px;
    }
  `;

  constructor() {
    super();
    this.baseUrl = '../data/';
    this.activeTab = 'products';
    this.searchQuery = '';
    this.results = [];
    this.isSearching = false;
    this.indexLoader = null;
  }

  connectedCallback() {
    super.connectedCallback();
    this.indexLoader = new IndexLoader(this.baseUrl);
  }

  render() {
    return html`
      <div class="container">
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
            .baseUrl=${this.baseUrl}
          ></results-table>
        </div>
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

    this.isSearching = true;
    this.searchQuery = query;

    try {
      // Load index if not already loaded
      const index = await this.indexLoader.load(tab);

      // Search for matching entries
      const matches = index.search(query);
      this.results = matches;
    } catch (err) {
      console.error('Search failed:', err);
      this.results = [];
    } finally {
      this.isSearching = false;
    }
  }
}

customElements.define('edid-browser', EdidBrowser);
