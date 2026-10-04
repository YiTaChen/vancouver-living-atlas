/** Read-only, source-hash-gated extraction for explicit regeneration only. */
import fs from 'node:fs/promises';
import { makeSource, SOURCE_SHA256 } from './adapters/cockpit-candidate.mjs';
const car = await makeSource();
const parts = car.capturedParts.filter(p => p.userData.sourceRole.startsWith('driver-seat-')).map(p => { const g = p.geometry; return { id: p.name, role: p.userData.sourceRole, position: Array.from(g.attributes.position.array), normal: Array.from(g.attributes.normal.array), uv: g.attributes.uv ? Array.from(g.attributes.uv.array) : null, index: g.index ? Array.from(g.index.array) : null }; });
if (parts.length !== 8)
    throw Error('Driver seat source identity drift');
await fs.writeFile(new URL('qa/original-driver-seat-geometry.json', import.meta.url), JSON.stringify({ source: 'lib/city/assets/roadster.ts', sourceSha256: SOURCE_SHA256, geometryFrame: 'original Roadster +Y up +Z forward', parts }));
console.log('EXTRACTED_EIGHT_ORIGINAL_SEAT_PARTS');
