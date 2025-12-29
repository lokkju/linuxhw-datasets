import { LitElement, html, css } from 'lit';

const TABS = [
  { id: 'products', label: 'Products', placeholder: 'e.g., U2412M, 27GL850' },
  { id: 'vendors', label: 'Vendors', placeholder: 'e.g., Dell, Samsung' },
  { id: 'codes', label: 'PNP Codes', placeholder: 'e.g., DEL01101, SAM0A7C' },
  { id: 'sizes', label: 'Sizes', placeholder: 'e.g., 27, 32' },
  { id: 'paths', label: 'Paths', placeholder: 'e.g., Digital/Dell, Analog' },
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
    _suggestions: { type: Array, state: true },
    _showSuggestions: { type: Boolean, state: true },
    _selectedIndex: { type: Number, state: true },
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

    .search-container {
      position: relative;
      flex: 1;
    }

    .suggestions {
      position: absolute;
      top: 100%;
      left: 0;
      right: 0;
      margin-top: 4px;
      background: var(--color-surface, #16213e);
      border: 1px solid var(--color-border, #2a2a4e);
      border-radius: var(--radius, 4px);
      max-height: 300px;
      overflow-y: auto;
      z-index: 100;
      box-shadow: 0 4px 12px rgba(0, 0, 0, 0.3);
    }

    .suggestion {
      padding: 0.5rem 0.75rem;
      cursor: pointer;
      display: flex;
      justify-content: space-between;
      align-items: center;
      font-size: 0.875rem;
    }

    .suggestion:hover,
    .suggestion[data-selected="true"] {
      background: var(--color-primary, #0f3460);
    }

    .suggestion-text {
      color: var(--color-text, #eee);
    }

    .suggestion-match {
      color: var(--color-accent, #e94560);
      font-weight: 600;
    }

    .suggestion-count {
      color: var(--color-text-muted, #888);
      font-size: 0.75rem;
    }

    .no-suggestions {
      padding: 0.5rem 0.75rem;
      color: var(--color-text-muted, #888);
      font-size: 0.875rem;
      font-style: italic;
    }
  `;

  constructor() {
    super();
    this.activeTab = 'products';
    this._loadingStates = {};
    this._searchValue = '';
    this._unsubscribe = null;
    this._suggestions = [];
    this._showSuggestions = false;
    this._selectedIndex = -1;
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
      this._suggestions = [];
      this._showSuggestions = false;
      this._selectedIndex = -1;
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
    this._selectedIndex = -1;

    // Debounce autocomplete search
    if (this._debounceTimer) {
      clearTimeout(this._debounceTimer);
    }

    if (this._searchValue.length < 2) {
      this._suggestions = [];
      this._showSuggestions = false;
      return;
    }

    this._debounceTimer = setTimeout(() => this._fetchSuggestions(), 150);
  }

  async _fetchSuggestions() {
    if (!this.indexLoader || this._searchValue.length < 2) {
      this._suggestions = [];
      this._showSuggestions = false;
      return;
    }

    try {
      const index = await this.indexLoader.load(this.activeTab);
      const matches = index.search(this._searchValue);
      // Limit to top 10 suggestions
      this._suggestions = matches.slice(0, 10);
      this._showSuggestions = true;
    } catch (err) {
      console.error('Autocomplete error:', err);
      this._suggestions = [];
      this._showSuggestions = false;
    }
  }

  _onKeyDown(e) {
    if (!this._showSuggestions || this._suggestions.length === 0) {
      return;
    }

    switch (e.key) {
      case 'ArrowDown':
        e.preventDefault();
        this._selectedIndex = Math.min(this._selectedIndex + 1, this._suggestions.length - 1);
        break;
      case 'ArrowUp':
        e.preventDefault();
        this._selectedIndex = Math.max(this._selectedIndex - 1, -1);
        break;
      case 'Enter':
        if (this._selectedIndex >= 0) {
          e.preventDefault();
          this._selectSuggestion(this._suggestions[this._selectedIndex]);
        }
        break;
      case 'Escape':
        this._showSuggestions = false;
        this._selectedIndex = -1;
        break;
    }
  }

  _selectSuggestion(suggestion) {
    this._searchValue = suggestion.key;
    this._showSuggestions = false;
    this._selectedIndex = -1;
    // Trigger the search
    this.dispatchEvent(new CustomEvent('search', {
      detail: { tab: this.activeTab, query: this._searchValue },
      bubbles: true,
      composed: true,
    }));
  }

  _onFocus() {
    if (this._searchValue.length >= 2 && this._suggestions.length > 0) {
      this._showSuggestions = true;
    }
  }

  _onBlur() {
    // Delay hiding to allow click on suggestion
    setTimeout(() => {
      this._showSuggestions = false;
      this._selectedIndex = -1;
    }, 200);
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
        <div class="search-container">
          <input
            type="text"
            class="search-input"
            placeholder=${currentTab?.placeholder || 'Search...'}
            .value=${this._searchValue}
            @input=${this._onInput}
            @keydown=${this._onKeyDown}
            @focus=${this._onFocus}
            @blur=${this._onBlur}
            autocomplete="off"
          >
          ${this._showSuggestions ? this._renderSuggestions() : ''}
        </div>
        <button type="submit" class="search-btn">Search</button>
      </form>
    `;
  }

  _renderSuggestions() {
    if (this._suggestions.length === 0) {
      return html`
        <div class="suggestions">
          <div class="no-suggestions">No matches found</div>
        </div>
      `;
    }

    return html`
      <div class="suggestions">
        ${this._suggestions.map((s, i) => this._renderSuggestion(s, i))}
      </div>
    `;
  }

  _renderSuggestion(suggestion, index) {
    const query = this._searchValue.toLowerCase();
    const key = suggestion.key;
    const lowerKey = key.toLowerCase();
    const matchStart = lowerKey.indexOf(query);

    let display;
    if (matchStart >= 0) {
      const before = key.slice(0, matchStart);
      const match = key.slice(matchStart, matchStart + query.length);
      const after = key.slice(matchStart + query.length);
      display = html`${before}<span class="suggestion-match">${match}</span>${after}`;
    } else {
      display = key;
    }

    return html`
      <div
        class="suggestion"
        data-selected=${index === this._selectedIndex}
        @mousedown=${() => this._selectSuggestion(suggestion)}
      >
        <span class="suggestion-text">${display}</span>
        <span class="suggestion-count">${suggestion.count?.toLocaleString() || ''}</span>
      </div>
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
