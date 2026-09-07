#!/usr/bin/env python3
"""Verify a 720p/30 H.264 MP4 using stdlib + an explicitly supplied FFmpeg.

Usage: python3 verify-video.py VIDEO.mp4 /path/to/ffmpeg [SECONDS] [--json report.json]
SECONDS defaults to 58.8 for the September 7 README film. Exit 0 means pass.
"""

import argparse
import json
import math
import re
import struct
import subprocess
import sys
from pathlib import Path


def top_level_boxes(path):
    """Read headers only; skip media payloads, supporting 64-bit and EOF sizes."""
    length = path.stat().st_size
    boxes = []
    with path.open("rb") as stream:
        offset = 0
        while offset < length:
            stream.seek(offset)
            header = stream.read(8)
            if len(header) != 8:
                raise ValueError(f"Truncated MP4 box header at byte {offset}")
            size, kind = struct.unpack(">I4s", header)
            header_size = 8
            if size == 1:
                extended = stream.read(8)
                if len(extended) != 8:
                    raise ValueError(f"Truncated extended box size at byte {offset}")
                size = struct.unpack(">Q", extended)[0]
                header_size = 16
            elif size == 0:
                size = length - offset
            if size < header_size or offset + size > length:
                raise ValueError(f"Invalid MP4 box size {size} at byte {offset}")
            boxes.append({"type": kind.decode("ascii", "replace"),
                          "offset": offset, "size": size})
            offset += size
    return boxes


def verify(video, ffmpeg, seconds):
    command = [str(ffmpeg), "-hide_banner", "-nostdin", "-xerror",
               "-err_detect", "explode", "-i", str(video),
               "-map", "0:v:0", "-an", "-sn", "-dn",
               "-vf", "blackdetect=d=0.03:pix_th=0.08:pic_th=0.98",
               "-fps_mode", "passthrough", "-progress", "pipe:1",
               "-nostats", "-f", "null", "-"]
    run = subprocess.run(command, capture_output=True, text=True, errors="replace")
    log = run.stderr
    input_log = log.split("Stream mapping:", 1)[0]
    video_line = next((line for line in input_log.splitlines()
                       if "Stream #0:" in line and "Video:" in line), "")
    codec = re.search(r"Video:\s*([\w]+)", video_line)
    dimensions = re.search(r"\b(\d{2,5})x(\d{2,5})\b", video_line)
    fps = re.search(r"\b([\d.]+)\s+fps\b", video_line)
    duration = re.search(r"Duration:\s*(\d+):(\d+):([\d.]+)", input_log)
    frame_values = re.findall(r"^frame=\s*(\d+)\s*$", run.stdout, re.MULTILINE)
    actual = {
        "codec": codec.group(1) if codec else None,
        "width": int(dimensions.group(1)) if dimensions else None,
        "height": int(dimensions.group(2)) if dimensions else None,
        "fps": float(fps.group(1)) if fps else None,
        "duration_seconds": (int(duration.group(1)) * 3600
                             + int(duration.group(2)) * 60
                             + float(duration.group(3))) if duration else None,
        "decoded_frames": int(frame_values[-1]) if frame_values else None,
    }
    number = r"([-+\d.eE]+)"
    black = [{"start": float(a), "end": float(b), "duration": float(c)}
             for a, b, c in re.findall(
                 r"black_start:" + number + r"\s+black_end:" + number
                 + r"\s+black_duration:" + number, log)]
    boxes = top_level_boxes(video)
    moov = next((box["offset"] for box in boxes if box["type"] == "moov"), None)
    mdat = next((box["offset"] for box in boxes if box["type"] == "mdat"), None)
    expected_frames = round(seconds * 30)
    checks = {
        "full_decode": run.returncode == 0 and "progress=end" in run.stdout,
        "h264": actual["codec"] == "h264",
        "1280x720": actual["width"] == 1280 and actual["height"] == 720,
        "30_fps": actual["fps"] == 30,
        "duration": actual["duration_seconds"] is not None
                    and abs(actual["duration_seconds"] - seconds) <= 1 / 30 + 1e-6,
        "decoded_frame_count": actual["decoded_frames"] == expected_frames,
        "no_black_intervals": not black,
        "faststart": moov is not None and mdat is not None and moov < mdat,
        "below_10_MB": video.stat().st_size < 10_000_000,
    }
    report = {"passed": all(checks.values()), "video": video.name, "bytes": video.stat().st_size,
              "expected": {"width": 1280, "height": 720, "codec": "h264",
                           "fps": 30, "duration_seconds": seconds,
                           "decoded_frames": expected_frames},
              "actual": actual, "checks": checks, "black_intervals": black,
              "top_level_boxes": boxes, "ffmpeg_exit_code": run.returncode}
    if not report["passed"]:
        report["ffmpeg_stderr_tail"] = log[-3500:]
    return report


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("mp4", type=Path)
    parser.add_argument("ffmpeg", type=Path)
    parser.add_argument("expected_seconds", nargs="?", type=float, default=58.8)
    parser.add_argument("--json", dest="json_path", type=Path,
                        help="Also save the JSON report to this path")
    args = parser.parse_args()
    if not math.isfinite(args.expected_seconds) or args.expected_seconds <= 0:
        parser.error("SECONDS must be finite and greater than zero")
    if abs(args.expected_seconds * 30 - round(args.expected_seconds * 30)) > 1e-6:
        parser.error("SECONDS must describe a whole number of frames at 30 fps")
    try:
        report = verify(args.mp4, args.ffmpeg, args.expected_seconds)
    except (OSError, ValueError) as error:
        report = {"passed": False, "video": str(args.mp4), "error": str(error)}
    output = json.dumps(report, indent=2, ensure_ascii=False) + "\n"
    sys.stdout.write(output)
    if args.json_path:
        try:
            args.json_path.write_text(output, encoding="utf-8")
        except OSError as error:
            print(f"Cannot save JSON report: {error}", file=sys.stderr)
            return 2
    return 0 if report["passed"] else 1


if __name__ == "__main__":
    sys.exit(main())
