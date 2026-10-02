import * as THREE from "three";
import { CONFIG } from "../config.js?v=20261002-flight-sim-terrain";

function spatialKey(x,z,size){return `${Math.floor(x/size)}:${Math.floor(z/size)}`;}
function positiveModulo(value,mod){return((value%mod)+mod)%mod;}

function sampledOffsetPath(centerCurve,{direction="fwd",offset=0,samples=32,startT=0,endT=1}={}){
  const points=[];
  for(let i=0;i<=samples;i++){
    const alpha=i/samples;
    const sourceT=direction==="fwd"?THREE.MathUtils.lerp(startT,endT,alpha):THREE.MathUtils.lerp(endT,startT,alpha);
    const p=centerCurve.getPointAt(sourceT);
    const tangent=centerCurve.getTangentAt(sourceT).setY(0).normalize();
    if(direction!=="fwd")tangent.multiplyScalar(-1);
    const left=new THREE.Vector3(-tangent.z,0,tangent.x);
    points.push(p.clone().addScaledVector(left,offset));
  }
  return points;
}

function cubicConnector(start,startTangent,end,endTangent,handle){
  const c1=start.clone().addScaledVector(startTangent,handle);
  const c2=end.clone().addScaledVector(endTangent,-handle);
  return new THREE.CubicBezierCurve3(start,c1,c2,end);
}

export class RoadGraph{
  constructor({trafficSide="left"}={}){
    if(trafficSide!=="left")throw new Error("This simulation is configured for UK left-hand traffic");
    this.trafficSide=trafficSide;
    this.nodes=new Map();this.roads=new Map();this.lanes=new Map();this.outgoing=new Map();this.routeCache=new Map();
    this.lastRouteMs=0;this.spatialCellSize=52;this.laneSpatial=new Map();this.junctionConnectors=new Map();this.finalized=false;
  }

  addNode(id,x,z,{signal=false,control=null,district="outskirts",elevation=0,roundaboutRadius=null}={}){
    if(this.nodes.has(id))throw new Error(`Duplicate node ${id}`);
    const resolvedControl=control??(signal?"signal":"priority");
    const node={id,position:new THREE.Vector3(x,elevation,z),signal:resolvedControl==="signal",control:resolvedControl,district,roundaboutRadius,junctionRadius:0,connectedRoadIds:[]};
    this.nodes.set(id,node);this.outgoing.set(id,[]);return node;
  }

  addBidirectionalRoad({id,from,to,via=[],lanesEachWay=1,speedLimit=50,category="urban",oneWay=false,laneWidth=CONFIG.laneWidth,sidewalkWidth=CONFIG.sidewalkWidth,medianWidth=0}){
    if(this.roads.has(id))throw new Error(`Duplicate road ${id}`);
    const a=this.nodes.get(from),b=this.nodes.get(to);if(!a||!b)throw new Error(`Road ${id} references unknown nodes`);
    const centerPoints=[a.position.clone(),...via.map(v=>new THREE.Vector3(v[0],v[2]??0,v[1])),b.position.clone()];
    const centerCurve=new THREE.CatmullRomCurve3(centerPoints,false,"centripetal",.2),length=centerCurve.getLength();
    const visualSamples=Math.max(category==="motorway"?54:28,Math.ceil(length/5.5));
    const road={id,from,to,centerPoints,centerCurve,visualPoints:centerCurve.getPoints(visualSamples),length,lanesEachWay,speedLimit,category,oneWay,laneWidth,sidewalkWidth,medianWidth,width:lanesEachWay*laneWidth*(oneWay?1:2)+medianWidth,startT:0,endT:1,startTrim:0,endTrim:0};
    this.roads.set(id,road);this.buildRoadLanes(road);this.routeCache.clear();this.finalized=false;return road;
  }

  buildRoadLanes(road){
    const laneSamples=Math.max(24,Math.ceil((road.length-road.startTrim-road.endTrim)/5.5));
    const makeDirection=(direction,start,end)=>{
      for(let index=0;index<road.lanesEachWay;index++){
        const lateral=road.medianWidth*.5+(index+.5)*road.laneWidth;
        const trafficOffset=this.trafficSide==="left"?lateral:-lateral;
        const path=sampledOffsetPath(road.centerCurve,{direction,offset:trafficOffset,samples:laneSamples,startT:road.startT,endT:road.endT});
        const curve=new THREE.CatmullRomCurve3(path,false,"centripetal",.18),laneId=`${road.id}:${direction}:${index}`;
        const lane={id:laneId,roadId:road.id,from:start,to:end,index,direction,pathPoints:path,curve,length:curve.getLength(),speedLimit:road.speedLimit,category:road.category,laneWidth:road.laneWidth,lateralOffset:lateral,closed:false};
        this.lanes.set(laneId,lane);this.outgoing.get(start).push(laneId);this.indexLane(lane);
      }
    };
    makeDirection("fwd",road.from,road.to);if(!road.oneWay)makeDirection("rev",road.to,road.from);
  }

  finalizeJunctions(){
    for(const node of this.nodes.values()){
      node.connectedRoadIds=[...this.roads.values()].filter(r=>r.from===node.id||r.to===node.id).map(r=>r.id);
      const connected=node.connectedRoadIds.map(id=>this.roads.get(id));
      const maxHalf=connected.length?Math.max(...connected.map(r=>r.width*.5)):0;
      if(node.control==="roundabout"){
        node.roundaboutRadius=node.roundaboutRadius??Math.max(15,maxHalf+7.5);
        node.roundaboutInnerRadius=Math.max(5.2,node.roundaboutRadius*.47);
        node.junctionRadius=Math.max(6,node.roundaboutRadius+5.5);
      }else if(connected.length<=1)node.junctionRadius=0;
      else if(connected.length===2)node.junctionRadius=maxHalf+2.4;
      else node.junctionRadius=maxHalf+(node.control==="signal"?7.2:4.8);
      node.signal=node.control==="signal";
    }

    for(const road of this.roads.values()){
      const startNode=this.nodes.get(road.from),endNode=this.nodes.get(road.to);
      const available=Math.max(0,road.length-8),requested=(startNode.junctionRadius??0)+(endNode.junctionRadius??0);
      const scale=requested>available&&requested>0?available/requested:1;
      road.startTrim=(startNode.junctionRadius??0)*scale;road.endTrim=(endNode.junctionRadius??0)*scale;
      road.startT=THREE.MathUtils.clamp(road.startTrim/Math.max(1,road.length),0,.42);
      road.endT=THREE.MathUtils.clamp(1-road.endTrim/Math.max(1,road.length),.58,1);
      const sampleCount=Math.max(12,Math.ceil((road.endT-road.startT)*road.length/5));
      road.visualPoints=[];for(let i=0;i<=sampleCount;i++)road.visualPoints.push(road.centerCurve.getPointAt(THREE.MathUtils.lerp(road.startT,road.endT,i/sampleCount)));
    }

    this.lanes.clear();this.laneSpatial.clear();this.junctionConnectors.clear();
    for(const key of this.outgoing.keys())this.outgoing.set(key,[]);
    for(const road of this.roads.values())this.buildRoadLanes(road);
    this.routeCache.clear();this.finalized=true;return this;
  }

  indexLane(lane){
    const count=Math.max(12,Math.ceil(lane.length/8));
    for(let i=0;i<=count;i++){
      const t=i/count,p=lane.curve.getPointAt(t),key=spatialKey(p.x,p.z,this.spatialCellSize);
      if(!this.laneSpatial.has(key))this.laneSpatial.set(key,[]);
      this.laneSpatial.get(key).push({laneId:lane.id,t,x:p.x,z:p.z,step:1/count});
    }
  }

  findLane(from,to,index=0){
    const ids=this.outgoing.get(from)??[];
    return ids.map(id=>this.lanes.get(id)).find(l=>l.to===to&&!l.closed&&l.index===index)??ids.map(id=>this.lanes.get(id)).find(l=>l.to===to&&!l.closed);
  }

  lanesForRoadDirection(roadId,direction){
    return[...this.lanes.values()]
      .filter(lane=>lane.roadId===roadId&&lane.direction===direction)
      .sort((a,b)=>a.index-b.index);
  }

  adjacentLane(laneId,indexDelta){
    const lane=this.lanes.get(laneId);if(!lane)return null;
    return this.lanes.get(`${lane.roadId}:${lane.direction}:${lane.index+indexDelta}`)??null;
  }

  outermostLaneIndex(laneOrRoadId,direction=null){
    const roadId=typeof laneOrRoadId==="string"&&this.lanes.has(laneOrRoadId)?this.lanes.get(laneOrRoadId).roadId:(laneOrRoadId?.roadId??laneOrRoadId);
    const resolvedDirection=direction??(typeof laneOrRoadId==="string"&&this.lanes.has(laneOrRoadId)?this.lanes.get(laneOrRoadId).direction:laneOrRoadId?.direction);
    const lanes=this.lanesForRoadDirection(roadId,resolvedDirection);return lanes.length?lanes.at(-1).index:0;
  }

  turnDirection(inLaneId,outLaneId){
    const incoming=this.lanes.get(inLaneId),outgoing=this.lanes.get(outLaneId);if(!incoming||!outgoing)return"straight";
    const a=incoming.curve.getTangentAt(1).setY(0).normalize(),b=outgoing.curve.getTangentAt(0).setY(0).normalize();
    const signed=Math.atan2(a.z*b.x-a.x*b.z,THREE.MathUtils.clamp(a.dot(b),-1,1));
    const magnitude=Math.abs(signed);
    if(magnitude>Math.PI*.78)return"uturn";
    if(magnitude<THREE.MathUtils.degToRad(24))return"straight";
    return signed<0?"right":"left";
  }

  preferredApproachLaneIndex(inLaneId,outLaneId){
    const incoming=this.lanes.get(inLaneId);if(!incoming)return 0;
    const outer=this.outermostLaneIndex(incoming);
    const turn=this.turnDirection(inLaneId,outLaneId);
    // UK lane discipline: left turns and straight-ahead traffic normally keep left;
    // right turns move towards the centre line or median.
    return turn==="right"||turn==="uturn"?0:outer;
  }

  laneRunsOnTrafficSide(lane){
    if(!lane)return false;
    const road=this.roads.get(lane.roadId);if(!road)return false;
    const t=.5,centre=road.centerCurve.getPointAt(t),point=lane.curve.getPointAt(t),tangent=lane.curve.getTangentAt(t).setY(0).normalize();
    const left=new THREE.Vector3(-tangent.z,0,tangent.x),signed=point.clone().sub(centre).dot(left);
    return this.trafficSide==="left"?signed>0:signed<0;
  }

  connectorKey(inLaneId,outLaneId){return `${inLaneId}>${outLaneId}`;}

  getJunctionConnector(inLaneId,outLaneId){
    const key=this.connectorKey(inLaneId,outLaneId);if(this.junctionConnectors.has(key))return this.junctionConnectors.get(key);
    const incoming=this.lanes.get(inLaneId),outgoing=this.lanes.get(outLaneId);if(!incoming||!outgoing||incoming.to!==outgoing.from)return null;
    const node=this.nodes.get(incoming.to),start=incoming.curve.getPointAt(1),end=outgoing.curve.getPointAt(0);
    const startTangent=incoming.curve.getTangentAt(1).setY(0).normalize(),endTangent=outgoing.curve.getTangentAt(0).setY(0).normalize(),turnAngle=Math.acos(THREE.MathUtils.clamp(startTangent.dot(endTangent),-1,1));
    const geometricLimit=turnAngle<THREE.MathUtils.degToRad(15)?Infinity:turnAngle<THREE.MathUtils.degToRad(35)?45:turnAngle<THREE.MathUtils.degToRad(75)?34:25;
    let curve,type="junction",speedLimit=Math.min(incoming.speedLimit,outgoing.speedLimit,geometricLimit);
    if(node?.control==="roundabout"){
      type="roundabout";speedLimit=Math.min(speedLimit,25);
      const centre=node.position,circleRadius=(node.roundaboutInnerRadius+node.roundaboutRadius)*.5;
      const startRadial=start.clone().sub(centre).setY(0).normalize(),endRadial=end.clone().sub(centre).setY(0).normalize();
      const entry=centre.clone().addScaledVector(startRadial,circleRadius),exit=centre.clone().addScaledVector(endRadial,circleRadius);
      const startAngle=Math.atan2(entry.z-centre.z,entry.x-centre.x),endAngle=Math.atan2(exit.z-centre.z,exit.x-centre.x);
      let delta=this.trafficSide==="left"?positiveModulo(endAngle-startAngle,Math.PI*2):-positiveModulo(startAngle-endAngle,Math.PI*2);
      if(Math.abs(delta)<.30)delta+=(this.trafficSide==="left"?1:-1)*Math.PI*2;
      const points=[start.clone(),start.clone().addScaledVector(startTangent,Math.min(5,start.distanceTo(entry)*.4)),entry.clone()];
      const arcSamples=Math.max(7,Math.ceil(delta/(Math.PI/18)));
      for(let i=1;i<arcSamples;i++){
        const angle=startAngle+delta*(i/arcSamples);points.push(new THREE.Vector3(centre.x+Math.cos(angle)*circleRadius,centre.y,centre.z+Math.sin(angle)*circleRadius));
      }
      points.push(exit.clone(),end.clone().addScaledVector(endTangent,-Math.min(5,end.distanceTo(exit)*.4)),end.clone());
      curve=new THREE.CatmullRomCurve3(points,false,"centripetal",.12);
    }else{
      const distance=start.distanceTo(end),handle=THREE.MathUtils.clamp(distance*.42,3.5,Math.max(5,node?.junctionRadius*.85??8));
      curve=cubicConnector(start,startTangent,end,endTangent,handle);
    }
    const connector={id:`connector:${key}`,nodeId:incoming.to,inLaneId,outLaneId,type,curve,length:curve.getLength(),speedLimit};
    this.junctionConnectors.set(key,connector);return connector;
  }

  route(start,end){
    const key=`${start}>${end}:${[...this.lanes.values()].filter(l=>l.closed).map(l=>l.id).join(",")}`;if(this.routeCache.has(key))return[...this.routeCache.get(key)];
    const t0=performance.now(),open=new Set([start]),came=new Map(),g=new Map([[start,0]]),f=new Map([[start,this.heuristic(start,end)]]);
    while(open.size){
      let current=[...open].reduce((best,n)=>(f.get(n)??Infinity)<(f.get(best)??Infinity)?n:best,[...open][0]);
      if(current===end){const path=[current];while(came.has(current)){current=came.get(current);path.unshift(current);}this.routeCache.set(key,path);this.lastRouteMs=performance.now()-t0;return[...path];}
      open.delete(current);
      for(const laneId of this.outgoing.get(current)??[]){
        const lane=this.lanes.get(laneId);if(lane.closed)continue;const cost=lane.length/Math.max(5,lane.speedLimit/3.6),tentative=(g.get(current)??Infinity)+cost;
        if(tentative<(g.get(lane.to)??Infinity)){came.set(lane.to,current);g.set(lane.to,tentative);f.set(lane.to,tentative+this.heuristic(lane.to,end));open.add(lane.to);}
      }
    }
    this.lastRouteMs=performance.now()-t0;return[];
  }

  heuristic(a,b){return this.nodes.get(a).position.distanceTo(this.nodes.get(b).position)/25;}
  nearestNode(position){let best=null,dist=Infinity;for(const node of this.nodes.values()){const d=node.position.distanceToSquared(position);if(d<dist){dist=d;best=node;}}return best;}

  nearestLane(position,heading=null){
    const cx=Math.floor(position.x/this.spatialCellSize),cz=Math.floor(position.z/this.spatialCellSize),candidates=[];
    for(let radius=0;radius<=2&&!candidates.length;radius++)for(let x=cx-radius;x<=cx+radius;x++)for(let z=cz-radius;z<=cz+radius;z++){const bucket=this.laneSpatial.get(`${x}:${z}`);if(bucket)candidates.push(...bucket);}
    if(!candidates.length)for(const lane of this.lanes.values()){const p=lane.curve.getPointAt(.5);candidates.push({laneId:lane.id,t:.5,step:.5,x:p.x,z:p.z});}
    const vehicleForward=Number.isFinite(heading)?new THREE.Vector3(Math.sin(heading),0,Math.cos(heading)):null;
    let bestSample=null,bestScore=Infinity,bestDistanceSq=Infinity,bestAlignment=1;
    for(const sample of candidates){
      const lane=this.lanes.get(sample.laneId);if(!lane)continue;
      const dx=position.x-sample.x,dz=position.z-sample.z,distanceSq=dx*dx+dz*dz;
      const alignment=vehicleForward?lane.curve.getTangentAt(sample.t).setY(0).normalize().dot(vehicleForward):1;
      const directionPenalty=vehicleForward?(1-alignment)*20:0,score=distanceSq+directionPenalty*directionPenalty;
      if(score<bestScore){bestScore=score;bestDistanceSq=distanceSq;bestSample=sample;bestAlignment=alignment;}
    }
    if(!bestSample)return{lane:null,distance:Infinity,t:0,alignment:0};
    const lane=this.lanes.get(bestSample.laneId);let bestT=bestSample.t;const span=Math.max(.012,bestSample.step*1.4);
    for(let i=-4;i<=4;i++){
      const t=THREE.MathUtils.clamp(bestSample.t+i*span/4,0,1),p=lane.curve.getPointAt(t),distanceSq=(p.x-position.x)**2+(p.z-position.z)**2;
      if(distanceSq<bestDistanceSq){bestDistanceSq=distanceSq;bestT=t;}
    }
    if(vehicleForward)bestAlignment=lane.curve.getTangentAt(bestT).setY(0).normalize().dot(vehicleForward);
    return{lane,distance:Math.sqrt(bestDistanceSq),t:bestT,alignment:bestAlignment};
  }

  nearestDrivableSurface(position,heading=null){
    const laneResult=this.nearestLane(position,heading);let best={...laneResult,type:"lane",onRoad:laneResult.distance<(laneResult.lane?.laneWidth??3.35)*1.85};
    for(const node of this.nodes.values()){
      const radius=Math.max(0,node.junctionRadius??0),distance=Math.hypot(position.x-node.position.x,position.z-node.position.z)-radius;
      if(distance<best.distance)best={lane:laneResult.lane,distance:Math.max(0,distance),t:laneResult.t,alignment:laneResult.alignment,type:node.control==="roundabout"?"roundabout":"junction",node,onRoad:distance<1.2};
    }
    for(const connector of this.junctionConnectors.values()){
      const samples=Math.max(8,Math.ceil(connector.length/2.5));
      for(let i=0;i<=samples;i++){
        const t=i/samples,p=connector.curve.getPointAt(t),distance=Math.hypot(position.x-p.x,position.z-p.z);
        if(distance<best.distance)best={lane:laneResult.lane,distance,t,alignment:laneResult.alignment,type:"connector",connector,onRoad:distance<3.8};
      }
    }
    return best;
  }

  laneAxis(lane){const a=lane.curve.getPointAt(.85),b=lane.curve.getPointAt(1),d=b.clone().sub(a).normalize();return Math.abs(d.x)>Math.abs(d.z)?"horizontal":"vertical";}
}
