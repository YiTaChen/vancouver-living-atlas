#!/usr/bin/env python3
"""Independent, read-only GLB audit; writes only this audit folder's result.

The triangle probes implement their own GLB reader, transforms, ray intersections
and point-to-triangle distances. They do not call the asset generators or their
geometry/contract helpers. Existing package validators are also run, separately,
with report writes diverted to memory; their results are not the independent
geometry evidence.
"""
from __future__ import annotations

import argparse
import datetime
import hashlib
import json
import os
from pathlib import Path
import platform
import struct
import subprocess
import sys

import numpy as np

HERE = Path(__file__).resolve().parent
ASSETS = HERE.parent
REPO = ASSETS.parent.parent
PACKAGES = ("boardable-bus", "boardable-metro", "transit-station-spaces")


def need(condition, message):
    if not condition:
        raise AssertionError(message)


def sha(path):
    return hashlib.sha256(path.read_bytes()).hexdigest()


def read_json(path):
    return json.loads(path.read_text())


def transform(node):
    if "matrix" in node:
        return np.array(node["matrix"], dtype=float).reshape(4, 4).T
    x, y, z, w = node.get("rotation", node.get("rotationQuaternionXYZW", [0, 0, 0, 1]))
    need(abs(x*x+y*y+z*z+w*w-1) < 1e-5, "Non-unit quaternion")
    matrix = np.eye(4)
    matrix[:3, :3] = [
        [1-2*(y*y+z*z), 2*(x*y-z*w), 2*(x*z+y*w)],
        [2*(x*y+z*w), 1-2*(x*x+z*z), 2*(y*z-x*w)],
        [2*(x*z-y*w), 2*(y*z+x*w), 1-2*(x*x+y*y)],
    ]
    matrix[:3, :3] *= node.get("scale", [1, 1, 1])
    matrix[:3, 3] = node.get("translation", node.get("translationM", [0, 0, 0]))
    return matrix


def apply_transform(points, matrix):
    shape = points.shape
    flat = points.reshape(-1, 3)
    return (np.c_[flat, np.ones(len(flat))] @ matrix.T)[:, :3].reshape(shape)


def load_glb(path, overrides=None):
    """Read ordinary triangle GLB; apply the scene's node hierarchy exactly once."""
    raw = path.read_bytes()
    need(struct.unpack_from("<4sII", raw) == (b"glTF", 2, len(raw)), f"Bad GLB header: {path}")
    json_length, json_type = struct.unpack_from("<I4s", raw, 12)
    need(json_type == b"JSON", "First GLB chunk must be JSON")
    doc = json.loads(raw[20:20+json_length])
    binary_length, binary_type = struct.unpack_from("<I4s", raw, 20+json_length)
    need(binary_type == b"BIN\0", "Second GLB chunk must be BIN")
    binary = raw[28+json_length:28+json_length+binary_length]
    triangles, names, nodes, primitive_count = [], [], {}, 0

    def accessor(index):
        item = doc["accessors"][index]
        need("sparse" not in item, "Sparse accessors are outside this audit's scope")
        view = doc["bufferViews"][item["bufferView"]]
        dtype = np.dtype({5126: "<f4", 5125: "<u4", 5123: "<u2", 5121: "u1"}[item["componentType"]])
        columns = {"SCALAR": 1, "VEC2": 2, "VEC3": 3, "VEC4": 4}[item["type"]]
        result = np.ndarray(
            (item["count"], columns), dtype=dtype, buffer=binary,
            offset=view.get("byteOffset", 0)+item.get("byteOffset", 0),
            strides=(view.get("byteStride", dtype.itemsize*columns), dtype.itemsize),
        ).copy()
        need(np.isfinite(result).all(), "Non-finite accessor")
        return result

    def visit(index, parent):
        nonlocal primitive_count
        original = doc["nodes"][index]
        name = original.get("name", str(index))
        node = original | (overrides or {}).get(name, {})
        matrix = parent @ transform(node)
        need(name not in nodes, f"Duplicate node name: {name}")
        nodes[name] = (matrix, original)
        if "mesh" in original:
            for primitive in doc["meshes"][original["mesh"]]["primitives"]:
                need(primitive.get("mode", 4) == 4, "Only triangle primitives are supported")
                primitive_count += 1
                points = apply_transform(accessor(primitive["attributes"]["POSITION"]), matrix)
                indices = accessor(primitive["indices"]).reshape(-1, 3)
                actual = points[indices]
                triangles.extend(actual)
                ranges = original.get("extras", {}).get("componentRanges", [])
                if ranges:
                    # Geometry comes from actual batch indices. A named empty node
                    # is useful provenance, never a substitute for geometry.
                    index_cursor = vertex_cursor = 0
                    for component in ranges:
                        need(component["indexStart"] == index_cursor, "Batch index gap/overlap")
                        need(component["vertexStart"] == vertex_cursor, "Batch vertex gap/overlap")
                        source = doc["nodes"][component["sourceNodeIndex"]]
                        need(source["name"] == component["componentId"] and "mesh" not in source,
                             "Missing zero-draw semantic component anchor")
                        selected = indices.reshape(-1)[index_cursor:index_cursor+component["indexCount"]]
                        need(np.all((selected >= vertex_cursor) & (selected < vertex_cursor+component["vertexCount"])),
                             "Component index escapes vertex range")
                        names.extend([component["componentId"]] * (component["indexCount"]//3))
                        index_cursor += component["indexCount"]
                        vertex_cursor += component["vertexCount"]
                    need(index_cursor == indices.size and vertex_cursor == len(points), "Incomplete batch coverage")
                else:
                    names.extend([name]*len(actual))
        for child in original.get("children", []):
            visit(child, matrix)

    for root in doc["scenes"][doc.get("scene", 0)]["nodes"]:
        visit(root, np.eye(4))
    result = np.array(triangles)
    need(len(result) == len(names), "Triangle attribution mismatch")
    return result, np.array(names), nodes, primitive_count


def ray(triangles, origin, direction):
    """Two-sided Moller-Trumbore intersections, returned in increasing distance."""
    origin, direction = np.array(origin), np.array(direction)
    a = triangles[:, 0]
    edge1, edge2 = triangles[:, 1]-a, triangles[:, 2]-a
    cross = np.cross(direction, edge2)
    determinant = np.einsum("ij,ij->i", edge1, cross)
    valid = np.abs(determinant) > 1e-9
    inverse = np.divide(1, determinant, out=np.zeros_like(determinant), where=valid)
    offset = origin-a
    u = inverse*np.einsum("ij,ij->i", offset, cross)
    q = np.cross(offset, edge1)
    v = inverse*(q @ direction)
    distance = inverse*np.einsum("ij,ij->i", q, edge2)
    valid &= (u >= -1e-8) & (v >= -1e-8) & (u+v <= 1+1e-8) & (distance > 1e-6)
    return sorted((float(distance[i]), int(i)) for i in np.flatnonzero(valid))


def distance_to_triangles(triangles, point):
    """Nearest plane projection inside a triangle, or nearest triangle edge."""
    point = np.array(point)
    a, b, c = triangles[:, 0], triangles[:, 1], triangles[:, 2]
    normal = np.cross(b-a, c-a)
    squared_normal = np.einsum("ij,ij->i", normal, normal)
    need(np.all(squared_normal > 1e-20), "Degenerate triangle")
    plane = np.einsum("ij,ij->i", point-a, normal)
    projection = point-normal*(plane/squared_normal)[:, None]
    inside = np.ones(len(triangles), dtype=bool)
    for start, end in [(a, b), (b, c), (c, a)]:
        inside &= np.einsum("ij,ij->i", np.cross(end-start, projection-start), normal) >= -1e-8
    squared_distance = np.where(inside, plane*plane/squared_normal, np.inf)
    for start, end in [(a, b), (b, c), (c, a)]:
        edge = end-start
        fraction = np.clip(np.einsum("ij,ij->i", point-start, edge)/np.einsum("ij,ij->i", edge, edge), 0, 1)
        delta = point-(start+edge*fraction[:, None])
        squared_distance = np.minimum(squared_distance, np.einsum("ij,ij->i", delta, delta))
    index = int(np.argmin(squared_distance))
    return float(np.sqrt(squared_distance[index])), index


def vehicle_probes():
    results = []
    for package in PACKAGES[:2]:
        folder = ASSETS/package
        manifest = read_json(folder/"manifest.json")
        assets = {asset["id"]: asset for asset in manifest["assets"]}
        bus = package == "boardable-bus"
        for vehicle in manifest["vehicles"]:
            for lod in [0, 1]:
                opened = {door["nodeId"]: {"translation": door["openTransform"]["translationM"]}
                          for door in vehicle["doors"]}
                exterior, exterior_names, exterior_nodes, exterior_primitives = load_glb(
                    folder/assets[vehicle["assetRefs"]["exterior"]]["lods"][lod]["file"], opened)
                interior, interior_names, _, interior_primitives = load_glb(
                    folder/assets[vehicle["assetRefs"]["interior"]]["lods"][lod]["file"])
                combined = np.concatenate([exterior, interior])
                names = np.concatenate([exterior_names, interior_names])
                seats = []
                for seat in vehicle["seats"]:
                    head = np.array(seat["cameraEyePointM"])+[0, .07, 0]
                    clearance, nearest = distance_to_triangles(combined, head)
                    need(clearance >= .12, f"Head collision: {package} {lod} {seat['seatId']}")
                    selected = np.char.startswith(interior_names, seat["seatId"]+"-cushion") if bus else interior_names == seat["nodeId"]
                    cushion = interior[selected]
                    target = .81 if bus else 1.4
                    tops = [tri for tri in cushion if np.cross(tri[1]-tri[0], tri[2]-tri[0])[1] > 1e-8
                            and abs(np.ptp(tri[:, 1])) < 1e-7 and abs(tri[0, 1]-target) < .02]
                    need(tops, f"No actual cushion top: {seat['seatId']}")
                    bounds = np.array(tops).reshape(-1, 3)
                    size = np.ptp(bounds, axis=0)
                    need(.4 <= size[0] <= .51 and .4 <= size[2] <= .51, "Cushion outside human-scale target")
                    seats.append({"seatId": seat["seatId"], "actualFlatTopSizeXZ_M": size[[0, 2]].tolist(),
                                  "actualTopHeightM": float(bounds[:, 1].max()), "headRadiusM": .12,
                                  "nearestHeadCentreToTriangleM": clearance, "nearestComponent": str(names[nearest])})
                openings = {tuple(np.array(door["openingPolygonM"]).min(axis=0)): door for door in vehicle["doors"]}
                portal_rays = 0
                for door in openings.values():
                    polygon = np.array(door["openingPolygonM"])
                    low, high = polygon.min(axis=0), polygon.max(axis=0)
                    sign = door["outwardNormal"][0]
                    for z in np.linspace(low[2]+.003, high[2]-.003, 17):
                        for y in np.linspace(low[1]+.003, high[1]-.003, 17):
                            hits = [hit for hit in ray(combined, [sign*1.75, y, z], [-sign, 0, 0]) if hit[0] <= 1.05]
                            need(not hits, f"Door obstruction: {package} LOD{lod} {door['doorId']} at {y}/{z}")
                            portal_rays += 1
                wheels = []
                for wheel in vehicle["wheels"]:
                    actual_centre = exterior_nodes[wheel["nodeId"]][0][:3, 3]
                    need(np.max(np.abs(actual_centre-wheel["centerM"])) < .00002, "Wheel anchor drift")
                    selection = np.char.startswith(exterior_names, wheel["nodeId"]+"-tyre") if bus else exterior_names == wheel["nodeId"]
                    actual = exterior[selection].reshape(-1, 3)
                    need(len(actual) > 0, "Wheel has no actual geometry")
                    need(abs(actual[:, 1].min()) < .002, "Wheel contact is not Y=0")
                    need(abs(actual[:, 1].max()-2*wheel["radiusM"]) < .002, "Wheel diameter mismatch")
                    wheels.append({"nodeId": wheel["nodeId"], "contactY_M": float(actual[:, 1].min()),
                                   "actualDiameterY_M": float(np.ptp(actual[:, 1]))})
                floor_samples = 0
                for surface in vehicle["floorSurfaces"]:
                    vertices = np.array(surface["verticesM"])
                    geometry = exterior if surface.get("resource") == "exterior" else interior
                    for indices in np.array(surface["indices"]).reshape(-1, 3):
                        point = vertices[indices].mean(axis=0)
                        hits = ray(geometry, point+[0, .03, 0], [0, -1, 0])
                        need(hits and abs(hits[0][0]-.03) < .002, "Actual floor surface mismatch")
                        floor_samples += 1
                floor = .36 if bus else .95
                headroom = []
                for z in np.linspace(-5.2 if bus else -8.2, 3.6 if bus else 8.2, 41):
                    for x in [-.2, 0, .2]:
                        hits = ray(combined, [x, floor+.001, z], [0, 1, 0])
                        need(hits and hits[0][0]+.001 >= 2.05, "Cabin headroom below 2.05 m")
                        headroom.append(hits[0][0]+.001)
                results.append({"packageId": package, "vehicleId": vehicle["vehicleId"], "lod": lod,
                                "status": "pass", "openDoorwayRays": portal_rays, "seatChecks": seats,
                                "wheelChecks": wheels, "floorCentroidRays": floor_samples,
                                "cabinHeadroomRays": len(headroom), "minimumSampledCabinHeadroomM": min(headroom),
                                "exteriorPrimitives": exterior_primitives, "interiorPrimitives": interior_primitives})
    return results


def bridge_probes():
    layout = read_json(ASSETS/"transit-station-spaces/station-layout.json")
    results = []
    for stop in layout["stops"]:
        for alignment in stop["doorAlignmentPoints"]:
            deck = alignment["thresholdDeck"]
            for lod in [0, 1]:
                path = ASSETS/"transit-station-spaces/exports"/(deck["assetId"]+f".lod{lod}.glb")
                triangles, _, _, _ = load_glb(path)
                stored = apply_transform(triangles, transform(deck["retractedTransform"]))
                gap = float(stored[:, :, 1].min()-stop["floorHeightM"])
                need(abs(gap) <= .00002, f"Stored bridge not grounded: {deck['instanceId']} LOD{lod}: {gap}")
                exclusion = next(item for item in stop["exclusions"] if item["id"] == deck["instanceId"]+"-storage")
                bounds = np.array(exclusion["polygonM"])
                for axis in [0, 2]:
                    need(stored[:, :, axis].min() >= bounds[:, axis].min()-.00002 and
                         stored[:, :, axis].max() <= bounds[:, axis].max()+.00002, "Stored bridge escapes declared footprint")
                deployed = apply_transform(triangles, transform(deck["deployedTransform"]))
                samples = 0
                for polygon in deck["walkableSurfacePolygonsM"]:
                    polygon = np.array(polygon)
                    for fx in [.03, .3, .7, .97]:
                        for fz in [.03, .3, .7, .97]:
                            point = (polygon[0]*(1-fx)*(1-fz)+polygon[1]*fx*(1-fz)+
                                     polygon[2]*fx*fz+polygon[3]*(1-fx)*fz)
                            hits = ray(deployed, point+[0, .1, 0], [0, -1, 0])
                            need(hits and abs(hits[0][0]-.1) < .002, "Deck walk polygon differs from actual GLB")
                            samples += 1
                need(deck["enabled"] is False, "Offline bridge must remain runtime-gated")
                results.append({"stopId": stop["stopId"], "instanceId": deck["instanceId"], "lod": lod,
                                "status": "pass", "storedFloorGapM": gap, "storedWithinExclusion": True,
                                "deployedWalkSurfaceRays": samples, "runtimeEnabled": False})
    return results


def snapshot_inputs():
    """Snapshot current sources, GLBs, contracts and cited evidence, without mutating them."""
    paths = {HERE/"audit.py", HERE/"README.md", REPO/"docs/AI_AGENT_DEVELOPMENT_BACKLOG.md",
             ASSETS/"package-contract/validate.py"}
    for package in PACKAGES:
        folder = ASSETS/package
        manifest = read_json(folder/"manifest.json")
        paths.add(folder/"manifest.json")
        for asset in manifest["assets"]:
            for lod in asset["lods"]:
                for field, hash_field in [("source", "sourceSha256"), ("file", "sha256")]:
                    path = folder/lod[field]
                    need(sha(path) == lod[hash_field], f"Manifest hash stale: {path}")
                    paths.add(path)
        for path in folder.rglob("*.py"):
            paths.add(path)
        for path in (folder/"qa").glob("*.json"):
            paths.add(path)
        if (folder/"qa/previews/index.json").exists():
            paths.add(folder/"qa/previews/index.json")
    station = ASSETS/"transit-station-spaces"
    paths.add(station/"station-layout.json")
    dependencies = []
    for dependency in read_json(station/"manifest.json")["dependencies"]:
        path = (station/dependency["manifest"]).resolve()
        actual = sha(path)
        need(actual == dependency["sha256AtLayoutBuild"], f"Dependency snapshot stale: {path}")
        paths.add(path)
        dependencies.append({"packageId": dependency["packageId"], "manifest": str(path.relative_to(REPO)),
                             "sha256": actual, "matchesStationSnapshot": True})
        if dependency["packageId"] == "street-furniture-expansion":
            shelter = next(asset for asset in read_json(path)["assets"] if asset["id"] == "transit-shelter")
            for lod in shelter["lods"]:
                for field in ["file", "source"]:
                    paths.add(path.parent/lod[field])
    # Existing Blender evidence must describe the exact current files.
    folder = ASSETS/"boardable-bus"
    for row in read_json(folder/"qa/blender-validation.json")["sourceReopenReexport"]:
        need(sha(folder/row["source"]) == row["sourceSha256"], "Bus source evidence stale")
        need(sha(folder/"exports"/(Path(row["source"]).stem+".glb")) == row["deliveredSha256"], "Bus output evidence stale")
    folder = ASSETS/"boardable-metro"
    for row in read_json(folder/"qa/source-roundtrip.json")["sources"]:
        need(sha(folder/"source"/row["source"]) == row["sourceSha256"], "Metro source evidence stale")
        need(sha(folder/"exports"/row["output"]) == row["actualDeliveredSha256"], "Metro output evidence stale")
    batch_path = station/"qa/static-batching.json"
    station_batches = {row["file"]: row for row in read_json(batch_path)["results"]} if batch_path.exists() else {}
    for row in read_json(station/"qa/blender-validation.json")["sourceRoundtrip"]:
        stem = row["assetId"]+".lod"+str(row["lod"])
        need(sha(station/"source"/(stem+".blend")) == row["sourceSha256"], "Station source evidence stale")
        actual = sha(station/"exports"/(stem+".glb"))
        if actual != row["exportSha256"]:
            # The station's new export-only static batching preserves its raw
            # Blender roundtrip proof. Require a complete, explicit two-hop
            # hash chain rather than accepting a stale raw hash as final output.
            batch = station_batches.get(stem+".glb", {})
            need(batch.get("status") == "pass" and batch.get("unbatchedSha256") == row["exportSha256"]
                 and batch.get("batchedSha256") == actual, "Station raw-to-batched evidence chain stale")
            need(batch.get("allOriginalNodeTransformsPreserved") is True, "Station batch anchor provenance missing")
            for component in batch["componentRanges"]:
                need(component["indicesIdenticalAfterVertexBaseSubtraction"] is True, "Station batch indices differ")
                need(max(component["attributeMaxErrors"].values()) < 1e-5, "Station batch attribute errors exceed tolerance")
    for name, digest in read_json(station/"qa/threshold-validation.json")["inputGlbHashes"].items():
        need(sha(ASSETS/name) == digest, f"Threshold audit input stale: {name}")
    inputs = [{"path": str(path.relative_to(REPO)), "bytes": path.stat().st_size, "sha256": sha(path)}
              for path in sorted(paths)]
    return inputs, dependencies


def package_validators():
    """Run existing validators separately; never write into their packages."""
    common_code = """import importlib.util,pathlib,json
p=pathlib.Path('tools/assets/package-contract/validate.py').resolve()
s=importlib.util.spec_from_file_location('common',p);m=importlib.util.module_from_spec(s);s.loader.exec_module(m)
for name in ['boardable-bus','boardable-metro','transit-station-spaces']:
 r=m.validate(p.parent.parent/name);print(json.dumps({'packageId':name,'status':'pass','glbCount':len(r['results'])}))
"""
    bus_code = """import importlib.util,pathlib,contextlib,io,json
p=pathlib.Path('tools/assets/boardable-bus/validate.py').resolve()
s=importlib.util.spec_from_file_location('audit_bus',p);v=importlib.util.module_from_spec(s);s.loader.exec_module(v)
reports={}
def capture(path,data,*args,**kwargs):
 assert path.parent==p.parent/'qa' and path.name in ['validation.json','common-validation.json'],str(path)
 reports[path.name]=json.loads(data);return len(data)
pathlib.Path.write_text=capture
with contextlib.redirect_stdout(io.StringIO()):v.main()
print(json.dumps({'status':reports['validation.json']['status'],'checkCount':len(reports['validation.json']['checks']),'packageWrites':'diverted to memory'}))
"""
    station_code = """import importlib.util,pathlib,json
p=pathlib.Path('tools/assets/transit-station-spaces/validate.py').resolve()
s=importlib.util.spec_from_file_location('audit_station',p);v=importlib.util.module_from_spec(s);s.loader.exec_module(v)
v.dump=lambda *args:None
r=v.validate();print(json.dumps({'status':r['status'],'negativeControls':len(r['negativeControls']),'packageWrites':'diverted to memory'}))
"""
    commands = [("common package contracts", [sys.executable, "-c", common_code]),
                ("bus validator, in-memory reports", [sys.executable, "-c", bus_code]),
                ("bus regressions", [sys.executable, "tools/assets/boardable-bus/test_contract.py"]),
                ("metro regressions and geometry validator", [sys.executable, "tools/assets/boardable-metro/test_validate.py"]),
                ("station validator, in-memory reports", [sys.executable, "-c", station_code])]
    results = []
    for label, command in commands:
        run = subprocess.run(command, cwd=REPO, env=os.environ | {"PYTHONDONTWRITEBYTECODE": "1"},
                             text=True, capture_output=True, timeout=180)
        need(run.returncode == 0, f"{label} failed:\n{run.stdout}\n{run.stderr}")
        results.append({"check": label, "status": "pass", "exitCode": run.returncode,
                        "stdout": run.stdout.strip(), "stderr": run.stderr.strip()})
    return results


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--output", type=Path, default=HERE/"report.json")
    args = parser.parse_args()
    need(args.output.resolve().parent == HERE, "Output must remain in this audit folder")
    inputs, dependencies = snapshot_inputs()
    validators = package_validators()
    vehicles = vehicle_probes()
    bridges = bridge_probes()
    platform_costs = []
    for lod in [0, 1]:
        _, _, _, primitives = load_glb(ASSETS/"transit-station-spaces/exports"/f"platform-edge-2m.lod{lod}.glb")
        platform_costs.append({"lod": lod, "primitiveCountPerModule": primitives,
                               "moduleInstances": 37, "primitiveInstancesBeforeRuntimeInstancing": primitives*37})
    after, _ = snapshot_inputs()
    need(after == inputs, "Inputs changed during review; rerun after dependency work finishes")
    report = {
        "schemaVersion": 1, "documentKind": "independent-transit-audit-reference", "status": "pass",
        "reviewedAtUtc": datetime.datetime.now(datetime.timezone.utc).isoformat(),
        "command": "PYTHONDONTWRITEBYTECODE=1 python tools/assets/transit-independent-review/audit.py",
        "environment": {"python": platform.python_version(), "numpy": np.__version__, "platform": platform.platform()},
        "scope": "D01-D05 offline source/GLB/frame/clearance/batching/dependency handoff; not a model package or runtime acceptance",
        "inputs": inputs, "dependencies": dependencies, "inputsUnchangedDuringRun": True,
        "existingPackageValidators": validators, "independentVehicleChecks": vehicles, "independentBridgeChecks": bridges,
        "actualPlatformPrimitiveCosts": platform_costs,
        "stationSourceEvidence": "Current sources -> hash-matched raw Blender roundtrip -> explicit lossless static-batching comparison -> current final GLB hash; direct hashes also accepted when identical",
        "totals": {"sourceFiles": sum(row["path"].endswith(".blend") and any("/"+package+"/" in row["path"] for package in PACKAGES) for row in inputs),
                   "glbFiles": sum(row["path"].endswith(".glb") and any("/"+package+"/" in row["path"] for package in PACKAGES) for row in inputs),
                   "vehicleLodCases": len(vehicles),
                   "doorwayRays": sum(row["openDoorwayRays"] for row in vehicles),
                   "seatHeadChecks": sum(len(row["seatChecks"]) for row in vehicles),
                   "bridgeLodCases": len(bridges),
                   "deployedDeckSurfaceRays": sum(row["deployedWalkSurfaceRays"] for row in bridges)},
        "resolvedReviewObservation": {
            "issue": "Stored bus and metro portable deck poses formerly hovered 0.05 m and 0.07 m above the research floor",
            "status": "resolved", "currentMethod": "Storage root Y derives from measured GLB bounds after stored rotation",
            "independentVerification": "Actual transformed triangles in both LODs of every stored deck reach the floor within 0.00002 m and remain within the storage exclusion",
            "maximumAbsoluteStoredFloorGapM": max(abs(row["storedFloorGapM"]) for row in bridges)},
        "residualIntegrationRisks": [
            "Research layouts intentionally have no resolved real stop/platform IDs or geographic walk/rail attachment.",
            "Metro inter-car floor gap remains 0.30 m; moving inter-car traversal is disabled and not accepted.",
            "Bridge relocation is a manual/actor-managed proposal: open/stopped/aligned gates, deployment motion and moving collision need D06; close doors only after retraction.",
            "Passenger/open-door states require boarding-capable LOD0/1 plus lazy interior; LOD2 is closed/nonboarding.",
            f"37 platform LOD0 modules now have {platform_costs[0]['primitiveInstancesBeforeRuntimeInstancing']} primitive instances after export-only batching (previously 1,184), before runtime instancing; these are not measured GPU draw calls or FPS.",
            "WebGL transparency, material rebinding, input, lifecycle/disposal, passenger attachment and runtime performance remain not_run."],
        "limits": [
            "Independent probes are sampled static geometry checks, not a continuous swept collision solver or accessibility/transport certification.",
            "Seat checks use a 0.12 m head sphere centred 0.07 m above the authored camera eye; full animated body/rig fitting remains integration work.",
            "Current source/GLB hashes were compared with existing Blender roundtrip evidence; this audit does not rerun Blender or author new renders.",
            "No browser/GPU acceptance is claimed. Existing package validators are supplementary and separately identified.",
            "Plain indexed-triangle GLB with non-sparse accessors only; unsupported representations fail instead of being silently skipped."],
        "runtimeChecks": "not_run", "integrationStatus": "runtime_pending_webgl",
    }
    args.output.write_text(json.dumps(report, indent=2)+"\n")
    print(json.dumps({"status": "pass", "artifact": str(args.output.relative_to(REPO)),
                      "totals": report["totals"], "storedPoseIssue": "resolved"}, indent=2))


if __name__ == "__main__":
    main()
