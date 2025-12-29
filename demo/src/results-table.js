import { LitElement, html, css } from 'lit';
import { decodeRoaringLimit } from './roaring.js';

const INITIAL_LOAD = 50;
const LOAD_MORE = 25;
const EDID_PREVIEW_COUNT = 5;

/**
 * Results table with infinite scroll.
 * Shows matching index entries and allows drilling down to individual EDIDs.
 */
export class ResultsTable extends LitElement {
  static properties = {
    results: { type: Array },
    isLoading: { type: Boolean },
    isLoadingIndex: { type: Boolean },
    indexLoader: { type: Object },
    bucketLoader: { type: Object },
    activeTab: { type: String },
    _visibleCount: { type: Number, state: true },
    _expandedKey: { type: String, state: true },
    _expandedEdids: { type: Array, state: true },
    _expandedLoading: { type: Boolean, state: true },
    _expandedError: { type: String, state: true },
    _expandedTotal: { type: Number, state: true },
  };

  static styles = css`
    :host {
      display: block;
      height: 100%;
    }

    .loading, .empty {
      display: flex;
      align-items: center;
      justify-content: center;
      padding: 2rem;
      color: var(--color-text-muted, #888);
      font-size: 0.875rem;
    }

    .spinner {
      width: 16px;
      height: 16px;
      border: 2px solid var(--color-primary, #0f3460);
      border-top-color: var(--color-accent, #e94560);
      border-radius: 50%;
      animation: spin 0.8s linear infinite;
      margin-right: 0.5rem;
    }

    @keyframes spin {
      to { transform: rotate(360deg); }
    }

    .results-list {
      list-style: none;
      margin: 0;
      padding: 0;
    }

    .result-item {
      border-bottom: 1px solid var(--color-border, #2a2a4e);
    }

    .result-btn {
      width: 100%;
      padding: 0.625rem 1rem;
      border: none;
      background: transparent;
      color: var(--color-text, #eee);
      text-align: left;
      cursor: pointer;
      font-size: 0.875rem;
      transition: background 0.1s;
      display: flex;
      align-items: center;
      gap: 0.5rem;
    }

    .result-btn:hover {
      background: var(--color-surface, #16213e);
    }

    .result-arrow {
      font-size: 0.625rem;
      color: var(--color-text-muted, #888);
      transition: transform 0.15s;
    }

    .result-arrow[data-expanded="true"] {
      transform: rotate(90deg);
    }

    .result-key {
      flex: 1;
      font-family: ui-monospace, monospace;
    }

    .result-count {
      font-size: 0.75rem;
      color: var(--color-text-muted, #888);
    }

    .expanded-content {
      background: var(--color-surface, #16213e);
      padding: 0.5rem 1rem 0.5rem 2rem;
      border-top: 1px solid var(--color-border, #2a2a4e);
    }

    .edid-list {
      list-style: none;
      margin: 0;
      padding: 0;
    }

    .edid-item {
      padding: 0.5rem;
      margin-bottom: 0.25rem;
      background: var(--color-bg, #1a1a2e);
      border-radius: var(--radius, 4px);
      font-size: 0.8125rem;
      display: flex;
      align-items: center;
      gap: 1rem;
    }

    .edid-item[data-error="true"] {
      border-left: 2px solid var(--color-accent, #e94560);
      opacity: 0.7;
    }

    .edid-resolution {
      font-weight: 500;
      min-width: 80px;
    }

    .edid-meta {
      color: var(--color-text-muted, #888);
      font-size: 0.75rem;
      display: flex;
      gap: 0.75rem;
    }

    .edid-hash {
      font-family: ui-monospace, monospace;
      font-size: 0.6875rem;
      color: var(--color-text-muted, #888);
      margin-left: auto;
    }

    .edid-error {
      color: var(--color-accent, #e94560);
      font-size: 0.75rem;
      font-style: italic;
    }

    .edid-more {
      padding: 0.375rem;
      color: var(--color-text-muted, #888);
      font-size: 0.75rem;
    }

    .error-banner {
      padding: 0.5rem;
      margin-bottom: 0.5rem;
      background: rgba(233, 69, 96, 0.1);
      border: 1px solid var(--color-accent, #e94560);
      border-radius: var(--radius, 4px);
      color: var(--color-accent, #e94560);
      font-size: 0.75rem;
    }

    .load-more {
      padding: 1rem;
      text-align: center;
      color: var(--color-text-muted, #888);
      font-size: 0.75rem;
    }

    .load-trigger {
      height: 1px;
    }

    .results-count {
      padding: 0.5rem 1rem;
      font-size: 0.75rem;
      color: var(--color-text-muted, #888);
      border-bottom: 1px solid var(--color-border, #2a2a4e);
    }
  `;

  constructor() {
    super();
    this.results = [];
    this.isLoading = false;
    this.isLoadingIndex = false;
    this.indexLoader = null;
    this.bucketLoader = null;
    this.activeTab = 'products';
    this._visibleCount = INITIAL_LOAD;
    this._expandedKey = null;
    this._expandedEdids = [];
    this._expandedLoading = false;
    this._expandedError = null;
    this._expandedTotal = 0;
    this._observer = null;
  }

  updated(changedProps) {
    if (changedProps.has('results')) {
      this._visibleCount = INITIAL_LOAD;
      this._expandedKey = null;
      this._expandedEdids = [];
      this._expandedError = null;
    }
  }

  firstUpdated() {
    this._setupIntersectionObserver();
  }

  disconnectedCallback() {
    super.disconnectedCallback();
    if (this._observer) {
      this._observer.disconnect();
    }
  }

  _setupIntersectionObserver() {
    this._observer = new IntersectionObserver(
      (entries) => {
        if (entries[0].isIntersecting && this._visibleCount < this.results.length) {
          this._visibleCount = Math.min(this._visibleCount + LOAD_MORE, this.results.length);
        }
      },
      { rootMargin: '100px' }
    );
  }

  _observeLoadTrigger() {
    if (this._observer) {
      const trigger = this.shadowRoot?.querySelector('.load-trigger');
      if (trigger) {
        this._observer.disconnect();
        this._observer.observe(trigger);
      }
    }
  }

  get _visibleResults() {
    return this.results.slice(0, this._visibleCount);
  }

  async _onResultClick(result) {
    if (this._expandedKey === result.key) {
      this._expandedKey = null;
      this._expandedEdids = [];
      this._expandedError = null;
      return;
    }

    this._expandedKey = result.key;
    this._expandedEdids = [];
    this._expandedLoading = true;
    this._expandedError = null;
    this._expandedTotal = 0;

    try {
      const index = await this.indexLoader.load(this.activeTab);
      const bitmapBytes = index.getBitmapBytes(result);
      const indices = decodeRoaringLimit(bitmapBytes, EDID_PREVIEW_COUNT + 1);
      this._expandedTotal = indices.length > EDID_PREVIEW_COUNT ? 'many' : indices.length;

      const edids = [];
      for (const globalIndex of indices.slice(0, EDID_PREVIEW_COUNT)) {
        try {
          const entry = await this.bucketLoader.getByGlobalIndex(globalIndex);
          edids.push({ ...entry, _error: null });
        } catch (err) {
          // Track the error but still show the entry
          edids.push({
            _error: err.message || 'Failed to load',
            _globalIndex: globalIndex,
            md5Hex: `index-${globalIndex}`,
          });
        }
      }

      this._expandedEdids = edids;
    } catch (err) {
      console.error('Failed to expand result:', err);
      this._expandedError = err.message || 'Failed to load EDID data';
    } finally {
      this._expandedLoading = false;
    }
  }

  render() {
    if (this.isLoadingIndex) {
      return html`<div class="loading"><div class="spinner"></div>Loading index...</div>`;
    }

    if (this.isLoading) {
      return html`<div class="loading"><div class="spinner"></div>Searching...</div>`;
    }

    if (this.results.length === 0) {
      return html`<div class="empty">No results. Try searching above.</div>`;
    }

    const hasMore = this._visibleCount < this.results.length;

    // Schedule observer setup after render
    this.updateComplete.then(() => this._observeLoadTrigger());

    return html`
      <div class="results-count">${this.results.length} results</div>
      <ul class="results-list">
        ${this._visibleResults.map(result => this._renderResult(result))}
      </ul>
      ${hasMore ? html`
        <div class="load-more">
          <div class="spinner" style="display: inline-block; vertical-align: middle;"></div>
          Loading more...
        </div>
        <div class="load-trigger"></div>
      ` : ''}
    `;
  }

  _renderResult(result) {
    const isExpanded = this._expandedKey === result.key;

    return html`
      <li class="result-item">
        <button class="result-btn" @click=${() => this._onResultClick(result)}>
          <span class="result-arrow" data-expanded=${isExpanded}>&#9654;</span>
          <span class="result-key">${result.key}</span>
        </button>
        ${isExpanded ? this._renderExpanded() : ''}
      </li>
    `;
  }

  _renderExpanded() {
    if (this._expandedLoading) {
      return html`<div class="expanded-content"><div class="loading"><div class="spinner"></div>Loading...</div></div>`;
    }

    if (this._expandedError) {
      return html`
        <div class="expanded-content">
          <div class="error-banner">Error: ${this._expandedError}</div>
        </div>
      `;
    }

    if (this._expandedEdids.length === 0) {
      return html`<div class="expanded-content"><div class="empty">No EDID entries in bitmap.</div></div>`;
    }

    return html`
      <div class="expanded-content">
        <ul class="edid-list">
          ${this._expandedEdids.map(edid => this._renderEdid(edid))}
        </ul>
        ${this._expandedTotal === 'many' || this._expandedTotal > EDID_PREVIEW_COUNT ? html`
          <div class="edid-more">+ more...</div>
        ` : ''}
      </div>
    `;
  }

  _renderEdid(edid) {
    // Handle error case
    if (edid._error) {
      return html`
        <li class="edid-item" data-error="true">
          <span class="edid-error">Failed to load: ${edid._error}</span>
          <span class="edid-hash">#${edid._globalIndex}</span>
        </li>
      `;
    }

    const resolution = edid.widthPx && edid.heightPx
      ? `${edid.widthPx}x${edid.heightPx}`
      : '?';

    const size = edid.widthMm && edid.heightMm
      ? `${Math.round(Math.sqrt(edid.widthMm**2 + edid.heightMm**2) / 25.4)}"`
      : '';

    return html`
      <li class="edid-item">
        <span class="edid-resolution">${resolution}</span>
        <span class="edid-meta">
          ${edid.year ? html`<span>${edid.year}</span>` : ''}
          ${size ? html`<span>${size}</span>` : ''}
          <span>${edid.displayType}</span>
        </span>
        <span class="edid-hash">${edid.md5Hex.slice(0, 8)}</span>
      </li>
    `;
  }
}

customElements.define('results-table', ResultsTable);
