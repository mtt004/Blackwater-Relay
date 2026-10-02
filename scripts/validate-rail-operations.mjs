import * as THREE from 'three';

const fail=message=>{throw new Error(message);};
const prompt={hidden:true,dataset:{},querySelector:()=>({textContent:''})};
const context=new Proxy({measureText:text=>({width:String(text).length*10})},{get(target,key){if(key in target)return target[key];return()=>{};},set(target,key,value){target[key]=value;return true;}});
globalThis.document={getElementById:id=>id==='interaction-prompt'?prompt:null,pointerLockElement:null,createElement:tag=>tag==='canvas'?{width:0,height:0,getContext:()=>context}: {}};
globalThis.window={};globalThis.localStorage={getItem:()=>null,setItem:()=>{}};globalThis.addEventListener=()=>{};

const [{buildRoadGraph},{CityBuilder},{RailSystem},{RailNetwork},{RailBlockSystem},{RailInterlocking},{CONFIG}]=await Promise.all([
  import('../src/world/CityPlan.js'),import('../src/world/CityBuilder.js'),import('../src/rail/RailSystem.js'),import('../src/rail/RailNetwork.js'),import('../src/rail/RailBlockSystem.js'),import('../src/rail/RailInterlocking.js'),import('../src/config.js')
]);

const graph=buildRoadGraph(),scene=new THREE.Scene(),camera=new THREE.PerspectiveCamera(),city=new CityBuilder(scene,graph),built=city.build();city.initializeStreaming(new THREE.Vector3(-330,0,5),0,0);
const input={isDown:()=>false,consume:()=>false,mouseDX:0,mouseDY:0},rail=new RailSystem(scene,camera,input,graph,built.chunkManager,built.railPlan,()=>{},built.colliders),network=rail.network;
const networkErrors=network.validate();if(networkErrors.length)fail(networkErrors.join('; '));
if(rail.signalRenderer.posts.count!==network.signals.length)fail('signal post instance count does not match the operational network');
if(rail.signalRenderer.heads.count!==network.signals.length)fail('signal head instance count does not match the operational network');
if(rail.signalRenderer.plates.count!==network.signals.length)fail('signal identification plate count does not match the operational network');
if(rail.signalRenderer.plates.userData.identificationPlates.length!==network.signals.length)fail('signal identification data is incomplete');
if(rail.signalRenderer.junctionIndicators.length!==network.junctions.length)fail('junction route indicators do not match the interlocking graph');
if(rail.signalRenderer.debugEnabled||rail.signalRenderer.debugBoundaries.visible)fail('railway debug rendering is enabled by default');
if(network.routes.length!==2)fail(`expected two railway loops, found ${network.routes.length}`);
for(const route of network.routes)for(let track=0;track<4;track++){
  const blocks=network.lineBlocks(route.id,track);if(blocks.length<12)fail(`${route.name} track ${track+1} has too few blocks`);
  for(const block of blocks){const next=network.nextBlock(block,block.direction);if(!next)fail(`${block.id} is a dead end`);const segment=network.segments.find(item=>item.id===block.segmentId);if(!segment?.connectedNext?.length)fail(`${block.segmentId} is disconnected`);}
}
for(const service of rail.services){if(!network.route(service.initialRouteId))fail(`${service.serviceId} has no initial route`);for(const routeId of service.routeSequence)if(!network.route(routeId))fail(`${service.serviceId} references missing ${routeId}`);for(const routeId of service.routeSequence){const route=network.route(routeId),stops=service.stopsForRoute(routeId);if(!stops.length)fail(`${service.serviceId} has no stopping pattern on ${routeId}`);for(const stop of stops)if(!route.stations.some(station=>station.id===stop||station.sharedPhysicalStationId===stop))fail(`${service.serviceId} references missing stop ${stop}`);}}
for(const platform of network.platforms){if(![...platform.compatibleTracksByRoute.values()].some(tracks=>tracks.length))fail(`${platform.id} has no reachable track`);const station=rail.plan.stations.find(item=>network.physicalStationId(item)===platform.physicalStationId);if(!station)fail(`${platform.id} has no physical station`);const stairs=rail.walkSurfaces.filter(surface=>surface.stationId===station.id&&surface.role==='platform-footbridge-stairs');if(stairs.length<5)fail(`${station.name} does not provide stairs to all five platforms`);}
for(const signal of network.signals){const route=network.route(signal.routeId);for(const station of route.stations){const distance=network.forwardDistance(route.id,station.t,signal.progress,1),reverse=network.forwardDistance(route.id,signal.progress,station.t,1),arc=Math.min(distance,reverse);if(arc<station.platformLength*.5+18)fail(`${signal.id} clips the ${station.name} platform area`);}}

// Independent block and interlocking invariants.
const isolatedNetwork=new RailNetwork(built.railPlan),isolatedBlocks=new RailBlockSystem(isolatedNetwork),isolatedInterlocking=new RailInterlocking(isolatedNetwork,isolatedBlocks),sampleBlock=isolatedNetwork.blocks[0];sampleBlock.occupiedBy.add('A');
if(isolatedBlocks.reserveBlocks({id:'B',direction:sampleBlock.direction},[sampleBlock]))fail('occupied block was reserved for a conflicting train');sampleBlock.occupiedBy.clear();
const routeA={id:'A',trackIndex:0,direction:1,routeId:'city',progress:0,formation:{totalLength:160}},routeB={id:'B',trackIndex:0,direction:1,routeId:'airport',progress:0,formation:{totalLength:160}},first=isolatedInterlocking.request(routeA,'city','airport');if(!first.granted)fail('first junction route did not clear');if(isolatedInterlocking.request(routeB,'airport','city').granted)fail('conflicting junction route cleared simultaneously');if(isolatedInterlocking.canPointsMove('junction:industrial-exchange'))fail('points can move while a route is locked');isolatedInterlocking.markTransferComplete({...routeA,routeId:'airport',progress:0});isolatedInterlocking.update([{...routeA,routeId:'airport',progress:.001}],1);if(!isolatedInterlocking.activeRoutes.size)fail('junction route released before the complete train cleared');const route=isolatedNetwork.route('airport'),clearedProgress=((160+30)/route.length)%1;isolatedInterlocking.update([{...routeA,routeId:'airport',progress:clearedProgress}],2);if(isolatedInterlocking.activeRoutes.size)fail('junction route did not release after the complete train cleared');

// Full deterministic fleet run.
const player={inVehicle:false,inTrain:false,position:new THREE.Vector3(0,0,0)};let maximumWaiting=0,maximumActiveJunctions=0,redBrakingObservations=0,previousSpeeds=new Map(rail.trains.map(train=>[train.id,train.speed]));
for(let step=0;step<6000;step++){
  rail.update(.1,step*.1,player);if(rail.blockSystem.conflicts.length)fail(`block conflict at ${step*.1.toFixed?.(1)??step*.1}s: ${JSON.stringify(rail.blockSystem.conflicts[0])}`);
  const platformOwners=new Map();for(const platform of network.platforms){if(!platform.occupiedBy)continue;if(platformOwners.has(platform.id)&&platformOwners.get(platform.id)!==platform.occupiedBy)fail(`${platform.id} was double booked`);platformOwners.set(platform.id,platform.occupiedBy);}
  for(const train of rail.trains){const previous=previousSpeeds.get(train.id)??train.speed;if(train.signalAspect==='red'&&train.nextSignal?.distance<Math.max(35,train.speed*train.speed/(2.1*CONFIG.trainSpeedMultiplier*CONFIG.trainSpeedMultiplier))){redBrakingObservations++;if(train.speed>previous+.08)fail(`${train.id} accelerated into a red signal`);}previousSpeeds.set(train.id,train.speed);}
  const diagnostics=rail.getOperationsDiagnostics();maximumWaiting=Math.max(maximumWaiting,diagnostics.trainsWaitingAtSignals);maximumActiveJunctions=Math.max(maximumActiveJunctions,diagnostics.activeJunctionRoutes);
}
if(rail.trains.length!==12)fail(`expected 12 trains, found ${rail.trains.length}`);if(rail.trains.some(train=>train.distanceTravelled<500))fail('a service failed to make operational progress');if(rail.trains.filter(train=>train.service.airportService).reduce((sum,train)=>sum+train.completedRouteTransfers,0)<4)fail('airport services did not complete protected city/airport transfers');if(redBrakingObservations<1)fail('the fleet never exercised red-signal braking');if(rail.getOperationsDiagnostics().deadlockRecoveryCount>0)fail('normal fleet operation required deadlock recovery');
for(const train of rail.trains){if(!train.movementAuthority)fail(`${train.id} has no movement authority`);if(!train.nextSignal)fail(`${train.id} has no next signal`);if(!Number.isFinite(train.permittedSpeed))fail(`${train.id} has invalid permitted speed`);}

rail.stationOperations.updateInformation(rail.trains,rail.simulationSeconds);
for(const display of rail.stationOperations.displays){const data=display.board.userData.displayData;if(!data)fail(`${display.board.name} has no live service information`);if(data.callingPoints?.length){const train=rail.trains.find(item=>item.serviceId===data.serviceId);if(!train)fail(`${display.board.name} references an unknown service`);const expected=train.service.stopsForRoute(train.routeId).map(id=>train.route.stations.find(station=>station.id===id||station.sharedPhysicalStationId===id)?.name).filter(Boolean);if(data.callingPoints.join('|')!==expected.join('|'))fail(`${display.board.name} calling points do not match ${train.serviceId}`);}}

const playerTrain=rail.trains[0];rail.playerTrain=playerTrain;rail.playerTrainMode='driver';playerTrain.manual=true;const cab=rail.getPlayerState();for(const key of['signalAspect','permittedSpeed','distanceToSignal','allocatedPlatform','routeSet','spadWarning'])if(!(key in cab))fail(`cab indication ${key} is missing`);rail.playerTrain=null;rail.playerTrainMode=null;playerTrain.manual=false;

const diagnostics=rail.getOperationsDiagnostics();console.log(`Rail operations validation passed: ${network.segments.length} segments, ${network.blocks.length} blocks, ${network.signals.length} signals, ${network.platforms.length} platforms, 12 services, ${rail.trains.reduce((sum,train)=>sum+train.completedRouteTransfers,0)} protected transfers, ${maximumWaiting} max trains waiting, ${maximumActiveJunctions} max active junction route(s), ${diagnostics.dispatcherUpdateMs.toFixed(3)} ms dispatcher update.`);
process.exit(0);
