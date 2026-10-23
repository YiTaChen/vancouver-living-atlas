# Autonomous offline bus service

`node tools/transit/build-bus-world-service.mjs` builds the small public packet at
`public/data/transit/bus-world-routes.json` from the committed source packet. The
source SHA-256, feed version/retrieval time, original shape-row hashes, GTFS stop
IDs/codes and block-continuity evidence remain in the output. No fresh network
fetch is needed for a reproducible rebuild.

The two continuous 5/6 circuits retain the source shape vertices between evidenced
coincident scheduled-stop projections. There are no invented connectors, U-turns,
straight-line shortcuts or discontinuous map-end wraps. All 51 retained stops
have source identities. The current source packet contains no route 19 geometry.

Four persistent vehicles share one cheap instanced body pool. They accelerate,
brake, open, dwell for ten seconds, close and depart independently of the player
and of the camera mode. Speeds, spacing and dwell are illustrative; this is not
live arrival data or an exact timetable. Both circuits total 13.11 km. The runtime
checks the ground identity and full body envelope before each movement step and
holds in place if an actual building, surface or furniture obstruction appears.

A walking player within 80 m triggers one bounded close-up cabin preload. The
proxy remains visible while loading and yields to that same vehicle's current
pose once ready. Preloading never moves the player, resets a route clock or
creates a separate parked vehicle. An occupied cabin retains its owner across
all stops and the 5/6 service changes. The existing Auto/Light/Detailed quality
policy, physical aisle/steps/seats, PBR assets and ramp interlocks are retained.

F boarding is exposed only at the actual open front door during a dwell. F exit
requires standing near the open rear door at a dwell; capture-time vehicle and
stop-visit identity and current proofs reject stale prompts. The vehicle leaves
without boarding. Ramp stowing starts before autonomous departure; an occupied
ramp area keeps the existing physical interlock. The existing ramp solver only
accepts level validated roots; sloped stops retain ordinary fresh-ground boarding
but cannot deploy an unvalidated ramp. Hidden tabs explicitly freeze simulation,
and resume discards hidden elapsed time.

The engine loads/updates/disposes `BusWorldService`, updating it before the cabin.
While ready, the environment suppresses old random road-edge buses and keeps car
traffic and the real bus night-light collector active. The legacy parked visit
and short-street ride adapter remains for asset QA only.

The required source legend is exported in the packet and rendered by
`components/transit-attribution.tsx`; the page must mount that component beside
its visible transit/source attribution. Terms were checked on 2026-10-22 at:
https://www.translink.ca/about-us/doing-business-with-translink/app-developer-resources/gtfs/gtfs-data

Focused validation includes autonomous no-passenger departure, repeated future
stops, continuity, stale F boarding/exits, current-pose late loading, occupied
camera attachment, orbit rendering, hidden freeze, old-bus suppression without
car suppression, and a 1 m whole-circuit sweep of the complete bus envelope
against the map's actual land and building/landmark footprints.
