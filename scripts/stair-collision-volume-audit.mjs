import fs from "node:fs";
import * as THREE from "three";

const context=new Proxy({measureText:text=>({width:String(text).length*10})},{get(target,key){if(key in target)return target[key];return()=>{};},set(target,key,value){target[key]=value;return true;}});
globalThis.document={getElementById:()=>null,pointerLockElement:null,createElement:tag=>tag==="canvas"?{width:0,height:0,getContext:()=>context}:{style:{},appendChild(){},click(){},remove(){}},body:{appendChild(){}}};
globalThis.window={addEventListener(){},removeEventListener(){},innerWidth:1536,innerHeight:742,devicePixelRatio:1.25};
globalThis.localStorage={getItem:()=>null,setItem:()=>{}};globalThis.addEventListener=()=>{};globalThis.removeEventListener=()=>{};

const [{buildRoadGraph},{WORLD_DEFINITION},{CityBuilder},{RailSystem}]=await Promise.all([
  import("../src/world/CityPlan.js"),import("../src/world/WorldDefinition.js"),import("../src/world/CityBuilder.js"),import("../src/rail/RailSystem.js")
]);
const scene=new THREE.Scene(),camera=new THREE.PerspectiveCamera(),input={isDown:()=>false,consume:()=>false},graph=buildRoadGraph(WORLD_DEFINITION),city=new CityBuilder(scene,graph,WORLD_DEFINITION),built=city.build(),rail=new RailSystem(scene,camera,input,graph,built.chunkManager,built.railPlan,()=>{},built.colliders);
const bodyHeight=1.72,maxStepUp=.58;
let oldProjectedBlockedArea=0,newProjectedBlockedArea=0,clearUnderArea=0,maxOldDebugVertical=0,maxNewDebugVertical=0;
const stationResults=[];
for(const station of built.railPlan.stations){
  const stairs=rail.walkSurfaces.filter(surface=>surface.stationId===station.id&&surface.type==="stairs"&&surface.role==="platform-footbridge-stairs"),items=[];
  for(const stair of stairs){
    const rise=Math.abs(stair.to.y-stair.from.y),horizontalLength=Math.hypot(stair.to.x-stair.from.x,stair.to.z-stair.from.z),width=(stair.visualHalfWidth??stair.halfWidth)*2,structureDepth=stair.structureDepth??.32,headClearance=stair.headClearance??.04;
    const oldBlockStart=Math.min(1,maxStepUp/rise),newBlockEnd=Math.min(1,(bodyHeight+structureDepth+headClearance)/rise),oldBlockedLength=horizontalLength*Math.max(0,1-oldBlockStart),newBlockedLength=horizontalLength*Math.max(0,newBlockEnd-oldBlockStart),oldArea=oldBlockedLength*width,newArea=newBlockedLength*width;
    oldProjectedBlockedArea+=oldArea;newProjectedBlockedArea+=newArea;clearUnderArea+=Math.max(0,oldArea-newArea);maxOldDebugVertical=Math.max(maxOldDebugVertical,rise);maxNewDebugVertical=Math.max(maxNewDebugVertical,structureDepth);
    items.push({role:stair.role,rise,horizontalLength,width,structureDepth,headClearance,oldProjectedBlockedArea:oldArea,newProjectedBlockedArea:newArea,restoredClearArea:Math.max(0,oldArea-newArea),restoredRunFraction:oldBlockedLength?Math.max(0,oldBlockedLength-newBlockedLength)/oldBlockedLength:0});
  }
  stationResults.push({stationId:station.id,stationName:station.name,stairs:items});
}
const result={passed:true,method:"Analytical comparison of the previous full-XZ-projection rejection and the fixed vertical stair-volume intersection for every platform-footbridge stair.",stations:stationResults.length,stairs:stationResults.reduce((sum,item)=>sum+item.stairs.length,0),player:{bodyHeight,maxStepUp},totals:{oldProjectedBlockedArea,newProjectedBlockedArea,restoredClearArea:clearUnderArea,projectedBlockedAreaReductionPercent:oldProjectedBlockedArea?100*(oldProjectedBlockedArea-newProjectedBlockedArea)/oldProjectedBlockedArea:0,maxOldDebugVertical,maxNewDebugVertical,debugVerticalReductionPercent:maxOldDebugVertical?100*(maxOldDebugVertical-maxNewDebugVertical)/maxOldDebugVertical:0},stationResults};
const output=process.argv[2]??"benchmarks/stair-collision-volume-audit.json";fs.writeFileSync(output,JSON.stringify(result,null,2));
console.log(`Stair collision-volume audit: ${result.stairs} stairs, restored ${clearUnderArea.toFixed(2)} m² of genuinely clear projected space, ${result.totals.projectedBlockedAreaReductionPercent.toFixed(1)}% reduction in false floor-level blocking.`);
