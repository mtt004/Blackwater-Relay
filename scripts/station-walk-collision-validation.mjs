import fs from "node:fs";
import * as THREE from "three";

const context=new Proxy({measureText:text=>({width:String(text).length*10})},{get(target,key){if(key in target)return target[key];return()=>{};},set(target,key,value){target[key]=value;return true;}});
globalThis.document={getElementById:()=>null,pointerLockElement:null,createElement:tag=>tag==="canvas"?{width:0,height:0,getContext:()=>context}:{style:{},appendChild(){},click(){},remove(){}},body:{appendChild(){}}};
globalThis.window={addEventListener(){},removeEventListener(){},innerWidth:1536,innerHeight:742,devicePixelRatio:1.25};
globalThis.localStorage={getItem:()=>null,setItem:()=>{}};globalThis.addEventListener=()=>{};globalThis.removeEventListener=()=>{};

const [{buildRoadGraph},{WORLD_DEFINITION},{CityBuilder},{RailSystem}]=await Promise.all([
  import("../src/world/CityPlan.js"),import("../src/world/WorldDefinition.js"),import("../src/world/CityBuilder.js"),import("../src/rail/RailSystem.js")
]);

const fail=message=>{throw new Error(message);};
const scene=new THREE.Scene(),camera=new THREE.PerspectiveCamera(),input={isDown:()=>false,consume:()=>false},graph=buildRoadGraph(WORLD_DEFINITION),city=new CityBuilder(scene,graph,WORLD_DEFINITION),built=city.build();
const rail=new RailSystem(scene,camera,input,graph,built.chunkManager,built.railPlan,()=>{},built.colliders);
const bodyHeight=1.72,maxStepUp=.58;
let sampledPoints=0,walkableApproachPoints=0,solidStructureBlocks=0,clearUnderStairPoints=0,outsideFootprintClearPoints=0,falseUnderStairBlocks=0,missingStructureBlocks=0,outsideFootprintBlocks=0;
const failures=[],stationResults=[];

for(const station of built.railPlan.stations){
  const stairs=rail.walkSurfaces.filter(surface=>surface.stationId===station.id&&surface.type==="stairs"&&surface.role==="platform-footbridge-stairs");
  if(stairs.length!==5)fail(`${station.name} does not expose five platform-footbridge stairs`);
  const stationResult={stationId:station.id,stationName:station.name,stairs:stairs.length,sampledPoints:0,walkableApproachPoints:0,solidStructureBlocks:0,clearUnderStairPoints:0,outsideFootprintClearPoints:0,falseUnderStairBlocks:0,missingStructureBlocks:0,outsideFootprintBlocks:0};
  for(const stair of stairs){
    if(stair.halfLength>stair.visualHalfLength+.021||stair.halfWidth>stair.visualHalfWidth+.021)fail(`${station.name} stair footprint exceeds its rendered tread envelope`);
    for(const acrossFactor of[-.75,0,.75])for(let step=0;step<=50;step++){
      const alpha=step/50,point=stair.from.clone().lerp(stair.to,alpha).addScaledVector(stair.right,acrossFactor*stair.visualHalfWidth);point.y=stair.from.y;
      if(rail.walkBlockerAt(point,stair.from.y))continue;
      const hit=rail.walkSurfaceSample(stair,point);if(!hit)continue;
      const result=rail.resolveWalkSurface(point,stair.from.y,{bodyHeight}),delta=hit.height-stair.from.y,underside=hit.height-(stair.structureDepth??.32),bodyTop=stair.from.y+bodyHeight,hasHeadroom=bodyTop<=underside-(stair.headClearance??.04),shouldWalkOnto=delta<=maxStepUp;
      sampledPoints++;stationResult.sampledPoints++;
      if(shouldWalkOnto){walkableApproachPoints++;stationResult.walkableApproachPoints++;if(result.blocked&&failures.length<80)failures.push({stationId:station.id,kind:"walkable-approach-blocked",alpha,acrossFactor,reason:result.reason});}
      else if(hasHeadroom){clearUnderStairPoints++;stationResult.clearUnderStairPoints++;if(result.blocked){falseUnderStairBlocks++;stationResult.falseUnderStairBlocks++;if(failures.length<80)failures.push({stationId:station.id,kind:"headroom-blocked",alpha,acrossFactor,underside,bodyTop,reason:result.reason});}}
      else{solidStructureBlocks++;stationResult.solidStructureBlocks++;if(!result.blocked||result.reason!=="stair-underside"){missingStructureBlocks++;stationResult.missingStructureBlocks++;if(failures.length<80)failures.push({stationId:station.id,kind:"structure-not-blocked",alpha,acrossFactor,underside,bodyTop,reason:result.reason});}}
    }
    for(const side of[-1,1])for(let step=5;step<=45;step+=5){
      const alpha=step/50,point=stair.from.clone().lerp(stair.to,alpha).addScaledVector(stair.right,side*(stair.visualHalfWidth+.08));point.y=stair.from.y;
      if(rail.walkBlockerAt(point,stair.from.y))continue;
      const result=rail.resolveWalkSurface(point,stair.from.y,{bodyHeight});outsideFootprintClearPoints++;stationResult.outsideFootprintClearPoints++;
      if(result.blocked&&result.surface===stair){outsideFootprintBlocks++;stationResult.outsideFootprintBlocks++;if(failures.length<80)failures.push({stationId:station.id,kind:"outside-footprint-blocked",alpha,side,reason:result.reason});}
    }
  }
  stationResults.push(stationResult);
}

rail.setCollisionDebugVisible(true);
const debug=rail.stationCollisionDebug,stairDebug=debug?.getObjectByName?.("station-stair-walk-boundaries"),blockerDebug=debug?.getObjectByName?.("station-solid-blockers");
if(!debug||!stairDebug||!blockerDebug)fail("B-key station debug overlay does not include both solid blockers and stair structure boundaries");
const positions=stairDebug.geometry.attributes.position.array;let longestVerticalEdge=0,verticalEdgeCount=0;
for(let index=0;index<positions.length;index+=6){const dx=Math.abs(positions[index]-positions[index+3]),dz=Math.abs(positions[index+2]-positions[index+5]);if(dx<1e-5&&dz<1e-5){verticalEdgeCount++;longestVerticalEdge=Math.max(longestVerticalEdge,Math.abs(positions[index+1]-positions[index+4]));}}
if(longestVerticalEdge>.34)fail(`stair debug overlay still contains a ${longestVerticalEdge.toFixed(3)} m floor-height prism edge`);
if(falseUnderStairBlocks)fail(`${falseUnderStairBlocks} points with genuine headroom are still blocked beneath stairs`);
if(missingStructureBlocks)fail(`${missingStructureBlocks} points intersecting the visible stair structure were not blocked`);
if(outsideFootprintBlocks)fail(`${outsideFootprintBlocks} points outside the rendered stair width were blocked by that stair`);
if(clearUnderStairPoints<1000||solidStructureBlocks<1000||walkableApproachPoints<500)fail("insufficient stair collision coverage was exercised");

const result={passed:true,stations:stationResults.length,stairs:stationResults.reduce((sum,item)=>sum+item.stairs,0),sampledPoints,walkableApproachPoints,solidStructureBlocks,clearUnderStairPoints,outsideFootprintClearPoints,falseUnderStairBlocks,missingStructureBlocks,outsideFootprintBlocks,debugOverlay:{solidBlockerVertices:blockerDebug.geometry.attributes.position.count,stairBoundaryVertices:stairDebug.geometry.attributes.position.count,verticalEdgeCount,longestVerticalEdge,depthTest:stairDebug.material.depthTest},stationResults,failures};
const output=process.argv[2]??"benchmarks/station-walk-collision-validation.json";fs.writeFileSync(output,JSON.stringify(result,null,2));
console.log(`Station stair-volume validation passed: ${result.stairs} stairs, ${sampledPoints.toLocaleString()} probes, ${clearUnderStairPoints.toLocaleString()} clear under-stair points, ${solidStructureBlocks.toLocaleString()} solid intersections, zero false blocks.`);
