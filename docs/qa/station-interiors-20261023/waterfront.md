# Waterfront: reference-based circulation rebuild

This is the phase 1 implementation record. The subsequent [phase 4 mapped reconstruction](waterfront-mapped-phase4.md) supersedes its original secondary-door, platform-placement and Howe-scope limitations.

This stage replaces the game's generic access chains with a shared heritage hall, a separate Expo fare hall and island descent, an under-Cordova Canada Line passage, a Canada Line concourse and island descent, and the independent Granville Street entrance. The public hall is the interchange; the two rail lines do not share a platform.

## Evidence inspected

| Evidence | What it establishes |
| --- | --- |
| [TransLink accessible entrance map](https://www.translink.ca/-/media/translink/documents/schedules-and-maps/skytrain-accessible-entrance-maps/waterfront_station_elevator_map.pdf) | Heritage entrance serves both lines, Granville serves Canada Line, Howe access serves Expo only. |
| [TransLink Canada Line tour, 2009](https://buzzer.translink.ca/2009/07/the-buzzer-rides-the-canada-line/) | Photographs of the southwest heritage-hall entrance, separate ticketing concourse and platform descent. |
| [TransLink construction photographs, 2008](https://buzzer.translink.ca/2008/12/canada-line-photos-waterfront-station/) | Under-Cordova connection and the distinct concourse/platform levels. |
| [Photograph of the installed station diagram](https://www.flickr.com/photos/viriyincy/4000151862) | Independent perpendicular islands and the public-hall transfer. |
| [Actual Expo platform photograph](https://commons.wikimedia.org/wiki/File:Expo_Line_platform_of_Waterfront_station.jpg) | Cream columns, low metal ceiling, continuous fluorescent strips, red rails, warm floor and framed track-wall posters. Shwangtianyuan, CC BY-SA 4.0. |
| [Actual Canada Line platform photograph, 2025](https://commons.wikimedia.org/wiki/File:Waterfront_Station_Canada_Line_Platform_2025.JPG) | Charcoal track walls, pale modular ceiling, gray rectangular tiles, central escalator well. Canmenwalker, CC BY 4.0. |

The source photographs were inspected during authoring. The linked photographs are evidence, not bundled game textures. Poster panels in the game contain original neutral artwork.

## Structural and runtime changes

- Enclosed stair/escalator banks have sidewalls, supported treads, continuous handrails, soffits and lighting.
- Platform stairwells remove the same areas from both passenger triangles and visible slabs. Overhead panels also have matching stairwell openings.
- Representative island widths are 8.6 m so both sides of the central access banks retain walking aisles. All rail, train-stop, station-sill, waiting and exclusion geometry moves consistently; car-local door coordinates remain unchanged.
- The open-world adapter retains authored interiors instead of replacing them with procedural switchbacks. The primary entrance anchors the station frame to the mapped street door. Secondary street attachment is separately identified as representative.
- Third-person cutaway and camera collision use the same clipping plane. First-person restores the complete enclosure.
- Bounded tunnel portals and structural backing cover the former views into the city/ground through track gaps.

## Reproduction

```sh
node tools/rebuild-station-interiors.mjs waterfront
node --test tests/skytrain-stations.test.mjs tests/station-authored-renderer.test.mjs tests/station-interior-geometry.test.mjs tests/skytrain-street-access.test.mjs
npx vite --config tools/station-interiors/vite.preview.config.mjs
```

Open `http://127.0.0.1:3201/tools/station-interiors/preview.html`. This is the exact station runtime renderer, with separate entrance, stair, platform and cutaway views. Its reference links remain visible during inspection. Full-game captures use `tools/station-interiors/capture-game.mjs` and record their view setup in JSON.

## Accuracy boundary

Passenger topology and observed architectural features are reference-backed. Dimensions, depths, the precise bends of concealed passages, and the remaining secondary entrance attachment are representative, not a surveyed as-built reconstruction. The 2009 diagram contains old service labels; it is used for architecture only. SeaBus, West Coast Express and the Howe branch are not newly simulated by this stage.
