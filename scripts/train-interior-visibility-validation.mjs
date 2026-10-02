import fs from 'node:fs';
import * as THREE from 'three';

const interactionPrompt={hidden:true,dataset:{},querySelector:()=>({textContent:''})};
globalThis.document={getElementById:id=>id==='interaction-prompt'?interactionPrompt:null,pointerLockElement:{}};
globalThis.window={};
globalThis.localStorage={getItem:()=>null,setItem:()=>{}};
globalThis.addEventListener=()=>{};

const [{createHSTFormation},{buildRoadGraph},{CityBuilder},{RailSystem},{CONFIG},{chunkKeyForPosition}]=await Promise.all([
  import('../src/rail/HSTFactory.js'),
  import('../src/world/CityPlan.js'),
  import('../src/world/CityBuilder.js'),
  import('../src/rail/RailSystem.js'),
  import('../src/config.js'),
  import('../src/world/WorldChunkManager.js')
]);

const fail=message=>{throw new Error(message);};
const scene=new THREE.Scene(),formation=createHSTFormation(scene,{id:'HST-001',coachCount:5}),coaches=formation.vehicles.filter(vehicle=>vehicle.userData.type==='mark3-coach');
let windowRays=0,doorRays=0,opaqueWindowHits=0,blockedOpenDoors=0;
for(const coach of coaches){
  coach.updateMatrixWorld(true);const interior=coach.userData.interior;
  if(!(interior.eyeY>interior.windowBottom&&interior.eyeY<interior.windowTop))fail('Passenger eye height falls outside a window aperture');
  for(const side of[-1,1])for(const z of interior.windowZ){
    windowRays++;const hits=new THREE.Raycaster(new THREE.Vector3(0,interior.eyeY,z),new THREE.Vector3(side,0,0),0,1.55).intersectObject(coach,true);
    if(!hits.length||hits.some(hit=>hit.object.material?.transparent!==true))opaqueWindowHits++;
  }
  for(const door of coach.userData.passengerDoors){
    if(!door.aperture?.isGroup||door.aperture.isMesh)fail('Door aperture is still a solid mesh');
    for(const leaf of door.leaves)leaf.group.position.z=leaf.baseZ+leaf.slide;
  }
  coach.updateMatrixWorld(true);
  for(const door of coach.userData.passengerDoors){
    doorRays++;const hits=new THREE.Raycaster(new THREE.Vector3(door.side*2,1.8,door.z),new THREE.Vector3(-door.side,0,0),0,1.05).intersectObject(coach,true);
    if(hits.length)blockedOpenDoors++;
  }
}
if(opaqueWindowHits)fail(`${opaqueWindowHits}/${windowRays} window rays encountered opaque bodywork`);
if(blockedOpenDoors)fail(`${blockedOpenDoors}/${doorRays} open doorways remained visually blocked`);

const graph=buildRoadGraph(),cityScene=new THREE.Scene(),city=new CityBuilder(cityScene,graph),built=city.build();city.initializeStreaming(new THREE.Vector3(-330,0,5),0,0);
const input={mouseDX:140,mouseDY:-45,isDown:()=>false,consume:()=>false},camera=new THREE.PerspectiveCamera(),rail=new RailSystem(cityScene,camera,input,graph,built.chunkManager,built.railPlan,()=>{},built.colliders),train=rail.trains[0],coach=train.formation.vehicles.find(vehicle=>vehicle.userData.type==='mark3-coach');
rail.updateTrainPlacement(train);rail.playerTrain=train;rail.playerTrainMode='passenger';rail.passengerState={train,vehicle:coach,vehicleIndex:train.formation.vehicles.indexOf(coach),localPosition:new THREE.Vector3(0,coach.userData.interior.floorY,0),yaw:0,pitch:0,rideTime:0};rail.pendingPassengerLookDX=140;rail.pendingPassengerLookDY=-45;
const player={inTrain:true,inVehicle:false,inBus:false,walkYaw:0,position:new THREE.Vector3()},beforeYaw=rail.passengerState.yaw;
if(!rail.wantsPointerLock())fail('Passenger mode does not request pointer lock');
rail.updatePassengerRide(train,1/60,player);const afterYaw=rail.passengerState.yaw,afterPitch=rail.passengerState.pitch;
rail.updatePassengerRide(train,1/60,player);if(Math.abs(afterYaw-beforeYaw)<.1||Math.abs(afterPitch)<.01)fail('Passenger look input did not rotate the camera');
const repeatedDelta=rail.passengerState.yaw-afterYaw;if(Math.abs(repeatedDelta)>1e-9)fail('Mouse delta repeated across fixed simulation steps');

rail.playerTrain=null;rail.playerTrainMode=null;rail.passengerState=null;built.chunkManager.neighbourhoodKeys.add(chunkKeyForPosition(train.headPosition,built.chunkManager.chunkSize));
const rearCoach=train.formation.vehicles.filter(vehicle=>vehicle.userData.type==='mark3-coach').at(-1),lodPlayer={inVehicle:true,position:rearCoach.position.clone()};rail.updateTrainVisibility(train,lodPlayer);
if(!rearCoach.userData.interiorGroup.visible)fail('Nearby rear coach interior was hidden by train-head LOD');

const result={
  passed:true,
  coaches:coaches.length,
  transparentWindowRays:windowRays,
  opaqueWindowHits,
  openDoorwayRays:doorRays,
  blockedOpenDoors,
  passengerEyeY:coaches[0].userData.interior.eyeY,
  windowBottom:coaches[0].userData.interior.windowBottom,
  windowTop:coaches[0].userData.interior.windowTop,
  pointerLockRequested:true,
  yawChangeRadians:afterYaw-beforeYaw,
  pitchChangeRadians:afterPitch,
  repeatedDeltaRadians:repeatedDelta,
  nearbyRearCoachInteriorVisible:rearCoach.userData.interiorGroup.visible,
  trainInteriorDistance:CONFIG.trainInteriorDistance
};
const output=process.argv[2]??'benchmarks/train-interior-visibility-validation.json';fs.writeFileSync(output,JSON.stringify(result,null,2));
console.log(`Train interior visibility validation passed: ${windowRays} transparent window rays, ${doorRays} clear open-door rays, passenger mouse-look active.`);
