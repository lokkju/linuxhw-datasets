/**
 * Comprehensive EDID decoder for browser.
 * Ported from dgallegos/edidreader (MIT License) to ES modules.
 *
 * Decodes:
 * - Base EDID block (128 bytes): header, manufacturer, product, timings
 * - CEA-861 extension blocks: audio, video, vendor-specific data
 * - HDMI 1.4/2.0/Forum vendor blocks
 * - HDR metadata, colorimetry, YCbCr 4:2:0
 *
 * @see https://github.com/dgallegos/edidreader
 */

// ============================================================================
// Constants and Lookup Tables
// ============================================================================

export const EDID_BLOCK_LENGTH = 128;
export const DTD_LENGTH = 18;

export const WHITE_AND_SYNC_LEVELS = [
  '+0.7/-0.3 V', '+0.714/-0.286 V', '+1.0/-0.4 V', '+0.7/0 V'
];

export const DIGITAL_COLOR_SPACE = [
  'RGB 4:4:4', 'RGB 4:4:4 + YCrCb 4:4:4',
  'RGB 4:4:4 + YCrCb 4:2:2', 'RGB 4:4:4 + YCrCb 4:4:4 + YCrCb 4:2:2'
];

export const ANALOG_COLOR_SPACE = [
  'Monochrome or Grayscale', 'RGB color', 'Non-RGB color', 'Undefined'
];

export const ESTABLISHED_TIMINGS = [
  '720x400 @ 70 Hz', '720x400 @ 88 Hz', '640x480 @ 60 Hz', '640x480 @ 67 Hz',
  '640x480 @ 72 Hz', '640x480 @ 75 Hz', '800x600 @ 56 Hz', '800x600 @ 60 Hz',
  '800x600 @ 72 Hz', '800x600 @ 75 Hz', '832x624 @ 75 Hz', '1024x768i @ 87 Hz',
  '1024x768 @ 60 Hz', '1024x768 @ 72 Hz', '1024x768 @ 75 Hz', '1280x1024 @ 75 Hz',
  '1152x870 @ 75 Hz'
];

export const ASPECT_RATIOS = ['16:10', '4:3', '5:4', '16:9'];

export const SYNC_TYPE = {
  ANALOG_COMPOSITE: 0x00,
  BIPOLAR_ANALOG_COMPOSITE: 0x01,
  DIGITAL_COMPOSITE: 0x02,
  DIGITAL_SEPARATE: 0x03
};

export const DATA_BLOCK_TYPE = {
  RESERVED: 0, AUDIO: 1, VIDEO: 2, VENDOR_SPECIFIC: 3,
  SPEAKER_ALLOCATION: 4, EXTENDED_TAG: 7
};

export const EXTENDED_DATA_BLOCK_TYPE = {
  VIDEO_CAPABILITY: 0, VENDOR_SPECIFIC_VIDEO: 1, COLORIMETRY: 5,
  HDR_STATIC_METADATA: 6, HDR_DYNAMIC_METADATA: 7,
  VIDEO_FORMAT_PREFERENCE: 13, YCBCR420_VIDEO: 14,
  YCBCR420_CAPABILITY_MAP: 15, ROOM_CONFIGURATION: 19,
  HDMI_FORUM_SCDB: 0x79
};

export const IEEE_OUI = {
  HDMI14: 0x000C03,
  HDMI20: 0xC45DD8
};

export const AUDIO_FORMATS = [
  'RESERVED', 'LPCM', 'AC-3', 'MPEG-1', 'MP3', 'MPEG2', 'AAC LC',
  'DTS', 'ATRAC', 'DSD', 'E-AC-3', 'DTS-HD', 'MLP', 'DST', 'WMA Pro'
];

export const SAMPLE_RATES = ['32 kHz', '44.1 kHz', '48 kHz', '88.2 kHz', '96 kHz', '176.4 kHz', '192 kHz'];
export const BIT_DEPTHS = ['16 bit', '20 bit', '24 bit'];

export const EOTF_TYPES = [
  'Traditional gamma - SDR luminance range',
  'Traditional gamma - HDR luminance range',
  'SMPTE ST2084 (PQ)',
  'Hybrid Log-Gamma (HLG)'
];

export const OVERSCAN_BEHAVIOR = [
  'No data', 'Always overscanned', 'Always underscanned', 'Supports both'
];

export const SPEAKER_ALLOCATION = [
  'Front Left/Front Right (FL/FR)', 'Low Frequency Effect (LFE)',
  'Front Center (FC)', 'Rear Left/Rear Right (RL/RR)',
  'Rear Center (RC)', 'Front Left Center/Front Right Center (FLC/FRC)',
  'Rear Left Center/Rear Right Center (RLC/RRC)',
  'Front Left Wide/Front Right Wide (FLW/FRW)',
  'Front Left High/Front Right High (FLH/FRH)',
  'Top Center (TC)', 'Front Center High (FCH)'
];

// CEA-861 Video Identification Codes (VICs) - common ones
export const VIDEO_FORMATS = {
  1: { format: '640x480p', rate: '59.94/60Hz', aspect: '4:3' },
  2: { format: '720x480p', rate: '59.94/60Hz', aspect: '4:3' },
  3: { format: '720x480p', rate: '59.94/60Hz', aspect: '16:9' },
  4: { format: '1280x720p', rate: '59.94/60Hz', aspect: '16:9' },
  5: { format: '1920x1080i', rate: '59.94/60Hz', aspect: '16:9' },
  16: { format: '1920x1080p', rate: '59.94/60Hz', aspect: '16:9' },
  17: { format: '720x576p', rate: '50Hz', aspect: '4:3' },
  18: { format: '720x576p', rate: '50Hz', aspect: '16:9' },
  19: { format: '1280x720p', rate: '50Hz', aspect: '16:9' },
  20: { format: '1920x1080i', rate: '50Hz', aspect: '16:9' },
  31: { format: '1920x1080p', rate: '50Hz', aspect: '16:9' },
  32: { format: '1920x1080p', rate: '23.97/24Hz', aspect: '16:9' },
  33: { format: '1920x1080p', rate: '25Hz', aspect: '16:9' },
  34: { format: '1920x1080p', rate: '29.97/30Hz', aspect: '16:9' },
  63: { format: '1920x1080p', rate: '119.88/120Hz', aspect: '16:9' },
  64: { format: '1920x1080p', rate: '100Hz', aspect: '16:9' },
  93: { format: '3840x2160p', rate: '23.98/24Hz', aspect: '16:9' },
  94: { format: '3840x2160p', rate: '25Hz', aspect: '16:9' },
  95: { format: '3840x2160p', rate: '29.97/30Hz', aspect: '16:9' },
  96: { format: '3840x2160p', rate: '50Hz', aspect: '16:9' },
  97: { format: '3840x2160p', rate: '59.94/60Hz', aspect: '16:9' },
  98: { format: '4096x2160p', rate: '23.98/24Hz', aspect: '256:135' },
  99: { format: '4096x2160p', rate: '25Hz', aspect: '256:135' },
  100: { format: '4096x2160p', rate: '29.97/30Hz', aspect: '256:135' },
  101: { format: '4096x2160p', rate: '50Hz', aspect: '256:135' },
  102: { format: '4096x2160p', rate: '59.94/60Hz', aspect: '256:135' },
  117: { format: '3840x2160p', rate: '100Hz', aspect: '16:9' },
  118: { format: '3840x2160p', rate: '119.88/120Hz', aspect: '16:9' },
  194: { format: '7680x4320p', rate: '24Hz', aspect: '16:9' },
  195: { format: '7680x4320p', rate: '25Hz', aspect: '16:9' },
  196: { format: '7680x4320p', rate: '30Hz', aspect: '16:9' },
  197: { format: '7680x4320p', rate: '48Hz', aspect: '16:9' },
  198: { format: '7680x4320p', rate: '50Hz', aspect: '16:9' },
  199: { format: '7680x4320p', rate: '60Hz', aspect: '16:9' },
};

// ============================================================================
// Helper Functions
// ============================================================================

function intToAscii(code) {
  return code > 0 && code <= 26 ? String.fromCharCode(code + 64) : '?';
}

function validateHeader(data) {
  const expected = [0x00, 0xFF, 0xFF, 0xFF, 0xFF, 0xFF, 0xFF, 0x00];
  return expected.every((b, i) => data[i] === b);
}

function calcChecksum(data, blockStart) {
  let sum = 0;
  for (let i = blockStart; i < blockStart + EDID_BLOCK_LENGTH - 1; i++) {
    sum += data[i];
  }
  return (256 - (sum % 256)) & 0xFF;
}

function validChecksum(data, block = 0) {
  const blockStart = block * EDID_BLOCK_LENGTH;
  const storedChecksum = data[blockStart + EDID_BLOCK_LENGTH - 1];
  const calculatedChecksum = calcChecksum(data, blockStart);
  return storedChecksum === calculatedChecksum;
}

// ============================================================================
// Base EDID Parsing (Block 0)
// ============================================================================

function parseManufacturerId(data) {
  const byte1 = data[8];
  const byte2 = data[9];
  const ch1 = (byte1 >> 2) & 0x1F;
  const ch2 = ((byte1 & 0x03) << 3) | ((byte2 >> 5) & 0x07);
  const ch3 = byte2 & 0x1F;
  return intToAscii(ch1) + intToAscii(ch2) + intToAscii(ch3);
}

function parseProductCode(data) {
  return data[10] | (data[11] << 8);
}

function parseSerialNumber(data) {
  return data[12] | (data[13] << 8) | (data[14] << 16) | (data[15] << 24);
}

function parseManufactureDate(data) {
  return {
    week: data[16],
    year: data[17] + 1990
  };
}

function parseVersion(data) {
  return {
    version: data[18],
    revision: data[19]
  };
}

function parseBasicDisplayParams(data) {
  const byte20 = data[20];
  const byte21 = data[21];
  const byte22 = data[22];
  const byte23 = data[23];
  const byte24 = data[24];

  const digital = (byte20 & 0x80) !== 0;

  const params = {
    digital,
    screenWidth: byte21,  // cm
    screenHeight: byte22, // cm
    gamma: byte23 === 0xFF ? null : (byte23 + 100) / 100,
  };

  if (digital) {
    // Digital input (EDID 1.4+)
    const bitDepthCode = (byte20 >> 4) & 0x07;
    const bitDepths = [null, 6, 8, 10, 12, 14, 16, null];
    params.bitDepth = bitDepths[bitDepthCode];

    const interfaceCode = byte20 & 0x0F;
    const interfaces = ['undefined', 'DVI', 'HDMI-a', 'HDMI-b', 'MDDI', 'DisplayPort'];
    params.interface = interfaces[interfaceCode] || null;
  } else {
    // Analog input
    params.whiteSyncLevel = WHITE_AND_SYNC_LEVELS[(byte20 >> 5) & 0x03];
    params.blankToBlack = (byte20 & 0x10) !== 0;
    params.separateSync = (byte20 & 0x08) !== 0;
    params.compositeSync = (byte20 & 0x04) !== 0;
    params.syncOnGreen = (byte20 & 0x02) !== 0;
    params.vSyncSerrated = (byte20 & 0x01) !== 0;
  }

  // Features (byte 24)
  params.dpmsStandby = (byte24 & 0x80) !== 0;
  params.dpmsSuspend = (byte24 & 0x40) !== 0;
  params.dpmsActiveOff = (byte24 & 0x20) !== 0;
  params.displayType = digital
    ? DIGITAL_COLOR_SPACE[(byte24 >> 3) & 0x03]
    : ANALOG_COLOR_SPACE[(byte24 >> 3) & 0x03];
  params.sRGB = (byte24 & 0x04) !== 0;
  params.preferredTimingMode = (byte24 & 0x02) !== 0;
  params.continuousFrequency = (byte24 & 0x01) !== 0;

  return params;
}

function parseChromaticity(data) {
  const redGreenLsb = data[25];
  const blueWhiteLsb = data[26];

  return {
    redX: ((data[27] << 2) | ((redGreenLsb >> 6) & 0x03)) / 1024,
    redY: ((data[28] << 2) | ((redGreenLsb >> 4) & 0x03)) / 1024,
    greenX: ((data[29] << 2) | ((redGreenLsb >> 2) & 0x03)) / 1024,
    greenY: ((data[30] << 2) | (redGreenLsb & 0x03)) / 1024,
    blueX: ((data[31] << 2) | ((blueWhiteLsb >> 6) & 0x03)) / 1024,
    blueY: ((data[32] << 2) | ((blueWhiteLsb >> 4) & 0x03)) / 1024,
    whiteX: ((data[33] << 2) | ((blueWhiteLsb >> 2) & 0x03)) / 1024,
    whiteY: ((data[34] << 2) | (blueWhiteLsb & 0x03)) / 1024,
  };
}

function parseEstablishedTimings(data) {
  const bitmap = (data[35] << 16) | (data[36] << 8) | data[37];
  const timings = [];
  for (let i = 0; i < 17; i++) {
    if (bitmap & (1 << (23 - i))) {
      timings.push(ESTABLISHED_TIMINGS[i]);
    }
  }
  return timings;
}

function parseStandardTimings(data) {
  const timings = [];
  for (let i = 38; i < 54; i += 2) {
    if (data[i] !== 0x01 || data[i + 1] !== 0x01) {
      const xRes = (data[i] + 31) * 8;
      const aspectIndex = (data[i + 1] >> 6) & 0x03;
      const refreshRate = (data[i + 1] & 0x3F) + 60;
      timings.push({
        xResolution: xRes,
        aspectRatio: ASPECT_RATIOS[aspectIndex],
        refreshRate
      });
    }
  }
  return timings;
}

function parseDetailedTimingDescriptor(data, offset) {
  const pixelClock = ((data[offset + 1] << 8) | data[offset]) * 10; // kHz

  if (pixelClock === 0) return null; // Not a timing descriptor

  const hActive = data[offset + 2] | ((data[offset + 4] & 0xF0) << 4);
  const hBlank = data[offset + 3] | ((data[offset + 4] & 0x0F) << 8);
  const vActive = data[offset + 5] | ((data[offset + 7] & 0xF0) << 4);
  const vBlank = data[offset + 6] | ((data[offset + 7] & 0x0F) << 8);

  const hSyncOffset = data[offset + 8] | ((data[offset + 11] & 0xC0) << 2);
  const hSyncPulse = data[offset + 9] | ((data[offset + 11] & 0x30) << 4);
  const vSyncOffset = ((data[offset + 10] >> 4) & 0x0F) | ((data[offset + 11] & 0x0C) << 2);
  const vSyncPulse = (data[offset + 10] & 0x0F) | ((data[offset + 11] & 0x03) << 4);

  const hSize = data[offset + 12] | ((data[offset + 14] & 0xF0) << 4); // mm
  const vSize = data[offset + 13] | ((data[offset + 14] & 0x0F) << 8); // mm

  const flags = data[offset + 17];
  const interlaced = (flags & 0x80) !== 0;
  const syncType = (flags >> 3) & 0x03;

  return {
    pixelClockKHz: pixelClock,
    pixelClockMHz: pixelClock / 1000,
    hActive,
    hBlank,
    hTotal: hActive + hBlank,
    vActive,
    vBlank,
    vTotal: vActive + vBlank,
    hSyncOffset,
    hSyncPulse,
    vSyncOffset,
    vSyncPulse,
    hSizeMm: hSize,
    vSizeMm: vSize,
    interlaced,
    syncType,
    stereoMode: (flags >> 5) & 0x03,
  };
}

function parseDisplayDescriptor(data, offset) {
  // Check if it's a display descriptor (pixel clock = 0)
  if (data[offset] !== 0 || data[offset + 1] !== 0) return null;

  const tag = data[offset + 3];

  // Extract text for text-based descriptors
  const getText = () => {
    const bytes = data.slice(offset + 5, offset + 18);
    let text = '';
    for (const b of bytes) {
      if (b === 0x0A || b === 0x00) break;
      text += String.fromCharCode(b);
    }
    return text.trim();
  };

  switch (tag) {
    case 0xFF: return { type: 'serialNumber', value: getText() };
    case 0xFE: return { type: 'unspecifiedText', value: getText() };
    case 0xFD: return {
      type: 'rangeLimits',
      minVRate: data[offset + 5],
      maxVRate: data[offset + 6],
      minHRate: data[offset + 7],
      maxHRate: data[offset + 8],
      maxPixelClock: data[offset + 9] * 10, // MHz
    };
    case 0xFC: return { type: 'monitorName', value: getText() };
    case 0xFB: return { type: 'whitePointData' };
    case 0xFA: return { type: 'standardTimingIds' };
    case 0xF9: return { type: 'colorManagement' };
    case 0xF8: return { type: 'cvtTimingCodes' };
    case 0xF7: return { type: 'establishedTimingsIII' };
    case 0x10: return { type: 'dummy' };
    default: return { type: 'unknown', tag };
  }
}

function parseDescriptors(data) {
  const descriptors = [];
  const timings = [];

  for (let i = 0; i < 4; i++) {
    const offset = 54 + i * 18;

    // Try as detailed timing first
    const timing = parseDetailedTimingDescriptor(data, offset);
    if (timing) {
      timings.push(timing);
      continue;
    }

    // Try as display descriptor
    const descriptor = parseDisplayDescriptor(data, offset);
    if (descriptor) {
      descriptors.push(descriptor);
    }
  }

  return { timings, descriptors };
}

// ============================================================================
// CEA Extension Block Parsing
// ============================================================================

function parseCeaExtension(data, blockStart) {
  const ext = {
    tag: data[blockStart],
    revision: data[blockStart + 1],
    dtdStart: data[blockStart + 2],
    underscan: (data[blockStart + 3] & 0x80) !== 0,
    basicAudio: (data[blockStart + 3] & 0x40) !== 0,
    ycbcr444: (data[blockStart + 3] & 0x20) !== 0,
    ycbcr422: (data[blockStart + 3] & 0x10) !== 0,
    nativeDtds: data[blockStart + 3] & 0x0F,
    dataBlocks: [],
    detailedTimings: [],
  };

  // Parse data blocks (between byte 4 and dtdStart)
  if (ext.dtdStart > 4) {
    let offset = blockStart + 4;
    const endOffset = blockStart + ext.dtdStart;

    while (offset < endOffset) {
      const header = data[offset];
      const tagCode = (header >> 5) & 0x07;
      const length = header & 0x1F;

      const block = parseDataBlock(data, offset + 1, tagCode, length);
      if (block) {
        ext.dataBlocks.push(block);
      }

      offset += 1 + length;
    }
  }

  // Parse detailed timing descriptors
  if (ext.dtdStart > 0 && ext.dtdStart < 127) {
    let offset = blockStart + ext.dtdStart;
    while (offset + 18 <= blockStart + 127) {
      if (data[offset] === 0 && data[offset + 1] === 0) break;
      const timing = parseDetailedTimingDescriptor(data, offset);
      if (timing) {
        ext.detailedTimings.push(timing);
      }
      offset += 18;
    }
  }

  return ext;
}

function parseDataBlock(data, offset, tagCode, length) {
  switch (tagCode) {
    case DATA_BLOCK_TYPE.AUDIO:
      return parseAudioDataBlock(data, offset, length);
    case DATA_BLOCK_TYPE.VIDEO:
      return parseVideoDataBlock(data, offset, length);
    case DATA_BLOCK_TYPE.VENDOR_SPECIFIC:
      return parseVendorDataBlock(data, offset, length);
    case DATA_BLOCK_TYPE.SPEAKER_ALLOCATION:
      return parseSpeakerDataBlock(data, offset, length);
    case DATA_BLOCK_TYPE.EXTENDED_TAG:
      return parseExtendedDataBlock(data, offset, length);
    default:
      return { type: 'unknown', tagCode, length };
  }
}

function parseAudioDataBlock(data, offset, length) {
  const block = { type: 'audio', descriptors: [] };

  for (let i = 0; i < length; i += 3) {
    const byte1 = data[offset + i];
    const byte2 = data[offset + i + 1];
    const byte3 = data[offset + i + 2];

    const formatCode = (byte1 >> 3) & 0x0F;
    const channels = (byte1 & 0x07) + 1;

    const descriptor = {
      format: AUDIO_FORMATS[formatCode] || `Format ${formatCode}`,
      channels,
      sampleRates: [],
    };

    // Sample rates
    for (let j = 0; j < 7; j++) {
      if (byte2 & (1 << j)) {
        descriptor.sampleRates.push(SAMPLE_RATES[j]);
      }
    }

    // Format-specific byte 3
    if (formatCode === 1) {
      // LPCM - bit depths
      descriptor.bitDepths = [];
      for (let j = 0; j < 3; j++) {
        if (byte3 & (1 << j)) {
          descriptor.bitDepths.push(BIT_DEPTHS[j]);
        }
      }
    } else if (formatCode >= 2 && formatCode <= 8) {
      descriptor.maxBitrate = byte3 * 8; // kbps
    }

    block.descriptors.push(descriptor);
  }

  return block;
}

function parseVideoDataBlock(data, offset, length) {
  const block = { type: 'video', modes: [] };

  for (let i = 0; i < length; i++) {
    const byte = data[offset + i];
    const native = (byte & 0x80) !== 0;
    const vic = byte & 0x7F;

    const format = VIDEO_FORMATS[vic];
    block.modes.push({
      vic,
      native,
      format: format?.format || `VIC ${vic}`,
      rate: format?.rate,
      aspect: format?.aspect,
    });
  }

  return block;
}

function parseVendorDataBlock(data, offset, length) {
  if (length < 3) return { type: 'vendor', error: 'Too short' };

  const ieeeOui = data[offset] | (data[offset + 1] << 8) | (data[offset + 2] << 16);

  const block = {
    type: 'vendor',
    ieeeOui,
    ieeeOuiHex: ieeeOui.toString(16).toUpperCase().padStart(6, '0'),
  };

  if (ieeeOui === IEEE_OUI.HDMI14) {
    block.vendor = 'HDMI 1.4';
    if (length >= 5) {
      block.physicalAddress = `${data[offset + 3]}.${data[offset + 4]}`;
    }
    if (length >= 6) {
      const flags = data[offset + 5];
      block.supportsAi = (flags & 0x80) !== 0;
      block.dc48bit = (flags & 0x40) !== 0;
      block.dc36bit = (flags & 0x20) !== 0;
      block.dc30bit = (flags & 0x10) !== 0;
      block.dcY444 = (flags & 0x08) !== 0;
      block.dviDual = (flags & 0x01) !== 0;
    }
    if (length >= 7) {
      block.maxTmdsClockMHz = data[offset + 6] * 5;
    }
  } else if (ieeeOui === IEEE_OUI.HDMI20) {
    block.vendor = 'HDMI 2.0';
    // HDMI Forum VSDB parsing
    if (length >= 7) {
      block.maxTmdsCharacterRate = data[offset + 4] * 5; // MHz
      const flags1 = data[offset + 5];
      block.scdc = (flags1 & 0x80) !== 0;
      block.rrCapable = (flags1 & 0x40) !== 0;
      block.lte340MscsScramble = (flags1 & 0x08) !== 0;
      block.independentView = (flags1 & 0x04) !== 0;
      block.dualView = (flags1 & 0x02) !== 0;
      block.osd3d = (flags1 & 0x01) !== 0;

      const flags2 = data[offset + 6];
      block.dc48bit420 = (flags2 & 0x04) !== 0;
      block.dc36bit420 = (flags2 & 0x02) !== 0;
      block.dc30bit420 = (flags2 & 0x01) !== 0;
    }
  }

  return block;
}

function parseSpeakerDataBlock(data, offset, length) {
  const block = { type: 'speaker', speakers: [] };

  if (length >= 1) {
    const byte = data[offset];
    for (let i = 0; i < SPEAKER_ALLOCATION.length && i < 8; i++) {
      if (byte & (1 << i)) {
        block.speakers.push(SPEAKER_ALLOCATION[i]);
      }
    }
  }

  return block;
}

function parseExtendedDataBlock(data, offset, length) {
  if (length < 1) return { type: 'extended', error: 'Too short' };

  const extTag = data[offset];

  switch (extTag) {
    case EXTENDED_DATA_BLOCK_TYPE.VIDEO_CAPABILITY:
      return parseVideoCapabilityBlock(data, offset + 1, length - 1);
    case EXTENDED_DATA_BLOCK_TYPE.COLORIMETRY:
      return parseColorimetryBlock(data, offset + 1, length - 1);
    case EXTENDED_DATA_BLOCK_TYPE.HDR_STATIC_METADATA:
      return parseHdrStaticMetadataBlock(data, offset + 1, length - 1);
    case EXTENDED_DATA_BLOCK_TYPE.YCBCR420_VIDEO:
      return parseYcbcr420VideoBlock(data, offset + 1, length - 1);
    case EXTENDED_DATA_BLOCK_TYPE.YCBCR420_CAPABILITY_MAP:
      return { type: 'ycbcr420CapabilityMap', length: length - 1 };
    default:
      return { type: 'extendedUnknown', extTag, length: length - 1 };
  }
}

function parseVideoCapabilityBlock(data, offset, length) {
  if (length < 1) return { type: 'videoCapability', error: 'Too short' };

  const byte = data[offset];
  return {
    type: 'videoCapability',
    quantizationSelectableRgb: (byte & 0x40) !== 0,
    quantizationSelectableYcc: (byte & 0x80) !== 0,
    ptOverscan: OVERSCAN_BEHAVIOR[(byte >> 4) & 0x03],
    itOverscan: OVERSCAN_BEHAVIOR[(byte >> 2) & 0x03],
    ceOverscan: OVERSCAN_BEHAVIOR[byte & 0x03],
  };
}

function parseColorimetryBlock(data, offset, length) {
  if (length < 2) return { type: 'colorimetry', error: 'Too short' };

  const byte1 = data[offset];
  const byte2 = data[offset + 1];

  return {
    type: 'colorimetry',
    xvYcc601: (byte1 & 0x01) !== 0,
    xvYcc709: (byte1 & 0x02) !== 0,
    sYcc601: (byte1 & 0x04) !== 0,
    opYcc601: (byte1 & 0x08) !== 0,
    opRgb: (byte1 & 0x10) !== 0,
    bt2020cYcc: (byte1 & 0x20) !== 0,
    bt2020Ycc: (byte1 & 0x40) !== 0,
    bt2020Rgb: (byte1 & 0x80) !== 0,
    dcip3: (byte2 & 0x80) !== 0,
  };
}

function parseHdrStaticMetadataBlock(data, offset, length) {
  if (length < 2) return { type: 'hdrStaticMetadata', error: 'Too short' };

  const block = {
    type: 'hdrStaticMetadata',
    eotfs: [],
    staticMetadataTypes: [],
  };

  const eotfByte = data[offset];
  for (let i = 0; i < 4; i++) {
    if (eotfByte & (1 << i)) {
      block.eotfs.push(EOTF_TYPES[i]);
    }
  }

  const smByte = data[offset + 1];
  if (smByte & 0x01) {
    block.staticMetadataTypes.push('Static Metadata Type 1');
  }

  if (length >= 3) {
    block.maxLuminance = data[offset + 2];
  }
  if (length >= 4) {
    block.maxFrameAvgLuminance = data[offset + 3];
  }
  if (length >= 5) {
    block.minLuminance = data[offset + 4];
  }

  return block;
}

function parseYcbcr420VideoBlock(data, offset, length) {
  const block = { type: 'ycbcr420Video', modes: [] };

  for (let i = 0; i < length; i++) {
    const vic = data[offset + i];
    const format = VIDEO_FORMATS[vic];
    block.modes.push({
      vic,
      format: format?.format || `VIC ${vic}`,
      rate: format?.rate,
    });
  }

  return block;
}

// ============================================================================
// Main Decode Function
// ============================================================================

/**
 * Decode EDID data into a structured object.
 * @param {Uint8Array} data - Raw EDID bytes (128+ bytes)
 * @returns {Object} Decoded EDID information
 */
export function decodeEdid(data) {
  if (!data || data.length < 128) {
    return { error: 'EDID too short (need at least 128 bytes)' };
  }

  const result = {
    // Validation
    headerValid: validateHeader(data),
    checksumValid: validChecksum(data, 0),

    // Basic identification
    manufacturerId: parseManufacturerId(data),
    productCode: parseProductCode(data),
    productCodeHex: parseProductCode(data).toString(16).toUpperCase().padStart(4, '0'),
    serialNumber: parseSerialNumber(data),
    serialNumberHex: parseSerialNumber(data).toString(16).toUpperCase().padStart(8, '0'),

    // Date
    ...parseManufactureDate(data),
    get manufactureYear() { return this.year; },
    get manufactureWeek() { return this.week; },

    // Version
    edidVersion: (() => {
      const v = parseVersion(data);
      return `${v.version}.${v.revision}`;
    })(),
    versionInfo: parseVersion(data),

    // Display parameters
    displayParams: parseBasicDisplayParams(data),
    screenSizeCm: {
      widthCm: data[21],
      heightCm: data[22],
    },
    gamma: data[23] === 0xFF ? null : (data[23] + 100) / 100,

    // Chromaticity
    chromaticity: parseChromaticity(data),

    // Timings
    establishedTimings: parseEstablishedTimings(data),
    standardTimings: parseStandardTimings(data),

    // Extension count
    extensionCount: data[126],
  };

  // Parse descriptors (timings and display descriptors)
  const { timings, descriptors } = parseDescriptors(data);
  result.detailedTimings = timings;
  result.descriptors = descriptors;

  // Extract common fields from descriptors
  result.monitorName = descriptors.find(d => d.type === 'monitorName')?.value || null;
  result.serialString = descriptors.find(d => d.type === 'serialNumber')?.value || null;
  result.rangeLimits = descriptors.find(d => d.type === 'rangeLimits') || null;

  // Preferred resolution (first detailed timing)
  if (timings.length > 0) {
    result.preferredResolution = {
      width: timings[0].hActive,
      height: timings[0].vActive,
      pixelClockMHz: timings[0].pixelClockMHz,
      interlaced: timings[0].interlaced,
    };
  }

  // Video input type (convenience)
  result.videoInput = {
    digital: result.displayParams.digital,
    interface: result.displayParams.interface || (result.displayParams.digital ? 'digital' : 'analog'),
    bitDepth: result.displayParams.bitDepth,
  };

  // Parse extension blocks
  result.extensions = [];
  for (let i = 0; i < result.extensionCount && (i + 1) * 128 + 128 <= data.length; i++) {
    const blockStart = (i + 1) * 128;
    const extTag = data[blockStart];

    if (extTag === 0x02) {
      // CEA-861 extension
      const ceaExt = parseCeaExtension(data, blockStart);
      ceaExt.checksumValid = validChecksum(data, i + 1);
      result.extensions.push(ceaExt);
    } else {
      result.extensions.push({
        tag: extTag,
        checksumValid: validChecksum(data, i + 1),
      });
    }
  }

  // Aggregate data from extensions
  result.audioFormats = [];
  result.videoModes = [];
  result.hdmiInfo = null;
  result.hdrInfo = null;
  result.colorimetry = null;

  for (const ext of result.extensions) {
    if (ext.dataBlocks) {
      for (const block of ext.dataBlocks) {
        if (block.type === 'audio') {
          result.audioFormats.push(...block.descriptors);
        } else if (block.type === 'video') {
          result.videoModes.push(...block.modes);
        } else if (block.type === 'vendor' && (block.vendor?.includes('HDMI'))) {
          result.hdmiInfo = block;
        } else if (block.type === 'hdrStaticMetadata') {
          result.hdrInfo = block;
        } else if (block.type === 'colorimetry') {
          result.colorimetry = block;
        }
      }
    }
  }

  return result;
}

// ============================================================================
// EdidDecoder Class (for compatibility and stateful usage)
// ============================================================================

export class EdidDecoder {
  constructor() {
    this.data = null;
    this.parsed = null;
  }

  setData(data) {
    this.data = data instanceof Uint8Array ? data : new Uint8Array(data);
    this.parsed = null;
  }

  parse() {
    if (!this.data) {
      throw new Error('No EDID data set');
    }
    this.parsed = decodeEdid(this.data);
    return this.parsed;
  }

  get result() {
    if (!this.parsed) {
      this.parse();
    }
    return this.parsed;
  }
}

export default decodeEdid;
