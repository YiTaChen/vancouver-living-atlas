import {writeFileSync} from 'node:fs';
import {GLTFExporter} from 'three/addons/exporters/GLTFExporter.js';
import {makeRoadsterCandidate} from './adapters/consumer-candidates.mjs';
import {PACKAGE} from './adapters/harness.mjs';
// Browser API bridge only for binary blob serialization; no GPU needed.
globalThis.FileReader=class {readAsArrayBuffer(blob){blob.arrayBuffer().then(result=>{this.result=result;this.onloadend?.();});}readAsDataURL(blob){blob.arrayBuffer().then(result=>{this.result='data:'+blob.type+';base64,'+Buffer.from(result).toString('base64');this.onloadend?.();});}};
const candidate=await makeRoadsterCandidate();
candidate.group.traverse(o=>{if(o.isMesh){o.material.name=o.userData.surfaceId??o.userData.semanticRole??o.material.name??'legacy-fallback';}});
const binary=await new GLTFExporter().parseAsync(candidate.group,{binary:true});
writeFileSync(PACKAGE+'/qa/roadster.candidate.inspection.glb',Buffer.from(binary));
console.log('Exported exact candidate output for offline reimport illustration, not a replacement runtime asset.');
