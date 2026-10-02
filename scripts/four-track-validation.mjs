import * as THREE from 'three';
const interactionPrompt={hidden:true,dataset:{},querySelector:()=>({textContent:''})};
const context=new Proxy({measureText:text=>({width:String(text).length*10})},{get(target,key){if(key in target)return target[key];return()=>{};},set(target,key,value){target[key]=value;return true;}});
globalThis.document={getElementById:id=>id==='interaction-prompt'?interactionPrompt:null,pointerLockElement:null,createElement:tag=>tag==='canvas'?{width:0,height:0,getContext:()=>context}: {}};
globalThis.window={};globalThis.localStorage={getItem:()=>null,setItem:()=>{}};globalThis.addEventListener=()=>{};
const [{buildRoadGraph},{WORLD_DEFINITION},{CityBuilder},{RailSystem}]=await Promise.all([
  import('../src/world/CityPlan.js'),import('../src/world/WorldDefinition.js'),import('../src/world/CityBuilder.js'),import('../src/rail/RailSystem.js')
]);
const scene=new THREE.Scene(),camera=new THREE.PerspectiveCamera(),input={down:new Set(),mouseDX:0,isDown(){return false;},consume(){return false;}},graph=buildRoadGraph(WORLD_DEFINITION),city=new CityBuilder(scene,graph,WORLD_DEFINITION),built=city.build(),rail=new RailSystem(scene,camera,input,graph,built.chunkManager,built.railPlan,()=>{},built.colliders);
rail.stationOperations.updateInformation(rail.trains,0);
for(const route of built.railPlan.routes){
  if(route.trackOffsets?.length!==4)throw new Error(`${route.name} does not have four tracks`);
  if(route.platformCentres?.length!==5)throw new Error(`${route.name} does not define five platform centres`);
}
for(const station of built.railPlan.stations){
  const surfaces=rail.walkSurfaces.filter(s=>s.stationId===station.id&&s.role==='platform');
  const centreBuckets=new Set(surfaces.map(s=>Math.round(station.normal.dot(s.centre.clone().sub(station.position)))));
  if(![-14,-7,0,7,14].every(v=>[...centreBuckets].some(x=>Math.abs(x-v)<=1)))throw new Error(`${station.name} is missing a platform`);
  const stairCount=rail.walkSurfaces.filter(s=>s.stationId===station.id&&s.role==='platform-footbridge-stairs').length;
  if(stairCount<5)throw new Error(`${station.name} does not have stairs to every platform`);
  const maps=[];scene.traverse(o=>{if(o.name?.startsWith(`${station.id}-platform-`)&&o.name.endsWith('-route-map'))maps.push(o);});
  if(maps.length!==5)throw new Error(`${station.name} has ${maps.length} route maps instead of 5`);
  for(const map of maps){
    if(map.userData.displayData?.status!=="No train"&&(!Array.isArray(map.userData.routeStops)||map.userData.routeStops.length<2))throw new Error(`${station.name} has an incomplete live route map`);
    if(!map.userData.routeId)throw new Error(`${station.name} has a route map without a railway route`);
  }
}
if(rail.trains.length!==12)throw new Error(`fleet has ${rail.trains.length} trains instead of 12`);
if(new Set(rail.trains.map(t=>t.trackIndex)).size!==4)throw new Error('fleet does not use all four tracks');
for(const trackIndex of[0,1,2,3])if(rail.trains.filter(train=>train.trackIndex===trackIndex).length!==3)throw new Error(`track ${trackIndex+1} does not have three services`);
for(const train of rail.trains){if(![-1,1].includes(rail.platformSideForTrain(train)))throw new Error(`${train.id} has invalid platform side`);}
console.log(`Four-track validation passed: ${built.railPlan.routes.length} loops, ${built.railPlan.stations.length} stations, ${rail.trains.length} trains, 4 tracks, 5 platforms per station.`);
