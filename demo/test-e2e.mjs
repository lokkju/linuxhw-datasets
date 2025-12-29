#!/usr/bin/env node
/**
 * End-to-end test for the demo data flow:
 * 1. Load an index file
 * 2. Search for a term
 * 3. Decode the Roaring bitmap
 * 4. Look up EDIDs in bucket files
 */

import { readFileSync } from 'fs';
import { join } from 'path';

const DATA_DIR = join(import.meta.dirname, '..', 'data');

// Mini implementations matching the browser code

function decodeRoaring(data) {
  const view = new DataView(data.buffer, data.byteOffset, data.byteLength);
  let offset = 0;

  const cookie = view.getUint32(0, true);
  offset += 4;

  const SERIAL_COOKIE_NO_RUNCONTAINER = 12346;
  const SERIAL_COOKIE = 12347;
  const NO_OFFSET_THRESHOLD = 4;

  let numContainers;
  let hasRunContainers = false;
  let hasOffsetHeader = false;

  if (cookie === SERIAL_COOKIE_NO_RUNCONTAINER) {
    numContainers = view.getUint32(offset, true);
    offset += 4;
    hasOffsetHeader = true;
  } else if (cookie === SERIAL_COOKIE) {
    numContainers = view.getUint32(offset, true);
    offset += 4;
    hasRunContainers = true;
    hasOffsetHeader = true;
  } else if ((cookie & 0xFFFF) === SERIAL_COOKIE_NO_RUNCONTAINER) {
    numContainers = (cookie >> 16) + 1;
    hasOffsetHeader = numContainers >= NO_OFFSET_THRESHOLD;
  } else if ((cookie & 0xFFFF) === SERIAL_COOKIE) {
    numContainers = (cookie >> 16) + 1;
    hasRunContainers = true;
    hasOffsetHeader = numContainers >= NO_OFFSET_THRESHOLD;
  } else {
    throw new Error(`Unknown Roaring bitmap format: 0x${cookie.toString(16)}`);
  }

  let runBitmap = null;
  if (hasRunContainers) {
    const runBitmapSize = Math.ceil(numContainers / 8);
    runBitmap = data.slice(offset, offset + runBitmapSize);
    offset += runBitmapSize;
  }

  const containers = [];
  for (let i = 0; i < numContainers; i++) {
    const key = view.getUint16(offset, true);
    offset += 2;
    const cardinality = view.getUint16(offset, true) + 1;
    offset += 2;
    const isRun = runBitmap ? (runBitmap[Math.floor(i / 8)] & (1 << (i % 8))) !== 0 : false;
    containers.push({ key, cardinality, isRun });
  }

  if (hasOffsetHeader) {
    offset += numContainers * 4;
  }

  const result = [];
  for (const container of containers) {
    const baseValue = container.key << 16;

    if (container.isRun) {
      const numRuns = view.getUint16(offset, true);
      offset += 2;
      for (let r = 0; r < numRuns; r++) {
        const start = view.getUint16(offset, true);
        offset += 2;
        const length = view.getUint16(offset, true);
        offset += 2;
        for (let v = start; v <= start + length; v++) {
          result.push(baseValue + v);
        }
      }
    } else if (container.cardinality <= 4096) {
      for (let j = 0; j < container.cardinality; j++) {
        const value = view.getUint16(offset, true);
        offset += 2;
        result.push(baseValue + value);
      }
    } else {
      for (let word = 0; word < 1024; word++) {
        const bits = view.getBigUint64(offset, true);
        offset += 8;
        for (let bit = 0; bit < 64; bit++) {
          if ((bits >> BigInt(bit)) & 1n) {
            result.push(baseValue + word * 64 + bit);
          }
        }
      }
    }
  }

  return result;
}

function parseIndex(buffer) {
  const view = new DataView(buffer.buffer, buffer.byteOffset, buffer.byteLength);

  const magic = String.fromCharCode(...buffer.slice(0, 4));
  if (magic !== 'EIDX') throw new Error(`Invalid index magic: ${magic}`);

  const version = view.getUint16(4, true);
  const count = view.getUint32(6, true);

  if (version !== 1) throw new Error(`Unsupported version: ${version}`);

  const entries = [];
  const headerSize = 16;
  const entrySize = 12;

  for (let i = 0; i < count; i++) {
    const entryOffset = headerSize + i * entrySize;
    const stringOffset = view.getUint32(entryOffset, true);
    const stringLength = view.getUint16(entryOffset + 4, true);
    const bitmapOffset = view.getUint32(entryOffset + 6, true);
    const bitmapLength = view.getUint16(entryOffset + 10, true);

    const keyBytes = buffer.slice(stringOffset, stringOffset + stringLength);
    const key = new TextDecoder().decode(keyBytes);

    entries.push({ key, bitmapOffset, bitmapLength });
  }

  return { entries, buffer };
}

function parseBucket(prefix, buffer) {
  const view = new DataView(buffer.buffer, buffer.byteOffset, buffer.byteLength);

  const magic = view.getUint32(0, true);
  if (magic !== 0x42494445) throw new Error(`Invalid bucket magic: 0x${magic.toString(16)}`);

  const version = view.getUint16(4, true);
  const entryCount = view.getUint16(6, true);
  const valuesOffset = view.getUint32(8, true);

  const headerSize = 16;
  const keysOffset = headerSize;
  const keysSize = entryCount * 15;
  const metadataOffset = keysOffset + keysSize;
  const metadataSize = entryCount * 16;
  const offsetsOffset = metadataOffset + metadataSize;

  return { prefix, buffer, view, entryCount, valuesOffset, keysOffset, metadataOffset, offsetsOffset };
}

function getEntry(bucket, index) {
  if (index < 0 || index >= bucket.entryCount) {
    throw new Error(`Index ${index} out of range`);
  }

  const keyStart = bucket.keysOffset + index * 15;
  const keyBytes = bucket.buffer.slice(keyStart, keyStart + 15);

  const md5 = new Uint8Array(16);
  md5[0] = bucket.prefix;
  md5.set(keyBytes, 1);

  const metaStart = bucket.metadataOffset + index * 16;
  const metadata = {
    vendorId: bucket.view.getUint16(metaStart, true),
    modelId: bucket.view.getUint16(metaStart + 2, true),
    year: bucket.view.getUint16(metaStart + 4, true),
    widthPx: bucket.view.getUint16(metaStart + 6, true),
    heightPx: bucket.view.getUint16(metaStart + 8, true),
    widthMm: bucket.view.getUint16(metaStart + 10, true),
    heightMm: bucket.view.getUint16(metaStart + 12, true),
    displayType: ['analog', 'digital', 'unknown'][bucket.view.getUint8(metaStart + 14)] || 'unknown',
  };

  const offsetStart = bucket.offsetsOffset + index * 4;
  const packed = bucket.view.getUint32(offsetStart, true);
  const valueOffset = packed & 0xFFFFFF;
  const valueLength = ((packed >> 24) & 0xFF) * 4;

  const edidStart = bucket.valuesOffset + valueOffset;
  const rawEdid = bucket.buffer.slice(edidStart, edidStart + valueLength);

  return {
    md5Hex: Array.from(md5).map(b => b.toString(16).padStart(2, '0')).join(''),
    ...metadata,
    rawEdid,
  };
}

// Run test
console.log('=== EDID Dataset End-to-End Test ===\n');

// 1. Load manifest
const manifest = JSON.parse(readFileSync(join(DATA_DIR, 'manifest.json'), 'utf-8'));
console.log(`Manifest: ${manifest.total_entries} total entries\n`);

// Build cumulative offsets
const bucketOffsets = new Array(257);
bucketOffsets[0] = 0;
for (let i = 0; i < 256; i++) {
  bucketOffsets[i + 1] = bucketOffsets[i] + manifest.bucket_counts[i];
}

// 2. Load products index
const productsBuffer = new Uint8Array(readFileSync(join(DATA_DIR, 'metadata', 'products.idx')));
const productsIndex = parseIndex(productsBuffer);
console.log(`Products index: ${productsIndex.entries.length} entries\n`);

// 3. Search for "Dell"
const query = 'Dell';
const matches = productsIndex.entries.filter(e =>
  e.key.toLowerCase().includes(query.toLowerCase())
).slice(0, 5);

console.log(`Search "${query}": ${matches.length} matches (showing first 5)\n`);

for (const match of matches) {
  console.log(`  - ${match.key}`);

  // 4. Decode Roaring bitmap
  const bitmapBytes = productsBuffer.slice(match.bitmapOffset, match.bitmapOffset + match.bitmapLength);
  const indices = decodeRoaring(bitmapBytes);
  console.log(`    Bitmap decoded: ${indices.length} EDID(s)`);

  if (indices.length > 0) {
    // 5. Look up first EDID in bucket
    const globalIndex = indices[0];

    // Find bucket
    let lo = 0, hi = 255;
    while (lo < hi) {
      const mid = Math.floor((lo + hi + 1) / 2);
      if (bucketOffsets[mid] <= globalIndex) lo = mid;
      else hi = mid - 1;
    }
    const bucketPrefix = lo;
    const localIndex = globalIndex - bucketOffsets[bucketPrefix];

    // Load bucket
    const bucketPath = join(DATA_DIR, 'buckets', bucketPrefix.toString(16).padStart(2, '0') + '.bin');
    const bucketBuffer = new Uint8Array(readFileSync(bucketPath));
    const bucket = parseBucket(bucketPrefix, bucketBuffer);

    // Get entry
    const entry = getEntry(bucket, localIndex);
    console.log(`    First EDID: ${entry.widthPx}x${entry.heightPx}, year ${entry.year || 'unknown'}, ${entry.displayType}`);
    console.log(`    MD5: ${entry.md5Hex.slice(0, 12)}...`);
  }
  console.log();
}

console.log('=== Test Complete ===');
