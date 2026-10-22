/** Analytic spheres keep the planetary limb smooth at every altitude and FOV. */
export const rocketPlanetVertexShader = /* glsl */ `
  uniform mat4 uCameraWorld;
  uniform mat4 uInverseProjection;
  varying vec3 vWorldRay;
  void main() {
    vec4 ray = uInverseProjection * vec4(position.xy, 1.0, 1.0);
    vWorldRay = mat3(uCameraWorld) * ray.xyz;
    // Celestial background keeps the depth already written by the local vehicle.
    gl_Position = vec4(position.xy, 1.0, 1.0);
  }
`;

export function rocketPlanetFragmentShader(noise: string): string {
  return /* glsl */ `
    uniform sampler2D uLand;
    uniform vec3 uSun;
    uniform vec3 uEye;
    uniform vec3 uEarthCenter;
    uniform mat3 uWorldToEarth;
    uniform float uRadius;
    uniform float uTime;
    varying vec3 vWorldRay;
    ${noise}

    float sphereCoverage(float radius, float closestDistance, float toward) {
      float distanceToLimb = radius - closestDistance;
      float aa = max(fwidth(distanceToLimb), 0.000005);
      float observerInside = 1.0 - step(radius, length(uEye - uEarthCenter));
      return max(observerInside, 1.0 - step(0.0, toward)) * smoothstep(-aa, aa, distanceToLimb);
    }

    vec3 surfaceColor(vec3 local, vec3 normal, vec3 view) {
      float latitude = asin(clamp(local.y, -1.0, 1.0));
      vec2 uv = vec2(atan(local.z, local.x) / 6.2831853 + 0.5, latitude / 3.1415927 + 0.5);
      float terrain = fbm(local * 20.0);
      float fine = noise3(local * 450.0);
      float land = texture2D(uLand, uv + (terrain - 0.5) * 0.002).r;
      float shoreline = 1.0 - abs(land * 2.0 - 1.0);
      vec3 water = mix(vec3(0.006, 0.028, 0.085), vec3(0.012, 0.085, 0.16), terrain);
      water += shoreline * vec3(0.01, 0.08, 0.08);
      vec3 vegetation = mix(vec3(0.03, 0.07, 0.025), vec3(0.12, 0.18, 0.06), terrain);
      float dry = smoothstep(0.20, 0.39, abs(local.y)) * (1.0 - smoothstep(0.42, 0.62, abs(local.y)));
      dry *= smoothstep(0.40, 0.68, terrain);
      vec3 ground = mix(vegetation, vec3(0.40, 0.29, 0.14), dry);
      ground *= 0.88 + fine * 0.19;
      float ice = smoothstep(0.84, 0.96, abs(local.y) + (terrain - 0.5) * 0.13);
      ground = mix(ground, vec3(0.72, 0.82, 0.87), ice);
      vec3 albedo = mix(water, ground, smoothstep(0.30, 0.70, land));
      albedo = mix(albedo, vec3(0.67, 0.78, 0.84), ice * 0.85);
      float sun = dot(normal, uSun);
      float daylight = smoothstep(-0.11, 0.16, sun);
      vec3 color = albedo * (0.035 + max(sun, 0.0) * 1.55);
      float lights = smoothstep(0.84, 0.96, fine) * smoothstep(0.25, 0.8, terrain);
      color += vec3(0.90, 0.44, 0.10) * lights * land * (1.0 - daylight) * 0.25;
      vec3 halfVector = normalize(uSun + view);
      float glint = pow(max(dot(normal, halfVector), 0.0), 320.0);
      color += vec3(0.32, 0.34, 0.29) * glint * (0.25 + fine * 0.75) * (1.0 - land) * daylight;
      return color;
    }

    void main() {
      vec3 ray = normalize(vWorldRay);
      vec3 origin = uEye - uEarthCenter;
      float toward = dot(origin, ray);
      float closestSquared = max(dot(origin, origin) - toward * toward, 0.0);
      float closestDistance = sqrt(closestSquared);
      float atmosphereRadius = uRadius + 0.18;
      float outerCoverage = sphereCoverage(atmosphereRadius, closestDistance, toward);
      if (outerCoverage < 0.0001) discard;

      float surfaceCoverage = sphereCoverage(uRadius, closestDistance, toward);
      float surfaceRoot = sqrt(max(uRadius * uRadius - closestSquared, 0.0));
      float surfaceT = max(-toward - surfaceRoot, 0.0);
      vec3 normal = normalize(origin + ray * surfaceT);
      vec3 local = normalize(uWorldToEarth * normal);
      float alpha = surfaceCoverage;
      vec3 premultiplied = vec3(0.0);
      if (surfaceCoverage > 0.0001) {
        premultiplied = surfaceColor(local, normal, -ray) * surfaceCoverage;
      }

      // Clouds share this same exact ray and silhouette rather than a second
      // almost-coplanar tessellated shell with an astronomical depth value.
      float cloudRadius = uRadius + 0.035;
      float cloudCoverage = sphereCoverage(cloudRadius, closestDistance, toward);
      if (cloudCoverage > 0.0001) {
        float cloudT = max(-toward - sqrt(max(cloudRadius * cloudRadius - closestSquared, 0.0)), 0.0);
        vec3 cloudNormal = normalize(origin + ray * cloudT);
        vec3 p = normalize(uWorldToEarth * cloudNormal);
        p.xz += vec2(sin(p.y * 12.0), cos(p.y * 9.0)) * 0.027;
        p.x += uTime * 0.00003;
        float billows = fbm(p * 33.0 + fbm(p * 12.0) * 2.4);
        float wisps = noise3(p * 145.0) * 0.06;
        float cloudAlpha = smoothstep(0.49, 0.67, billows + wisps) * cloudCoverage * 0.82;
        float sunlight = max(dot(cloudNormal, uSun), 0.0);
        vec3 cloudColor = mix(vec3(0.025, 0.04, 0.07), vec3(0.85, 0.91, 1.0), sunlight);
        premultiplied = cloudColor * cloudAlpha + premultiplied * (1.0 - cloudAlpha);
        alpha = cloudAlpha + alpha * (1.0 - cloudAlpha);
      }

      // Approximate optical path through an 18 km scattering layer. Coverage
      // falls continuously to zero at its analytic tangent; no hard polygon rim.
      float atmosphereRoot = sqrt(max(atmosphereRadius * atmosphereRadius - closestSquared, 0.0));
      float atmosphereNear = max(-toward - atmosphereRoot, 0.0);
      float atmosphereFar = max(-toward + atmosphereRoot, 0.0);
      float pathLength = surfaceCoverage > 0.5
        ? max(surfaceT - atmosphereNear, 0.0)
        : max(atmosphereFar - atmosphereNear, 0.0);
      float opticalDepth = (1.0 - exp(-pathLength * 0.18)) * outerCoverage;
      vec3 nearestPoint = origin + ray * max(-toward, 0.0);
      vec3 nearestNormal = closestSquared > 0.000001 ? normalize(nearestPoint) : normal;
      float sunAtLimb = dot(nearestNormal, uSun);
      float day = smoothstep(-0.25, 0.25, sunAtLimb);
      float twilight = exp(-abs(sunAtLimb) * 12.0);
      vec3 scatter = mix(vec3(0.004, 0.012, 0.04), vec3(0.06, 0.25, 0.62), day);
      scatter = mix(scatter, vec3(0.48, 0.12, 0.025), twilight * 0.55);
      premultiplied = scatter * opticalDepth + premultiplied * (1.0 - opticalDepth);
      alpha = opticalDepth + alpha * (1.0 - opticalDepth);
      if (alpha < 0.0001) discard;
      gl_FragColor = vec4(premultiplied / alpha, alpha);
      #include <tonemapping_fragment>
      #include <colorspace_fragment>
    }
  `;
}
