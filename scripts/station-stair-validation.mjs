import * as THREE from 'three';

globalThis.document={getElementById:id=>id==='interaction-prompt'?{hidden:true,dataset:{},querySelector:()=>({textContent:''})}:null,pointerLockElement:null};
globalThis.window={};
globalThis.localStorage={getItem:()=>null,setItem:()=>{}};
globalThis.addEventListener=()=>{};

const [{buildRoadGraph},{CityBuilder},{RailSystem},{PlayerController}]=await Promise.all([
  import('../src/world/CityPlan.js'),
  import('../src/world/CityBuilder.js'),
  import('../src/rail/RailSystem.js'),
  import('../src/player/PlayerController.js')
]);

const fail=message=>{throw new Error(message);};
const scene=new THREE.Scene(),graph=buildRoadGraph(),city=new CityBuilder(scene,graph),built=city.build();
city.initializeStreaming(new THREE.Vector3(-330,0,5),Math.PI/2,0);
const input={down:new Set(['KeyW']),mouseDX:0,isDown(key){return this.down.has(key);},consume(){return false;}};
const camera=new THREE.PerspectiveCamera(),rail=new RailSystem(scene,camera,input,graph,built.chunkManager,built.railPlan,()=>{},built.colliders);
const player=new PlayerController(scene,camera,input,graph,built.colliders,()=>{});player.setRailSystem(rail);player.inVehicle=false;

for(const station of built.railPlan.stations){
  const building=station.stationBuilding,flights=rail.walkSurfaces.filter(surface=>surface.stationId===station.id&&surface.type==='stairs'&&surface.role.startsWith('ground-platform-stairs-'));
  if(!building||flights.length!==2)fail(`${station.name}: missing dog-leg station hall or stair flights`);
  if(building.halfWidth<5.2)fail(`${station.name}: dog-leg stair hall is too narrow`);
  if(building.stairPitch<27||building.stairPitch>33)fail(`${station.name}: stair pitch ${building.stairPitch.toFixed(1)}° is outside the realistic range`);
  if(building.minimumTrackClearance<9.5)fail(`${station.name}: station hall is too close to the railway`);
  const group=rail.stationGroups.find(item=>item.userData.station.id===station.id);
  if(!group?.children.some(child=>child.name===`${station.id}-interior-mid-landing`))fail(`${station.name}: turning landing is missing`);
  if(group.children.filter(child=>child.name===`${station.id}-interior-light`).length<3)fail(`${station.name}: stair hall lighting is incomplete`);

  const route=building.stairRoute;camera.position.copy(route[0]);camera.position.y=route[0].y+1.72;
  for(let index=1;index<route.length;index++){
    const target=route[index];let reached=false,stuckFrames=0,last=camera.position.clone();
    for(let frame=0;frame<1400;frame++){
      const direction=target.clone().sub(camera.position);direction.y=0;
      if(direction.length()<.65&&Math.abs((camera.position.y-1.72)-target.y)<.65){reached=true;break;}
      player.walkYaw=Math.atan2(direction.x,direction.z);player.updateWalking(1/60);
      stuckFrames=camera.position.distanceTo(last)<1e-5?stuckFrames+1:0;last.copy(camera.position);
      if(stuckFrames>100)break;
    }
    if(!reached)fail(`${station.name}: player cannot reach dog-leg station waypoint ${index}`);
  }
}

console.log(`Station stair validation passed: ${built.railPlan.stations.length} enclosed dog-leg halls with two realistic flights, turning landings and complete street-to-platform traversal.`);
process.exit(0);
