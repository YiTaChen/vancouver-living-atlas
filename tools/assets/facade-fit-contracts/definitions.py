"""Versioned adaptation policy for existing modules; no model generation.

Authored metric dimensions are sourced from the old manifests and builders.
Additional width limits and fail-closed fit rules are explicit offline proposals.
"""
from copy import deepcopy

SCHEMA = 'vancouver-facade-fit-reference/v1'
PACKAGE_ID = 'facade-fit-contracts'
VERSION = '1.0.0'
MODULE_PACKAGES = ['architecture-details', 'architecture-expansion']
DEPENDENCIES = [
    'lib/city/architecture-plan.ts', 'lib/city/architecture-details.ts',
    'lib/city/architecture-module-candidate.ts', 'lib/city/streetscape-placement.ts',
    'lib/city/streetfronts.ts', 'lib/city/streetscape-kit.ts',
    'lib/city/facade-profile.ts', 'lib/city/building-bodies.ts',
    'lib/city/building-roof.ts', 'lib/city/geo.ts', 'lib/city/region-rules.ts',
    'public/data/buildings.geojson',
    'tools/assets/architecture-details/build_architecture_details.py',
    'tools/assets/architecture-details/validate_architecture_details.py',
    'tools/assets/architecture-expansion/build_architecture_expansion.py',
    'tools/assets/architecture-expansion/catalog.json',
    'tools/assets/package-contract/validate.py',
    'tests/helpers/city-modules.mjs', 'tests/helpers/region-rule-audit.mjs',
]
REJECTION_REASONS = {
    'source-reference-missing': 'Require stable source structure/feature/edge IDs, not a new world XYZ exception.',
    'existing-slot-required': 'No new population or independently placed building detail is authorized by this contract.',
    'profile-incompatible': 'Keep existing geometry for an unsupported representative profile.',
    'source-part-height-conflict': 'Keep the complete detail inside its actual source minHeight and wall/eave top interval.',
    'invalid-dimensions': 'Reject missing, nonfinite, zero or negative fit dimensions.',
    'source-edge-too-short': 'The complete module must stay inside the named source edge.',
    'width-out-of-range': 'Do not stretch an opening or exceed the declared linear span range.',
    'cross-section-exceeds-slot': 'Preserve Y/Z section and the already-emitted replacement volume.',
    'opening-mismatch': 'Match the actual clear width and height, not the outer frame dimensions.',
    'glass-stop-unavailable': 'No physical glazing stop exists at this LOD; keep source glazing/fallback.',
    'entry-exclusion-overlap': 'Preserve the existing door/opening exclusion volume.',
    'domestic-ground-pane-reserved': 'The domestic ground pane may be replaced by the existing door shader.',
    'corner-frame-required': 'Require two named adjacent edges and an exterior 90-degree corner.',
    'corner-handedness-mismatch': 'The +X-return authoring frame is not a mirrored -X-return variant.',
    'roof-incompatible': 'Require an exposed flat commercial roof and preserve exclusions.',
    'parapet-insert-mismatch': 'The existing wall section must fit the actual inverted-U cavity.',
    'pavement-provenance-required': 'Require samples from the actual rendered sidewalk/surface triangles.',
    'pavement-samples-missing': 'At least left, center and right finite samples are required.',
    'pavement-grade-exceeded': 'More than 0.14 m range rejects a rigid ground-datum module.',
    'elevated-source-part': 'Ground entry/bay modules cannot be placed on an elevated building part.',
    'threshold-below-foundation': 'Highest pavement +0.02 m cannot be below the existing foundation.',
    'upper-window-conflict': 'Module crown must stay below the explicitly preserved upper window/sill.',
    'roof-height-conflict': 'Module crown must stay below the source wall top minus 0.30 m.',
    'entry-clearance-mismatch': 'Preserve at least the 1.04 by 2.30 m residential clear opening.',
    'ground-datum-rebased': 'Keep the ground-referenced canopy origin; never move its minimum Y to zero.',
}

PROFILES = {
    'sandstone-sill': ['heritage-brick', 'lowrise-masonry', 'midrise-grid'],
    'heritage-window-frame': ['heritage-brick'],
    'heritage-cornice': ['heritage-brick', 'lowrise-masonry'],
    'sandstone-plinth': ['heritage-brick', 'lowrise-masonry'],
    'sandstone-corner': ['heritage-brick', 'lowrise-masonry'],
    'residential-entry-surround': ['domestic-cladding'],
    'sloped-metal-awning': ['heritage-brick', 'lowrise-masonry'],
    'flat-metal-awning': ['lowrise-masonry', 'midrise-grid', 'curtain-wall'],
}


def definition(asset, package):
    a = asset['id']; role = asset['role']
    bounds = asset['lods'][0]['bounds']
    width = bounds['max'][0]-bounds['min'][0]
    linear = role in ('sill', 'cornice', 'base', 'parapet')
    ground = role in ('entrance', 'awning', 'base')
    result = {
        'id': a, 'taskIds': (['C03'] if a.startswith('residential-') else ['C01'] if package == 'architecture-details' else ['C02']),
        'role': role, 'profiles': asset.get('profiles', PROFILES.get(a)),
        'profileBasis': 'existing expansion catalog or documented representative legacy use; not a surveyed material classification',
        'attachmentDatum': {
            'frameId': 'asset-root-local', 'originM': [0, 0, 0], 'wallPlaneZ': 0,
            'yIdentity': 'ground-threshold' if ground else 'parapet-seat' if role == 'parapet' else 'component-bottom',
            'xIdentity': 'exterior-corner' if role == 'corner' else 'span-center',
            'frontAxis': '+Z', 'upAxis': '+Y',
            'placementRule': 'Map the named source datum to this origin. Ground-threshold modules must never be recentered by bounds. Existing upper-sill replacements preserve their consumer box center via an explicit source-local datum offset. No transform creates a wall opening or floor.',
        },
        'widthFit': {'mode': 'linear-x-only' if linear else 'fixed', 'authoredWidthM': width,
                     'minM': round(width*(.75 if linear else 1), 6),
                     'maxM': round(width*(1.5 if linear else 1), 6),
                     'dimensionToleranceM': .0001, 'yzScale': [1, 1],
                     'basis': ('0.75–1.50 existing expansion-sill candidate limit; conservatively proposed for other linear sections'
                               if linear else 'exact authored dimensions; no nonuniform opening/canopy/corner scaling')},
        'handedness': {'mode': 'positive-x-return' if role == 'corner' else 'symmetric-front',
                       'mirrorAllowed': False, 'negativeScaleAllowed': False,
                       'rotationRule': 'Rigid source-edge frame rotation only; keep +Z outward.'},
        'opening': None, 'openingNotApplicableReason': 'No hollow window/entry/insert/under-canopy volume is specified for this role.',
        'glazing': {'present': False, 'stopByLOD': {}, 'glassPlaneM': None,
                    'reason': 'Opaque accessory; does not introduce glazing.'},
        'constraints': {
            'requiresExistingSlot': True, 'sourceEdge': 'stable structure/feature/edge ID; source-local along-edge position only',
            'sourceHeightInterval': 'Preserve source minHeight and roofEaveHeight (if present), otherwise source height; no floor or height invention.',
            'entryExclusions': 'Reject intersecting source-local entry exclusion rectangles; never suppress upper glazing.',
            'domesticGroundPaneAllowed': role in ('entrance', 'awning'),
            'requiresPavement': ground, 'pavementGradeMaxM': .14 if ground else None,
            'thresholdRule': 'max(actual left,center,right pavement)+0.02' if ground else None,
            'roof': 'exposed-flat-commercial-with-exclusions' if role == 'parapet' else 'does-not-change-source-roof',
            'corner': 'exterior-90-degrees-two-source-edges' if role == 'corner' else 'not-applicable',
            'runtimeCollisionChange': False, 'walkableOrAccessible': False,
        },
        'fallback': {'action': 'retain-existing-procedural-or-shader-detail',
                     'reasonCodes': list(REJECTION_REASONS)},
    }
    if a == 'sandstone-sill':
        result['widthFit'].update({'minM': 1.4, 'maxM': 5.0, 'basis': 'Existing Robson fitted-sill span range reused as an offline proposal; original 0.18 m height still must fit the slot.'})
    if 'clearance' in asset:
        clear = deepcopy(asset['clearance'])
        kind = ('window' if role == 'window-frame' else 'door' if role == 'entrance'
                else 'parapet-insert' if role == 'parapet' else 'pedestrian-under-canopy')
        result['opening'] = {
            'kind': kind, 'frameId': 'asset-root-local', 'boundsM': clear,
            'widthM': clear['max'][0]-clear['min'][0],
            'heightM': clear['max'][1]-clear['min'][1],
            'datumM': [(clear['min'][0]+clear['max'][0])/2, clear['min'][1], 0],
            'basis': 'existing authored empty-volume contract, verified against actual triangles and interior rays',
        }
        result['openingNotApplicableReason'] = None
    if a == 'heritage-window-frame':
        result['glazing'] = {'present': False, 'glassPlaneM': .02,
            'planeBasis': 'proposed rear attachment plane; no glass geometry and no distinct stop in either existing LOD',
            'stopByLOD': {'0': None, '1': None}, 'recessFromFrontM': .12,
            'reason': 'The face rebate is an outer bevel, not a separately modelled glazing stop.'}
    if a == 'modern-recessed-window-surround':
        result['glazing'] = {'present': False, 'glassPlaneM': .07,
            'planeBasis': 'authored inner-return rear edge; proposed mating plane, not exported glazing',
            'stopByLOD': {'0': {'returnRearZ': .07, 'frontZ': .26}, '1': {'returnRearZ': .07, 'frontZ': .26}},
            'recessFromFrontM': .19, 'reason': 'True continuous recessed return retained at both LODs.'}
    if a == 'residential-cedar-window-surround':
        result['glazing'] = {'present': False, 'glassPlaneM': .10,
            'planeBasis': 'back face of LOD0 face-stop at Z=0.10; proposed mating plane',
            'stopByLOD': {'0': {'backZ': .10, 'frontZ': .13}, '1': None},
            'recessFromFrontM': .03,
            'reason': 'LOD1 deliberately omits narrow stop pieces; retain original glazing or lock LOD0 when a physical stop is required.'}
    if a == 'modern-parapet-cap':
        result['constraints']['parapetInsert'] = {'zMinM': .056, 'zMaxM': .444, 'maxHeightM': .105,
            'drainage': 'top falls toward +Z; never reverse the section to fit a roof', 'footprintCheck': 'current roofBoxFits including holes/higher parts'}
    if role == 'corner':
        result['handedness']['secondWing'] = '+X/+Z authored quadrant, local exterior vertex datum'
        result['handedness']['angleDegrees'] = 90
        result['handedness']['angleToleranceDegrees'] = .5
    if a == 'residential-gabled-entry-canopy':
        result['constraints']['preservedYRangeM'] = [2.36, 3.10]
        result['constraints']['minimumEntryClearanceM'] = [1.04, 2.30]
    if a == 'residential-entry-surround':
        result['constraints']['minimumEntryClearanceM'] = [1.04, 2.30]
    return result


def witnesses(asset_id, lod):
    rays = []
    vertices = []
    if asset_id == 'heritage-window-frame':
        rays = [{'name': 'solid-left-jamb', 'originM': [-.65, .8, -.1], 'direction': [0, 0, 1], 'lengthM': .5,
                 'requiredDistancesM': [.12, .24]}]
    if asset_id == 'modern-recessed-window-surround':
        vertices = [[-.96, .14, .07], [.96, 1.61, .26]]
        rays = [{'name': 'return-and-stop', 'originM': [-1, .875, -.1], 'direction': [0, 0, 1], 'lengthM': .5,
                 'requiredDistancesM': [.13923076923, .355 if lod == 0 else .36]}]
    if asset_id == 'residential-cedar-window-surround':
        rays = [{'name': 'cedar-jamb-stop', 'originM': [.65, .86, -.1], 'direction': [0, 0, 1], 'lengthM': .5,
                 'requiredDistancesM': [.12, .20, .23] if lod == 0 else [.12, .20]}]
    if asset_id == 'residential-entry-surround':
        rays = [{'name': 'open-entry-jamb', 'originM': [.585, 1.15, -.1], 'direction': [0, 0, 1], 'lengthM': .5,
                 'requiredDistancesM': [.12, .29]}]
    if asset_id == 'residential-gabled-entry-canopy':
        vertices = [[0, 3.10, .02], [.7025, 2.36, .04]]
    return {'verticesM': vertices, 'solidRays': rays}
