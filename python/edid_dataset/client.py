"""Python client for EDID dataset lookups."""

import json
import mmap
import struct
from dataclasses import dataclass
from pathlib import Path


@dataclass
class EdidEntry:
    """A single EDID entry from the dataset."""

    md5_hex: str
    raw_edid: bytes
    year: int | None = None
    width_px: int | None = None
    height_px: int | None = None
    width_mm: int | None = None
    height_mm: int | None = None
    display_type: str | None = None


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

        # Lazy load indexes
        self._vendor_index: dict | None = None
        self._resolution_index: dict | None = None
        self._year_index: dict | None = None

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

    def get(self, md5_hex: str) -> EdidEntry | None:
        """Look up an EDID by its MD5 hex string."""
        if len(md5_hex) < 2:
            return None

        # Convert hex to bytes for lookup
        try:
            md5_bytes = bytes.fromhex(md5_hex.ljust(32, "0"))
        except ValueError:
            return None

        prefix = md5_bytes[0]
        remaining = md5_bytes[1:]

        # Get bucket
        bucket = self._get_bucket(prefix)
        if bucket is None:
            return None

        # Binary search in bucket
        return self._search_bucket(bucket, prefix, remaining, md5_hex)

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
        md5_hex: str,
    ) -> EdidEntry | None:
        """Binary search within a bucket for the given key."""
        # Parse header
        magic = bucket[0:4]
        if magic != b"EDIB":
            return None

        version, entry_count, values_offset = struct.unpack_from("<HHI", bucket, 4)

        if entry_count == 0:
            return None

        # Key section starts at offset 16
        keys_offset = 16
        metadata_offset = keys_offset + entry_count * 15
        offsets_offset = metadata_offset + entry_count * 16

        # Binary search
        low, high = 0, entry_count - 1
        while low <= high:
            mid = (low + high) // 2
            key_start = keys_offset + mid * 15
            key = bucket[key_start : key_start + 15]

            if key < remaining[:15]:
                low = mid + 1
            elif key > remaining[:15]:
                high = mid - 1
            else:
                # Found it
                return self._read_entry(bucket, mid, md5_hex, metadata_offset, offsets_offset, values_offset)

        return None

    def _read_entry(
        self,
        bucket: mmap.mmap,
        index: int,
        md5_hex: str,
        metadata_offset: int,
        offsets_offset: int,
        values_offset: int,
    ) -> EdidEntry:
        """Read entry data from bucket."""
        # Read metadata
        meta_start = metadata_offset + index * 16
        (
            vendor_id,
            model_id,
            year,
            width_px,
            height_px,
            width_mm,
            height_mm,
            dtype_val,
            flags,
        ) = struct.unpack_from("<HHHHHHHBB", bucket, meta_start)

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
        # EDID is either 128 or 256 bytes typically
        if len(raw_edid) > 128 and raw_edid[126] == 0:
            raw_edid = raw_edid[:128]

        dtype = {0: "analog", 1: "digital", 2: None}.get(dtype_val)

        return EdidEntry(
            md5_hex=md5_hex[:32],
            raw_edid=raw_edid,
            year=year if year else None,
            width_px=width_px if width_px else None,
            height_px=height_px if height_px else None,
            width_mm=width_mm if width_mm else None,
            height_mm=height_mm if height_mm else None,
            display_type=dtype,
        )

    @property
    def vendor_index(self) -> dict:
        """Lazy-load vendor index."""
        if self._vendor_index is None:
            path = self.data_path / "metadata" / "vendors.json"
            if path.exists():
                self._vendor_index = json.loads(path.read_text())
            else:
                self._vendor_index = {}
        return self._vendor_index

    @property
    def resolution_index(self) -> dict:
        """Lazy-load resolution index."""
        if self._resolution_index is None:
            path = self.data_path / "metadata" / "resolutions.json"
            if path.exists():
                self._resolution_index = json.loads(path.read_text())
            else:
                self._resolution_index = {}
        return self._resolution_index

    def get_by_vendor(self, vendor: str) -> list[str]:
        """Get all MD5 hashes for a vendor."""
        return self.vendor_index.get(vendor, [])

    def get_by_resolution(self, width: int, height: int) -> list[str]:
        """Get all MD5 hashes for a resolution."""
        key = f"{width}x{height}"
        return self.resolution_index.get(key, [])

    def list_vendors(self) -> list[str]:
        """List all vendors in the dataset."""
        return list(self.vendor_index.keys())

    def list_resolutions(self) -> list[str]:
        """List all resolutions in the dataset."""
        return list(self.resolution_index.keys())
