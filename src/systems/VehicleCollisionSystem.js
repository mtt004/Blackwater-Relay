import * as THREE from "three";
import {
  getVehicleMass,createWorldHitboxBuffer,populateWorldHitboxPolygons,computePolygonsAABB,
  intersectCompoundHitboxes,createVehicleHitboxDebug,getVehicleHitboxProfile
} from "../vehicles/VehicleHitboxes.js?v=20261002-flight-sim-terrain";
import { diagnostics } from "../core/DiagnosticsManager.js?v=20261002-flight-sim-terrain";

const CELL_SIZE=14;
function gridKey(x,z){return x*65536+z;}
function resetGrid(system){for(const bucket of system.activeBuckets)bucket.length=0;system.activeBuckets.length=0;system.grid.clear();}

export class VehicleCollisionSystem{
  constructor(scene,player,traffic,toast){
    this.scene=scene;this.player=player;this.traffic=traffic;this.toast=toast;
    this.debugVisible=false;this.contacts=0;this.lastImpact=0;this.pairCooldown=new Map();
    this.entities=[];this.entityById=new Map();this.grid=new Map();this.activeBuckets=[];this.bucketPool=[];this.testedPairs=new Set();
    this._forwardA=new THREE.Vector2();this._forwardB=new THREE.Vector2();this._velocityA=new THREE.Vector2();this._velocityB=new THREE.Vector2();this._relative=new THREE.Vector2();this._newVelocityA=new THREE.Vector2();this._newVelocityB=new THREE.Vector2();this._tangent=new THREE.Vector2();
  }

  ensureDebugMeshes(){
    if(!this.player.vehicle.userData.hitboxDebug){const debug=createVehicleHitboxDebug(this.player.vehicle.userData.kind,0x42d9ff);this.player.vehicle.add(debug);this.player.vehicle.userData.hitboxDebug=debug;}
    for(const vehicle of this.traffic.vehicles){if(vehicle.mesh.userData.hitboxDebug)continue;const debug=createVehicleHitboxDebug(vehicle.kind,vehicle.kind==="bus"?0xffcf4a:vehicle.kind==="emergency"?0xff4a4a:0xff9f43);vehicle.mesh.add(debug);vehicle.mesh.userData.hitboxDebug=debug;}
  }

  toggleDebug(){this.debugVisible=!this.debugVisible;if(this.debugVisible)this.ensureDebugMeshes();this.updateDebugVisibility();return this.debugVisible;}
  updateDebugVisibility(){const playerDebug=this.player.vehicle.userData.hitboxDebug;if(playerDebug)playerDebug.visible=this.debugVisible&&this.player.vehicle.visible;for(const vehicle of this.traffic.vehicles){const debug=vehicle.mesh.userData.hitboxDebug;if(debug)debug.visible=this.debugVisible&&vehicle.mesh.visible;}}

  descriptor(id,type,kind,source){
    let entity=this.entityById.get(id);if(!entity){entity={id,type,kind,source,position:null,heading:0,speed:0,mass:getVehicleMass(kind),polygons:createWorldHitboxBuffer(kind),aabb:{minX:0,maxX:0,minZ:0,maxZ:0},numericId:this.entityById.size+1};this.entityById.set(id,entity);}else if(entity.kind!==kind){entity.kind=kind;entity.mass=getVehicleMass(kind);entity.polygons=createWorldHitboxBuffer(kind);}entity.type=type;entity.source=source;return entity;
  }
  buildEntities(){
    this.entities.length=0;
    const playerPosition=this.player.inVehicle?this.player.position:this.player.vehicle.position,playerHeading=this.player.inVehicle?this.player.heading:this.player.vehicle.rotation.y,playerKind=this.player.vehicle.userData.kind??"car",playerEntity=this.descriptor("player","player",playerKind,this.player);playerEntity.position=playerPosition;playerEntity.heading=playerHeading;playerEntity.speed=this.player.inVehicle?this.player.speed:0;this.entities.push(playerEntity);
    for(const vehicle of this.traffic.vehicles){const entity=this.descriptor(vehicle.id,"traffic",vehicle.kind,vehicle);entity.position=vehicle.mesh.position;entity.heading=vehicle.mesh.rotation.y;entity.speed=vehicle.speed;this.entities.push(entity);}return this.entities;
  }
  addToGrid(entity){
    const aabb=entity.aabb,minX=Math.floor(aabb.minX/CELL_SIZE),maxX=Math.floor(aabb.maxX/CELL_SIZE),minZ=Math.floor(aabb.minZ/CELL_SIZE),maxZ=Math.floor(aabb.maxZ/CELL_SIZE);
    for(let x=minX;x<=maxX;x++)for(let z=minZ;z<=maxZ;z++){const key=gridKey(x,z);let bucket=this.grid.get(key);if(!bucket){bucket=this.bucketPool.pop()??[];bucket.length=0;this.grid.set(key,bucket);this.activeBuckets.push(bucket);}bucket.push(entity);}
  }

  update(dt,time){
    if(this.debugVisible){this.ensureDebugMeshes();this.updateDebugVisibility();}this.contacts=0;resetGrid(this);this.testedPairs.clear();
    const entities=this.buildEntities();
    for(const entity of entities){populateWorldHitboxPolygons(entity.kind,entity.position,entity.heading,entity.polygons);computePolygonsAABB(entity.polygons,entity.aabb);this.addToGrid(entity);}
    for(const bucket of this.activeBuckets)for(let i=0;i<bucket.length;i++)for(let j=i+1;j<bucket.length;j++){
      const a=bucket[i],b=bucket[j],low=Math.min(a.numericId,b.numericId),high=Math.max(a.numericId,b.numericId),pairNumber=low*65536+high;if(this.testedPairs.has(pairNumber))continue;this.testedPairs.add(pairNumber);
      if(a.type==="traffic"&&b.type==="traffic"&&a.source.renderTier==="outline"&&b.source.renderTier==="outline")continue;
      if(a.aabb.maxX<b.aabb.minX||b.aabb.maxX<a.aabb.minX||a.aabb.maxZ<b.aabb.minZ||b.aabb.maxZ<a.aabb.minZ)continue;
      const contact=intersectCompoundHitboxes(a.polygons,b.polygons);if(!contact)continue;this.contacts++;this.resolve(a,b,contact,dt,time,a.id<b.id?`${a.id}|${b.id}`:`${b.id}|${a.id}`);
    }
    for(const[key,until]of this.pairCooldown)if(until<time)this.pairCooldown.delete(key);
    while(this.bucketPool.length<256&&this.activeBuckets.length){const bucket=this.activeBuckets.pop();bucket.length=0;this.bucketPool.push(bucket);}
  }

  resolve(a,b,contact,dt,time,pairKey){
    const normal=contact.normal,depth=Math.min(contact.depth,1.8),invA=1/a.mass,invB=1/b.mass,invSum=invA+invB,correction=Math.max(0,depth-.018)*.78/invSum;
    const fA=this._forwardA.set(Math.sin(a.heading),Math.cos(a.heading)),fB=this._forwardB.set(Math.sin(b.heading),Math.cos(b.heading)),vA=this._velocityA.copy(fA).multiplyScalar(a.speed),vB=this._velocityB.copy(fB).multiplyScalar(b.speed),relative=this._relative.copy(vB).sub(vA),closing=relative.dot(normal);
    let appliedImpulse=0,frictionImpulse=0;
    if(closing<0){
      const restitution=.08;appliedImpulse=-(1+restitution)*closing/invSum;const newVA=this._newVelocityA.copy(vA).addScaledVector(normal,-appliedImpulse*invA),newVB=this._newVelocityB.copy(vB).addScaledVector(normal,appliedImpulse*invB),tangent=this._tangent.set(-normal.y,normal.x),tangentSpeed=relative.dot(tangent);frictionImpulse=THREE.MathUtils.clamp(-tangentSpeed/invSum,-appliedImpulse*.32,appliedImpulse*.32);
      newVA.addScaledVector(tangent,-frictionImpulse*invA);newVB.addScaledVector(tangent,frictionImpulse*invB);this.setEntitySpeed(a,newVA.dot(fA));this.setEntitySpeed(b,newVB.dot(fB));
      const impact=Math.abs(closing);this.lastImpact=Math.max(this.lastImpact*.9,impact);if((a.type==="player"||b.type==="player")&&impact>1.4&&!this.pairCooldown.has(pairKey)){this.pairCooldown.set(pairKey,time+.7);this.toast(impact>8?"Heavy vehicle impact":"Vehicle contact");}
    }
    if(diagnostics.isEnabled()){
      const roleA=a.source?.diagnosticRole,roleB=b.source?.diagnosticRole,policeContact=roleA==="police"||roleB==="police",profileA=getVehicleHitboxProfile(a.kind),profileB=getVehicleHitboxProfile(b.kind);
      diagnostics.recordCollision({
        pairKey:`${pairKey}|vehicle-contact`,collisionCategory:policeContact?"police-to-vehicle":"vehicle-to-vehicle",reason:"Compound vehicle hitbox polygons overlapped under SAT",resolved:true,ignored:false,
        entityA:{id:a.id,type:a.type,kind:a.kind,role:roleA??null,position:a.position,heading:a.heading,speed:a.speed,velocity:{x:vA.x,y:0,z:vA.y},playerControlled:a.type==="player",lodTier:a.source?.renderTier??"full",laneId:a.source?.laneId??this.player?.nearestLaneId??null},
        entityB:{id:b.id,type:b.type,kind:b.kind,role:roleB??null,position:b.position,heading:b.heading,speed:b.speed,velocity:{x:vB.x,y:0,z:vB.y},playerControlled:b.type==="player",lodTier:b.source?.renderTier??"full",laneId:b.source?.laneId??this.player?.nearestLaneId??null},
        contactPoint:{x:(a.position.x+b.position.x)*.5,y:.5,z:(a.position.z+b.position.z)*.5},collisionNormal:{x:normal.x,y:0,z:normal.y},penetrationDepth:depth,relativeImpactSpeed:Math.max(0,-closing),appliedCorrection:{entityA:{x:-normal.x*correction*invA,z:-normal.y*correction*invA},entityB:{x:normal.x*correction*invB,z:normal.y*correction*invB}},appliedImpulse,frictionImpulse,
        profiles:{a:{id:profileA.kind,dimensions:{length:profileA.length,width:profileA.width,height:profileA.height},localVertices:profileA.polygons,worldVertices:a.polygons},b:{id:profileB.kind,dimensions:{length:profileB.length,width:profileB.width,height:profileB.height},localVertices:profileB.polygons,worldVertices:b.polygons}}
      });
    }
    this.moveEntity(a,-normal.x*correction*invA,-normal.y*correction*invA);this.moveEntity(b,normal.x*correction*invB,normal.y*correction*invB);
  }

  moveEntity(entity,dx,dz){
    if(entity.type==="player"){const target=entity.source.inVehicle?entity.source.position:entity.source.vehicle.position;target.x+=dx;target.z+=dz;return;}
    const vehicle=entity.source,lane=this.traffic.graph.lanes.get(vehicle.laneId);if(!vehicle.collisionOffset)vehicle.collisionOffset=new THREE.Vector3();vehicle.collisionOffset.x=THREE.MathUtils.clamp(vehicle.collisionOffset.x+dx,-1.25,1.25);vehicle.collisionOffset.z=THREE.MathUtils.clamp(vehicle.collisionOffset.z+dz,-1.25,1.25);
    if(lane){const tangent=lane.curve.getTangentAt(THREE.MathUtils.clamp(vehicle.progress,0,1));const longitudinal=dx*tangent.x+dz*tangent.z;vehicle.progress=THREE.MathUtils.clamp(vehicle.progress+longitudinal/Math.max(1,lane.length)*.55,0,.999);this.traffic.place(vehicle);}
  }
  setEntitySpeed(entity,speed){if(entity.type==="player"){if(entity.source.inVehicle)entity.source.speed=THREE.MathUtils.clamp(speed,-12,52);}else entity.source.speed=THREE.MathUtils.clamp(speed,0,45);}
}
