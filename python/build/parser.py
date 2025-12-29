"""Parse edid-decode text files from linuxhw/EDID repository."""

import hashlib
import re
from dataclasses import dataclass
from pathlib import Path


@dataclass
class ParsedEdid:
    """Parsed EDID data from an edid-decode text file."""

    md5_hash: bytes  # 16 bytes
    md5_hex: str  # 32 char hex string
    raw_edid: bytes  # 128-512 bytes

    # Parsed metadata
    vendor: str | None = None
    model: str | None = None
    product_name: str | None = None
    serial_number: str | None = None
    manufacture_year: int | None = None
    manufacture_week: int | None = None

    # Display properties
    width_px: int | None = None
    height_px: int | None = None
    width_mm: int | None = None
    height_mm: int | None = None
    display_type: str | None = None  # 'digital' or 'analog'

    # Source info
    source_path: str = ""


# Regex patterns for parsing edid-decode output
HEX_LINE_PATTERN = re.compile(r"^([0-9a-f]{2}(?: [0-9a-f]{2}){15})$", re.IGNORECASE)
MANUFACTURER_PATTERN = re.compile(r"Manufacturer:\s+(\w+)")
MODEL_PATTERN = re.compile(r"Model:\s+(\d+)")
MADE_IN_PATTERN = re.compile(r"Made in:.*?(\d{4})")
MADE_IN_WEEK_PATTERN = re.compile(r"Made in:\s*week\s*(\d+)")
DISPLAY_NAME_PATTERN = re.compile(r"Display Product Name:\s*'([^']*)'")
SERIAL_PATTERN = re.compile(r"Display Product Serial Number:\s*'([^']*)'")
NATIVE_RES_PATTERN = re.compile(r"(\d+)x(\d+).*?Hz.*?native")
DTD_RES_PATTERN = re.compile(r"DTD\s+\d+:\s+(\d+)x(\d+)")
SIZE_MM_PATTERN = re.compile(r"Maximum image size:\s*(\d+)\s*cm\s*x\s*(\d+)\s*cm")
DIGITAL_PATTERN = re.compile(r"Digital display")
ANALOG_PATTERN = re.compile(r"Analog display")


def extract_hex_bytes(content: str) -> bytes | None:
    """Extract raw EDID bytes from edid-decode hex dump."""
    hex_lines = []
    for line in content.splitlines():
        line = line.strip()
        match = HEX_LINE_PATTERN.match(line)
        if match:
            hex_lines.append(match.group(1).replace(" ", ""))

    if not hex_lines:
        return None

    hex_string = "".join(hex_lines)
    try:
        return bytes.fromhex(hex_string)
    except ValueError:
        return None


def parse_metadata(content: str, edid_bytes: bytes) -> dict:
    """Parse metadata from edid-decode text output."""
    metadata = {}

    # Manufacturer
    match = MANUFACTURER_PATTERN.search(content)
    if match:
        metadata["vendor"] = match.group(1)

    # Model number
    match = MODEL_PATTERN.search(content)
    if match:
        metadata["model"] = match.group(1)

    # Manufacture year
    match = MADE_IN_PATTERN.search(content)
    if match:
        metadata["manufacture_year"] = int(match.group(1))

    # Manufacture week
    match = MADE_IN_WEEK_PATTERN.search(content)
    if match:
        metadata["manufacture_week"] = int(match.group(1))

    # Display product name
    match = DISPLAY_NAME_PATTERN.search(content)
    if match:
        metadata["product_name"] = match.group(1).strip()

    # Serial number
    match = SERIAL_PATTERN.search(content)
    if match:
        metadata["serial_number"] = match.group(1).strip()

    # Resolution - try native first, then DTD
    match = NATIVE_RES_PATTERN.search(content)
    if match:
        metadata["width_px"] = int(match.group(1))
        metadata["height_px"] = int(match.group(2))
    else:
        match = DTD_RES_PATTERN.search(content)
        if match:
            metadata["width_px"] = int(match.group(1))
            metadata["height_px"] = int(match.group(2))

    # Physical size in mm (convert from cm)
    match = SIZE_MM_PATTERN.search(content)
    if match:
        metadata["width_mm"] = int(match.group(1)) * 10
        metadata["height_mm"] = int(match.group(2)) * 10

    # Display type
    if DIGITAL_PATTERN.search(content):
        metadata["display_type"] = "digital"
    elif ANALOG_PATTERN.search(content):
        metadata["display_type"] = "analog"

    return metadata


def parse_edid_file(file_path: Path) -> ParsedEdid | None:
    """Parse a single edid-decode text file."""
    try:
        content = file_path.read_text(encoding="utf-8", errors="replace")
    except OSError:
        return None

    raw_edid = extract_hex_bytes(content)
    if raw_edid is None:
        return None

    # Compute MD5 hash
    md5_hash = hashlib.md5(raw_edid).digest()
    md5_hex = md5_hash.hex()

    # Parse metadata
    metadata = parse_metadata(content, raw_edid)

    return ParsedEdid(
        md5_hash=md5_hash,
        md5_hex=md5_hex,
        raw_edid=raw_edid,
        source_path=str(file_path),
        **metadata,
    )


def validate_edid_checksum(edid_bytes: bytes) -> bool:
    """Validate EDID checksum (sum of first 128 bytes should be 0 mod 256)."""
    if len(edid_bytes) < 128:
        return False
    return sum(edid_bytes[:128]) % 256 == 0
