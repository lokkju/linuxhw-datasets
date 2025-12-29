import { LitElement, html, css } from 'lit';

const TABS = [
  { id: 'products', label: 'Products', placeholder: 'e.g., U2412M, 27GL850' },
  { id: 'vendors', label: 'Vendors', placeholder: 'e.g., Dell, Samsung' },
  { id: 'codes', label: 'PNP Codes', placeholder: 'e.g., DEL01101, SAM0A7C' },
  { id: 'sizes', label: 'Sizes', placeholder: 'e.g., 27, 32' },
  { id: 'paths', label: 'Paths', placeholder: 'e.g., Digital/Dell, Analog' },
  { id: 'hashes', label: 'Hash', placeholder: 'e.g., a3f2, 00ff (hex prefix)' },
];

/**
 * Search tabs component with traditional underline-style tabs.
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

    .tabs-row {
      display: flex;
      align-items: center;
      border-bottom: 1px solid var(--color-border, #2a2a4e);
      margin-bottom: 0.75rem;
    }

    .tabs-label {
      color: var(--color-text-muted, #888);
      font-size: 0.75rem;
      padding: 0.5rem 0.75rem 0.5rem 0;
      white-space: nowrap;
    }

    .tabs {
      display: flex;
    }

    .tab {
      padding: 0.5rem 1rem;
      border: none;
      background: transparent;
      color: var(--color-text-muted, #888);
      font-size: 0.8125rem;
      cursor: pointer;
      position: relative;
      transition: color 0.15s;
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
      bottom: -9px;
      left: 0;
      right: 0;
      height: 2px;
      background: var(--color-accent, #e94560);
    }

    .tab-progress {
      display: inline-block;
      width: 6px;
      height: 6px;
      margin-left: 0.375rem;
      border-radius: 50%;
      vertical-align: middle;
    }

    .tab-progress[data-state="loading"] {
      background: var(--color-accent, #e94560);
      animation: pulse 1s ease-in-out infinite;
    }

    .tab-progress[data-state="loaded"] {
      background: #4ade80;
    }

    @keyframes pulse {
      0%, 100% { opacity: 1; }
      50% { opacity: 0.4; }
    }

    .search-row {
      display: flex;
      gap: 0.5rem;
    }

    .search-input {
      flex: 1;
      padding: 0.5rem 0.75rem;
      border: 1px solid var(--color-border, #2a2a4e);
      background: var(--color-surface, #16213e);
      color: var(--color-text, #eee);
      border-radius: var(--radius, 4px);
      font-size: 0.875rem;
      outline: none;
      transition: border-color 0.15s;
    }

    .search-input:focus {
      border-color: var(--color-accent, #e94560);
    }

    .search-input::placeholder {
      color: var(--color-text-muted, #888);
    }

    .search-btn {
      padding: 0.5rem 1rem;
      border: none;
      background: var(--color-accent, #e94560);
      color: white;
      border-radius: var(--radius, 4px);
      font-size: 0.875rem;
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
    this._debounceTimer = null;
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

    this._unsubscribe = this.indexLoader.onProgress((name, loaded, total, done) => {
      this._loadingStates = {
        ...this._loadingStates,
        [name]: { loaded, total, state: done ? 'loaded' : 'loading' },
      };
    });
  }

  _getTabState(tabId) {
    if (!this.indexLoader) return 'idle';

    const localState = this._loadingStates[tabId];
    if (localState) return localState.state;

    const state = this.indexLoader.getState(tabId);
    return state;
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

    // Debounce search
    if (this._debounceTimer) {
      clearTimeout(this._debounceTimer);
    }

    this._debounceTimer = setTimeout(() => {
      this.dispatchEvent(new CustomEvent('search', {
        detail: { tab: this.activeTab, query: this._searchValue },
        bubbles: true,
        composed: true,
      }));
    }, 150);
  }

  render() {
    const currentTab = TABS.find(t => t.id === this.activeTab);

    return html`
      <div class="tabs-row">
        <span class="tabs-label">Search by</span>
        <div class="tabs">
          ${TABS.map(tab => this._renderTab(tab))}
        </div>
      </div>
      <form class="search-row" @submit=${this._onSearch}>
        <input
          type="text"
          class="search-input"
          placeholder=${currentTab?.placeholder || 'Filter...'}
          .value=${this._searchValue}
          @input=${this._onInput}
        >
        <button type="submit" class="search-btn">Search</button>
      </form>
    `;
  }

  _renderTab(tab) {
    const isActive = this.activeTab === tab.id;
    const state = this._getTabState(tab.id);
    const showIndicator = state === 'loading' || state === 'loaded';

    return html`
      <button
        class="tab"
        data-active=${isActive}
        @click=${() => this._onTabClick(tab.id)}
      >
        ${tab.label}${showIndicator ? html`<span class="tab-progress" data-state=${state}></span>` : ''}
      </button>
    `;
  }
}

customElements.define('search-tabs', SearchTabs);
