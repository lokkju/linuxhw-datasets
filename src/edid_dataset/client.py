"""Python client for EDID dataset lookups."""

import json
import mmap
import struct
from dataclasses import dataclass
from pathlib import Path


@dataclass
class EdidEntry:
    """A single EDID entry from the dataset."""

    linuxhw_id: str  # 12-char hex identifier from linuxhw/EDID repo
    raw_edid: bytes
    vendor_name: str = ""  # Vendor directory name (e.g., "Samsung", "Dell")


class EdidDataset:
    """Client for querying the EDID dataset."""

    def __init__(self, data_path: Path | str):
        self.data_path = Path(data_path)
        self._bucket_cache: dict[int, mmap.mmap] = {}
        self._bucket_files: dict[int, object] = {}

        # Load manifest
        manifest_path = self.data_path / "manifest.json"
        if manifest_path.exists():
            self._manifest = json.loads(manifest_path.read_text())
        else:
            self._manifest = {}

        # Cache bucket format version
        self._bucket_format = self._manifest.get("bucket_format", 1)

    def __del__(self):
        """Clean up memory-mapped files."""
        for mm in self._bucket_cache.values():
            mm.close()
        for f in self._bucket_files.values():
            f.close()

    @property
    def count(self) -> int:
        """Total number of EDID entries."""
        return self._manifest.get("total_entries", 0)

    def get(self, linuxhw_id: str) -> EdidEntry | None:
        """Look up an EDID by its linuxhw ID (12-char hex string)."""
        if len(linuxhw_id) != 12:
            return None

        # Convert hex to bytes for lookup
        try:
            id_bytes = bytes.fromhex(linuxhw_id)
        except ValueError:
            return None

        prefix = id_bytes[0]
        remaining = id_bytes[1:6]  # 5 bytes for v3 format

        # Get bucket
        bucket = self._get_bucket(prefix)
        if bucket is None:
            return None

        # Binary search in bucket
        return self._search_bucket(bucket, prefix, remaining, linuxhw_id)

    def _get_bucket(self, prefix: int) -> mmap.mmap | None:
        """Get memory-mapped bucket file."""
        if prefix in self._bucket_cache:
            return self._bucket_cache[prefix]

        bucket_path = self.data_path / "buckets" / f"{prefix:02x}.bin"
        if not bucket_path.exists():
            return None

        f = open(bucket_path, "rb")
        mm = mmap.mmap(f.fileno(), 0, access=mmap.ACCESS_READ)
        self._bucket_files[prefix] = f
        self._bucket_cache[prefix] = mm
        return mm

    def _search_bucket(
        self,
        bucket: mmap.mmap,
        prefix: int,
        remaining: bytes,
        linuxhw_id: str,
    ) -> EdidEntry | None:
        """Binary search within a bucket for the given key."""
        # Parse header
        magic = bucket[0:4]
        if magic != b"EDIB":
            return None

        version, entry_count, values_offset = struct.unpack_from("<HHI", bucket, 4)
        vendor_table_offset = struct.unpack_from("<I", bucket, 12)[0]

        if entry_count == 0:
            return None

        # v4 format: 5 bytes per key, 1 byte vendor index, 4 bytes offset
        keys_offset = 16
        key_size = 5
        vendor_indexes_offset = keys_offset + entry_count * key_size
        offsets_offset = vendor_indexes_offset + entry_count

        # Parse vendor string table
        vendor_table = self._parse_vendor_table(bucket, vendor_table_offset)

        # Binary search
        low, high = 0, entry_count - 1
        while low <= high:
            mid = (low + high) // 2
            key_start = keys_offset + mid * key_size
            key = bucket[key_start : key_start + key_size]

            if key < remaining:
                low = mid + 1
            elif key > remaining:
                high = mid - 1
            else:
                # Found it - get vendor name
                vendor_idx = bucket[vendor_indexes_offset + mid]
                vendor_name = vendor_table[vendor_idx] if vendor_idx < len(vendor_table) else ""
                return self._read_entry(bucket, mid, linuxhw_id, offsets_offset, values_offset, vendor_name)

        return None

    def _parse_vendor_table(self, bucket: mmap.mmap, offset: int) -> list[str]:
        """Parse the vendor string table from a bucket."""
        vendor_count = bucket[offset]
        vendors = []
        pos = offset + 1
        for _ in range(vendor_count):
            length = bucket[pos]
            pos += 1
            vendor = bytes(bucket[pos : pos + length]).decode("utf-8")
            vendors.append(vendor)
            pos += length
        return vendors

    def _read_entry(
        self,
        bucket: mmap.mmap,
        index: int,
        linuxhw_id: str,
        offsets_offset: int,
        values_offset: int,
        vendor_name: str = "",
    ) -> EdidEntry:
        """Read entry data from bucket."""
        # Read offset
        offset_start = offsets_offset + index * 4
        packed = struct.unpack_from("<I", bucket, offset_start)[0]
        offset = packed & 0xFFFFFF
        length_div4 = (packed >> 24) & 0xFF
        length = length_div4 * 4

        # Read raw EDID
        edid_start = values_offset + offset
        raw_edid = bytes(bucket[edid_start : edid_start + length])

        # Trim to actual EDID length (remove padding)
        # EDID is either 128 or 256+ bytes typically
        if len(raw_edid) > 128 and raw_edid[126] == 0:
            raw_edid = raw_edid[:128]

        return EdidEntry(
            linuxhw_id=linuxhw_id.upper(),
            raw_edid=raw_edid,
            vendor_name=vendor_name,
        )

    def get_vendor_mapping(self) -> dict[str, str]:
        """Get vendor code to human-readable name mapping.

        Note: As of v4 bucket format, vendor names are stored per-entry in the
        bucket files, so this mapping is no longer needed for most use cases.
        This method is kept for backward compatibility.
        """
        path = self.data_path / "vendors.json"
        if path.exists():
            return json.loads(path.read_text())
        return {}
