import * as THREE from "three";
import { WORLD_DEFINITION } from "../world/WorldDefinition.js?v=20261002-flight-sim-terrain";
import { buildRoadGraph } from "../world/CityPlan.js?v=20261002-flight-sim-terrain";
import { RailCurveLookup } from "./RailCurveLookup.js?v=20261002-flight-sim-terrain";

export const HST_STATION_TARGETS=WORLD_DEFINITION.rail.stations;

const clamp01=value=>THREE.MathUtils.clamp(value,0,1);
const smooth01=value=>{const x=clamp01(value);return x*x*(3-2*x);};
const circularDelta=(a,b)=>{const d=Math.abs(a-b);return Math.min(d,1-d);};
const circularDistance=(a,b,length)=>circularDelta(a,b)*length;

function nearestCurveT(curve,x,z,samples=2200){
  let bestT=0,best=Infinity;
  for(let i=0;i<samples;i++){
    const t=i/samples,p=curve.getPointAt(t),d=(p.x-x)**2+(p.z-z)**2;
    if(d<best){best=d;bestT=t;}
  }
  return bestT;
}

function segmentIntersection(a,b,c,d){
  const cross=(ax,az,bx,bz)=>ax*bz-az*bx;
  const rx=b.x-a.x,rz=b.z-a.z,sx=d.x-c.x,sz=d.z-c.z,den=cross(rx,rz,sx,sz);
  if(Math.abs(den)<1e-8)return null;
  const qx=c.x-a.x,qz=c.z-a.z,t=cross(qx,qz,sx,sz)/den,u=cross(qx,qz,rx,rz)/den;
  if(t<=1e-4||t>=.9999||u<=1e-4||u>=.9999)return null;
  return{x:a.x+t*rx,z:a.z+t*rz,t,u};
}

function pointSegmentDistance2D(px,pz,ax,az,bx,bz){
  const abx=bx-ax,abz=bz-az,apx=px-ax,apz=pz-az,den=abx*abx+abz*abz||1;
  const t=THREE.MathUtils.clamp((apx*abx+apz*abz)/den,0,1),dx=px-(ax+abx*t),dz=pz-(az+abz*t);
  return{distance:Math.hypot(dx,dz),t};
}

function buildRoadSampleIndex(graph){
  const samples=[];
  for(const road of graph.roads.values()){
    const count=Math.max(22,Math.ceil(road.length/7));
    for(let i=0;i<=count;i++){
      const t=i/count,position=road.centerCurve.getPointAt(t),tangent=road.centerCurve.getTangentAt(t).setY(0).normalize();
      samples.push({roadId:road.id,roadWidth:road.width,t,position,tangent});
    }
  }
  return samples;
}

function nearestRoadAccess(roadIndex,position){
  let best=null;
  for(const sample of roadIndex){
    const distance=Math.hypot(sample.position.x-position.x,sample.position.z-position.z);
    if(!best||distance<best.distance)best={...sample,position:sample.position.clone(),tangent:sample.tangent.clone(),distance};
  }
  return best;
}

export function detectRoadRailIntersections(baseCurve,graph,{samples=1500,railHalfWidth=5,mergeDistance=52}={}){
  const railSegments=[];
  for(let i=0;i<samples;i++)railSegments.push({a:baseCurve.getPointAt(i/samples),b:baseCurve.getPointAt((i+1)/samples),t:(i+.5)/samples});
  const raw=[];
  const addCandidate=(road,t,position,roadTangent,railTangent,source)=>raw.push({t:wrappedProgress(t),position:position.clone(),roadId:road.id,roadWidth:road.width,roadTangent:roadTangent.clone(),railTangent:railTangent.clone(),source});
  for(const road of graph.roads.values()){
    const points=road.centerCurve.getPoints(Math.max(30,Math.ceil(road.length/4.2)));
    for(let r=0;r<points.length-1;r++)for(const rail of railSegments){
      const hit=segmentIntersection(rail.a,rail.b,points[r],points[r+1]);if(!hit)continue;
      const railTangent=rail.b.clone().sub(rail.a).setY(0).normalize(),roadTangent=points[r+1].clone().sub(points[r]).setY(0).normalize();
      if(Math.abs(railTangent.dot(roadTangent))>.78)continue;
      const position=new THREE.Vector3(hit.x,0,hit.z);
      addCandidate(road,nearestCurveT(baseCurve,position.x,position.z,1800),position,roadTangent,railTangent,"intersection");
    }

    // Endpoint and near-parallel overlaps are just as dangerous as mathematical
    // centre-line intersections. Sample the full road corridor and record any
    // place where its physical width overlaps the railway formation.
    const proximityPoints=road.centerCurve.getPoints(Math.max(34,Math.ceil(road.length/4.5)));
    for(let index=0;index<proximityPoints.length;index++){
      const point=proximityPoints[index],roadT=THREE.MathUtils.clamp(index/Math.max(1,proximityPoints.length-1),0,1),roadTangent=road.centerCurve.getTangentAt(roadT).setY(0).normalize();
      let nearest=null,nearestDistance=Infinity;
      for(const rail of railSegments){
        const distance=pointSegmentDistance2D(point.x,point.z,rail.a.x,rail.a.z,rail.b.x,rail.b.z).distance;
        if(distance<nearestDistance){nearestDistance=distance;nearest=rail;}
      }
      if(!nearest||nearestDistance>road.width*.5+railHalfWidth+.65)continue;
      const railPoint=baseCurve.getPointAt(nearest.t),railTangent=baseCurve.getTangentAt(nearest.t).setY(0).normalize();
      addCandidate(road,nearest.t,railPoint,roadTangent,railTangent,"corridor-overlap");
    }
  }

  if(!raw.length)return[];
  raw.sort((a,b)=>a.t-b.t);
  let largestGap=-1,cutIndex=0;
  for(let i=0;i<raw.length;i++){
    const current=raw[i].t,next=i===raw.length-1?raw[0].t+1:raw[i+1].t,gap=next-current;
    if(gap>largestGap){largestGap=gap;cutIndex=(i+1)%raw.length;}
  }
  const ordered=[];
  for(let offset=0;offset<raw.length;offset++){
    const index=(cutIndex+offset)%raw.length,item=raw[index],unwrapped=item.t+(index<cutIndex?1:0);ordered.push({...item,unwrapped});
  }
  const clusters=[];
  for(const item of ordered){
    const cluster=clusters.at(-1);
    if(!cluster||(item.unwrapped-cluster.at(-1).unwrapped)*baseCurve.getLength()>mergeDistance)clusters.push([item]);
    else cluster.push(item);
  }
  return clusters.map((cluster,index)=>{
    const start=cluster[0].unwrapped,end=cluster.at(-1).unwrapped,mid=(start+end)*.5,t=wrappedProgress(mid),position=baseCurve.getPointAt(t);
    const representative=cluster.reduce((best,item)=>Math.abs(item.unwrapped-mid)<Math.abs(best.unwrapped-mid)?item:best,cluster[0]);
    const roadIds=[...new Set(cluster.map(item=>item.roadId))],roadWidth=Math.max(...cluster.map(item=>item.roadWidth)),spanLength=(end-start)*baseCurve.getLength();
    return{
      id:`grade-${String(index+1).padStart(2,"0")}`,type:"rail-over-road",t,position,roadId:representative.roadId,roadIds,roadWidth,
      roadTangent:representative.roadTangent,railTangent:baseCurve.getTangentAt(t).setY(0).normalize(),spanLength,
      plateauHalf:Math.max(22,spanLength*.5+roadWidth*.5+railHalfWidth+6),sources:[...new Set(cluster.map(item=>item.source))]
    };
  }).sort((a,b)=>a.t-b.t);
}

function buildElevationProfile(intersections,baseLength,gradePolicy){
  const height=gradePolicy.railElevation;
  const rampLength=Math.max(150,height*1.55/gradePolicy.maximumGradient);
  const humps=intersections.map(crossing=>({
    t:crossing.t,
    plateauHalf:crossing.plateauHalf??Math.max(22,crossing.roadWidth*.75+10),
    rampLength
  }));
  const elevationAt=t=>{
    let elevation=.13;
    for(const hump of humps){
      const distance=circularDistance(t,hump.t,baseLength);
      if(distance<=hump.plateauHalf)elevation=Math.max(elevation,height);
      else if(distance<hump.plateauHalf+hump.rampLength){
        const transition=(distance-hump.plateauHalf)/hump.rampLength;
        elevation=Math.max(elevation,.13+(height-.13)*(1-smooth01(transition)));
      }
    }
    return elevation;
  };
  return{elevationAt,rampLength};
}

/**
 * Raise (never lower) a sampled circular elevation profile until adjacent
 * samples comply with the configured maximum gradient. Repeating the samples
 * three times makes the two linear passes honour the loop seam as well.
 */
function propagateRaisedProfile(required,dropPerSample){
  const count=required.length,extendedCount=count*3,forward=new Float64Array(extendedCount);
  for(let i=0;i<extendedCount;i++)forward[i]=required[i%count];
  for(let i=1;i<extendedCount;i++)forward[i]=Math.max(forward[i],forward[i-1]-dropPerSample);
  for(let i=extendedCount-2;i>=0;i--)forward[i]=Math.max(forward[i],forward[i+1]-dropPerSample);
  return Array.from(forward.slice(count,count*2));
}

/**
 * The first grade-separation profile is safe for roads but its overlapping
 * ramps can put a station on a two-to-three percent slope. Real platforms must
 * be effectively level. This pass raises each complete platform footprint to
 * one common elevation, then lengthens the surrounding approaches so no ramp
 * exceeds the railway gradient policy. Nothing is lowered, so bridge clearance
 * can only improve.
 */
function buildStationLevelProfile(baseElevationAt,stations,baseLength,gradePolicy,{samples=4096,platformBuffer=11}={}){
  const spacing=baseLength/samples,dropPerSample=gradePolicy.maximumGradient*.96*spacing;
  let heights=Array.from({length:samples},(_,index)=>baseElevationAt(index/samples));
  for(let iteration=0;iteration<4;iteration++){
    for(const station of stations){
      const halfLength=station.platformLength*.5+platformBuffer,centreIndex=Math.round(wrappedProgress(station.t)*samples),indices=[];let level=0;
      for(let offset=Math.floor(-halfLength/spacing);offset<=Math.ceil(halfLength/spacing);offset++){
        const index=(centreIndex+offset+samples)%samples;indices.push(index);level=Math.max(level,heights[index]);
      }
      level=Math.max(level,station.minimumElevation??0);
      for(const index of indices)heights[index]=level;
    }
    heights=propagateRaisedProfile(heights,dropPerSample);
  }
  const elevationAt=t=>{
    const scaled=wrappedProgress(t)*samples,index=Math.floor(scaled)%samples,alpha=scaled-index;
    return THREE.MathUtils.lerp(heights[index],heights[(index+1)%samples],alpha);
  };
  return{elevationAt,samples,minimumElevation:Math.min(...heights),maximumElevation:Math.max(...heights)};
}

function stationCurveMetrics(baseCurve,t,platformLength,baseLength){
  const halfT=platformLength*.5/baseLength,startT=wrappedProgress(t-halfT),endT=wrappedProgress(t+halfT);
  const startTangent=baseCurve.getTangentAt(startT).setY(0).normalize(),endTangent=baseCurve.getTangentAt(endT).setY(0).normalize();
  const headingChange=THREE.MathUtils.radToDeg(Math.acos(THREE.MathUtils.clamp(startTangent.dot(endTangent),-1,1)));
  const start=baseCurve.getPointAt(startT),end=baseCurve.getPointAt(endT),chord=end.clone().sub(start);let maximumChordDeviation=0;
  for(let index=0;index<=20;index++){
    const sample=baseCurve.getPointAt(wrappedProgress(t-halfT+index/20*halfT*2)),along=THREE.MathUtils.clamp(sample.clone().sub(start).dot(chord)/(chord.lengthSq()||1),0,1);
    maximumChordDeviation=Math.max(maximumChordDeviation,sample.distanceTo(start.clone().addScaledVector(chord,along)));
  }
  return{headingChange,maximumChordDeviation};
}

class RotatedEllipseRailCurve{
  constructor({centreX,centreZ,radiusX,radiusZ,rotation=0}){
    this.centreX=centreX;this.centreZ=centreZ;this.radiusX=radiusX;this.radiusZ=radiusZ;this.rotation=rotation;this.closed=true;this.arcLengthDivisions=2600;this._length=null;
  }
  getPointAt(t,target=new THREE.Vector3()){
    const theta=wrappedProgress(t)*Math.PI*2,c=Math.cos(theta),s=Math.sin(theta),cr=Math.cos(this.rotation),sr=Math.sin(this.rotation);
    return target.set(this.centreX+this.radiusX*c*cr-this.radiusZ*s*sr,.13,this.centreZ+this.radiusX*c*sr+this.radiusZ*s*cr);
  }
  getTangentAt(t,target=new THREE.Vector3()){
    const theta=wrappedProgress(t)*Math.PI*2,c=Math.cos(theta),s=Math.sin(theta),cr=Math.cos(this.rotation),sr=Math.sin(this.rotation);
    return target.set(-this.radiusX*s*cr-this.radiusZ*c*sr,0,-this.radiusX*s*sr+this.radiusZ*c*cr).normalize();
  }
  getPoints(divisions=5){const points=[];for(let i=0;i<=divisions;i++)points.push(this.getPointAt(i/divisions));return points;}
  getLength(){
    if(this._length!==null)return this._length;let length=0,previous=this.getPointAt(0);
    for(let i=1;i<=3000;i++){const point=this.getPointAt(i/3000);length+=point.distanceTo(previous);previous=point;}
    this._length=length;return length;
  }
}

class CompositeBezierRailCurve{
  constructor({points,handleScale=.4,maximumHandleLength=100}){
    this.closed=true;this.arcLengthDivisions=3200;this.segments=[];this.segmentLengths=[];this._length=0;
    const normalised=points.map(point=>{
      const tangent=new THREE.Vector3(point.tx,0,point.tz).normalize();return{point:new THREE.Vector3(point.x,.13,point.z),tangent};
    });
    for(let index=0;index<normalised.length;index++){
      const start=normalised[index],end=normalised[(index+1)%normalised.length],chord=start.point.distanceTo(end.point),handle=Math.min(maximumHandleLength,chord*handleScale);
      const segment=new THREE.CubicBezierCurve3(start.point.clone(),start.point.clone().addScaledVector(start.tangent,handle),end.point.clone().addScaledVector(end.tangent,-handle),end.point.clone());
      const length=segment.getLength();this.segments.push(segment);this.segmentLengths.push(length);this._length+=length;
    }
  }
  resolveSegment(t){
    let distance=wrappedProgress(t)*this._length;
    for(let index=0;index<this.segments.length;index++){
      const length=this.segmentLengths[index];
      if(distance<=length||index===this.segments.length-1)return{segment:this.segments[index],local:THREE.MathUtils.clamp(distance/length,0,1)};
      distance-=length;
    }
    return{segment:this.segments[0],local:0};
  }
  getPointAt(t,target=new THREE.Vector3()){const{segment,local}=this.resolveSegment(t);return target.copy(segment.getPointAt(local));}
  getTangentAt(t,target=new THREE.Vector3()){const{segment,local}=this.resolveSegment(t);return target.copy(segment.getTangentAt(local)).normalize();}
  getLength(){return this._length;}
}

class ProfiledRailCurve{
  constructor(baseCurve,elevationAt){this.baseCurve=baseCurve;this.elevationAt=elevationAt;this.arcLengthDivisions=2600;this._length=null;this.closed=true;}
  getPointAt(t,target=new THREE.Vector3()){
    const wrapped=wrappedProgress(t),p=this.baseCurve.getPointAt(wrapped,target);p.y=this.elevationAt(wrapped);return p;
  }
  getTangentAt(t,target=new THREE.Vector3()){
    const epsilon=1/12000,a=this.getPointAt(wrappedProgress(t-epsilon)),b=this.getPointAt(wrappedProgress(t+epsilon));
    return target.copy(b).sub(a).normalize();
  }
  getPoints(divisions=5){const points=[];for(let i=0;i<=divisions;i++)points.push(this.getPointAt(i/divisions));return points;}
  getLength(){
    if(this._length!==null)return this._length;
    const samples=3000;let length=0,previous=this.getPointAt(0);
    for(let i=1;i<=samples;i++){const point=this.getPointAt(i/samples);length+=point.distanceTo(previous);previous=point;}
    this._length=length;return length;
  }
}

function buildElevatedSections(curve,samples=1400,threshold=.55){
  const active=[];for(let i=0;i<samples;i++)active.push(curve.getPointAt((i+.5)/samples).y>threshold);
  if(!active.some(Boolean))return[];
  const sections=[];let start=null;
  for(let i=0;i<samples;i++){
    if(active[i]&&start===null)start=i;
    const ending=start!==null&&(!active[i]||i===samples-1);
    if(ending){const end=active[i]&&i===samples-1?i+1:i;sections.push({startT:start/samples,endT:end/samples});start=null;}
  }
  if(sections.length>1&&active[0]&&active.at(-1)){
    const first=sections.shift(),last=sections.pop();sections.unshift({startT:last.startT,endT:first.endT+1,wrap:true});
  }
  return sections;
}

function minimumRoadClearanceAtStation(baseCurve,t,platformLength,roadIndex,rail){
  const count=Math.max(12,Math.ceil(platformLength/7)),outerPlatformOffset=rail.trackOffset+3.45+2.2;let minimum=Infinity;
  for(let i=0;i<=count;i++){
    const offset=(i/count-.5)*platformLength,stationT=wrappedProgress(t+offset/baseCurve.getLength()),centre=baseCurve.getPointAt(stationT);
    const tangent=baseCurve.getTangentAt(stationT).setY(0).normalize(),normal=new THREE.Vector3(-tangent.z,0,tangent.x);
    for(const lateral of[-outerPlatformOffset,0,outerPlatformOffset]){
      const point=centre.clone().addScaledVector(normal,lateral),access=nearestRoadAccess(roadIndex,point);
      if(access)minimum=Math.min(minimum,access.distance-access.roadWidth*.5);
    }
  }
  return minimum;
}

function resolveStation(baseCurve,profiledCurve,target,index,intersections,roadIndex,rail,baseLength,resolvedStations=[]){
  const initialT=Number.isFinite(target.t)?wrappedProgress(target.t):nearestCurveT(baseCurve,target.x,target.z),platformHalf=target.platformLength*.5;
  const searchSteps=160,stepDistance=5.5,candidates=[];
  for(let step=0;step<=searchSteps;step++)for(const sign of step===0?[0]:[-1,1]){
    const shift=step*stepDistance*sign,t=wrappedProgress(initialT+shift/baseLength),position=profiledCurve.getPointAt(t),tangent=profiledCurve.getTangentAt(t);
    if(Math.abs(tangent.y)>rail.gradeSeparation.maximumGradient*.82)continue;
    const tooClose=resolvedStations.some(existing=>{
      const raw=Math.abs(t-existing.t),arc=Math.min(raw,1-raw)*baseLength;
      const required=Math.max(rail.stationAccess.minimumStationSpacing??280,(target.platformLength+existing.platformLength)*.5+(rail.stationAccess.minimumPlatformGap??120));
      return arc<required;
    });
    if(tooClose)continue;
    const groundSite=position.y<=rail.stationAccess.groundStationMaximumElevation,elevatedSite=position.y>=rail.stationAccess.elevatedStationMinimumElevation;
    const roadAccess=nearestRoadAccess(roadIndex,position);if(!roadAccess)continue;
    if(roadAccess.distance>rail.stationAccess.maximumRoadDistance)continue;
    const targetDistance=Math.hypot(position.x-target.x,position.z-target.z);
    const accessPenalty=Math.abs(roadAccess.distance-42)*.18;
    const elevationPenalty=groundSite?0:elevatedSite?8:18;
    const progressPenalty=Math.min(Math.abs(t-initialT),1-Math.abs(t-initialT))*baseLength*.22;
    candidates.push({t,position,tangent,roadAccess,score:targetDistance+Math.abs(shift)*.18+accessPenalty+elevationPenalty+progressPenalty});
  }
  let best=null;
  for(const candidate of candidates.sort((a,b)=>a.score-b.score)){
    const roadClearance=minimumRoadClearanceAtStation(baseCurve,candidate.t,target.platformLength,roadIndex,rail);
    if(roadClearance<rail.stationAccess.minimumPlatformRoadClearance)continue;
    best={...candidate,roadClearance};break;
  }
  if(!best)throw new Error(`No safe, road-accessible platform site could be found for ${target.name}`);
  const horizontalTangent=best.tangent.clone().setY(0).normalize(),normal=new THREE.Vector3(-horizontalTangent.z,0,horizontalTangent.x);
  const accessVector=best.roadAccess.position.clone().sub(best.position).setY(0),accessSide=accessVector.dot(normal)>=0?1:-1;
  const platformElevation=best.position.y;
  return{
    ...target,index,t:best.t,x:best.position.x,y:platformElevation,z:best.position.z,position:best.position,
    tangent:horizontalTangent,normal,accessSide,elevated:platformElevation>1,
    roadAccess:{...best.roadAccess,side:accessSide},roadClearance:best.roadClearance
  };
}

export function analyseRailGeometry(plan,samples=1200){
  const points=[];
  for(let i=0;i<samples;i++){const p=plan.curve.getPointAt(i/samples);points.push(new THREE.Vector3(p.x,0,p.z));}
  let minimumRadius=Infinity,sharpestT=0;
  for(let i=0;i<samples;i++){
    const a=points[(i-1+samples)%samples],b=points[i],c=points[(i+1)%samples];
    const ab=a.distanceTo(b),bc=b.distanceTo(c),ca=c.distanceTo(a);
    const twiceArea=Math.abs((b.x-a.x)*(c.z-a.z)-(b.z-a.z)*(c.x-a.x));
    if(twiceArea>1e-8){const radius=ab*bc*ca/(2*twiceArea);if(radius<minimumRadius){minimumRadius=radius;sharpestT=i/samples;}}
  }
  let selfIntersections=0;
  for(let i=0;i<samples;i++){
    const a=points[i],b=points[(i+1)%samples];
    for(let j=i+3;j<samples;j++){
      if(i===0&&j===samples-1)continue;
      if(segmentIntersection(a,b,points[j],points[(j+1)%samples]))selfIntersections++;
    }
  }
  return{minimumRadius,sharpestT,selfIntersections};
}

export function offsetPointOnRail(plan,t,offset=0,target=null){
  if(plan.lookup)return plan.lookup.sampleOffsetPosition(t,offset,target??new THREE.Vector3());
  const p=target??new THREE.Vector3(),tangent=new THREE.Vector3();plan.curve.getPointAt(wrappedProgress(t),p);plan.curve.getTangentAt(wrappedProgress(t),tangent).setY(0).normalize();
  return p.addScaledVector(tangent.set(-tangent.z,0,tangent.x),offset);
}

function buildRoutePlan(routeDefinition,rail,graph){
  const baseCurve=routeDefinition.bezierLoop?new CompositeBezierRailCurve(routeDefinition.bezierLoop):routeDefinition.ellipse?new RotatedEllipseRailCurve(routeDefinition.ellipse):new THREE.CatmullRomCurve3(routeDefinition.controlPoints.map(([x,z])=>new THREE.Vector3(x,.13,z)),true,"centripetal",.5),baseLength=baseCurve.getLength();
  const roadIndex=buildRoadSampleIndex(graph),rawIntersections=detectRoadRailIntersections(baseCurve,graph,{
    railHalfWidth:10.5+rail.ballastWidth*.5+1.05,
    mergeDistance:rail.gradeSeparation.crossingMergeDistance
  });
  const bridgeProfile=buildElevationProfile(rawIntersections,baseLength,rail.gradeSeparation);
  const preliminaryCurve=new ProfiledRailCurve(baseCurve,bridgeProfile.elevationAt);
  const orderedTargets=[...(routeDefinition.stations??[])].sort((a,b)=>{
    const at=Number.isFinite(a.t)?wrappedProgress(a.t):nearestCurveT(baseCurve,a.x,a.z),bt=Number.isFinite(b.t)?wrappedProgress(b.t):nearestCurveT(baseCurve,b.x,b.z);
    return at-bt;
  });
  const preliminaryStations=[];
  for(let index=0;index<orderedTargets.length;index++){
    const target={...orderedTargets[index],routeId:routeDefinition.id,routeName:routeDefinition.name};
    preliminaryStations.push(resolveStation(baseCurve,preliminaryCurve,target,index,rawIntersections,roadIndex,rail,baseLength,preliminaryStations));
  }
  preliminaryStations.sort((a,b)=>a.t-b.t);
  const levelProfile=buildStationLevelProfile(bridgeProfile.elevationAt,preliminaryStations,baseLength,rail.gradeSeparation);
  const curve=new ProfiledRailCurve(baseCurve,levelProfile.elevationAt),length=curve.getLength();
  const stations=preliminaryStations.map(station=>{
    const position=curve.getPointAt(station.t),threeDimensionalTangent=curve.getTangentAt(station.t),horizontalTangent=threeDimensionalTangent.clone().setY(0).normalize();
    const normal=new THREE.Vector3(-horizontalTangent.z,0,horizontalTangent.x),metrics=stationCurveMetrics(baseCurve,station.t,station.platformLength,baseLength);
    return{...station,routeId:routeDefinition.id,routeName:routeDefinition.name,x:position.x,y:position.y,z:position.z,position,tangent:horizontalTangent,normal,elevated:position.y>1,platformGradient:Math.abs(threeDimensionalTangent.y),...metrics};
  });
  const gradeSeparations=rawIntersections.map((crossing,index)=>{
    const position=curve.getPointAt(crossing.t),clearance=position.y-rail.gradeSeparation.deckDepth;
    return{...crossing,routeId:routeDefinition.id,id:`${routeDefinition.id}-grade-${String(index+1).padStart(2,"0")}`,position,clearance,deckDepth:rail.gradeSeparation.deckDepth};
  });
  const elevatedSections=buildElevatedSections(curve),geometry=analyseRailGeometry({curve}),lookup=new RailCurveLookup(curve,length,{spacing:.75});
  return Object.freeze({
    id:routeDefinition.id,name:routeDefinition.name,airportLoop:Boolean(routeDefinition.airportLoop),connectsAtStationId:routeDefinition.connectsAtStationId??null,
    curve,lookup,baseCurve,length,baseLength,stations,gradeSeparations,elevatedSections,elevationProfile:levelProfile,geometry,
    trackOffsets:Object.freeze([-10.5,-3.5,3.5,10.5]),platformCentres:Object.freeze([-14,-7,0,7,14]),trackOffset:10.5,gauge:rail.gauge,ballastWidth:rail.ballastWidth,
    designSpeedMps:routeDefinition.designSpeedMps??rail.designSpeedMps,urbanLineSpeedMps:routeDefinition.lineSpeedMps??rail.urbanLineSpeedMps,
    formationCoachCount:rail.formationCoachCount,minimumDesignRadius:routeDefinition.minimumDesignRadius??(routeDefinition.airportLoop?105:rail.minimumDesignRadius),
    gradePolicy:rail.gradeSeparation,stationAccessPolicy:rail.stationAccess
  });
}

export function createRailPlan(definition=WORLD_DEFINITION,providedGraph=null){
  const graph=providedGraph??buildRoadGraph(definition),rail=definition.rail;
  const routeDefinitions=rail.routes??[{id:"city",name:"City Loop",stations:rail.stations,controlPoints:rail.controlPoints,designSpeedMps:rail.designSpeedMps,lineSpeedMps:rail.urbanLineSpeedMps}];
  const routes=routeDefinitions.map(route=>buildRoutePlan(route,rail,graph)),mainRoute=routes.find(route=>route.id==="city")??routes[0],airportRoute=routes.find(route=>route.airportLoop||route.id==="airport")??null;
  const allRouteStations=routes.flatMap(route=>route.stations),stations=allRouteStations.filter(station=>!station.sharedPhysicalStationId),gradeSeparations=routes.flatMap(route=>route.gradeSeparations),elevatedSections=routes.flatMap(route=>route.elevatedSections.map(section=>({...section,routeId:route.id})));
  return Object.freeze({
    schemaVersion:5,routes,mainRoute,airportRoute,routeById:Object.freeze(Object.fromEntries(routes.map(route=>[route.id,route]))),
    curve:mainRoute.curve,baseCurve:mainRoute.baseCurve,length:mainRoute.length,baseLength:mainRoute.baseLength,
    stations,allRouteStations,gradeSeparations,elevatedSections,elevationProfile:mainRoute.elevationProfile,
    trackOffsets:Object.freeze([-10.5,-3.5,3.5,10.5]),platformCentres:Object.freeze([-14,-7,0,7,14]),trackOffset:10.5,gauge:rail.gauge,ballastWidth:rail.ballastWidth,
    designSpeedMps:rail.designSpeedMps,urbanLineSpeedMps:rail.urbanLineSpeedMps,
    formationCoachCount:rail.formationCoachCount,minimumDesignRadius:rail.minimumDesignRadius,
    gradePolicy:rail.gradeSeparation,stationAccessPolicy:rail.stationAccess
  });
}

export function analyseRoadRailLayout(plan,graph,definition=WORLD_DEFINITION){
  const errors=[],routes=plan.routes??[plan];
  if(graph.trafficSide!=="left")errors.push("road graph is not configured for UK left-hand traffic");
  for(const lane of graph.lanes.values())if(!graph.laneRunsOnTrafficSide(lane))errors.push(`lane ${lane.id} is not on the left side of its travel direction`);
  const roadSegments=[];
  for(const road of graph.roads.values()){
    const points=road.centerCurve.getPoints(Math.max(32,Math.ceil(road.length/5)));
    for(let i=0;i<points.length-1;i++)roadSegments.push({a:points[i],b:points[i+1],road});
  }
  for(const route of routes){
    if(!route.curve?.closed)errors.push(`${route.name} is not a closed loop`);
    if(!route.gradeSeparations.length)errors.push(`${route.name} has no analysed road/rail intersections`);
    for(const separation of route.gradeSeparations){
      if(separation.type!=="rail-over-road")errors.push(`${separation.id} is not grade separated`);
      if(separation.clearance<definition.rail.gradeSeparation.minimumRoadClearance)errors.push(`${separation.id} has only ${separation.clearance.toFixed(2)} m road clearance`);
    }
    const railHalfWidth=route.trackOffset+route.ballastWidth*.5+1.05,requiredClearance=definition.rail.gradeSeparation.minimumRoadClearance;
    for(let i=0;i<1800;i++){
      const t=i/1800,position=route.curve.getPointAt(t),underside=position.y-definition.rail.gradeSeparation.deckDepth;
      if(underside>=requiredClearance-.02)continue;
      for(const segment of roadSegments){
        const distance=pointSegmentDistance2D(position.x,position.z,segment.a.x,segment.a.z,segment.b.x,segment.b.z).distance;
        if(distance<segment.road.width*.5+railHalfWidth){errors.push(`${route.name} overlaps ${segment.road.id} without full bridge clearance`);break;}
      }
      if(errors.some(error=>error.startsWith(`${route.name} overlaps`)))break;
    }
    for(const station of route.stations){
      if(!station.roadAccess||station.roadAccess.distance>definition.rail.stationAccess.maximumRoadDistance)errors.push(`${station.name} has no realistic road access`);
      if(station.roadClearance<definition.rail.stationAccess.minimumPlatformRoadClearance)errors.push(`${station.name} platform footprint is too close to a road`);
      if(station.platformGradient>definition.rail.stationAccess.maximumPlatformGradient)errors.push(`${station.name} platform is on an excessive gradient`);
    }
    const orderedStations=[...route.stations].sort((a,b)=>a.t-b.t);
    for(let index=0;index<orderedStations.length;index++){
      const a=orderedStations[index],b=orderedStations[(index+1)%orderedStations.length],spacing=forwardArcDistance(a.t,b.t,1,route.length);
      const required=Math.max(definition.rail.stationAccess.minimumStationSpacing??280,(a.platformLength+b.platformLength)*.5+(definition.rail.stationAccess.minimumPlatformGap??120));
      if(spacing<required)errors.push(`${a.name} and ${b.name} are only ${spacing.toFixed(1)} m apart on ${route.name}`);
    }
    const geometry=route.geometry??analyseRailGeometry(route);
    if(geometry.selfIntersections)errors.push(`${route.name} contains ${geometry.selfIntersections} self-intersection(s)`);
    if(geometry.minimumRadius<route.minimumDesignRadius)errors.push(`${route.name} minimum curve radius is ${geometry.minimumRadius.toFixed(1)} m`);
  }
  const airportRoute=routes.find(route=>route.airportLoop||route.id==="airport"),cityRoute=routes.find(route=>route.id==="city")??routes[0];
  if(!airportRoute)errors.push("airport railway loop is missing");
  else{
    const airportStation=airportRoute.stations.find(station=>station.airport||station.id.includes("airport-station"));
    if(!airportStation)errors.push("airport loop has no airport station");
    const junction=airportRoute.stations.find(station=>station.interchangeWith),cityStation=cityRoute.stations.find(station=>station.id===junction?.interchangeWith);
    if(!junction||!cityStation)errors.push("airport loop is not connected through a city interchange station");
    else{
      if(junction.position.distanceTo(cityStation.position)>18)errors.push("airport interchange is too far from the city-loop station");
      const junctionDot=junction.tangent.dot(cityStation.tangent);if(junctionDot<.97)errors.push("airport interchange is not tangent-aligned with the city loop");
    }
    const airport=definition.airport,forward=new THREE.Vector3(Math.sin(airport.heading),0,Math.cos(airport.heading)),right=new THREE.Vector3(forward.z,0,-forward.x);
    const zones=[
      {name:"runway",x:0,z:0,halfX:airport.runway.length*.5+8,halfZ:airport.runway.width*.5+8},
      {name:"taxiway",x:0,z:airport.taxiwayOffset,halfX:airport.runway.length*.42+8,halfZ:8.5+8},
      {name:"apron",x:20,z:airport.terminalOffset-35,halfX:77.5+8,halfZ:35+8},
      {name:"terminal",x:20,z:airport.terminalOffset,halfX:64+8,halfZ:12.5+8},
      {name:"car park",x:18,z:airport.terminalOffset+27,halfX:50+8,halfZ:19+8}
    ];
    for(let index=0;index<2400;index++){
      const point=airportRoute.baseCurve.getPointAt(index/2400),relative=point.clone().sub(new THREE.Vector3(airport.x,0,airport.z)),localX=relative.dot(forward),localZ=relative.dot(right);
      const conflict=zones.find(zone=>Math.abs(localX-zone.x)<zone.halfX&&Math.abs(localZ-zone.z)<zone.halfZ);
      if(conflict){errors.push(`airport loop enters the ${conflict.name} operating area`);break;}
    }
  }
  return errors;
}

export function getRailReservationSegments(plan,step=5.5){
  const routes=plan.routes??[plan],segments=[];
  for(const route of routes){
    const count=Math.ceil(route.length/step);
    for(let i=0;i<count;i++){
      const a=route.curve.getPointAt(i/count),b=route.curve.getPointAt((i+1)/count);
      segments.push({a,b,radius:8.1,routeId:route.id??"city"});
    }
  }
  return segments;
}

export function wrappedProgress(value){return(value%1+1)%1;}
export function forwardArcDistance(fromT,toT,direction,length){
  const delta=direction>=0?wrappedProgress(toT-fromT):wrappedProgress(fromT-toT);
  return delta*length;
}
