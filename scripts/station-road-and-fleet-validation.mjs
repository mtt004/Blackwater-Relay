import * as THREE from 'three';
const interactionPrompt={hidden:true,dataset:{},querySelector:()=>({textContent:''})};
globalThis.document={getElementById:id=>id==='interaction-prompt'?interactionPrompt:null,pointerLockElement:null};
globalThis.window={};globalThis.localStorage={getItem:()=>null,setItem:()=>{}};globalThis.addEventListener=()=>{};
const [{buildRoadGraph},{WORLD_DEFINITION},{CityBuilder},{RailSystem}]=await Promise.all([
  import('../src/world/CityPlan.js'),import('../src/world/WorldDefinition.js'),import('../src/world/CityBuilder.js'),import('../src/rail/RailSystem.js')
]);
const scene=new THREE.Scene(),camera=new THREE.PerspectiveCamera(),input={down:new Set(),mouseDX:0,mouseDY:0,isDown(){return false;},consume(){return false;}},graph=buildRoadGraph(WORLD_DEFINITION),built=new CityBuilder(scene,graph,WORLD_DEFINITION).build(),rail=new RailSystem(scene,camera,input,graph,built.chunkManager,built.railPlan,()=>{},built.colliders);
let minimumRoadClearance=Infinity,underpassStations=0;
for(const station of built.railPlan.stations){
  const building=station.stationBuilding;
  if(!building)throw new Error(`${station.name} has no station building metadata`);
  const clearance=rail.orientedRoadClearance(building.centre,building.forward,building.right,building.halfDepth,building.halfWidth);
  minimumRoadClearance=Math.min(minimumRoadClearance,clearance);
  if(clearance<.75)throw new Error(`${station.name} station building overlaps a road (${clearance.toFixed(2)} m clearance)`);
  if(Math.abs(clearance-building.minimumRoadClearance)>.05)throw new Error(`${station.name} stored road clearance is stale`);
  if(building.usesPedestrianUnderpass)underpassStations++;
}
if(rail.trains.length!==12)throw new Error(`expected 12 trains, found ${rail.trains.length}`);
for(const route of built.railPlan.routes){
  const services=rail.trains.filter(train=>train.routeId===route.id);
  if(services.length!==6)throw new Error(`${route.name} has ${services.length} services instead of 6`);
}
for(const trackIndex of[0,1,2,3]){
  const services=rail.trains.filter(train=>train.trackIndex===trackIndex);
  if(services.length!==3)throw new Error(`track ${trackIndex+1} has ${services.length} services instead of 3`);
  const direction=new Set(services.map(train=>train.direction));
  if(direction.size!==1)throw new Error(`track ${trackIndex+1} has conflicting train directions`);
}
console.log(`Station-road and fleet validation passed: ${built.railPlan.stations.length} road-safe station halls, minimum road clearance ${minimumRoadClearance.toFixed(2)} m, ${underpassStations} underpass-access halls, 12 HST services.`);
