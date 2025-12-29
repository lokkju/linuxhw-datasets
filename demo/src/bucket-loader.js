/**
 * Bucket file loader and parser.
 *
 * Bucket format v3 (6-byte linuxhw ID):
 *   Header (16 bytes): magic(4) + version(2) + count(2) + values_offset(4) + reserved(4)
 *   Keys (5 bytes each): bytes 1-5 of 6-byte ID (byte 0 is bucket prefix)
 *   Offsets (4 bytes each): packed offset + length
 *   Values: raw EDID bytes, 4-byte aligned
 *
 * The 6-byte ID matches linuxhw/EDID filename format: MD5(hex)[:12].upper()
 */

import { computeGitHubUrl } from './edid-utils.js';

const BUCKET_MAGIC = 0x42494445; // "EDIB" little-endian

export class BucketLoader {
  constructor(baseUrl) {
    this.baseUrl = baseUrl;
    this.buckets = new Map(); // prefix -> ParsedBucket
    this.loading = new Map(); // prefix -> Promise
    this.manifest = null;
    this.bucketOffsets = null; // cumulative offsets for global index lookup
    this.vendorMapping = null; // vendor code -> name mapping
  }

  /**
   * Load manifest (required for global index lookups).
   */
  async loadManifest() {
    if (this.manifest) return this.manifest;

    const response = await fetch(`${this.baseUrl}manifest.json`);
    if (!response.ok) {
      throw new Error(`Failed to load manifest: ${response.status}`);
    }

    this.manifest = await response.json();

    // Build cumulative offsets for global index -> bucket mapping
    const counts = this.manifest.bucket_counts;
    this.bucketOffsets = new Array(257);
    this.bucketOffsets[0] = 0;
    for (let i = 0; i < 256; i++) {
      this.bucketOffsets[i + 1] = this.bucketOffsets[i] + counts[i];
    }

    // Load vendor mapping if available (for GitHub URL computation)
    if (this.manifest.vendor_mapping) {
      this._loadVendorMapping(); // Don't await - load in background
    }

    return this.manifest;
  }

  /**
   * Load vendor code to name mapping (for GitHub URL computation).
   */
  async _loadVendorMapping() {
    if (this.vendorMapping) return this.vendorMapping;

    try {
      const response = await fetch(`${this.baseUrl}vendors.json`);
      if (response.ok) {
        this.vendorMapping = await response.json();
      }
    } catch (err) {
      console.warn('Failed to load vendor mapping:', err);
      this.vendorMapping = {};
    }

    return this.vendorMapping;
  }

  /**
   * Get GitHub URL for an EDID entry.
   * @param {Uint8Array} edidBytes - Raw EDID bytes
   * @param {string} id - 12-char linuxhw ID
   * @returns {string|null} GitHub URL or null if not available
   */
  getGitHubUrl(edidBytes, id) {
    return computeGitHubUrl(edidBytes, id, this.vendorMapping || {});
  }

  /**
   * Load a bucket file by prefix (0-255).
   */
  async load(prefix) {
    if (this.buckets.has(prefix)) {
      return this.buckets.get(prefix);
    }

    if (this.loading.has(prefix)) {
      return this.loading.get(prefix);
    }

    const promise = this._fetchAndParse(prefix);
    this.loading.set(prefix, promise);

    try {
      const bucket = await promise;
      this.buckets.set(prefix, bucket);
      return bucket;
    } finally {
      this.loading.delete(prefix);
    }
  }

  async _fetchAndParse(prefix) {
    const hex = prefix.toString(16).padStart(2, '0');
    const url = `${this.baseUrl}buckets/${hex}.bin`;

    const response = await fetch(url);
    if (!response.ok) {
      throw new Error(`Failed to load bucket ${hex}: ${response.status}`);
    }

    const buffer = await response.arrayBuffer();
    return new ParsedBucket(prefix, new Uint8Array(buffer));
  }

  /**
   * Get an entry by global index.
   * Global index = position in sorted MD5 order across all buckets.
   */
  async getByGlobalIndex(globalIndex) {
    // Ensure manifest is loaded
    if (!this.bucketOffsets) {
      await this.loadManifest();
    }

    // Binary search to find bucket
    let lo = 0, hi = 255;
    while (lo < hi) {
      const mid = Math.floor((lo + hi + 1) / 2);
      if (this.bucketOffsets[mid] <= globalIndex) {
        lo = mid;
      } else {
        hi = mid - 1;
      }
    }

    const bucketPrefix = lo;
    const localIndex = globalIndex - this.bucketOffsets[bucketPrefix];

    return this.getByBucketIndex(bucketPrefix, localIndex);
  }

  /**
   * Get an entry by bucket prefix and local index within that bucket.
   */
  async getByBucketIndex(prefix, localIndex) {
    const bucket = await this.load(prefix);
    return bucket.getEntry(localIndex);
  }
}

export class ParsedBucket {
  constructor(prefix, buffer) {
    this.prefix = prefix;
    this.buffer = buffer;
    this.view = new DataView(buffer.buffer, buffer.byteOffset, buffer.byteLength);

    this._parseHeader();
  }

  _parseHeader() {
    // Verify magic
    const magic = this.view.getUint32(0, true);
    if (magic !== BUCKET_MAGIC) {
      throw new Error(`Invalid bucket magic: 0x${magic.toString(16)}`);
    }

    this.version = this.view.getUint16(4, true);
    this.entryCount = this.view.getUint16(6, true);
    this.valuesOffset = this.view.getUint32(8, true);

    // Calculate section offsets based on version
    this.headerSize = 16;
    this.keysOffset = this.headerSize;

    if (this.version >= 3) {
      // v3+: 5 bytes per key (6-byte ID minus prefix)
      this.keySize = 5;
      this.keysSize = this.entryCount * 5;
      this.metadataOffset = null;
      this.metadataSize = 0;
      this.offsetsOffset = this.keysOffset + this.keysSize;
    } else if (this.version === 2) {
      // v2: 15 bytes per key (16-byte MD5 minus prefix)
      this.keySize = 15;
      this.keysSize = this.entryCount * 15;
      this.metadataOffset = null;
      this.metadataSize = 0;
      this.offsetsOffset = this.keysOffset + this.keysSize;
    } else {
      // v1: 15 bytes per key + metadata section
      this.keySize = 15;
      this.keysSize = this.entryCount * 15;
      this.metadataOffset = this.keysOffset + this.keysSize;
      this.metadataSize = this.entryCount * 16;
      this.offsetsOffset = this.metadataOffset + this.metadataSize;
    }
  }

  /**
   * Get entry at local index.
   * Returns ID (6 or 16 bytes depending on version) and raw EDID bytes.
   */
  getEntry(index) {
    if (index < 0 || index >= this.entryCount) {
      throw new Error(`Index ${index} out of range (0-${this.entryCount - 1})`);
    }

    // Read key bytes
    const keyStart = this.keysOffset + index * this.keySize;
    const keyBytes = this.buffer.slice(keyStart, keyStart + this.keySize);

    // Read offset + length
    const offsetStart = this.offsetsOffset + index * 4;
    const packed = this.view.getUint32(offsetStart, true);
    const valueOffset = packed & 0xFFFFFF;
    const valueLength = ((packed >> 24) & 0xFF) * 4;

    // Read raw EDID
    const edidStart = this.valuesOffset + valueOffset;
    const rawEdid = this.buffer.slice(edidStart, edidStart + valueLength);

    if (this.version >= 3) {
      // v3+: 6-byte ID (linuxhw format)
      const id = new Uint8Array(6);
      id[0] = this.prefix;
      id.set(keyBytes, 1);

      // 12-char uppercase hex ID (matches linuxhw filename)
      const idHex = Array.from(id).map(b => b.toString(16).padStart(2, '0')).join('').toUpperCase();

      return {
        id,
        idHex,      // 12-char linuxhw ID (e.g., "A03BAE7BABED")
        md5Hex: idHex,  // Alias for backward compatibility
        rawEdid,
      };
    } else {
      // v1/v2: 16-byte MD5 hash
      const md5 = new Uint8Array(16);
      md5[0] = this.prefix;
      md5.set(keyBytes, 1);

      return {
        md5,
        md5Hex: Array.from(md5).map(b => b.toString(16).padStart(2, '0')).join(''),
        rawEdid,
      };
    }
  }

  /**
   * Get all entries (for debugging).
   */
  getAllEntries() {
    const entries = [];
    for (let i = 0; i < this.entryCount; i++) {
      entries.push(this.getEntry(i));
    }
    return entries;
  }
}
