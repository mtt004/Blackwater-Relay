const statusPriority={"Boarding":0,"Approaching":1,"On time":2,"Delayed":3,"Available":4};

export class StationOperations{
  constructor(network){this.network=network;this.allocations=new Map();this.displays=[];this.doubleBookingAttempts=0;this.lastInformationUpdate=0;}
  allocation(trainId){return this.allocations.get(trainId)??null;}
  compatiblePlatforms(train,station){return this.network.compatiblePlatforms(station,train.routeId,train.trackIndex).filter(platform=>platform.length>=(train.formation?.totalLength??0)+8);}
  allocate(train,station,predictedArrival=0){
    const existing=this.allocations.get(train.id);if(existing&&existing.physicalStationId===this.network.physicalStationId(station))return existing;
    if(existing)this.release(train.id);
    const preferred=train.service?.platformPreferences??[],candidates=this.compatiblePlatforms(train,station).sort((a,b)=>{const ai=preferred.indexOf(a.platformNumber),bi=preferred.indexOf(b.platformNumber);return(ai<0?99:ai)-(bi<0?99:bi)||a.platformNumber-b.platformNumber;});
    const platform=candidates.find(item=>(!item.occupiedBy||item.occupiedBy===train.id)&&(!item.reservedBy||item.reservedBy===train.id));if(!platform)return null;
    platform.reservedBy=train.id;platform.reservedUntil=predictedArrival+90;platform.status="Approaching";const allocation={trainId:train.id,serviceId:train.service?.serviceId??train.id,physicalStationId:platform.physicalStationId,stationId:station.id,platformId:platform.id,platformNumber:platform.platformNumber,centreOffset:platform.centreOffset,routeId:train.routeId,trackIndex:train.trackIndex,predictedArrival};this.allocations.set(train.id,allocation);train.allocatedPlatform=allocation;return allocation;
  }
  occupy(train,station){const allocation=this.allocations.get(train.id)??this.allocate(train,station,0);if(!allocation)return null;const platform=this.network.platformById.get(allocation.platformId);if(platform&&(!platform.occupiedBy||platform.occupiedBy===train.id)){platform.occupiedBy=train.id;platform.status="Boarding";return allocation;}this.doubleBookingAttempts++;return null;}
  release(trainId){const allocation=this.allocations.get(trainId);if(!allocation)return;const platform=this.network.platformById.get(allocation.platformId);if(platform){if(platform.occupiedBy===trainId)platform.occupiedBy=null;if(platform.reservedBy===trainId)platform.reservedBy=null;platform.status="Available";}this.allocations.delete(trainId);}
  updateOccupancy(trains){
    const active=new Set(trains.map(train=>train.id));for(const train of trains){if(train.currentStation)this.occupy(train,train.currentStation);else{const allocation=this.allocations.get(train.id);if(allocation){const station=train.route?.stations?.find(item=>item.id===allocation.stationId);const distance=station?Math.min(train.route.length,Math.abs(train.progress-station.t)*train.route.length):Infinity;if(distance>(train.formation?.totalLength??120)+120&&train.lastStationId===allocation.stationId)this.release(train.id);}}}
    for(const trainId of [...this.allocations.keys()])if(!active.has(trainId))this.release(trainId);
  }
  platformForTrain(train){return this.allocations.get(train.id)??null;}
  registerDisplay(display){this.displays.push(display);}
  nextTrainForPlatform(display,trains){
    const candidates=[];
    for(const train of trains){
      const allocation=this.allocations.get(train.id);let station=null,platformNumber=null;
      if(allocation&&allocation.physicalStationId===display.physicalStationId){station=train.route.stations.find(item=>item.id===allocation.stationId);platformNumber=allocation.platformNumber;}
      else{station=train.route.stations.find(item=>this.network.physicalStationId(item)===display.physicalStationId&&train.service?.callsAt(train.routeId,item));if(station){const compatible=this.network.compatiblePlatforms(station,train.routeId,train.trackIndex),preferred=train.service?.platformPreferences??[],chosen=compatible.sort((a,b)=>{const ai=preferred.indexOf(a.platformNumber),bi=preferred.indexOf(b.platformNumber);return(ai<0?99:ai)-(bi<0?99:bi)||a.platformNumber-b.platformNumber;})[0];platformNumber=chosen?.platformNumber;}}
      if(!station||platformNumber!==display.platformNumber)continue;const distance=this.network.forwardDistance(train.routeId,train.progress,station.t,train.direction);candidates.push({train,distance,allocation});
    }
    candidates.sort((a,b)=>a.distance-b.distance);return candidates[0]??null;
  }
  updateInformation(trains,simulationSeconds){
    this.lastInformationUpdate=simulationSeconds;
    for(const display of this.displays){const item=this.nextTrainForPlatform(display,trains),context=display.context,canvas=display.canvas;if(!context||!canvas)continue;context.fillStyle="#10253d";context.fillRect(0,0,canvas.width,canvas.height);context.fillStyle="#ffffff";context.font="bold 38px sans-serif";context.fillText(`PLATFORM ${display.platformNumber}`,28,48);
      if(!item){context.font="30px sans-serif";context.fillStyle="#b8c8d8";context.fillText("No train currently allocated",28,112);display.board.userData.displayData={platformNumber:display.platformNumber,status:"No train"};display.texture.needsUpdate=true;continue;}
      const {train}=item,service=train.service,route=train.route,stops=service?.stopsForRoute(route.id)??route.stations.map(station=>station.id),stationNames=stops.map(id=>route.stations.find(station=>station.id===id||station.sharedPhysicalStationId===id)?.name).filter(Boolean),destination=service?.destinationForRoute(route.id,route)??route.name,status=train.currentStation?"Boarding":train.waitingAtSignal?"Held at signal":(service?.delaySeconds??0)>20?`Delayed ${Math.round(service.delaySeconds/60)} min`:"On time",eta=Math.max(0,Math.round(item.distance/Math.max(5,train.speed||15)));
      context.font="bold 30px sans-serif";context.fillStyle="#f2c94c";context.fillText(`${service?.displayName??train.id} → ${destination}`,28,92);context.font="24px sans-serif";context.fillStyle="#ffffff";context.fillText(`${status} • dep. ~${eta}s`,28,126);context.font="21px sans-serif";context.fillStyle="#dbe7ef";context.fillText(`Calls: ${stationNames.join(" • ")}`,28,174);display.board.userData.routeStops=stationNames;display.board.userData.displayData={platformNumber:display.platformNumber,serviceId:service?.serviceId,destination,serviceType:service?.serviceType,callingPoints:stationNames,status,estimatedDepartureSeconds:eta,delaySeconds:service?.delaySeconds??0};display.texture.needsUpdate=true;}
  }
  diagnostics(){let occupied=0,reserved=0;for(const platform of this.network.platforms){if(platform.occupiedBy)occupied++;if(platform.reservedBy)reserved++;}return{occupiedPlatforms:occupied,reservedPlatforms:reserved,doubleBookingAttempts:this.doubleBookingAttempts};}
}
