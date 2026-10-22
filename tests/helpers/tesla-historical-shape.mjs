// Historical analytic fixtures were captured with the origin/main procedural
// Roadster at 53bb3c6. Keep their geometry fixed to test the same solver cases;
// current Blender-derived support is exercised by travel and asset suites.
export const historicalTeslaShape = {
  halfExtents: [1.14, 0.62, 2.34],
  clearance: 0.06,
  groundSupport: {
    wheelContacts: [
      [-0.896, -(0.62 + 0.06), 1.39],
      [0.896, -(0.62 + 0.06), 1.39],
      [-0.896, -(0.62 + 0.06), -1.39],
      [0.896, -(0.62 + 0.06), -1.39],
    ],
    chassisClearance: 0.08,
    suspensionTravel: 0.05,
    wheelRadius: 0.35,
    bodySections: [
      { minZ: -2.34, maxZ: -1.39, clearance: 0.085 },
      { minZ: -1.39, maxZ: 1.39, clearance: 0.12 },
      { minZ: 1.39, maxZ: 2.34, clearance: 0.15 },
    ],
  },
};
