# Vancouver 3D City — September 2026 showcase

[Watch the embedded film](../../../README.md#watch-vancouver-3d-city) · [Download the compact MP4](Vancouver-3D-City-readme.mp4?raw=true) · [Encoding verification](verification.json)

This is the **complete 58.8-second edit** of `Vancouver-3D-City.mp4`, compressed for GitHub. It replaces the September 5 film as the repository's primary showcase. No shots, captions or credits have been removed.

## Film and source

The film was recorded September 6–7, 2026, from an independent local snapshot at [`e4b1b26`](https://github.com/YiTaChen/vancouver-living-atlas/tree/e4b1b26). A filming adapter fed the existing movement/flight inputs, positioned the camera and advanced the running app at 1/30-second increments. Actual WebGL frames were captured, English titles/captions added, and short dissolves composed before H.264 encoding. There is no generated video, unrelated footage, narration, music or paid external service.

The ten scenes show:

1. Downtown and Stanley Park from above.
2. The complete **Science World exterior**, with its cutaway disabled, changing from daylight to night.
3. A slowly rotating city panorama with night lighting and aurora.
4. A short walk along Beach Avenue.
5. The red roadster on Robson Street.
6. Boating on Coal Harbour.
7. Floatplane water takeoff from its cockpit.
8. An exterior replay of the same takeoff maneuver.
9. Helicopter flight above the city.
10. A speeding trigger reached through normal acceleration, automatic deceleration, a patrol car and the officer arriving beside the roadster.

The original film's **FLIGHT PREVIEW** captions reflect its pre-merge recording snapshot. Pilotable aircraft were subsequently merged into `main` and deployed; current mobile flight controls are more compact than at recording time. The original full-resolution master and its production/reproduction package remain preserved in the local delivery; this Git folder adds only the small README copy and its records, not another 82.5 MB master to clone.

## Encoding

| Property | Original master | GitHub copy |
| --- | --- | --- |
| File | Vancouver-3D-City.mp4 | Vancouver-3D-City-readme.mp4 |
| Dimensions | 1920 × 1080 | 1280 × 720 |
| Duration / frames | 58.8 s / 1,764 | 58.8 s / 1,764 |
| Frame rate | 30 fps | 30 fps |
| Codec | H.264 | H.264 High, level 3.1, yuv420p |
| Bytes | 82,496,087 | **7,850,533** |
| Size, decimal MB | 82.50 | **7.85** |

The copy is **90.48% smaller**. Two-pass x264 encoding at 1.1 Mbps average / 1.5 Mbps maximum allocates bits across the full film; Lanczos resizing keeps the 16:9 image and captions. The MP4 index is moved before the media payload (`faststart`) for streaming. No audio track is added.

GitHub documents a **10 MB video attachment cap on a free plan** and 100 MB on a paid plan; this copy stays below the smaller cap without assuming the owner's plan. H.264 is GitHub's recommended compatibility choice. [Official attachment limits](https://docs.github.com/en/get-started/writing-on-github/working-with-advanced-formatting/attaching-files).

Regular Git files have a separate 100 MiB hard limit and warnings above 50 MiB. This 7.85 MB file is also below those thresholds and does not need Git LFS. [Official repository file limits](https://docs.github.com/en/repositories/working-with-files/managing-large-files/about-large-files-on-github). Limits checked September 7, 2026.

The README player uses this persistent GitHub attachment URL:

https://github.com/user-attachments/assets/8892839c-6e26-437d-84ae-fad6fc2333b6

The relative MP4 download link above provides a versioned repository copy of the same encoding.

## Reproduce the compression

With Python 3 and FFmpeg containing libx264, run from the repository root:

```sh
python3 tools/encode-city-readme-video.py /path/to/Vancouver-3D-City.mp4 \
  --ffmpeg /path/to/ffmpeg \
  --output /tmp/Vancouver-3D-City-readme.mp4

python3 tools/verify-city-readme-video.py /tmp/Vancouver-3D-City-readme.mp4 \
  /path/to/ffmpeg --json /tmp/readme-video-verification.json
```

The [encoder](../../../tools/encode-city-readme-video.py) leaves the master untouched, refuses to overwrite an existing output, cleans temporary pass files and rejects a result of 10,000,000 bytes or more. This recipe reproduces the compression from the finished film; the independently preserved original production package reproduces the scene capture and edit. Different FFmpeg versions may produce different byte hashes.

## Verification and attribution

[verification.json](verification.json) records complete decode of 1,764 frames, 1280 × 720, 30 fps, 58.8 seconds, H.264, fast-start layout and no detected black interval. Twelve encoded frames were visually reviewed across all ten scenes, including Science World's exterior in daylight/night, the floatplane cockpit and the final officer. Titles remain clear of the main subjects. GitHub attachment playback is recorded in [playback-verification.json](playback-verification.json); file identity is recorded in [SHA256.json](SHA256.json).

Vancouver Living Atlas by YiTaChen — [canonical repository](https://github.com/YiTaChen/vancouver-living-atlas). Original material retains the [project license](../../../LICENSE), including applicable historical grants. Geographic credits remain visible in the film and retain their source terms: OpenStreetMap contributors, City of Vancouver and NRCan / USGS. See [DATA_SOURCES.md](../../../DATA_SOURCES.md). This is a modeled geographic visualization, not photographic aerial or street footage.
