import * as THREE from "three";
import { RoadGraph } from "../src/road/RoadGraph.js?v=20261002-flight-sim-terrain";
import { chunkKeyForPosition,predictAheadChunk,predictAheadChunks,neighbourhoodKeysForPosition,cardinalNeighbourKeysForChunk } from "../src/world/WorldChunkManager.js?v=20261002-flight-sim-terrain";
import { buildRoadGraph } from "../src/world/CityPlan.js?v=20261002-flight-sim-terrain";
import { WORLD_DEFINITION,pointInWorldBounds,validateWorldDefinition } from "../src/world/WorldDefinition.js?v=20261002-flight-sim-terrain";
import { CityBuilder } from "../src/world/CityBuilder.js?v=20261002-flight-sim-terrain";
import { createVehicleMesh,createVehicleLowMesh,getVehicleDimensions,animateVehicleMesh } from "../src/vehicles/VehicleFactory.js?v=20261002-flight-sim-terrain";
import { getVehicleHitboxProfile,getWorldHitboxPolygons,intersectCompoundHitboxes,getColliderBroadphaseExtents,pointInsideColliderXZ,vehicleIntersectsCollider } from "../src/vehicles/VehicleHitboxes.js?v=20261002-flight-sim-terrain";
import { TrafficSignals } from "../src/systems/TrafficSignals.js?v=20261002-flight-sim-terrain";
import { TrafficSystem } from "../src/systems/TrafficSystem.js?v=20261002-flight-sim-terrain";
import { TransitSystem } from "../src/systems/TransitSystem.js?v=20261002-flight-sim-terrain";
import { PlayerController } from "../src/player/PlayerController.js?v=20261002-flight-sim-terrain";
import { analyseRoadNetwork } from "../src/road/RoadQuality.js?v=20261002-flight-sim-terrain";
import { AirportSystem } from "../src/systems/AirportSystem.js?v=20261002-flight-sim-terrain";
import { PoliceSystem } from "../src/systems/PoliceSystem.js?v=20261002-flight-sim-terrain";
import { PedestrianSystem } from "../src/systems/PedestrianSystem.js?v=20261002-flight-sim-terrain";
import { CONFIG } from "../src/config.js?v=20261002-flight-sim-terrain";
import { DEFAULT_GRAPHICS_QUALITY,GRAPHICS_QUALITY_PRESETS,GraphicsQualityManager,QUALITY_STORAGE_KEY,qualityManager } from "../src/core/QualityManager.js?v=20261002-flight-sim-terrain";
import { createClass43PowerCar,createHSTFormation,createMark3Coach } from "../src/rail/HSTFactory.js?v=20261002-flight-sim-terrain";
import { pointInsideCollisionProfileXZ,distanceToCollisionProfileXZ } from "../src/collision/LocalCollisionProfile.js?v=20261002-flight-sim-terrain";

const out=document.getElementById("results"),testFilter=globalThis.__TEST_FILTER?new RegExp(globalThis.__TEST_FILTER,"i"):null,testRange=globalThis.__TEST_RANGE;let testOrdinal=0;
function test(name,fn){testOrdinal++;if(Array.isArray(testRange)&&(testOrdinal<testRange[0]||testOrdinal>testRange[1]))return;if(testFilter&&!testFilter.test(name))return;try{fn();out.innerHTML+=`<p class="pass">✓ ${name}</p>`;}catch(e){out.innerHTML+=`<p class="fail">✗ ${name}: ${e.message}</p>`;console.error(name,e);}}
function expect(v,msg){if(!v)throw new Error(msg);}

test("graphics quality defaults to Medium and defines exactly four presets",()=>{
  const storage={getItem:()=>null,setItem:()=>{}},manager=new GraphicsQualityManager({storage});
  expect(DEFAULT_GRAPHICS_QUALITY==="medium"&&manager.name==="medium","graphics quality does not safely default to Medium");
  expect(Object.keys(GRAPHICS_QUALITY_PRESETS).join(",")==="low,medium,high,ultra","graphics preset set changed unexpectedly");
});
test("invalid persisted graphics quality falls back to Medium and valid changes persist",()=>{
  const values=new Map([[QUALITY_STORAGE_KEY,"potato"]]),storage={getItem:key=>values.get(key)??null,setItem:(key,value)=>values.set(key,value)},manager=new GraphicsQualityManager({storage});
  expect(manager.name==="medium","invalid persisted quality did not fall back to Medium");manager.setQuality("high");
  expect(manager.name==="high"&&values.get(QUALITY_STORAGE_KEY)==="high","graphics-quality change did not persist");
});
test("aircraft movement multiplier preserves the ten-aircraft authoritative configuration",()=>{
  expect(CONFIG.aircraftSpeedMultiplier===1.75,"aircraft speed multiplier is not 1.75");
  expect(WORLD_DEFINITION.aviation.aircraftCount===10,"graphics work changed the authoritative ten-aircraft fleet");
  expect(Math.abs(WORLD_DEFINITION.aviation.cruiseSpeed*CONFIG.aircraftSpeedMultiplier-154)<1e-9,"resolved cruise speed is not approximately 154 world units/s");
});
function graph(){
  const g=new RoadGraph();g.addNode("A",0,0,{signal:true});g.addNode("B",100,0);g.addNode("C",100,100);g.addNode("D",0,100);
  g.addBidirectionalRoad({id:"AB",from:"A",to:"B",lanesEachWay:2});g.addBidirectionalRoad({id:"BC",from:"B",to:"C"});
  g.addBidirectionalRoad({id:"CD",from:"C",to:"D"});g.addBidirectionalRoad({id:"DA",from:"D",to:"A"});return g;
}

test("route generation reaches destination",()=>{const g=graph(),r=g.route("A","C");expect(r[0]==="A"&&r.at(-1)==="C","bad route endpoints");});
test("lane identifiers are deterministic and unique",()=>{const g=graph();expect(g.lanes.has("AB:fwd:0")&&g.lanes.has("AB:rev:1"),"missing deterministic lane IDs");expect(new Set(g.lanes.keys()).size===g.lanes.size,"duplicate lane IDs");});
test("closed lanes are excluded from pathfinding",()=>{const g=graph();g.lanes.get("AB:fwd:0").closed=true;g.lanes.get("AB:fwd:1").closed=true;g.routeCache.clear();expect(g.route("A","C").join(">")==="A>D>C","route used closure");});
test("lane splines use left-hand running and remain separated",()=>{
  const g=buildRoadGraph(),road=g.roads.get("Old Town Spine"),fwd=g.lanes.get("Old Town Spine:fwd:0"),rev=g.lanes.get("Old Town Spine:rev:0");
  const centre=road.centerCurve.getPointAt(.5),a=fwd.curve.getPointAt(.5),b=rev.curve.getPointAt(.5);
  expect(a.distanceTo(centre)>1.35&&b.distanceTo(centre)>1.35,"lane centres too close to centre line");expect(a.distanceTo(b)>2.8,"opposing lanes overlap");
});
test("every generated lane follows UK left-hand traffic",()=>{
  const g=buildRoadGraph();expect(g.trafficSide==="left","road graph is not configured for UK traffic");
  for(const lane of g.lanes.values())expect(g.laneRunsOnTrafficSide(lane),`${lane.id} is on the wrong side of the road`);
});
test("heading-aware player lane lookup selects the legal left-hand carriageway",()=>{
  const g=buildRoadGraph(),lane=g.lanes.get("A1-Central West:fwd:1"),position=lane.curve.getPointAt(.45),tangent=lane.curve.getTangentAt(.45),heading=Math.atan2(tangent.x,tangent.z),nearest=g.nearestLane(position,heading);
  expect(nearest.lane?.direction==="fwd","player lane lookup selected opposing traffic");expect(g.laneRunsOnTrafficSide(nearest.lane),"player lane lookup selected a non-UK lane");
});
test("full master plan has stable graph counts",()=>{const g=buildRoadGraph();expect(g.nodes.size===25,"node count changed");expect(g.roads.size===36,"road count changed");expect(g.lanes.size===112,"lane count changed");});
test("road network has no undefined intersections, duplicate crossings or abrupt sampled corners",()=>{
  const result=analyseRoadNetwork(buildRoadGraph());expect(result.errors.length===0,result.errors.join("; "));expect(result.connectorCount>300,"junction connector coverage is incomplete");
});
test("junction connector centres are recognised as drivable road surface",()=>{
  const g=buildRoadGraph(),incoming=g.lanes.get("A1-Central West:fwd:1"),outgoing=g.lanes.get("A1-Central East:fwd:1"),connector=g.getJunctionConnector(incoming.id,outgoing.id),surface=g.nearestDrivableSurface(connector.curve.getPointAt(.5));
  expect(surface.onRoad,"junction connector still triggers off-road handling");
});
test("southeast industrial roads use a clean split motorway interchange",()=>{
  const g=buildRoadGraph(),local=g.nodes.get("SE"),terminal=g.nodes.get("M6E");
  expect(local.control==="roundabout"&&terminal.control==="roundabout","southeast junctions are not controlled roundabouts");
  expect(local.connectedRoadIds.length===3,"local industrial junction still contains motorway merge arms");
  expect(terminal.connectedRoadIds.length===4,"motorway terminal and airport approach count changed unexpectedly");
  expect(!local.connectedRoadIds.includes("M6-South Motorway")&&!local.connectedRoadIds.includes("M6-East Slip"),"parallel motorway approaches still collide at SE");
  expect(local.connectedRoadIds.includes("Industrial Motorway Access"),"local and motorway networks lost their access link");
  expect(terminal.connectedRoadIds.includes("M6-South Motorway")&&terminal.connectedRoadIds.includes("M6-East Slip")&&terminal.connectedRoadIds.includes("Airport Parkway"),"motorway or airport arms are not connected at M6E");
  for(const node of [local,terminal])for(const roadId of node.connectedRoadIds){
    const road=g.roads.get(roadId),atStart=road.from===node.id,t=atStart?road.startT:road.endT,mouth=road.centerCurve.getPointAt(t);
    const distance=Math.hypot(mouth.x-node.position.x,mouth.z-node.position.z);
    expect(distance>=node.roundaboutRadius+4.5,`${roadId} was not trimmed back for a proper roundabout throat`);
    const incoming=[...g.lanes.values()].find(lane=>lane.roadId===roadId&&lane.to===node.id),outgoing=[...g.lanes.values()].find(lane=>lane.roadId===roadId&&lane.from===node.id);
    expect(incoming&&outgoing,`${roadId} lost a legal two-way junction connection`);
  }
});
test("waterfront approaches meet a real roundabout without a hairpin connector",()=>{
  const g=buildRoadGraph(),node=g.nodes.get("NE"),connector=g.roads.get("Waterfront Connector"),water=g.nodes.get("WATER");
  expect(node.control==="roundabout","waterfront corner is still a circular apron rather than a controlled roundabout");
  expect(node.connectedRoadIds.length===4,"waterfront roundabout does not have four distinct arms");
  expect(node.position.distanceTo(water.position)>node.roundaboutRadius+80,"secondary waterfront junction is still too close to the roundabout");
  expect(connector.length/connector.centerPoints[0].distanceTo(connector.centerPoints.at(-1))<1.15,"Waterfront Connector still doubles back on itself");
  const approaches=node.connectedRoadIds.map(id=>{
    const road=g.roads.get(id),atStart=road.from===node.id,t=atStart?road.startT:road.endT,tangent=road.centerCurve.getTangentAt(t).setY(0).normalize();
    return atStart?tangent:tangent.multiplyScalar(-1);
  });
  let minimumAngle=Math.PI;
  for(let i=0;i<approaches.length;i++)for(let j=i+1;j<approaches.length;j++)minimumAngle=Math.min(minimumAngle,Math.acos(THREE.MathUtils.clamp(approaches[i].dot(approaches[j]),-1,1)));
  expect(minimumAngle>THREE.MathUtils.degToRad(65),`waterfront roundabout arms remain too close together (${THREE.MathUtils.radToDeg(minimumAngle).toFixed(1)}°)`);
});

test("the authoritative world definition validates and drives the generated graph",()=>{
  const g=buildRoadGraph(WORLD_DEFINITION),errors=validateWorldDefinition(WORLD_DEFINITION,{graph:g});
  expect(errors.length===0,errors.join("; "));
  expect(g.nodes.size===WORLD_DEFINITION.roads.nodes.length,"road-node definitions diverged from the graph");
  expect(g.roads.size===WORLD_DEFINITION.roads.links.length,"road definitions diverged from the graph");
  for(const city of WORLD_DEFINITION.cities)expect(pointInWorldBounds(city.x,city.z),`${city.id} lies outside the shared bounds`);
});
test("generated building footprints do not intrude into roads",()=>{
  const g=buildRoadGraph(),city=new CityBuilder(new THREE.Scene(),g);city.build();
  expect(city.lots.length>100,"too few generated buildings");expect(city.validateRoadBuildingClearance().length===0,"road/building clearance violation");
  expect(city.lots.filter(l=>Math.abs(l.rotation)>.05).length>city.lots.length*.5,"buildings are not aligned to streets");
});
test("vehicle categories have full and low-detail representations",()=>{
  const car=getVehicleDimensions("car"),bus=getVehicleDimensions("bus"),sports=getVehicleDimensions("sports");
  expect(bus.length>car.length*2,"bus proportions invalid");expect(sports.height<car.height,"sports-car proportions invalid");
  for(const kind of ["car","hatchback","sports","suv","taxi","van","bus","lorry","emergency"]){
    const mesh=createVehicleMesh(kind,2),low=createVehicleLowMesh(kind,mesh.userData.bodyColor);
    expect(mesh.userData.wheels.length>=8,`${kind} missing wheel meshes`);expect(low.children.length>=2,`${kind} missing low LOD`);animateVehicleMesh(mesh,12,.3,1/60,1);
  }
});
test("chunk coordinates are deterministic",()=>{expect(chunkKeyForPosition(new THREE.Vector3(-330,0,5))==="-2:0","wrong current chunk");});
test("directional preloading selects the chunk ahead",()=>{expect(predictAheadChunk(new THREE.Vector3(-330,0,5),Math.PI/2,12)==="-1:0","wrong preload chunk");});
test("reverse travel preloads behind the vehicle",()=>{expect(predictAheadChunk(new THREE.Vector3(-330,0,5),Math.PI/2,-8)==="-3:0","reverse preload mismatch");});
test("streaming keeps the current chunk and four cardinal neighbours detailed",()=>{
  const position=new THREE.Vector3(-330,0,5),keys=neighbourhoodKeysForPosition(position);
  expect(keys.size===5,"neighbourhood must contain current plus four cardinal chunks");
  const current=chunkKeyForPosition(position);
  expect(cardinalNeighbourKeysForChunk(current).every(key=>keys.has(key)),"cardinal neighbour missing");
});
test("streaming predicts a two-chunk movement corridor",()=>{
  const keys=predictAheadChunks(new THREE.Vector3(-330,0,5),Math.PI/2,12,2);
  expect(keys.length===2,"ahead corridor length mismatch");
  expect(keys[0]==="-1:0","first ahead chunk mismatch");
  expect(keys[1]==="0:0","second ahead chunk mismatch");
});
test("initial neighbourhood streaming loads all local and ahead chunks atomically",()=>{
  const g=buildRoadGraph(),scene=new THREE.Scene(),city=new CityBuilder(scene,g),built=city.build();
  city.initializeStreaming(new THREE.Vector3(-330,0,5),Math.PI/2,12);
  const stats=built.chunkManager.getStats();
  expect(stats.neighbours===5,"wrong local neighbourhood size");
  expect(stats.ahead===2,"wrong ahead chunk count");
  expect(stats.visible>=6,"local neighbourhood and ahead corridor were not fully detailed");
  expect(stats.queued===0,"initial streaming left required chunks queued");
});

test("surrounding building chunks use simplified instanced geometry",()=>{
  const scene=new THREE.Scene(),g=buildRoadGraph(),city=new CityBuilder(scene,g),built=city.build();city.initializeStreaming(new THREE.Vector3(-330,0,5),Math.PI/2,12);
  const manager=built.chunkManager,current=manager.chunkByKey(manager.currentKey),lowChunks=[...manager.visibleLowBuildingKeys].map(key=>manager.chunkByKey(key)).filter(chunk=>chunk.lowBuildings);
  expect(current.detail?.userData?.buildingGroup?.visible,"current-chunk buildings are not detailed");
  expect(lowChunks.length>0,"no surrounding building chunk entered low quality");
  expect(lowChunks.every(chunk=>chunk.lowBuildings.visible&&!chunk.detail?.userData?.buildingGroup?.visible),"a surrounding chunk still draws full building detail");
  expect(lowChunks.every(chunk=>chunk.lowBuildings.isInstancedMesh&&!chunk.lowBuildings.castShadow),"low buildings are not cheap instanced shadow-free geometry");
});

test("vehicle hitboxes match category-specific compound footprints",()=>{
  const car=getVehicleHitboxProfile("car"),sports=getVehicleHitboxProfile("sports"),lorry=getVehicleHitboxProfile("lorry");
  expect(car.polygons[0].length===8,"car footprint is not tapered");expect(sports.width>car.width,"sports footprint width invalid");expect(lorry.polygons.length===2,"lorry requires cab and trailer hitboxes");
  const a=getWorldHitboxPolygons("car",new THREE.Vector3(0,0,0),0),b=getWorldHitboxPolygons("car",new THREE.Vector3(0,0,3.4),0);
  expect(intersectCompoundHitboxes(a,b),"overlapping vehicle hitboxes were not detected");
  expect(!intersectCompoundHitboxes(a,getWorldHitboxPolygons("car",new THREE.Vector3(0,0,12),0)),"separated vehicle hitboxes collided");
});


test("Class 43 walking collision follows the tapered visible nose rather than a padded rectangle",()=>{
  const powerCar=createClass43PowerCar(),profile=powerCar.userData.collisionProfile;
  expect(profile?.id==="class43-power","Class 43 collision profile missing");
  expect(pointInsideCollisionProfileXZ(0,0,profile),"Class 43 engine-room body is not solid");
  expect(pointInsideCollisionProfileXZ(1.08,6.50,profile),"Class 43 front light band is not represented");
  expect(!pointInsideCollisionProfileXZ(1.08,5.80,profile),"empty tapered Class 43 nose corner is still blocked");
  expect(!pointInsideCollisionProfileXZ(0,6.90,profile),"Class 43 hitbox extends beyond the visible nose");
  expect(distanceToCollisionProfileXZ(1.08,5.80,profile)>.08,"Class 43 nose-corner clearance is too small");
});

test("Mark 3 walking collision ends at the rendered shell and models door protrusions locally",()=>{
  const coach=createMark3Coach(),profile=coach.userData.collisionProfile;
  expect(profile?.id==="mark3-coach","Mark 3 collision profile missing");
  expect(pointInsideCollisionProfileXZ(1.20,0,profile),"Mark 3 main body is not solid");
  expect(!pointInsideCollisionProfileXZ(0,7.40,profile),"Mark 3 hitbox extends beyond the rendered vehicle end");
  expect(pointInsideCollisionProfileXZ(1.41,6.55,profile),"Mark 3 passenger-door casing is not represented");
  expect(!pointInsideCollisionProfileXZ(1.41,0,profile),"Mark 3 side hitbox is inflated to the door-casing width along the whole coach");
});


test("rotated building colliders follow the visible footprint instead of the loose AABB corners",()=>{
  const rotation=Math.PI/4,halfW=10,halfD=3,c=Math.abs(Math.cos(rotation)),s=Math.abs(Math.sin(rotation)),collider={x:0,z:0,colliderType:"obb",collisionRotation:rotation,collisionHalfW:halfW,collisionHalfD:halfD,collisionAabbHalfW:halfW*c+halfD*s,collisionAabbHalfD:halfW*s+halfD*c};
  const broad=getColliderBroadphaseExtents(collider),emptyAabbCorner=new THREE.Vector3(broad.halfW-.15,0,broad.halfD-.15),wallPoint=new THREE.Vector3(4.8,0,-4.8);
  expect(!pointInsideColliderXZ(emptyAabbCorner,collider),"empty corner of a rotated building AABB is still blocked");
  expect(pointInsideColliderXZ(wallPoint,collider),"point inside the visible rotated footprint is not blocked");
  expect(!vehicleIntersectsCollider("car",emptyAabbCorner,0,collider),"vehicle collides with empty space outside the rotated building");
});

test("generated building colliders retain layout bounds but use tighter oriented collision footprints",()=>{
  const scene=new THREE.Scene(),g=buildRoadGraph(),city=new CityBuilder(scene,g),built=city.build(),rotated=built.colliders.find(collider=>collider.colliderType==="obb"&&Math.abs(collider.collisionRotation)>.15&&collider.w);
  expect(rotated,"no rotated building collider was generated");
  expect(rotated.collisionHalfW<rotated.w*.5&&rotated.collisionHalfD<rotated.d*.5,"building collision footprint was not inset to the facade");
  expect(rotated.halfW>=rotated.collisionAabbHalfW&&rotated.halfD>=rotated.collisionAabbHalfD,"layout reservation no longer contains the tighter collision footprint");
  const localOutside=new THREE.Vector3(rotated.collisionHalfW+.25,0,rotated.collisionHalfD+.25),cos=Math.cos(rotated.collisionRotation),sin=Math.sin(rotated.collisionRotation),worldCorner=new THREE.Vector3(rotated.x+localOutside.x*cos+localOutside.z*sin,0,rotated.z-localOutside.x*sin+localOutside.z*cos);
  expect(!pointInsideColliderXZ(worldCorner,rotated),"generated building collider still blocks beyond the facade corner");
});
test("scheduled bus routes are sourced from the authoritative world definition",()=>{
  const scene=new THREE.Scene(),g=buildRoadGraph(),signals=new TrafficSignals(scene,g),player={position:new THREE.Vector3(999,0,999),inVehicle:false};
  const traffic=new TrafficSystem(scene,g,signals,player),transit=new TransitSystem(scene,g,traffic);
  expect(transit.routes.length===WORLD_DEFINITION.transit.routes.length,"transit route count diverged");
  expect(transit.routes.every((route,index)=>route.id===WORLD_DEFINITION.transit.routes[index].id),"transit route ids diverged");
});

test("bus services create directional stops and exact stop targets",()=>{
  const scene=new THREE.Scene(),g=buildRoadGraph(),signals=new TrafficSignals(scene,g);
  const player={position:new THREE.Vector3(999,0,999),inVehicle:false};
  const traffic=new TrafficSystem(scene,g,signals,player),transit=new TransitSystem(scene,g,traffic);
  expect(transit.stops.size>=16,"directional bus stops missing");expect(transit.buses.length===4,"scheduled buses missing");
  for(const bus of transit.buses)expect(bus.stopTargets.size>=4,"bus has no curbside stopping plan");
});

test("junction control is strategic rather than assigned to every connection",()=>{
  const g=buildRoadGraph(),signals=[...g.nodes.values()].filter(n=>n.control==="signal"),roundabouts=[...g.nodes.values()].filter(n=>n.control==="roundabout");
  expect(signals.length===4,"unexpected signal-control count");expect(roundabouts.length===6,"expected six landscaped roundabouts including airport access");
  expect(signals.every(n=>n.connectedRoadIds.length>=4),"traffic lights were assigned to a minor junction");
  expect(g.nodes.get("COMM").control!=="signal","two-road commercial connection should not be signalised");
});
test("road lane mouths are trimmed back from junction centres",()=>{
  const g=buildRoadGraph(),lane=g.lanes.get("A1-Central West:fwd:0"),node=g.nodes.get("CBD");
  expect(lane.curve.getPointAt(1).distanceTo(node.position)>6,"lane still terminates at the raw node centre");
});
test("ordinary turns use a seamless connector spline",()=>{
  const g=buildRoadGraph(),incoming=g.lanes.get("A1-Central West:fwd:0"),outgoing=g.lanes.get("B2-South Boulevard:fwd:0"),connector=g.getJunctionConnector(incoming.id,outgoing.id);
  expect(connector?.type==="junction","ordinary junction connector missing");
  expect(connector.curve.getPointAt(0).distanceTo(incoming.curve.getPointAt(1))<.01,"connector does not start at incoming lane mouth");
  expect(connector.curve.getPointAt(1).distanceTo(outgoing.curve.getPointAt(0))<.01,"connector does not finish at outgoing lane mouth");
});
test("roundabout connectors circulate outside the landscaped island",()=>{
  const g=buildRoadGraph(),node=g.nodes.get("SOUTH"),incoming=g.lanes.get("B2-South Boulevard:fwd:0"),outgoing=g.lanes.get("Industrial Link:fwd:0"),connector=g.getJunctionConnector(incoming.id,outgoing.id);
  expect(connector?.type==="roundabout","roundabout connector missing");
  let minRadius=Infinity;for(let i=0;i<=80;i++){const p=connector.curve.getPointAt(i/80);minRadius=Math.min(minRadius,Math.hypot(p.x-node.position.x,p.z-node.position.z));}
  expect(minRadius>node.roundaboutInnerRadius+.35,"roundabout route cuts through the central island");
});
test("city chunks contain seamless junction surfaces and flower roundabouts",()=>{
  const g=buildRoadGraph(),city=new CityBuilder(new THREE.Scene(),g),built=city.build(),specials=[...built.chunkManager.chunks.values()].flatMap(c=>c.specials);
  expect(specials.filter(s=>s.type==="roundabout").length===6,"roundabout surfaces missing");
  expect(specials.filter(s=>s.type==="junctionApron").length>=9,"permanent multi-road junction aprons missing");
  expect(specials.filter(s=>s.permanent).length>=12,"junction surfaces are still dependent on chunk visibility");
});

test("UK lane indexing identifies the kerbside lane as the outermost lane",()=>{
  const g=buildRoadGraph(),inner=g.lanes.get("A1-West Avenue:fwd:0"),outer=g.lanes.get("A1-West Avenue:fwd:1");
  expect(g.outermostLaneIndex(inner)===1,"wrong outermost lane index");
  expect(g.adjacentLane(inner.id,1)?.id===outer.id,"adjacent lane lookup failed");
});

test("turn-aware lane selection uses the inner lane for a right turn",()=>{
  const g=buildRoadGraph(),incoming=g.lanes.get("A1-Central West:fwd:1"),rightTurn=g.lanes.get("B2-South Boulevard:fwd:0"),leftTurn=g.lanes.get("B2-Station Approach:rev:0");
  expect(g.turnDirection(incoming.id,rightTurn.id)==="right","right turn was misclassified");
  expect(g.preferredApproachLaneIndex(incoming.id,rightTurn.id)===0,"right turn did not select the inner lane");
  expect(g.turnDirection(incoming.id,leftTurn.id)==="left","left turn was misclassified");
  expect(g.preferredApproachLaneIndex(incoming.id,leftTurn.id)===1,"left turn did not select the kerbside lane");
});

test("lane changes interpolate between lane splines instead of teleporting",()=>{
  const scene=new THREE.Scene(),g=buildRoadGraph(),signals=new TrafficSignals(scene,g),player={position:new THREE.Vector3(999,0,999),inVehicle:false};
  const traffic=new TrafficSystem(scene,g,signals,player),from=g.lanes.get("A1-West Avenue:fwd:1"),to=g.lanes.get("A1-West Avenue:fwd:0");
  const vehicle=traffic.addVehicle({kind:"car",route:["WEST","CBDW","CBD"],lane:from,progress:.35,profileName:"normal"});
  traffic.startLaneChange(vehicle,to,"test",3);vehicle.laneChange.elapsed=1.5;traffic.place(vehicle);
  const a=from.curve.getPointAt(vehicle.progress),b=to.curve.getPointAt(vehicle.progress),mid=a.clone().lerp(b,.5);
  expect(vehicle.mesh.position.distanceTo(mid)<.06,"vehicle did not follow the blended lane-change path");
  expect(vehicle.mesh.userData.indicatorDirection===1,"right indicator was not selected");
  traffic.completeLaneChange(vehicle);expect(vehicle.laneId===to.id,"lane change did not commit the target lane");
});

test("unsafe lane changes are rejected when a faster vehicle is close behind",()=>{
  const scene=new THREE.Scene(),g=buildRoadGraph(),signals=new TrafficSignals(scene,g),player={position:new THREE.Vector3(999,0,999),inVehicle:false};
  const traffic=new TrafficSystem(scene,g,signals,player),outer=g.lanes.get("A1-West Avenue:fwd:1"),inner=g.lanes.get("A1-West Avenue:fwd:0");
  const subject=traffic.addVehicle({kind:"car",route:["WEST","CBDW","CBD"],lane:outer,progress:.40,profileName:"normal"});subject.speed=12;
  const approaching=traffic.addVehicle({kind:"sports",route:["WEST","CBDW","CBD"],lane:inner,progress:.375,profileName:"aggressive"});approaching.speed=22;
  const occupancy=traffic.buildLaneOccupancy();
  expect(!traffic.laneChangeSafe(subject,inner,occupancy),"dangerous rear-gap merge was accepted");
});

test("slow traffic can be overtaken and the passing car returns to UK lane discipline",()=>{
  const scene=new THREE.Scene(),g=buildRoadGraph(),signals=new TrafficSignals(scene,g),player={position:new THREE.Vector3(999,0,999),inVehicle:false,nearestLaneId:null,vehicle:{userData:{length:4.5}},speed:0};
  const traffic=new TrafficSystem(scene,g,signals,player),outer=g.lanes.get("A1-West Avenue:fwd:1"),inner=g.lanes.get("A1-West Avenue:fwd:0"),route=["WEST","CBDW","CBD"];
  const slow=traffic.addVehicle({kind:"bus",route,lane:outer,progress:.43,profileName:"professional"});slow.speed=4;
  const fast=traffic.addVehicle({kind:"car",route,lane:outer,progress:.32,profileName:"aggressive"});fast.speed=15;fast.profile={...fast.profile,overtakeBias:1,laneCooldown:1};fast.laneChangeCooldown=0;fast.laneDecisionTimer=0;
  for(let i=0;i<260;i++){signals.update(1/36);traffic.update(1/36,i/36);}
  expect(traffic.completedLaneChanges>=1,"overtaking lane change never completed");
  expect(fast.laneId===inner.id||fast.laneChange?.toLaneId===inner.id,"passing vehicle did not use the inner lane");
});

test("bus stops and scheduled buses use the actual kerbside lane",()=>{
  const scene=new THREE.Scene(),g=buildRoadGraph(),signals=new TrafficSignals(scene,g),player={position:new THREE.Vector3(999,0,999),inVehicle:false};
  const traffic=new TrafficSystem(scene,g,signals,player),transit=new TransitSystem(scene,g,traffic);
  for(const stop of transit.stops.values()){
    const lane=g.lanes.get(stop.laneId);expect(lane.index===g.outermostLaneIndex(lane),`${stop.key} is not on the kerbside lane`);
  }
  for(const bus of transit.buses){const lane=g.lanes.get(bus.laneId);expect(lane.index===g.outermostLaneIndex(lane),`${bus.id} started away from the kerb`);}
});

// Rail-network regression coverage.
import { createRailPlan,forwardArcDistance,analyseRailGeometry,analyseRoadRailLayout } from "../src/rail/RailPlan.js?v=20261002-flight-sim-terrain";
import { RailSystem } from "../src/rail/RailSystem.js?v=20261002-flight-sim-terrain";
import { RailNetwork } from "../src/rail/RailNetwork.js?v=20261002-flight-sim-terrain";
import { RailBlockSystem } from "../src/rail/RailBlockSystem.js?v=20261002-flight-sim-terrain";
import { RailInterlocking } from "../src/rail/RailInterlocking.js?v=20261002-flight-sim-terrain";
import { createDefaultTrainServices } from "../src/rail/TrainService.js?v=20261002-flight-sim-terrain";

test("Class 43 HST route links major centres without breaking the closed loop",()=>{
  const plan=createRailPlan(),start=plan.curve.getPointAt(0),end=plan.curve.getPointAt(1);
  expect(plan.mainRoute.stations.length===8,"city-loop station count changed");
  expect(plan.stations.length===9,"physical city-plus-airport station count changed");
  expect(start.distanceTo(end)<.01,"rail route is not closed");
  expect(plan.designSpeedMps>55&&plan.designSpeedMps<57,"Class 43 design speed is not 125 mph");
  expect(plan.length>2500,"city-encompassing route is too short");
});

test("HST route has no hairpin or self-intersection",()=>{
  const plan=createRailPlan(),analysis=analyseRailGeometry(plan,900);
  expect(analysis.selfIntersections===0,"railway crosses itself");
  expect(analysis.minimumRadius>=plan.minimumDesignRadius,`minimum curve radius ${analysis.minimumRadius.toFixed(1)} m is too tight`);
});

test("urban HST service speed is materially faster",()=>{
  const plan=createRailPlan();expect(plan.urbanLineSpeedMps>=44,"urban HST line speed was not raised");
});

test("railway, stations and trains use distance-based level of detail",()=>{
  const scene=new THREE.Scene(),g=buildRoadGraph(),city=new CityBuilder(scene,g),built=city.build();city.initializeStreaming(new THREE.Vector3(-330,0,5),Math.PI/2,0);
  const camera=new THREE.PerspectiveCamera(),rail=new RailSystem(scene,camera,{isDown:()=>false,consume:()=>false},g,built.chunkManager,built.railPlan,()=>{},built.colliders),player={inVehicle:true,position:new THREE.Vector3(-330,0,5)};
  rail.updateInfrastructureVisibility(player);for(const train of rail.trains)rail.updateTrainVisibility(train,player);
  const trackEntries=[...rail.trackChunkGroups.values()];
  expect(trackEntries.length>8,"railway was not divided into streamed chunks");
  expect(trackEntries.some(entry=>entry.detail.visible),"nearby track never reaches detailed quality");
  expect(trackEntries.some(entry=>entry.low.visible&&!entry.detail.visible),"distant track does not fall back to low-quality lines");
  expect(rail.stationLowGroups.some(entry=>entry.group.visible),"distant stations do not use simplified geometry");
  expect(rail.trains.some(train=>train.renderTier!=="full"),"every train remains full quality regardless of distance");
  expect(rail.trains.every(train=>train.lowMesh),"trains are missing their simplified LOD representation");
});

test("trains fall to low quality immediately outside the four-chunk neighbourhood",()=>{
  const scene=new THREE.Scene(),g=buildRoadGraph(),city=new CityBuilder(scene,g),built=city.build(),focus=new THREE.Vector3(-330,0,5);city.initializeStreaming(focus,Math.PI/2,0);
  const camera=new THREE.PerspectiveCamera(),rail=new RailSystem(scene,camera,{isDown:()=>false,consume:()=>false},g,built.chunkManager,built.railPlan,()=>{},built.colliders),player={inVehicle:true,position:focus.clone()},train=rail.trains[0];
  let nearT=null,farT=null;
  for(let i=0;i<1200;i++){
    const t=i/1200,point=built.railPlan.curve.getPointAt(t),key=chunkKeyForPosition(point,built.chunkManager.chunkSize),distance=point.distanceTo(focus);
    if(nearT===null&&built.chunkManager.neighbourhoodKeys.has(key)&&distance<CONFIG.trainFullDistance)nearT=t;
    if(farT===null&&!built.chunkManager.neighbourhoodKeys.has(key)&&distance<CONFIG.trainLowDistance)farT=t;
  }
  expect(nearT!==null&&farT!==null,"rail loop did not provide both near and outside-neighbourhood samples");
  train.progress=nearT;rail.updateTrainHead(train);expect(rail.updateTrainVisibility(train,player)==="full","train inside the four-chunk range was not detailed");
  train.progress=farT;rail.updateTrainHead(train);expect(rail.updateTrainVisibility(train,player)==="low","train outside the four-chunk range did not become low quality");
});

test("rail system creates at least five complete Class 43 HST formations",()=>{
  const scene=new THREE.Scene(),g=buildRoadGraph(),city=new CityBuilder(scene,g),built=city.build();
  city.initializeStreaming(new THREE.Vector3(-330,0,5),Math.PI/2,0);
  const rail=new RailSystem(scene,new THREE.PerspectiveCamera(),{isDown:()=>false,consume:()=>false},g,built.chunkManager,built.railPlan,()=>{},built.colliders);
  expect(rail.trains.length>=5,"fewer than five HST services were created");
  for(const train of rail.trains){
    expect(train.formation.vehicles.length===7,`${train.id} is missing power cars or Mark 3 coaches`);
    expect(train.formation.vehicles[0].userData.type==="class43-power","leading Class 43 power car missing");
    expect(train.formation.vehicles.at(-1).userData.type==="class43-power","trailing Class 43 power car missing");
  }
});

test("every road and rail intersection is grade-separated with no level crossings",()=>{
  const scene=new THREE.Scene(),g=buildRoadGraph(),city=new CityBuilder(scene,g),built=city.build();
  city.initializeStreaming(new THREE.Vector3(-330,0,5),Math.PI/2,0);
  const rail=new RailSystem(scene,new THREE.PerspectiveCamera(),{isDown:()=>false,consume:()=>false},g,built.chunkManager,built.railPlan,()=>{},built.colliders);
  expect(rail.crossings.length===0,"ground-level crossings still exist");
  expect(rail.gradeSeparations.length>=10,"road/rail intersections were not fully analysed");
  expect(rail.gradeSeparations.every(item=>item.type==="rail-over-road"&&item.clearance>=built.railPlan.gradePolicy.minimumRoadClearance),"bridge clearance is insufficient");
  const lane=g.lanes.get("A1-West Avenue:fwd:1"),vehicle={progress:.5,profile:{brake:6.5}};
  expect(rail.adjustRoadVehicleTarget(vehicle,lane,20)===20,"grade separation still stops road traffic like a level crossing");
  expect(rail.supportLocations.length>8,"viaduct support layout is unexpectedly sparse");
  expect(rail.supportClearanceViolations.length===0,"viaduct supports overlap roads or buildings");
});

test("stations avoid road crossings and include safe road access",()=>{
  const g=buildRoadGraph(),plan=createRailPlan(WORLD_DEFINITION,g),errors=analyseRoadRailLayout(plan,g,WORLD_DEFINITION);
  expect(plan.schemaVersion===5,"resolved rail plan schema is stale");
  expect(errors.length===0,errors.join("; "));
  for(const station of plan.stations){
    expect(station.roadAccess?.distance<=WORLD_DEFINITION.rail.stationAccess.maximumRoadDistance,`${station.name} is inaccessible by road`);
    expect(station.roadClearance>=WORLD_DEFINITION.rail.stationAccess.minimumPlatformRoadClearance,`${station.name} platform footprint overlaps a road`);
  }
});


test("stations maintain realistic separation around every complete railway loop",()=>{
  const g=buildRoadGraph(),plan=createRailPlan(WORLD_DEFINITION,g);
  for(const route of plan.routes){
    const ordered=[...route.stations].sort((a,b)=>a.t-b.t);
    for(let index=0;index<ordered.length;index++){
      const a=ordered[index],b=ordered[(index+1)%ordered.length],spacing=forwardArcDistance(a.t,b.t,1,route.length);
      const required=Math.max(WORLD_DEFINITION.rail.stationAccess.minimumStationSpacing,(a.platformLength+b.platformLength)*.5+WORLD_DEFINITION.rail.stationAccess.minimumPlatformGap);
      expect(spacing>=required,`${a.name} and ${b.name} are unrealistically close on ${route.name} (${spacing.toFixed(1)} m)`);
    }
  }
});

test("city and airport railways are separate smooth closed loops",()=>{
  const plan=createRailPlan(WORLD_DEFINITION,buildRoadGraph());
  expect(plan.routes.length===2,"expected separate city and airport routes");
  for(const route of plan.routes){
    expect(route.curve.closed,`${route.name} is not marked closed`);
    expect(route.curve.getPointAt(0).distanceTo(route.curve.getPointAt(1))<.01,`${route.name} does not close geometrically`);
    expect(route.geometry.selfIntersections===0,`${route.name} self-intersects`);
    expect(route.geometry.minimumRadius>=route.minimumDesignRadius,`${route.name} contains an excessively sharp curve`);
    expect(route.length>1800,`${route.name} is not a substantial operational loop`);
  }
  expect(plan.mainRoute!==plan.airportRoute,"airport route reused the city-loop object");
});

test("airport loop remains outside every runway and terminal operating footprint",()=>{
  const plan=createRailPlan(WORLD_DEFINITION,buildRoadGraph()),route=plan.airportRoute,d=WORLD_DEFINITION.airport;
  const forward=new THREE.Vector3(Math.sin(d.heading),0,Math.cos(d.heading)),right=new THREE.Vector3(forward.z,0,-forward.x);
  const zones=[
    {name:"runway",x:0,z:0,halfX:d.runway.length*.5+8,halfZ:d.runway.width*.5+8},
    {name:"taxiway",x:0,z:d.taxiwayOffset,halfX:d.runway.length*.42+8,halfZ:16.5},
    {name:"apron",x:20,z:d.terminalOffset-35,halfX:85.5,halfZ:43},
    {name:"terminal",x:20,z:d.terminalOffset,halfX:72,halfZ:20.5},
    {name:"car park",x:18,z:d.terminalOffset+27,halfX:58,halfZ:27}
  ];
  for(let index=0;index<3000;index++){
    const point=route.baseCurve.getPointAt(index/3000),relative=point.clone().sub(new THREE.Vector3(d.x,0,d.z)),x=relative.dot(forward),z=relative.dot(right);
    const conflict=zones.find(zone=>Math.abs(x-zone.x)<zone.halfX&&Math.abs(z-zone.z)<zone.halfZ);
    expect(!conflict,`airport loop enters the ${conflict?.name} area`);
  }
  const station=route.stations.find(candidate=>candidate.airport);
  expect(station,"airport route has no airport station");
  expect(station.y>=station.minimumElevation,"airport station is not elevated as planned");
  expect(station.headingChange<.1&&station.maximumChordDeviation<.05,"airport platforms are not on a straight section");
});

test("airport junction is colocated and tangent-aligned with Industrial Exchange",()=>{
  const plan=createRailPlan(WORLD_DEFINITION,buildRoadGraph()),junction=plan.airportRoute.stations.find(station=>station.sharedPhysicalStationId),cityStation=plan.mainRoute.stations.find(station=>station.id===junction.sharedPhysicalStationId);
  expect(junction.position.distanceTo(cityStation.position)<.05,"airport junction is not physically connected to the city loop");
  expect(junction.tangent.dot(cityStation.tangent)>.999,"airport junction introduces an abrupt direction change");
});

test("airport through services transfer between loops without reversing",()=>{
  const scene=new THREE.Scene(),g=buildRoadGraph(),city=new CityBuilder(scene,g),built=city.build();city.initializeStreaming(new THREE.Vector3(0,0,0),0,0);
  const rail=new RailSystem(scene,new THREE.PerspectiveCamera(),{isDown:()=>false,consume:()=>false,mouseDX:0,mouseDY:0},g,built.chunkManager,built.railPlan,()=>{},built.colliders),train=rail.trains.find(candidate=>candidate.routeId==="airport"&&candidate.throughService),direction=train.direction;
  const airportJunction=rail.routeById.get("airport").stations.find(station=>station.sharedPhysicalStationId);train.progress=rail.stationStopProgress(train,airportJunction);rail.updateTrainHead(train);const beforeTransfer=train.headPosition.clone(),fullFleet=rail.trains;for(const item of fullFleet)rail.blockSystem.releaseReservations(item.id);rail.trains=[train];rail.blockSystem.updateOccupancy(rail.trains);
  expect(rail.maybeTransferAirportService(train,airportJunction),"airport service did not enter the city loop");
  expect(train.routeId==="city"&&train.direction===direction,"airport service reversed while joining the city loop");
  expect(train.headPosition.distanceTo(beforeTransfer)<.08,"airport junction transfer visibly teleported the train");
  const cityJunction=rail.routeById.get("city").stations.find(station=>station.id===rail.routeById.get("airport").connectsAtStationId);
  expect(rail.maybeTransferAirportService(train,cityJunction),"airport service did not return to the airport loop");
  expect(train.routeId==="airport"&&train.direction===direction,"airport service reversed while returning to the airport loop");
  expect(train.completedRouteTransfers===2,"route transfers were not recorded");rail.trains=fullFleet;rail.blockSystem.updateOccupancy(rail.trains);
});

test("every passenger door stops within its station platform in both directions",()=>{
  const scene=new THREE.Scene(),g=buildRoadGraph(),city=new CityBuilder(scene,g),built=city.build();city.initializeStreaming(new THREE.Vector3(0,0,0),0,0);
  const rail=new RailSystem(scene,new THREE.PerspectiveCamera(),{isDown:()=>false,consume:()=>false,mouseDX:0,mouseDY:0},g,built.chunkManager,built.railPlan,()=>{},built.colliders),train=rail.trains[0];
  for(const route of rail.routes)for(const direction of[-1,1])for(const station of route.stations){
    train.route=route;train.routeId=route.id;train.direction=direction;train.trackIndex=direction>0?0:1;train.progress=rail.stationStopProgress(train,station,route);rail.updateTrainPlacement(train);
    for(const coach of train.formation.vehicles.filter(vehicle=>vehicle.userData.type==="mark3-coach"))for(const door of coach.userData.passengerDoors){
      const world=rail.doorWorldPosition(coach,door,0),along=world.clone().sub(station.position).dot(station.tangent);
      expect(Math.abs(along)<=station.platformLength*.5-1,`${train.id} door stops beyond ${station.name} platform`);
    }
  }
});

test("Eastmere Airport station has a walkable covered terminal connection and passenger facilities",()=>{
  const scene=new THREE.Scene(),g=buildRoadGraph(),city=new CityBuilder(scene,g),built=city.build();city.initializeStreaming(new THREE.Vector3(900,0,610),0,0);
  const rail=new RailSystem(scene,new THREE.PerspectiveCamera(),{isDown:()=>false,consume:()=>false,mouseDX:0,mouseDY:0},g,built.chunkManager,built.railPlan,()=>{},built.colliders),station=built.railPlan.airportRoute.stations.find(candidate=>candidate.airport),group=rail.stationGroups.find(candidate=>candidate.userData.station.id===station.id);
  expect(station.terminalLinkLength>100,"airport station is not connected to the terminal");
  expect(rail.walkSurfaces.some(surface=>surface.stationId===station.id&&surface.role==="airport-terminal-walkway"),"terminal connection is not walkable");
  expect(group.children.filter(child=>child.name.endsWith("departure-display")).length===2,"airport departure displays are missing");
  expect(group.children.filter(child=>child.name.endsWith("platform-safety-fence")).length===2,"airport platform safety fencing is missing");
  expect(group.children.some(child=>child.name.endsWith("lift-tower")),"airport station has no lift tower");
  expect(station.lowGroup?.children.some(child=>child.name.endsWith("low-terminal-link")),"distant airport station lacks terminal-link LOD");
});

test("station dog-leg stairs expose two continuous flights and a walkable turning landing",()=>{
  const scene=new THREE.Scene(),g=buildRoadGraph(),city=new CityBuilder(scene,g),built=city.build();city.initializeStreaming(new THREE.Vector3(-330,0,5),Math.PI/2,0);
  const rail=new RailSystem(scene,new THREE.PerspectiveCamera(),{isDown:()=>false,consume:()=>false},g,built.chunkManager,built.railPlan,()=>{},built.colliders),station=built.railPlan.stations[0];
  const flights=rail.walkSurfaces.filter(surface=>surface.stationId===station.id&&surface.type==="stairs"&&surface.role.startsWith("ground-platform-stairs-"));
  expect(flights.length===2,"station does not expose two dog-leg stair flights");
  flights.sort((a,b)=>a.from.y-b.from.y);let feetY=flights[0].from.y;
  for(const flight of flights)for(let step=0;step<=80;step++){
    const point=flight.from.clone().lerp(flight.to,step/80),sample=rail.resolveWalkSurface(point,feetY);expect(!sample.blocked,`${flight.role} became impassable at step ${step}`);feetY=sample.height;
  }
  const landing=rail.walkSurfaces.find(surface=>surface.stationId===station.id&&surface.role==="station-mid-landing");expect(landing,"dog-leg turning landing is missing");
  expect(Math.abs(feetY-station.stationBuilding.upperFlightTop.y)<.08,"dog-leg stairs do not reach platform height");
});

test("station stair collision follows the thin visible structure and allows real headroom",()=>{
  const scene=new THREE.Scene(),g=buildRoadGraph(),city=new CityBuilder(scene,g),built=city.build();city.initializeStreaming(new THREE.Vector3(-330,0,5),Math.PI/2,0);
  const rail=new RailSystem(scene,new THREE.PerspectiveCamera(),{isDown:()=>false,consume:()=>false},g,built.chunkManager,built.railPlan,()=>{},built.colliders);
  let checkedOutside=0,checkedSolid=0,checkedUnder=0;
  for(const station of built.railPlan.stations){
    const stairs=rail.walkSurfaces.filter(surface=>surface.stationId===station.id&&surface.type==="stairs"&&surface.role==="platform-footbridge-stairs");
    expect(stairs.length===5,`${station.name} is missing platform footbridge stairs`);
    for(const stair of stairs){
      expect(stair.halfLength<=stair.visualHalfLength+.021,`${station.name} stair collision extends beyond the visible stair ends`);
      expect(stair.halfWidth<=stair.visualHalfWidth+.021,`${station.name} stair collision extends beyond the visible stair sides`);
      const midpoint=stair.from.clone().add(stair.to).multiplyScalar(.5),outside=midpoint.clone().addScaledVector(stair.right,stair.visualHalfWidth+.09);outside.y=stair.from.y;
      if(!rail.walkBlockerAt(outside,stair.from.y)){const outsideResult=rail.resolveWalkSurface(outside,stair.from.y);expect(!outsideResult.blocked,`${station.name} has an invisible stair wall beyond the visible width`);checkedOutside++;}
      const solidPoint=stair.from.clone().lerp(stair.to,.35);solidPoint.y=stair.from.y;
      const solidResult=rail.resolveWalkSurface(solidPoint,stair.from.y);expect(solidResult.blocked&&solidResult.reason==="stair-underside",`${station.name} no longer blocks the visible stair slab where headroom is insufficient`);checkedSolid++;
      const underPoint=stair.from.clone().lerp(stair.to,.70);underPoint.y=stair.from.y;
      const underResult=rail.resolveWalkSurface(underPoint,stair.from.y);expect(!underResult.blocked,`${station.name} still creates an invisible floor-to-stair wall despite sufficient headroom`);expect(Math.abs(underResult.height-stair.from.y)<.08,`${station.name} incorrectly lifted the player onto an overhead stair`);checkedUnder++;
    }
  }
  rail.setCollisionDebugVisible(true);const geometry=rail.stationCollisionDebug?.getObjectByName?.("station-stair-walk-boundaries")?.geometry,positions=geometry?.attributes?.position?.array;expect(positions?.length>0,"stair collision debug geometry is missing");let longestVertical=0;
  for(let index=0;index<positions.length;index+=6){const dx=Math.abs(positions[index]-positions[index+3]),dz=Math.abs(positions[index+2]-positions[index+5]);if(dx<1e-5&&dz<1e-5)longestVertical=Math.max(longestVertical,Math.abs(positions[index+1]-positions[index+4]));}
  expect(longestVertical<.34,`stair debug overlay still draws a ${longestVertical.toFixed(2)} m floor-height prism instead of the thin structure`);
  expect(checkedOutside>=45,"too few outside-stair clearance probes were validated");expect(checkedSolid>=45,"insufficient stair structure collisions were validated");expect(checkedUnder>=45,"insufficient under-stair headroom probes were validated");
});

test("walking mode physically traverses the complete dog-leg station staircase",()=>{
  const scene=new THREE.Scene(),camera=new THREE.PerspectiveCamera(),g=buildRoadGraph(),city=new CityBuilder(scene,g),built=city.build();city.initializeStreaming(new THREE.Vector3(-330,0,5),Math.PI/2,0);
  const input={down:new Set(["KeyW"]),mouseDX:0,isDown(key){return this.down.has(key);},consume:()=>false},rail=new RailSystem(scene,camera,input,g,built.chunkManager,built.railPlan,()=>{},built.colliders),player=new PlayerController(scene,camera,input,g,built.colliders,()=>{});player.setRailSystem(rail);player.inVehicle=false;
  const station=built.railPlan.stations[0],route=station.stationBuilding.stairRoute;camera.position.copy(route[0]);camera.position.y=route[0].y+1.72;
  for(let index=1;index<route.length;index++){
    const target=route[index];let reached=false,stuck=0,last=camera.position.clone();
    for(let frame=0;frame<1400;frame++){
      const direction=target.clone().sub(camera.position);direction.y=0;if(direction.length()<.55&&Math.abs((camera.position.y-1.72)-target.y)<.55){reached=true;break;}
      player.walkYaw=Math.atan2(direction.x,direction.z);player.updateWalking(1/60);stuck=camera.position.distanceTo(last)<1e-6?stuck+1:0;last.copy(camera.position);if(stuck>100)break;
    }
    expect(reached,`player became stuck at dog-leg stair waypoint ${index}`);
  }
  expect(Math.abs((camera.position.y-1.72)-station.stationBuilding.platformEntrance.y)<.55,"player did not reach the platform from the station hall");
});

test("footbridge stairs and deck form a continuous walkable route between platforms",()=>{
  const scene=new THREE.Scene(),camera=new THREE.PerspectiveCamera(),g=buildRoadGraph(),city=new CityBuilder(scene,g),built=city.build();
  city.initializeStreaming(new THREE.Vector3(-330,0,5),Math.PI/2,0);
  const rail=new RailSystem(scene,camera,{isDown:()=>false,consume:()=>false,mouseDX:0},g,built.chunkManager,built.railPlan,()=>{},built.colliders);
  const station=built.railPlan.stations.find(item=>Array.isArray(item.crossPlatformRoute)&&item.crossPlatformRoute.length>=5);
  expect(station,"no station exposes a cross-platform pedestrian route");
  let feetY=station.crossPlatformRoute[0].y;
  for(let segment=0;segment<station.crossPlatformRoute.length-1;segment++){
    const from=station.crossPlatformRoute[segment],to=station.crossPlatformRoute[segment+1];
    for(let step=0;step<=16;step++){
      const point=from.clone().lerp(to,step/16),sample=rail.resolveWalkSurface(point,feetY);
      expect(!sample.blocked,`${station.name} crossover route is blocked at segment ${segment}`);feetY=sample.height;
    }
  }
  expect(Math.abs(feetY-station.crossPlatformRoute.at(-1).y)<.12,`${station.name} crossover route does not reach the opposite platform`);
});


test("footbridge stair surface takes priority over overlapping platform surface",()=>{
  const scene=new THREE.Scene(),camera=new THREE.PerspectiveCamera(),g=buildRoadGraph(),city=new CityBuilder(scene,g),built=city.build();
  city.initializeStreaming(new THREE.Vector3(-330,0,5),Math.PI/2,0);
  const rail=new RailSystem(scene,camera,{isDown:()=>false,consume:()=>false,mouseDX:0},g,built.chunkManager,built.railPlan,()=>{},built.colliders);
  const stair=rail.walkSurfaces.find(surface=>surface.type==="stairs"&&surface.role==="platform-footbridge-stairs");
  expect(stair,"no footbridge staircase walk surface was registered");
  let feetY=stair.from.y,sample=null;
  for(let step=1;step<=12;step++){const probe=stair.from.clone().lerp(stair.to,step/60);sample=rail.resolveWalkSurface(probe,feetY);expect(!sample.blocked,"footbridge stair became blocked at the platform transition");feetY=sample.height;}
  expect(feetY>stair.from.y+.08&&sample.surface?.type==="stairs","overlapping platform surface still prevents the player from beginning to climb the footbridge stairs");
});


test("walking mode can climb the footbridge stairs and cross to the opposite platform",()=>{
  const scene=new THREE.Scene(),camera=new THREE.PerspectiveCamera(),g=buildRoadGraph(),city=new CityBuilder(scene,g),built=city.build();
  city.initializeStreaming(new THREE.Vector3(-330,0,5),Math.PI/2,0);
  const input={isDown:key=>key==="KeyW",consume:()=>false,mouseDX:0},rail=new RailSystem(scene,camera,input,g,built.chunkManager,built.railPlan,()=>{},built.colliders);
  const station=built.railPlan.stations.find(item=>Array.isArray(item.crossPlatformRoute)&&item.crossPlatformRoute.length>=5);
  expect(station,"no station exposes a walkable crossover route");
  const player=new PlayerController(scene,camera,input,g,built.colliders,()=>{});player.setRailSystem(rail);player.inVehicle=false;
  const route=station.crossPlatformRoute.map(point=>point.clone());
  camera.position.set(route[0].x,route[0].y+1.72,route[0].z);
  for(let segment=0;segment<route.length-1;segment++){
    const target=route[segment+1];
    const delta=target.clone().sub(camera.position).setY(0);
    player.walkYaw=Math.atan2(delta.x,delta.z);
    let reached=false;
    for(let step=0;step<360;step++){
      player.updateWalking(1/60);
      if(camera.position.distanceTo(new THREE.Vector3(target.x,target.y+1.72,target.z))<1.1){reached=true;break;}
    }
    expect(reached,`${station.name} crossover could not be walked to waypoint ${segment+1}`);
  }
  expect(camera.position.distanceTo(new THREE.Vector3(route.at(-1).x,route.at(-1).y+1.72,route.at(-1).z))<1.1,`${station.name} crossover did not reach the opposite platform`);
});

test("rail stations spawn pedestrians that use the footbridge stairs",()=>{
  const scene=new THREE.Scene(),camera=new THREE.PerspectiveCamera(),g=buildRoadGraph(),city=new CityBuilder(scene,g),built=city.build();
  city.initializeStreaming(new THREE.Vector3(-330,0,5),Math.PI/2,0);
  const rail=new RailSystem(scene,camera,{isDown:()=>false,consume:()=>false,mouseDX:0},g,built.chunkManager,built.railPlan,()=>{},built.colliders);
  expect(rail.stationPedestrians.length>=built.railPlan.stations.length,"station pedestrians were not spawned");
  const bridgeWalker=rail.stationPedestrians.find(agent=>agent.path.some(point=>point.y>5));
  expect(bridgeWalker,"no station pedestrian route reaches an elevated footbridge");
});

test("walking mode uses standard A-left D-right strafing",()=>{
  const scene=new THREE.Scene(),camera=new THREE.PerspectiveCamera(),g=buildRoadGraph(),city=new CityBuilder(scene,g),built=city.build();city.initializeStreaming(new THREE.Vector3(-330,0,5),Math.PI/2,0);
  const leftInput={isDown:key=>key==="KeyA",consume:()=>false,mouseDX:0},rightInput={isDown:key=>key==="KeyD",consume:()=>false,mouseDX:0};
  const leftPlayer=new PlayerController(scene,camera,leftInput,g,built.colliders,()=>{});leftPlayer.inVehicle=false;leftPlayer.walkYaw=0;leftPlayer.camera.position.set(0,1.72,0);
  leftPlayer.updateWalking(1/6);
  expect(leftPlayer.camera.position.x>.1,"A no longer moves left on screen in walking mode");
  const rightCamera=new THREE.PerspectiveCamera(),rightPlayer=new PlayerController(scene,rightCamera,rightInput,g,built.colliders,()=>{});rightPlayer.inVehicle=false;rightPlayer.walkYaw=0;rightCamera.position.set(0,1.72,0);
  rightPlayer.updateWalking(1/6);
  expect(rightCamera.position.x<-.1,"D no longer moves right on screen in walking mode");
});


test("exiting the player car parks it instead of attaching it to walking movement",()=>{
  const scene=new THREE.Scene(),camera=new THREE.PerspectiveCamera(),g=buildRoadGraph(),input={down:new Set(),mouseDX:0,isDown(key){return this.down.has(key);},consume:()=>false};
  const player=new PlayerController(scene,camera,input,g,[],()=>{}),parked=player.vehicle.position.clone();
  player.toggleMode();expect(!player.inVehicle,"E did not leave driving mode");
  const exitPosition=camera.position.clone();input.down.add("KeyW");
  for(let i=0;i<60;i++)player.update(1/60,i/60,"clear");
  input.down.delete("KeyW");
  expect(camera.position.distanceTo(exitPosition)>4,"walking input did not move the player after leaving the car");
  expect(player.vehicle.position.distanceTo(parked)<1e-6,"the parked car followed the walking player");
  expect(player.position.distanceTo(player.vehicle.position)>2,"walking and vehicle positions were not separated");
});

test("re-entering the parked car restores vehicle authority at the car position",()=>{
  const scene=new THREE.Scene(),camera=new THREE.PerspectiveCamera(),g=buildRoadGraph(),input={isDown:()=>false,consume:()=>false,mouseDX:0};
  const player=new PlayerController(scene,camera,input,g,[],()=>{});player.toggleMode();
  const parked=player.vehicle.position.clone();camera.position.copy(parked).add(new THREE.Vector3(1,1.72,0));player.position.set(parked.x+1,.05,parked.z);
  player.toggleMode();
  expect(player.inVehicle,"player could not re-enter the parked car");
  expect(player.position.distanceTo(parked)<1e-6,"vehicle authority resumed at the walking position instead of the parked car");
});

test("every station is level, curve-following and built from bounded modules",()=>{
  const scene=new THREE.Scene(),g=buildRoadGraph(),city=new CityBuilder(scene,g),built=city.build();
  city.initializeStreaming(new THREE.Vector3(-330,0,5),Math.PI/2,0);
  const rail=new RailSystem(scene,new THREE.PerspectiveCamera(),{isDown:()=>false,consume:()=>false},g,built.chunkManager,built.railPlan,()=>{},built.colliders);
  expect(rail.stationDiagnostics.length===built.railPlan.stations.length,"station diagnostics are incomplete");
  const platformCentres=built.railPlan.platformCentres??[-14,-7,0,7,14];
  for(const station of built.railPlan.stations){
    const diagnostic=rail.stationDiagnostics.find(item=>item.id===station.id);expect(diagnostic,`${station.name} has no geometry diagnostic`);
    expect(diagnostic.platformGradient<=built.railPlan.stationAccessPolicy.maximumPlatformGradient,`${station.name} is still built on a rail ramp`);
    expect(diagnostic.maximumPlatformSegment<=4.35,`${station.name} contains a long straight platform slab`);
    expect(diagnostic.platformSegmentCount>=48,`${station.name} platform was not segmented around the curve`);
    expect(diagnostic.canopySegmentCount>=20,`${station.name} canopy is still one stretched roof mesh`);
    expect(diagnostic.platformTrackClearance>1.3,`${station.name} platform edge is too close to the running rail`);
    expect(diagnostic.footbridgeUndersideClearance>1.45,`${station.name} footbridge is too low over the train`);
    expect(diagnostic.accessStairRun>9.5&&diagnostic.accessStairRise>6,`${station.name} enclosed entrance staircase has unrealistic proportions`);
    expect(station.airport||(diagnostic.parkingPresent&&diagnostic.parkingRailDistance>20),`${station.name} car park is missing or overlaps the railway`);
    expect(diagnostic.busStopPresent&&diagnostic.busShelterRailDistance>15,`${station.name} bus shelter is missing or intrudes into the platform corridor`);
    const surfaces=rail.walkSurfaces.filter(surface=>surface.stationId===station.id&&surface.role==="platform");expect(surfaces.length>=48,`${station.name} has no continuous curved walking surface`);
    const stationRoute=rail.routeForStation(station);
    for(const surface of surfaces){
      let nearest=Infinity;
      for(let sample=0;sample<=160;sample++){
        const along=(sample/160-.5)*station.platformLength,t=(station.t+along/stationRoute.baseLength+1)%1,p=stationRoute.curve.getPointAt(t);
        nearest=Math.min(nearest,Math.hypot(surface.centre.x-p.x,surface.centre.z-p.z));
      }
      expect(platformCentres.some(platformCentre=>Math.abs(nearest-Math.abs(platformCentre))<.65),`${station.name} platform departs from the curved track alignment`);
    }
  }
});

test("station buildings and lifts block walking instead of behaving as scenery",()=>{
  const scene=new THREE.Scene(),g=buildRoadGraph(),city=new CityBuilder(scene,g),built=city.build();city.initializeStreaming(new THREE.Vector3(-330,0,5),Math.PI/2,0);
  const rail=new RailSystem(scene,new THREE.PerspectiveCamera(),{isDown:()=>false,consume:()=>false},g,built.chunkManager,built.railPlan,()=>{},built.colliders),blocker=rail.walkBlockers[0];
  expect(blocker,"station structure blockers were not registered");
  expect(rail.resolveWalkSurface(blocker.centre.clone(),0).blocked,"player can walk through a station building or lift");
  const frontWall=rail.walkBlockers.find(item=>item.name==="front-left-wall"),lift=rail.walkBlockers.find(item=>item.name==="lift-tower"),bench=rail.walkBlockers.find(item=>item.name==="interior-bench");
  expect(frontWall&&frontWall.halfWidth<1.875&&frontWall.halfLength<.15,"station wall blocker still extends beyond its rendered wall mesh");
  expect(lift&&lift.halfWidth<1.6&&lift.halfLength<1.6,"lift blocker still uses or exceeds the full glass-box dimensions");
  expect(bench&&bench.halfWidth<1.075&&bench.halfLength<.275,"station bench blocker was not fitted inside the visible bench");
});


test("station foyers are hollow, walkable and provide a safe train exit point",()=>{
  const scene=new THREE.Scene(),g=buildRoadGraph(),city=new CityBuilder(scene,g),built=city.build();city.initializeStreaming(new THREE.Vector3(-330,0,5),Math.PI/2,0);
  const rail=new RailSystem(scene,new THREE.PerspectiveCamera(),{isDown:()=>false,consume:()=>false},g,built.chunkManager,built.railPlan,()=>{},built.colliders);
  const station=built.railPlan.stations.find(item=>item.entryPosition&&item.exitPosition&&item.interiorPosition);
  expect(station,"no station exposes entry, exit and interior positions");
  expect(!rail.resolveWalkSurface(station.interiorPosition.clone(),0.04).blocked,`${station.name} interior foyer is still blocked`);
  expect(!rail.resolveWalkSurface(station.exitPosition.clone(),station.exitPosition.y).blocked,`${station.name} train exit spawn is blocked`);
  expect(station.exitPosition.distanceTo(station.entryPosition)>1.5,`${station.name} exit spawn still overlaps the outside entrance`);
});


test("every station has separate open street and platform doorways",()=>{
  const scene=new THREE.Scene(),g=buildRoadGraph(),city=new CityBuilder(scene,g),built=city.build();city.initializeStreaming(new THREE.Vector3(-330,0,5),Math.PI/2,0);
  const rail=new RailSystem(scene,new THREE.PerspectiveCamera(),{isDown:()=>false,consume:()=>false},g,built.chunkManager,built.railPlan,()=>{},built.colliders);
  for(const station of built.railPlan.stations){
    const building=station.stationBuilding;expect(building,`${station.name} has no enclosed station-building definition`);
    for(const [from,to,height,label] of[
      [building.frontDoorOutside,building.frontDoorInside,.04,"street"],
      [building.rearDoorInside,building.rearDoorOutside,building.rearDoorOutside.y,"platform"]
    ])for(let step=0;step<=12;step++){
      const point=from.clone().lerp(to,step/12),sample=rail.resolveWalkSurface(point,height);
      expect(!sample.blocked,`${station.name} has an invisible collision wall in its ${label} doorway at step ${step}`);
    }
  }
  const streetLintels=rail.walkBlockers.filter(blocker=>(blocker.minimumHeight??0)>2&&(blocker.minimumHeight??0)<4);
  expect(streetLintels.length>=built.railPlan.stations.length,"station street-door lintels do not use elevated-only collision ranges");
  for(const lintel of streetLintels)expect(!rail.pointInsideWalkBlocker(lintel.centre.clone(),.04),"a street-door lintel still blocks a standing pedestrian at floor level");
});

test("every station building remains outside the running railway corridor",()=>{
  const scene=new THREE.Scene(),g=buildRoadGraph(),city=new CityBuilder(scene,g),built=city.build();city.initializeStreaming(new THREE.Vector3(-330,0,5),Math.PI/2,0);
  const rail=new RailSystem(scene,new THREE.PerspectiveCamera(),{isDown:()=>false,consume:()=>false},g,built.chunkManager,built.railPlan,()=>{},built.colliders);
  const required=WORLD_DEFINITION.rail.stationAccess.minimumBuildingTrackClearance;
  for(const station of built.railPlan.stations){
    const building=station.stationBuilding;
    expect(building?.minimumTrackClearance>=required,`${station.name} station building intrudes into the track corridor (${building?.minimumTrackClearance?.toFixed(2)} m)`);
    expect(building.platformLinkLength>=4.5,`${station.name} station hall is still attached directly to the platform edge instead of being set back from the railway`);
  }
});

test("station access uses enclosed realistic dog-leg stairs rather than one oversized straight flight",()=>{
  const scene=new THREE.Scene(),g=buildRoadGraph(),city=new CityBuilder(scene,g),built=city.build();city.initializeStreaming(new THREE.Vector3(-330,0,5),Math.PI/2,0);
  const rail=new RailSystem(scene,new THREE.PerspectiveCamera(),{isDown:()=>false,consume:()=>false},g,built.chunkManager,built.railPlan,()=>{},built.colliders);
  for(const station of built.railPlan.stations){
    const building=station.stationBuilding,flights=rail.walkSurfaces.filter(surface=>surface.stationId===station.id&&surface.type==="stairs"&&surface.role.startsWith("ground-platform-stairs-"));
    expect(building&&flights.length===2,`${station.name} does not have two enclosed dog-leg flights`);expect(building.halfWidth>=5.2,`${station.name} dog-leg hall is too narrow`);
    expect(building.stairPitch>=27&&building.stairPitch<=33,`${station.name} stair pitch is unrealistic (${building.stairPitch.toFixed(1)}°)`);
    expect(building.stairRoute.length>=10,`${station.name} has no complete street-to-platform route`);
    for(const flight of flights)for(const point of[flight.from,flight.to,flight.from.clone().lerp(flight.to,.5)]){
      const relative=point.clone().sub(building.centre).setY(0),along=relative.dot(building.forward),across=relative.dot(building.right);expect(Math.abs(along)<building.halfDepth-.18&&Math.abs(across)<building.halfWidth-.8,`${station.name} stair flight protrudes through the hall shell`);
    }
    const sideWallPoint=building.centre.clone().addScaledVector(building.right,building.halfWidth-.05);sideWallPoint.y=building.stairFlightRise;
    expect(rail.pointInsideWalkBlocker(sideWallPoint,building.stairFlightRise),`${station.name} stairs remain accessible through an exterior side wall`);
  }
});

test("a real walking player can traverse every dog-leg station hall from street to platform",()=>{
  const scene=new THREE.Scene(),g=buildRoadGraph(),city=new CityBuilder(scene,g),built=city.build();city.initializeStreaming(new THREE.Vector3(-330,0,5),Math.PI/2,0);
  const input={down:new Set(["KeyW"]),mouseDX:0,isDown(key){return this.down.has(key);},consume:()=>false};
  const camera=new THREE.PerspectiveCamera(),rail=new RailSystem(scene,camera,input,g,built.chunkManager,built.railPlan,()=>{},built.colliders),player=new PlayerController(scene,camera,input,g,built.colliders,()=>{});player.setRailSystem(rail);player.inVehicle=false;
  for(const station of built.railPlan.stations){
    const route=station.stationBuilding.stairRoute;camera.position.copy(route[0]);camera.position.y=route[0].y+1.72;
    for(let index=1;index<route.length;index++){
      const target=route[index];let reached=false,stuckFrames=0,last=camera.position.clone();
      for(let frame=0;frame<1400;frame++){
        const direction=target.clone().sub(camera.position);direction.y=0;if(direction.length()<.65&&Math.abs((camera.position.y-1.72)-target.y)<.65){reached=true;break;}
        player.walkYaw=Math.atan2(direction.x,direction.z);player.updateWalking(1/60);stuckFrames=camera.position.distanceTo(last)<1e-5?stuckFrames+1:0;last.copy(camera.position);if(stuckFrames>100)break;
      }
      expect(reached,`${station.name} cannot reach dog-leg station waypoint ${index}`);
    }
  }
});

test("HST services maintain forward station order in both directions",()=>{
  const plan=createRailPlan(),a=plan.stations[0],b=plan.stations[1];
  expect(forwardArcDistance(a.t,b.t,1,plan.length)>0,"clockwise station distance invalid");
  expect(forwardArcDistance(b.t,a.t,-1,plan.length)>0,"counter-clockwise station distance invalid");
});

test("open platform-side HST doors allow passenger boarding without taking over the cab",()=>{
  const scene=new THREE.Scene(),g=buildRoadGraph(),city=new CityBuilder(scene,g),built=city.build();city.initializeStreaming(new THREE.Vector3(-330,0,5),Math.PI/2,0);
  const input={isDown:()=>false,consume:()=>false,mouseDX:0},camera=new THREE.PerspectiveCamera(),rail=new RailSystem(scene,camera,input,g,built.chunkManager,built.railPlan,()=>{},built.colliders);
  const train=rail.trains[0],station=built.railPlan.stations[0];train.progress=station.t;train.currentStation=station;train.nextStation=station;train.speed=0;train.dwell=9;rail.updateTrainPlacement(train);for(let i=0;i<90;i++)rail.updateTrainDoors(train,1/60);
  const coach=train.formation.vehicles[3],door=coach.userData.passengerDoors.find(item=>item.side===train.platformSide),world=rail.doorWorldPosition(coach,door,.72);camera.position.copy(world);
  const player={inVehicle:false,inTrain:false,inBus:false,walkYaw:0,position:new THREE.Vector3()};const candidate=rail.nearestBoardableTrain(camera.position);
  expect(candidate?.access==="passenger"&&candidate.train===train,"open passenger doorway was not detected");expect(rail.handleInteract(player),"passenger interaction was not consumed");
  expect(player.inTrain&&rail.playerTrain===train&&rail.playerTrainMode==="passenger"&&!train.manual,"passenger boarding incorrectly took control of the train");
});

test("passenger position remains attached to a moving carriage",()=>{
  const scene=new THREE.Scene(),g=buildRoadGraph(),city=new CityBuilder(scene,g),built=city.build();city.initializeStreaming(new THREE.Vector3(-330,0,5),Math.PI/2,0);
  const input={isDown:()=>false,consume:()=>false,mouseDX:0},camera=new THREE.PerspectiveCamera(),rail=new RailSystem(scene,camera,input,g,built.chunkManager,built.railPlan,()=>{},built.colliders),train=rail.trains[0],coach=train.formation.vehicles[2];
  const player={inVehicle:false,inTrain:true,inBus:false,walkYaw:0,position:new THREE.Vector3()};rail.playerTrain=train;rail.playerTrainMode="passenger";rail.passengerState={train,vehicle:coach,vehicleIndex:2,localPosition:new THREE.Vector3(0,coach.userData.interior.floorY,0),yaw:0};
  rail.updateTrainPlacement(train);rail.updatePassengerRide(train,1/60,player);const before=camera.position.clone(),localBefore=rail.passengerState.localPosition.clone();train.progress=(train.progress+.015)%1;rail.updateTrainPlacement(train);rail.updatePassengerRide(train,1/60,player);
  expect(camera.position.distanceTo(before)>2,"passenger camera was left behind by the moving train");expect(rail.passengerState.localPosition.distanceTo(localBefore)<.001,"passenger slid inside the carriage without input");
});


test("passengers can walk through open gangways between adjacent Mark 3 coaches",()=>{
  const front=createMark3Coach(0),rear=createMark3Coach(1);front.position.z=16;front.updateMatrixWorld(true);rear.updateMatrixWorld(true);
  const input={isDown:key=>key==="KeyW",consume:()=>false,mouseDX:0},camera=new THREE.PerspectiveCamera(),train={formation:{vehicles:[front,rear]}},rail=Object.create(RailSystem.prototype),player={walkYaw:0,position:new THREE.Vector3()};
  rail.input=input;rail.camera=camera;rail.passengerState={train,vehicle:rear,vehicleIndex:1,localPosition:new THREE.Vector3(0,rear.userData.interior.floorY,rear.userData.interior.halfLength-.05),yaw:0};
  rail.updatePassengerRide(train,.2,player);
  expect(rail.passengerState.vehicleIndex===0,"passenger was blocked at the connecting door between coaches");expect(rail.passengerState.vehicle.userData.type==="mark3-coach","gangway transition did not enter an adjacent passenger carriage");expect(front.userData.connectingDoors.every(door=>door.open),"coach gangway doors are not open and walkable");
});

test("closed coach walls block walking while open platform doors remain boardable",()=>{
  const scene=new THREE.Scene(),g=buildRoadGraph(),city=new CityBuilder(scene,g),built=city.build();city.initializeStreaming(new THREE.Vector3(-330,0,5),Math.PI/2,0);
  const rail=new RailSystem(scene,new THREE.PerspectiveCamera(),{isDown:()=>false,consume:()=>false,mouseDX:0},g,built.chunkManager,built.railPlan,()=>{},built.colliders),train=rail.trains[0],coach=train.formation.vehicles[1];rail.updateTrainPlacement(train);
  const closedPoint=coach.localToWorld(new THREE.Vector3(1.2,1.2,0));expect(rail.blocksWalking(closedPoint.clone().add(new THREE.Vector3(2,0,0)),closedPoint,0),"closed carriage wall does not block the player");
  train.currentStation=rail.plan.stations[0];train.speed=0;train.dwell=8;for(let i=0;i<90;i++)rail.updateTrainDoors(train,1/60);const door=coach.userData.passengerDoors.find(item=>item.side===train.platformSide),doorPoint=coach.localToWorld(new THREE.Vector3(door.side*1.2,1.2,door.z));expect(!rail.blocksWalking(doorPoint.clone().add(new THREE.Vector3(2,0,0)),doorPoint,0),"open passenger doorway remains blocked");
});


test("alighting from a passenger carriage places the player on the platform and movement resumes immediately",()=>{
  const scene=new THREE.Scene(),camera=new THREE.PerspectiveCamera(),g=buildRoadGraph(),city=new CityBuilder(scene,g),built=city.build();city.initializeStreaming(new THREE.Vector3(-330,0,5),Math.PI/2,0);
  const input={down:new Set(),mouseDX:0,isDown(key){return this.down.has(key);},consume:()=>false},player=new PlayerController(scene,camera,input,g,built.colliders,()=>{}),rail=new RailSystem(scene,camera,input,g,built.chunkManager,built.railPlan,()=>{},built.colliders);player.setRailSystem(rail);
  const train=rail.trains[0],station=built.railPlan.stations[0];train.progress=station.t;train.currentStation=station;train.nextStation=station;train.speed=0;train.dwell=10;rail.updateTrainPlacement(train);for(let i=0;i<120;i++)rail.updateTrainDoors(train,1/60);
  const coach=train.formation.vehicles.find(vehicle=>vehicle.userData.type==="mark3-coach"),door=coach.userData.passengerDoors.find(item=>item.side===train.platformSide);camera.position.copy(rail.doorWorldPosition(coach,door,.72));camera.position.y+=.65;player.inVehicle=false;
  expect(rail.handleInteract(player)&&rail.playerTrainMode==="passenger","passenger could not board before the alighting test");rail.passengerState.localPosition.z=door.z;for(let i=0;i<8;i++)rail.update(1/60,i/60,player);
  expect(rail.handleInteract(player)&&!player.inTrain,"passenger could not alight through the open door");const feetY=camera.position.y-1.72,surface=rail.resolveWalkSurface(new THREE.Vector3(camera.position.x,feetY,camera.position.z),feetY);expect(!surface.blocked&&Math.abs(surface.height-feetY)<.05,"alighting did not place the player on the platform walk surface");
  const before=camera.position.clone();input.down.add("KeyW");for(let i=0;i<45;i++)player.updateWalking(1/60);expect(camera.position.distanceTo(before)>1.5,"player remained frozen after leaving the passenger carriage");
});


test("Mark 3 coaches use one fixed window-aligned 2+2 passenger layout",()=>{
  const coach=createMark3Coach(0,"executive"),interior=coach.userData.interior;
  expect(interior.layout==="fixed-mark3-standard-class","coach interior is generic or configurable");
  expect(interior.seatingArrangement==="2+2"&&interior.seatCount===32,"fixed 2+2 seating layout is incomplete");
  expect(coach.userData.seats.length===32&&coach.userData.tables.length===8,"seat or table count changed");
  expect(coach.userData.luggageRacks.length===2&&coach.userData.pisDisplays.length===2,"luggage racks or passenger displays are missing");
  expect(coach.userData.windowMeshes.length===16,"coach windows do not match eight bays per side");
  for(const windowMesh of coach.userData.windowMeshes)expect(windowMesh.material.transparent&&windowMesh.material.opacity<=.4,"coach window is opaque");
  const rowPositions=[...new Set(coach.userData.seats.map(seat=>Number(seat.position.z.toFixed(3))))];
  expect(rowPositions.length===interior.windowZ.length,"seat rows do not match window bays");
  for(const z of rowPositions)expect(interior.windowZ.some(windowZ=>Math.abs(windowZ-z)<.01),`seat row ${z} is not window-aligned`);
});

test("Mark 3 passenger windows are genuine transparent apertures at eye height",()=>{
  const coach=createMark3Coach(),interior=coach.userData.interior;coach.updateMatrixWorld(true);
  expect(interior.eyeY>interior.windowBottom&&interior.eyeY<interior.windowTop,"passenger eye height does not intersect the window opening");
  for(const side of[-1,1])for(const z of interior.windowZ){
    const ray=new THREE.Raycaster(new THREE.Vector3(0,interior.eyeY,z),new THREE.Vector3(side,0,0),0,1.55),hits=ray.intersectObject(coach,true);
    expect(hits.length>0,`window ray at side ${side}, z ${z} found no glazing`);
    expect(hits.every(hit=>hit.object.material?.transparent===true),`opaque coach geometry remains behind window at side ${side}, z ${z}`);
  }
});

test("fully open Mark 3 passenger doors expose the carriage interior",()=>{
  const coach=createMark3Coach();
  for(const door of coach.userData.passengerDoors){
    expect(door.aperture?.isGroup&&!door.aperture.isMesh,"door aperture is still a solid rectangular mesh");
    for(const leaf of door.leaves)leaf.group.position.z=leaf.baseZ+leaf.slide;
  }
  coach.updateMatrixWorld(true);
  for(const door of coach.userData.passengerDoors){
    const origin=new THREE.Vector3(door.side*2,1.80,door.z),direction=new THREE.Vector3(-door.side,0,0),hits=new THREE.Raycaster(origin,direction,0,1.05).intersectObject(coach,true);
    expect(hits.length===0,`open doorway at side ${door.side}, z ${door.z} is still visually blocked`);
  }
});

test("passenger mode requests immersive look control and rotates freely",()=>{
  const scene=new THREE.Scene(),g=buildRoadGraph(),city=new CityBuilder(scene,g),built=city.build();city.initializeStreaming(new THREE.Vector3(-330,0,5),0,0);
  const input={mouseDX:120,mouseDY:-35,isDown:()=>false,consume:()=>false},camera=new THREE.PerspectiveCamera(),rail=new RailSystem(scene,camera,input,g,built.chunkManager,built.railPlan,()=>{},built.colliders),train=rail.trains[0],coach=train.formation.vehicles.find(vehicle=>vehicle.userData.type==="mark3-coach");
  rail.playerTrain=train;rail.playerTrainMode="passenger";rail.passengerState={train,vehicle:coach,vehicleIndex:train.formation.vehicles.indexOf(coach),localPosition:new THREE.Vector3(0,coach.userData.interior.floorY,0),yaw:0,pitch:0,rideTime:0};rail.updateTrainPlacement(train);
  const player={inTrain:true,inVehicle:false,inBus:false,walkYaw:0,position:new THREE.Vector3()},beforeYaw=rail.passengerState.yaw;rail.pendingPassengerLookDX=120;rail.pendingPassengerLookDY=-35;
  expect(rail.wantsPointerLock(),"passenger mode does not request pointer-lock look control");rail.updatePassengerRide(train,1/60,player);
  expect(Math.abs(rail.passengerState.yaw-beforeYaw)>.1,"horizontal passenger look input was ignored");
  expect(Math.abs(rail.passengerState.pitch)>.01,"vertical passenger look input was ignored");
  const consumedYaw=rail.passengerState.yaw;rail.updatePassengerRide(train,1/60,player);expect(Math.abs(rail.passengerState.yaw-consumedYaw)<1e-9,"one mouse movement was applied repeatedly across fixed steps");
  rail.playerTrainMode="driver";expect(!rail.wantsPointerLock(),"driving cab incorrectly requests passenger pointer-lock mode");
});

test("Mark 3 interior geometry remains inside the exterior carriage envelope",()=>{
  const coach=createMark3Coach(),box=new THREE.Box3().setFromObject(coach.userData.interiorGroup);
  expect(box.min.x>=-1.25&&box.max.x<=1.25,"interior clips through a carriage side");
  expect(box.min.z>=-7.18&&box.max.z<=7.18,"interior clips through a carriage end");
  expect(box.min.y>=.90&&box.max.y<=3.36,"interior clips through the floor or roof");
  expect(coach.userData.passengerDoors.every(door=>coach.userData.interior.doorZ.some(z=>Math.abs(z-door.z)<.01)),"interior and exterior door positions are misaligned");
});

test("detailed train interiors render only near the player or while occupied",()=>{
  const scene=new THREE.Scene(),g=buildRoadGraph(),city=new CityBuilder(scene,g),built=city.build(),focus=built.railPlan.mainRoute.curve.getPointAt(0);city.initializeStreaming(focus,0,0);
  const camera=new THREE.PerspectiveCamera(),rail=new RailSystem(scene,camera,{isDown:()=>false,consume:()=>false,mouseDX:0,mouseDY:0},g,built.chunkManager,built.railPlan,()=>{},built.colliders),train=rail.trains.find(candidate=>candidate.routeId==="city");
  train.progress=0;rail.updateTrainPlacement(train);const player={inVehicle:true,position:train.headPosition.clone().add(new THREE.Vector3(CONFIG.trainInteriorDistance+12,0,0))};
  expect(rail.updateTrainVisibility(train,player)==="full","nearby train exterior did not remain detailed");
  for(const vehicle of train.formation.vehicles.filter(vehicle=>vehicle.userData.interiorGroup)){
    const shouldBeVisible=vehicle.position.distanceToSquared(player.position)<CONFIG.trainInteriorDistance*CONFIG.trainInteriorDistance;
    expect(vehicle.userData.interiorGroup.visible===shouldBeVisible,"carriage interior visibility was not based on its own distance from the player");
  }
  rail.playerTrain=train;rail.updateTrainVisibility(train,player);expect(train.formation.vehicles.filter(vehicle=>vehicle.userData.interiorGroup).every(vehicle=>vehicle.userData.interiorGroup.visible),"occupied train interior was culled");
});

test("nearby open-door coaches keep their interiors visible independently of train-head distance",()=>{
  const scene=new THREE.Scene(),g=buildRoadGraph(),city=new CityBuilder(scene,g),built=city.build();city.initializeStreaming(new THREE.Vector3(-330,0,5),0,0);
  const camera=new THREE.PerspectiveCamera(),rail=new RailSystem(scene,camera,{isDown:()=>false,consume:()=>false,mouseDX:0,mouseDY:0},g,built.chunkManager,built.railPlan,()=>{},built.colliders),train=rail.trains[0];
  rail.updateTrainPlacement(train);built.chunkManager.neighbourhoodKeys.add(chunkKeyForPosition(train.headPosition,built.chunkManager.chunkSize));const coaches=train.formation.vehicles.filter(vehicle=>vehicle.userData.type==="mark3-coach"),rearCoach=coaches.at(-1),frontCoach=coaches[0],player={inVehicle:true,position:rearCoach.position.clone()};
  expect(rail.updateTrainVisibility(train,player)==="full","formation was not kept in detailed visual range");
  expect(rearCoach.userData.interiorGroup.visible,"nearby rear-coach interior was hidden behind an open-door LOD decision");
  if(frontCoach.position.distanceToSquared(player.position)>CONFIG.trainInteriorDistance*CONFIG.trainInteriorDistance)expect(!frontCoach.userData.interiorGroup.visible,"distant coach interior remained unnecessarily visible");
});

test("moving trains lock every door and stopped trains open every platform-served side",()=>{
  const scene=new THREE.Scene(),g=buildRoadGraph(),city=new CityBuilder(scene,g),built=city.build();city.initializeStreaming(new THREE.Vector3(-330,0,5),0,0);
  const rail=new RailSystem(scene,new THREE.PerspectiveCamera(),{isDown:()=>false,consume:()=>false,mouseDX:0,mouseDY:0},g,built.chunkManager,built.railPlan,()=>{},built.colliders),train=rail.trains[0],station=train.route.stations[0];
  train.progress=station.t;train.currentStation=station;train.dwell=9;train.speed=8;for(let i=0;i<120;i++)rail.updateTrainDoors(train,1/60);
  expect(train.formation.vehicles.flatMap(vehicle=>vehicle.userData.passengerDoors??[]).every(door=>door.amount===0),"a door opened while the train was moving");
  train.speed=0;for(let i=0;i<120;i++)rail.updateTrainDoors(train,1/60);
  const doors=train.formation.vehicles.flatMap(vehicle=>vehicle.userData.passengerDoors??[]);
  expect((train.openDoorSides??[]).length>0,"train did not detect any platform-served door side");
  expect(doors.filter(door=>(train.openDoorSides??[]).includes(door.side)).every(door=>door.amount>.95),"a platform-served door side did not open");
  expect(doors.filter(door=>!(train.openDoorSides??[]).includes(door.side)).every(door=>door.amount===0),"a non-platform door side opened");
});

test("alighting fully detaches the player from subsequent train movement",()=>{
  const scene=new THREE.Scene(),camera=new THREE.PerspectiveCamera(),g=buildRoadGraph(),city=new CityBuilder(scene,g),built=city.build();city.initializeStreaming(new THREE.Vector3(-330,0,5),0,0);
  const input={down:new Set(),mouseDX:0,mouseDY:0,isDown(key){return this.down.has(key);},consume:()=>false},player=new PlayerController(scene,camera,input,g,built.colliders,()=>{}),rail=new RailSystem(scene,camera,input,g,built.chunkManager,built.railPlan,()=>{},built.colliders);player.setRailSystem(rail);
  const train=rail.trains[0],station=train.route.stations[0];train.progress=station.t;train.currentStation=station;train.nextStation=station;train.speed=0;train.dwell=9;rail.updateTrainPlacement(train);for(let i=0;i<120;i++)rail.updateTrainDoors(train,1/60);
  const coach=train.formation.vehicles.find(vehicle=>vehicle.userData.type==="mark3-coach"),door=coach.userData.passengerDoors.find(candidate=>candidate.side===train.platformSide);camera.position.copy(rail.doorWorldPosition(coach,door,.72)).add(new THREE.Vector3(0,.65,0));player.inVehicle=false;
  expect(rail.handleInteract(player),"player could not board");rail.passengerState.localPosition.z=door.z;expect(rail.handleInteract(player),"player could not alight");
  const detached=camera.position.clone();train.progress=(train.progress+.04)%1;rail.updateTrainPlacement(train);
  expect(!rail.playerTrain&&!rail.passengerState&&!player.inTrain,"passenger state survived alighting");
  expect(camera.position.distanceTo(detached)<1e-6,"moving train continued to carry the detached player");
});

test("airport-loop passengers alight onto the shared Industrial Exchange platform",()=>{
  const scene=new THREE.Scene(),g=buildRoadGraph(),city=new CityBuilder(scene,g),built=city.build();city.initializeStreaming(new THREE.Vector3(330,0,443),0,0);
  const rail=new RailSystem(scene,new THREE.PerspectiveCamera(),{isDown:()=>false,consume:()=>false,mouseDX:0,mouseDY:0},g,built.chunkManager,built.railPlan,()=>{},built.colliders),train=rail.trains.find(candidate=>candidate.routeId==="airport"),station=train.route.stations.find(candidate=>candidate.sharedPhysicalStationId);
  train.progress=station.t;train.currentStation=station;train.speed=0;train.dwell=9;rail.updateTrainPlacement(train);for(let index=0;index<120;index++)rail.updateTrainDoors(train,1/60);
  const coach=train.formation.vehicles.find(vehicle=>vehicle.userData.type==="mark3-coach"),door=coach.userData.passengerDoors.find(candidate=>candidate.side===train.platformSide),feet=rail.safePassengerAlightPosition(train,coach,door),surface=rail.resolveWalkSurface(feet,feet.y);
  expect(!surface.blocked,"shared interchange alighting point is blocked");
  expect(Math.abs(surface.height-feet.y)<.05,"airport-loop passenger was not placed on the physical Industrial Exchange platform");
});



test("dual-platform stations open both door sides and alight onto the chosen platform side",()=>{
  const scene=new THREE.Scene(),camera=new THREE.PerspectiveCamera(),g=buildRoadGraph(),city=new CityBuilder(scene,g),built=city.build();city.initializeStreaming(new THREE.Vector3(-330,0,5),0,0);
  const input={down:new Set(),mouseDX:0,mouseDY:0,isDown(key){return this.down.has(key);},consume:()=>false},player=new PlayerController(scene,camera,input,g,built.colliders,()=>{}),rail=new RailSystem(scene,camera,input,g,built.chunkManager,built.railPlan,()=>{},built.colliders);player.setRailSystem(rail);
  const train=rail.trains[0],station=train.route.stations[0];train.progress=station.t;train.currentStation=station;train.nextStation=station;train.speed=0;train.dwell=10;rail.updateTrainPlacement(train);for(let i=0;i<120;i++)rail.updateTrainDoors(train,1/60);
  expect((train.openDoorSides??[]).includes(-1)&&(train.openDoorSides??[]).includes(1),"test station does not expose platforms on both sides of the train");
  const coach=train.formation.vehicles.find(vehicle=>vehicle.userData.type==="mark3-coach");
  const leftDoor=coach.userData.passengerDoors.find(door=>door.side===-1),rightDoor=coach.userData.passengerDoors.find(door=>door.side===1);
  const leftFeet=rail.safePassengerAlightPosition(train,coach,leftDoor),rightFeet=rail.safePassengerAlightPosition(train,coach,rightDoor);
  const leftDelta=leftFeet.clone().sub(coach.position).setY(0),rightDelta=rightFeet.clone().sub(coach.position).setY(0),rightVector=new THREE.Vector3(1,0,0).applyQuaternion(coach.quaternion).setY(0).normalize();
  expect(leftDelta.dot(rightVector)<0,"left-side door did not place the player on the left platform");
  expect(rightDelta.dot(rightVector)>0,"right-side door did not place the player on the right platform");
  camera.position.copy(rail.doorWorldPosition(coach,leftDoor,.72)).add(new THREE.Vector3(0,.65,0));player.inVehicle=false;
  expect(rail.handleInteract(player),"player could not board through the left-side doorway");
  rail.passengerState.localPosition.set(leftDoor.side*.72,coach.userData.interior.floorY,leftDoor.z);
  expect(rail.handleInteract(player),"player could not alight through the left-side doorway");
  const leftExitSide=camera.position.clone().sub(coach.position).setY(0).dot(rightVector);
  expect(leftExitSide<0,"left-side alighting emerged on the wrong platform side");
});


test("railway operating speeds use the configured 2x multiplier",()=>{
  expect(CONFIG.trainSpeedMultiplier===2,"train speed multiplier is not 2x");
  const scene=new THREE.Scene(),g=buildRoadGraph(),city=new CityBuilder(scene,g),built=city.build();city.initializeStreaming(new THREE.Vector3(-330,0,5),0,0);
  const rail=new RailSystem(scene,new THREE.PerspectiveCamera(),{isDown:()=>false,consume:()=>false,mouseDX:0,mouseDY:0},g,built.chunkManager,built.railPlan,()=>{},built.colliders);
  for(const train of rail.trains){
    const route=train.route,baseServiceLimit=train.service.serviceType==="Express"?Math.min(route.designSpeedMps,52):route.urbanLineSpeedMps;
    expect(Math.abs(train.service.maximumSpeed-baseServiceLimit*2)<1e-6,`${train.id} service speed is not doubled`);
    expect(Math.abs(train.routeLimit-Math.min(route.urbanLineSpeedMps*2,train.service.maximumSpeed))<1e-6,`${train.id} route speed is not doubled`);
    expect(Math.abs(train.designLimit-Math.min(route.designSpeedMps*2,train.service.maximumSpeed))<1e-6,`${train.id} design speed is not doubled`);
  }
  expect(rail.network.blocks.some(block=>block.speedLimit>rail.network.route(block.routeId).urbanLineSpeedMps),"operational block limits did not increase beyond the original line speeds");
});

test("researched Class 43 power cars include recognisable front and engine-room details",()=>{
  const scene=new THREE.Scene(),formation=createHSTFormation(scene,{id:"HST-001",coachCount:5});
  const power=formation.vehicles[0];
  expect(formation.livery==="classic","first set should use the original InterCity 125 reference livery");
  expect(power.userData.frontLights.length===4,"paired Class 43 front light clusters missing");
  expect(power.userData.tailLights.length===2,"tail-light pair missing");
  expect(power.userData.exhaustPorts.length===2,"roof exhaust reference points missing");
  expect(power.children.length>90,"power car does not contain the researched detail set");
});

test("the five HST services expose multiple historically grounded visual schemes",()=>{
  const scene=new THREE.Scene();
  const formations=[];for(let i=1;i<=5;i++)formations.push(createHSTFormation(scene,{id:`HST-${String(i).padStart(3,"0")}`,coachCount:5}));
  expect(new Set(formations.map(f=>f.livery)).size===5,"fleet livery research was not applied across all five services");
});

test("airport aircraft complete a gate-to-gate operating cycle",()=>{
  const scene=new THREE.Scene(),airport=new AirportSystem(scene,WORLD_DEFINITION.airport,null),initial=airport.completedCycles;
  for(let i=0;i<520;i++)airport.update(.5,i*.5);
  expect(airport.completedCycles>initial,"no aircraft completed a gate-to-gate cycle");expect(airport.aircraft.every(a=>Number.isFinite(a.mesh.position.x)&&Number.isFinite(a.mesh.position.y)),"aircraft produced invalid transforms");
});


test("airport realism geometry stays aligned to the authored UK-style layout",()=>{
  const scene=new THREE.Scene(),airport=new AirportSystem(scene,WORLD_DEFINITION.airport,null),d=WORLD_DEFINITION.airport,names=[];airport.group.traverse(object=>{if(object.name)names.push(object.name);});
  expect(airport.runwayDesignators.join("/")==="09/27",`runway designators ${airport.runwayDesignators.join("/")} do not match the simulated east-west bearing`);
  expect(airport.standLocalZ>d.taxiwayOffset&&airport.standLocalZ<d.terminalOffset-10,"stands are not between taxiway and terminal airside edge");
  expect(airport.aircraft.every(aircraft=>airport.isRestrictedPosition(aircraft.parkedPosition)),"parked aircraft are no longer on restricted airside stands");
  expect(names.filter(name=>name.includes("airport-runway-threshold-bar")).length===16,"runway threshold markings are incomplete");
  expect(names.includes("airport-runway-edge-lights")&&names.includes("airport-threshold-lights")&&names.includes("airport-runway-end-lights"),"runway lighting set is incomplete");
  expect(names.filter(name=>/airport-jetway-\d-cabin/.test(name)).length===4,"four articulated jetway cabins were not built");
  expect(names.includes("airport-control-tower-cab")&&names.includes("airport-windsock"),"airport-specific tower or windsock detail is missing");
});

test("airport runway occupancy holds a second departure clear of the runway",()=>{
  const scene=new THREE.Scene(),airport=new AirportSystem(scene,WORLD_DEFINITION.airport,null),lead=airport.aircraft[0],waiting=airport.aircraft[1];
  airport.transition(lead,"takeoff");waiting.state="taxiOut";waiting.progress=.999;waiting.stateTime=1;airport.update(.5,1);
  expect(airport.runwayOwnerId===lead.id,"runway ownership changed while the lead aircraft was taking off");
  expect(waiting.state==="taxiOut"&&waiting.progress<1&&waiting.speed===0,"second departure entered an occupied runway");
});

test("airport access remains public while runway and apron are restricted",()=>{
  const scene=new THREE.Scene(),airport=new AirportSystem(scene,WORLD_DEFINITION.airport,null),d=WORLD_DEFINITION.airport;
  const forward=new THREE.Vector3(Math.sin(d.heading),0,Math.cos(d.heading)),right=new THREE.Vector3(forward.z,0,-forward.x),point=(x,z)=>new THREE.Vector3(d.x,0,d.z).addScaledVector(forward,x).addScaledVector(right,z);
  expect(!airport.isRestrictedPosition(point(d.accessLocal.x,d.accessLocal.z)),"airport public access road is incorrectly restricted");
  expect(airport.isRestrictedPosition(point(0,0)),"airport runway is not treated as restricted airside");
});

test("player world bounds include the airport and its approach road",()=>{
  const scene=new THREE.Scene(),camera=new THREE.PerspectiveCamera(),g=buildRoadGraph(),input={isDown:()=>false,consume:()=>false,mouseDX:0};
  const player=new PlayerController(scene,camera,input,g,[],()=>{}),airportNode=g.nodes.get(WORLD_DEFINITION.airport.accessNode);
  expect(player.worldBounds.maxX>WORLD_DEFINITION.airport.x+150,"player movement bounds still cut off the airport runway");
  expect(player.worldBounds.maxZ>airportNode.position.z+100,"player movement bounds still cut off the airport access road");
});

test("police offences require observation and create routed response units",()=>{
  const scene=new THREE.Scene(),g=buildRoadGraph(),signals=new TrafficSignals(scene,g),player={position:g.nodes.get("CBD").position.clone(),inVehicle:true,speed:25,nearestLaneId:"A1-Central East:fwd:1",nearestLaneT:.4,laneAlignment:1,roadDistance:0},traffic=new TrafficSystem(scene,g,signals,player),police=new PoliceSystem(scene,g,traffic,signals,player,()=>{});
  expect(!police.report("speeding",0,{observed:false})&&police.wantedLevel===0,"unobserved offence was unfairly enforced");expect(police.report("speeding",1,{observed:true}),"observed offence was not recorded");expect(police.wantedLevel===1&&police.units.length===1,"police response unit was not routed");
});


test("police replace a response unit that remains stuck away from the player",()=>{
  const scene=new THREE.Scene(),g=buildRoadGraph(),signals=new TrafficSignals(scene,g),player={position:g.nodes.get("CBD").position.clone(),inVehicle:true,speed:20,nearestLaneId:"A1-Central East:fwd:1",nearestLaneT:.4,laneAlignment:1,roadDistance:0},traffic=new TrafficSystem(scene,g,signals,player),police=new PoliceSystem(scene,g,traffic,signals,player,()=>{});
  police.report("speeding",1,{observed:true});const first=police.units[0];first.vehicle.speed=0;first.vehicle.mesh.position.set(600,0,600);first.lastPosition.copy(first.vehicle.mesh.position);police.recoverStuckUnits(8);
  expect(police.units.length===1,"stuck police unit was not replaced");expect(police.units[0]!==first,"police pursuit kept the same immobilised unit");
});

test("pedestrians use pavement offsets and expose articulated walking models",()=>{
  const scene=new THREE.Scene(),g=buildRoadGraph(),signals=new TrafficSignals(scene,g),peds=new PedestrianSystem(scene,g,signals);peds.populate(12);peds.update(.05,1,"clear");
  expect(peds.agents.length===12,"pedestrian population failed");const agent=peds.agents[0],sample=agent.mesh.userData.limbs;expect(sample?.legs.length===2&&sample?.arms.length===2,"pedestrian model is not articulated");const nearest=g.nearestLane(agent.mesh.position);expect(nearest.distance>2.2,"pedestrian is walking in a traffic lane rather than on the pavement");
});

test("a player can board and leave a stopped scheduled bus",()=>{
  const scene=new THREE.Scene(),g=buildRoadGraph(),signals=new TrafficSignals(scene,g),camera=new THREE.PerspectiveCamera();
  const player={position:new THREE.Vector3(999,0,999),inVehicle:false,inTrain:false,inBus:false,walkYaw:0};
  const traffic=new TrafficSystem(scene,g,signals,player),input={consume:()=>false},transit=new TransitSystem(scene,g,traffic,camera,input,player,()=>{});
  const bus=transit.buses[0];bus.speed=0;bus.dwell=6;bus.dwellReason="bus-stop";bus.mesh.userData.doorsOpen=true;traffic.place(bus);
  camera.position.copy(transit.busDoorWorld(bus)).add(new THREE.Vector3(0,0,1));
  expect(transit.handleInteract(player),"bus interaction was not consumed");
  expect(player.inBus&&transit.playerBus===bus&&bus.playerOccupied,"player did not enter the bus");
  expect(transit.handleInteract(player),"bus exit interaction was not consumed");
  expect(!player.inBus&&!bus.playerOccupied,"player did not leave the bus at the stop");
});

test("outer-platform expansion keeps every station hall completely clear of roads",()=>{
  const scene=new THREE.Scene(),g=buildRoadGraph(),city=new CityBuilder(scene,g),built=city.build();city.initializeStreaming(new THREE.Vector3(-330,0,5),0,0);
  const rail=new RailSystem(scene,new THREE.PerspectiveCamera(),{isDown:()=>false,consume:()=>false,mouseDX:0,mouseDY:0},g,built.chunkManager,built.railPlan,()=>{},built.colliders);
  for(const station of built.railPlan.stations){
    const building=station.stationBuilding,clearance=rail.orientedRoadClearance(building.centre,building.forward,building.right,building.halfDepth,building.halfWidth);
    expect(clearance>=.75,`${station.name} station hall overlaps a road (${clearance.toFixed(2)} m)`);
    expect(Math.abs(clearance-building.minimumRoadClearance)<.05,`${station.name} station road-clearance metadata is stale`);
  }
});

test("expanded four-track railway operates twelve evenly distributed HST services",()=>{
  const scene=new THREE.Scene(),g=buildRoadGraph(),city=new CityBuilder(scene,g),built=city.build();city.initializeStreaming(new THREE.Vector3(-330,0,5),0,0);
  const rail=new RailSystem(scene,new THREE.PerspectiveCamera(),{isDown:()=>false,consume:()=>false,mouseDX:0,mouseDY:0},g,built.chunkManager,built.railPlan,()=>{},built.colliders);
  expect(rail.trains.length===12,`expected 12 HST services, found ${rail.trains.length}`);
  for(const route of built.railPlan.routes)expect(rail.trains.filter(train=>train.routeId===route.id).length===6,`${route.name} does not have six services`);
  for(const trackIndex of[0,1,2,3]){
    const services=rail.trains.filter(train=>train.trackIndex===trackIndex);
    expect(services.length===3,`track ${trackIndex+1} does not have three services`);
    expect(new Set(services.map(train=>train.direction)).size===1,`track ${trackIndex+1} has conflicting directions`);
  }
});


test("operational rail graph keeps every running line continuous",()=>{
  const plan=createRailPlan(WORLD_DEFINITION,buildRoadGraph()),network=new RailNetwork(plan);expect(network.validate().length===0,network.validate().join("; "));
  for(const route of plan.routes)for(let trackIndex=0;trackIndex<4;trackIndex++)for(const block of network.lineBlocks(route.id,trackIndex))expect(network.nextBlock(block,block.direction),`${block.id} is a dead end`);
});

test("all five platforms remain operationally reachable from valid tracks",()=>{
  const plan=createRailPlan(WORLD_DEFINITION,buildRoadGraph()),network=new RailNetwork(plan);
  for(const platform of network.platforms)expect([...platform.compatibleTracksByRoute.values()].some(tracks=>tracks.length),`${platform.id} has no compatible track`);
  for(const station of plan.stations)expect(network.platformsForStation(station).length===5,`${station.name} does not expose five operational platforms`);
});

test("block reservations reject occupied and conflicting railway authority",()=>{
  const network=new RailNetwork(createRailPlan(WORLD_DEFINITION,buildRoadGraph())),blocks=new RailBlockSystem(network),block=network.blocks[0];block.occupiedBy.add("HST-A");expect(!blocks.reserveBlocks({id:"HST-B",direction:block.direction},[block]),"occupied block accepted another train reservation");block.occupiedBy.clear();expect(blocks.reserveBlocks({id:"HST-A",direction:block.direction},[block]),"clear block rejected its first reservation");expect(!blocks.reserveBlocks({id:"HST-B",direction:block.direction},[block]),"reserved block accepted a conflicting train");
});

test("airport junction interlocking locks points and rejects conflicting routes",()=>{
  const network=new RailNetwork(createRailPlan(WORLD_DEFINITION,buildRoadGraph())),blocks=new RailBlockSystem(network),interlocking=new RailInterlocking(network,blocks),a={id:"A",trackIndex:0,direction:1},b={id:"B",trackIndex:0,direction:1};
  expect(interlocking.request(a,"city","airport").granted,"first junction route was denied");expect(!interlocking.request(b,"airport","city").granted,"conflicting route cleared simultaneously");expect(!interlocking.canPointsMove("junction:industrial-exchange"),"points can move under a locked route");
});

test("the deterministic timetable defines twelve coherent services",()=>{
  const plan=createRailPlan(WORLD_DEFINITION,buildRoadGraph()),services=createDefaultTrainServices(plan,12);expect(services.length===12,"timetable does not define twelve services");expect(services.some(service=>service.serviceType==="Express"),"airport express service is missing");expect(services.some(service=>service.serviceType==="Limited stop"),"limited-stop city service is missing");for(const service of services)for(const routeId of service.routeSequence)expect(service.stopsForRoute(routeId).length,`${service.serviceId} has no stops on ${routeId}`);
});

test("dispatcher gives twelve trains non-conflicting block authority",()=>{
  const scene=new THREE.Scene(),g=buildRoadGraph(),city=new CityBuilder(scene,g),built=city.build();city.initializeStreaming(new THREE.Vector3(-330,0,5),0,0);const rail=new RailSystem(scene,new THREE.PerspectiveCamera(),{isDown:()=>false,consume:()=>false,mouseDX:0,mouseDY:0},g,built.chunkManager,built.railPlan,()=>{},built.colliders),player={inVehicle:false,inTrain:false,position:new THREE.Vector3()};
  for(let step=0;step<240;step++)rail.update(.1,step*.1,player);expect(rail.trains.length===12,"full fleet was not created");expect(rail.blockSystem.conflicts.length===0,"two trains occupied the same block");for(const train of rail.trains)expect(train.movementAuthority&&Number.isFinite(train.permittedSpeed),`${train.id} lacks movement authority`);
});

test("platform allocations cannot double-book the same platform",()=>{
  const scene=new THREE.Scene(),g=buildRoadGraph(),city=new CityBuilder(scene,g),built=city.build();city.initializeStreaming(new THREE.Vector3(-330,0,5),0,0);const rail=new RailSystem(scene,new THREE.PerspectiveCamera(),{isDown:()=>false,consume:()=>false,mouseDX:0,mouseDY:0},g,built.chunkManager,built.railPlan,()=>{},built.colliders),station=built.railPlan.stations[0],groups=new Map();for(const train of rail.trains.filter(item=>item.routeId===station.routeId)){const key=`${train.routeId}:${train.trackIndex}`;if(!groups.has(key))groups.set(key,[]);groups.get(key).push(train);}const sameTrack=[...groups.values()].find(items=>items.length>=2)?.slice(0,2);expect(sameTrack?.length===2,"no same-track service pair was available for the allocation test");
  rail.stationOperations.release(sameTrack[0].id);rail.stationOperations.release(sameTrack[1].id);const a=rail.stationOperations.allocate(sameTrack[0],station,10),b=rail.stationOperations.allocate(sameTrack[1],station,11);expect(a&&b,"compatible platforms were not allocated");expect(a.platformId!==b.platformId,"two trains were allocated the same platform");
});

test("train doors require a confirmed allocated platform",()=>{
  const scene=new THREE.Scene(),g=buildRoadGraph(),city=new CityBuilder(scene,g),built=city.build();city.initializeStreaming(new THREE.Vector3(-330,0,5),0,0);const rail=new RailSystem(scene,new THREE.PerspectiveCamera(),{isDown:()=>false,consume:()=>false,mouseDX:0,mouseDY:0},g,built.chunkManager,built.railPlan,()=>{},built.colliders),train=rail.trains[0],station=built.railPlan.stations[0];train.currentStation=station;train.speed=0;train.dwell=10;rail.stationOperations.release(train.id);rail.updateTrainDoors(train,1,false);expect(train.doorTarget===0,"doors opened without a platform allocation");rail.stationOperations.allocate(train,station,0);rail.stationOperations.occupy(train,station);rail.updateTrainDoors(train,1,false);expect(train.doorTarget===1,"doors stayed locked after a safe platform was confirmed");
});

test("cab state exposes signal, authority and platform indications",()=>{
  const scene=new THREE.Scene(),g=buildRoadGraph(),city=new CityBuilder(scene,g),built=city.build();city.initializeStreaming(new THREE.Vector3(-330,0,5),0,0);const rail=new RailSystem(scene,new THREE.PerspectiveCamera(),{isDown:()=>false,consume:()=>false,mouseDX:0,mouseDY:0},g,built.chunkManager,built.railPlan,()=>{},built.colliders),train=rail.trains[0];rail.playerTrain=train;rail.playerTrainMode="driver";const state=rail.getPlayerState();for(const key of["signalAspect","permittedSpeed","distanceToSignal","allocatedPlatform","routeSet","spadWarning"])expect(key in state,`missing cab indication ${key}`);
});

test("Eastmere terminal interior exposes a continuous passenger route from concourse to aircraft cabin",()=>{
  const scene=new THREE.Scene(),airport=new AirportSystem(scene,WORLD_DEFINITION.airport,null),d=WORLD_DEFINITION.airport,names=[];
  airport.group.traverse(object=>{if(object.name)names.push(object.name);});
  expect(names.filter(name=>name.startsWith("airport-checkin-desk-")).length===5,"terminal check-in desks are missing");
  expect(names.includes("airport-security-sign")&&names.filter(name=>name==="airport-security-portal").length>=4,"terminal security zone is incomplete");
  expect(names.includes("airport-flight-information-display")&&names.includes("airport-baggage-carousel"),"terminal passenger-processing interior is incomplete");
  expect(airport.walkSurfaces.some(surface=>surface.role==="terminal-main-floor"),"terminal interior floor is not walkable");
  expect(airport.gateWalkways.length===4&&airport.walkSurfaces.filter(surface=>surface.role?.includes("boarding-bridge")).length===12,"four three-section walkable boarding bridges were not created");

  const forward=new THREE.Vector3(Math.sin(d.heading),0,Math.cos(d.heading)),right=new THREE.Vector3(forward.z,0,-forward.x),world=(x,y,z)=>new THREE.Vector3(d.x,y,d.z).addScaledVector(forward,x).addScaledVector(right,z);
  const gate=airport.gateWalkways[0];let feetY=airport.terminalFloorHeight;
  for(let segment=0;segment<gate.points.length-1;segment++){
    const a=gate.points[segment],b=gate.points[segment+1];
    for(const t of[.2,.5,.8]){
      const p=world(THREE.MathUtils.lerp(a.x,b.x,t),0,THREE.MathUtils.lerp(a.z,b.z,t)),sample=airport.resolveWalkSurface(p,feetY);
      expect(sample?.active&&!sample.blocked,`boarding bridge segment ${segment+1} is not walkable at ${t}`);feetY=sample.height;
    }
  }
  const aircraft=airport.aircraft[0],yaw=aircraft.mesh.rotation.y,c=Math.cos(yaw),s=Math.sin(yaw),lx=0,lz=3.8,cabinWorld=new THREE.Vector3(aircraft.mesh.position.x+lx*c+lz*s,0,aircraft.mesh.position.z-lx*s+lz*c),floor=aircraft.mesh.position.y+(aircraft.mesh.userData.cabinFloorY??1.15),cabin=airport.resolveWalkSurface(cabinWorld,floor);
  expect(cabin?.active&&!cabin.blocked&&cabin.role==="aircraft-cabin","boarding bridge does not lead into a walkable aircraft cabin");
  expect(airport.isPassengerAccessiblePosition(cabinWorld),"aircraft cabin is not recognised as a passenger-accessible position");
  expect(airport.isRestrictedPosition(aircraft.parkedPosition),"boarding access weakened the underlying restricted-airside boundary");
});

test("Eastmere boarding bridge uses a flexible dock and overlaps the parked aircraft doorway",()=>{
  const scene=new THREE.Scene(),airport=new AirportSystem(scene,WORLD_DEFINITION.airport,null),d=WORLD_DEFINITION.airport,gate=airport.gateWalkways[0],aircraft=airport.aircraft[0];
  const forward=new THREE.Vector3(Math.sin(d.heading),0,Math.cos(d.heading)),right=new THREE.Vector3(forward.z,0,-forward.x),world=(x,y,z)=>new THREE.Vector3(d.x,y,d.z).addScaledVector(forward,x).addScaledVector(right,z);
  const bridgeEnd=world(gate.dockFrom.x,gate.dockFrom.y,gate.dockFrom.z),bridgeSample=airport.resolveWalkSurface(bridgeEnd,gate.dockFrom.y);
  expect(bridgeSample?.active&&!bridgeSample.blocked,"rigid bridge cabin no longer reaches the flexible docking section");
  const midpoint=world((gate.dockFrom.x+gate.dockTo.x)*.5,gate.dockFrom.y,(gate.dockFrom.z+gate.dockTo.z)*.5),dockSample=airport.resolveWalkSurface(midpoint,gate.dockFrom.y);
  expect(dockSample?.active&&!dockSample.blocked&&dockSample.role===`gate-1-aircraft-dock`,"flexible docking floor is not walkable");
  const sillPoint=world(gate.aircraftDoorPoint.x,gate.aircraftDoorPoint.y,gate.aircraftDoorPoint.z),sillSample=airport.resolveWalkSurface(sillPoint,gate.aircraftDoorPoint.y);
  expect(sillSample?.active&&!sillSample.blocked,"aircraft door sill is not reachable from the flexible dock");
  const local=airport.aircraftLocalPosition(aircraft,sillPoint);
  expect(local.x<=1.40&&local.x>=-.44&&local.z>=3.35&&local.z<=4.90,"dock endpoint is not aligned to the forward passenger doorway");
  const cabinPoint=world(gate.cabinEntryPoint.x,gate.cabinEntryPoint.y,gate.cabinEntryPoint.z),cabinSample=airport.resolveWalkSurface(cabinPoint,gate.cabinEntryPoint.y);
  expect(cabinSample?.active&&!cabinSample.blocked&&cabinSample.role==="aircraft-cabin","player cannot continue from the sill into the aircraft cabin");
});

test("Eastmere aircraft cabin has enough headroom for the walking camera",()=>{
  const scene=new THREE.Scene(),airport=new AirportSystem(scene,WORLD_DEFINITION.airport,null),aircraft=airport.aircraft[0],data=aircraft.mesh.userData;
  const headroom=data.cabinCeilingY-data.cabinFloorY,eyeY=data.cabinFloorY+1.72;
  expect(headroom>=2.05,`aircraft cabin headroom is only ${headroom.toFixed(2)} m`);
  expect(data.cabinCeilingY-eyeY>=.25,"walking camera still intersects the aircraft ceiling");
  expect(data.fuselageTopY>eyeY+.25,"walking camera still protrudes through the exterior fuselage");
  expect(data.doorOpeningHeight>=1.80,"forward passenger doorway is unrealistically short");
});

test("walking player resolves Eastmere terminal, boarding bridge and parked-aircraft floor heights",()=>{
  const scene=new THREE.Scene(),camera=new THREE.PerspectiveCamera(),g=buildRoadGraph(),input={isDown:()=>false,consume:()=>false,mouseDX:0,mouseDY:0},player=new PlayerController(scene,camera,input,g,[],()=>{}),airport=new AirportSystem(scene,WORLD_DEFINITION.airport,null),d=WORLD_DEFINITION.airport;
  player.setAirportSystem(airport);
  const forward=new THREE.Vector3(Math.sin(d.heading),0,Math.cos(d.heading)),right=new THREE.Vector3(forward.z,0,-forward.x),world=(x,y,z)=>new THREE.Vector3(d.x,y,d.z).addScaledVector(forward,x).addScaledVector(right,z);
  const terminalPoint=world(20,0,d.terminalOffset+1),terminal=player.resolveWalkingSurface(terminalPoint,0);
  expect(!terminal.blocked&&Math.abs(terminal.height-airport.terminalFloorHeight)<.02,"player controller does not recognise the terminal floor");
  const segment=airport.gateWalkways[0].points.slice(0,2),bridgePoint=world((segment[0].x+segment[1].x)*.5,0,(segment[0].z+segment[1].z)*.5),bridge=player.resolveWalkingSurface(bridgePoint,airport.terminalFloorHeight);
  expect(!bridge.blocked&&bridge.airport&&bridge.role==="gate-1-boarding-bridge","player controller does not hand walking to the airport boarding bridge solver");
});

test("a boarded player remains attached while the aircraft follows its normal departure cycle",()=>{
  const scene=new THREE.Scene(),camera=new THREE.PerspectiveCamera(),input={isDown:()=>false,mouseDX:0,mouseDY:0},airport=new AirportSystem(scene,WORLD_DEFINITION.airport,null,camera,input,()=>{}),aircraft=airport.aircraft[0],data=aircraft.mesh.userData,player={inVehicle:false,inTrain:false,inBus:false,inAircraft:false,camera,position:new THREE.Vector3(),walkYaw:aircraft.mesh.rotation.y,walkPitch:0,pendingLookDX:0,pendingLookDY:0,input};
  aircraft.state="parked";aircraft.stateTime=50;aircraft.progress=0;aircraft.mesh.updateWorldMatrix(true,false);camera.position.copy(aircraft.mesh.localToWorld(new THREE.Vector3(0,data.standingEyeY,3.0)));
  airport.update(.1,1,player);
  expect(player.inAircraft&&airport.passengerState?.aircraft===aircraft,"player was not attached to the boarded aircraft");
  expect(aircraft.state==="taxiOut","boarding incorrectly prevents the aircraft from departing on schedule");
  for(let i=0;i<120;i++)airport.update(.1,1.1+i*.1,player);
  aircraft.mesh.updateWorldMatrix(true,false);const localEye=aircraft.mesh.worldToLocal(camera.position.clone());
  expect(localEye.z>=data.cabinMinZ-.1&&localEye.z<=data.cabinMaxZ+.1&&Math.abs(localEye.x)<1.1,"player camera did not remain inside the moving aircraft");
  expect(aircraft.state!=="parked","aircraft returned to a parked-only behaviour while carrying the player");
});

test("Eastmere aircraft passenger windows are genuine transparent apertures through the fuselage",()=>{
  const scene=new THREE.Scene(),airport=new AirportSystem(scene,WORLD_DEFINITION.airport,null),aircraft=airport.aircraft[0],fuselage=aircraft.mesh.getObjectByName("aircraft-fuselage"),window=aircraft.mesh.getObjectByName("aircraft-passenger-window");
  expect(fuselage?.userData?.hasRealWindowOpenings,"aircraft fuselage does not declare real window apertures");expect(window?.material?.transparent&&window.material.opacity<.5,"aircraft passenger glazing is not actually transparent");
  aircraft.mesh.updateWorldMatrix(true,true);const ray=new THREE.Raycaster(),outside=aircraft.mesh.localToWorld(new THREE.Vector3(3,2.28,1.15)),inside=aircraft.mesh.localToWorld(new THREE.Vector3(0,2.28,1.15)),direction=inside.clone().sub(outside).normalize();ray.set(outside,direction);ray.far=2.25;
  expect(ray.intersectObject(fuselage,false).length===0,"opaque fuselage skin still sits behind a passenger window");
  const solidOutside=aircraft.mesh.localToWorld(new THREE.Vector3(3,2.78,1.15)),solidInside=aircraft.mesh.localToWorld(new THREE.Vector3(0,2.78,1.15));ray.set(solidOutside,solidInside.clone().sub(solidOutside).normalize());ray.far=2.25;expect(ray.intersectObject(fuselage,false).length>0,"fuselage shell was accidentally removed above the window belt");
});

test("Eastmere aircraft cabin has visible windows, detailed seats and a sit interaction",()=>{
  const scene=new THREE.Scene(),camera=new THREE.PerspectiveCamera(),input={isDown:()=>false,mouseDX:0,mouseDY:0},airport=new AirportSystem(scene,WORLD_DEFINITION.airport,null,camera,input,()=>{}),aircraft=airport.aircraft[0],data=aircraft.mesh.userData,names=[];aircraft.mesh.traverse(object=>{if(object.name)names.push(object.name);});
  expect(names.filter(name=>name==="aircraft-cabin-window").length>=14,"passenger cabin still has no visible interior windows");
  const armrests=aircraft.mesh.getObjectByName("aircraft-seat-armrests"),trays=aircraft.mesh.getObjectByName("aircraft-seat-trays");expect(armrests?.isInstancedMesh&&armrests.count>=56&&trays?.isInstancedMesh&&trays.count>=28,"aircraft seating is not using the detailed instanced cabin geometry");
  expect(data.seatLayout==="2+2"&&(data.seats??[]).length===28,"aircraft cabin is not a genuine four-abreast 2+2 layout");
  const player={inVehicle:false,inTrain:false,inBus:false,inAircraft:false,camera,position:new THREE.Vector3(),walkYaw:aircraft.mesh.rotation.y,walkPitch:0,pendingLookDX:0,pendingLookDY:0,input};aircraft.mesh.updateWorldMatrix(true,false);camera.position.copy(aircraft.mesh.localToWorld(new THREE.Vector3(0,data.standingEyeY,2.78)));airport.attachPassenger(player,aircraft);airport.passengerState.localPosition.set(0,data.cabinFloorY,2.78);
  expect(airport.handleInteract(player),"seat interaction was not handled");expect(airport.passengerState.seated&&airport.passengerState.seat,"player could not sit in an aircraft passenger seat");
  airport.updatePassengerRide(.1,player);aircraft.mesh.updateWorldMatrix(true,false);const seatedLocal=aircraft.mesh.worldToLocal(camera.position.clone());expect(Math.abs(seatedLocal.y-data.seatedEyeY)<.05,"seated aircraft camera is not at a seated eye height");
  airport.handleInteract(player);expect(!airport.passengerState.seated,"player could not stand back up from the aircraft seat");
});

test("far aircraft selects a cheaper visual tier while an occupied aircraft is forced to full detail",()=>{
  const previous=qualityManager.name;qualityManager.setQuality("medium",{persist:false});
  const scene=new THREE.Scene(),camera=new THREE.PerspectiveCamera(),airport=new AirportSystem(scene,WORLD_DEFINITION.airport,null,camera),aircraft=airport.aircraft[0];
  camera.position.copy(aircraft.simPosition).add(new THREE.Vector3(0,0,3000));airport.render(.5,1/60,null);
  expect(["low","far","hidden"].includes(aircraft.lodTier),`far aircraft remained expensive (${aircraft.lodTier})`);
  airport.passengerState={aircraft};airport.render(.5,1/60,null);expect(aircraft.lodTier==="full","occupied player aircraft was allowed to fall below full detail");
  qualityManager.setQuality(previous,{persist:false});
});
test("graphics quality changes do not mutate authoritative aircraft state, stand ownership or runway ownership",()=>{
  const previous=qualityManager.name,scene=new THREE.Scene(),camera=new THREE.PerspectiveCamera(),airport=new AirportSystem(scene,WORLD_DEFINITION.airport,null,camera),aircraft=airport.aircraft[0];
  const snapshot=()=>JSON.stringify({state:aircraft.state,progress:aircraft.progress,stand:aircraft.standIndex,airport:aircraft.currentAirportId,destination:aircraft.destinationAirportId,runways:[...airport.runwayOwners.entries()],stands:[...airport.standOccupancy.entries()].map(([id,items])=>[id,[...items]])});
  const before=snapshot();for(const preset of ["low","medium","high","ultra"]){qualityManager.setQuality(preset,{persist:false});airport.applyQualityProfile();airport.render(.5,1/60,null);expect(snapshot()===before,`${preset} quality changed authoritative aviation state`);}
  qualityManager.setQuality(previous,{persist:false});
});
test("repeated graphics quality switching does not duplicate aircraft render resources",()=>{
  const previous=qualityManager.name,scene=new THREE.Scene(),camera=new THREE.PerspectiveCamera(),airport=new AirportSystem(scene,WORLD_DEFINITION.airport,null,camera);
  const counts=()=>{const geometries=new Set(),materials=new Set();let objects=0;scene.traverse(object=>{objects++;if(object.geometry)geometries.add(object.geometry);for(const material of Array.isArray(object.material)?object.material:object.material?[object.material]:[])materials.add(material);});return{objects,geometries:geometries.size,materials:materials.size};};
  const before=counts();for(const preset of ["low","medium","high","ultra","low","medium","high","ultra","low"]){qualityManager.setQuality(preset,{persist:false});airport.applyQualityProfile();airport.render(.5,1/60,null);const after=counts();expect(after.objects===before.objects&&after.geometries===before.geometries&&after.materials===before.materials,`${preset} quality switch recreated or duplicated aircraft resources`);}
  qualityManager.setQuality(previous,{persist:false});
});

test("Eastmere station-terminal tunnel has enclosed glazing, lighting and repeated wayfinding",()=>{
  const scene=new THREE.Scene(),g=buildRoadGraph(),city=new CityBuilder(scene,g),built=city.build();city.initializeStreaming(new THREE.Vector3(900,0,610),0,0);
  const rail=new RailSystem(scene,new THREE.PerspectiveCamera(),{isDown:()=>false,consume:()=>false,mouseDX:0,mouseDY:0},g,built.chunkManager,built.railPlan,()=>{},built.colliders),station=built.railPlan.airportRoute.stations.find(candidate=>candidate.airport),group=rail.stationGroups.find(candidate=>candidate.userData.station.id===station.id),names=[];group.traverse(object=>{if(object.name)names.push(object.name);});
  expect(names.filter(name=>name.endsWith("terminal-link-glazing")).length===2,"station-terminal connector is not glazed on both sides");
  expect(names.filter(name=>name.endsWith("terminal-link-light")).length>=10,"station-terminal connector lighting is too sparse");
  expect(names.filter(name=>name.endsWith("terminal-link-wayfinding")).length>=3,"station-terminal connector lacks repeated terminal wayfinding");
  expect(rail.walkBlockers.some(blocker=>blocker.stationId===station.id&&blocker.name.endsWith("terminal-link-wall")),"station-terminal glazing does not constrain the walking route");
});

test("aircraft cockpit windscreen is a true transparent aperture from the pilot eye point",()=>{
  const scene=new THREE.Scene(),airport=new AirportSystem(scene,WORLD_DEFINITION.airport,null),aircraft=airport.aircraft[0],data=aircraft.mesh.userData,fuselage=aircraft.mesh.getObjectByName("aircraft-fuselage"),windscreen=aircraft.mesh.getObjectByName("aircraft-cockpit-windshield");
  expect(windscreen?.material?.transparent&&windscreen.material.opacity<.5&&windscreen.material.side===THREE.DoubleSide,"cockpit windscreen is not genuinely transparent from both sides");
  aircraft.mesh.updateWorldMatrix(true,true);const eye=aircraft.mesh.localToWorld(new THREE.Vector3(-.40,data.pilotEyeY,data.pilotEyeZ)),ahead=aircraft.mesh.localToWorld(new THREE.Vector3(-.40,data.pilotEyeY,8)),ray=new THREE.Raycaster(eye,ahead.clone().sub(eye).normalize(),0,4);
  expect(ray.intersectObject(fuselage,false).length===0,"opaque fuselage skin still blocks the pilot's forward sightline");
  expect((aircraft.mesh.getObjectsByProperty("name","aircraft-windscreen-wiper")??[]).length===2,"aircraft windscreen detailing regressed");
});

test("manual aircraft pilot can cycle cockpit and exterior camera views while retaining free look",()=>{
  const scene=new THREE.Scene(),camera=new THREE.PerspectiveCamera(),pressed=new Set(),input={mouseDX:0,mouseDY:0,isDown:()=>false,consume(key){const had=pressed.has(key);pressed.delete(key);return had;}},airport=new AirportSystem(scene,WORLD_DEFINITION.airport,null,camera,input,()=>{}),aircraft=airport.aircraft[0],data=aircraft.mesh.userData,player={inVehicle:false,inTrain:false,inBus:false,inAircraft:false,camera,position:new THREE.Vector3(),walkYaw:aircraft.heading,walkPitch:0,pendingLookDX:0,pendingLookDY:0,input};
  aircraft.mesh.updateWorldMatrix(true,false);camera.position.copy(aircraft.mesh.localToWorld(new THREE.Vector3(0,data.standingEyeY,5.0)));airport.attachPassenger(player,aircraft);airport.passengerState.localPosition.set(0,data.cabinFloorY,5.0);airport.handleInteract(player);
  expect(airport.getPlayerState()?.cameraMode==="PILOT","manual flight did not start in pilot view");pressed.add("KeyC");airport.updatePassengerRide(1/60,player);expect(airport.getPlayerState()?.cameraMode==="COPILOT","C did not cycle to copilot camera");pressed.add("KeyC");airport.updatePassengerRide(1/60,player);expect(airport.getPlayerState()?.cameraMode==="CHASE","C did not cycle to chase camera");
  const beforeYaw=airport.passengerState.yaw,beforePitch=airport.passengerState.pitch;input.mouseDX=100;input.mouseDY=-50;airport.updatePassengerRide(1/60,player);expect(Math.abs(airport.passengerState.yaw-beforeYaw)>.1&&Math.abs(airport.passengerState.pitch-beforePitch)>.05,"mouse free-look stopped working in aircraft camera modes");
});

test("Eastmere jetbridge uses a short flexible mating section that reaches beyond the door sill",()=>{
  const scene=new THREE.Scene(),airport=new AirportSystem(scene,WORLD_DEFINITION.airport,null),gate=airport.gateWalkways[0],extension=Math.abs(gate.dockTo.x-gate.dockFrom.x),contactOverlap=gate.dockTo.x-gate.aircraftDoorPoint.x,names=[];gate.dockGroup.traverse(object=>{if(object.name)names.push(object.name);});
  expect(extension<=.45,`jetbridge soft dock is still too long/disconnected (${extension.toFixed(2)} m)`);expect(contactOverlap>=.04&&contactOverlap<=.12,"jetbridge canopy no longer overlaps the aircraft sill cleanly");
  expect(names.filter(name=>name.includes("fuselage-seal")).length>=3&&names.some(name=>name.includes("threshold-plate")),"jetbridge lost its fuselage seal or threshold plate");
});
