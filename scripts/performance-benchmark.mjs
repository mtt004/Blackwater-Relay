import * as THREE from 'three';
import {performance} from 'node:perf_hooks';

let randomState=0x6d2b79f5;Math.random=()=>{randomState=(randomState+0x6d2b79f5)|0;let value=randomState;value=Math.imul(value^(value>>>15),value|1);value^=value+Math.imul(value^(value>>>7),value|61);return((value^(value>>>14))>>>0)/4294967296;};

const interactionPrompt={hidden:true,dataset:{},querySelector:()=>({textContent:''})};
globalThis.document={getElementById:id=>id==='interaction-prompt'?interactionPrompt:null,pointerLockElement:null,createElement:()=>({getContext:()=>({measureText:()=>({width:0}),fillRect(){},clearRect(){},fillText(){},beginPath(){},moveTo(){},lineTo(){},stroke(){}})})};
globalThis.window={};globalThis.localStorage={getItem:()=>null,setItem:()=>{}};globalThis.addEventListener=()=>{};

const [{buildRoadGraph},{WORLD_DEFINITION},{CityBuilder},{PlayerController},{RailSystem},{TrafficSignals},{TrafficSystem},{TransitSystem},{VehicleCollisionSystem},{IncidentSystem},{PedestrianSystem},{PoliceSystem},{AirportSystem}]=await Promise.all([
  import('../src/world/CityPlan.js'),import('../src/world/WorldDefinition.js'),import('../src/world/CityBuilder.js'),import('../src/player/PlayerController.js'),import('../src/rail/RailSystem.js'),import('../src/systems/TrafficSignals.js'),import('../src/systems/TrafficSystem.js'),import('../src/systems/TransitSystem.js'),import('../src/systems/VehicleCollisionSystem.js'),import('../src/systems/IncidentSystem.js'),import('../src/systems/PedestrianSystem.js'),import('../src/systems/PoliceSystem.js'),import('../src/systems/AirportSystem.js')
]);

const sampleCapacity=300;
function metric(){return{samples:new Float64Array(sampleCapacity),count:0,total:0,max:0};}
function record(metric,value){if(metric.count<metric.samples.length)metric.samples[metric.count]=value;metric.count++;metric.total+=value;if(value>metric.max)metric.max=value;}
function summarize(metric){const count=Math.min(metric.count,metric.samples.length),copy=Array.from(metric.samples.subarray(0,count)).sort((a,b)=>a-b),at=p=>copy[Math.min(copy.length-1,Math.max(0,Math.ceil(copy.length*p)-1))]??0;return{meanMs:metric.count?metric.total/metric.count:0,medianMs:at(.5),p95Ms:at(.95),p99Ms:at(.99),maxMs:metric.max,samples:metric.count};}
function timed(metric,callback){const start=performance.now();callback();record(metric,performance.now()-start);}
function sceneStats(scene){
  let objects=0,visibleObjects=0,drawables=0,triangles=0,lines=0,points=0,geometryBytes=0;const geometries=new Set(),materials=new Set();
  scene.traverse(object=>{objects++;if(object.geometry)geometries.add(object.geometry);const values=Array.isArray(object.material)?object.material:object.material?[object.material]:[];for(const material of values)materials.add(material);});
  scene.traverseVisible(object=>{visibleObjects++;if(object.isMesh||object.isInstancedMesh){drawables++;const geometry=object.geometry,count=geometry?.index?.count??geometry?.attributes?.position?.count??0,instances=object.isInstancedMesh?object.count:1;triangles+=Math.floor(count/3)*instances;}else if(object.isLine||object.isLineSegments){drawables++;lines+=object.geometry?.attributes?.position?.count??0;}else if(object.isPoints){drawables++;points+=object.geometry?.attributes?.position?.count??0;}});
  for(const geometry of geometries){if(geometry.index)geometryBytes+=geometry.index.array.byteLength;for(const attribute of Object.values(geometry.attributes??{}))geometryBytes+=attribute.array?.byteLength??0;}
  return{objects,visibleObjects,drawables,triangles,lines,points,uniqueGeometries:geometries.size,uniqueMaterials:materials.size,geometryBytes};
}

if(globalThis.gc)globalThis.gc();const heapBefore=process.memoryUsage().heapUsed;
const input={down:new Set(),mouseDX:0,isDown(key){return this.down.has(key);},consume(){return false;}};
const scene=new THREE.Scene(),camera=new THREE.PerspectiveCamera(),graph=buildRoadGraph(WORLD_DEFINITION),city=new CityBuilder(scene,graph,WORLD_DEFINITION),built=city.build();city.initializeStreaming(new THREE.Vector3(-330,0,5),Math.PI/2,12);
const player=new PlayerController(scene,camera,input,graph,built.colliders,()=>{}),rail=new RailSystem(scene,camera,input,graph,built.chunkManager,built.railPlan,()=>{},built.colliders);player.setRailSystem(rail);
const signals=new TrafficSignals(scene,graph),traffic=new TrafficSystem(scene,graph,signals,player);traffic.setChunkManager(built.chunkManager);traffic.setRailSystem(rail);traffic.populate(64);
const transit=new TransitSystem(scene,graph,traffic,camera,input,player,()=>{},rail),collisions=new VehicleCollisionSystem(scene,player,traffic,()=>{}),incidents=new IncidentSystem(scene,graph,traffic,player,()=>{}),airport=new AirportSystem(scene,WORLD_DEFINITION,built.chunkManager),police=new PoliceSystem(scene,graph,traffic,signals,player,()=>{}),pedestrians=new PedestrianSystem(scene,graph,signals);
traffic.setIncidentSystem(incidents);police.setCollisionSystem(collisions);police.setAirportSystem(airport);pedestrians.setChunkManager(built.chunkManager);pedestrians.setTrafficSystem(traffic);pedestrians.setRailSystem(rail);pedestrians.setIncidentSystem(incidents);pedestrians.setPoliceSystem(police);pedestrians.populate(72);

const metrics={frame:metric(),railway:metric(),traffic:metric(),pedestrians:metric(),collisions:metric(),police:metric(),airport:metric(),streaming:metric(),player:metric()};
let trafficAcc=0,pedestrianAcc=0;
for(let step=0;step<120;step++){const dt=1/60,time=step*dt;signals.update(dt);rail.update(dt,time,player);trafficAcc+=dt;pedestrianAcc+=dt;if(trafficAcc>=1/36){traffic.update(trafficAcc,time);transit.update(trafficAcc,time);trafficAcc=0;}collisions.update(dt,time);police.update(dt,time);airport.update(dt,time);if(pedestrianAcc>=1/20){pedestrians.update(pedestrianAcc,time,'clear');pedestrianAcc=0;}}

for(let step=0;step<300;step++){
  const dt=1/60,time=step*dt,frameStart=performance.now();
  if(step%50===0){const phase=step/50,positions=[[-330,5],[-40,-20],[260,80],[520,540],[40,300],[320,-260]],position=positions[phase%positions.length];player.position.set(position[0],.05,position[1]);camera.position.set(position[0],7,position[1]);}
  timed(metrics.streaming,()=>city.updateStreaming(player.position,player.heading,24,time));signals.update(dt);
  timed(metrics.player,()=>player.update(dt,time,'clear'));
  timed(metrics.railway,()=>rail.update(dt,time,player,'clear'));
  trafficAcc+=dt;pedestrianAcc+=dt;
  if(trafficAcc>=1/36){timed(metrics.traffic,()=>{traffic.update(trafficAcc,time);transit.update(trafficAcc,time);});trafficAcc=0;}
  timed(metrics.collisions,()=>collisions.update(dt,time));timed(metrics.police,()=>police.update(dt,time));timed(metrics.airport,()=>airport.update(dt,time));
  if(pedestrianAcc>=1/20){timed(metrics.pedestrians,()=>pedestrians.update(pedestrianAcc,time,'clear'));pedestrianAcc=0;}
  record(metrics.frame,performance.now()-frameStart);
}

const lookupMetric=metric(),lookupIterations=200000,lookupStart=performance.now();
for(let index=0;index<lookupIterations;index++)rail.network.blockForProgress(index%2?'city':'airport',index%4,(index%10000)/10000);
record(lookupMetric,performance.now()-lookupStart);
const operationsMetric=metric();for(let index=0;index<150;index++)timed(operationsMetric,()=>{rail.blockSystem.updateOccupancy(rail.trains);rail.dispatcher.update(.125,20+index*.125);});
const trainHeadMetric=metric(),trainHeadIterations=120000,headTrain=rail.trains[0],trainHeadStart=performance.now();
for(let index=0;index<trainHeadIterations;index++){headTrain.progress=(index%10000)/10000;rail.updateTrainHead(headTrain);}record(trainHeadMetric,performance.now()-trainHeadStart);
const trainFormationMetric=metric(),trainFormationIterations=12000,trainFormationStart=performance.now();
for(let index=0;index<trainFormationIterations;index++){headTrain.progress=(index%10000)/10000;rail.updateFullTrainPlacement(headTrain);}record(trainFormationMetric,performance.now()-trainFormationStart);
const operationalScene=sceneStats(scene);
for(const train of rail.trains.slice(0,3)){for(const vehicle of train.formation.vehicles){vehicle.visible=true;if(vehicle.userData.interiorGroup)vehicle.userData.interiorGroup.visible=true;}if(train.lowMesh)train.lowMesh.visible=false;if(train.outline)train.outline.visible=false;}
for(const group of rail.stationGroups.slice(0,2))group.visible=true;
const denseStationScene=sceneStats(scene);
if(globalThis.gc)globalThis.gc();const heapAfter=process.memoryUsage().heapUsed;
const result={timestamp:new Date().toISOString(),entities:{trains:rail.trains.length,traffic:traffic.vehicles.length,pedestrians:pedestrians.agents.length,aircraft:airport.aircraft.length,blocks:rail.network.blocks.length,signals:rail.network.signals.length,platforms:rail.network.platforms.length},systems:Object.fromEntries(Object.entries(metrics).map(([name,value])=>[name,summarize(value)])),railLookup:{iterations:lookupIterations,totalMs:summarize(lookupMetric).meanMs},railOperations:summarize(operationsMetric),trainHeadPlacement:{iterations:trainHeadIterations,totalMs:summarize(trainHeadMetric).meanMs},trainFormationPlacement:{iterations:trainFormationIterations,totalMs:summarize(trainFormationMetric).meanMs},dispatcherMs:rail.dispatcher.updateTimeMs,occupancyMs:rail.blockSystem.lastOccupationUpdateMs,heap:{beforeBytes:heapBefore,afterBytes:heapAfter,deltaBytes:heapAfter-heapBefore},scene:operationalScene,denseStationScene,chunkStats:built.chunkManager.getStats()};
console.log(JSON.stringify(result,null,2));
