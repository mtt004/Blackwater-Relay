import * as THREE from "three";
import { WORLD_DEFINITION } from "../src/world/WorldDefinition.js";
import { AirportSystem } from "../src/systems/AirportSystem.js";

function assert(condition,message){if(!condition)throw new Error(message);}
function serviceState(state){return ["parked","turnaround","boarding","prepare"].includes(state);}

function validateFleet(){
  const scene=new THREE.Scene(),airport=new AirportSystem(scene,WORLD_DEFINITION,null);
  assert(WORLD_DEFINITION.airports.length===2,"aviation network must contain exactly two airports");
  assert(airport.aircraft.length===10,"aviation network must contain exactly ten operational aircraft");
  assert(new Set(airport.aircraft.map(aircraft=>aircraft.id)).size===10,"aircraft runtime identities are not unique");
  assert(airport.aircraft.some(aircraft=>aircraft.originAirportId==="eastmere-airport"&&aircraft.destinationAirportId==="merehaven-airport"),"no Eastmere-to-Merehaven service exists at startup");
  assert(airport.aircraft.some(aircraft=>aircraft.originAirportId==="merehaven-airport"&&aircraft.destinationAirportId==="eastmere-airport"),"no Merehaven-to-Eastmere service exists at startup");
  assert(new Set(airport.aircraft.map(aircraft=>aircraft.state)).size>=4,"fleet is not staggered across enough operating phases at startup");

  const minimumAvailability=Object.fromEntries(WORLD_DEFINITION.airports.map(def=>[def.id,Infinity]));
  const lastPositions=new Map(airport.aircraft.map(aircraft=>[aircraft.id,aircraft.mesh.position.clone()]));
  let maximumStep=0;
  for(let tick=0;tick<6000;tick++){
    airport.update(.25,tick*.25);
    for(const def of WORLD_DEFINITION.airports){
      minimumAvailability[def.id]=Math.min(minimumAvailability[def.id],airport.serviceCount(def.id)+airport.inboundSoon(def.id));
      const parked=new Map();
      for(const aircraft of airport.aircraft){
        if(aircraft.currentAirportId!==def.id||!serviceState(aircraft.state))continue;
        assert(aircraft.standIndex!=null,`${aircraft.id} is at ${def.id} without a stand assignment`);
        assert(!parked.has(aircraft.standIndex),`${aircraft.id} overlaps ${parked.get(aircraft.standIndex)} on stand ${aircraft.standIndex} at ${def.id}`);
        parked.set(aircraft.standIndex,aircraft.id);
      }
    }
    for(const [airportId,stands] of airport.standOccupancy){
      const owners=stands.filter(Boolean);assert(new Set(owners).size===owners.length,`duplicate stand reservation detected at ${airportId}`);
    }
    for(const aircraft of airport.aircraft){
      assert(Number.isFinite(aircraft.mesh.position.x)&&Number.isFinite(aircraft.mesh.position.y)&&Number.isFinite(aircraft.mesh.position.z),`${aircraft.id} produced an invalid transform`);
      const previous=lastPositions.get(aircraft.id),step=aircraft.mesh.position.distanceTo(previous);maximumStep=Math.max(maximumStep,step);previous.copy(aircraft.mesh.position);
    }
  }
  assert(airport.completedCycles>=18,`fleet completed only ${airport.completedCycles} airport arrivals during the stress run`);
  assert(airport.aircraft.every(aircraft=>aircraft.cycles>=1),"at least one aircraft never completed a physical point-to-point leg");
  for(const def of WORLD_DEFINITION.airports)assert(minimumAvailability[def.id]>=1,`${def.name} had neither a usable aircraft nor an imminent arrival during the stress run`);
  assert(maximumStep<40,`an aircraft moved ${maximumStep.toFixed(1)} world units in one 0.25 s tick, indicating a teleport/discontinuity`);
  return{cycles:airport.completedCycles,minimumAvailability,maximumStep};
}

function makePassenger(aircraft,camera,input){
  return{inVehicle:false,inTrain:false,inBus:false,inAircraft:false,camera,position:new THREE.Vector3(),walkYaw:aircraft.mesh.rotation.y,walkPitch:0,pendingLookDX:0,pendingLookDY:0,input,releaseToWalking(worldFeet,yaw){this.camera.position.set(worldFeet.x,worldFeet.y+1.72,worldFeet.z);this.position.set(worldFeet.x,.05,worldFeet.z);this.walkYaw=yaw;this.inVehicle=false;this.inTrain=false;this.inBus=false;}};
}

function validatePassengerRoundTrip(){
  const scene=new THREE.Scene(),camera=new THREE.PerspectiveCamera(),input={isDown:()=>false,mouseDX:0,mouseDY:0},airport=new AirportSystem(scene,WORLD_DEFINITION,null,camera,input,()=>{});
  const aircraft=airport.aircraft.find(candidate=>candidate.currentAirportId==="eastmere-airport"&&candidate.state==="turnaround");
  assert(aircraft,"no boardable Eastmere aircraft was available at startup");
  const data=aircraft.mesh.userData,player=makePassenger(aircraft,camera,input);aircraft.mesh.updateWorldMatrix(true,false);camera.position.copy(aircraft.mesh.localToWorld(new THREE.Vector3(0,data.standingEyeY,2.8)));
  assert(airport.attachPassenger(player,aircraft),"could not board the Eastmere aircraft");
  let elapsed=0,distanceTravelled=0,previous=aircraft.mesh.position.clone(),arrivedIsland=false;
  for(let tick=0;tick<1600;tick++){
    airport.update(.25,elapsed,player);elapsed+=.25;distanceTravelled+=aircraft.mesh.position.distanceTo(previous);previous.copy(aircraft.mesh.position);
    assert(player.inAircraft,"player was forced out of the aircraft during the outbound journey");
    if(aircraft.currentAirportId==="merehaven-airport"&&serviceState(aircraft.state)){arrivedIsland=true;break;}
  }
  assert(arrivedIsland,"boarded aircraft did not physically reach Merehaven within the journey window");
  assert(distanceTravelled>9000,`outbound aircraft travelled only ${distanceTravelled.toFixed(0)} world units; route may not be genuinely point-to-point`);

  aircraft.mesh.updateWorldMatrix(true,false);airport.passengerState.localPosition.set(.35,data.cabinFloorY,4.2);
  assert(airport.passengerNearDoor(airport.passengerState),"open arrival door is not usable at Merehaven");
  assert(airport.handleInteract(player)&&!player.inAircraft,"player could not disembark at Merehaven");
  const island=WORLD_DEFINITION.airports.find(def=>def.id==="merehaven-airport");
  assert(Math.hypot(player.position.x-island.x,player.position.z-island.z)<200,"disembarkation did not place the player at the island airport");
  const stairs=airport.walkSurfaces.find(surface=>surface.requiresIslandAircraft&&surface.standIndex===aircraft.standIndex);
  assert(stairs,"arriving island stand has no passenger stairs");
  const midLocal={x:(stairs.from.x+stairs.to.x)*.5,z:(stairs.from.z+stairs.to.z)*.5},forward=new THREE.Vector3(Math.sin(island.heading),0,Math.cos(island.heading)),right=new THREE.Vector3(forward.z,0,-forward.x),stairsWorld=new THREE.Vector3(island.x,(stairs.from.y+stairs.to.y)*.5,island.z).addScaledVector(forward,midLocal.x).addScaledVector(right,midLocal.z);
  assert(airport.resolveWalkSurface(stairsWorld,stairsWorld.y)?.role===stairs.role,"island passenger stairs are not walkable while the aircraft is on stand");

  aircraft.mesh.updateWorldMatrix(true,false);camera.position.copy(aircraft.mesh.localToWorld(new THREE.Vector3(0,data.standingEyeY,2.8)));player.walkYaw=aircraft.mesh.rotation.y;
  assert(airport.attachPassenger(player,aircraft),"could not re-board the returning aircraft at Merehaven");
  let returned=false;for(let tick=0;tick<1900;tick++){airport.update(.25,elapsed,player);elapsed+=.25;if(aircraft.currentAirportId==="eastmere-airport"&&serviceState(aircraft.state)){returned=true;break;}}
  assert(returned,"Merehaven return service did not physically reach Eastmere");
  assert(player.inAircraft,"player did not remain aboard for the complete return flight");
  return{elapsed,aircraftCycles:aircraft.cycles,totalNetworkCycles:airport.completedCycles};
}

const fleet=validateFleet(),passenger=validatePassengerRoundTrip();
console.log(`Aviation validation passed: 10 aircraft, ${fleet.cycles} stress-run arrivals, min service ${Object.values(fleet.minimumAvailability).join("/")}, max 0.25s step ${fleet.maximumStep.toFixed(1)}, repeated passenger round-trip ${passenger.elapsed.toFixed(1)}s.`);
