/**
 * Lightweight EDID decoder for browser.
 * Decodes key fields from raw 128+ byte EDID data.
 *
 * EDID structure (base block 128 bytes):
 *   0-7:   Header (00 FF FF FF FF FF FF 00)
 *   8-9:   Manufacturer ID (3 letters packed into 2 bytes)
 *   10-11: Product code (little-endian)
 *   12-15: Serial number (little-endian)
 *   16:    Week of manufacture
 *   17:    Year of manufacture (add 1990)
 *   18:    EDID version
 *   19:    EDID revision
 *   20:    Video input definition
 *   21:    Max horizontal size (cm)
 *   22:    Max vertical size (cm)
 *   23:    Gamma
 *   54-125: Timing descriptors (4 x 18 bytes)
 *   126:   Extension count
 *   127:   Checksum
 */

/**
 * Decode manufacturer ID from bytes 8-9.
 * 3 letters encoded as 5-bit values (A=1, B=2, ... Z=26) in big-endian.
 * @param {Uint8Array} edid - Raw EDID bytes
 * @returns {string} 3-letter manufacturer code (e.g., "DEL", "SAM")
 */
export function decodeManufacturerId(edid) {
  if (!edid || edid.length < 10) return null;

  // Big-endian 16-bit value
  const mfgBytes = (edid[8] << 8) | edid[9];

  // Extract three 5-bit characters
  const ch1 = (mfgBytes >> 10) & 0x1F;
  const ch2 = (mfgBytes >> 5) & 0x1F;
  const ch3 = mfgBytes & 0x1F;

  // Convert to ASCII (A=1 maps to 65)
  if (ch1 === 0 || ch2 === 0 || ch3 === 0) return null;

  return String.fromCharCode(ch1 + 64, ch2 + 64, ch3 + 64);
}

/**
 * Decode product code from bytes 10-11.
 * @param {Uint8Array} edid - Raw EDID bytes
 * @returns {number} Product code
 */
export function decodeProductCode(edid) {
  if (!edid || edid.length < 12) return null;
  // Little-endian
  return edid[10] | (edid[11] << 8);
}

/**
 * Decode serial number from bytes 12-15.
 * @param {Uint8Array} edid - Raw EDID bytes
 * @returns {number} Serial number (32-bit)
 */
export function decodeSerialNumber(edid) {
  if (!edid || edid.length < 16) return null;
  // Little-endian
  return edid[12] | (edid[13] << 8) | (edid[14] << 16) | (edid[15] << 24);
}

/**
 * Decode manufacture week and year from bytes 16-17.
 * @param {Uint8Array} edid - Raw EDID bytes
 * @returns {{week: number, year: number}}
 */
export function decodeManufactureDate(edid) {
  if (!edid || edid.length < 18) return null;
  const week = edid[16];
  const year = edid[17] + 1990;
  return { week, year };
}

/**
 * Decode EDID version from bytes 18-19.
 * @param {Uint8Array} edid - Raw EDID bytes
 * @returns {{version: number, revision: number}}
 */
export function decodeVersion(edid) {
  if (!edid || edid.length < 20) return null;
  return { version: edid[18], revision: edid[19] };
}

/**
 * Decode video input from byte 20.
 * @param {Uint8Array} edid - Raw EDID bytes
 * @returns {{digital: boolean, bitDepth: number|null, interface: string|null}}
 */
export function decodeVideoInput(edid) {
  if (!edid || edid.length < 21) return null;

  const input = edid[20];
  const digital = (input & 0x80) !== 0;

  if (digital) {
    // Digital input (EDID 1.4+)
    const bitDepthCode = (input >> 4) & 0x07;
    const bitDepths = [null, 6, 8, 10, 12, 14, 16, null];
    const interfaceCode = input & 0x0F;
    const interfaces = [
      'undefined', 'DVI', 'HDMI-a', 'HDMI-b', 'MDDI', 'DisplayPort'
    ];

    return {
      digital: true,
      bitDepth: bitDepths[bitDepthCode] || null,
      interface: interfaces[interfaceCode] || null,
    };
  } else {
    // Analog input
    return { digital: false, bitDepth: null, interface: 'analog' };
  }
}

/**
 * Decode physical screen size from bytes 21-22.
 * @param {Uint8Array} edid - Raw EDID bytes
 * @returns {{widthCm: number, heightCm: number}}
 */
export function decodeScreenSize(edid) {
  if (!edid || edid.length < 23) return null;
  return {
    widthCm: edid[21],
    heightCm: edid[22],
  };
}

/**
 * Decode gamma from byte 23.
 * @param {Uint8Array} edid - Raw EDID bytes
 * @returns {number} Gamma value (e.g., 2.2)
 */
export function decodeGamma(edid) {
  if (!edid || edid.length < 24) return null;
  const raw = edid[23];
  if (raw === 0xFF) return null; // Defined in extension block
  return (raw + 100) / 100;
}

/**
 * Decode a descriptor block (18 bytes).
 * Descriptors start at byte 54 and there are 4 of them.
 */
function decodeDescriptor(edid, offset) {
  if (!edid || edid.length < offset + 18) return null;

  // Check if it's a timing descriptor (first 2 bytes are pixel clock)
  const pixelClock = edid[offset] | (edid[offset + 1] << 8);

  if (pixelClock !== 0) {
    // Detailed timing descriptor
    const hActive = edid[offset + 2] | ((edid[offset + 4] & 0xF0) << 4);
    const vActive = edid[offset + 5] | ((edid[offset + 7] & 0xF0) << 4);

    return {
      type: 'timing',
      pixelClockKHz: pixelClock * 10,
      hActive,
      vActive,
    };
  }

  // Display descriptor
  const tag = edid[offset + 3];

  // Text descriptors: FC (monitor name), FF (serial), FE (unspecified text)
  if (tag === 0xFC || tag === 0xFF || tag === 0xFE) {
    const textBytes = edid.slice(offset + 5, offset + 18);
    let text = '';
    for (const byte of textBytes) {
      if (byte === 0x0A || byte === 0x00) break; // Newline or null terminates
      text += String.fromCharCode(byte);
    }

    const types = { 0xFC: 'monitorName', 0xFF: 'serialString', 0xFE: 'text' };
    return { type: types[tag], value: text.trim() };
  }

  // Monitor range limits (FD)
  if (tag === 0xFD) {
    return {
      type: 'rangeLimits',
      minVRate: edid[offset + 5],
      maxVRate: edid[offset + 6],
      minHRate: edid[offset + 7],
      maxHRate: edid[offset + 8],
      maxPixelClock: edid[offset + 9] * 10, // MHz
    };
  }

  return { type: 'other', tag };
}

/**
 * Decode all 4 descriptor blocks (bytes 54-125).
 * @param {Uint8Array} edid - Raw EDID bytes
 * @returns {Array} Array of descriptor objects
 */
export function decodeDescriptors(edid) {
  if (!edid || edid.length < 126) return [];

  const descriptors = [];
  for (let i = 0; i < 4; i++) {
    const desc = decodeDescriptor(edid, 54 + i * 18);
    if (desc) descriptors.push(desc);
  }
  return descriptors;
}

/**
 * Full EDID decode - returns all parsed fields.
 * @param {Uint8Array} edid - Raw EDID bytes
 * @returns {Object} Decoded EDID fields
 */
export function decodeEdid(edid) {
  if (!edid || edid.length < 128) {
    return { error: 'EDID too short (need at least 128 bytes)' };
  }

  // Validate header
  const expectedHeader = [0x00, 0xFF, 0xFF, 0xFF, 0xFF, 0xFF, 0xFF, 0x00];
  const headerValid = expectedHeader.every((b, i) => edid[i] === b);

  const manufacturerId = decodeManufacturerId(edid);
  const productCode = decodeProductCode(edid);
  const serialNumber = decodeSerialNumber(edid);
  const manufactureDate = decodeManufactureDate(edid);
  const version = decodeVersion(edid);
  const videoInput = decodeVideoInput(edid);
  const screenSize = decodeScreenSize(edid);
  const gamma = decodeGamma(edid);
  const descriptors = decodeDescriptors(edid);

  // Extract monitor name and serial string from descriptors
  const monitorName = descriptors.find(d => d.type === 'monitorName')?.value || null;
  const serialString = descriptors.find(d => d.type === 'serialString')?.value || null;

  // Find preferred timing (first detailed timing descriptor)
  const preferredTiming = descriptors.find(d => d.type === 'timing');

  // Extension count
  const extensionCount = edid[126];

  // Checksum validation
  let checksum = 0;
  for (let i = 0; i < 128; i++) {
    checksum = (checksum + edid[i]) & 0xFF;
  }
  const checksumValid = checksum === 0;

  return {
    headerValid,
    checksumValid,
    manufacturerId,
    productCode,
    productCodeHex: productCode?.toString(16).toUpperCase().padStart(4, '0'),
    serialNumber,
    serialNumberHex: serialNumber?.toString(16).toUpperCase().padStart(8, '0'),
    manufactureWeek: manufactureDate?.week,
    manufactureYear: manufactureDate?.year,
    edidVersion: version ? `${version.version}.${version.revision}` : null,
    videoInput,
    screenSizeCm: screenSize,
    gamma,
    monitorName,
    serialString,
    preferredResolution: preferredTiming ? {
      width: preferredTiming.hActive,
      height: preferredTiming.vActive,
      pixelClockMHz: preferredTiming.pixelClockKHz / 1000,
    } : null,
    extensionCount,
    descriptors,
  };
}
