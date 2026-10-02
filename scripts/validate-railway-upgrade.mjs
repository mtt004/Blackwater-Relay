import * as THREE from "three";

globalThis.document={getElementById:()=>null,pointerLockElement:null};
globalThis.window={};
globalThis.localStorage={getItem:()=>null,setItem:()=>{}};
globalThis.addEventListener=()=>{};

const [{buildRoadGraph},{CityBuilder},{RailSystem},{PlayerController},{WORLD_DEFINITION,validateWorldDefinition},{analyseRoadRailLayout}]=await Promise.all([
  import("../src/world/CityPlan.js?v=20261002-flight-sim-terrain"),
  import("../src/world/CityBuilder.js?v=20261002-flight-sim-terrain"),
  import("../src/rail/RailSystem.js?v=20261002-flight-sim-terrain"),
  import("../src/player/PlayerController.js?v=20261002-flight-sim-terrain"),
  import("../src/world/WorldDefinition.js?v=20261002-flight-sim-terrain"),
  import("../src/rail/RailPlan.js?v=20261002-flight-sim-terrain")
]);

function assert(value,message){if(!value)throw new Error(message);}
function finiteVector(vector){return Number.isFinite(vector.x)&&Number.isFinite(vector.y)&&Number.isFinite(vector.z);}

const scene=new THREE.Scene(),camera=new THREE.PerspectiveCamera(),graph=buildRoadGraph(),builder=new CityBuilder(scene,graph),built=builder.build();
builder.initializeStreaming(new THREE.Vector3(0,0,0),0,0);
const input={down:new Set(),mouseDX:0,mouseDY:0,isDown(key){return this.down.has(key);},consume:()=>false};
const player=new PlayerController(scene,camera,input,graph,built.colliders,()=>{}),rail=new RailSystem(scene,camera,input,graph,built.chunkManager,built.railPlan,()=>{},built.colliders);player.setRailSystem(rail);

const definitionErrors=validateWorldDefinition(WORLD_DEFINITION,{graph,railPlan:built.railPlan});assert(!definitionErrors.length,definitionErrors.join("; "));
const layoutErrors=analyseRoadRailLayout(built.railPlan,graph,WORLD_DEFINITION);assert(!layoutErrors.length,layoutErrors.join("; "));
assert(rail.crossings.length===0,"level crossings remain");
assert(rail.supportClearanceViolations.length===0,"bridge supports obstruct a road, pavement or structure");

let routeSamples=0,maximumGradient=0;
for(const route of rail.routes){
  assert(route.curve.closed,`${route.name} is not closed`);
  assert(route.curve.getPointAt(0).distanceTo(route.curve.getPointAt(1))<.01,`${route.name} does not close`);
  assert(route.geometry.selfIntersections===0,`${route.name} self-intersects`);
  assert(route.geometry.minimumRadius>=route.minimumDesignRadius,`${route.name} has a substandard curve radius`);
  for(const direction of[-1,1])for(let index=0;index<=2600;index++){
    const t=direction>0?index/2600:1-index/2600,position=route.curve.getPointAt(t),tangent=route.curve.getTangentAt(t);
    assert(finiteVector(position)&&finiteVector(tangent),`${route.name} produced an invalid transform`);
    assert(Math.abs(tangent.length()-1)<.02,`${route.name} tangent is not normalised`);
    maximumGradient=Math.max(maximumGradient,Math.abs(tangent.y));routeSamples++;
  }
  for(const bridge of route.gradeSeparations){
    assert(bridge.type==="rail-over-road",`${bridge.id} is not a bridge`);
    assert(bridge.clearance>=route.gradePolicy.minimumRoadClearance,`${bridge.id} has insufficient road clearance`);
  }
}
assert(maximumGradient<=WORLD_DEFINITION.rail.gradeSeparation.maximumGradient+.002,`maximum railway gradient ${(maximumGradient*100).toFixed(2)}% exceeds policy`);

const airportRoute=rail.routeById.get("airport"),cityRoute=rail.routeById.get("city"),airportStation=airportRoute.stations.find(station=>station.airport),airportJunction=airportRoute.stations.find(station=>station.sharedPhysicalStationId),cityJunction=cityRoute.stations.find(station=>station.id===airportJunction.sharedPhysicalStationId);
assert(airportStation&&airportStation.terminalLinkLength>100,"airport station terminal connection is incomplete");
assert(airportStation.headingChange<.1&&airportStation.maximumChordDeviation<.05,"airport platform is not straight");
assert(airportJunction.position.distanceTo(cityJunction.position)<.05,"airport junction is not physically connected");
assert(airportJunction.tangent.dot(cityJunction.tangent)>.999,"airport junction is not tangent-aligned");

const service=rail.trains.find(train=>train.routeId==="airport"&&train.throughService),serviceDirection=service.direction,fullFleet=rail.trains;
service.progress=rail.stationStopProgress(service,airportJunction,airportRoute);rail.updateTrainHead(service);const junctionHead=service.headPosition.clone();for(const train of fullFleet)rail.blockSystem.releaseReservations(train.id);rail.trains=[service];rail.blockSystem.updateOccupancy(rail.trains);
assert(rail.maybeTransferAirportService(service,airportJunction),"airport service could not enter the city loop");
assert(service.direction===serviceDirection&&service.headPosition.distanceTo(junctionHead)<.1,"route transfer reversed or displaced the train");
assert(rail.maybeTransferAirportService(service,cityJunction),"airport service could not return to the airport loop");
assert(service.direction===serviceDirection,"return transfer reversed the train");

for(const train of fullFleet)rail.stationOperations.release(train.id);const operationalTrain=fullFleet[0];rail.trains=[operationalTrain];rail.blockSystem.updateOccupancy(rail.trains);for(const other of rail.trains){other.speed=24;other.currentStation=null;}
let stopChecks=0,boardingChecks=0;
for(const route of rail.routes)for(const direction of[-1,1])for(const station of route.stations){
  operationalTrain.route=route;operationalTrain.routeId=route.id;operationalTrain.direction=direction;operationalTrain.trackIndex=direction>0?0:1;operationalTrain.progress=rail.stationStopProgress(operationalTrain,station,route);operationalTrain.currentStation=station;operationalTrain.nextStation=station;operationalTrain.speed=0;operationalTrain.dwell=10;operationalTrain.doorAmount=0;rail.stationOperations.release(operationalTrain.id);assert(rail.stationOperations.allocate(operationalTrain,station,0),`${station.name} platform allocation failed`);rail.stationOperations.occupy(operationalTrain,station);rail.updateTrainPlacement(operationalTrain);
  for(let frame=0;frame<150;frame++)rail.updateTrainDoors(operationalTrain,1/60);
  assert(operationalTrain.doorsOpen,`${route.name}/${station.name} doors did not open`);
  const coaches=operationalTrain.formation.vehicles.filter(vehicle=>vehicle.userData.type==="mark3-coach");
  for(const coach of coaches){
    const openDoors=coach.userData.passengerDoors.filter(door=>(operationalTrain.openDoorSides??[]).includes(door.side)),closedDoors=coach.userData.passengerDoors.filter(door=>!(operationalTrain.openDoorSides??[]).includes(door.side));
    assert(openDoors.length>0&&openDoors.every(door=>door.amount>.95),`${station.name} platform-served door remained closed`);assert(closedDoors.every(door=>door.amount===0),`${station.name} non-platform door opened`);
    for(const platformDoor of openDoors){
      const doorPosition=rail.doorWorldPosition(coach,platformDoor,0),along=doorPosition.clone().sub(station.position).dot(station.tangent);assert(Math.abs(along)<=station.platformLength*.5-1,`${station.name} stop left a door outside the platform`);
      rail.playerTrain=null;rail.playerTrainMode=null;rail.passengerState=null;player.inVehicle=false;player.inTrain=false;player.inBus=false;camera.position.copy(rail.doorWorldPosition(coach,platformDoor,.72)).add(new THREE.Vector3(0,.65,0));
      assert(rail.handleInteract(player),`${station.name} coach ${coach.userData.index+1} side ${platformDoor.side} could not be boarded`);assert(rail.playerTrainMode==="passenger",`${station.name} boarded the cab instead of the carriage`);
      rail.passengerState.localPosition.set(platformDoor.side*.72,coach.userData.interior.floorY,platformDoor.z);assert(rail.handleInteract(player),`${station.name} coach ${coach.userData.index+1} side ${platformDoor.side} could not be exited`);
      const feet=new THREE.Vector3(camera.position.x,camera.position.y-1.72,camera.position.z),surface=rail.resolveWalkSurface(feet,feet.y);assert(!surface.blocked&&Math.abs(surface.height-feet.y)<.08,`${station.name} alighting did not reach a platform`);boardingChecks++;
    }
  }
  stopChecks++;
}

// Traverse every Mark 3 coach while the formation moves around the loop.
const movingTrain=operationalTrain,route=cityRoute;movingTrain.route=route;movingTrain.routeId=route.id;movingTrain.direction=1;movingTrain.trackIndex=0;movingTrain.progress=.12;movingTrain.speed=22;movingTrain.currentStation=null;rail.updateTrainPlacement(movingTrain);
const mark3Indexes=movingTrain.formation.vehicles.map((vehicle,index)=>vehicle.userData.type==="mark3-coach"?index:null).filter(index=>index!==null),lastIndex=mark3Indexes.at(-1),lastCoach=movingTrain.formation.vehicles[lastIndex];
rail.playerTrain=movingTrain;rail.playerTrainMode="passenger";player.inTrain=true;player.inVehicle=false;rail.passengerState={train:movingTrain,vehicle:lastCoach,vehicleIndex:lastIndex,localPosition:new THREE.Vector3(0,lastCoach.userData.interior.floorY,lastCoach.userData.interior.halfLength-.2),yaw:0,pitch:0,rideTime:0};input.down.add("KeyW");
const visited=new Set([lastIndex]);for(let frame=0;frame<2600;frame++){
  movingTrain.progress=(movingTrain.progress+movingTrain.speed/60/route.length)%1;rail.updateFullTrainPlacement(movingTrain);rail.updateTrainHead(movingTrain);rail.updatePassengerRide(movingTrain,1/60,player);visited.add(rail.passengerState.vehicleIndex);assert(finiteVector(camera.position),"moving-carriage camera became invalid");
  if(mark3Indexes.every(index=>visited.has(index)))break;
}
input.down.delete("KeyW");assert(mark3Indexes.every(index=>visited.has(index)),`moving passenger could not traverse every carriage (${[...visited].join(",")})`);

console.log(`Railway upgrade validation passed: ${rail.routes.length} closed loops, ${routeSamples} bidirectional route samples, ${rail.gradeSeparations.length} bridges, ${rail.supportLocations.length} safe support pairs, ${stopChecks} station-direction stop checks, ${boardingChecks} carriage boarding/alighting checks, ${visited.size} coaches traversed while moving, maximum gradient ${(maximumGradient*100).toFixed(2)}%.`);
