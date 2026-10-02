import * as THREE from "three";
import { createVehicleMesh,animateVehicleMesh,setHeadlightState } from "../vehicles/VehicleFactory.js?v=20261002-flight-sim-terrain";
import { getColliderBroadphaseExtents,getColliderLocalExtents,pointInsideColliderXZ,vehicleIntersectsCollider,getVehicleHitboxProfile,colliderWorldPolygon } from "../vehicles/VehicleHitboxes.js?v=20261002-flight-sim-terrain";
import { diagnostics } from "../core/DiagnosticsManager.js?v=20261002-flight-sim-terrain";
import { WORLD_DEFINITION } from "../world/WorldDefinition.js?v=20261002-flight-sim-terrain";

const WALK_EYE_HEIGHT=1.72,WALK_BODY_RADIUS=.20,CAMERA_COLLISION_CLEARANCE=.38;

export class PlayerController {
  constructor(scene,camera,input,graph,colliders,toast){
    this.scene=scene;this.camera=camera;this.input=input;this.graph=graph;this.colliders=colliders;this.toast=toast;
    this.colliderCellSize=46;this.colliderGrid=this.buildColliderGrid(colliders);this.colliderQuery=[];this.colliderSeen=new Set();this.collisionDebugVisible=false;this.colliderDebug=null;
    const authoritativeBounds=WORLD_DEFINITION.bounds;
    this.worldBounds={minX:authoritativeBounds.minX-20,maxX:authoritativeBounds.maxX+20,minZ:authoritativeBounds.minZ-20,maxZ:authoritativeBounds.maxZ+20};
    this.vehicle=createVehicleMesh("sports",5);this.scene.add(this.vehicle);
    this.position=new THREE.Vector3(-330,.05,5);this.heading=Math.PI/2;this.speed=0;this.steer=0;this.steerAngle=0;this.steerTarget=0;
    this.inVehicle=true;this.inTrain=false;this.inBus=false;this.inAircraft=false;this.railSystem=null;this.airportSystem=null;this.cameraModes=["CHASE","BONNET","COCKPIT","TOP-DOWN"];this.cameraIndex=0;
    this.walkYaw=0;this.walkPitch=0;this.walkCollisionGrace=0;this.nearestLaneId=null;this.nearestLaneT=0;this.roadDistance=0;this.laneAlignment=1;this.ukAssistWarningCooldown=0;this.grip=1;this.headlights=false;
    // Input.endFrame clears mouse deltas every rendered frame, but player movement
    // runs on a fixed simulation step. Buffer pointer movement here so look input
    // survives render frames in which no fixed player update occurs.
    this.pendingLookDX=0;this.pendingLookDY=0;this.pointerLookListenerInstalled=false;
    if(typeof addEventListener==="function"){
      this.onPointerLook=event=>{
        if(typeof document!=="undefined"&&!document.pointerLockElement)return;
        if(this.inVehicle||this.inTrain||this.inBus)return;
        this.pendingLookDX+=Number.isFinite(event.movementX)?event.movementX:0;
        this.pendingLookDY+=Number.isFinite(event.movementY)?event.movementY:0;
      };
      addEventListener("mousemove",this.onPointerLook);this.pointerLookListenerInstalled=true;
    }
    this._forward=new THREE.Vector3();this._right=new THREE.Vector3();this._next=new THREE.Vector3();this._look=new THREE.Vector3();this._desired=new THREE.Vector3();this._safe=new THREE.Vector3();this._lanePoint=new THREE.Vector3();this._laneTangent=new THREE.Vector3();this._exitCandidates=Array.from({length:4},()=>new THREE.Vector3());
    this.vehicle.position.copy(this.position);this.createHeadlights();this.load();this.updateVehicleCameraVisibility();
  }

  createColliderDebug(colliders){
    const positions=[];
    for(const collider of colliders){
      const{halfW,halfD,rotation}=getColliderLocalExtents(collider),cos=Math.cos(rotation),sin=Math.sin(rotation),y0=.04,y1=Math.min(4,Math.max(1.8,collider.h??collider.height??3.2)),corners=[];
      for(const local of[[-halfW,-halfD],[halfW,-halfD],[halfW,halfD],[-halfW,halfD]])corners.push({x:(collider.x??0)+local[0]*cos+local[1]*sin,z:(collider.z??0)-local[0]*sin+local[1]*cos});
      for(let index=0;index<4;index++){const a=corners[index],b=corners[(index+1)%4];positions.push(a.x,y0,a.z,b.x,y0,b.z,a.x,y1,a.z,b.x,y1,b.z,a.x,y0,a.z,a.x,y1,a.z);}
    }
    if(!positions.length)return null;const geometry=new THREE.BufferGeometry();geometry.setAttribute("position",new THREE.Float32BufferAttribute(positions,3));const material=new THREE.LineBasicMaterial({color:0x4bd6ff,transparent:true,opacity:.82,depthWrite:false,toneMapped:false});const lines=new THREE.LineSegments(geometry,material);lines.name="world-collider-debug";lines.visible=false;lines.frustumCulled=false;lines.renderOrder=44;return lines;
  }

  setCollisionDebugVisible(visible){this.collisionDebugVisible=Boolean(visible);if(this.collisionDebugVisible&&!this.colliderDebug){this.colliderDebug=this.createColliderDebug(this.colliders);if(this.colliderDebug)this.scene.add(this.colliderDebug);}if(this.colliderDebug)this.colliderDebug.visible=this.collisionDebugVisible;}

  buildColliderGrid(colliders){
    const grid=new Map(),size=this.colliderCellSize;
    for(const c of colliders){
      const{halfW,halfD}=getColliderBroadphaseExtents(c),minX=Math.floor((c.x-halfW)/size),maxX=Math.floor((c.x+halfW)/size);
      const minZ=Math.floor((c.z-halfD)/size),maxZ=Math.floor((c.z+halfD)/size);
      for(let x=minX;x<=maxX;x++)for(let z=minZ;z<=maxZ;z++){
        const key=x*65536+z;if(!grid.has(key))grid.set(key,[]);grid.get(key).push(c);
      }
    }
    return grid;
  }

  nearbyColliders(position,radius=8){
    const size=this.colliderCellSize,minX=Math.floor((position.x-radius)/size),maxX=Math.floor((position.x+radius)/size),minZ=Math.floor((position.z-radius)/size),maxZ=Math.floor((position.z+radius)/size),seen=this.colliderSeen,result=this.colliderQuery;seen.clear();result.length=0;
    for(let x=minX;x<=maxX;x++)for(let z=minZ;z<=maxZ;z++){const bucket=this.colliderGrid.get(x*65536+z);if(!bucket)continue;for(const collider of bucket){if(seen.has(collider))continue;seen.add(collider);result.push(collider);}}
    return result;
  }

  updateVehicleCameraVisibility(){
    if(!this.vehicle?.userData?.bodyRoot)return;
    // A full exterior mesh cannot be used as a cockpit interior: hiding it prevents the near plane
    // from slicing the roof and bonnet into the large flat polygons visible in the old build.
    this.vehicle.userData.bodyRoot.visible=!this.inVehicle||this.cameraModes[this.cameraIndex]!=="COCKPIT";
  }

  createHeadlights(){
    this.headlightObjects=[];
    for(const x of [-.52,.52]){
      const target=new THREE.Object3D();target.position.set(x,.45,25);this.vehicle.add(target);
      const light=new THREE.SpotLight(0xfff2c8,0,55,Math.PI/8,.45,1.6);light.position.set(x,.62,1.75);light.target=target;light.castShadow=false;this.vehicle.add(light);this.headlightObjects.push(light);
    }
  }

  setRailSystem(system){this.railSystem=system;}
  setAirportSystem(system){this.airportSystem=system;}

  resolveWalkingSurface(position,currentFeetY=0){
    const airport=this.airportSystem?.resolveWalkSurface?.(position,currentFeetY)??null;
    if(airport?.active)return airport;
    return this.railSystem?.resolveWalkSurface?.(position,currentFeetY)??{height:currentFeetY>.8?currentFeetY:0,blocked:currentFeetY>.8,surface:null,reason:currentFeetY>.8?"elevated-edge":null};
  }

  releaseToWalking(feetPosition,yaw,{collisionGrace=.35}={}){
    this.inTrain=false;this.inBus=false;this.inAircraft=false;this.inVehicle=false;this.speed=0;this.steer=0;this.steerAngle=0;this.steerTarget=0;
    this.walkYaw=yaw;this.walkPitch=0;this.pendingLookDX=0;this.pendingLookDY=0;this.walkCollisionGrace=Math.max(this.walkCollisionGrace,collisionGrace);
    this.camera.position.set(feetPosition.x,feetPosition.y+WALK_EYE_HEIGHT,feetPosition.z);
    this.position.set(feetPosition.x,.05,feetPosition.z);
    this.updateVehicleCameraVisibility();
  }

  save(){
    const parked=this.inVehicle?this.position:this.vehicle.position,heading=this.inVehicle?this.heading:this.vehicle.rotation.y;
    localStorage.setItem("urban-systems-save",JSON.stringify({x:parked.x,z:parked.z,heading,time:Date.now()}));
  }
  load(){
    try{
      const saved=JSON.parse(localStorage.getItem("urban-systems-save"));
      if(saved&&Number.isFinite(saved.x)){
        this.position.set(saved.x,.05,saved.z);this.heading=saved.heading??0;
        this.vehicle.position.copy(this.position);this.vehicle.rotation.y=this.heading;
      }
    }catch{}
  }

  findVehicleExitFeetPosition(){
    const vehiclePosition=this.vehicle.position,heading=this.vehicle.rotation.y,forward=this._forward.set(Math.sin(heading),0,Math.cos(heading)),right=this._right.set(forward.z,0,-forward.x),halfWidth=(this.vehicle.userData.width??1.85)*.5,halfLength=(this.vehicle.userData.length??4.45)*.5,candidates=this._exitCandidates;
    candidates[0].copy(vehiclePosition).addScaledVector(right,halfWidth+1.05);candidates[1].copy(vehiclePosition).addScaledVector(right,-halfWidth-1.05);candidates[2].copy(vehiclePosition).addScaledVector(forward,-halfLength-1);candidates[3].copy(vehiclePosition).addScaledVector(forward,halfLength+1);
    for(const candidate of candidates){candidate.y=0;const surface=this.resolveWalkingSurface(candidate,0);if(surface.blocked||this.pointInsideCollider(candidate,WALK_BODY_RADIUS))continue;candidate.y=surface.height;return candidate;}
    return candidates[0].copy(vehiclePosition).addScaledVector(right,halfWidth+1.35).setY(0);
  }

  toggleMode(){
    if(this.inTrain||this.inBus||this.inAircraft)return;
    if(this.inVehicle){
      const feet=this.findVehicleExitFeetPosition(),yaw=this.vehicle.rotation.y;
      this.releaseToWalking(feet,yaw,{collisionGrace:.45});
      if(diagnostics.isEnabled())diagnostics.logEvent("player","exited-car",{vehicleId:"player-car",mode:"walking"},{entityId:"player-car",position:feet});
      this.toast("Exited vehicle — walking mode");
      return;
    }
    if(this.camera.position.distanceTo(this.vehicle.position)>=12){this.toast("Move closer to the car to enter");return;}
    this.inVehicle=true;this.inTrain=false;this.inBus=false;this.inAircraft=false;
    this.position.copy(this.vehicle.position);this.position.y=.05;this.heading=this.vehicle.rotation.y;
    this.speed=0;this.steer=0;this.steerAngle=0;this.steerTarget=0;this.walkCollisionGrace=0;
    this.updateVehicleCameraVisibility();if(diagnostics.isEnabled())diagnostics.logEvent("player","entered-car",{vehicleId:"player-car",mode:"driving"},{entityId:"player-car",position:this.position});this.toast("Entered vehicle");
  }

  setLights(on){
    this.headlights=on;setHeadlightState(this.vehicle,on);for(const light of this.headlightObjects)light.intensity=on?36:0;
  }

  update(dt,time,weather){
    if(this.inTrain||this.inBus||this.inAircraft)return;
    if(this.input.consume("KeyC")){this.cameraIndex=(this.cameraIndex+1)%this.cameraModes.length;this.updateVehicleCameraVisibility();this.toast(`${this.cameraModes[this.cameraIndex]} camera`);}
    if(this.input.consume("KeyL")){this.setLights(!this.headlights);this.toast(`Headlights ${this.headlights?"on":"off"}`);}
    if(this.input.consume("KeyH"))this.toast("Horn");
    if(this.inVehicle){
      this.updateDriving(dt,weather);
      this.vehicle.position.copy(this.position);this.vehicle.rotation.y=this.heading;
    }else this.updateWalking(dt);
    this.updateCamera(dt);animateVehicleMesh(this.vehicle,this.inVehicle?this.speed:0,this.inVehicle?this.steer:0,dt,time);
  }

  updateDriving(dt,weather){
    const accelerate=this.input.isDown("KeyW"),brake=this.input.isDown("KeyS");
    const steerInput=(this.input.isDown("KeyA")?1:0)-(this.input.isDown("KeyD")?1:0),handbrake=this.input.isDown("Space");
    const nearest=this.graph.nearestLane(this.position,this.heading),surface=this.graph.nearestDrivableSurface?.(this.position,this.heading)??nearest;this.nearestLaneId=nearest.lane?.id??null;this.nearestLaneT=nearest.t;this.roadDistance=surface.distance;this.laneAlignment=nearest.alignment??1;this.ukAssistWarningCooldown=Math.max(0,this.ukAssistWarningCooldown-dt);
    const onRoad=surface.onRoad??surface.distance<8.3,wet=weather==="rain";this.grip=(onRoad?1:.46)*(wet?.72:weather==="snow"?.55:1);

    const maxForward=onRoad?52:18,maxReverse=-10;
    if(accelerate){
      const powerFalloff=Math.max(.25,1-Math.max(0,this.speed)/maxForward*.76);
      this.speed+=8.8*powerFalloff*this.grip*dt;
    }
    if(brake){
      if(this.speed>.6)this.speed=Math.max(0,this.speed-13.5*this.grip*dt);
      else this.speed-=5.2*this.grip*dt;
    }
    const rolling=.22+.012*Math.abs(this.speed),aero=.0068*this.speed*Math.abs(this.speed);
    if(!accelerate&&!brake)this.speed-=Math.sign(this.speed)*Math.min(Math.abs(this.speed),(rolling+Math.abs(aero))*dt);
    if(handbrake)this.speed*=Math.max(0,1-dt*(this.speed>0?1.65:2.8));
    this.speed=THREE.MathUtils.clamp(this.speed,maxReverse,maxForward);

    // UK lane assistance keeps the player on the left-hand carriageway without
    // taking away ordinary steering or deliberate lane changes.
    if(onRoad&&nearest.lane&&nearest.t>.045&&nearest.t<.955&&this.speed>1.5){
      const lanePoint=nearest.lane.curve.getPointAt(nearest.t,this._lanePoint),laneTangent=nearest.lane.curve.getTangentAt(nearest.t,this._laneTangent).setY(0).normalize();
      const vehicleForward=this._forward.set(Math.sin(this.heading),0,Math.cos(this.heading)),alignment=vehicleForward.dot(laneTangent);
      if(alignment<.15){
        this.speed=Math.max(0,this.speed-8.5*dt);
        const signed=Math.atan2(vehicleForward.z*laneTangent.x-vehicleForward.x*laneTangent.z,THREE.MathUtils.clamp(alignment,-1,1));
        this.heading+=THREE.MathUtils.clamp(signed,-.85,.85)*dt*.72;
        if(this.ukAssistWarningCooldown<=0){this.toast("Keep left — wrong-way traffic");this.ukAssistWarningCooldown=3.5;}
      }else if(Math.abs(steerInput)<.1&&nearest.distance>(nearest.lane.laneWidth??3.35)*.32){
        const correction=Math.min(.12*dt*Math.max(1,this.speed*.15),.08);this.position.lerp(lanePoint,correction);
      }
    }

    // Keyboard steering is rate limited like a physical steering rack. A brief key tap now
    // produces only a few degrees of road-wheel movement instead of commanding full lock.
    const speedKph=Math.abs(this.speed)*3.6;
    const speedFactor=THREE.MathUtils.smoothstep(speedKph,8,125);
    const maxSteerAngle=THREE.MathUtils.degToRad(34-23*speedFactor);
    this.steerTarget=steerInput*maxSteerAngle;
    const steeringRate=THREE.MathUtils.degToRad(68-29*speedFactor);
    const returnRate=THREE.MathUtils.degToRad(82-24*speedFactor);
    const rate=steerInput===0?returnRate:steeringRate;
    const delta=THREE.MathUtils.clamp(this.steerTarget-this.steerAngle,-rate*dt,rate*dt);
    this.steerAngle+=delta;
    this.steer=maxSteerAngle>0?THREE.MathUtils.clamp(this.steerAngle/maxSteerAngle,-1,1):0;

    const wheelbase=this.vehicle.userData.wheelbase??2.7;
    const rearGrip=handbrake?.48:1;
    let yawRate=Math.abs(this.speed)>.05?this.speed/wheelbase*Math.tan(this.steerAngle)*this.grip*(handbrake?1.18:1):0;
    const maxYawRate=THREE.MathUtils.degToRad(43-19*speedFactor);
    yawRate=THREE.MathUtils.clamp(yawRate,-maxYawRate,maxYawRate);
    this.heading+=yawRate*dt*rearGrip;

    const forward=this._forward.set(Math.sin(this.heading),0,Math.cos(this.heading));
    const next=this._next.copy(this.position).addScaledVector(forward,this.speed*dt),worldCollider=this.vehicleColliderAt(next,this.heading),railBlocked=this.railSystem?.blocksPlayer(this.position,next);
    if(!worldCollider&&!railBlocked)this.position.copy(next);
    else{
      if(worldCollider&&diagnostics.isEnabled()){
        const profile=getVehicleHitboxProfile(this.vehicle.userData.kind??"car"),colliderId=worldCollider.id??worldCollider.name??`building-${Math.round(worldCollider.x)}-${Math.round(worldCollider.z)}`;
        diagnostics.recordCollision({pairKey:`player|${colliderId}|player-car-building`,collisionCategory:String(colliderId).startsWith("rail-")?"player-car-to-station-structure":"player-car-to-building",reason:"Player vehicle compound footprint intersected a static oriented collider",resolved:true,ignored:false,
          entityA:{id:"player-car",type:"player-vehicle",kind:profile.kind,position:next,heading:this.heading,speed:this.speed,velocity:{x:forward.x*this.speed,y:0,z:forward.z*this.speed},playerControlled:true,lodTier:"full",laneId:this.nearestLaneId},
          entityB:{id:colliderId,type:worldCollider.colliderType??"static-collider",position:{x:worldCollider.x,y:0,z:worldCollider.z},heading:worldCollider.collisionRotation??worldCollider.rotation??0,speed:0,playerControlled:false},
          contactPoint:{x:next.x,y:.5,z:next.z},collisionNormal:null,penetrationDepth:null,relativeImpactSpeed:Math.abs(this.speed),appliedCorrection:{movementRejected:true},appliedImpulse:0,
          profiles:{a:{id:profile.kind,dimensions:{length:profile.length,width:profile.width,height:profile.height},localVertices:profile.polygons},b:{id:colliderId,dimensions:{halfWidth:worldCollider.collisionHalfW??worldCollider.halfW,halfDepth:worldCollider.collisionHalfD??worldCollider.halfD,height:worldCollider.h??worldCollider.height??null},worldVertices:colliderWorldPolygon(worldCollider)}},clearanceRadius:.035
        });
      }
      this.speed*=-.12;this.toast("Collision");
    }
    this.position.x=THREE.MathUtils.clamp(this.position.x,this.worldBounds.minX,this.worldBounds.maxX);this.position.z=THREE.MathUtils.clamp(this.position.z,this.worldBounds.minZ,this.worldBounds.maxZ);
  }

  vehicleColliderAt(p,heading,padding=.035){
    const kind=this.vehicle.userData.kind??"car";
    for(const collider of this.nearbyColliders(p,7.5))if(vehicleIntersectsCollider(kind,p,heading,collider,padding))return collider;
    return null;
  }

  collidesAt(p,heading,padding=.035){return Boolean(this.vehicleColliderAt(p,heading,padding));}

  updateWalking(dt){
    this.walkCollisionGrace=Math.max(0,this.walkCollisionGrace-dt);
    const forwardInput=(this.input.isDown("KeyW")?1:0)-(this.input.isDown("KeyS")?1:0),leftInput=(this.input.isDown("KeyA")?1:0),rightInput=(this.input.isDown("KeyD")?1:0);
    const lookDX=this.pendingLookDX!==0?this.pendingLookDX:(this.input.mouseDX??0),lookDY=this.pendingLookDY!==0?this.pendingLookDY:(this.input.mouseDY??0);
    this.pendingLookDX=0;this.pendingLookDY=0;
    this.walkYaw-=lookDX*.002;
    this.walkPitch=THREE.MathUtils.clamp(this.walkPitch-lookDY*.002,-THREE.MathUtils.degToRad(85),THREE.MathUtils.degToRad(85));
    const forward=this._forward.set(Math.sin(this.walkYaw),0,Math.cos(this.walkYaw));
    // The walking camera looks along +Z in its local frame. After lookAt rotates
    // the camera to that direction, screen-left is the opposite of the usual
    // world-space perpendicular. Use an explicitly camera-relative left vector
    // so A always moves left on screen and D always moves right.
    const screenLeft=this._right.set(Math.cos(this.walkYaw),0,-Math.sin(this.walkYaw));
    const dir=this._look.copy(forward).multiplyScalar(forwardInput).addScaledVector(screenLeft,leftInput-rightInput);
    if(dir.lengthSq()>0)dir.normalize();
    const currentFeetY=this.camera.position.y-WALK_EYE_HEIGHT,next=this._next.copy(this.camera.position).addScaledVector(dir,dt*6);next.y=currentFeetY;
    const surface=this.resolveWalkingSurface(next,currentFeetY),worldCollider=this.pointColliderAt(next,WALK_BODY_RADIUS),trainBlocker=this.walkCollisionGrace<=0?this.railSystem?.walkingTrainBlockerAt?.(this.camera.position,next,currentFeetY):null,blockedByRail=Boolean(trainBlocker);
    if(!surface.blocked&&!worldCollider&&!blockedByRail){
      this.camera.position.x=next.x;this.camera.position.z=next.z;this.camera.position.y=surface.height+WALK_EYE_HEIGHT;
    }else if(dir.lengthSq()>0&&diagnostics.isEnabled()){
      if(worldCollider){const colliderId=worldCollider.id??worldCollider.name??`building-${Math.round(worldCollider.x)}-${Math.round(worldCollider.z)}`;diagnostics.recordCollision({pairKey:`player-walk|${colliderId}|walking-building`,collisionCategory:"walking-player-to-building",reason:"Walking clearance circle entered a static collider",resolved:true,ignored:false,entityA:{id:"player",type:"walking-player",position:next,heading:this.walkYaw,speed:6,playerControlled:true},entityB:{id:colliderId,type:worldCollider.colliderType??"static-collider",position:{x:worldCollider.x,y:0,z:worldCollider.z},heading:worldCollider.collisionRotation??worldCollider.rotation??0},contactPoint:next,appliedCorrection:{movementRejected:true},clearanceRadius:WALK_BODY_RADIUS,profiles:{b:{id:colliderId,dimensions:{halfWidth:worldCollider.collisionHalfW??worldCollider.halfW,halfDepth:worldCollider.collisionHalfD??worldCollider.halfD},worldVertices:colliderWorldPolygon(worldCollider)}}});}
      else if(surface.blocked&&surface.blocker){const blocker=surface.blocker,id=`station:${blocker.stationId??"unknown"}:${blocker.name??"structure"}`;diagnostics.recordCollision({pairKey:`player-walk|${id}|station-blocker`,collisionCategory:"walking-player-to-station-blocker",reason:`Station walking blocker rejected movement (${surface.reason})`,resolved:true,ignored:false,entityA:{id:"player",type:"walking-player",position:next,heading:this.walkYaw,speed:6,playerControlled:true},entityB:{id,type:"station-blocker",position:blocker.centre,heading:Math.atan2(blocker.forward?.x??0,blocker.forward?.z??1),stationId:blocker.stationId},contactPoint:next,clearanceRadius:WALK_BODY_RADIUS,appliedCorrection:{movementRejected:true},profiles:{b:{id,dimensions:{halfLength:blocker.halfLength,halfWidth:blocker.halfWidth,minimumHeight:blocker.minimumHeight??0,maximumHeight:blocker.maximumHeight??null}}}});}
      else if(surface.blocked){const walkSurface=surface.surface,stationId=walkSurface?.stationId??"unknown",role=walkSurface?.role??walkSurface?.type??"none",id=`station-surface:${stationId}:${role}:${surface.reason??"blocked"}`;diagnostics.recordCollision({pairKey:`player-walk|${id}|walk-surface`,collisionCategory:"walking-player-to-station-walk-surface",reason:`Station walk-surface solver rejected movement (${surface.reason??"unknown"})`,resolved:true,ignored:false,entityA:{id:"player",type:"walking-player",position:next,heading:this.walkYaw,speed:6,playerControlled:true},entityB:{id,type:"station-walk-surface",stationId,role,surfaceType:walkSurface?.type??null,position:walkSurface?.centre??walkSurface?.from??next},contactPoint:next,clearanceRadius:WALK_BODY_RADIUS,appliedCorrection:{movementRejected:true},profiles:{b:{id,dimensions:{halfLength:walkSurface?.halfLength??null,halfWidth:walkSurface?.halfWidth??null,visualHalfLength:walkSurface?.visualHalfLength??null,visualHalfWidth:walkSurface?.visualHalfWidth??null,from:walkSurface?.from??null,to:walkSurface?.to??null,height:walkSurface?.height??null,structureDepth:walkSurface?.structureDepth??null},verticalContact:{surfaceHeight:surface.surfaceHeight??null,undersideHeight:surface.undersideHeight??null,bodyTop:surface.bodyTop??null,headClearance:surface.headClearance??null},reason:surface.reason??null}}});}
      else if(trainBlocker){const{train,vehicle,vehicleIndex,local,profile,clearance}=trainBlocker,vehicleType=vehicle.userData.type??"train-vehicle",doorOpen=Boolean(train.doorsOpen),doorSide=train.platformSide;diagnostics.recordCollision({pairKey:`player-walk|${train.id}:${vehicleIndex}|train-exterior`,collisionCategory:"walking-player-to-train-exterior",reason:"Walking point entered the train exterior collision profile outside an open platform doorway",resolved:true,ignored:false,entityA:{id:"player",type:"walking-player",position:next,heading:this.walkYaw,speed:6,playerControlled:true},entityB:{id:`${train.id}:${vehicleIndex}`,type:vehicleType,position:vehicle.position,heading:vehicle.rotation.y,speed:train.speed,playerControlled:train.manual,lodTier:train.renderTier,routeId:train.routeId,trackIndex:train.trackIndex},contactPoint:next,clearanceRadius:clearance,trainId:train.id,coachOrPowerCarIndex:vehicleIndex,localContact:local,doorOpen,doorSide,platformSide:train.platformSide,stationBerthState:train.currentStation?"berthed":"not-berthed",platformId:train.allocatedPlatform?.platformId??null,profileName:profile?.id??vehicleType,profileDimensions:{minimumHeight:profile?.minimumHeight,maximumHeight:profile?.maximumHeight},profileLocalVertices:profile?.polygons,renderedObjectDimensions:{length:vehicle.userData.modelLength??vehicle.userData.length,width:vehicle.userData.width,height:vehicle.userData.height},taperedOrRecessedRegion:vehicleType==="class43-power"&&Math.abs(local.z)>4.5,appliedCorrection:{movementRejected:true}});}
    }
    this.position.set(this.camera.position.x,.05,this.camera.position.z);
  }

  pointColliderAt(p,pad=0){for(const collider of this.nearbyColliders(p,2+pad))if(pointInsideColliderXZ(p,collider,pad))return collider;return null;}
  pointInsideCollider(p,pad=0){return Boolean(this.pointColliderAt(p,pad));}

  resolveCamera(desired){
    if(!this.pointInsideCollider(desired,CAMERA_COLLISION_CLEARANCE))return desired;
    const safe=this._safe.copy(desired);for(let i=0;i<12&&this.pointInsideCollider(safe,CAMERA_COLLISION_CLEARANCE);i++)safe.lerp(this.position,.18);return safe;
  }

  updateCamera(dt){
    if(!this.inVehicle){const horizontal=Math.cos(this.walkPitch),look=this._look.set(Math.sin(this.walkYaw)*horizontal,Math.sin(this.walkPitch),Math.cos(this.walkYaw)*horizontal).add(this.camera.position);this.camera.lookAt(look);return;}
    const forward=this._forward.set(Math.sin(this.heading),0,Math.cos(this.heading)),right=this._right.set(forward.z,0,-forward.x),desired=this._desired,look=this._look;
    switch(this.cameraModes[this.cameraIndex]){
      case"BONNET":desired.copy(this.position).addScaledVector(forward,1.62);desired.y+=1.34;look.copy(this.position).addScaledVector(forward,38);look.y+=1.12;break;
      case"COCKPIT":desired.copy(this.position).addScaledVector(forward,.12).addScaledVector(right,-.30);desired.y+=1.22;look.copy(this.position).addScaledVector(forward,42);look.y+=1.18;break;
      case"TOP-DOWN":desired.copy(this.position);desired.y+=85;look.copy(this.position);break;
      default:desired.copy(this.position).addScaledVector(forward,-10.5);desired.y+=4.9;look.copy(this.position).addScaledVector(forward,9);look.y+=1.1;
    }
    const resolved=this.resolveCamera(desired);this.camera.position.lerp(resolved,1-Math.exp(-dt*6));this.camera.lookAt(look);
  }
}
