import * as THREE from 'three';

const interactionPrompt={hidden:true,dataset:{},querySelector:()=>({textContent:''})};
globalThis.document={getElementById:id=>id==='interaction-prompt'?interactionPrompt:null,pointerLockElement:null};
globalThis.window={};
globalThis.localStorage={getItem:()=>null,setItem:()=>{}};
globalThis.addEventListener=()=>{};

const [{buildRoadGraph},{WORLD_DEFINITION,validateWorldDefinition},{analyseRoadNetwork},{CityBuilder},{PlayerController},{RailSystem},{analyseRoadRailLayout},{TrafficSignals},{TrafficSystem},{TransitSystem},{VehicleCollisionSystem},{IncidentSystem},{PedestrianSystem},{PoliceSystem},{AirportSystem}]=await Promise.all([
  import('../src/world/CityPlan.js'),import('../src/world/WorldDefinition.js'),import('../src/road/RoadQuality.js'),import('../src/world/CityBuilder.js'),import('../src/player/PlayerController.js'),import('../src/rail/RailSystem.js'),import('../src/rail/RailPlan.js'),import('../src/systems/TrafficSignals.js'),import('../src/systems/TrafficSystem.js'),import('../src/systems/TransitSystem.js'),import('../src/systems/VehicleCollisionSystem.js'),import('../src/systems/IncidentSystem.js'),import('../src/systems/PedestrianSystem.js'),import('../src/systems/PoliceSystem.js'),import('../src/systems/AirportSystem.js')
]);

const fail=message=>{throw new Error(message);};
const input={down:new Set(),mouseDX:0,isDown(key){return this.down.has(key);},consume(){return false;}};
const scene=new THREE.Scene(),camera=new THREE.PerspectiveCamera(),graph=buildRoadGraph(WORLD_DEFINITION);
const definitionErrors=validateWorldDefinition(WORLD_DEFINITION,{graph});if(definitionErrors.length)fail(definitionErrors.join('; '));
const roadQuality=analyseRoadNetwork(graph);if(roadQuality.errors.length)fail(roadQuality.errors.join('; '));
const city=new CityBuilder(scene,graph,WORLD_DEFINITION),built=city.build();city.initializeStreaming(new THREE.Vector3(-330,0,5),Math.PI/2,12);
const railErrors=analyseRoadRailLayout(built.railPlan,graph,WORLD_DEFINITION);if(railErrors.length)fail(railErrors.join('; '));
const player=new PlayerController(scene,camera,input,graph,built.colliders,()=>{}),rail=new RailSystem(scene,camera,input,graph,built.chunkManager,built.railPlan,()=>{},built.colliders);player.setRailSystem(rail);
const parkedCar=player.vehicle.position.clone();player.toggleMode();const walkingStart=camera.position.clone();input.down.add('KeyW');for(let i=0;i<60;i++)player.update(1/60,i/60,'clear');input.down.delete('KeyW');
if(player.vehicle.position.distanceTo(parkedCar)>1e-6)fail('parked player car followed the walking player after exit');
if(camera.position.distanceTo(walkingStart)<4)fail('player did not walk independently after leaving the car');
camera.position.copy(player.vehicle.position).add(new THREE.Vector3(1,1.72,0));player.toggleMode();if(!player.inVehicle||player.position.distanceTo(player.vehicle.position)>1e-6)fail('player could not re-enter the parked car at its actual position');
const signals=new TrafficSignals(scene,graph),traffic=new TrafficSystem(scene,graph,signals,player);traffic.setChunkManager(built.chunkManager);traffic.setRailSystem(rail);traffic.populate(32);
const transit=new TransitSystem(scene,graph,traffic,camera,input,player,()=>{},rail),collisions=new VehicleCollisionSystem(scene,player,traffic,()=>{}),incidents=new IncidentSystem(scene,graph,traffic,player,()=>{}),airport=new AirportSystem(scene,WORLD_DEFINITION,built.chunkManager),police=new PoliceSystem(scene,graph,traffic,signals,player,()=>{}),pedestrians=new PedestrianSystem(scene,graph,signals);
traffic.setIncidentSystem(incidents);police.setCollisionSystem(collisions);police.setAirportSystem(airport);pedestrians.setChunkManager(built.chunkManager);pedestrians.setTrafficSystem(traffic);pedestrians.setRailSystem(rail);pedestrians.setIncidentSystem(incidents);pedestrians.setPoliceSystem(police);pedestrians.populate(48);

for(let step=0;step<360;step++){
  const dt=1/60,time=step*dt;signals.update(dt);rail.update(dt,time,player);if(step%6===0){traffic.update(.1,time);transit.update(.1,time);pedestrians.update(.1,time,'clear');}collisions.update(dt,time);police.update(dt,time);airport.update(dt,time);incidents.update(dt);
}

const train=rail.trains[0],station=built.railPlan.stations[0];train.manual=false;train.progress=station.t;train.speed=0;train.currentStation=station;train.nextStation=station;train.dwell=12;train.dwellTotal=12;
for(let i=0;i<90;i++)rail.update(1/60,6+i/60,player);
if(!train.doorsOpen)fail('passenger doors did not open at the station');
const coach=train.formation.vehicles.find(vehicle=>vehicle.userData.type==='mark3-coach'),door=coach.userData.passengerDoors.find(item=>item.side===train.platformSide);
camera.position.copy(rail.doorWorldPosition(coach,door,.72));camera.position.y+=.65;player.inVehicle=false;
const candidate=rail.nearestBoardableTrain(camera.position);if(candidate?.access!=='passenger')fail('open passenger door could not be boarded');
if(!rail.handleInteract(player)||rail.playerTrainMode!=='passenger')fail('passenger boarding failed');
const before=camera.position.clone();train.currentStation=null;train.dwell=0;train.manual=true;train.speed=13;
for(let i=0;i<90;i++)rail.update(1/60,8+i/60,player);
if(camera.position.distanceTo(before)<4)fail('passenger was not carried with the moving train');
if(!Number.isFinite(camera.position.x+camera.position.y+camera.position.z))fail('passenger camera became invalid');

train.manual=false;train.progress=station.t;train.speed=0;train.currentStation=station;train.dwell=10;train.nextStation=station;rail.passengerState.localPosition.z=door.z;
for(let i=0;i<90;i++)rail.update(1/60,10+i/60,player);
if(!rail.handleInteract(player)||player.inTrain)fail('passenger could not leave through an open door');
const alightPosition=camera.position.clone(),alightFeet=camera.position.y-1.72,alightSurface=rail.resolveWalkSurface(new THREE.Vector3(camera.position.x,alightFeet,camera.position.z),alightFeet);
if(alightSurface.blocked||Math.abs(alightSurface.height-alightFeet)>.05)fail('passenger was not placed on a valid platform surface after alighting');
input.down.add('KeyW');for(let i=0;i<45;i++)player.updateWalking(1/60);input.down.delete('KeyW');if(camera.position.distanceTo(alightPosition)<1.5)fail('player remained frozen after leaving the passenger carriage');

player.inVehicle=true;player.position.copy(graph.nodes.get('CBD').position);player.speed=24;player.nearestLaneId='A1-Central East:fwd:1';player.nearestLaneT=.4;player.laneAlignment=1;player.roadDistance=0;
if(!police.report('speeding',20,{observed:true}))fail('police did not accept an observed offence');for(let i=0;i<120;i++)police.update(1/60,20+i/60);if(!police.units.length)fail('police response unit was not created');

let invalid=null;scene.traverse(object=>{for(const value of [...object.position.toArray(),...object.quaternion.toArray(),...object.scale.toArray()])if(!Number.isFinite(value))invalid=object.name||object.type;});if(invalid)fail(`invalid scene transform on ${invalid}`);
if(!airport.aircraft.length||!pedestrians.agents.length||!transit.buses.length)fail('an integrated subsystem failed to populate');
console.log(`Integration smoke passed: ${graph.roads.size} roads, ${rail.trains.length} trains, ${traffic.vehicles.length} traffic vehicles, ${pedestrians.agents.length} pedestrians, ${airport.aircraft.length} aircraft, ${police.units.length} police unit(s).`);
process.exit(0);
