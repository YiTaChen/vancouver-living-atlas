"""Representative gameplay layout, not a surveyed TransLink vehicle configuration.
Coordinates are vehicle-local glTF metres, +Y up, +Z front, -X right.
"""
FLOOR = .36
REAR_FLOOR = .68
CEILING = 2.60
DOORS = [('front', 3.70, 4.85), ('rear', -1.20, -.05)]
# Rear raised deck: three paired rows on each side, then a five-place rear bench.
SEATS = [(x, z, REAR_FLOOR, 'rear-forward') for z in [-2.60, -3.44, -4.28] for x in [-.94, -.50, .50, .94]]
SEATS += [(x, -5.17, REAR_FLOOR, 'rear-bench') for x in [-.90, -.45, 0, .45, .90]]
# Photos of WVMT XD40 1210 show priority benches aft of the front wheel housings,
# then forward-facing pairs farther aft. Project dimensions remain representative.
SEATS += [(x, -.45, FLOOR, 'low-floor-forward') for x in [.50,.94]]
SEATS += [(x, .35, FLOOR, 'low-floor-forward') for x in [-.94,-.50]]
SEATS += [(.84, z, FLOOR, 'low-floor-priority-left') for z in [.85,1.41,1.97]]
# Three corresponding right-side flip-up places are modelled STOWED, not active seats.
STOWED_PRIORITY_Z = [1.04,1.60,2.16]
FLOOR_ZONES = [('low-floor', -1.46, 5.74, FLOOR), ('rear-step-1', -1.70, -1.46, .52), ('rear-step-2', -1.94, -1.70, REAR_FLOOR), ('raised-rear', -5.65, -1.94, REAR_FLOOR)]
def seat_yaw(group):
 import math
 return -math.pi/2 if group=='low-floor-priority-left' else (math.pi/2 if group=='low-floor-priority-right' else 0)
