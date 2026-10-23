# Open-world transit integration — 2026-10-22

The normal city now owns transit as persistent geographic services. Walking into a station does not replace the scene or select a destination. F/tap boards an actual nearby stopped vehicle with an open door; walking, seats, stairs and exits retain physical world coordinates.

## Services and coverage

- SkyTrain uses complete bidirectional GTFS Waterfront–King George and Waterfront–Richmond–Brighouse runs. All source stops remain in the service clock; Main Street and Yaletown are not invented termini. Opening, dwell, closing, travel and a physical terminal crossover proceed independently of passengers and camera mode.
- Seven stations have retained downtown world geometry: Waterfront, Burrard, Granville, Stadium–Chinatown, Main Street–Science World, Vancouver City Centre and Yaletown–Roundhouse. Eleven street approaches and seventeen directional platform paths have continuous walking connections and reverse exits. Waterfront has separate Expo/Canada platforms connected by a public concourse.
- The current bus packet joins the existing source-backed 5/6 legs into two continuous circuits at their common scheduled stops. Four stable vehicle identities serve 51 stops over 13.11 km. Buses brake, open, wait, close and depart even when nobody boards. Detailed cabin/ramp work is limited to the nearby or occupied bus; distant service uses shared exterior instances.
- Full SkyTrain source data is current offline GTFS, not live operations. Only the seven downtown stations have authored passenger interiors. Remote stations remain logical/source-geographic stops; no remote station interior is claimed.

## Controls and continuity

- Ordinary UI has no station teleport, floor selection, destination-driven departure, parked bus summon or cabin exhibit launcher. These remain gated behind `VANCOUVER_VISUAL_QA=1` for asset inspection only.
- Walk from a street entrance, use actual stairs, wait at a platform and approach an open door. The common interaction registry displays localized F/tap prompts for boarding, alighting, sitting and standing, with fresh vehicle/stop/door/range checks at execution.
- Every authored doorway can board its own carriage: four Expo cars or two Canada cars. The passenger, seats, lamps and camera follow that carriage, including the reversed Canada rear cabin. At the next station, alighting uses the corresponding carriage doorway. Expo's protected station packet describes outer doors at ±5.5 m; a documented runtime adapter aligns these to the retained GLB's actual ±4.9 m, preserving the source vectors separately.
- Door prompts sit on the physical opening plane at chest height, so first-person passengers looking normally at an open door can see and activate them. Physical proximity is measured at the floor and rechecked independently.
- Mobile keeps one captured walking joystick across street, station and bus ownership. Held keyboard/joystick input and current look direction cross station boundaries; release goes to the current owner.
- Orbit observes the city while service and any occupied vehicle continue. Returning to Walk resumes the same physical passenger. Changing the camera does not move the passenger to another station.
- First person supports near-vertical viewing. Third person checks actual roofs/walls/chairs, searches an unobstructed body view when a seatback blocks the rear view, and keeps the person framed on desktop and narrow mobile aspect ratios.

## Geometry, rendering and resource bounds

Street approach registrations use official station maps aligned with the current GIS facade and actual rendered walking floor. They are map interpretations, not surveyed entrance coordinates or engineering drawings. Internal circulation, vertical envelopes and terminal tail tracks are representative reconstructions; source platform frames and the existing adopted cabin packages remain unchanged.

Bounded portal volumes remove only the pedestrian opening from existing city surfaces. Seven coarse station bounds reject distant pixels before precise opening tests. New detached landmark materials receive the same patch before GPU warmup. Terrain/building material hooks and cache keys are chained and restored on disposal.

Far trains share original procedural exterior geometry/materials; only up to three nearby/occupied detailed trains load interiors. Closeup geometry becomes visible and boardable only after its real load and GPU preparation finish; its source service clock continues during preparation. A fixed four-light scene pool supplies the nearest station and occupied carriage; retained station/cabin lights are disabled so seven interiors cannot increase the whole city's shader light count. Hidden/suspended/context-lost frames freeze simulation without a large catch-up jump. Failed closeup loads retain the exterior and retry with backoff.

## Verification

Automated coverage includes actual GLB doors/seats and articulated paths; all street/platform/reverse routes; real GIS street approaches; body/handrail clearance; independent service clocks and real terminal identities; stale/displaced-train boarding rejection; same-seat attachment through future stops and Orbit; continuous held keyboard/mobile input; localized interaction keys; full-body framing for every train seat and production station bench; resource disposal and material-consumer preservation. All 36 Waterfront directional doorways pass 324 body-clearance mesh rays, normal horizontal-view prompt projection, real keyboard dispatch for boarding and the shared touch dispatcher for alighting. All six cars retain their actual seat/frame/avatar/camera while moving to the next station.

Native browser checks walked from the registered Waterfront street entrance through every switchback stair and underground concourse to the Expo platform without floor/destination buttons. At a 390×844 viewport, one joystick moved forward/back and released correctly; first-person look reached approximately 88° upward, and zooming out framed the full character below the station roof. These are responsive-browser and actual WebGL observations, not physical-phone performance certification. Screenshots and local logs remain under ignored `work/open-world-transit/`.

Release validation and native browser observations are recorded with the final integration commit/PR. Local QA output belongs under ignored `work/open-world-transit/` and is not production UI.

Sources and reproducible data receipts:

- [SkyTrain full source/service](SKYTRAIN_WORLD_SERVICE_2026_10.md)
- [Station references, registration, walking geometry and accuracy limits](SKYTRAIN_OPEN_WORLD_STREET_ACCESS_2026_10.md)
- [Bus source/service generator](../tools/transit/BUS-WORLD-SERVICE.md)
- [Official SkyTrain station order and network](https://www.translink.ca/schedules-and-maps/skytrain)

The in-app source credits include the TransLink permission legend. Service speeds, headways and dwell times are illustrative simulation settings, not arrival predictions or exact timetables.
