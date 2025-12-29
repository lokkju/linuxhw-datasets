import { LitElement, html, css } from 'lit';

const TABS = [
  { id: 'products', label: 'Product Name', size: '802 KB', placeholder: 'e.g., U2412M, 27GL850' },
  { id: 'vendors', label: 'Vendor', size: '254 KB', placeholder: 'e.g., Dell, Samsung' },
  { id: 'codes', label: 'PNP Code', size: '1.2 MB', placeholder: 'e.g., DEL01101, SAM0A7C' },
  { id: 'sizes', label: 'Screen Size', size: '228 KB', placeholder: 'e.g., 27, 32' },
];

/**
 * Search tabs component with loading indicators.
 */
export class SearchTabs extends LitElement {
  static properties = {
    activeTab: { type: String },
    indexLoader: { type: Object },
    _loadingStates: { type: Object, state: true },
    _searchValue: { type: String, state: true },
  };

  static styles = css`
    :host {
      display: block;
    }

    .tabs {
      display: flex;
      gap: 0.5rem;
      margin-bottom: 1rem;
    }

    .tab {
      flex: 1;
      padding: 0.75rem 1rem;
      border: none;
      background: var(--color-primary);
      color: var(--color-text);
      border-radius: var(--radius);
      cursor: pointer;
      font-size: 0.875rem;
      transition: background 0.15s, opacity 0.15s;
      position: relative;
      overflow: hidden;
    }

    .tab:hover {
      background: var(--color-accent);
    }

    .tab[data-active="true"] {
      background: var(--color-accent);
    }

    .tab-label {
      display: block;
      font-weight: 500;
    }

    .tab-size {
      display: block;
      font-size: 0.75rem;
      opacity: 0.7;
      margin-top: 0.25rem;
    }

    .tab-progress {
      position: absolute;
      bottom: 0;
      left: 0;
      height: 4px;
      background: rgba(255,255,255,0.3);
      width: 100%;
    }

    .tab-progress-bar {
      height: 100%;
      background: var(--color-accent);
      transition: width 0.15s ease-out;
    }

    .tab-progress-bar[data-loaded="true"] {
      background: #4ade80; /* green when fully loaded */
    }

    .search-box {
      display: flex;
      gap: 0.5rem;
    }

    .search-input {
      flex: 1;
      padding: 0.75rem 1rem;
      border: 2px solid var(--color-primary);
      background: var(--color-bg);
      color: var(--color-text);
      border-radius: var(--radius);
      font-size: 1rem;
      outline: none;
      transition: border-color 0.15s;
    }

    .search-input:focus {
      border-color: var(--color-accent);
    }

    .search-input::placeholder {
      color: var(--color-text-muted);
    }

    .search-btn {
      padding: 0.75rem 1.5rem;
      border: none;
      background: var(--color-accent);
      color: var(--color-text);
      border-radius: var(--radius);
      font-size: 1rem;
      cursor: pointer;
      transition: opacity 0.15s;
    }

    .search-btn:hover {
      opacity: 0.9;
    }

    .search-btn:disabled {
      opacity: 0.5;
      cursor: not-allowed;
    }
  `;

  constructor() {
    super();
    this.activeTab = 'products';
    this._loadingStates = {};
    this._searchValue = '';
    this._unsubscribe = null;
  }

  connectedCallback() {
    super.connectedCallback();
    this._subscribeToProgress();
  }

  disconnectedCallback() {
    super.disconnectedCallback();
    if (this._unsubscribe) {
      this._unsubscribe();
    }
  }

  updated(changedProps) {
    if (changedProps.has('indexLoader') && this.indexLoader) {
      this._subscribeToProgress();
    }
  }

  _subscribeToProgress() {
    if (this._unsubscribe) {
      this._unsubscribe();
    }
    if (!this.indexLoader) return;

    this._unsubscribe = this.indexLoader.onProgress((name, loaded, total) => {
      this._loadingStates = {
        ...this._loadingStates,
        [name]: { loaded, total, state: 'loading' },
      };
    });
  }

  _getTabState(tabId) {
    if (!this.indexLoader) return 'idle';
    const state = this.indexLoader.getState(tabId);
    const progress = this.indexLoader.getProgress(tabId);
    return { state, ...progress };
  }

  _formatBytes(bytes) {
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`;
    return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  }

  _onTabClick(tabId) {
    if (tabId !== this.activeTab) {
      this.activeTab = tabId;
      this._searchValue = '';
      this.dispatchEvent(new CustomEvent('tab-change', {
        detail: { tab: tabId },
        bubbles: true,
        composed: true,
      }));

      // Preload index when tab is clicked
      if (this.indexLoader) {
        this.indexLoader.load(tabId);
      }
    }
  }

  _onSearch(e) {
    e.preventDefault();
    this.dispatchEvent(new CustomEvent('search', {
      detail: { tab: this.activeTab, query: this._searchValue },
      bubbles: true,
      composed: true,
    }));
  }

  _onInput(e) {
    this._searchValue = e.target.value;
  }

  render() {
    const currentTab = TABS.find(t => t.id === this.activeTab);

    return html`
      <div class="tabs">
        ${TABS.map(tab => this._renderTab(tab))}
      </div>
      <form class="search-box" @submit=${this._onSearch}>
        <input
          type="text"
          class="search-input"
          placeholder=${currentTab?.placeholder || 'Search...'}
          .value=${this._searchValue}
          @input=${this._onInput}
        >
        <button type="submit" class="search-btn">Search</button>
      </form>
    `;
  }

  _renderTab(tab) {
    const isActive = this.activeTab === tab.id;
    const { state, loaded, total } = this._getTabState(tab.id);
    const isLoaded = state === 'loaded';
    const isLoading = state === 'loading';

    let progress = 0;
    if (isLoaded) {
      progress = 100;
    } else if (isLoading && total > 0) {
      progress = (loaded / total) * 100;
    }

    return html`
      <button
        class="tab"
        data-active=${isActive}
        @click=${() => this._onTabClick(tab.id)}
      >
        <span class="tab-label">${tab.label}</span>
        <span class="tab-size">${isLoading ? this._formatBytes(loaded) + ' / ' : ''}${tab.size}</span>
        <div class="tab-progress">
          <div
            class="tab-progress-bar"
            data-loaded=${isLoaded}
            style="width: ${progress}%"
          ></div>
        </div>
      </button>
    `;
  }
}

customElements.define('search-tabs', SearchTabs);
