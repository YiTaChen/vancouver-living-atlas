#!/usr/bin/env python3
"""Extract a bounded, reproducible offline City Life & Transit source snapshot.

Python standard library only. This is a source importer, not a runtime service,
station-layout authoring tool, timetable simulator, or survey-grade projection.
"""
from __future__ import annotations

import argparse
from collections import Counter, defaultdict
import csv
from datetime import date, datetime, timezone
import hashlib
import io
import json
import math
from pathlib import Path
import re
import unittest
import urllib.request
import zipfile

GTFS_URL = "https://gtfs-static.translink.ca/gtfs/google_transit.zip"
TERMS_URL = "https://www.translink.ca/about-us/doing-business-with-translink/app-developer-resources/gtfs/gtfs-data"
BASE_REVISION = "401569193ccda73e8f6a6fd96e4bdb144ef5a4c6"
CORE = {"west": -123.165, "east": -123.095, "south": 49.267, "north": 49.315}
METERS_PER_DEGREE = math.pi * 6371008.8 / 180
REFERENCE_LATITUDE = 49.281
STATIONS = {
    "Waterfront Station": "waterfront",
    "Burrard Station": "burrard",
    "Granville Station": "granville",
    "Stadium-Chinatown Station": "stadium-chinatown",
    "Main Street-Science World Station": "main-street-science-world",
    "Vancouver City Centre Station": "vancouver-city-centre",
    "Yaletown-Roundhouse Station": "yaletown-roundhouse",
}
STATION_MAPS = {
    "waterfront": "https://infomaps.translink.ca/system_maps/skytrain_station_maps/waterfront_station.pdf",
    "burrard": "https://infomaps.translink.ca/system_maps/skytrain_station_maps/burrard_station.pdf",
    "granville": "https://infomaps.translink.ca/system_maps/skytrain_station_maps/granville_vancouver_city_centre_station.pdf",
    "stadium-chinatown": "https://infomaps.translink.ca/system_maps/skytrain_station_maps/stadium_chinatown_station.pdf",
    "main-street-science-world": "https://infomaps.translink.ca/system_maps/skytrain_station_maps/main_street_station.pdf",
    "vancouver-city-centre": "https://www.translink.ca/-/media/translink/documents/schedules-and-maps/skytrain-accessible-entrance-maps/vancouver_city_centre_station_elevator_map.pdf",
    "yaletown-roundhouse": "https://infomaps.translink.ca/system_maps/skytrain_station_maps/yaletown_roundhouse_station.pdf",
}
# IDs belong to Atlas; never derive them from a feed's replaceable stop_id.
LINES = {
    "bus-5": {"shortName": "005", "longName": "Robson", "mode": "bus", "profile": "low-floor-bus-12m", "directions": {"0": "eastbound", "1": "westbound"}},
    "bus-6": {"shortName": "006", "longName": "Davie", "mode": "bus", "profile": "low-floor-bus-12m", "directions": {"0": "eastbound", "1": "westbound"}},
    "expo": {"longName": "Expo Line", "mode": "rail", "profile": "expo-metro-17m", "directions": {"0": "eastbound", "1": "westbound"}},
    "canada": {"longName": "Canada Line", "mode": "rail", "profile": "canada-line-representative-pending", "directions": {"0": "northbound", "1": "southbound"}},
}
UNRESOLVED = [
    "elevation_and_vertical_track_profile", "lane_or_track_surface_id",
    "door_side_and_door_alignment", "boarding_and_alighting_polygons",
    "platform_height_length_and_walkable_floor", "entrance_and_vertical_connectors",
    "track_exclusion_and_block_occupancy", "geographic_runtime_validation",
]


def in_core(lon, lat):
    return CORE["west"] <= lon <= CORE["east"] and CORE["south"] <= lat <= CORE["north"]


def sha256(data):
    return hashlib.sha256(data).hexdigest()


def slug(value):
    return re.sub(r"[^a-z0-9]+", "-", value.lower()).strip("-")


def time_seconds(value):
    h, m, s = map(int, value.strip().split(":"))
    if h < 0 or not 0 <= m < 60 or not 0 <= s < 60:
        raise ValueError("Invalid GTFS time: " + value)
    return h * 3600 + m * 60 + s


def xy(point):
    # Local planar metric used only for projection/path station, not world XYZ.
    return (point[0] * METERS_PER_DEGREE * math.cos(math.radians(REFERENCE_LATITUDE)), point[1] * METERS_PER_DEGREE)


def distance(a, b):
    ax, ay = xy(a)
    bx, by = xy(b)
    return math.hypot(bx - ax, by - ay)


def cumulative(points):
    result = [0.0]
    for a, b in zip(points, points[1:]):
        result.append(result[-1] + distance(a, b))
    return result


def project(point, points, stations, minimum=0.0):
    """Nearest monotonic projection; does not fabricate a stop-to-stop line."""
    px, py = xy(point)
    candidates = []
    for i, (a, b) in enumerate(zip(points, points[1:])):
        if stations[i + 1] + 1e-8 < minimum:
            continue
        ax, ay = xy(a)
        bx, by = xy(b)
        dx, dy = bx - ax, by - ay
        square_length = dx * dx + dy * dy
        if square_length < 1e-14:
            continue
        ratio = max(0.0, min(1.0, ((px - ax) * dx + (py - ay) * dy) / square_length))
        segment_length = stations[i + 1] - stations[i]
        ratio = max(ratio, max(0.0, (minimum - stations[i]) / segment_length))
        if ratio > 1.0 + 1e-8:
            continue
        station = stations[i] + ratio * segment_length
        lonlat = [a[0] + ratio * (b[0] - a[0]), a[1] + ratio * (b[1] - a[1])]
        candidates.append((distance(point, lonlat), station, i, ratio, lonlat))
    if not candidates:
        raise ValueError("No monotonic projection on source shape")
    offset, station, segment, ratio, lonlat = min(candidates)
    return {"offsetM": offset, "stationM": station, "segmentIndex": segment, "segmentRatio": ratio, "lonLat": lonlat}


def clip_shape(points, stations, first, last):
    """Keep original intermediate vertices; only cut endpoints are interpolated."""
    if not last["stationM"] > first["stationM"]:
        raise ValueError("Clipped path has no length")
    clipped = [first["lonLat"]]
    source_indices = [None]
    for index, point in enumerate(points):
        if first["stationM"] + 1e-8 < stations[index] < last["stationM"] - 1e-8:
            clipped.append(point)
            source_indices.append(index)
    clipped.append(last["lonLat"])
    source_indices.append(None)
    return clipped, source_indices


def active_service_ids(calendars, exceptions, service_date):
    key = service_date.strftime("%Y%m%d")
    weekday = service_date.strftime("%A").lower()
    active = {r["service_id"] for r in calendars if r["start_date"] <= key <= r["end_date"] and r[weekday] == "1"}
    for row in exceptions:
        if row["date"] == key:
            if row["exception_type"] == "1":
                active.add(row["service_id"])
            elif row["exception_type"] == "2":
                active.discard(row["service_id"])
            else:
                raise ValueError("Unknown calendar exception")
    return active


def csv_rows(archive, name):
    with archive.open(name) as stream:
        yield from csv.DictReader(io.TextIOWrapper(stream, encoding="utf-8-sig", newline=""))


def source_stop(row):
    return {
        "sourceStopId": row["stop_id"], "stopCode": row["stop_code"] or None,
        "name": row["stop_name"], "lonLat": [float(row["stop_lon"]), float(row["stop_lat"])],
        "sourceParentStationId": row["parent_station"] or None,
        "sourceLocationType": row["location_type"] or "0",
    }


def atlas_stop_id(stop, line_id, direction):
    if LINES[line_id]["mode"] == "rail":
        station_name = stop["name"].split(" @ ")[0]
        if station_name not in STATIONS:
            raise ValueError("Unexpected in-core rail station: " + station_name)
        return f"{STATIONS[station_name]}:{line_id}:{direction}"
    return f"{line_id}:{direction}:{slug(stop['name'])}"


def round_floats(value):
    if isinstance(value, float):
        return round(value, 6)
    if isinstance(value, dict):
        return {key: round_floats(item) for key, item in value.items()}
    if isinstance(value, list):
        return [round_floats(item) for item in value]
    return value


def write_json(path, value):
    # One top-level field per line; compact nested arrays avoid a huge feed dump.
    payload = round_floats(value)
    chunks = [json.dumps(key, ensure_ascii=False) + ":" + json.dumps(item, ensure_ascii=False, separators=(",", ":"), allow_nan=False) for key, item in payload.items()]
    path.write_text("{\n" + ",\n".join(chunks) + "\n}\n", encoding="utf-8")


def extract(feed_path, out, service_date, retrieved_at, base_revision, http_last_modified=None):
    feed_bytes = feed_path.read_bytes()
    archive = zipfile.ZipFile(io.BytesIO(feed_bytes))
    info = next(csv_rows(archive, "feed_info.txt"))
    if not info["feed_start_date"] <= service_date.strftime("%Y%m%d") <= info["feed_end_date"]:
        raise ValueError("Selection date falls outside feed effective dates")
    calendars = list(csv_rows(archive, "calendar.txt"))
    exceptions = list(csv_rows(archive, "calendar_dates.txt"))
    active = active_service_ids(calendars, exceptions, service_date)
    if not active:
        raise ValueError("No active services for requested service date")
    all_routes = list(csv_rows(archive, "routes.txt"))
    selected_routes = {}
    for line_id, config in LINES.items():
        candidates = [r for r in all_routes if r["route_long_name"] == config["longName"] and ("shortName" not in config or r["route_short_name"] == config["shortName"])]
        if len(candidates) != 1:
            raise ValueError(f"Expected exactly one source route for {line_id}; found {len(candidates)}")
        selected_routes[line_id] = candidates[0]
    route_to_line = {r["route_id"]: line_id for line_id, r in selected_routes.items()}
    all_trips = [t for t in csv_rows(archive, "trips.txt") if t["service_id"] in active]
    selected_trips = [t for t in all_trips if t["route_id"] in route_to_line]
    # Include every trip in affected bus blocks so filtering cannot fabricate adjacency.
    bus_blocks = {(t["service_id"], t["block_id"]) for t in selected_trips if route_to_line[t["route_id"]].startswith("bus-") and t["block_id"]}
    relevant_trips = [t for t in all_trips if t["route_id"] in route_to_line or (t["service_id"], t["block_id"]) in bus_blocks]
    relevant_ids = {t["trip_id"] for t in relevant_trips}
    stop_times = defaultdict(list)
    for row in csv_rows(archive, "stop_times.txt"):
        if row["trip_id"] in relevant_ids:
            stop_times[row["trip_id"]].append(row)
    for rows in stop_times.values():
        rows.sort(key=lambda row: int(row["stop_sequence"]))
    raw_stops = {row["stop_id"]: row for row in csv_rows(archive, "stops.txt")}
    stops = {key: source_stop(row) for key, row in raw_stops.items()}
    patterns = defaultdict(list)
    for trip in selected_trips:
        rows = stop_times[trip["trip_id"]]
        if not rows:
            raise ValueError("Trip has no stop_times: " + trip["trip_id"])
        core_rows = [row for row in rows if in_core(*stops[row["stop_id"]]["lonLat"])]
        if not core_rows:
            continue
        line_id = route_to_line[trip["route_id"]]
        if LINES[line_id]["mode"] == "rail":
            if any(stops[row["stop_id"]]["name"].split(" @ ")[0] not in STATIONS for row in core_rows):
                raise ValueError("Unexpected in-core station requires reviewed scope")
        key = (line_id, trip["direction_id"], trip["shape_id"], tuple(row["stop_id"] for row in rows))
        patterns[key].append(trip)
    # Most-used complete pattern per direction. Exact ties prefer source shape ID.
    selections = []
    selection_evidence = []
    for line_id, config in LINES.items():
        for direction_id, direction in config["directions"].items():
            candidates = [(key, trips) for key, trips in patterns.items() if key[:2] == (line_id, direction_id)]
            candidates.sort(key=lambda item: (-len(item[1]), item[0][2], item[0][3]))
            if not candidates:
                raise ValueError(f"No in-core pattern for {line_id} {direction}")
            key, trips = candidates[0]
            # Service-day times are evidence only, never runtime simulation time.
            trips = sorted(trips, key=lambda trip: (time_seconds(stop_times[trip["trip_id"]][0]["departure_time"]), trip["trip_id"]))
            representative = next((trip for trip in trips if time_seconds(stop_times[trip["trip_id"]][0]["departure_time"]) >= 36000), trips[0])
            selections.append((line_id, direction_id, direction, representative, key))
            selection_evidence.append({
                "lineId": line_id, "directionId": direction, "sourceDirectionId": direction_id,
                "chosenShapeId": key[2], "chosenTripId": representative["trip_id"],
                "chosenActiveTripCount": len(trips),
                "alternativePatterns": [{"shapeId": k[2], "activeTripCount": len(ts), "fullTripStopCount": len(k[3]), "coreStopCount": sum(in_core(*stops[sid]["lonLat"]) for sid in k[3])} for k, ts in candidates[1:]],
                "selectionRule": "most frequent active full stop-pattern/shape for each route direction; lexical shape ID tie-break; first departure at or after 10:00 service-day time",
            })
    selected_shape_ids = {trip["shape_id"] for _, _, _, trip, _ in selections}
    shapes = defaultdict(list)
    for row in csv_rows(archive, "shapes.txt"):
        if row["shape_id"] in selected_shape_ids:
            shapes[row["shape_id"]].append(row)
    for rows in shapes.values():
        rows.sort(key=lambda row: int(row["shape_pt_sequence"]))
    services = []
    paths = []
    station_entities = {}
    station_lines = {}
    source_rows = {"routes": list(selected_routes.values()), "feedInfo": info, "calendar": [r for r in calendars if r["service_id"] in active], "calendarExceptionsOnSelectionDate": [r for r in exceptions if r["date"] == service_date.strftime("%Y%m%d")], "trips": [], "stopTimes": [], "stops": []}
    retained_stop_ids = set()
    for line_id, direction_id, direction, trip, pattern_key in selections:
        mode = LINES[line_id]["mode"]
        all_rows = stop_times[trip["trip_id"]]
        rows = [row for row in all_rows if in_core(*stops[row["stop_id"]]["lonLat"])]
        if mode == "bus" and len(rows) != len(all_rows):
            raise ValueError("Selected bus trip exits core; requires an explicit boundary/connector strategy")
        shape_rows = shapes[trip["shape_id"]]
        if len(shape_rows) < 2:
            raise ValueError("Missing/empty source shape; no straight-line fallback is permitted")
        points = [[float(row["shape_pt_lon"]), float(row["shape_pt_lat"])] for row in shape_rows]
        stations = cumulative(points)
        projections = []
        previous = 0.0
        # Project full ordered trip before clipping to avoid ambiguous rail segments.
        for row in all_rows:
            projection = project(stops[row["stop_id"]]["lonLat"], points, stations, previous)
            previous = projection["stationM"]
            if row in rows:
                projections.append(projection)
        if any(p["offsetM"] > 75 for p in projections):
            raise ValueError("Stop-to-shape offset exceeds reviewed 75 m offline threshold")
        if mode == "rail":
            kept_points, indices = clip_shape(points, stations, projections[0], projections[-1])
            origin_station = projections[0]["stationM"]
            clipping = "interpolated first/last core-stop projection; original intermediate GTFS vertices retained"
        else:
            kept_points, indices = points, list(range(len(points)))
            origin_station = 0.0
            clipping = "full original GTFS shape, including any first/last-stop tails"
        if not all(in_core(*point) for point in kept_points):
            raise ValueError("Selected shape leaves core; boundary clipping requires review")
        path_id = f"{line_id}:{direction}:path"
        path_stations = cumulative(kept_points)
        paths.append({
            "pathId": path_id, "sourceShapeId": trip["shape_id"], "coordinateOrder": "longitude,latitude",
            "coordinates": kept_points, "cumulativeStationM": path_stations,
            "sourceShapePointSequences": [int(shape_rows[i]["shape_pt_sequence"]) if i is not None else None for i in indices],
            "fullSourceShapePointCount": len(points), "fullSourceShapeLengthM": stations[-1],
            "fullSourceShapeRowsSha256": sha256(json.dumps(shape_rows, separators=(",", ":"), sort_keys=True).encode()),
            "sourceStartStationM": origin_station, "sourceEndStationM": origin_station + path_stations[-1],
            "clipping": clipping, "elevationM": None,
            "geometryStatus": "source_planar_only", "verticalProfileStatus": "unresolved",
            "approximation": "GTFS planar shape; local equirectangular path stations; rail cut endpoints interpolated. Not surveyed track/lane/height geometry.",
        })
        ordered_stops = []
        for row, projection in zip(rows, projections):
            stop = stops[row["stop_id"]]
            station_name = stop["name"].split(" @ ")[0]
            station_id = STATIONS.get(station_name) if mode == "rail" else None
            station_line_id = f"{station_id}:{line_id}" if station_id else None
            service_stop_id = atlas_stop_id(stop, line_id, direction)
            if station_id:
                parent = stops.get(stop["sourceParentStationId"])
                if parent is None:
                    raise ValueError("Rail platform has no valid parent station")
                station_entities[station_id] = {"stationId": station_id, "name": station_name, "sourceParentStationId": stop["sourceParentStationId"], "sourceAnchorLonLat": parent["lonLat"], "anchorMeaning": "GTFS parent station, not entrance or platform center", "stationMapUrl": STATION_MAPS[station_id], "stationMapInspectionStatus": "not_run", "gisPointVerificationStatus": "not_run"}
                station_lines.setdefault(station_line_id, {"stationLineId": station_line_id, "stationId": station_id, "lineId": line_id, "serviceStopIds": []})["serviceStopIds"].append(service_stop_id)
                retained_stop_ids.add(stop["sourceParentStationId"])
            platform = re.search(r" @ Platform (\d+)$", stop["name"])
            ordered_stops.append({
                "serviceStopId": service_stop_id, "stationId": station_id, "stationLineId": station_line_id,
                **stop, "sourceStopSequence": int(row["stop_sequence"]),
                "pathStationM": projection["stationM"] - origin_station,
                "shapeProjectionOffsetM": projection["offsetM"],
                "shapeProjectionLonLat": projection["lonLat"],
                "sourceShapeSegmentSequence": int(shape_rows[projection["segmentIndex"]]["shape_pt_sequence"]),
                "sourceShapeSegmentRatio": projection["segmentRatio"],
                "sourcePlatformLabel": f"P{platform.group(1)}" if platform else None,
                "sourcePickupType": row["pickup_type"] or "0", "sourceDropOffType": row["drop_off_type"] or "0",
                "surfaceId": None, "levelId": None, "elevationM": None,
                "doorSide": None, "boardingZoneId": None, "alightingZoneId": None,
                "stopPoseStatus": "unresolved_gtfs_is_not_door_alignment",
            })
            retained_stop_ids.add(stop["sourceStopId"])
        if len({s["serviceStopId"] for s in ordered_stops}) != len(ordered_stops):
            raise ValueError("Ambiguous stable service-stop identity requires reviewed disambiguation")
        service_id = f"{line_id}:{direction}:regional"
        services.append({
            "serviceId": service_id, "lineId": line_id, "directionId": direction,
            "vehicleProfileId": LINES[line_id]["profile"], "vehicleProfileStatus": "unresolved_distinct_canada_profile" if line_id == "canada" else "existing_representative_offline_asset",
            "sourceRouteId": trip["route_id"], "sourceDirectionId": direction_id,
            "sourceTripId": trip["trip_id"], "sourceServiceId": trip["service_id"], "sourceShapeId": trip["shape_id"],
            "sourceHeadsign": trip["trip_headsign"], "pathId": path_id, "orderedStops": ordered_stops,
            "servicePathIntervalM": [ordered_stops[0]["pathStationM"], ordered_stops[-1]["pathStationM"]],
            "pathIntervalRule": "Traverse between projected first and last scheduled stops; bus source shapes include overlapping endpoint tails.",
            "displayLabel": "區域內模擬服務", "mode": mode,
            "simulationHeadwaySeconds": 600 if mode == "bus" else 300,
            "simulationTimingBasis": "Atlas gameplay proposal, not official arrivals or timetable",
            "boardingEnabled": False,
            "endpointStrategy": "hold_at_regional_endpoint_until_legal_validated_continuation_or_all_passengers_alight",
            "recyclingPolicy": "only_empty_unseen_and_no_pending_handoffs; never teleport occupied vehicle",
            "returnTrackCrossover": None, "endpointPolicyValidated": False,
            "unresolved": UNRESOLVED + (["distinct_canada_vehicle_dimensions_and_door_contract"] if line_id == "canada" else []),
            "approximation": "Offline source selection only. All physical stop poses, floor/door geometry and traffic topology require integration verification.",
        })
        source_rows["trips"].append(trip)
        source_rows["stopTimes"].extend(rows)
    source_rows["stops"] = [raw_stops[key] for key in sorted(retained_stop_ids)]
    # Prove only adjacent trips in the full active block, with a shared actual stop.
    chosen_shapes = {trip["shape_id"]: (line_id, direction) for line_id, _, direction, trip, _ in selections if LINES[line_id]["mode"] == "bus"}
    blocks = defaultdict(list)
    for trip in relevant_trips:
        if (trip["service_id"], trip["block_id"]) in bus_blocks:
            blocks[(trip["service_id"], trip["block_id"])].append(trip)
    transitions = defaultdict(list)
    for (source_service, block_id), trips in blocks.items():
        trips.sort(key=lambda trip: (time_seconds(stop_times[trip["trip_id"]][0]["departure_time"]), trip["trip_id"]))
        for a, b in zip(trips, trips[1:]):
            if a["shape_id"] not in chosen_shapes or b["shape_id"] not in chosen_shapes:
                continue
            a_end, b_start = stop_times[a["trip_id"]][-1], stop_times[b["trip_id"]][0]
            if a_end["stop_id"] != b_start["stop_id"]:
                continue
            gap = time_seconds(b_start["departure_time"]) - time_seconds(a_end["arrival_time"])
            if gap < 0:
                continue
            transitions[(a["shape_id"], b["shape_id"])].append({"sourceBlockId": block_id, "sourceServiceId": source_service, "fromTripId": a["trip_id"], "toTripId": b["trip_id"], "sharedSourceStopId": a_end["stop_id"], "fromArrivalTime": a_end["arrival_time"].strip(), "toDepartureTime": b_start["departure_time"].strip(), "scheduledLayoverSeconds": gap})
    bus_continuity = []
    service_lookup = {service["serviceId"]: service for service in services}
    path_lookup = {path["sourceShapeId"]: path for path in paths}
    for (a_shape, b_shape), examples in sorted(transitions.items()):
        a_line, a_direction = chosen_shapes[a_shape]
        b_line, b_direction = chosen_shapes[b_shape]
        a_path, b_path = path_lookup[a_shape], path_lookup[b_shape]
        a_stop = service_lookup[f"{a_line}:{a_direction}:regional"]["orderedStops"][-1]
        b_stop = service_lookup[f"{b_line}:{b_direction}:regional"]["orderedStops"][0]
        def stop_tangent(path, stop):
            index = path["sourceShapePointSequences"].index(stop["sourceShapeSegmentSequence"])
            a, b = xy(path["coordinates"][index]), xy(path["coordinates"][index + 1])
            return math.atan2(b[1] - a[1], b[0] - a[0])
        a_heading, b_heading = stop_tangent(a_path, a_stop), stop_tangent(b_path, b_stop)
        heading_delta = abs(math.degrees(math.atan2(math.sin(a_heading - b_heading), math.cos(a_heading - b_heading))))
        bus_continuity.append({
            "fromServiceId": f"{a_line}:{a_direction}:regional", "toServiceId": f"{b_line}:{b_direction}:regional",
            "fromSourceShapeId": a_shape, "toSourceShapeId": b_shape,
            "adjacentActiveTripPairCount": len(examples), "example": sorted(examples, key=lambda e: (e["sourceBlockId"], time_seconds(e["fromArrivalTime"]), e["fromTripId"]))[0],
            "sourceShapeEndpointGapM": distance(a_path["coordinates"][-1], b_path["coordinates"][0]),
            "planarJoinAtScheduledStop": {
                "fromPathStationM": a_stop["pathStationM"], "toPathStationM": b_stop["pathStationM"],
                "fromProjectionLonLat": a_stop["shapeProjectionLonLat"], "toProjectionLonLat": b_stop["shapeProjectionLonLat"],
                "projectionGapM": distance(a_stop["shapeProjectionLonLat"], b_stop["shapeProjectionLonLat"]),
                "headingDifferenceDegrees": heading_delta,
                "construction": "Trim overlapping source-shape tails at the same scheduled-stop projection; no new turn or connector is drawn.",
            },
            "evidenceStatus": "same_active_block_adjacent_trips_same_stop",
            "runtimeContinuationEnabled": False,
            "physicalConnectorStatus": "not_validated_lane_heading_elevation_and_occupancy_required",
            "requiresVehicleAndPassengerIdentityPreserved": True,
        })
    output = {
        "schemaVersion": 1, "packageId": "city-life-transit-sources", "baseRevision": base_revision,
        "status": "offline_source_complete_runtime_pending", "rideReady": False, "coreBoundsWgs84": CORE,
        "source": {"provider": "TransLink", "url": GTFS_URL, "retrievedAtUtc": retrieved_at, "feedVersion": info["feed_version"], "feedPublishedDate": None, "feedVersionDateToken": info["feed_version"].rsplit("_", 1)[-1], "httpLastModified": http_last_modified, "effectiveStartDate": datetime.strptime(info["feed_start_date"], "%Y%m%d").date().isoformat(), "effectiveEndDate": datetime.strptime(info["feed_end_date"], "%Y%m%d").date().isoformat(), "zipSha256": sha256(feed_bytes), "zipBytes": len(feed_bytes), "serviceSelectionDate": service_date.isoformat(), "serviceTimezone": "America/Vancouver", "dateSemantics": "Retrieved timestamp, HTTP modification time and feed-version token are not schedule effective dates; token is not independently authenticated publication date."},
        "attribution": {"termsUrl": TERMS_URL, "requiredProminentLegend": "Use the exact current TransLink GTFS terms section 4 legend wherever derived route/arrival data are presented.", "legendRuntimePlacementStatus": "not_run_no_runtime_consumer", "officialMarksGranted": False, "dataRights": "TransLink retains its data rights; repository code license does not relicense the source feed."},
        "projection": {"kind": "local_equirectangular_wgs84_planar", "referenceLatitudeDegrees": REFERENCE_LATITUDE, "earthRadiusM": 6371008.8, "verticalCoordinatesProvided": False, "purpose": "offline cumulative path station and stop-to-shape projection only"},
        "stationEntities": sorted(station_entities.values(), key=lambda row: row["stationId"]),
        "stationLines": sorted(station_lines.values(), key=lambda row: row["stationLineId"]),
        "services": services, "paths": paths, "busContinuityEvidence": bus_continuity,
        "checks": {"gtfsHash": "passed", "coreStopsAndShapes": "passed", "sourceRouteTripStopJoins": "passed", "stationGisPointVerification": "not_run", "officialStationMapInspection": "not_run", "roadLaneAndRailTrackGeometry": "not_run", "stationEntranceFloorAndDoorAlignment": "not_run", "webglAndSceneIntegration": "not_run"},
        "excluded": ["SeaBus", "West Coast Express", "Millennium Line", "out_of_core_stops", "Olympic Village", "VCC-Clark", "live_arrivals", "night_lighting"],
    }
    continuity_blocks = []
    used_blocks = sorted({(edge["example"]["sourceServiceId"], edge["example"]["sourceBlockId"]) for edge in bus_continuity})
    for service_id, block_id in used_blocks:
        # Sorted in the adjacency pass above. Include every active trip in each
        # example block, not merely the selected shape or public route.
        block_trips = blocks[(service_id, block_id)]
        continuity_blocks.append({
            "sourceServiceId": service_id, "sourceBlockId": block_id,
            "orderedActiveTrips": [{
                "sourceTrip": trip,
                "firstStopTime": stop_times[trip["trip_id"]][0],
                "lastStopTime": stop_times[trip["trip_id"]][-1],
            } for trip in block_trips],
        })
    evidence = {"schemaVersion": 1, "busBlockExamples": continuity_blocks, "sourceZipSha256": sha256(feed_bytes), "selection": selection_evidence, "sourceRows": source_rows, "notes": ["Only selected core stop_times and used stops/parents are retained. Representative rail trip times before/after core are deliberately omitted.", "Raw GTFS stop_id and stop_code are separate strings. Values in sourceRows are verbatim GTFS fields.", "Shape source rows are represented by unsimplified in-core coordinates, original sequence IDs, and complete-shape canonical-row SHA-256 in the snapshot.", "All affected bus-block trips were included in adjacency checks, including non-selected routes/patterns."]}
    validate_snapshot(round_floats(output))
    out.mkdir(parents=True, exist_ok=True)
    write_json(out / "transit-source-snapshot.json", output)
    write_json(out / "gtfs-selection-evidence.json", evidence)
    return {"services": len(services), "stationEntities": len(station_entities), "stationLines": len(station_lines), "railPlatformRecords": sum(len(s["orderedStops"]) for s in services if s["mode"] == "rail"), "busStopOccurrences": sum(len(s["orderedStops"]) for s in services if s["mode"] == "bus"), "shapePoints": sum(len(path["coordinates"]) for path in paths), "busContinuityPairs": len(bus_continuity)}


def validate_snapshot(snapshot, require_ride_ready=False):
    """Keep successful extraction distinct from permission to expose boarding.

    Source-only records can pass source checks. They MUST fail ride readiness.
    Consumers must not treat an extraction pass as an integration approval.
    """
    errors = []
    if snapshot.get("schemaVersion") != 1:
        errors.append("Unsupported source snapshot schema")
    if not re.fullmatch(r"[a-f0-9]{64}", snapshot.get("source", {}).get("zipSha256", "")):
        errors.append("Source SHA-256 is missing/invalid")
    paths = {path["pathId"]: path for path in snapshot.get("paths", [])}
    if len(paths) != len(snapshot.get("paths", [])):
        errors.append("Duplicate path identity")
    services = {service["serviceId"]: service for service in snapshot.get("services", [])}
    if len(services) != len(snapshot.get("services", [])) or not services:
        errors.append("Missing/duplicate service identity")
    for path in paths.values():
        coordinates = path["coordinates"]
        stations = path["cumulativeStationM"]
        if len(coordinates) < 2 or len(coordinates) != len(stations):
            errors.append(path["pathId"] + ": invalid coordinate/station arrays")
            continue
        if not all(len(point) == 2 and all(math.isfinite(x) for x in point) and in_core(*point) for point in coordinates):
            errors.append(path["pathId"] + ": coordinates leave core or are not finite WGS84")
        if stations[0] != 0 or any(b < a for a, b in zip(stations, stations[1:])):
            errors.append(path["pathId"] + ": invalid cumulative path stations")
        if len(coordinates) != len(path["sourceShapePointSequences"]):
            errors.append(path["pathId"] + ": source sequence mapping is incomplete")
    all_stop_ids = []
    for service in services.values():
        sid = service["serviceId"]
        path = paths.get(service["pathId"])
        if path is None or path["sourceShapeId"] != service["sourceShapeId"]:
            errors.append(sid + ": missing/mismatched source shape")
            continue
        stops = service["orderedStops"]
        if len(stops) < 2:
            errors.append(sid + ": insufficient stops")
            continue
        all_stop_ids.extend(stop["serviceStopId"] for stop in stops)
        if any(b["pathStationM"] <= a["pathStationM"] for a, b in zip(stops, stops[1:])):
            errors.append(sid + ": stop path stations not strictly ordered")
        if any(not in_core(*stop["lonLat"]) or not 0 <= stop["pathStationM"] <= path["cumulativeStationM"][-1] + 0.00001 for stop in stops):
            errors.append(sid + ": stop outside core/path")
        if service["servicePathIntervalM"] != [stops[0]["pathStationM"], stops[-1]["pathStationM"]]:
            errors.append(sid + ": service interval must trim to scheduled-stop projections")
        if any(not isinstance(stop["sourceStopId"], str) or (stop["stopCode"] is not None and not isinstance(stop["stopCode"], str)) for stop in stops):
            errors.append(sid + ": source stop ID and stop code must remain separate strings")
    if len(all_stop_ids) != len(set(all_stop_ids)):
        errors.append("Duplicate stable service-stop identity")
    station_lines = {row["stationLineId"]: row for row in snapshot.get("stationLines", [])}
    station_entities = {row["stationId"] for row in snapshot.get("stationEntities", [])}
    for row in station_lines.values():
        if row["stationId"] not in station_entities or not set(row["serviceStopIds"]) <= set(all_stop_ids):
            errors.append("Broken station-line/platform reference: " + row["stationLineId"])
    for service in services.values():
        for stop in service["orderedStops"]:
            if service["mode"] == "rail" and (stop["stationLineId"] not in station_lines or stop["serviceStopId"] not in station_lines[stop["stationLineId"]]["serviceStopIds"]):
                errors.append("Rail stop has no matching station-line identity")
    for edge in snapshot.get("busContinuityEvidence", []):
        first, second = services.get(edge["fromServiceId"]), services.get(edge["toServiceId"])
        if not first or not second:
            errors.append("Continuity edge references unknown services")
            continue
        a, b = first["orderedStops"][-1], second["orderedStops"][0]
        seam = edge["planarJoinAtScheduledStop"]
        if a["sourceStopId"] != b["sourceStopId"] or a["sourceStopId"] != edge["example"]["sharedSourceStopId"]:
            errors.append("Continuity evidence lacks an identical scheduled stop")
        if seam["fromPathStationM"] != a["pathStationM"] or seam["toPathStationM"] != b["pathStationM"]:
            errors.append("Continuity join does not trim source-shape tails at scheduled stop")
        if edge["example"]["scheduledLayoverSeconds"] < 0:
            errors.append("Continuity evidence has negative scheduled layover")
    if errors:
        raise ValueError("Source validation failed: " + "; ".join(errors))
    if not require_ride_ready:
        return {"sourceValidation": "passed", "rideReadinessChecked": False, "rideReady": False}
    # This schema contains source evidence, not validated runtime geometry.
    # Status strings are not proofs. Never promote it by flipping flags or by
    # inventing non-null placeholders; a future runtime package needs its own
    # validator for meshes, frames, profiles, surfaces and physical connectors.
    pending = ["source-only schema cannot authorize ride readiness; a separately validated runtime package is required"]
    for service in services.values():
        sid = service["serviceId"]
        if service.get("boardingEnabled") is not True:
            pending.append(sid + ": boarding disabled")
        if service.get("unresolved"):
            pending.append(sid + ": unresolved physical contract")
        if "pending" in service["vehicleProfileId"] or service.get("vehicleProfileStatus", "").startswith("unresolved"):
            pending.append(sid + ": vehicle profile unresolved")
        for stop in service["orderedStops"]:
            if any(stop.get(key) is None for key in ("surfaceId", "levelId", "elevationM", "doorSide", "boardingZoneId", "alightingZoneId")) or stop.get("stopPoseStatus") != "validated":
                pending.append(sid + ": stop pose/floor/door/boarding geometry unvalidated")
                break
        path = paths[service["pathId"]]
        if path.get("geometryStatus") != "validated_lane_or_track_geometry" or path.get("verticalProfileStatus") != "validated":
            pending.append(sid + ": path is planar source geometry only")
        if service.get("endpointPolicyValidated") is not True:
            pending.append(sid + ": endpoint policy unresolved")
    for service in services.values():
        if service["mode"] == "bus" and not any(edge["fromServiceId"] == service["serviceId"] for edge in snapshot.get("busContinuityEvidence", [])):
            pending.append(service["serviceId"] + ": missing bus endpoint continuity contract")
    for edge in snapshot.get("busContinuityEvidence", []):
        seam = edge["planarJoinAtScheduledStop"]
        if edge.get("runtimeContinuationEnabled") is not True or edge.get("physicalConnectorStatus") != "validated" or seam["projectionGapM"] > 0.02 or seam["headingDifferenceDegrees"] > 1:
            pending.append(edge["fromServiceId"] + ": source-shape-tail continuation is not ride-ready")
    for check in ("roadLaneAndRailTrackGeometry", "stationEntranceFloorAndDoorAlignment", "webglAndSceneIntegration"):
        if snapshot["checks"].get(check) != "passed":
            pending.append(check + ": not passed")
    raise ValueError("Ride-readiness rejected: " + "; ".join(pending))


class ImporterTests(unittest.TestCase):
    def test_gtfs_times_over_24_hours(self):
        self.assertEqual(time_seconds(" 25:03:04"), 90184)
        with self.assertRaises(ValueError):
            time_seconds("05:61:00")

    def test_calendar_exception_overrides(self):
        calendar = {"service_id": "1", "start_date": "20261001", "end_date": "20261031", "wednesday": "1"}
        exceptions = [{"service_id": "1", "date": "20261007", "exception_type": "2"}, {"service_id": "2", "date": "20261007", "exception_type": "1"}]
        self.assertEqual(active_service_ids([calendar], exceptions, date(2026, 10, 7)), {"2"})

    def test_core_edges_and_excluded_olympic(self):
        self.assertTrue(in_core(-123.165, 49.267))
        self.assertFalse(in_core(-123.115527, 49.266557))

    def test_projection_monotonic_and_shape_preserved(self):
        points = [[-123.12, 49.28], [-123.119, 49.28], [-123.119, 49.281]]
        stations = cumulative(points)
        a = project([-123.1195, 49.28], points, stations)
        b = project([-123.119, 49.2805], points, stations, a["stationM"])
        clipped, indices = clip_shape(points, stations, a, b)
        self.assertEqual(clipped[1], points[1])
        self.assertEqual(indices, [None, 1, None])
        self.assertGreater(b["stationM"], a["stationM"])
        self.assertLess(a["offsetM"], 0.001)

    def test_degenerate_shape_rejected(self):
        points = [[-123.12, 49.28]] * 2
        with self.assertRaises(ValueError):
            project(points[0], points, cumulative(points))

    def test_identity_does_not_use_source_id(self):
        first = {"name": "Burrard Station @ Bay 1", "sourceStopId": "8535"}
        updated = {**first, "sourceStopId": "changed"}
        self.assertEqual(atlas_stop_id(first, "bus-5", "westbound"), atlas_stop_id(updated, "bus-5", "westbound"))
        self.assertNotEqual(atlas_stop_id({"name": "Waterfront Station @ Platform 1"}, "expo", "westbound"), atlas_stop_id({"name": "Waterfront Station @ Platform 5"}, "canada", "northbound"))


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--gtfs", type=Path, help="Local official GTFS ZIP (not checked in)")
    parser.add_argument("--download", action="store_true", help="Download official feed to --gtfs, overwriting only that local input")
    parser.add_argument("--out", type=Path, default=Path(__file__).parent)
    parser.add_argument("--service-date", type=date.fromisoformat, default=date(2026, 10, 7))
    parser.add_argument("--retrieved-at", help="UTC retrieval timestamp for provenance/reproducibility")
    parser.add_argument("--http-last-modified")
    parser.add_argument("--base-revision", default=BASE_REVISION)
    parser.add_argument("--expect-sha256", help="Reject replacement feed before extraction")
    parser.add_argument("--self-test", action="store_true")
    parser.add_argument("--validate", type=Path, help="Validate a checked-in source snapshot without feed access")
    parser.add_argument("--require-ride-ready", action="store_true", help="Reject source-only/unresolved geometry; use with --validate")
    args = parser.parse_args()
    if args.self_test:
        result = unittest.TextTestRunner(verbosity=2).run(unittest.defaultTestLoader.loadTestsFromTestCase(ImporterTests))
        raise SystemExit(not result.wasSuccessful())
    if args.validate:
        try:
            print(json.dumps(validate_snapshot(json.loads(args.validate.read_text(encoding="utf-8")), args.require_ride_ready), sort_keys=True))
        except (ValueError, KeyError, TypeError) as error:
            parser.exit(1, str(error) + "\n")
        return
    if args.require_ride_ready:
        parser.error("--require-ride-ready requires --validate")
    if args.gtfs is None:
        parser.error("--gtfs is required unless --self-test is used")
    if args.download:
        args.gtfs.parent.mkdir(parents=True, exist_ok=True)
        with urllib.request.urlopen(GTFS_URL, timeout=90) as response:
            data = response.read()
            args.http_last_modified = response.headers.get("Last-Modified")
        zipfile.ZipFile(io.BytesIO(data)).testzip()
        args.gtfs.write_bytes(data)
        args.retrieved_at = datetime.now(timezone.utc).isoformat().replace("+00:00", "Z")
    if args.expect_sha256 and sha256(args.gtfs.read_bytes()) != args.expect_sha256:
        parser.error("GTFS SHA-256 differs; select/review the replacement feed explicitly")
    if not args.retrieved_at:
        parser.error("--retrieved-at is required for an existing ZIP; do not invent its retrieval time")
    print(json.dumps(extract(args.gtfs, args.out, args.service_date, args.retrieved_at, args.base_revision, args.http_last_modified), sort_keys=True))


if __name__ == "__main__":
    main()
