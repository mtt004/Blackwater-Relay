import * as THREE from "three";
import { WORLD_DEFINITION } from "../src/world/WorldDefinition.js?v=20261002-flight-sim-terrain";
import { CONFIG } from "../src/config.js?v=20261002-flight-sim-terrain";
import { AirportSystem } from "../src/systems/AirportSystem.js?v=20261002-flight-sim-terrain";

const fail=message=>{throw new Error(message);};
const expect=(condition,message)=>{if(!condition)fail(message);};
const idleInput={isDown:()=>false,consume:()=>false,mouseDX:0,mouseDY:0};
function mutableInput(){const down=new Set();return{down,isDown:key=>down.has(key),consume:key=>down.delete(key),mouseDX:0,mouseDY:0};}

function createAirport(input=idleInput){return new AirportSystem(new THREE.Scene(),WORLD_DEFINITION,null,new THREE.PerspectiveCamera(),input,()=>{});}
function setManualFlight(airport,aircraft,{speed=60,altitude=210,throttle=1}={}){
  aircraft.manualControl=true;aircraft.state="manual";aircraft.currentAirportId=null;aircraft.standIndex=null;aircraft.gateIndex=null;aircraft.parkedPosition=null;aircraft.manualAirborne=true;aircraft.simPosition.set(0,altitude,0);aircraft.previousSimPosition.copy(aircraft.simPosition);aircraft.speed=speed;aircraft.heading=0;aircraft.bank=0;aircraft.pitch=0;aircraft.angleOfAttack=THREE.MathUtils.degToRad(3);aircraft.manualThrottle=throttle;aircraft.manualEnginePower=throttle;aircraft.manualReversePower=0;aircraft.manualBrakePressure=0;aircraft.manualVerticalSpeed=0;aircraft.manualRollRate=0;aircraft.manualSideslip=0;aircraft.manualElevator=0;aircraft.groundServices={stairs:{state:null,progress:0,timer:0},jetway:{state:null,progress:0,timer:0}};
  airport.passengerState={aircraft,pilot:true,seated:true,cameraIndex:0,localPosition:new THREE.Vector3(),yaw:0,pitch:0,rideTime:0};
}
function stepManual(airport,aircraft,seconds,hz=60){const dt=1/hz;for(let i=0;i<Math.round(seconds*hz);i++)airport.updateManualAircraft(aircraft,dt);}
function stepService(airport,aircraft,seconds,hz=60){const dt=1/hz;for(let i=0;i<Math.round(seconds*hz);i++)airport.updateGroundServices(aircraft,dt);airport.updateGateDockVisibility();}

// Shared cruise target and progressive manual acceleration.
{
  const airport=createAirport(),aircraft=airport.aircraft[5],cruise=airport.resolvedCruiseSpeed(),expected=WORLD_DEFINITION.aviation.cruiseSpeed*CONFIG.aircraftSpeedMultiplier;
  expect(Math.abs(cruise-expected)<1e-9,`shared cruise target mismatch: ${cruise} vs ${expected}`);
  expect(Math.abs(airport.targetSpeedFor(aircraft)-cruise)<1e-9,`autopilot enroute target is not using shared cruise speed: ${airport.targetSpeedFor(aircraft)} vs ${cruise}`);
  setManualFlight(airport,aircraft,{speed:60,altitude:210,throttle:1});const start=aircraft.speed;stepManual(airport,aircraft,5);const afterFive=aircraft.speed;
  expect(afterFive>start+10,"manual aircraft no longer accelerates decisively at full throttle");expect(afterFive<cruise-1,"manual aircraft jumps to cruise speed instead of accelerating progressively");
  stepManual(airport,aircraft,25);expect(aircraft.speed>=cruise*.985,`manual aircraft still takes too long to reach shared cruise performance: ${aircraft.speed.toFixed(2)} vs ${cruise.toFixed(2)}`);expect(aircraft.speed<=cruise+1e-6,"manual aircraft exceeded shared cruise cap");expect(Math.abs(aircraft.manualVerticalSpeed)<.8,`neutral cruise does not settle vertically: ${aircraft.manualVerticalSpeed.toFixed(2)} m/s`);
}

// Fixed-step independence: distance and speed should be effectively the same at 30/60/120 Hz.
{
  const airport=createAirport(),aircraft=airport.aircraft[5],runs=[];
  for(const hz of[30,60,120]){setManualFlight(airport,aircraft,{speed:100,altitude:210,throttle:1});stepManual(airport,aircraft,60,hz);runs.push({hz,speed:aircraft.speed,distance:Math.hypot(aircraft.simPosition.x,aircraft.simPosition.z),altitude:aircraft.simPosition.y});}
  const speeds=runs.map(run=>run.speed),distances=runs.map(run=>run.distance),speedSpread=Math.max(...speeds)-Math.min(...speeds),distanceSpread=Math.max(...distances)-Math.min(...distances),meanDistance=distances.reduce((a,b)=>a+b,0)/distances.length;
  expect(speedSpread<.08,`manual speed is frame-rate dependent: ${JSON.stringify(runs)}`);expect(distanceSpread/meanDistance<.001,`manual distance is frame-rate dependent: ${JSON.stringify(runs)}`);
}

// Taking manual control must preserve the current physical speed instead of multiplying/dividing it.
{
  const airport=createAirport(),aircraft=airport.aircraft[5],before=aircraft.speed;airport.beginManualControl(aircraft);expect(Math.abs(aircraft.speed-before)<1e-12,"entering manual control changes aircraft speed");expect(Math.abs(aircraft.manualThrottle-before/airport.resolvedCruiseSpeed())<1e-9,"manual throttle is not initialized from the shared cruise envelope");
}


// Ground inertia: touchdown speed is preserved, wheel brakes build pressure, and reverse thrust is ground-only.
{
  const input=mutableInput(),airport=createAirport(input),aircraft=airport.aircraft[5];
  aircraft.manualControl=true;aircraft.state="manual";aircraft.manualAirborne=false;aircraft.simPosition.set(0,.18,0);aircraft.previousSimPosition.copy(aircraft.simPosition);aircraft.speed=65;aircraft.heading=0;aircraft.bank=0;aircraft.pitch=0;aircraft.angleOfAttack=0;aircraft.manualThrottle=0;aircraft.manualEnginePower=0;aircraft.manualReversePower=0;aircraft.manualBrakePressure=0;aircraft.manualVerticalSpeed=0;aircraft.manualRollRate=0;aircraft.manualSideslip=0;aircraft.manualElevator=0;aircraft.currentAirportId=null;aircraft.standIndex=null;aircraft.gateIndex=null;aircraft.parkedPosition=null;airport.passengerState={aircraft,pilot:true,seated:true,cameraIndex:0,localPosition:new THREE.Vector3(),yaw:0,pitch:0,rideTime:0};
  airport.updateManualAircraft(aircraft,1/60);expect(aircraft.speed>64.8,`touchdown momentum was hard-clamped: ${aircraft.speed.toFixed(2)} m/s`);
  input.down.add("Space");stepManual(airport,aircraft,.10);input.down.delete("Space");expect(aircraft.manualBrakePressure>0&&aircraft.manualBrakePressure<.25,"wheel brake pressure should build progressively");expect(aircraft.speed>63.5,"wheel brakes still remove speed nearly instantaneously");
  const beforeReverse=aircraft.speed;input.down.add("KeyR");stepManual(airport,aircraft,2);input.down.delete("KeyR");expect(aircraft.manualReversePower>.8,"reverse thrust did not spool up on the ground");expect(aircraft.speed<beforeReverse-3,"reverse thrust did not produce meaningful rollout deceleration");expect(aircraft.speed>beforeReverse-12,"reverse thrust stops the aircraft unrealistically quickly");
  aircraft.manualAirborne=true;aircraft.simPosition.y=120;aircraft.manualReversePower=0;input.down.add("KeyR");stepManual(airport,aircraft,1);input.down.delete("KeyR");expect(aircraft.manualReversePower===0,"reverse thrust can deploy while airborne");
}

// AI landing roll should also keep inertia and use reversers instead of an extreme speed snap.
{
  const airport=createAirport(),aircraft=airport.aircraft[6];aircraft.state="landingRoll";aircraft.progress=.1;aircraft.speed=60;aircraft.reverseThrust=0;const target=airport.targetSpeedFor(aircraft);airport.updateAircraftSpeed(aircraft,1,target);
  expect(aircraft.speed>55,"AI landing roll still decelerates at the old near-instantaneous rate");expect(aircraft.reverseThrust>.9,"AI reversers did not deploy during landing roll");
}

// Eastmere jetway: player aircraft retains/claims the stand, connects to the correct aircraft, opens the door and retracts.
{
  const airport=createAirport(),aircraft=airport.aircraft[0];airport.beginManualControl(aircraft);aircraft.speed=0;aircraft.manualAirborne=false;aircraft.simPosition.copy(aircraft.parkedPosition);airport.passengerState={aircraft,pilot:true,seated:true,cameraIndex:0,localPosition:new THREE.Vector3(),yaw:0,pitch:0,rideTime:0};
  expect(airport.groundServiceEligibility(aircraft,"jetway").available,"jetway should be available to a stopped manual aircraft at its Eastmere gate");airport.toggleGroundServiceForPlayer("jetway");stepService(airport,aircraft,2);
  expect(airport.groundServiceState(aircraft,"jetway").state==="CONNECTED","manual jetway did not reach CONNECTED state");expect(aircraft.doorsOpen,"manual jetway connection did not open the aircraft door");expect(airport.openAircraftAtGate(aircraft.standIndex)===aircraft,"jetway connected to the wrong aircraft");expect(airport.gateWalkways[aircraft.standIndex].dockGroup.visible,"connected manual jetway is not visible");expect(airport.aircraftHasConnectedGroundService(aircraft),"connected service was not exposed to passenger access logic");
  const player={inVehicle:false,inTrain:false,inBus:false,inAircraft:true,camera:new THREE.PerspectiveCamera(),position:new THREE.Vector3(),walkYaw:0,walkPitch:0,input:idleInput,releaseToWalking(worldFeet,yaw){this.inAircraft=false;this.camera.position.set(worldFeet.x,worldFeet.y+1.72,worldFeet.z);this.position.set(worldFeet.x,.05,worldFeet.z);this.walkYaw=yaw;}};airport.passengerState.pilot=false;airport.passengerState.seated=false;airport.passengerState.localPosition.set(.25,aircraft.mesh.userData.cabinFloorY,3.7);expect(airport.passengerNearDoor(airport.passengerState),"manual aircraft door cannot be used after the jetway connects");expect(airport.detachPassenger(player),"player could not leave the manually controlled aircraft through the connected jetway");expect(!player.inAircraft&&!airport.passengerState,"player remained attached after leaving through the jetway");aircraft.mesh.updateWorldMatrix(true,false);player.camera.position.copy(aircraft.mesh.localToWorld(new THREE.Vector3(1.20,(aircraft.mesh.userData.cabinFloorY??1.15)+1.72,aircraft.mesh.userData.doorLocalZ??4.35)));airport.update(0,0,player);expect(player.inAircraft&&airport.passengerState?.aircraft===aircraft,"player could not re-board the manually controlled aircraft while the jetway remained connected");airport.passengerState.pilot=true;
  airport.toggleGroundServiceForPlayer("jetway");stepService(airport,aircraft,1.2);expect(airport.groundServiceState(aircraft,"jetway").state===null,"manual jetway did not fully retract");expect(!aircraft.doorsOpen,"aircraft door remained open after jetway retraction");
}

// Merehaven stairs use the same manual-service path, while incompatible service types remain unavailable.
{
  const airport=createAirport(),aircraft=airport.aircraft[2];airport.beginManualControl(aircraft);aircraft.speed=0;aircraft.manualAirborne=false;aircraft.simPosition.copy(aircraft.parkedPosition);airport.passengerState={aircraft,pilot:true,seated:true,cameraIndex:0,localPosition:new THREE.Vector3(),yaw:0,pitch:0,rideTime:0};
  expect(airport.groundServiceEligibility(aircraft,"stairs").available,"passenger stairs should be available to a stopped manual aircraft at Merehaven");expect(!airport.groundServiceEligibility(aircraft,"jetway").available,"airbridge should not be available at the Merehaven stairs stand");airport.toggleGroundServiceForPlayer("stairs");stepService(airport,aircraft,2);
  expect(airport.groundServiceState(aircraft,"stairs").state==="CONNECTED","manual stairs did not reach CONNECTED state");expect(airport.aircraftAtIslandStand(aircraft.standIndex)===aircraft,"stairs connected to the wrong aircraft");expect(airport.islandStairs[aircraft.standIndex].group.visible,"connected passenger stairs are not visible");
}

// Safety/ownership: airborne and occupied-stand requests are rejected.
{
  const airport=createAirport(),islandAircraft=airport.aircraft[2];airport.beginManualControl(islandAircraft);islandAircraft.manualAirborne=true;islandAircraft.simPosition.y=20;islandAircraft.speed=0;expect(!airport.groundServiceEligibility(islandAircraft,"stairs").available,"airborne aircraft can request passenger stairs");
  const intruder=airport.aircraft[1],occupied=airport.parkedPositionFor(airport.definition,0);airport.beginManualControl(intruder);intruder.manualAirborne=false;intruder.speed=0;intruder.simPosition.copy(occupied);const eligibility=airport.groundServiceEligibility(intruder,"jetway");expect(!eligibility.available&&/occupied/i.test(eligibility.reason),`occupied jetway stand was not rejected: ${eligibility.reason}`);
}

console.log("Manual-flight/ground-services validation passed: shared cruise envelope, faster full-throttle acceleration, 30/60/120 Hz consistency, progressive wheel braking, touchdown inertia, manual/AI reverse thrust, speed-preserving handoff, player jetway/stairs connection, retraction, airborne rejection, and stand ownership.");
