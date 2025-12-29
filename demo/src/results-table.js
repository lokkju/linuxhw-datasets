import { LitElement, html, css } from 'lit';
import { decodeRoaringLimit } from './roaring.js';

const PAGE_SIZE = 50;
const EDID_PREVIEW_COUNT = 5;

/**
 * Results table with compact display and paging.
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
    _currentPage: { type: Number, state: true },
    _expandedKey: { type: String, state: true },
    _expandedEdids: { type: Array, state: true },
    _expandedLoading: { type: Boolean, state: true },
    _expandedTotal: { type: Number, state: true },
  };

  static styles = css`
    :host {
      display: block;
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

    .edid-more {
      padding: 0.375rem;
      color: var(--color-text-muted, #888);
      font-size: 0.75rem;
    }

    .pagination {
      display: flex;
      align-items: center;
      justify-content: center;
      gap: 0.75rem;
      padding: 0.75rem;
      border-top: 1px solid var(--color-border, #2a2a4e);
      font-size: 0.8125rem;
    }

    .page-btn {
      padding: 0.375rem 0.75rem;
      border: 1px solid var(--color-border, #2a2a4e);
      background: transparent;
      color: var(--color-text, #eee);
      border-radius: var(--radius, 4px);
      cursor: pointer;
      font-size: 0.75rem;
      transition: background 0.1s;
    }

    .page-btn:hover:not(:disabled) {
      background: var(--color-surface, #16213e);
    }

    .page-btn:disabled {
      opacity: 0.4;
      cursor: not-allowed;
    }

    .page-info {
      color: var(--color-text-muted, #888);
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
    this._currentPage = 0;
    this._expandedKey = null;
    this._expandedEdids = [];
    this._expandedLoading = false;
    this._expandedTotal = 0;
  }

  updated(changedProps) {
    if (changedProps.has('results')) {
      this._currentPage = 0;
      this._expandedKey = null;
      this._expandedEdids = [];
    }
  }

  get _totalPages() {
    return Math.ceil(this.results.length / PAGE_SIZE);
  }

  get _pageResults() {
    const start = this._currentPage * PAGE_SIZE;
    return this.results.slice(start, start + PAGE_SIZE);
  }

  _onPrevPage() {
    if (this._currentPage > 0) {
      this._currentPage--;
    }
  }

  _onNextPage() {
    if (this._currentPage < this._totalPages - 1) {
      this._currentPage++;
    }
  }

  async _onResultClick(result) {
    if (this._expandedKey === result.key) {
      this._expandedKey = null;
      this._expandedEdids = [];
      return;
    }

    this._expandedKey = result.key;
    this._expandedEdids = [];
    this._expandedLoading = true;
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
          edids.push(entry);
        } catch (err) {
          console.warn(`Failed to load EDID at index ${globalIndex}:`, err);
        }
      }

      this._expandedEdids = edids;
    } catch (err) {
      console.error('Failed to expand result:', err);
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

    const start = this._currentPage * PAGE_SIZE + 1;
    const end = Math.min(start + PAGE_SIZE - 1, this.results.length);

    return html`
      <ul class="results-list">
        ${this._pageResults.map(result => this._renderResult(result))}
      </ul>
      ${this._totalPages > 1 ? html`
        <div class="pagination">
          <button class="page-btn" ?disabled=${this._currentPage === 0} @click=${this._onPrevPage}>Prev</button>
          <span class="page-info">${start}-${end} of ${this.results.length}</span>
          <button class="page-btn" ?disabled=${this._currentPage >= this._totalPages - 1} @click=${this._onNextPage}>Next</button>
        </div>
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

    if (this._expandedEdids.length === 0) {
      return html`<div class="expanded-content"><div class="empty">No EDID entries found.</div></div>`;
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
