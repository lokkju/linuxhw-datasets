/**
 * Loads and parses packed index files (.idx) with progress tracking.
 *
 * Index file format (EIDX):
 *   Header (16 bytes): magic(4) + version(2) + count(4) + reserved(6)
 *   Entry table (12 bytes each): string_offset(4) + string_len(2) + bitmap_offset(4) + bitmap_len(2)
 *   Strings section: UTF-8 packed
 *   Bitmaps section: Roaring bitmaps packed
 */
export class IndexLoader {
  constructor(baseUrl) {
    this.baseUrl = baseUrl;
    this.indexes = new Map(); // name -> ParsedIndex
    this.loading = new Map(); // name -> Promise
    this.progress = new Map(); // name -> { loaded, total }
    this.listeners = new Set();
  }

  /** Subscribe to progress updates. Callback: (name, loaded, total, done) */
  onProgress(callback) {
    this.listeners.add(callback);
    return () => this.listeners.delete(callback);
  }

  _notifyProgress(name, loaded, total, done = false) {
    this.progress.set(name, { loaded, total });
    for (const cb of this.listeners) {
      cb(name, loaded, total, done);
    }
  }

  /** Get current loading state for an index */
  getState(name) {
    if (this.indexes.has(name)) return 'loaded';
    if (this.loading.has(name)) return 'loading';
    return 'idle';
  }

  /** Get progress for an index */
  getProgress(name) {
    return this.progress.get(name) || { loaded: 0, total: 0 };
  }

  /** Load an index by name (vendors, products, codes, sizes) */
  async load(name) {
    // Already loaded
    if (this.indexes.has(name)) {
      return this.indexes.get(name);
    }

    // Already loading
    if (this.loading.has(name)) {
      return this.loading.get(name);
    }

    // Start loading
    const promise = this._fetchAndParse(name);
    this.loading.set(name, promise);

    try {
      const index = await promise;
      this.indexes.set(name, index);
      // Notify completion
      const progress = this.progress.get(name) || { loaded: 0, total: 0 };
      this._notifyProgress(name, progress.total, progress.total, true);
      return index;
    } finally {
      this.loading.delete(name);
    }
  }

  async _fetchAndParse(name) {
    const url = `${this.baseUrl}metadata/${name}.idx`;

    const response = await fetch(url);
    if (!response.ok) {
      throw new Error(`Failed to load ${name}: ${response.status}`);
    }

    const contentLength = response.headers.get('content-length');
    const total = contentLength ? parseInt(contentLength, 10) : 0;

    // Stream the response for progress tracking
    const reader = response.body.getReader();
    const chunks = [];
    let loaded = 0;

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      chunks.push(value);
      loaded += value.length;
      this._notifyProgress(name, loaded, total);
    }

    // Combine chunks
    const buffer = new Uint8Array(loaded);
    let offset = 0;
    for (const chunk of chunks) {
      buffer.set(chunk, offset);
      offset += chunk.length;
    }

    return new ParsedIndex(name, buffer);
  }
}

/**
 * Parsed index with search capability.
 */
export class ParsedIndex {
  constructor(name, buffer) {
    this.name = name;
    this.buffer = buffer;
    this.view = new DataView(buffer.buffer, buffer.byteOffset, buffer.byteLength);
    this.entries = [];

    this._parse();
  }

  _parse() {
    // Verify magic
    const magic = String.fromCharCode(...this.buffer.slice(0, 4));
    if (magic !== 'EIDX') {
      throw new Error(`Invalid index magic: ${magic}`);
    }

    // Read header
    const version = this.view.getUint16(4, true);
    const count = this.view.getUint32(6, true);

    if (version !== 1) {
      throw new Error(`Unsupported index version: ${version}`);
    }

    // Parse entry table
    const headerSize = 16;
    const entrySize = 12;

    for (let i = 0; i < count; i++) {
      const entryOffset = headerSize + i * entrySize;
      const stringOffset = this.view.getUint32(entryOffset, true);
      const stringLength = this.view.getUint16(entryOffset + 4, true);
      const bitmapOffset = this.view.getUint32(entryOffset + 6, true);
      const bitmapLength = this.view.getUint16(entryOffset + 10, true);

      // Decode string key
      const keyBytes = this.buffer.slice(stringOffset, stringOffset + stringLength);
      const key = new TextDecoder().decode(keyBytes);

      this.entries.push({
        key,
        keyLower: key.toLowerCase(),
        bitmapOffset,
        bitmapLength,
      });
    }
  }

  /** Search for entries matching query (case-insensitive prefix match) */
  search(query) {
    const queryLower = query.toLowerCase().trim();
    if (!queryLower) return [];

    const matches = [];
    for (const entry of this.entries) {
      if (entry.keyLower.includes(queryLower)) {
        matches.push({
          key: entry.key,
          bitmapOffset: entry.bitmapOffset,
          bitmapLength: entry.bitmapLength,
        });
      }
    }

    // Sort by relevance: exact match first, then prefix, then contains
    matches.sort((a, b) => {
      const aLower = a.key.toLowerCase();
      const bLower = b.key.toLowerCase();

      const aExact = aLower === queryLower;
      const bExact = bLower === queryLower;
      if (aExact !== bExact) return aExact ? -1 : 1;

      const aPrefix = aLower.startsWith(queryLower);
      const bPrefix = bLower.startsWith(queryLower);
      if (aPrefix !== bPrefix) return aPrefix ? -1 : 1;

      return a.key.localeCompare(b.key);
    });

    return matches;
  }

  /** Get the Roaring bitmap bytes for an entry */
  getBitmapBytes(entry) {
    return this.buffer.slice(entry.bitmapOffset, entry.bitmapOffset + entry.bitmapLength);
  }
}
