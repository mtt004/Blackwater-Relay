import * as THREE from "three";

function cross(a,b){return a.x*b.z-a.z*b.x;}
function segmentIntersection(a,b,c,d){
  const r={x:b.x-a.x,z:b.z-a.z},s={x:d.x-c.x,z:d.z-c.z},den=cross(r,s);if(Math.abs(den)<1e-8)return null;
  const ca={x:c.x-a.x,z:c.z-a.z},t=cross(ca,s)/den,u=cross(ca,r)/den;
  if(t<=.025||t>=.975||u<=.025||u>=.975)return null;return{x:a.x+t*r.x,z:a.z+t*r.z};
}
function angleBetween(a,b){return Math.acos(THREE.MathUtils.clamp(a.dot(b),-1,1));}

export function analyseRoadNetwork(graph){
  const errors=[],warnings=[],roads=[...graph.roads.values()];
  for(const road of roads){
    const samples=Math.max(20,Math.ceil(road.length/4));let maximumTurn=0;
    for(let i=1;i<samples;i++){const a=road.centerCurve.getTangentAt((i-1)/samples).setY(0).normalize(),b=road.centerCurve.getTangentAt((i+1)/samples).setY(0).normalize();maximumTurn=Math.max(maximumTurn,angleBetween(a,b));}
    road.maximumSampledTurn=maximumTurn;if(maximumTurn>THREE.MathUtils.degToRad(32))errors.push(`${road.id} contains an abrupt ${(THREE.MathUtils.radToDeg(maximumTurn)).toFixed(1)}° sampled corner`);
  }
  for(let i=0;i<roads.length;i++)for(let j=i+1;j<roads.length;j++){
    const a=roads[i],b=roads[j],sharesNode=[a.from,a.to].some(id=>id===b.from||id===b.to);if(sharesNode)continue;
    const ap=a.centerCurve.getPoints(Math.max(18,Math.ceil(a.length/5))),bp=b.centerCurve.getPoints(Math.max(18,Math.ceil(b.length/5)));let crossing=null;
    for(let ai=0;ai<ap.length-1&&!crossing;ai++)for(let bi=0;bi<bp.length-1&&!crossing;bi++)crossing=segmentIntersection(ap[ai],ap[ai+1],bp[bi],bp[bi+1]);
    if(crossing)errors.push(`${a.id} intersects ${b.id} without a defined junction at (${crossing.x.toFixed(1)}, ${crossing.z.toFixed(1)})`);
  }
  let connectorCount=0;
  for(const node of graph.nodes.values()){
    const incoming=[...graph.lanes.values()].filter(lane=>lane.to===node.id),outgoing=[...graph.lanes.values()].filter(lane=>lane.from===node.id);
    for(const inLane of incoming)for(const outLane of outgoing){if(inLane.roadId===outLane.roadId&&inLane.from===outLane.to)continue;const connector=graph.getJunctionConnector(inLane.id,outLane.id);if(!connector)continue;connectorCount++;
      const startGap=connector.curve.getPointAt(0).distanceTo(inLane.curve.getPointAt(1)),endGap=connector.curve.getPointAt(1).distanceTo(outLane.curve.getPointAt(0));if(startGap>.15||endGap>.15)errors.push(`${connector.id} is disconnected from its lanes`);
      const mid=connector.curve.getPointAt(.5),surface=graph.nearestDrivableSurface(mid);if(!surface.onRoad)errors.push(`${connector.id} is not recognised as drivable road surface`);
    }
  }
  return{errors,warnings,roadCount:roads.length,connectorCount};
}
