# Vancouver Living Atlas — 30-second introduction

[Download the compact README preview](project-intro-readme.mp4?raw=true) · [Download the finished MP4](project-intro.mp4?raw=true) · [Download the reproducible production package](project-intro-reproduction.zip?raw=true) · [Validation report](verification.json)

This film was captured from an isolated local copy of the current project at commit `fd2e9a2538aa41c9a918b05d8b958f3fd2aa0477`. Every scene is rendered by the real browser application with Ultra detail. English titles, short subtitles and transitions are included. No generated video, unrelated footage, narration or music is used.

**README preview:** 30.00 seconds · 960 × 540 · 30 fps · H.264 · 3,642,971 bytes (3.6 MB), 92.59% smaller than the original. The inline player in the repository README uses a GitHub video attachment. [Preview validation](readme-preview-verification.json).

**Full-quality delivery:** 30.00 seconds · 1920 × 1080 · 16:9 · 30 fps · H.264 High Profile · BT.709 · fast-start MP4.

The seven shots show the peninsula, Canada Place, walking on Beach Avenue, the left-hand-drive cockpit on Robson Street, sailing in False Creek, returning from a local map view to the same driving position, and Science World changing from daylight to night.

The production package contains the exact instrumented app snapshot, camera sequence, local capture server, editing and encoding scripts, source credits and verification records. Its README describes the one-command reproduction workflow. Filming instrumentation is confined to that archived snapshot; the application's runtime code is unchanged by this media commit.

The final video passed a complete 900-frame decode, resolution/frame-rate/duration checks, black-frame detection and complete browser playback. The MP4 is approximately 49 MB; the reproduction package is approximately 16 MB.

Original code and procedural models retain the repository's MIT license. Geographic data retain their source terms; see [data provenance and accuracy](../../../DATA_SOURCES.md). Visible credits in the film include OpenStreetMap contributors, the City of Vancouver and NRCan / USGS. This is a geographic visualization, not photographic footage or a live transport feed.

## Re-encode the README preview

From the repository root, run `python3 tools/encode-readme-video.py --ffmpeg /path/to/ffmpeg`. The command keeps all 30 seconds and 30 fps, scales to 960 × 540 with Lanczos, encodes H.264 at CRF 26 with a 1.8 Mbps peak rate, and moves the MP4 index to the beginning for streaming. The 1080p source remains unchanged.
