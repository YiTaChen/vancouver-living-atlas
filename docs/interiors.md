# Public landmark interiors

Three original procedural public interiors, based on public reference material. These are representative reconstructions, not surveyed floor plans or complete building replicas. Reference photographs and drawings are not bundled as assets.

## Explore

Layers contains three entrance shortcuts. Each starts walking outside an open doorway. Walk forward to enter; Science World’s annex connects westward to the circular main room. Canada Place has an open cross-building entry and a longitudinal concourse. Waterfront Station has a clear central entrance through the portico.

In Orbit, close overhead views cut away upper walls and roofs to reveal the public floor. Zoom away, enter Walk, or disable Interior cutaway in Layers to restore the exterior. Cars cannot enter. Windows remain collision boundaries. Furniture and perimeter walls block walking; entrance approaches connect terrain to the public floor.

## Reference and scope

- **Science World:** admissions annex, central stage, structural columns, representative exhibit islands and benches. [Official visitor map](https://www.scienceworld.ca/wp-content/uploads/ScienceWorldMap_20211230_LR.pdf), [Level 1 circulation](https://www.scienceworld.ca/rentus/level-1-circulation/). Upper galleries and theatre interiors are not reconstructed.
- **Canada Place:** representative Convention Centre East lobby, delegate concourse, three exhibition halls, seating and registration. [Official floor plans](https://www.vancouverconventioncentre.com/facility/floor-plans-and-specs?blank=true). Hall proportions and side entrances are adapted to the existing model; cruise terminal security areas and hotel rooms are excluded.
- **Waterfront Station:** historic red-brick station, entrance portico, columns, coffered ceiling, clock, customer-service counter and fare gates. [TransLink station exploration](https://buzzer.translink.ca/2015/03/skytrain-explorer-waterfront-station/), [Customer Service Centre photos](https://buzzer.translink.ca/2022/09/photos-translink-customer-service-centre-waterfront-station/). Underground platforms and rail tunnels are not included.

## Rendering and validation

Floors, structural elements and furniture are merged into a few material batches. Interiors are hidden beyond their local viewing distance. Vertex-coloured ambient illumination avoids additional shadow-casting lights. Openings are cut into the existing model geometry during model creation; the optional roof cutaway uses local clipping planes. The same openings are applied to standard and Ultra primary landmark models.

Automated checks cover interpolated doorway geometry, open entrance raycasts, floor continuity, representative walking routes, furniture collision, vehicle exclusion and cutaway state. Browser checks cover entering the main public spaces, close Orbit cutaway and a phone-sized viewport. Mobile viewport emulation does not constitute physical-device GPU testing.

## Waterfront / Canada Place detail upgrade (September 6)

Waterfront Station now has projecting stone window surrounds, glazing divisions, masonry courses, cornices, roof seams and dormers. Its public concourse adds tiled flooring, rose-toned heritage panels, original geometric reliefs, Ionic-inspired capitals, pendant lights and ticket machines. Canada Place East adds blue patterned floor finishes, teal column bases, wood-tone partition panels, lounge sofas, tables, planting, registration monitors, representative exhibit booths and escalator detail. These are original modeled interpretations of the references, not extracted textures or copied assets.

**SeaBus connection verified:** TransLink explicitly describes the SkyWalk doors from Waterfront Station to SeaBus in its [official SeaBus information](https://www.translink.ca/schedules-and-maps/seabus.aspx). The [official station map](https://infomaps.translink.ca/system_maps/wce_station_maps/waterfront_station.pdf) locates the terminal. The new walkable route follows the local CoV/OSM connecting-building footprints from the station’s rear concourse, across the railway, to a lower glazed waiting lounge. The vertical transition is simplified into continuous walkable circulation with stepped escalator detail; it is not a surveyed reconstruction of every real stair, escalator or elevator. Boarding a SeaBus and sailing its service are not added by this upgrade.

Additional visual references: [TransLink concourse photograph](https://buzzer.translink.ca/wp-content/uploads/2015/03/IMG_1050.jpg), [Convention Centre East Atrium Foyer photograph](https://assets.vancouverconventioncentre.com/spaces/images/dgTgBUCJ3AuF35nA.jpg), [official East/West foyer gallery](https://www.vancouverconventioncentre.com/facility/spaces/pre-function-spaces-foyers). Reference images are not distributed with the app.

Interior visibility now measures distance to the floor footprint, including the full SkyWalk and terminal, rather than only the main building centre. The terminal roof opens with the station’s close-Orbit cutaway. Tests sample the full route at 20 cm intervals for collision clearance and rendered floor agreement, including grade changes and the actual rear door opening.
