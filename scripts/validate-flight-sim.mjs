import * as THREE from "three";
import { buildRoadGraph } from "../src/world/CityPlan.js?v=20261002-flight-sim-terrain";
import { WORLD_DEFINITION } from "../src/world/WorldDefinition.js?v=20261002-flight-sim-terrain";
import { CityBuilder } from "../src/world/CityBuilder.js?v=20261002-flight-sim-terrain";
import { AirportSystem } from "../src/systems/AirportSystem.js?v=20261002-flight-sim-terrain";

const fail=message=>{throw new Error(message);};
const down=new Set(),input={isDown:key=>down.has(key),consume:()=>false,mouseDX:0,mouseDY:0};
const scene=new THREE.Scene(),camera=new THREE.PerspectiveCamera(),graph=buildRoadGraph(WORLD_DEFINITION),city=new CityBuilder(scene,graph,WORLD_DEFINITION),built=city.build(),airport=new AirportSystem(scene,WORLD_DEFINITION,built.chunkManager,camera,input,()=>{}),aircraft=airport.aircraft[0];

function resetFlight({speed=60,altitude=100}={}){
  down.clear();aircraft.manualControl=true;aircraft.state="manual";aircraft.manualAirborne=true;aircraft.simPosition.set(0,altitude,0);aircraft.speed=speed;aircraft.heading=0;aircraft.bank=0;aircraft.pitch=0;aircraft.angleOfAttack=THREE.MathUtils.degToRad(3);aircraft.manualThrottle=.55;aircraft.manualEnginePower=.55;aircraft.manualVerticalSpeed=0;aircraft.manualRollRate=0;aircraft.manualSideslip=0;aircraft.manualElevator=0;
  airport.passengerState={aircraft,pilot:true,seated:true,cameraIndex:0,localPosition:new THREE.Vector3(),yaw:0,pitch:0,rideTime:0};
}
function step(seconds){for(let i=0;i<Math.round(seconds*60);i++)airport.updateManualAircraft(aircraft,1/60);}

resetFlight();const initialThrottle=aircraft.manualThrottle;down.add("Tab");step(1.0);down.clear();if(!(aircraft.manualThrottle>initialThrottle+.20))fail("Tab did not increase aircraft throttle");const throttleAfterTab=aircraft.manualThrottle;
down.add("ShiftLeft");step(.8);down.clear();if(!(aircraft.manualThrottle<throttleAfterTab-.20))fail("Shift did not decrease aircraft throttle");

resetFlight();down.add("KeyD");step(2.5);down.clear();
const rightHeading=aircraft.heading,rightBank=THREE.MathUtils.radToDeg(aircraft.bank),rightTrack=aircraft.simPosition.x;
const rightWingY=new THREE.Vector3(1,0,0).applyQuaternion(aircraft.simQuaternion).y,leftWingYOnRight=new THREE.Vector3(-1,0,0).applyQuaternion(aircraft.simQuaternion).y;
if(!(rightHeading>0&&rightTrack>0&&rightBank<0&&rightWingY<leftWingYOnRight))fail(`D did not bank/turn right: hdg ${rightHeading}, x ${rightTrack}, bank ${rightBank}`);

resetFlight();down.add("KeyA");step(2.5);down.clear();
const leftHeading=aircraft.heading,leftBank=THREE.MathUtils.radToDeg(aircraft.bank),leftTrack=aircraft.simPosition.x;
const rightWingYOnLeft=new THREE.Vector3(1,0,0).applyQuaternion(aircraft.simQuaternion).y,leftWingY=new THREE.Vector3(-1,0,0).applyQuaternion(aircraft.simQuaternion).y;
if(!(leftHeading<0&&leftTrack<0&&leftBank>0&&leftWingY<rightWingYOnLeft))fail(`A did not bank/turn left: hdg ${leftHeading}, x ${leftTrack}, bank ${leftBank}`);

resetFlight();down.add("KeyW");step(1.5);down.clear();const noseDownPitch=aircraft.pitch,noseDownElevator=aircraft.manualElevator;
if(!(noseDownElevator<-.7&&noseDownPitch>0))fail(`W did not command nose down: elevator ${noseDownElevator}, pitch ${noseDownPitch}`);
resetFlight();down.add("KeyS");step(1.5);down.clear();const noseUpPitch=aircraft.pitch,noseUpElevator=aircraft.manualElevator;
if(!(noseUpElevator>.7&&noseUpPitch<0))fail(`S did not command nose up: elevator ${noseUpElevator}, pitch ${noseUpPitch}`);

resetFlight();step(1.0);const baseline={heading:aircraft.heading,bank:aircraft.bank,elevator:aircraft.manualElevator,sideslip:aircraft.manualSideslip,throttle:aircraft.manualThrottle};
resetFlight();for(const key of["ArrowLeft","ArrowRight","ArrowUp","ArrowDown"])down.add(key);step(1.0);down.clear();
if(Math.abs(aircraft.heading-baseline.heading)>1e-8||Math.abs(aircraft.bank-baseline.bank)>1e-8||Math.abs(aircraft.manualElevator-baseline.elevator)>1e-8||Math.abs(aircraft.manualSideslip-baseline.sideslip)>1e-8||Math.abs(aircraft.manualThrottle-baseline.throttle)>1e-8)fail("arrow keys still affect aircraft movement");

resetFlight({speed:27,altitude:100});down.add("KeyS");step(4);down.clear();const state=airport.getPlayerState();if(!(state.aoaDeg>13.5&&state.verticalSpeed<0&&state.stallWarning))fail(`stall behaviour missing: AoA ${state.aoaDeg.toFixed(1)}, VS ${state.verticalSpeed.toFixed(1)}`);

const fullModel=aircraft.mesh.userData.lodGroups?.full,fuselage=fullModel?.getObjectByName("aircraft-fuselage");
if(!fuselage?.geometry?.getAttribute("uv"))fail("independent fuselage is missing generated UVs");
if(!fuselage?.material?.map?.isDataTexture)fail("independent runtime DataTexture livery is missing");
if(!fullModel?.getObjectByName("aircraft-sidestick-grip"))fail("A320-style sidestick detail is missing");
if(fullModel?.getObjectByName("aircraft-control-yoke"))fail("obsolete generic yoke remains in independent cockpit model");
for(const tier of["full","medium","low","far"])if(!aircraft.mesh.userData.lodGroups?.[tier])fail(`missing independently generated ${tier} aircraft LOD`);
const expectedSpan=15.1*(35.80/37.57);if(Math.abs((aircraft.mesh.userData.width??0)-expectedSpan)>.03)fail("aircraft span no longer follows the documented public A320neo span:length ratio");
let fields=0,barns=0,hedges=0,cockpitDetails=0;scene.traverse(object=>{if(object.name==="eastmere-farm-field")fields++;if(object.name==="eastmere-farm-barn")barns++;if(object.name==="eastmere-field-hedge")hedges++;if(object.name?.startsWith("aircraft-cockpit-")||object.name?.includes("ecam")||object.name?.includes("fcu")||object.name?.includes("pedestal")||object.name?.includes("rudder-pedal")||object.name?.includes("overhead-switch")||object.name?.includes("sidestick")||object.name?.includes("mcdu"))cockpitDetails++;});
let trees=0;for(const chunk of built.chunkManager.chunks.values())trees+=chunk.props.crowns.length;
if(fields<12||barns<2||hedges<30||trees<100)fail(`rural scenery too sparse: fields ${fields}, barns ${barns}, hedges ${hedges}, trees ${trees}`);
if(cockpitDetails<45)fail(`cockpit detail regression: only ${cockpitDetails} named detail objects`);
const mainland=scene.getObjectByName("eastmere-mainland"),ocean=scene.getObjectByName("regional-sea");if(!mainland?.material?.map||!ocean?.material?.map||!ocean?.material?.bumpMap)fail("terrain/water procedural texture maps are missing");
console.log(`Flight-sim validation passed: A/D headings ${THREE.MathUtils.radToDeg(leftHeading).toFixed(1)}°/${THREE.MathUtils.radToDeg(rightHeading).toFixed(1)}°, banks ${leftBank.toFixed(1)}°/${rightBank.toFixed(1)}°, W/S pitches ${THREE.MathUtils.radToDeg(noseDownPitch).toFixed(1)}°/${THREE.MathUtils.radToDeg(noseUpPitch).toFixed(1)}°, throttle ${initialThrottle.toFixed(2)}→${throttleAfterTab.toFixed(2)}, arrows inert, stall AoA ${state.aoaDeg.toFixed(1)}° VS ${state.verticalSpeed.toFixed(1)} m/s, ${cockpitDetails} cockpit details.`);
