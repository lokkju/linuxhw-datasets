/**
 * Roaring bitmap decoder.
 *
 * Decodes serialized Roaring bitmaps from pyroaring (native format).
 * Based on the Roaring bitmap specification.
 */

/**
 * Decode a serialized Roaring bitmap and return an array of integers.
 * @param {Uint8Array} data - Serialized bitmap data
 * @returns {number[]} - Array of integers in the bitmap
 */
export function decodeRoaring(data) {
  const view = new DataView(data.buffer, data.byteOffset, data.byteLength);
  let offset = 0;

  // Read cookie (first 4 bytes)
  const cookie = view.getUint32(0, true);
  offset += 4;

  // Check format
  const SERIAL_COOKIE_NO_RUNCONTAINER = 12346; // 0x303a
  const SERIAL_COOKIE = 12347; // 0x303b
  const NO_OFFSET_THRESHOLD = 4;

  let numContainers;
  let hasRunContainers = false;
  let hasOffsetHeader = false;

  if (cookie === SERIAL_COOKIE_NO_RUNCONTAINER) {
    // pyroaring format: cookie is exactly 12346, container count follows
    // pyroaring always includes offset headers
    numContainers = view.getUint32(offset, true);
    offset += 4;
    hasOffsetHeader = true; // pyroaring always has offsets
  } else if (cookie === SERIAL_COOKIE) {
    // Format with run containers
    numContainers = view.getUint32(offset, true);
    offset += 4;
    hasRunContainers = true;
    hasOffsetHeader = true; // pyroaring always has offsets
  } else if ((cookie & 0xFFFF) === SERIAL_COOKIE_NO_RUNCONTAINER) {
    // Standard portable format: count encoded in upper 16 bits
    numContainers = (cookie >> 16) + 1;
    hasOffsetHeader = numContainers >= NO_OFFSET_THRESHOLD;
  } else if ((cookie & 0xFFFF) === SERIAL_COOKIE) {
    // Standard portable format with run containers
    numContainers = (cookie >> 16) + 1;
    hasRunContainers = true;
    hasOffsetHeader = numContainers >= NO_OFFSET_THRESHOLD;
  } else {
    throw new Error(`Unknown Roaring bitmap format: 0x${cookie.toString(16)}`);
  }

  // Read run container bitmap if present
  let runBitmap = null;
  if (hasRunContainers) {
    const runBitmapSize = Math.ceil(numContainers / 8);
    runBitmap = data.slice(offset, offset + runBitmapSize);
    offset += runBitmapSize;
  }

  // Read key-cardinality pairs
  const containers = [];
  for (let i = 0; i < numContainers; i++) {
    const key = view.getUint16(offset, true);
    offset += 2;
    const cardinality = view.getUint16(offset, true) + 1; // stored as card - 1
    offset += 2;
    const isRun = runBitmap ? (runBitmap[Math.floor(i / 8)] & (1 << (i % 8))) !== 0 : false;
    containers.push({ key, cardinality, isRun });
  }

  // Skip offset header if present
  if (hasOffsetHeader) {
    offset += numContainers * 4;
  }

  // Decode each container
  const result = [];
  for (const container of containers) {
    const baseValue = container.key << 16;

    if (container.isRun) {
      // Run container
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
      // Array container
      for (let j = 0; j < container.cardinality; j++) {
        const value = view.getUint16(offset, true);
        offset += 2;
        result.push(baseValue + value);
      }
    } else {
      // Bitmap container (65536 bits = 8192 bytes)
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

/**
 * Decode a Roaring bitmap and return first N results.
 * More efficient than decoding all then slicing.
 * @param {Uint8Array} data - Serialized bitmap data
 * @param {number} limit - Maximum results to return
 * @returns {number[]} - Array of integers (up to limit)
 */
export function decodeRoaringLimit(data, limit) {
  // For now, just decode all and slice
  // TODO: Optimize to stop early
  const all = decodeRoaring(data);
  return all.slice(0, limit);
}

/**
 * Get the cardinality (count) of a Roaring bitmap without fully decoding.
 * Reads container metadata to sum cardinalities.
 * @param {Uint8Array} data - Serialized bitmap data
 * @returns {number} - Total number of integers in the bitmap
 */
export function countRoaring(data) {
  const view = new DataView(data.buffer, data.byteOffset, data.byteLength);
  let offset = 0;

  const cookie = view.getUint32(0, true);
  offset += 4;

  const SERIAL_COOKIE_NO_RUNCONTAINER = 12346;
  const SERIAL_COOKIE = 12347;

  let numContainers;
  let hasRunContainers = false;

  if (cookie === SERIAL_COOKIE_NO_RUNCONTAINER) {
    numContainers = view.getUint32(offset, true);
    offset += 4;
  } else if (cookie === SERIAL_COOKIE) {
    numContainers = view.getUint32(offset, true);
    offset += 4;
    hasRunContainers = true;
  } else if ((cookie & 0xFFFF) === SERIAL_COOKIE_NO_RUNCONTAINER) {
    numContainers = (cookie >> 16) + 1;
  } else if ((cookie & 0xFFFF) === SERIAL_COOKIE) {
    numContainers = (cookie >> 16) + 1;
    hasRunContainers = true;
  } else {
    throw new Error(`Unknown Roaring bitmap format: 0x${cookie.toString(16)}`);
  }

  // Skip run container bitmap if present
  if (hasRunContainers) {
    offset += Math.ceil(numContainers / 8);
  }

  // Sum cardinalities from key-cardinality pairs
  let totalCount = 0;
  for (let i = 0; i < numContainers; i++) {
    offset += 2; // Skip key
    const cardinality = view.getUint16(offset, true) + 1; // stored as card - 1
    offset += 2;
    totalCount += cardinality;
  }

  return totalCount;
}
