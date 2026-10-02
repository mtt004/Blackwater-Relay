import { diagnostics } from "../core/DiagnosticsManager.js?v=20261002-flight-sim-terrain";
export class RailInterlocking{
  constructor(network,blockSystem){this.network=network;this.blockSystem=blockSystem;this.activeRoutes=new Map();this.deniedRequests=0;}
  routeId(fromRouteId,toRouteId,trackIndex,direction){return`jr:${fromRouteId}-${toRouteId}:t${trackIndex}:d${direction>0?"p":"n"}`;}
  request(train,fromRouteId,toRouteId){
    const id=this.routeId(fromRouteId,toRouteId,train.trackIndex,train.direction),recording=diagnostics.isEnabled();
    if(recording)diagnostics.logEvent("railway","interlocking-route-requested",{trainId:train.id,routeId:id,fromRouteId,toRouteId,trackIndex:train.trackIndex,direction:train.direction},{entityId:train.id,position:train.headPosition});
    const reject=(reason,countDenied=true)=>{if(countDenied)this.deniedRequests++;if(recording)diagnostics.logEvent("railway","interlocking-route-rejected",{trainId:train.id,routeId:id,fromRouteId,toRouteId,reason},{entityId:train.id,position:train.headPosition});return{granted:false,reason};};
    const junction=this.network.junctions[0];if(!junction)return reject("no-junction",false);const route=junction.routes.get(id);if(!route)return reject("no-route",false);
    if(junction.lockedBy&&junction.lockedBy!==train.id)return reject("conflicting-route");
    for(const blockId of route.requiredBlockIds){const block=this.blockSystem.block(blockId);if(!block||[...block.occupiedBy].some(owner=>owner!==train.id)||(block.reservedBy&&block.reservedBy!==train.id))return reject("blocks-unavailable");}
    junction.lockedRouteId=id;junction.lockedBy=train.id;junction.releasePending=false;this.activeRoutes.set(train.id,{junction,route,entered:false});if(recording)diagnostics.logEvent("railway","interlocking-route-accepted",{trainId:train.id,routeId:id,fromRouteId,toRouteId,requiredBlockIds:route.requiredBlockIds},{entityId:train.id,position:train.headPosition});return{granted:true,route};
  }
  markEntered(train){const active=this.activeRoutes.get(train.id);if(active){active.entered=true;active.junction.enteredBy=train.id;if(diagnostics.isEnabled())diagnostics.logEvent("railway","route-transfer-started",{trainId:train.id,routeId:active.route.id??active.junction.lockedRouteId},{entityId:train.id,position:train.headPosition});}}
  markTransferComplete(train){const active=this.activeRoutes.get(train.id);if(active){active.transferComplete=true;active.junction.releasePending=true;active.clearRouteId=train.routeId;active.clearStartProgress=train.progress;active.clearDirection=train.direction;active.clearDistance=(train.formation?.totalLength??120)+12;active.elapsed=0;if(diagnostics.isEnabled())diagnostics.logEvent("railway","route-transfer-completed",{trainId:train.id,routeId:active.route.id??active.junction.lockedRouteId,toRouteId:train.routeId,clearDistance:active.clearDistance},{entityId:train.id,position:train.headPosition});}}
  update(trains,dt=0){
    const trainById=new Map(trains.map(train=>[train.id,train]));
    for(const [trainId,active] of this.activeRoutes){const train=trainById.get(trainId);if(!train){this.release(trainId);continue;}if(!active.transferComplete)continue;active.elapsed=(active.elapsed??0)+dt;const travelled=this.network.forwardDistance(active.clearRouteId,active.clearStartProgress,train.progress,active.clearDirection),occupiedRequired=active.route.requiredBlockIds.some(id=>this.blockSystem.block(id)?.occupiedBy.has(trainId));if(travelled>=active.clearDistance&&!occupiedRequired)this.release(trainId);}
  }
  release(trainId){const active=this.activeRoutes.get(trainId);if(!active)return;const junction=active.junction,routeId=junction.lockedRouteId;if(junction.lockedBy===trainId){junction.lockedRouteId=null;junction.lockedBy=null;junction.enteredBy=null;junction.releasePending=false;}this.activeRoutes.delete(trainId);if(diagnostics.isEnabled())diagnostics.logEvent("railway","interlocking-route-released",{trainId,routeId});}
  canPointsMove(junctionId){const junction=this.network.junctionById.get(junctionId);return Boolean(junction)&&!junction.lockedBy;}
  diagnostics(){return{activeJunctionRoutes:this.activeRoutes.size,deniedRequests:this.deniedRequests};}
}
