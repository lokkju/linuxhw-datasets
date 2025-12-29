import { LitElement, html, css } from 'lit';

const PAGE_SIZE = 25;

/**
 * Results table with paging.
 * Shows matching index entries and allows drilling down to individual EDIDs.
 */
export class ResultsTable extends LitElement {
  static properties = {
    results: { type: Array },
    isLoading: { type: Boolean },
    baseUrl: { type: String },
    _currentPage: { type: Number, state: true },
    _expandedKey: { type: String, state: true },
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

    .result-meta {
      font-size: 0.875rem;
      color: var(--color-text-muted);
    }

    .result-arrow {
      transition: transform 0.15s;
    }

    .result-arrow[data-expanded="true"] {
      transform: rotate(90deg);
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
    this.baseUrl = '../data/';
    this._currentPage = 0;
    this._expandedKey = null;
  }

  updated(changedProps) {
    if (changedProps.has('results')) {
      this._currentPage = 0;
      this._expandedKey = null;
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

  _onResultClick(result) {
    this._expandedKey = this._expandedKey === result.key ? null : result.key;
    // TODO: Load and display EDIDs for this key using the Roaring bitmap
  }

  render() {
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
      </li>
    `;
  }
}

customElements.define('results-table', ResultsTable);
