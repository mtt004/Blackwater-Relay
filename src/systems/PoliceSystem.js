import * as THREE from "three";
import { diagnostics } from "../core/DiagnosticsManager.js?v=20261002-flight-sim-terrain";

const OFFENCES={
  speeding:{label:"Speeding",severity:1,fine:60,points:3},
  redLight:{label:"Driving through a red light",severity:2,fine:100,points:3},
  wrongSide:{label:"Driving on the wrong side",severity:2,fine:100,points:3},
  collision:{label:"Dangerous collision",severity:3,fine:180,points:5},
  pavement:{label:"Driving on a pavement",severity:2,fine:100,points:3},
  failStop:{label:"Failing to stop after a serious crash",severity:4,fine:300,points:6},
  restricted:{label:"Entering a restricted airport area",severity:3,fine:200,points:4}
};

export class PoliceSystem{
  constructor(scene,graph,traffic,signals,player,toast){
    this.scene=scene;this.graph=graph;this.traffic=traffic;this.signals=signals;this.player=player;this.toast=toast;
    this.collisionSystem=null;this.airportSystem=null;this.audioContext=null;this.sirenOscillator=null;this.sirenGain=null;this.units=[];this.offences=[];this.cooldowns=new Map();this.wantedPoints=0;this.wantedLevel=0;this.fines=0;this.licencePoints=0;this.pursuitActive=false;this.lastObservedTime=-Infinity;this.lastOffenceTime=-Infinity;this.lastImpactSeen=0;this.speedTimer=0;this.wrongSideTimer=0;this.pavementTimer=0;this.restrictedTimer=0;this.previousLaneId=null;this.previousLaneT=0;this.rerouteTimer=0;this.escapeTimer=0;this.warningCount=0;
  }
  setCollisionSystem(system){this.collisionSystem=system;}
  enableAudio(){
    if(this.audioContext||typeof window==="undefined")return;
    const Context=window.AudioContext||window.webkitAudioContext;if(!Context)return;
    try{this.audioContext=new Context();this.sirenOscillator=this.audioContext.createOscillator();this.sirenGain=this.audioContext.createGain();this.sirenOscillator.type="sine";this.sirenGain.gain.value=0;this.sirenOscillator.connect(this.sirenGain).connect(this.audioContext.destination);this.sirenOscillator.start();}catch{this.audioContext=null;}
  }
  updateSiren(time){
    if(!this.audioContext||!this.sirenGain||!this.sirenOscillator)return;
    const nearest=this.units.reduce((best,unit)=>Math.min(best,unit.vehicle.mesh.position.distanceTo(this.player.position)),Infinity),audible=this.pursuitActive&&nearest<140;
    const gain=audible?THREE.MathUtils.clamp((140-nearest)/140*.055,0,.055):0;this.sirenGain.gain.setTargetAtTime(gain,this.audioContext.currentTime,.08);this.sirenOscillator.frequency.setTargetAtTime(Math.sin(time*4.5)>0?820:610,this.audioContext.currentTime,.035);
  }
  setAirportSystem(system){this.airportSystem=system;}

  cameraObserved(position){
    for(const unit of this.units)if(unit.vehicle.mesh.position.distanceTo(position)<125)return true;
    for(const node of this.graph.nodes.values())if((node.control==="signal"||node.control==="roundabout")&&node.position.distanceTo(position)<92)return true;
    return false;
  }

  report(type,time,{observed=null}={}){
    const rule=OFFENCES[type];if(!rule)return false;
    const nextAllowed=this.cooldowns.get(type)??-Infinity;if(time<nextAllowed)return false;
    const visible=observed??this.cameraObserved(this.player.position);if(!visible)return false;
    this.cooldowns.set(type,time+(type==="speeding"?12:18));this.lastObservedTime=time;this.lastOffenceTime=time;
    this.wantedPoints=THREE.MathUtils.clamp(this.wantedPoints+rule.severity,0,15);this.wantedLevel=Math.min(5,Math.max(1,Math.ceil(this.wantedPoints/3)));
    this.offences.push({type,label:rule.label,time,severity:rule.severity,status:"ACTIVE"});if(diagnostics.isEnabled())diagnostics.logEvent("police","offence-recorded",{type,label:rule.label,time,severity:rule.severity,wantedLevel:this.wantedLevel,observed:true},{entityId:"player",position:this.player.position});
    if(!this.pursuitActive){this.pursuitActive=true;if(diagnostics.isEnabled())diagnostics.logEvent("police","police-pursuit-started",{trigger:type,wantedLevel:this.wantedLevel},{entityId:"player",position:this.player.position});this.toast(`Police warning: ${rule.label}`);}else this.toast(`${rule.label} · wanted level ${this.wantedLevel}`);
    this.ensureUnits();return true;
  }

  ensureUnits(){
    const desired=Math.min(3,1+Math.floor(Math.max(0,this.wantedLevel-1)/2));
    while(this.units.length<desired){
      const target=this.graph.nearestNode(this.player.position),starts=[...this.graph.nodes.values()].sort((a,b)=>b.position.distanceTo(this.player.position)-a.position.distanceTo(this.player.position));
      const start=starts.find(node=>node.id!==target?.id);if(!start||!target)break;
      const vehicle=this.traffic.spawnEmergency(start.id,target.id);if(!vehicle)break;vehicle.diagnosticRole="police";
      vehicle.policePursuit=true;vehicle.siren=true;vehicle.profile.speed=1.22;vehicle.mesh.userData.police=true;
      this.units.push({vehicle,lastRouteTime:-Infinity,stuckTime:0,lastPosition:vehicle.mesh.position.clone()});
    }
  }

  updatePlayerOffences(dt,time){
    if(!this.player.inVehicle){this.speedTimer=this.wrongSideTimer=this.pavementTimer=this.restrictedTimer=0;return;}
    const lane=this.graph.lanes.get(this.player.nearestLaneId),speedKph=Math.max(0,this.player.speed*3.6),limit=lane?.speedLimit??50;
    this.speedTimer=speedKph>limit+8?this.speedTimer+dt:Math.max(0,this.speedTimer-dt*2);
    if(this.speedTimer>2.4){this.report("speeding",time);this.speedTimer=0;}
    this.wrongSideTimer=(this.player.laneAlignment??1)<-.08?this.wrongSideTimer+dt:Math.max(0,this.wrongSideTimer-dt*2);
    if(this.wrongSideTimer>1.8){this.report("wrongSide",time);this.wrongSideTimer=0;}
    const onPavement=this.player.roadDistance>8.8&&this.player.roadDistance<17&&speedKph>8;
    this.pavementTimer=onPavement?this.pavementTimer+dt:Math.max(0,this.pavementTimer-dt*2);
    if(this.pavementTimer>1.6){this.report("pavement",time);this.pavementTimer=0;}
    const restricted=this.airportSystem?.isRestrictedPosition(this.player.position)&&speedKph>3;
    this.restrictedTimer=restricted?this.restrictedTimer+dt:0;if(this.restrictedTimer>1.2){this.report("restricted",time,{observed:true});this.restrictedTimer=0;}

    if(this.previousLaneId&&this.previousLaneId!==this.player.nearestLaneId&&this.previousLaneT>.925){
      const previous=this.graph.lanes.get(this.previousLaneId),state=previous?this.signals.stateForLane(previous):"green";
      if(previous&&this.graph.nodes.get(previous.to)?.control==="signal"&&state!=="green"&&speedKph>10)this.report("redLight",time,{observed:true});
    }
    this.previousLaneId=this.player.nearestLaneId;this.previousLaneT=this.player.nearestLaneT??0;

    const impact=this.collisionSystem?.lastImpact??0;
    if(impact>6&&impact>this.lastImpactSeen+1){this.report("collision",time,{observed:this.cameraObserved(this.player.position)});this.crashPosition=this.player.position.clone();this.crashTime=time;}
    this.lastImpactSeen=Math.max(impact,this.lastImpactSeen*.985);
    if(this.crashPosition&&time-this.crashTime>3&&time-this.crashTime<14&&this.player.position.distanceTo(this.crashPosition)>45&&speedKph>25){this.report("failStop",time);this.crashPosition=null;}
  }

  rerouteUnits(time,dt){
    this.rerouteTimer-=dt;if(this.rerouteTimer>0)return;this.rerouteTimer=3.5;
    const target=this.graph.nearestNode(this.player.position);if(!target)return;
    for(const unit of this.units){
      const vehicle=unit.vehicle,lane=this.graph.lanes.get(vehicle.laneId);if(!lane)continue;
      const route=this.graph.route(lane.to,target.id);if(route.length<1)continue;
      vehicle.route=[lane.from,...route];vehicle.routeIndex=0;vehicle.serviceNodes=null;vehicle.profile.speed=1.18+.04*this.wantedLevel;unit.lastRouteTime=time;
    }
  }

  recoverStuckUnits(dt){
    const replacements=[];
    for(const unit of this.units){
      const moved=unit.vehicle.mesh.position.distanceTo(unit.lastPosition),playerDistance=unit.vehicle.mesh.position.distanceTo(this.player.position);
      if(playerDistance>22&&moved<.035&&unit.vehicle.speed<.7)unit.stuckTime+=dt;else unit.stuckTime=Math.max(0,unit.stuckTime-dt*2);
      unit.lastPosition.copy(unit.vehicle.mesh.position);
      if(unit.stuckTime>7)replacements.push(unit);
    }
    for(const unit of replacements){this.traffic.remove(unit.vehicle);this.units.splice(this.units.indexOf(unit),1);}
    if(replacements.length)this.ensureUnits();
  }

  finishPursuit(reason="escaped"){
    const total=this.offences.filter(o=>o.status==="ACTIVE").reduce((sum,o)=>sum+(OFFENCES[o.type]?.fine??0),0),points=this.offences.filter(o=>o.status==="ACTIVE").reduce((sum,o)=>sum+(OFFENCES[o.type]?.points??0),0);
    if(reason==="stopped")this.toast(`Police consequence: £${total} fine · ${Math.min(12,points)} licence points`);else this.toast("Police pursuit ended — no unit has sight of you");
    if(reason==="stopped"){this.fines+=total;this.licencePoints=Math.min(12,this.licencePoints+points);}
    for(const offence of this.offences)if(offence.status==="ACTIVE")offence.status=reason.toUpperCase();
    if(diagnostics.isEnabled())diagnostics.logEvent("police","police-pursuit-ended",{reason,totalFine:reason==="stopped"?total:0,licencePoints:reason==="stopped"?Math.min(12,points):0,offences:this.offences.filter(offence=>offence.status===reason.toUpperCase()).length},{entityId:"player",position:this.player.position});
    for(const unit of this.units)this.traffic.remove(unit.vehicle);this.units=[];this.pursuitActive=false;this.wantedPoints=0;this.wantedLevel=0;this.escapeTimer=0;
  }

  update(dt,time){
    this.updatePlayerOffences(dt,time);this.updateSiren(time);if(!this.pursuitActive)return;
    this.ensureUnits();this.rerouteUnits(time,dt);this.recoverStuckUnits(dt);
    const nearest=this.units.reduce((best,unit)=>Math.min(best,unit.vehicle.mesh.position.distanceTo(this.player.position)),Infinity),observed=this.cameraObserved(this.player.position);
    if(observed){this.lastObservedTime=time;this.escapeTimer=0;}else if(nearest>165)this.escapeTimer+=dt;else this.escapeTimer=Math.max(0,this.escapeTimer-dt*.5);
    if(this.player.inVehicle&&Math.abs(this.player.speed)<.35&&nearest<9&&time-this.lastOffenceTime>5){this.finishPursuit("stopped");return;}
    if(this.escapeTimer>28&&time-this.lastObservedTime>28)this.finishPursuit("escaped");
  }

  nearbyPolice(position,radius=35){return this.units.some(unit=>unit.vehicle.mesh.position.distanceTo(position)<radius);}
  getState(){return{wantedLevel:this.wantedLevel,pursuitActive:this.pursuitActive,units:this.units.length,fines:this.fines,licencePoints:this.licencePoints,latest:this.offences.at(-1)?.label??"None"};}
}
