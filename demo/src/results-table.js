import { LitElement, html, css } from 'lit';
import { decodeRoaringLimit, countRoaring } from './roaring.js';
import { decodeEdid } from './edid-decoder.js';

const INITIAL_LOAD = 50;
const LOAD_MORE = 25;
const EDID_INITIAL_COUNT = 20;
const EDID_LOAD_MORE = 20;

// Status event for parent components
function dispatchStatus(element, message, type = 'info') {
  element.dispatchEvent(new CustomEvent('status', {
    detail: { message, type, timestamp: Date.now() },
    bubbles: true,
    composed: true,
  }));
}

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

    .result-item:nth-child(odd) {
      background: rgba(255, 255, 255, 0.02);
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

    .result-item[data-selected="true"] > .result-btn {
      background: var(--color-primary, #0f3460);
    }

    .result-item[data-selected="true"] {
      border-left: 2px solid var(--color-accent, #e94560);
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
      margin-bottom: 0.125rem;
      background: var(--color-bg, #1a1a2e);
      border-radius: var(--radius, 4px);
      font-size: 0.8125rem;
      display: flex;
      align-items: center;
      gap: 1rem;
      cursor: pointer;
      transition: background 0.1s;
    }

    .edid-item:nth-child(odd) {
      background: rgba(0, 0, 0, 0.2);
    }

    .edid-item:hover {
      background: var(--color-primary, #0f3460);
    }

    .edid-item[data-selected="true"] {
      background: var(--color-primary, #0f3460);
      border-left: 2px solid var(--color-accent, #e94560);
    }

    .edid-item[data-error="true"] {
      border-left: 2px solid var(--color-accent, #e94560);
      opacity: 0.7;
      cursor: default;
    }

    .edid-resolution {
      min-width: 80px;
      color: var(--color-text-muted, #888);
    }

    .edid-meta {
      color: var(--color-text-muted, #888);
      font-size: 0.75rem;
      display: flex;
      gap: 0.75rem;
    }

    .edid-hash {
      font-family: ui-monospace, monospace;
      font-size: 0.8125rem;
      color: var(--color-text, #eee);
      font-weight: 500;
      min-width: 6em;
    }

    .edid-error {
      color: var(--color-accent, #e94560);
      font-size: 0.75rem;
      font-style: italic;
      flex: 1;
    }

    .retry-btn {
      padding: 0.25rem 0.5rem;
      border: 1px solid var(--color-accent, #e94560);
      background: transparent;
      color: var(--color-accent, #e94560);
      border-radius: var(--radius, 4px);
      font-size: 0.6875rem;
      cursor: pointer;
      transition: background 0.1s;
    }

    .retry-btn:hover {
      background: rgba(233, 69, 96, 0.1);
    }

    .edid-more {
      padding: 0.375rem 0.5rem;
      color: var(--color-text-muted, #888);
      font-size: 0.75rem;
    }

    .edid-more-btn {
      padding: 0.375rem 0.75rem;
      border: 1px solid var(--color-border, #2a2a4e);
      background: transparent;
      color: var(--color-text-muted, #888);
      border-radius: var(--radius, 4px);
      font-size: 0.75rem;
      cursor: pointer;
      transition: background 0.1s;
    }

    .edid-more-btn:hover {
      background: var(--color-bg, #1a1a2e);
      color: var(--color-text, #eee);
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
    this._countCache = new Map(); // key -> count
    this._selectedEdid = null; // selected EDID md5Hex
  }

  updated(changedProps) {
    if (changedProps.has('results')) {
      this._visibleCount = INITIAL_LOAD;
      this._expandedKey = null;
      this._expandedEdids = [];
      this._expandedError = null;
      this._countCache.clear();
      // Scroll to top when results change
      this.scrollTop = 0;
      // Precompute counts for visible results
      this._computeCounts();
    } else if (changedProps.has('_visibleCount')) {
      // Compute counts for newly visible results
      this._computeCounts();
    }
  }

  async _computeCounts() {
    if (!this.indexLoader) return;

    try {
      const index = await this.indexLoader.load(this.activeTab);
      for (const result of this._visibleResults) {
        if (!this._countCache.has(result.key)) {
          try {
            const bitmapBytes = index.getBitmapBytes(result);
            const count = countRoaring(bitmapBytes);
            this._countCache.set(result.key, count);
          } catch (err) {
            this._countCache.set(result.key, '?');
          }
        }
      }
      this.requestUpdate();
    } catch (err) {
      console.warn('Failed to compute counts:', err);
    }
  }

  _getCount(key) {
    return this._countCache.get(key);
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
    // Hash results are direct EDID entries - select them directly
    if (this.activeTab === 'hashes' && result._hashEntry) {
      this._selectedEdid = result._hashEntry.md5Hex;
      this.dispatchEvent(new CustomEvent('edid-select', {
        detail: { edid: result._hashEntry },
        bubbles: true,
        composed: true,
      }));
      dispatchStatus(this, `Selected EDID ${result._hashEntry.md5Hex.slice(0, 8)}`, 'info');
      return;
    }

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
    this._expandedLoadedCount = 0;
    this._currentResult = result;

    dispatchStatus(this, `Loading EDIDs for "${result.key}"...`, 'loading');

    try {
      const index = await this.indexLoader.load(this.activeTab);
      const bitmapBytes = index.getBitmapBytes(result);
      // Decode all indices (we need the count, and they're just integers)
      const indices = decodeRoaringLimit(bitmapBytes, 10000);
      this._expandedTotal = indices.length;
      this._expandedIndices = indices;

      const loadCount = Math.min(EDID_INITIAL_COUNT, indices.length);
      const edids = await this._loadEdids(indices.slice(0, loadCount));
      this._expandedEdids = edids;
      this._expandedLoadedCount = loadCount;

      const errorCount = edids.filter(e => e._error).length;
      if (errorCount > 0) {
        dispatchStatus(this, `Loaded ${edids.length - errorCount}/${edids.length} EDIDs (${errorCount} failed), ${this._expandedTotal} total`, 'warning');
      } else {
        dispatchStatus(this, `Loaded ${edids.length} of ${this._expandedTotal} EDIDs`, 'success');
      }
    } catch (err) {
      console.error('Failed to expand result:', err);
      this._expandedError = err.message || 'Failed to load EDID data';
      dispatchStatus(this, `Error: ${this._expandedError}`, 'error');
    } finally {
      this._expandedLoading = false;
    }
  }

  async _loadMoreEdids() {
    if (this._expandedLoadedCount >= this._expandedTotal) return;

    const startIdx = this._expandedLoadedCount;
    const endIdx = Math.min(startIdx + EDID_LOAD_MORE, this._expandedTotal);

    dispatchStatus(this, `Loading more EDIDs (${startIdx + 1}-${endIdx} of ${this._expandedTotal})...`, 'loading');

    const moreEdids = await this._loadEdids(this._expandedIndices.slice(startIdx, endIdx));
    this._expandedEdids = [...this._expandedEdids, ...moreEdids];
    this._expandedLoadedCount = endIdx;

    const errorCount = moreEdids.filter(e => e._error).length;
    if (errorCount > 0) {
      dispatchStatus(this, `Loaded ${moreEdids.length - errorCount}/${moreEdids.length} more EDIDs (${errorCount} failed)`, 'warning');
    } else {
      dispatchStatus(this, `Loaded ${this._expandedLoadedCount} of ${this._expandedTotal} EDIDs`, 'success');
    }
  }

  async _loadEdids(indices) {
    const edids = [];
    for (const globalIndex of indices) {
      try {
        dispatchStatus(this, `Loading bucket for index ${globalIndex}...`, 'loading');
        const entry = await this.bucketLoader.getByGlobalIndex(globalIndex);
        edids.push({ ...entry, _error: null, _globalIndex: globalIndex });
      } catch (err) {
        edids.push({
          _error: err.message || 'Failed to load',
          _globalIndex: globalIndex,
          md5Hex: `index-${globalIndex}`,
        });
      }
    }
    return edids;
  }

  async _retryEdid(globalIndex, listIndex) {
    dispatchStatus(this, `Retrying index ${globalIndex}...`, 'loading');
    try {
      const entry = await this.bucketLoader.getByGlobalIndex(globalIndex);
      // Update the specific entry in the list
      this._expandedEdids = this._expandedEdids.map((edid, i) =>
        i === listIndex ? { ...entry, _error: null, _globalIndex: globalIndex } : edid
      );
      dispatchStatus(this, `Successfully loaded index ${globalIndex}`, 'success');
    } catch (err) {
      dispatchStatus(this, `Retry failed: ${err.message}`, 'error');
    }
  }

  _onEdidSelect(edid) {
    if (edid._error) return; // Can't select errored entries

    this._selectedEdid = edid.md5Hex;
    this.dispatchEvent(new CustomEvent('edid-select', {
      detail: { edid },
      bubbles: true,
      composed: true,
    }));
    dispatchStatus(this, `Selected EDID ${edid.md5Hex.slice(0, 8)}`, 'info');
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
    // Hash results are direct EDID entries - render differently
    if (this.activeTab === 'hashes' && result._hashEntry) {
      const isSelected = this._selectedEdid === result._hashEntry.md5Hex;
      const decoded = result._hashEntry.rawEdid ? decodeEdid(result._hashEntry.rawEdid) : {};

      return html`
        <li class="result-item" data-selected=${isSelected}>
          <button class="result-btn" @click=${() => this._onResultClick(result)}>
            <span class="result-key">${result.key}</span>
            <span class="result-count">${decoded.manufacturerId || ''} ${decoded.monitorName || ''}</span>
          </button>
        </li>
      `;
    }

    const isExpanded = this._expandedKey === result.key;
    const count = this._getCount(result.key);

    return html`
      <li class="result-item">
        <button class="result-btn" @click=${() => this._onResultClick(result)}>
          <span class="result-arrow" data-expanded=${isExpanded}>&#9654;</span>
          <span class="result-key">${result.key}</span>
          ${count !== undefined ? html`<span class="result-count">(${count})</span>` : ''}
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

    const hasMore = this._expandedLoadedCount < this._expandedTotal;
    const remaining = this._expandedTotal - this._expandedLoadedCount;

    return html`
      <div class="expanded-content">
        <ul class="edid-list">
          ${this._expandedEdids.map((edid, i) => this._renderEdid(edid, i))}
        </ul>
        ${hasMore ? html`
          <div class="edid-more">
            <button class="edid-more-btn" @click=${this._loadMoreEdids}>
              Load more (${remaining} remaining)
            </button>
          </div>
        ` : ''}
      </div>
    `;
  }

  _renderEdid(edid, index) {
    // Handle error case
    if (edid._error) {
      return html`
        <li class="edid-item" data-error="true">
          <span class="edid-hash">#${edid._globalIndex}</span>
          <span class="edid-error">Failed: ${edid._error}</span>
          <button class="retry-btn" @click=${(e) => { e.stopPropagation(); this._retryEdid(edid._globalIndex, index); }}>Retry</button>
        </li>
      `;
    }

    // Decode EDID for display fields
    const decoded = edid.rawEdid ? decodeEdid(edid.rawEdid) : {};

    const resolution = decoded.preferredResolution
      ? `${decoded.preferredResolution.width}x${decoded.preferredResolution.height}`
      : '?';

    const size = decoded.screenSizeCm?.widthCm && decoded.screenSizeCm?.heightCm
      ? `${Math.round(Math.sqrt(decoded.screenSizeCm.widthCm**2 + decoded.screenSizeCm.heightCm**2) / 2.54)}"`
      : '';

    const isSelected = this._selectedEdid === edid.md5Hex;

    // Format: hash | resolution | size | year | type
    return html`
      <li
        class="edid-item"
        data-selected=${isSelected}
        @click=${() => this._onEdidSelect(edid)}
      >
        <span class="edid-hash">${edid.md5Hex.slice(0, 8)}</span>
        <span class="edid-resolution">${resolution}</span>
        <span class="edid-meta">
          ${size ? html`<span>${size}</span>` : ''}
          ${decoded.manufactureYear ? html`<span>${decoded.manufactureYear}</span>` : ''}
          <span>${decoded.videoInput?.digital ? 'digital' : (decoded.videoInput?.digital === false ? 'analog' : '?')}</span>
        </span>
      </li>
    `;
  }
}

customElements.define('results-table', ResultsTable);
