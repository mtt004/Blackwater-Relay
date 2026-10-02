import * as THREE from "three";
import { offsetPointOnRail, wrappedProgress } from "./RailPlan.js?v=20261002-flight-sim-terrain";
import { CONFIG } from "../config.js?v=20261002-flight-sim-terrain";

const clamp=(value,min,max)=>Math.max(min,Math.min(max,value));
const forwardDelta=(a,b)=>((b-a)%1+1)%1;
const containsProgress=(start,end,t)=>start<end?(t>=start&&t<end):(t>=start||t<end);
const circularDistance=(a,b)=>Math.min(forwardDelta(a,b),forwardDelta(b,a));
const physicalStationId=station=>station.sharedPhysicalStationId??station.id;

function estimateCurveRadius(curve,t,length){
  const d=clamp(18/Math.max(1,length),.0015,.015),a=curve.getTangentAt(wrappedProgress(t-d)).setY(0).normalize(),b=curve.getTangentAt(wrappedProgress(t+d)).setY(0).normalize(),angle=Math.acos(clamp(a.dot(b),-1,1));
  return angle<1e-4?Infinity:(2*d*length)/angle;
}

function uniqueBreakpoints(points){
  const sorted=[...points].map(wrappedProgress).sort((a,b)=>a-b),result=[];
  for(const value of sorted)if(!result.length||Math.abs(value-result.at(-1))>1e-5)result.push(value);
  if(!result.length)result.push(0);return result;
}

function buildBreakpoints(route){
  const points=new Set(),regularLength=route.id==="airport"?190:230,regularCount=Math.max(10,Math.ceil(route.length/regularLength));
  for(let index=0;index<regularCount;index++){const t=index/regularCount,insidePlatform=route.stations.some(station=>circularDistance(t,station.t)*route.length<station.platformLength*.5+20);if(!insidePlatform)points.add(t);}
  for(const station of route.stations){
    const platformClearance=station.platformLength*.5+24;
    for(const metres of[-320,-190,-platformClearance,platformClearance,190,320])points.add(wrappedProgress(station.t+metres/route.length));
  }
  if(route.connectsAtStationId){
    const station=route.stations.find(item=>item.id===route.connectsAtStationId||item.sharedPhysicalStationId===route.connectsAtStationId);
    if(station){const clearance=station.platformLength*.5+32;for(const metres of[-280,-clearance,clearance,280])points.add(wrappedProgress(station.t+metres/route.length));}
  }
  const filtered=[...points].filter(t=>!route.stations.some(station=>circularDistance(t,station.t)*route.length<station.platformLength*.5+18));
  return uniqueBreakpoints(filtered);
}

export class RailNetwork{
  constructor(plan){
    this.plan=plan;this.routes=plan.routes??[plan];this.routeById=new Map(this.routes.map(route=>[route.id,route]));this.segments=[];this.blocks=[];this.nodes=new Map();this.blocksByLine=new Map();this.lineLookup=new Map();this.blockById=new Map();this.signals=[];this.signalById=new Map();this.platforms=[];this.platformById=new Map();this.platformsByStation=new Map();this.junctions=[];this.junctionById=new Map();
    this.build();
  }

  build(){
    for(const route of this.routes)this.buildRoute(route);
    this.buildPlatforms();this.buildJunctions();
  }

  buildRoute(route){
    const breakpoints=buildBreakpoints(route),trackOffsets=route.trackOffsets??this.plan.trackOffsets??[-10.5,-3.5,3.5,10.5];
    for(let trackIndex=0;trackIndex<trackOffsets.length;trackIndex++){
      const direction=trackIndex%2===0?1:-1,lineKey=`${route.id}:${trackIndex}`,lineBlocks=[];
      for(let index=0;index<breakpoints.length;index++){
        const startT=breakpoints[index],endT=index===breakpoints.length-1?breakpoints[0]:breakpoints[index+1],length=forwardDelta(startT,endT)*route.length,midT=wrappedProgress(startT+forwardDelta(startT,endT)*.5),tangent=route.curve.getTangentAt(midT),gradient=Math.abs(tangent.y),radius=estimateCurveRadius(route.curve,midT,route.length),curveLimit=(Number.isFinite(radius)?clamp(Math.sqrt(Math.max(1,radius)*.72),8,route.designSpeedMps):route.designSpeedMps)*CONFIG.trainSpeedMultiplier;
        const stationAssociations=route.stations.filter(station=>circularDistance(station.t,midT)*route.length<Math.max(85,length*.75)).map(station=>physicalStationId(station));
        const bridgeAssociations=(route.gradeSeparations??[]).filter(bridge=>containsProgress(startT,endT,bridge.t)).map(bridge=>bridge.id);
        const startNodeId=`node:${route.id}:${trackIndex}:${String(index).padStart(3,"0")}`,endNodeId=`node:${route.id}:${trackIndex}:${String((index+1)%breakpoints.length).padStart(3,"0")}`;
        if(!this.nodes.has(startNodeId))this.nodes.set(startNodeId,{id:startNodeId,routeId:route.id,trackIndex,progress:startT});
        if(!this.nodes.has(endNodeId))this.nodes.set(endNodeId,{id:endNodeId,routeId:route.id,trackIndex,progress:endT});
        const id=`seg:${route.id}:t${trackIndex}:${String(index).padStart(3,"0")}`,blockId=`block:${route.id}:t${trackIndex}:${String(index).padStart(3,"0")}`,gradientSpeedLimit=route.urbanLineSpeedMps*CONFIG.trainSpeedMultiplier*clamp(1-gradient*4,.68,1),speedLimit=Math.min(route.urbanLineSpeedMps*CONFIG.trainSpeedMultiplier,curveLimit,gradientSpeedLimit);
        const segment={id,routeId:route.id,trackIndex,directionRestrictions:[direction],startNodeId,endNodeId,startT,endT,length,speedLimit,gradient,gradientSpeedLimit,curveSpeedLimit:curveLimit,connectedNext:[],blockId,junctionIds:[],stationIds:stationAssociations,bridgeIds:bridgeAssociations};
        const block={id:blockId,segmentId:id,routeId:route.id,trackIndex,direction,startT,endT,length,speedLimit:segment.speedLimit,gradient,gradientSpeedLimit,curveSpeedLimit:curveLimit,stationIds:stationAssociations,junctionIds:[],occupiedBy:new Set(),reservedBy:null,reservationDirection:null,entrySignalId:null,exitSignalId:null,index};
        this.segments.push(segment);this.blocks.push(block);this.blockById.set(blockId,block);lineBlocks.push(block);
      }
      for(let index=0;index<lineBlocks.length;index++){
        const block=lineBlocks[index],next=lineBlocks[(index+(direction>0?1:-1)+lineBlocks.length)%lineBlocks.length],segment=this.segments.find(item=>item.id===block.segmentId);segment.connectedNext=[next.segmentId];
        const signalProgress=direction>0?block.endT:block.startT,signalId=`signal:${route.id}:t${trackIndex}:${String(index).padStart(3,"0")}`,position=offsetPointOnRail(route,signalProgress,trackOffsets[trackIndex]),tangent=route.curve.getTangentAt(signalProgress).setY(0).normalize().multiplyScalar(direction),right=new THREE.Vector3(tangent.z,0,-tangent.x);position.addScaledVector(right,2.35);position.y+=.2;
        const signal={id:signalId,routeId:route.id,trackIndex,blockId:block.id,protectsBlockId:next.id,direction,progress:signalProgress,position,tangent,aspect:"red",identificationPlate:`${route.id.slice(0,1).toUpperCase()}${trackIndex}-${String(index+1).padStart(2,"0")}`};
        block.exitSignalId=signalId;next.entrySignalId=signalId;this.signals.push(signal);this.signalById.set(signalId,signal);
      }
      this.blocksByLine.set(lineKey,lineBlocks);
      const starts=new Float64Array(lineBlocks.length);for(let index=0;index<lineBlocks.length;index++)starts[index]=lineBlocks[index].startT;
      this.lineLookup.set(lineKey,{blocks:lineBlocks,starts});
    }
  }

  buildPlatforms(){
    const platformCentres=this.plan.platformCentres??[-14,-7,0,7,14];
    for(const route of this.routes)for(const station of route.stations){
      const physicalId=physicalStationId(station);
      for(let platformIndex=0;platformIndex<platformCentres.length;platformIndex++){
        const platformNumber=platformIndex+1,centreOffset=platformCentres[platformIndex],adjacentTracks=[];
        for(let trackIndex=0;trackIndex<(route.trackOffsets??this.plan.trackOffsets).length;trackIndex++){
          const trackOffset=(route.trackOffsets??this.plan.trackOffsets)[trackIndex];
          if(Math.abs(trackOffset-centreOffset)<5.1)adjacentTracks.push(trackIndex);
        }
        const id=`platform:${physicalId}:${platformNumber}`;
        if(!this.platformById.has(id)){
          const platform={id,physicalStationId:physicalId,stationName:station.name,platformNumber,centreOffset,length:station.platformLength,routeIds:new Set(),compatibleTracksByRoute:new Map(),occupiedBy:null,reservedBy:null,reservedUntil:0,status:"Available"};
          this.platforms.push(platform);this.platformById.set(id,platform);
          if(!this.platformsByStation.has(physicalId))this.platformsByStation.set(physicalId,[]);this.platformsByStation.get(physicalId).push(platform);
        }
        const platform=this.platformById.get(id);platform.routeIds.add(route.id);platform.compatibleTracksByRoute.set(route.id,adjacentTracks);
      }
    }
  }

  buildJunctions(){
    const city=this.routeById.get("city"),airport=this.routeById.get("airport");if(!city||!airport)return;
    const cityStation=city.stations.find(station=>station.id===airport.connectsAtStationId),airportStation=airport.stations.find(station=>station.sharedPhysicalStationId===cityStation?.id||station.id===airport.connectsAtStationId);if(!cityStation||!airportStation)return;
    const junction={id:"junction:industrial-exchange",name:"Industrial Exchange",conflictGroup:"city-airport-transfer",position:cityStation.position.clone(),tangent:cityStation.tangent.clone(),normal:cityStation.normal.clone(),routes:new Map(),lockedRouteId:null,lockedBy:null,enteredBy:null,releasePending:false};
    for(const direction of[1,-1])for(let trackIndex=0;trackIndex<4;trackIndex++){
      const cityBlock=this.blockForProgress("city",trackIndex,cityStation.t),airportBlock=this.blockForProgress("airport",trackIndex,airportStation.t),forwardId=`jr:city-airport:t${trackIndex}:d${direction>0?"p":"n"}`,reverseId=`jr:airport-city:t${trackIndex}:d${direction>0?"p":"n"}`;
      junction.routes.set(forwardId,{id:forwardId,junctionId:junction.id,fromRouteId:"city",toRouteId:"airport",trackIndex,direction,requiredBlockIds:[cityBlock?.id,airportBlock?.id].filter(Boolean),speedLimit:12*CONFIG.trainSpeedMultiplier});
      junction.routes.set(reverseId,{id:reverseId,junctionId:junction.id,fromRouteId:"airport",toRouteId:"city",trackIndex,direction,requiredBlockIds:[airportBlock?.id,cityBlock?.id].filter(Boolean),speedLimit:12*CONFIG.trainSpeedMultiplier});
      for(const block of[cityBlock,airportBlock])if(block&&!block.junctionIds.includes(junction.id)){block.junctionIds.push(junction.id);const segment=this.segments.find(item=>item.id===block.segmentId);if(segment&&!segment.junctionIds.includes(junction.id))segment.junctionIds.push(junction.id);}
    }
    this.junctions.push(junction);this.junctionById.set(junction.id,junction);
  }

  route(routeId){return this.routeById.get(routeId);}
  lineBlocks(routeId,trackIndex){return this.blocksByLine.get(`${routeId}:${trackIndex}`)??[];}
  blockForProgress(routeId,trackIndex,progress){
    const lookup=this.lineLookup.get(`${routeId}:${trackIndex}`);if(!lookup?.blocks.length)return null;
    const t=wrappedProgress(progress),starts=lookup.starts;let low=0,high=starts.length-1;
    while(low<=high){const mid=(low+high)>>>1;if(starts[mid]<=t)low=mid+1;else high=mid-1;}
    return lookup.blocks[Math.max(0,high)]??lookup.blocks.at(-1)??null;
  }
  nextBlock(block,direction=block.direction,steps=1){const line=this.lineBlocks(block.routeId,block.trackIndex);if(!line.length)return null;const index=Number.isInteger(block.index)?block.index:line.indexOf(block),delta=direction>0?steps:-steps;return line[(index+delta%line.length+line.length)%line.length];}
  blocksAhead(routeId,trackIndex,progress,direction,count=5){const first=this.blockForProgress(routeId,trackIndex,progress);if(!first)return[];const result=[first];for(let index=1;index<count;index++)result.push(this.nextBlock(first,direction,index));return result;}
  forwardDistance(routeId,fromT,toT,direction){const route=this.routeById.get(routeId);if(!route)return Infinity;return(direction>0?forwardDelta(fromT,toT):forwardDelta(toT,fromT))*route.length;}
  platform(physicalStationId,platformNumber){return this.platformById.get(`platform:${physicalStationId}:${platformNumber}`)??null;}
  platformsForStation(station){const id=typeof station==="string"?station:physicalStationId(station);return this.platformsByStation.get(id)??[];}
  compatiblePlatforms(station,routeId,trackIndex){return this.platformsForStation(station).filter(platform=>(platform.compatibleTracksByRoute.get(routeId)??[]).includes(trackIndex));}
  physicalStationId(station){return physicalStationId(station);}
  validate(){
    const errors=[];
    for(const [key,blocks] of this.blocksByLine){if(blocks.length<2)errors.push(`${key} has too few blocks`);for(const block of blocks)if(!this.nextBlock(block,block.direction))errors.push(`${block.id} has no next block`);}
    for(const platform of this.platforms)if(![...platform.compatibleTracksByRoute.values()].some(tracks=>tracks.length))errors.push(`${platform.id} is unreachable`);
    return errors;
  }
}
