#!/usr/bin/env python3
"""Export complete source-backed SkyTrain trips; never replace the old regional packet.

Python standard library only. Archive acquisition is explicit; this command reads
the supplied official GTFS ZIP and preserves its selected shape vertices. The
runtime service clock supplies illustrative timing, not the published timetable.
"""
from __future__ import annotations

import argparse
from collections import defaultdict
import hashlib
import importlib.util
import json
from pathlib import Path
from datetime import date
import zipfile

UTILITY = Path(__file__).with_name("city-life-sources") / "import_gtfs.py"
SPEC = importlib.util.spec_from_file_location("atlas_gtfs_source", UTILITY)
gtfs = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(gtfs)
LEGEND = ("Route and arrival data used in this product or service is provided by permission of TransLink. "
          "TransLink assumes no responsibility for the accuracy or currency of the Data used in this product or service.")
PATTERNS = [
    ("expo", "30053", "0", "eastbound", "Waterfront Station", "King George Station"),
    ("expo", "30053", "1", "westbound", "King George Station", "Waterfront Station"),
    ("canada", "13686", "1", "southbound", "Waterfront Station", "Richmond-Brighouse Station"),
    ("canada", "13686", "0", "northbound", "Richmond-Brighouse Station", "Waterfront Station"),
]


def canonical(value):
    return json.dumps(value, ensure_ascii=False, separators=(",", ":"), sort_keys=True, allow_nan=False).encode()


def digest(value):
    return hashlib.sha256(canonical(value)).hexdigest()


def extract(feed_path: Path, selection_date: date):
    raw = feed_path.read_bytes()
    archive = zipfile.ZipFile(feed_path)
    info = next(gtfs.csv_rows(archive, "feed_info.txt"))
    if not info["feed_start_date"] <= selection_date.strftime("%Y%m%d") <= info["feed_end_date"]:
        raise ValueError("Selection date outside GTFS effective interval")
    active = gtfs.active_service_ids(list(gtfs.csv_rows(archive, "calendar.txt")),
                                    list(gtfs.csv_rows(archive, "calendar_dates.txt")), selection_date)
    source_routes = {row["route_id"]: row for row in gtfs.csv_rows(archive, "routes.txt")}
    for route_id, expected in [("30053", "Expo Line"), ("13686", "Canada Line")]:
        if source_routes[route_id]["route_long_name"] != expected:
            raise ValueError("Unreviewed feed route identity")
    trips = {row["trip_id"]: row for row in gtfs.csv_rows(archive, "trips.txt")
             if row["route_id"] in {"30053", "13686"} and row["service_id"] in active}
    stops = {row["stop_id"]: row for row in gtfs.csv_rows(archive, "stops.txt")}
    times = defaultdict(list)
    for row in gtfs.csv_rows(archive, "stop_times.txt"):
        if row["trip_id"] in trips:
            times[row["trip_id"]].append(row)
    for rows in times.values():
        rows.sort(key=lambda row: int(row["stop_sequence"]))
    selections = []
    name = lambda stop_id: stops[stop_id]["stop_name"].split(" @ ")[0]
    for line, route_id, direction_id, direction, first, last in PATTERNS:
        patterns = defaultdict(list)
        for trip in trips.values():
            if trip["route_id"] != route_id or trip["direction_id"] != direction_id:
                continue
            rows = times[trip["trip_id"]]
            if rows and name(rows[0]["stop_id"]) == first and name(rows[-1]["stop_id"]) == last:
                patterns[(trip["shape_id"], tuple(row["stop_id"] for row in rows))].append(trip)
        if not patterns:
            raise ValueError(f"No complete active trip: {line} {direction}")
        key, candidates = sorted(patterns.items(), key=lambda item: (-len(item[1]), item[0]))[0]
        candidates.sort(key=lambda trip: (gtfs.time_seconds(times[trip["trip_id"]][0]["departure_time"]), trip["trip_id"]))
        chosen = next((trip for trip in candidates if gtfs.time_seconds(times[trip["trip_id"]][0]["departure_time"]) >= 36000), candidates[0])
        selections.append((line, direction, chosen, key, len(candidates)))
    shape_ids = {chosen["shape_id"] for _, _, chosen, _, _ in selections}
    shapes = defaultdict(list)
    for row in gtfs.csv_rows(archive, "shapes.txt"):
        if row["shape_id"] in shape_ids:
            shapes[row["shape_id"]].append(row)
    for rows in shapes.values():
        rows.sort(key=lambda row: int(row["shape_pt_sequence"]))
    routes = []
    for line, direction, chosen, key, count in selections:
        shape_rows = shapes[chosen["shape_id"]]
        points = [[float(row["shape_pt_lon"]), float(row["shape_pt_lat"])] for row in shape_rows]
        cumulative = gtfs.cumulative(points)
        rows = times[chosen["trip_id"]]
        projected, result_stops = [], []
        minimum = 0.0
        for row in rows:
            stop = stops[row["stop_id"]]
            lonlat = [float(stop["stop_lon"]), float(stop["stop_lat"])]
            hit = gtfs.project(lonlat, points, cumulative, minimum)
            if hit["offsetM"] > 160 or projected and hit["stationM"] - minimum < 10:
                raise ValueError("Source stop does not project monotonically onto the selected shape")
            projected.append(hit)
            minimum = hit["stationM"]
            result_stops.append({"id": row["stop_id"], "sourceStopId": row["stop_id"],
                                 "stationId": gtfs.STATIONS.get(name(row["stop_id"])),
                                 "name": stop["stop_name"], "lonLat": lonlat,
                                 "shapeProjection": hit})
        segments = []
        retained_indices = set()
        for index, (first, last) in enumerate(zip(projected, projected[1:])):
            coordinates, source_indices = gtfs.clip_shape(points, cumulative, first, last)
            retained_indices.update(i for i in source_indices if i is not None)
            segments.append({"coordinates": coordinates, "lengthM": gtfs.cumulative(coordinates)[-1],
                             "fromStopId": result_stops[index]["id"], "toStopId": result_stops[index + 1]["id"]})
        expected_indices = {index for index, station in enumerate(cumulative)
                            if projected[0]["stationM"] + 1e-8 < station < projected[-1]["stationM"] - 1e-8}
        if expected_indices != retained_indices:
            raise ValueError("Partition lost source shape vertices")
        routes.append({"lineId": line, "direction": direction, "headsign": chosen["trip_headsign"],
                       "sourceTripId": chosen["trip_id"], "sourceShapeId": chosen["shape_id"],
                       "sourceRouteId": chosen["route_id"], "sourceServiceId": chosen["service_id"],
                       "sourceDirectionId": chosen["direction_id"], "activePatternTripCount": count,
                       "sourceTripRowSha256": digest(chosen), "sourceStopTimesRowsSha256": digest(rows),
                       "sourceStopRowsSha256": digest([stops[row["stop_id"]] for row in rows]),
                       "sourceShapeRowsSha256": digest(shape_rows), "sourceShapeVertexCount": len(points),
                       "retainedSourceShapeVertexCount": len(retained_indices),
                       "retainedSourceShapeVerticesSha256": digest([points[index] for index in sorted(retained_indices)]),
                       "stops": result_stops, "segments": segments})
    return {"schema": 1, "source": {"provider": info["feed_publisher_name"], "url": gtfs.GTFS_URL,
             "termsUrl": gtfs.TERMS_URL, "legend": LEGEND, "feedVersion": info["feed_version"],
             "effectiveStartDate": info["feed_start_date"], "effectiveEndDate": info["feed_end_date"],
             "selectionDate": selection_date.isoformat(), "zipSha256": hashlib.sha256(raw).hexdigest(),
             "zipBytes": len(raw), "routeIds": {"expo": "30053", "canada": "13686"},
             "dateSemantics": "Selection date and feed-version token are not independently authenticated publication dates.",
             "construction": "Complete active terminal-to-terminal trips in both source directions; all intermediate shape vertices retained between monotonic scheduled-stop projections. No straight stop-to-stop chords or downtown edge turnbacks.",
             "simulation": "Illustrative autonomous service timing, spacing and physical terminal crossovers; source geometry and stop identities are GTFS. Not live service, exact timetables, or surveyed vertical alignments.",
             "scope": "Expo Waterfront–King George and Canada Waterfront–Richmond-Brighouse; full trips continue beyond the seven authored downtown interiors. No Production Way or airport branch implied."},
            "routes": routes}


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--feed", type=Path, required=True)
    parser.add_argument("--selection-date", type=date.fromisoformat, default=date(2026, 10, 22))
    parser.add_argument("--out", type=Path, default=Path("public/data/transit/skytrain-world-routes.json"))
    parser.add_argument("--check", action="store_true")
    args = parser.parse_args()
    payload = extract(args.feed, args.selection_date)
    output = json.dumps(payload, ensure_ascii=False, separators=(",", ":"), allow_nan=False) + "\n"
    if args.check:
        if args.out.read_text() != output:
            raise ValueError("Committed full SkyTrain route export differs from supplied source archive")
    else:
        args.out.parent.mkdir(parents=True, exist_ok=True)
        args.out.write_text(output)
    print(json.dumps({"status": "pass", "check": args.check, "routes": len(payload["routes"]),
                      "sourceSha256": payload["source"]["zipSha256"],
                      "stops": [len(route["stops"]) for route in payload["routes"]],
                      "shapeVertices": [route["sourceShapeVertexCount"] for route in payload["routes"]]}))


if __name__ == "__main__":
    main()
