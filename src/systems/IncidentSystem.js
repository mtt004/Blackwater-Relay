import * as THREE from "three";
import { diagnostics } from "../core/DiagnosticsManager.js?v=20261002-flight-sim-terrain";

export class IncidentSystem {
  constructor(scene,graph,traffic,player,toast){
    this.scene=scene;this.graph=graph;this.traffic=traffic;this.player=player;this.toast=toast;
    this.incidents=[];this.nextId=1;this.chunkManager=null;
  }
  setChunkManager(manager){this.chunkManager=manager;}
  create(){
    const candidates=[...this.graph.lanes.values()].filter(l=>!l.closed&&l.curve.getPointAt(.5).distanceTo(this.player.position)>80);
    if(!candidates.length)return;
    const lane=candidates[Math.floor(Math.random()*candidates.length)];
    lane.closed=true;this.graph.routeCache.clear();
    const p=lane.curve.getPointAt(.55);
    const marker=new THREE.Group();
    for(let i=0;i<4;i++){
      const cone=new THREE.Mesh(new THREE.ConeGeometry(.32,.8,10),new THREE.MeshStandardMaterial({color:0xff6b22,emissive:0x451300,emissiveIntensity:.35}));
      cone.position.set((i-1.5)*1.1,.4,0);marker.add(cone);
    }
    marker.position.copy(p);this.scene.add(marker);
    const incident={
      id:`INC-${String(this.nextId++).padStart(3,"0")}`,type:["Collision","Broken-down vehicle","Road obstruction","Signal failure"][Math.floor(Math.random()*4)],
      laneId:lane.id,roadId:lane.roadId,status:"DISPATCHED",age:0,response:null,marker,unit:null
    };
    const nearest=this.graph.nearestNode(p);
    const start=[...this.graph.nodes.values()].sort((a,b)=>b.position.distanceTo(p)-a.position.distanceTo(p))[0];
    incident.unit=this.traffic.spawnEmergency(start.id,nearest.id);if(incident.unit)incident.unit.diagnosticRole="incident-response";
    this.incidents.push(incident);if(diagnostics.isEnabled())diagnostics.logEvent("incident","incident-created",{id:incident.id,type:incident.type,laneId:incident.laneId,roadId:incident.roadId,status:incident.status,responseVehicleId:incident.unit?.id??null},{entityId:incident.id,position:p});this.toast(`${incident.type} reported on ${lane.roadId}`);
  }
  update(dt){
    for(const inc of [...this.incidents]){
      inc.age+=dt;
      inc.marker.visible=this.chunkManager?this.chunkManager.isDetailedPosition(inc.marker.position):true;
      if(inc.unit&&inc.response===null&&inc.unit.mesh.position.distanceTo(inc.marker.position)<24){
        inc.response=inc.age;inc.status="ON SCENE";inc.unit.dwell=7;if(diagnostics.isEnabled())diagnostics.logEvent("incident","response-arrived",{id:inc.id,responseSeconds:inc.response,responseVehicleId:inc.unit.id},{entityId:inc.id,position:inc.marker.position});
      }
      if(inc.age>38){
        this.resolve(inc);
      }
    }
  }
  resolve(inc){
    const lane=this.graph.lanes.get(inc.laneId);if(lane)lane.closed=false;
    this.graph.routeCache.clear();this.scene.remove(inc.marker);
    if(inc.unit)this.traffic.remove(inc.unit);
    this.incidents=this.incidents.filter(i=>i!==inc);if(diagnostics.isEnabled())diagnostics.logEvent("incident","incident-resolved",{id:inc.id,type:inc.type,laneId:inc.laneId,roadId:inc.roadId,ageSeconds:inc.age},{entityId:inc.id,position:inc.marker.position});
    this.toast(`${inc.id} cleared; road reopened`);
  }
}
