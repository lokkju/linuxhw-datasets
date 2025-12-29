import { LitElement, html, css } from 'lit';
import { decodeRoaringLimit } from './roaring.js';

const PAGE_SIZE = 25;
const EDID_PREVIEW_COUNT = 5;

/**
 * Results table with paging.
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

    .loading {
      display: flex;
      align-items: center;
      justify-content: center;
      padding: 3rem;
      color: var(--color-text-muted);
    }

    .spinner {
      width: 24px;
      height: 24px;
      border: 2px solid var(--color-primary);
      border-top-color: var(--color-accent);
      border-radius: 50%;
      animation: spin 0.8s linear infinite;
      margin-right: 0.75rem;
    }

    @keyframes spin {
      to { transform: rotate(360deg); }
    }

    .empty {
      padding: 3rem;
      text-align: center;
      color: var(--color-text-muted);
    }

    .results-list {
      list-style: none;
      margin: 0;
      padding: 0;
    }

    .result-item {
      border-bottom: 1px solid var(--color-primary);
    }

    .result-item:last-child {
      border-bottom: none;
    }

    .result-btn {
      width: 100%;
      padding: 1rem;
      border: none;
      background: transparent;
      color: var(--color-text);
      text-align: left;
      cursor: pointer;
      font-size: 1rem;
      transition: background 0.15s;
      display: flex;
      align-items: center;
      justify-content: space-between;
    }

    .result-btn:hover {
      background: var(--color-primary);
    }

    .result-key {
      font-weight: 500;
    }

    .result-arrow {
      transition: transform 0.15s;
    }

    .result-arrow[data-expanded="true"] {
      transform: rotate(90deg);
    }

    .expanded-content {
      background: var(--color-bg);
      padding: 1rem;
      border-top: 1px solid var(--color-primary);
    }

    .edid-list {
      list-style: none;
      margin: 0;
      padding: 0;
    }

    .edid-item {
      padding: 0.75rem;
      margin-bottom: 0.5rem;
      background: var(--color-surface);
      border-radius: var(--radius);
      font-size: 0.875rem;
    }

    .edid-header {
      display: flex;
      justify-content: space-between;
      margin-bottom: 0.5rem;
    }

    .edid-hash {
      font-family: monospace;
      color: var(--color-text-muted);
      font-size: 0.75rem;
    }

    .edid-resolution {
      color: var(--color-accent);
      font-weight: 500;
    }

    .edid-details {
      display: flex;
      gap: 1rem;
      color: var(--color-text-muted);
      font-size: 0.75rem;
    }

    .edid-more {
      text-align: center;
      padding: 0.5rem;
      color: var(--color-text-muted);
      font-size: 0.875rem;
    }

    .pagination {
      display: flex;
      align-items: center;
      justify-content: center;
      gap: 1rem;
      padding: 1rem;
      border-top: 1px solid var(--color-primary);
    }

    .page-btn {
      padding: 0.5rem 1rem;
      border: none;
      background: var(--color-primary);
      color: var(--color-text);
      border-radius: var(--radius);
      cursor: pointer;
      transition: background 0.15s;
    }

    .page-btn:hover:not(:disabled) {
      background: var(--color-accent);
    }

    .page-btn:disabled {
      opacity: 0.5;
      cursor: not-allowed;
    }

    .page-info {
      color: var(--color-text-muted);
      font-size: 0.875rem;
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
      // Collapse
      this._expandedKey = null;
      this._expandedEdids = [];
      return;
    }

    // Expand and load EDIDs
    this._expandedKey = result.key;
    this._expandedEdids = [];
    this._expandedLoading = true;
    this._expandedTotal = 0;

    try {
      // Get the index for bitmap data
      const index = await this.indexLoader.load(this.activeTab);

      // Get bitmap bytes for this result
      const bitmapBytes = index.getBitmapBytes(result);

      // Decode bitmap to get global indices (limit to preview count + 1 to know if there are more)
      const indices = decodeRoaringLimit(bitmapBytes, EDID_PREVIEW_COUNT + 1);
      this._expandedTotal = indices.length > EDID_PREVIEW_COUNT ? 'many' : indices.length;

      // Load EDID entries for first few indices
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
      return html`
        <div class="loading">
          <div class="spinner"></div>
          Loading index...
        </div>
      `;
    }

    if (this.isLoading) {
      return html`
        <div class="loading">
          <div class="spinner"></div>
          Searching...
        </div>
      `;
    }

    if (this.results.length === 0) {
      return html`
        <div class="empty">
          No results. Try searching for a product name, vendor, or code.
        </div>
      `;
    }

    const start = this._currentPage * PAGE_SIZE + 1;
    const end = Math.min(start + PAGE_SIZE - 1, this.results.length);

    return html`
      <ul class="results-list">
        ${this._pageResults.map(result => this._renderResult(result))}
      </ul>
      ${this._totalPages > 1 ? html`
        <div class="pagination">
          <button
            class="page-btn"
            ?disabled=${this._currentPage === 0}
            @click=${this._onPrevPage}
          >
            Previous
          </button>
          <span class="page-info">
            ${start}-${end} of ${this.results.length}
          </span>
          <button
            class="page-btn"
            ?disabled=${this._currentPage >= this._totalPages - 1}
            @click=${this._onNextPage}
          >
            Next
          </button>
        </div>
      ` : ''}
    `;
  }

  _renderResult(result) {
    const isExpanded = this._expandedKey === result.key;

    return html`
      <li class="result-item">
        <button class="result-btn" @click=${() => this._onResultClick(result)}>
          <span class="result-key">${result.key}</span>
          <span class="result-arrow" data-expanded=${isExpanded}>▶</span>
        </button>
        ${isExpanded ? this._renderExpanded() : ''}
      </li>
    `;
  }

  _renderExpanded() {
    if (this._expandedLoading) {
      return html`
        <div class="expanded-content">
          <div class="loading">
            <div class="spinner"></div>
            Loading EDIDs...
          </div>
        </div>
      `;
    }

    if (this._expandedEdids.length === 0) {
      return html`
        <div class="expanded-content">
          <div class="empty">No EDID entries found.</div>
        </div>
      `;
    }

    return html`
      <div class="expanded-content">
        <ul class="edid-list">
          ${this._expandedEdids.map(edid => this._renderEdid(edid))}
        </ul>
        ${this._expandedTotal === 'many' || this._expandedTotal > EDID_PREVIEW_COUNT ? html`
          <div class="edid-more">
            + more EDIDs...
          </div>
        ` : ''}
      </div>
    `;
  }

  _renderEdid(edid) {
    const resolution = edid.widthPx && edid.heightPx
      ? `${edid.widthPx}x${edid.heightPx}`
      : 'Unknown resolution';

    const size = edid.widthMm && edid.heightMm
      ? `${Math.round(Math.sqrt(edid.widthMm**2 + edid.heightMm**2) / 25.4)}"`
      : '';

    return html`
      <li class="edid-item">
        <div class="edid-header">
          <span class="edid-resolution">${resolution}</span>
          <span class="edid-hash">${edid.md5Hex.slice(0, 12)}...</span>
        </div>
        <div class="edid-details">
          ${edid.year ? html`<span>Year: ${edid.year}</span>` : ''}
          ${size ? html`<span>Size: ${size}</span>` : ''}
          <span>${edid.displayType}</span>
          <span>${edid.rawEdid.length} bytes</span>
        </div>
      </li>
    `;
  }
}

customElements.define('results-table', ResultsTable);
