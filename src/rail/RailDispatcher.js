import { diagnostics } from "../core/DiagnosticsManager.js?v=20261002-flight-sim-terrain";
import { CONFIG } from "../config.js?v=20261002-flight-sim-terrain";
const nowMs=()=>typeof performance!=="undefined"?performance.now():Date.now();

export class RailDispatcher{
  constructor({network,blockSystem,interlocking,stationOperations,trains}){this.network=network;this.blockSystem=blockSystem;this.interlocking=interlocking;this.stationOperations=stationOperations;this.trains=trains;this.updateTimeMs=0;this.deadlockRecoveryCount=0;this.simulationSeconds=0;this.mostDelayedService="—";this.averageDelay=0;}
  priority(train){const service=train.service,insideJunction=this.interlocking.activeRoutes.has(train.id),cannotStop=train.movementAuthority&&train.movementAuthority.distance<Math.max(30,train.speed*train.speed/(2.2*CONFIG.trainSpeedMultiplier*CONFIG.trainSpeedMultiplier)),late=service?.delaySeconds??0,wait=train.signalWaitSeconds??0,onTimePriority=late<30?500:350,serviceClass=service?.priorityClass?220-service.priorityClass*25:0;return(insideJunction?10000:0)+(cannotStop?5000:0)+(service?.airportService?1000:0)+onTimePriority+serviceClass+Math.min(320,wait*4);}
  updateTrainAheadLookup(){
    const lines=new Map();for(const train of this.trains){const key=`${train.routeId}:${train.trackIndex}:${train.direction}`;if(!lines.has(key))lines.set(key,[]);lines.get(key).push(train);}
    for(const trains of lines.values()){
      if(trains.length<2){for(const train of trains){train.trainAheadDistance=Infinity;train.trainAheadGap=Infinity;train.trainAheadId=null;}continue;}
      trains.sort((a,b)=>a.direction>0?a.progress-b.progress:b.progress-a.progress);
      for(let index=0;index<trains.length;index++){const train=trains[index],ahead=trains[(index+1)%trains.length],distance=this.network.forwardDistance(train.routeId,train.progress,ahead.progress,train.direction);train.trainAheadDistance=distance;train.trainAheadGap=distance-(ahead.formation?.totalLength??120);train.trainAheadId=ahead.id;}
    }
  }
  update(dt,simulationSeconds){
    const start=nowMs();this.simulationSeconds=simulationSeconds;this.stationOperations.updateOccupancy(this.trains);this.interlocking.update(this.trains,dt);this.updateTrainAheadLookup();
    for(const train of this.trains)this.blockSystem.releaseReservations(train.id);
    const ordered=[...this.trains].sort((a,b)=>this.priority(b)-this.priority(a)||a.id.localeCompare(b.id));
    for(const train of ordered){
      const route=this.network.route(train.routeId);if(!route)continue;let stationDistance=Infinity,platformReady=true,nextPhysical=null;
      if(train.nextStation){stationDistance=this.network.forwardDistance(train.routeId,train.progress,train.nextStation.t,train.direction);nextPhysical=this.network.physicalStationId(train.nextStation);if(stationDistance<700&&!this.stationOperations.allocation(train.id))this.stationOperations.allocate(train,train.nextStation,simulationSeconds+stationDistance/Math.max(6,train.speed));platformReady=Boolean(this.stationOperations.allocation(train.id));}
      const sequence=this.network.blocksAhead(train.routeId,train.trackIndex,train.progress,train.direction,6),request=[];
      for(const block of sequence){if(!platformReady&&stationDistance<700&&block.stationIds.includes(nextPhysical))break;if(this.blockSystem.canEnter(train,block))request.push(block);else break;}
      this.blockSystem.reserveBlocks(train,request);
    }
    this.blockSystem.updateSignalAspects();
    for(const train of ordered){
      const current=this.network.blockForProgress(train.routeId,train.trackIndex,train.progress);train.movementAuthority=this.blockSystem.authorityForTrain(train,6);train.nextSignal=this.blockSystem.signalAhead(train);train.signalAspect=train.nextSignal?.aspect??"red";train.permittedSpeed=Math.min(train.routeLimit,train.movementAuthority.speedLimit??train.routeLimit);train.waitingAtSignal=train.signalAspect==="red"&&train.nextSignal?.distance<120;train.signalWaitSeconds=train.waitingAtSignal?(train.signalWaitSeconds??0)+dt:0;
      if(train.signalWaitSeconds>180*CONFIG.trainSpeedMultiplier){this.blockSystem.releaseReservations(train.id);train.signalWaitSeconds=30*CONFIG.trainSpeedMultiplier;this.deadlockRecoveryCount++;if(diagnostics.isEnabled())diagnostics.logSystemWarning("dispatcher","Released stale reservations after an unusually long signal wait",{trainId:train.id,signalAspect:train.signalAspect,distanceToSignal:train.nextSignal?.distance??null,recoveryCount:this.deadlockRecoveryCount});}
      train.junctionSpeedLimit=current?.junctionIds?.length?12*CONFIG.trainSpeedMultiplier:Infinity;
    }
    this.updateDelays(dt);this.updateTimeMs=nowMs()-start;
  }

  updateDelays(dt){
    let total=0,most=null;
    for(const train of this.trains){const service=train.service;if(!service)continue;const expectedSpeed=Math.max(8,service.maximumSpeed*.62);let increment=-.08*dt;if(train.waitingAtSignal)increment=.35*dt;else if(!train.currentStation&&train.speed<expectedSpeed*.35)increment=.12*dt;service.delaySeconds=Math.max(0,(service.delaySeconds??0)+increment);total+=service.delaySeconds;if(!most||service.delaySeconds>most.delaySeconds)most=service;}
    this.averageDelay=this.trains.length?total/this.trains.length:0;this.mostDelayedService=most&&most.delaySeconds>1?`${most.serviceId} ${Math.round(most.delaySeconds)}s`:"—";
  }

  requestTransfer(train,toRouteId){return this.interlocking.request(train,train.routeId,toRouteId);}
  completeTransfer(train){this.interlocking.markTransferComplete(train);}
  diagnostics(){return{...this.blockSystem.diagnostics(),...this.interlocking.diagnostics(),...this.stationOperations.diagnostics(),trainsWaitingAtSignals:this.trains.filter(train=>train.waitingAtSignal).length,averageDelaySeconds:this.averageDelay,mostDelayedService:this.mostDelayedService,dispatcherUpdateMs:this.updateTimeMs,deadlockRecoveryCount:this.deadlockRecoveryCount};}
}
