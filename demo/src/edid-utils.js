/**
 * EDID utility functions for path computation and vendor code decoding.
 *
 * The linuxhw ID is an opaque 12-character hex identifier extracted from
 * filenames in the linuxhw/EDID repository. We do not compute or derive it.
 */

/**
 * Decode EISA vendor code from EDID bytes 8-9.
 * The 3-character code is packed into 2 bytes using 5 bits per character.
 * @param {Uint8Array} edidBytes - Full EDID bytes
 * @returns {string} 3-character vendor code (e.g., "SAM", "DEL")
 */
export function decodeVendorCode(edidBytes) {
  if (!edidBytes || edidBytes.length < 10) return null;

  const mfg = (edidBytes[8] << 8) | edidBytes[9];
  const chars = [
    ((mfg >> 10) & 0x1F) + 64, // bits 14-10 + '@' (64)
    ((mfg >> 5) & 0x1F) + 64,  // bits 9-5 + '@'
    (mfg & 0x1F) + 64,         // bits 4-0 + '@'
  ];

  return String.fromCharCode(...chars);
}

/**
 * Decode product code from EDID bytes 10-11 (little-endian).
 * @param {Uint8Array} edidBytes - Full EDID bytes
 * @returns {string} 4-character hex product code (e.g., "0F99")
 */
export function decodeProductCode(edidBytes) {
  if (!edidBytes || edidBytes.length < 12) return null;

  const product = (edidBytes[11] << 8) | edidBytes[10];
  return product.toString(16).toUpperCase().padStart(4, '0');
}

/**
 * Get display type from EDID byte 20.
 * @param {Uint8Array} edidBytes - Full EDID bytes
 * @returns {string} "Digital" or "Analog"
 */
export function getDisplayType(edidBytes) {
  if (!edidBytes || edidBytes.length < 21) return null;

  return (edidBytes[20] & 0x80) ? 'Digital' : 'Analog';
}

/**
 * Extract all computable path info from EDID bytes.
 * @param {Uint8Array} edidBytes - Full EDID bytes
 * @returns {Object} Path components { type, vendorCode, productCode, model }
 */
export function extractPathInfo(edidBytes) {
  return {
    type: getDisplayType(edidBytes),
    vendorCode: decodeVendorCode(edidBytes),
    productCode: decodeProductCode(edidBytes),
    model: `${decodeVendorCode(edidBytes)}${decodeProductCode(edidBytes)}`,
  };
}
