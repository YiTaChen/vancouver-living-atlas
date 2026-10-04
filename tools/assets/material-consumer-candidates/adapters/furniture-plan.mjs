/** Source-use replacement plan only. No scene insertion or old-mesh removal.
 * Match named authoring loops in the source-hash-guarded interiors constructor.
 * The plan uses site-local metres and shares the site's existing root transform.
 */
export function furnitureReplacementPlan(sites) {
  const science=sites.find(s=>s.id==='science'),canada=sites.find(s=>s.id==='canada');
  if(!science||!canada)throw new Error('Actual public interior sites required');
  const placements=[];
  function findObstacle(site,expected){
    const hits=site.obstacles.filter(o=>['x','z','w','d'].every(k=>o[k]===expected[k]));
    if(hits.length!==1)throw new Error(`Source obstacle drift: ${site.id} ${JSON.stringify(expected)}`);
    return hits[0];
  }
  for(const z of [-48,7,56])for(let row=0;row<3;row++)for(let col=0;col<6;col++){
    const x=-3+col*3,zz=z+6+row*3,collision=findObstacle(canada,{x,z:zz,w:.65,d:.7});
    placements.push({id:`canada-lecture-${z}-${row}-${col}`,assetId:'lecture-chair-module',siteId:'canada',translationM:[x,canada.floor,zz],rotationQuaternionXYZW:[0,0,0,1],scale:[1,1,1],originalCollision:collision,seatTopY:canada.floor+.45,sourceUse:'Canada lecture seating loops',removeOriginalVisualOnly:'The matching obstacle box and next back box; retain site.obstacles entry.'});
  }
  const collision=findObstacle(science,{x:49,z:-34,w:6,d:1.5});
  for(let i=0;i<4;i++)placements.push({id:`science-admissions-${i}`,assetId:'admissions-counter-module',siteId:'science',translationM:[49-3+.75+i*1.5,science.floor,-34],rotationQuaternionXYZW:[0,0,0,1],scale:[1,1,1],originalCollision:collision,worktopY:science.floor+1.1,sourceUse:'Science admissions existing 6 m counter',removeOriginalVisualOnly:'Single admissions obstacle visual; keep existing collision, five displays and overhead sign.'});
  return {status:'offline_replacement_plan_runtime_pending',placements,clearanceRule:'Every replacement stays within the already-blocked source footprint; no new obstacles or movement anchors.',tables:{status:'not_created',reason:'Canada source has purposefully low lounge/coffee tables with top about 0.475 m; no existing 0.72-0.76 m work/dining table use identified. Raising them would change the established scene.'}};
}
export function checkFurnitureFit(plan,boundsById) {
  for(const p of plan.placements){
    const b=boundsById[p.assetId];if(!b)throw new Error('Missing measured bounds');
    const [x,,z]=p.translationM,o=p.originalCollision;
    if(x+b.min[0]<o.x-o.w/2-1e-5||x+b.max[0]>o.x+o.w/2+1e-5||z+b.min[2]<o.z-o.d/2-1e-5||z+b.max[2]>o.z+o.d/2+1e-5)throw new Error(`Furniture escapes collision footprint: ${p.id}`);
  }
  return {status:'pass',placements:plan.placements.length,collisionFootprintsExpanded:0};
}
