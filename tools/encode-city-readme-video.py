#!/usr/bin/env python3
"""Encode the complete Vancouver-3D-City film as a <10 MB GitHub preview.

Requires FFmpeg with libx264. Takes the finished MP4, never the raw capture.
Two-pass bitrate allocation preserves the full edit, titles and 30 fps.
"""
import argparse
import json
from pathlib import Path
import subprocess
import tempfile


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('source', type=Path, help='Finished Vancouver-3D-City.mp4')
    parser.add_argument('--ffmpeg', default='ffmpeg')
    parser.add_argument('--output', type=Path, default=Path(__file__).resolve().parents[1]
                        / 'docs/videos/2026-09-07/Vancouver-3D-City-readme.mp4')
    args = parser.parse_args()
    source, output = args.source.resolve(), args.output.resolve()
    if not source.is_file():
        parser.error('The finished source MP4 does not exist.')
    if source == output:
        parser.error('Source and output must differ; preserve the original film.')
    if output.exists():
        parser.error('Output already exists; choose a new output path.')
    output.parent.mkdir(parents=True, exist_ok=True)
    with tempfile.TemporaryDirectory(prefix='vancouver-readme-') as temporary:
        common = [args.ffmpeg, '-hide_banner', '-loglevel', 'warning', '-nostdin',
                  '-y', '-i', str(source), '-map', '0:v:0', '-an',
                  '-vf', 'scale=1280:720:flags=lanczos',
                  '-c:v', 'libx264', '-preset', 'slow', '-b:v', '1100k',
                  '-maxrate', '1500k', '-bufsize', '3000k', '-pix_fmt', 'yuv420p',
                  '-profile:v', 'high', '-level:v', '3.1', '-r', '30',
                  '-fps_mode', 'cfr', '-passlogfile', str(Path(temporary) / 'pass')]
        print('Pass 1/2: analyzing the complete film.', flush=True)
        subprocess.run(common + ['-pass', '1', '-f', 'null', '-'], check=True)
        print('Pass 2/2: encoding the 720p README preview.', flush=True)
        staged = output.parent / (output.stem + '.encoding.mp4')
        try:
            subprocess.run(common + ['-pass', '2', '-movflags', '+faststart',
                           '-metadata', 'title=Vancouver 3D City — Living Atlas',
                           '-metadata', 'comment=Vancouver Living Atlas by YiTaChen; '
                           'https://github.com/YiTaChen/vancouver-living-atlas',
                           str(staged)], check=True)
            size = staged.stat().st_size
            if size >= 10_000_000:
                raise RuntimeError(f'{size:,} bytes exceeds the conservative 10 MB cap.')
            staged.rename(output)
        finally:
            staged.unlink(missing_ok=True)
    print(json.dumps({'output': str(output), 'bytes': size,
                      'source_bytes': source.stat().st_size,
                      'reduction_percent': round(100 * (1 - size / source.stat().st_size), 2)},
                     indent=2))


if __name__ == '__main__':
    main()
