"""Approved Nova typical door/frame dimensions; not a full manufacturer replica.
Vehicle-local metres: +Y up, +Z front, -X right. Axle midpoint datum is unchanged.
"""
BODY=(-6.30,6.10)
AXLES=(-3.10,3.10)
FLOOR=.36
DOORS=[('front',4.00,5.20),('rear',-2.30,-1.40)]
# Keep the original ten seat IDs. The third pair moves ahead of the rear exit,
# rather than onto the rear wheel housing at Z=-2.75.
SEATS=[(x,z) for z in [-4.85,-4.05,-.95,.50,1.30,2.10] for x in [-.83,.83] if not (x<0 and z in [.50,1.30])]
def leaf_dimensions(width):
 half=width/2
 return {'width':half-.015,'halfWidth':(half-.015)/2,'travel':half+.045}
