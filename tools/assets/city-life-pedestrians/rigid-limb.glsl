// Standalone shared deformation function; integration and all render-pass parity are pending.
// glTF scalar custom attributes map to Three BufferGeometry _limb, _pivot_x, etc.
// Consumer must explicitly wire those attributes; custom semantics are NOT skin joints.
void pedestrianRigidLimb(
  inout vec3 position, inout vec3 normal, float limb, vec3 pivot,
  float phase, float walkWeight, float lookYaw, float yieldWeight
) {
  float walk = clamp(walkWeight, 0.0, 1.0);
  float yielding = clamp(yieldWeight, 0.0, 1.0);
  float angle = 0.0;
  if (limb > 1.5 && limb < 2.5) angle = -0.30 * sin(phase) * walk + 0.12 * yielding;
  if (limb > 2.5 && limb < 3.5) angle =  0.30 * sin(phase) * walk + 0.12 * yielding;
  if (limb > 3.5 && limb < 4.5) angle =  0.38 * sin(phase) * walk;
  if (limb > 4.5 && limb < 5.5) angle = -0.38 * sin(phase) * walk;
  bool head = limb > 0.5 && limb < 1.5;
  if (head) angle = clamp(lookYaw, -0.75, 0.75);
  float c = cos(angle), s = sin(angle);
  vec3 q = position - pivot;
  if (head) {
    q = vec3(c * q.x + s * q.z, q.y, -s * q.x + c * q.z);
    normal = vec3(c * normal.x + s * normal.z, normal.y, -s * normal.x + c * normal.z);
  } else {
    q = vec3(q.x, c * q.y - s * q.z, s * q.y + c * q.z);
    normal = vec3(normal.x, c * normal.y - s * normal.z, s * normal.y + c * normal.z);
  }
  position = pivot + q;
  position.y += walk * (0.035 + 0.008 * (1.0 - cos(2.0 * phase)));
}
