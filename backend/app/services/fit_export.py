"""
Generate a Garmin FIT workout file from a structured session dict.

The FIT binary format:
  - 14-byte file header (with its own 2-byte CRC)
  - Records: alternating Definition and Data messages
  - 2-byte CRC of all records

Each Definition message declares the field layout for a local message type.
Subsequent Data messages with the same local type carry the actual values.

Reference: Flexible & Interoperable Data Transfer (FIT) Protocol spec v2.
"""
from __future__ import annotations

import re
import struct
from datetime import datetime, timezone

# FIT time epoch = 1989-12-31 00:00:00 UTC
_FIT_EPOCH = 631065600

# Base type codes used in Definition messages
_ENUM   = 0x00  # 1 byte
_UINT8  = 0x02  # 1 byte
_UINT16 = 0x84  # 2 bytes (endian-capable)
_UINT32 = 0x86  # 4 bytes (endian-capable)
_STRING = 0x07  # variable-length, null-terminated

# Invalid sentinel for uint32 fields
_INVALID_UINT32 = 0xFFFFFFFF

_CRC_TABLE = [
    0x0000, 0xCC01, 0xD801, 0x1400, 0xF001, 0x3C00, 0x2800, 0xE401,
    0xA001, 0x6C00, 0x7800, 0xB401, 0x5000, 0x9C01, 0x8801, 0x4400,
]


def _crc(data: bytes, seed: int = 0) -> int:
    crc = seed
    for byte in data:
        tmp = _CRC_TABLE[crc & 0x0F]
        crc = (crc >> 4) & 0x0FFF
        crc ^= tmp ^ _CRC_TABLE[byte & 0x0F]
        tmp = _CRC_TABLE[crc & 0x0F]
        crc = (crc >> 4) & 0x0FFF
        crc ^= tmp ^ _CRC_TABLE[(byte >> 4) & 0x0F]
    return crc


def _padded_str(s: str, size: int) -> bytes:
    """Null-padded fixed-size string field."""
    enc = s.encode("utf-8", errors="replace")[:size - 1]
    return enc + b"\x00" * (size - len(enc))


def _def_msg(local_num: int, global_num: int, fields: list[tuple[int, int, int]]) -> bytes:
    """
    Build a FIT Definition record.
    fields: [(field_def_num, byte_size, base_type_code), ...]
    """
    rec = struct.pack("BB", 0x40 | local_num, 0x00)       # header | local_num, reserved
    rec += struct.pack("<BHB", 0, global_num, len(fields)) # arch=LE, global_msg_num, n_fields
    for fnum, fsize, ftype in fields:
        rec += struct.pack("BBB", fnum, fsize, ftype)
    return rec


def _data_msg(local_num: int, payload: bytes) -> bytes:
    return bytes([local_num]) + payload


# ─── Step encoding ─────────────────────────────────────────────────────────────

_INTENSITY_ACTIVE   = 0
_INTENSITY_REST     = 1
_INTENSITY_WARMUP   = 2
_INTENSITY_COOLDOWN = 3

_TARGET_HEART_RATE = 1
_TARGET_OPEN       = 2
_TARGET_POWER      = 4

_SPORT = {"CYCLING": 2, "RUNNING": 1, "XC_SKIING": 11}


def _parse_watts(target: str | None) -> tuple[int | None, int | None]:
    """Extract (low_watts, high_watts) from a target string like '266–294 W (95–105% FTP)'."""
    if not target:
        return None, None
    m = re.search(r"(\d+)\s*[–\-]\s*(\d+)\s*W", target)
    if m:
        return int(m.group(1)), int(m.group(2))
    m = re.search(r"(\d+)\s*W", target)
    if m:
        w = int(m.group(1))
        return w, w
    return None, None


def _parse_bpm(target: str | None) -> tuple[int | None, int | None]:
    """Extract (low_bpm, high_bpm) from a target string like '145–162 bpm (Z4)'."""
    if not target:
        return None, None
    m = re.search(r"(\d+)\s*[–\-]\s*(\d+)\s*bpm", target)
    if m:
        return int(m.group(1)), int(m.group(2))
    return None, None


def _encode_step(step: dict, intensity: int) -> tuple[int, int, int, int]:
    """
    Return (target_type, target_low, target_high, duration_ms).

    Power and HR values are stored with a +1 offset per the FIT profile spec
    (custom_target_power/hr fields use offset=1 so 0 is a valid zero-sentinel).
    """
    duration_ms = int(step.get("duration_minutes", 1) * 60 * 1000)

    if intensity in (_INTENSITY_REST, _INTENSITY_COOLDOWN):
        return _TARGET_OPEN, _INVALID_UINT32, _INVALID_UINT32, duration_ms

    target = step.get("target", "")
    pwr_lo, pwr_hi = _parse_watts(target)
    if pwr_lo is not None:
        return _TARGET_POWER, pwr_lo + 1, pwr_hi + 1, duration_ms

    hr_lo, hr_hi = _parse_bpm(target)
    if hr_lo is not None:
        return _TARGET_HEART_RATE, hr_lo + 1, hr_hi + 1, duration_ms

    return _TARGET_OPEN, _INVALID_UINT32, _INVALID_UINT32, duration_ms


# ─── Main export function ──────────────────────────────────────────────────────

def session_to_fit(session: dict, workout_name: str, sport: str = "CYCLING") -> bytes:
    """
    Convert a structured session dict to a Garmin FIT workout binary.

    The file can be placed in GARMIN/WORKOUT/ on a USB-connected device,
    or imported into Garmin Connect to be sent wirelessly.
    """
    sport_val = _SPORT.get(sport, 2)
    now_fit = max(0, int(datetime.now(timezone.utc).timestamp()) - _FIT_EPOCH)

    # ── Collect all FIT steps ──────────────────────────────────────────────────
    fit_steps: list[dict] = []

    if session.get("warmup_minutes", 0) > 0:
        fit_steps.append({
            "duration_minutes": session["warmup_minutes"],
            "intensity": _INTENSITY_WARMUP,
            "target": None,
            "notes": session.get("warmup_notes") or "",
        })

    for step in session.get("intervals", []):
        intensity = _INTENSITY_ACTIVE if step["type"] == "work" else _INTENSITY_REST
        fit_steps.append({
            "duration_minutes": step["duration_minutes"],
            "intensity": intensity,
            "target": step.get("target"),
            "notes": step.get("notes") or "",
        })

    if session.get("cooldown_minutes", 0) > 0:
        fit_steps.append({
            "duration_minutes": session["cooldown_minutes"],
            "intensity": _INTENSITY_COOLDOWN,
            "target": None,
            "notes": session.get("cooldown_notes") or "",
        })

    # ── Build FIT records ──────────────────────────────────────────────────────
    records = bytearray()

    # Local 0 = file_id (global 0)
    records += _def_msg(0, 0, [
        (0, 1, _UINT8),   # type
        (1, 2, _UINT16),  # manufacturer
        (2, 2, _UINT16),  # product
        (4, 4, _UINT32),  # time_created
    ])
    records += _data_msg(0,
        struct.pack("<B", 5) +           # type = workout
        struct.pack("<H", 255) +         # manufacturer = development
        struct.pack("<H", 1) +           # product
        struct.pack("<I", now_fit)
    )

    # Local 1 = workout (global 26)
    name_field_size = 16
    records += _def_msg(1, 26, [
        (4, 2, _UINT16),               # num_valid_steps
        (5, name_field_size, _STRING), # wkt_name
        (8, 1, _UINT8),               # sport
    ])
    records += _data_msg(1,
        struct.pack("<H", len(fit_steps)) +
        _padded_str(workout_name, name_field_size) +
        struct.pack("<B", sport_val)
    )

    # Local 2 = workout_step (global 27)
    # Fields: message_index, intensity, duration_type, duration_value,
    #         target_type, custom_target_value_low, custom_target_value_high
    records += _def_msg(2, 27, [
        (0,  2, _UINT16),  # message_index
        (3,  1, _ENUM),    # intensity
        (4,  1, _ENUM),    # duration_type (0=time)
        (5,  4, _UINT32),  # duration_value (ms)
        (11, 1, _ENUM),    # target_type
        (28, 4, _UINT32),  # custom_target_value_low
        (29, 4, _UINT32),  # custom_target_value_high
    ])

    for i, step in enumerate(fit_steps):
        tgt_type, tgt_lo, tgt_hi, dur_ms = _encode_step(step, step["intensity"])
        records += _data_msg(2,
            struct.pack("<H", i) +
            struct.pack("<B", step["intensity"]) +
            struct.pack("<B", 0) +          # duration_type = time
            struct.pack("<I", dur_ms) +
            struct.pack("<B", tgt_type) +
            struct.pack("<I", tgt_lo) +
            struct.pack("<I", tgt_hi)
        )

    # ── Assemble file ──────────────────────────────────────────────────────────
    data_size = len(records)
    header = struct.pack("<BBHI",
        14,     # header size
        0x10,   # protocol version 1.0
        2154,   # profile version 21.54
        data_size,
    ) + b".FIT"
    header += struct.pack("<H", _crc(header))  # header CRC

    file_crc = _crc(bytes(records))
    return header + bytes(records) + struct.pack("<H", file_crc)
