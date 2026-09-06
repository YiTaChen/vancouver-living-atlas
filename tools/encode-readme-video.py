#!/usr/bin/env python3
"""Create the compact 30-second GitHub README preview from the finished film."""
import argparse
from pathlib import Path
import subprocess

parser = argparse.ArgumentParser(description=__doc__)
parser.add_argument('--ffmpeg', default='ffmpeg', help='FFmpeg binary with libx264')
args = parser.parse_args()
media = Path(__file__).resolve().parents[1] / 'docs/videos/2026-09-05'
subprocess.run([
    args.ffmpeg, '-hide_banner', '-y', '-i', str(media / 'project-intro.mp4'),
    '-vf', 'scale=960:540:flags=lanczos',
    '-c:v', 'libx264', '-preset', 'slow', '-crf', '26',
    '-maxrate', '1800k', '-bufsize', '3600k', '-pix_fmt', 'yuv420p',
    '-profile:v', 'high', '-level:v', '3.1', '-r', '30', '-fps_mode', 'cfr',
    '-an', '-movflags', '+faststart',
    '-metadata', 'title=Vancouver Living Atlas — README preview',
    str(media / 'project-intro-readme.mp4'),
], check=True)
