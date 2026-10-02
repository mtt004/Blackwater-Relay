import * as THREE from "three";
import { createHSTFormation } from "./HSTFactory.js?v=20261002-flight-sim-terrain";
import { offsetPointOnRail,forwardArcDistance,wrappedProgress } from "./RailPlan.js?v=20261002-flight-sim-terrain";
import { pointInsideColliderXZ } from "../vehicles/VehicleHitboxes.js?v=20261002-flight-sim-terrain";
import { chunkKeyForPosition } from "../world/WorldChunkManager.js?v=20261002-flight-sim-terrain";
import { CONFIG } from "../config.js?v=20261002-flight-sim-terrain";
import { qualityManager } from "../core/QualityManager.js?v=20261002-flight-sim-terrain";
import { RailNetwork } from "./RailNetwork.js?v=20261002-flight-sim-terrain";
import { RailBlockSystem } from "./RailBlockSystem.js?v=20261002-flight-sim-terrain";
import { RailInterlocking } from "./RailInterlocking.js?v=20261002-flight-sim-terrain";
import { RailDispatcher } from "./RailDispatcher.js?v=20261002-flight-sim-terrain";
import { createDefaultTrainServices } from "./TrainService.js?v=20261002-flight-sim-terrain";
import { StationOperations } from "./StationOperations.js?v=20261002-flight-sim-terrain";
import { RailSignalRenderer } from "./RailSignalRenderer.js?v=20261002-flight-sim-terrain";
import { pointInsideCollisionProfileXZ,distanceToCollisionProfileXZ,createCollisionProfileDebug } from "../collision/LocalCollisionProfile.js?v=20261002-flight-sim-terrain";
import { diagnostics } from "../core/DiagnosticsManager.js?v=20261002-flight-sim-terrain";

const UP=new THREE.Vector3(0,1,0);
const STAIR_SURFACE_LENGTH_TOLERANCE=.02;
const STAIR_SURFACE_WIDTH_TOLERANCE=.02;
// The staircase is a thin inclined structure, not a solid prism extending to
// the floor below it. These dimensions match the rendered slab/tread envelope
// and provide only a small head-clearance safety margin.
const STAIR_STRUCTURE_DEPTH=.32;
const STAIR_HEAD_CLEARANCE=.04;

function segmentMatrix(a,b,width,height,verticalOffset=0){
  const mid=a.clone().add(b).multiplyScalar(.5),direction=b.clone().sub(a),len=direction.length(),o=new THREE.Object3D();
  o.position.copy(mid);o.position.y+=verticalOffset;
  if(len>1e-6)o.quaternion.setFromUnitVectors(new THREE.Vector3(0,0,1),direction.normalize());
  o.scale.set(width,height,len+.18);o.updateMatrix();return o.matrix.clone();
}
function uprightMatrix(position,width,height,depth,baseY=0){
  const o=new THREE.Object3D();o.position.set(position.x,baseY+height*.5,position.z);o.scale.set(width,height,depth);o.updateMatrix();return o.matrix.clone();
}
function horizontalSegmentMatrix(a,b,width,height,baseY=0){
  const flatA=new THREE.Vector3(a.x,0,a.z),flatB=new THREE.Vector3(b.x,0,b.z),mid=flatA.clone().add(flatB).multiplyScalar(.5),length=flatA.distanceTo(flatB),o=new THREE.Object3D();
  o.position.set(mid.x,baseY+height*.5,mid.z);o.rotation.y=Math.atan2(flatB.x-flatA.x,flatB.z-flatA.z);o.scale.set(width,height,length+.22);o.updateMatrix();return o.matrix.clone();
}
function pointSegmentDistanceXZ(point,a,b){
  const abx=b.x-a.x,abz=b.z-a.z,apx=point.x-a.x,apz=point.z-a.z,den=abx*abx+abz*abz||1,t=THREE.MathUtils.clamp((apx*abx+apz*abz)/den,0,1);
  return Math.hypot(point.x-(a.x+abx*t),point.z-(a.z+abz*t));
}
function orientationXZ(a,b,c){return(b.x-a.x)*(c.z-a.z)-(b.z-a.z)*(c.x-a.x);}
function segmentsIntersectXZ(a,b,c,d){
  const o1=orientationXZ(a,b,c),o2=orientationXZ(a,b,d),o3=orientationXZ(c,d,a),o4=orientationXZ(c,d,b),epsilon=1e-7;
  if(Math.abs(o1)<epsilon&&pointSegmentDistanceXZ(c,a,b)<epsilon)return true;
  if(Math.abs(o2)<epsilon&&pointSegmentDistanceXZ(d,a,b)<epsilon)return true;
  if(Math.abs(o3)<epsilon&&pointSegmentDistanceXZ(a,c,d)<epsilon)return true;
  if(Math.abs(o4)<epsilon&&pointSegmentDistanceXZ(b,c,d)<epsilon)return true;
  return(o1>0)!==(o2>0)&&(o3>0)!==(o4>0);
}
function segmentSegmentDistanceXZ(a,b,c,d){
  if(segmentsIntersectXZ(a,b,c,d))return 0;
  return Math.min(pointSegmentDistanceXZ(a,c,d),pointSegmentDistanceXZ(b,c,d),pointSegmentDistanceXZ(c,a,b),pointSegmentDistanceXZ(d,a,b));
}
function pointInOrientedRectangleXZ(point,centre,forward,right,halfLength,halfWidth){
  const relative=point.clone().sub(centre).setY(0);
  return Math.abs(relative.dot(forward))<=halfLength&&Math.abs(relative.dot(right))<=halfWidth;
}
function circularArcDistance(a,b,length){const raw=((a-b)%1+1)%1,delta=Math.min(raw,1-raw);return delta*length;}
function instanceMesh(parent,geometry,material,matrices,{castShadow=false,receiveShadow=false}={}){
  if(!matrices.length)return null;const mesh=new THREE.InstancedMesh(geometry,material,matrices.length);
  matrices.forEach((m,i)=>mesh.setMatrixAt(i,m));mesh.castShadow=castShadow;mesh.receiveShadow=receiveShadow;mesh.instanceMatrix.setUsage(THREE.StaticDrawUsage);mesh.computeBoundingSphere();mesh.matrixAutoUpdate=false;mesh.updateMatrix();parent.add(mesh);return mesh;
}
function trackOffsetFor(plan,trackIndex){return plan.trackOffsets?.[trackIndex]??(trackIndex===0?-plan.trackOffset:plan.trackOffset);}
function trackPosition(plan,t,trackIndex,target=null){return offsetPointOnRail(plan,t,trackOffsetFor(plan,trackIndex),target);}
function trackTangent(plan,t,direction,target=null){
  const result=target??new THREE.Vector3();if(plan.lookup)plan.lookup.sampleTangent(t,result);else plan.curve.getTangentAt(wrappedProgress(t),result).normalize();return result.multiplyScalar(direction);
}

const stationPedestrianBodyMaterials=new Map(),stationPedestrianHeadMaterial=new THREE.MeshStandardMaterial({color:0xc89470,roughness:.9});
function createStationPedestrianMesh(color){
  if(!stationPedestrianBodyMaterials.has(color))stationPedestrianBodyMaterials.set(color,new THREE.MeshStandardMaterial({color,roughness:.82}));
  const group=new THREE.Group(),body=new THREE.Mesh(new THREE.CapsuleGeometry(.24,.72,4,8),stationPedestrianBodyMaterials.get(color)),head=new THREE.Mesh(new THREE.SphereGeometry(.21,10,8),stationPedestrianHeadMaterial);
  body.position.y=.88;head.position.y=1.53;body.castShadow=true;head.castShadow=true;group.add(body,head);return group;
}

export class RailSystem{
  constructor(scene,camera,input,graph,chunkManager,plan,toast,obstacles=[]){
    this.scene=scene;this.camera=camera;this.input=input;this.graph=graph;this.chunkManager=chunkManager;this.plan=plan;this.toast=toast;
    this.routes=plan.routes??[plan];this.routeById=new Map(this.routes.map(route=>[route.id??"city",route]));this.allRouteStations=plan.allRouteStations??plan.stations;
    this.network=new RailNetwork(plan);this.blockSystem=new RailBlockSystem(this.network);this.interlocking=new RailInterlocking(this.network,this.blockSystem);this.stationOperations=new StationOperations(this.network);this.services=createDefaultTrainServices(plan,12);this.dispatcher=null;this.signalRenderer=null;this.dispatcherAccumulator=Infinity;this.lastDispatcherUpdateMsThisFrame=0;this.informationAccumulator=Infinity;this.simulationSeconds=0;this.railDebugEnabled=false;
    this.obstacles=obstacles??[];this.roadCorridors=this.buildRoadCorridors();this.railClearanceSamples=this.routes.flatMap(route=>Array.from({length:Math.max(700,Math.ceil(route.length/2.2))},(_,index)=>route.curve.getPointAt(index/Math.max(700,Math.ceil(route.length/2.2)))));this.trackClearanceSegments=this.buildTrackClearanceSegments();this.supportLocations=[];this.supportClearanceViolations=[];this.abutmentLocations=[];this.abutmentClearanceViolations=[];
    // Authoritative pedestrian-height surfaces. Station platforms and stairs
    // are no longer decorative only: PlayerController queries these surfaces
    // to raise/lower the camera and to stop the player phasing through the side
    // of a staircase or walking off an elevated platform.
    this.walkSurfaces=[];this.walkBlockers=[];this.stationDiagnostics=[];this.stationPedestrians=[];this.nextStationPedestrianId=1;
    this.trackChunkGroups=new Map();this.gradeChunkGroups=new Map();this.stationLowGroups=[];this.railVisibilityAccumulator=Infinity;this.stationPedestrianAccumulator=0;this.trainLowTransform=new THREE.Object3D();this.lastRailFocusChunk=null;
    this.trains=[];this.crossings=[];this.gradeSeparations=plan.gradeSeparations??[];this.gradeSeparationGroups=[];this.playerTrain=null;this.playerTrainMode=null;this.passengerState=null;this.trainCameraIndex=0;this.cameraModes=["CAB","CHASE","SIDE","TOP-DOWN"];
    this.pendingPassengerLookDX=0;this.pendingPassengerLookDY=0;this.passengerPointerLookListenerInstalled=false;this.audioContext=null;this.trainAudio=null;this.collisionDebugVisible=false;this.stationCollisionDebug=null;
    this._scratchPosition=new THREE.Vector3();this._scratchTangent=new THREE.Vector3();this._scratchWorld=new THREE.Vector3();this._scratchLocal=new THREE.Vector3();this._walkQuerySurfaces=[];this._walkQueryBlockers=[];this.walkSpatialCellSize=32;this.walkSurfaceGrid=new Map();this.walkBlockerGrid=new Map();
    if(typeof addEventListener==="function")addEventListener("mousemove",event=>{
      if(this.playerTrainMode!=="passenger")return;
      if(typeof document!=="undefined"&&!document.pointerLockElement)return;
      this.pendingPassengerLookDX+=Number.isFinite(event.movementX)?event.movementX:0;this.pendingPassengerLookDY+=Number.isFinite(event.movementY)?event.movementY:0;
    });this.passengerPointerLookListenerInstalled=true;
    this.interactionPrompt=document.getElementById("interaction-prompt");this.lastBoardingCandidate=null;
    this.nextTrainId=1;this.crossingClosures=0;this.activeCrossings=0;this.averageTrainSpeed=0;this.gradeSeparationCount=this.gradeSeparations.length;this.railGroup=new THREE.Group();scene.add(this.railGroup);
    this.materials={
      ballast:new THREE.MeshStandardMaterial({color:0x77756d,roughness:.98}),
      sleeper:new THREE.MeshStandardMaterial({color:0x4c3b2e,roughness:.96}),
      rail:new THREE.MeshStandardMaterial({color:0x858c90,roughness:.42,metalness:.72}),
      platform:new THREE.MeshStandardMaterial({color:0x96948c,roughness:.94}),
      platformEdge:new THREE.MeshStandardMaterial({color:0xe0d8a2,roughness:.85}),
      canopy:new THREE.MeshStandardMaterial({color:0x3e5967,roughness:.38,metalness:.38,transparent:true,opacity:.88}),
      stationWall:new THREE.MeshStandardMaterial({color:0x8b8379,roughness:.78}),
      stationInterior:new THREE.MeshStandardMaterial({color:0xb8b7ae,roughness:.88}),
      stationFloor:new THREE.MeshStandardMaterial({color:0x737873,roughness:.94}),
      bridgeDeck:new THREE.MeshStandardMaterial({color:0x666b6d,roughness:.86,metalness:.08}),
      bridgeGirder:new THREE.MeshStandardMaterial({color:0x39464d,roughness:.58,metalness:.34}),
      concrete:new THREE.MeshStandardMaterial({color:0x8a8c87,roughness:.95}),
      earth:new THREE.MeshStandardMaterial({color:0x4f5a43,roughness:1}),
      tarmac:new THREE.MeshStandardMaterial({color:0x303538,roughness:.94}),
      marking:new THREE.MeshBasicMaterial({color:0xf1eee2}),
      glass:new THREE.MeshStandardMaterial({color:0x7094a3,transparent:true,opacity:.42,roughness:.18}),
      busStop:new THREE.MeshStandardMaterial({color:0x397db8,emissive:0x102b42,emissiveIntensity:.45}),
      post:new THREE.MeshStandardMaterial({color:0x34383a,roughness:.75}),
      railLow:new THREE.LineBasicMaterial({color:0x65747b,transparent:true,opacity:.42,depthWrite:false,fog:true}),
      stationLow:new THREE.MeshStandardMaterial({color:0x777d7d,roughness:.96,metalness:.02}),
      trainLow:new THREE.MeshStandardMaterial({color:0x315773,roughness:.72,metalness:.08})
    };
    this.buildTrack();this.buildGradeSeparations();this.buildStations();this.buildWalkSpatialIndex();this.linkSharedStations();this.spawnStationPedestrians();this.spawnFleet(this.services);this.blockSystem.updateOccupancy(this.trains);this.dispatcher=new RailDispatcher({network:this.network,blockSystem:this.blockSystem,interlocking:this.interlocking,stationOperations:this.stationOperations,trains:this.trains});this.dispatcher.update(.125,0);this.signalRenderer=new RailSignalRenderer(scene,this.network,{interlocking:this.interlocking,stationOperations:this.stationOperations});
  }

  enableAudio(){
    if(this.audioContext||typeof window==="undefined")return;
    const Context=window.AudioContext||window.webkitAudioContext;if(!Context)return;
    try{
      const context=new Context(),master=context.createGain();master.gain.value=0;master.connect(context.destination);
      const rolling=context.createOscillator(),rollingFilter=context.createBiquadFilter(),rollingGain=context.createGain();rolling.type="triangle";rolling.frequency.value=42;rollingFilter.type="lowpass";rollingFilter.frequency.value=320;rollingGain.gain.value=0;rolling.connect(rollingFilter).connect(rollingGain).connect(master);rolling.start();
      const track=context.createOscillator(),trackFilter=context.createBiquadFilter(),trackGain=context.createGain();track.type="sawtooth";track.frequency.value=92;trackFilter.type="bandpass";trackFilter.frequency.value=640;trackFilter.Q.value=.7;trackGain.gain.value=0;track.connect(trackFilter).connect(trackGain).connect(master);track.start();
      const buffer=context.createBuffer(1,Math.max(1,Math.floor(context.sampleRate*1.5)),context.sampleRate),data=buffer.getChannelData(0);for(let index=0;index<data.length;index++)data[index]=Math.random()*2-1;
      const ventilation=context.createBufferSource(),ventFilter=context.createBiquadFilter(),ventGain=context.createGain();ventilation.buffer=buffer;ventilation.loop=true;ventFilter.type="lowpass";ventFilter.frequency.value=480;ventGain.gain.value=0;ventilation.connect(ventFilter).connect(ventGain).connect(master);ventilation.start();
      const warning=context.createOscillator(),warningGain=context.createGain();warning.type="square";warning.frequency.value=880;warningGain.gain.value=0;warning.connect(warningGain).connect(master);warning.start();
      const hornLow=context.createOscillator(),hornHigh=context.createOscillator(),hornGain=context.createGain();hornLow.type="sine";hornHigh.type="sine";hornLow.frequency.value=370;hornHigh.frequency.value=466;hornGain.gain.value=0;hornLow.connect(hornGain);hornHigh.connect(hornGain);hornGain.connect(master);hornLow.start();hornHigh.start();
      this.audioContext=context;this.trainAudio={master,rolling,rollingGain,track,trackGain,ventGain,warningGain,hornGain};
    }catch{this.audioContext=null;this.trainAudio=null;}
  }

  updateTrainAudio(time){
    if(!this.audioContext||!this.trainAudio)return;
    const audio=this.trainAudio,train=this.playerTrain,now=this.audioContext.currentTime,occupied=Boolean(train),speed=train?.speed??0;
    audio.master.gain.setTargetAtTime(occupied ? .20 : 0,now,.12);
    audio.rolling.frequency.setTargetAtTime(38+speed*4.1,now,.08);audio.rollingGain.gain.setTargetAtTime(occupied?THREE.MathUtils.clamp(speed/30,0,1)*.16:0,now,.10);
    audio.track.frequency.setTargetAtTime(72+speed*8.5,now,.06);audio.trackGain.gain.setTargetAtTime(occupied?(.015+THREE.MathUtils.clamp(speed/34,0,1)*.055):0,now,.10);
    audio.ventGain.gain.setTargetAtTime(occupied ? .035 : 0,now,.20);
    const doorMoving=occupied&&train.currentStation&&train.speed<.2&&train.doorAmount>.03&&train.doorAmount<.96,beep=doorMoving&&Math.sin(time*18)>0;
    audio.warningGain.gain.setTargetAtTime(beep ? .045 : 0,now,.015);audio.hornGain.gain.setTargetAtTime(occupied&&train.hornTimer>0 ? .035 : 0,now,.025);
  }

  routeForStation(station){return this.routeById.get(station?.routeId??"city")??this.plan.mainRoute??this.plan;}
  routeForTrain(train){return train?.route??this.routeById.get(train?.routeId??"city")??this.plan.mainRoute??this.plan;}

  linkSharedStations(){
    for(const station of this.allRouteStations){
      if(!station.sharedPhysicalStationId)continue;const physical=this.plan.stations.find(candidate=>candidate.id===station.sharedPhysicalStationId);if(!physical)continue;
      for(const key of["entryPosition","exitPosition","interiorPosition","stationBuilding","crossPlatformRoute","lowGroup","renderTier"])if(physical[key]!==undefined)station[key]=physical[key];
      station.physicalStation=physical;
    }
  }

  buildRoadCorridors(){
    const segments=[];
    for(const road of this.graph.roads.values()){
      const points=road.centerCurve.getPoints(Math.max(30,Math.ceil(road.length/5)));
      for(let i=0;i<points.length-1;i++)segments.push({a:points[i],b:points[i+1],radius:road.width*.5+1.8,roadId:road.id});
    }
    return segments;
  }

  buildTrackClearanceSegments(sampleCount=2400){
    const segments=[];
    for(const route of this.routes)for(const side of[-1,1]){
      const count=Math.max(900,Math.round(sampleCount*route.length/(this.plan.length||route.length)));let previous=null;
      for(let index=0;index<=count;index++){
        const t=(index%count)/count,centre=route.curve.getPointAt(t),tangent=route.curve.getTangentAt(t).setY(0).normalize(),normal=new THREE.Vector3(-tangent.z,0,tangent.x);
        const point=centre.clone().addScaledVector(normal,side*route.trackOffset);point.y=0;
        if(previous)segments.push({a:previous,b:point.clone(),side,routeId:route.id});previous=point;
      }
    }
    return segments;
  }

  supportPointClear(position,{ignoreStations=false,route=null}={}){
    for(const road of this.roadCorridors)if(pointSegmentDistanceXZ(position,road.a,road.b)<road.radius+1.05)return false;
    for(const obstacle of this.obstacles)if(pointInsideColliderXZ(position,obstacle,1.1))return false;
    const railT=position.userData?.railT,activeRoute=route??this.routeById.get(position.userData?.routeId);
    if(!ignoreStations&&Number.isFinite(railT)&&activeRoute)for(const station of activeRoute.stations)if(circularArcDistance(railT,station.t,activeRoute.length)<station.platformLength*.5+8)return false;
    return true;
  }

  crossingHalfSpan(separation){
    const railTangent=separation.railTangent.clone().setY(0).normalize(),roadTangent=separation.roadTangent.clone().setY(0).normalize();
    const cross=Math.abs(railTangent.x*roadTangent.z-railTangent.z*roadTangent.x),parallel=Math.abs(railTangent.dot(roadTangent));
    const deckHalf=(this.plan.trackOffset*2+this.plan.ballastWidth+2.25)*.5;
    return (separation.roadWidth*.5+2.6+deckHalf*parallel)/Math.max(.32,cross);
  }

  supportPairAt(t,route=this.plan.mainRoute??this.plan){
    const centre=route.curve.getPointAt(wrappedProgress(t)),tangent=route.curve.getTangentAt(wrappedProgress(t)).setY(0).normalize(),normal=new THREE.Vector3(-tangent.z,0,tangent.x);
    centre.userData={railT:wrappedProgress(t),routeId:route.id};
    const positions=[-1,1].map(side=>{const p=centre.clone().addScaledVector(normal,side*2.45);p.userData={railT:wrappedProgress(t),routeId:route.id};return p;});
    for(const separation of route.gradeSeparations??[])if(circularArcDistance(t,separation.t,route.length)<Math.max(this.crossingHalfSpan(separation),separation.plateauHalf??0)+7)return null;
    if(route.stations.some(station=>circularArcDistance(t,station.t,route.length)<station.platformLength*.5+10))return null;
    if(!positions.every(position=>this.supportPointClear(position,{route})))return null;
    return{t:wrappedProgress(t),centre,tangent,normal,positions,routeId:route.id};
  }

  findSupportPair(t,route=this.plan.mainRoute??this.plan){
    for(const shift of[0,-5,5,-10,10,-15,15,-20,20]){
      const candidate=this.supportPairAt(t+shift/route.length,route);if(!candidate)continue;
      if(this.supportLocations.some(existing=>existing.centre.distanceTo(candidate.centre)<19))continue;
      return candidate;
    }
    return null;
  }

  buildTrack(){
    const buckets=new Map(),chunkSize=this.chunkManager?.chunkSize;
    const bucketFor=position=>{const key=chunkKeyForPosition(position,chunkSize);if(!buckets.has(key))buckets.set(key,{ballast:[],rails:[],sleepers:[],low:[]});return buckets.get(key);};
    for(const route of this.routes){
      const segments=Math.max(220,Math.ceil(route.length/4.2));
      for(const trackIndex of[0,1,2,3]){
        for(let i=0;i<segments;i++){
          const t0=i/segments,t1=(i+1)/segments,a=trackPosition(route,t0,trackIndex),b=trackPosition(route,t1,trackIndex),mid=a.clone().add(b).multiplyScalar(.5),bucket=bucketFor(mid);
          bucket.ballast.push(segmentMatrix(a,b,route.ballastWidth,.14,.07));
          const tangent=b.clone().sub(a).setY(0).normalize(),normal=new THREE.Vector3(-tangent.z,0,tangent.x);
          for(const side of[-1,1]){const ra=a.clone().addScaledVector(normal,side*route.gauge*.5),rb=b.clone().addScaledVector(normal,side*route.gauge*.5);bucket.rails.push(segmentMatrix(ra,rb,.105,.13,.205));}
          bucket.low.push(a.x,a.y+.18,a.z,b.x,b.y+.18,b.z);
        }
        const sleeperCount=Math.ceil(route.length/2.25);
        for(let i=0;i<sleeperCount;i++){
          const t=i/sleeperCount,p=trackPosition(route,t,trackIndex),tan=route.curve.getTangentAt(t).setY(0).normalize(),n=new THREE.Vector3(-tan.z,0,tan.x),bucket=bucketFor(p);
          bucket.sleepers.push(segmentMatrix(p.clone().addScaledVector(n,-1.45),p.clone().addScaledVector(n,1.45),.19,.12,.06));
        }
      }
    }
    const unitBox=new THREE.BoxGeometry(1,1,1);
    for(const[key,bucket]of buckets){
      const detail=new THREE.Group();detail.name=`rail-detail-${key}`;
      instanceMesh(detail,unitBox,this.materials.ballast,bucket.ballast,{receiveShadow:true});instanceMesh(detail,unitBox,this.materials.sleeper,bucket.sleepers,{receiveShadow:true});instanceMesh(detail,unitBox,this.materials.rail,bucket.rails,{castShadow:false,receiveShadow:true});
      detail.visible=false;this.railGroup.add(detail);
      const geometry=new THREE.BufferGeometry();geometry.setAttribute("position",new THREE.Float32BufferAttribute(bucket.low,3));geometry.computeBoundingSphere();
      const low=new THREE.LineSegments(geometry,this.materials.railLow);low.name=`rail-low-${key}`;low.frustumCulled=true;low.matrixAutoUpdate=false;low.updateMatrix();low.visible=true;this.railGroup.add(low);
      const[cx,cz]=key.split(":").map(Number),centre=new THREE.Vector3((cx+.5)*(chunkSize??180),0,(cz+.5)*(chunkSize??180));this.trackChunkGroups.set(key,{key,detail,low,centre});
    }
    this.buildAirportJunctionPoints();
  }

  buildAirportJunctionPoints(){
    const airportRoute=this.routeById.get("airport"),junction=airportRoute?.stations.find(station=>station.sharedPhysicalStationId);if(!airportRoute||!junction)return;
    const cityRoute=this.routeById.get("city")??this.plan.mainRoute,cityStation=cityRoute?.stations.find(station=>station.id===junction.sharedPhysicalStationId);if(!cityStation)return;
    const centre=cityStation.position.clone(),forward=cityRoute.curve.getTangentAt(cityStation.t).setY(0).normalize(),right=new THREE.Vector3(forward.z,0,-forward.x),group=new THREE.Group();group.name="airport-loop-junction-points";
    for(const trackIndex of[0,1,2,3]){
      const base=centre.clone().addScaledVector(right,trackOffsetFor(cityRoute,trackIndex));
      for(const switchSide of[-1,1]){
        const a=base.clone().addScaledVector(forward,-22),b=base.clone().addScaledVector(forward,22).addScaledVector(right,switchSide*.38);
        const sleeper=new THREE.Mesh(new THREE.BoxGeometry(1,1,1),this.materials.sleeper);sleeper.applyMatrix4(segmentMatrix(a,b,2.9,.10,.04));sleeper.name="airport-junction-switch-timbers";group.add(sleeper);
        const blade=new THREE.Mesh(new THREE.BoxGeometry(1,1,1),this.materials.rail);blade.applyMatrix4(segmentMatrix(a,b,.09,.11,.20));blade.name="airport-junction-point-blade";group.add(blade);
      }
    }
    const sign=new THREE.Mesh(new THREE.BoxGeometry(2.8,1.1,.16),this.materials.busStop);sign.position.copy(centre).addScaledVector(right,10);sign.position.y=centre.y+2.2;sign.rotation.y=Math.atan2(forward.x,forward.z);sign.name="airport-line-junction-sign";group.add(sign);this.railGroup.add(group);
  }

  buildGradeSeparations(){
    const buckets=new Map(),chunkSize=this.chunkManager?.chunkSize;
    const bucketFor=position=>{const key=chunkKeyForPosition(position,chunkSize);if(!buckets.has(key))buckets.set(key,{deck:[],girders:[],barriers:[],piers:[],pierCaps:[],embankments:[],retaining:[]});return buckets.get(key);};
    for(const route of this.routes){
      const segments=Math.max(260,Math.ceil(route.length/4.8)),deckWidth=route.trackOffset*2+route.ballastWidth+1.35,deckDepth=route.gradePolicy.deckDepth,viaductThreshold=route.gradePolicy.minimumRoadClearance+deckDepth+.08;let pierDistance=0;
      for(let i=0;i<segments;i++){
        const t0=i/segments,t1=(i+1)/segments,tm=(i+.5)/segments,a=route.curve.getPointAt(t0),b=route.curve.getPointAt(t1),mid=a.clone().add(b).multiplyScalar(.5),bucket=bucketFor(mid);
        if(mid.y<.38)continue;
        const tangent=b.clone().sub(a).setY(0).normalize(),normal=new THREE.Vector3(-tangent.z,0,tangent.x);
        if(mid.y<viaductThreshold){
          const height=Math.max(.16,mid.y-.10),width=deckWidth+Math.min(8,height*1.15);bucket.embankments.push(horizontalSegmentMatrix(a,b,width,height,-.08));
          for(const side of[-1,1]){const wa=a.clone().addScaledVector(normal,side*(width*.5-.25)),wb=b.clone().addScaledVector(normal,side*(width*.5-.25));bucket.retaining.push(segmentMatrix(wa,wb,.34,Math.min(2.1,height),-Math.min(2.1,height)*.5));}
          continue;
        }
        bucket.deck.push(segmentMatrix(a,b,deckWidth,deckDepth,-deckDepth*.55));
        for(const side of[-1,1]){
          const ga=a.clone().addScaledVector(normal,side*(deckWidth*.5-.22)),gb=b.clone().addScaledVector(normal,side*(deckWidth*.5-.22));bucket.girders.push(segmentMatrix(ga,gb,.28,.72,-deckDepth-.30));
          const ba=a.clone().addScaledVector(normal,side*(deckWidth*.5-.12)),bb=b.clone().addScaledVector(normal,side*(deckWidth*.5-.12));bucket.barriers.push(segmentMatrix(ba,bb,.16,.92,.40));
        }
        pierDistance+=a.distanceTo(b);
        if(pierDistance>30){
          const support=this.findSupportPair(tm,route);pierDistance=support?0:18;
          if(support){
            const supportBucket=bucketFor(support.centre),pierHeight=Math.max(.5,support.centre.y-deckDepth-.16);
            for(const position of support.positions)supportBucket.piers.push(uprightMatrix(position,.78,pierHeight,.78,.02));
            const capA=support.positions[0].clone();capA.y=pierHeight-.02;const capB=support.positions[1].clone();capB.y=pierHeight-.02;supportBucket.pierCaps.push(segmentMatrix(capA,capB,.62,.42,.04));this.supportLocations.push(support);
          }
        }
      }
    }
    const unitBox=new THREE.BoxGeometry(1,1,1);
    for(const[key,bucket]of buckets){
      const group=new THREE.Group();group.name=`grade-separated-rail-${key}`;instanceMesh(group,unitBox,this.materials.earth,bucket.embankments,{castShadow:true,receiveShadow:true});instanceMesh(group,unitBox,this.materials.concrete,bucket.retaining,{castShadow:true,receiveShadow:true});instanceMesh(group,unitBox,this.materials.bridgeDeck,bucket.deck,{castShadow:true,receiveShadow:true});instanceMesh(group,unitBox,this.materials.bridgeGirder,bucket.girders,{castShadow:true,receiveShadow:true});instanceMesh(group,unitBox,this.materials.bridgeGirder,bucket.barriers,{castShadow:false,receiveShadow:true});instanceMesh(group,unitBox,this.materials.concrete,bucket.piers,{castShadow:true,receiveShadow:true});instanceMesh(group,unitBox,this.materials.concrete,bucket.pierCaps,{castShadow:true,receiveShadow:true});group.visible=false;this.railGroup.add(group);this.gradeSeparationGroups.push(group);
      const[cx,cz]=key.split(":").map(Number),centre=new THREE.Vector3((cx+.5)*(chunkSize??180),0,(cz+.5)*(chunkSize??180));this.gradeChunkGroups.set(key,{key,detail:group,centre});
    }
    this.supportClearanceViolations=this.supportLocations.filter(support=>support.positions.some(position=>!this.supportPointClear(position,{route:this.routeById.get(support.routeId)})));
  }

  registerWalkSurface(surface){this.walkSurfaces.push(surface);return surface;}
  registerWalkBlocker(blocker){this.walkBlockers.push(blocker);return blocker;}

  buildStationCollisionDebug(){
    const blockerPositions=[],stairPositions=[];
    for(const blocker of this.walkBlockers){
      const y0=blocker.minimumHeight??0,y1=Number.isFinite(blocker.maximumHeight)?blocker.maximumHeight:y0+4;
      const corners=[];
      for(const along of[-1,1])for(const across of[-1,1])corners.push({x:blocker.centre.x+blocker.forward.x*blocker.halfLength*along+blocker.right.x*blocker.halfWidth*across,z:blocker.centre.z+blocker.forward.z*blocker.halfLength*along+blocker.right.z*blocker.halfWidth*across});
      const order=[0,2,3,1];
      for(let index=0;index<4;index++){const a=corners[order[index]],b=corners[order[(index+1)%4]];blockerPositions.push(a.x,y0,a.z,b.x,y0,b.z,a.x,y1,a.z,b.x,y1,b.z,a.x,y0,a.z,a.x,y1,a.z);}
    }
    // Stair rejection is produced by a walk surface, not a walkBlocker. Draw
    // the actual thin inclined stair structure rather than a misleading prism
    // dropped all the way to the floor. This is also the volume used by the
    // walking resolver when deciding whether the player's body intersects the
    // stairs or can pass underneath with sufficient headroom.
    for(const surface of this.walkSurfaces){
      if(surface.type!=="stairs")continue;
      const halfWidth=surface.halfWidth,depth=surface.structureDepth??STAIR_STRUCTURE_DEPTH;
      const top=[
        surface.from.clone().addScaledVector(surface.right,-halfWidth),
        surface.from.clone().addScaledVector(surface.right,halfWidth),
        surface.to.clone().addScaledVector(surface.right,halfWidth),
        surface.to.clone().addScaledVector(surface.right,-halfWidth)
      ];
      const bottom=top.map(point=>point.clone().addScaledVector(UP,-depth));
      const add=(a,b)=>stairPositions.push(a.x,a.y+.035,a.z,b.x,b.y+.035,b.z);
      for(let index=0;index<4;index++){add(top[index],top[(index+1)%4]);add(bottom[index],bottom[(index+1)%4]);add(top[index],bottom[index]);}
    }
    const group=new THREE.Group();group.name="station-collision-debug";group.visible=false;group.renderOrder=46;
    if(blockerPositions.length){
      const geometry=new THREE.BufferGeometry();geometry.setAttribute("position",new THREE.Float32BufferAttribute(blockerPositions,3));
      const material=new THREE.LineBasicMaterial({color:0x63ff9c,transparent:true,opacity:.92,depthTest:false,depthWrite:false,toneMapped:false});
      const lines=new THREE.LineSegments(geometry,material);lines.name="station-solid-blockers";lines.frustumCulled=false;lines.renderOrder=46;group.add(lines);
    }
    if(stairPositions.length){
      const geometry=new THREE.BufferGeometry();geometry.setAttribute("position",new THREE.Float32BufferAttribute(stairPositions,3));
      const material=new THREE.LineBasicMaterial({color:0xff9f43,transparent:true,opacity:.96,depthTest:false,depthWrite:false,toneMapped:false});
      const lines=new THREE.LineSegments(geometry,material);lines.name="station-stair-walk-boundaries";lines.frustumCulled=false;lines.renderOrder=47;group.add(lines);
    }
    this.stationCollisionDebug=group;this.railGroup.add(group);
  }

  setCollisionDebugVisible(visible){
    this.collisionDebugVisible=Boolean(visible);
    if(this.collisionDebugVisible&&!this.stationCollisionDebug)this.buildStationCollisionDebug();
    if(this.stationCollisionDebug)this.stationCollisionDebug.visible=this.collisionDebugVisible;
    for(const train of this.trains)for(const vehicle of train.formation.vehicles){
      if(this.collisionDebugVisible&&!vehicle.userData.collisionDebug&&vehicle.userData.collisionProfile){
        const color=vehicle.userData.type==="class43-power"?0xff5d5d:0xffb84d,debug=createCollisionProfileDebug(vehicle.userData.collisionProfile,color);vehicle.add(debug);vehicle.userData.collisionDebug=debug;
      }
      if(vehicle.userData.collisionDebug)vehicle.userData.collisionDebug.visible=this.collisionDebugVisible;
    }
  }

  nearestRailDistance(position){
    let nearest=Infinity;for(const sample of this.railClearanceSamples)nearest=Math.min(nearest,Math.hypot(position.x-sample.x,position.z-sample.z));return nearest;
  }

  orientedTrackClearance(centre,forward,right,halfLength,halfWidth){
    const corners=[
      centre.clone().addScaledVector(forward,-halfLength).addScaledVector(right,-halfWidth),
      centre.clone().addScaledVector(forward,-halfLength).addScaledVector(right,halfWidth),
      centre.clone().addScaledVector(forward,halfLength).addScaledVector(right,halfWidth),
      centre.clone().addScaledVector(forward,halfLength).addScaledVector(right,-halfWidth)
    ];
    for(const corner of corners)corner.y=0;
    const edges=corners.map((corner,index)=>({a:corner,b:corners[(index+1)%corners.length]}));
    let minimum=Infinity;
    for(const segment of this.trackClearanceSegments){
      if(pointInOrientedRectangleXZ(segment.a,centre,forward,right,halfLength,halfWidth)||pointInOrientedRectangleXZ(segment.b,centre,forward,right,halfLength,halfWidth))return 0;
      for(const edge of edges){
        const distance=segmentSegmentDistanceXZ(segment.a,segment.b,edge.a,edge.b);
        if(distance<minimum)minimum=distance;
        if(minimum<1e-5)return 0;
      }
    }
    return minimum;
  }

  orientedRailClearance(centre,forward,right,halfLength,halfWidth){return this.orientedTrackClearance(centre,forward,right,halfLength,halfWidth);}

  orientedRoadClearance(centre,forward,right,halfLength,halfWidth){
    const corners=[
      centre.clone().addScaledVector(forward,-halfLength).addScaledVector(right,-halfWidth),
      centre.clone().addScaledVector(forward,-halfLength).addScaledVector(right,halfWidth),
      centre.clone().addScaledVector(forward,halfLength).addScaledVector(right,halfWidth),
      centre.clone().addScaledVector(forward,halfLength).addScaledVector(right,-halfWidth)
    ];
    for(const corner of corners)corner.y=0;
    const edges=corners.map((corner,index)=>({a:corner,b:corners[(index+1)%corners.length]}));
    let minimum=Infinity;
    for(const road of this.roadCorridors){
      let centrelineDistance=Infinity;
      if(pointInOrientedRectangleXZ(road.a,centre,forward,right,halfLength,halfWidth)||pointInOrientedRectangleXZ(road.b,centre,forward,right,halfLength,halfWidth))centrelineDistance=0;
      else for(const edge of edges)centrelineDistance=Math.min(centrelineDistance,segmentSegmentDistanceXZ(road.a,road.b,edge.a,edge.b));
      minimum=Math.min(minimum,centrelineDistance-road.radius);
    }
    return minimum;
  }

  stationFootprintClear(centre,forward,right,halfLength,halfWidth,{minimumRailDistance=0,blockers=[]}={}){
    for(const along of[-1,-.5,0,.5,1])for(const across of[-1,-.5,0,.5,1]){
      const point=centre.clone().addScaledVector(forward,along*halfLength).addScaledVector(right,across*halfWidth);
      if(minimumRailDistance&&this.nearestRailDistance(point)<minimumRailDistance)return false;
      for(const road of this.roadCorridors)if(pointSegmentDistanceXZ(point,road.a,road.b)<road.radius+1.0)return false;
      for(const obstacle of this.obstacles)if(pointInsideColliderXZ(point,obstacle,.8))return false;
      for(const blocker of blockers){const relative=point.clone().sub(blocker.centre).setY(0);if(Math.abs(relative.dot(blocker.forward))<blocker.halfLength+.8&&Math.abs(relative.dot(blocker.right))<blocker.halfWidth+.8)return false;}
    }
    return true;
  }

  stationSample(station,along=0,lateral=0,vertical=0){
    const route=this.routeForStation(station),t=wrappedProgress(station.t+along/route.baseLength),centre=route.curve.getPointAt(t),forward=route.curve.getTangentAt(t).setY(0).normalize(),right=new THREE.Vector3(forward.z,0,-forward.x);
    const point=centre.clone().addScaledVector(right,lateral);point.y+=vertical;
    return{t,centre,forward,right,point};
  }

  stationSegmentMatrix(station,fromAlong,toAlong,lateral,width,height,verticalOffset){
    const from=this.stationSample(station,fromAlong,lateral,verticalOffset).point,to=this.stationSample(station,toAlong,lateral,verticalOffset).point;
    return segmentMatrix(from,to,width,height);
  }

  addStationStairs(group,from,to,width=2.2,steps=12,stationId=null,role="stairs"){
    const horizontal=to.clone().sub(from);horizontal.y=0;
    const length=Math.max(.01,horizontal.length()),forward=horizontal.clone().normalize(),right=new THREE.Vector3(forward.z,0,-forward.x),rise=to.y-from.y,run=length/steps;
    // The old walking footprint was widened twice: once here and again in
    // walkSurfaceSample(). A 2.7 m staircase therefore behaved like an
    // invisible 3.5 m-wide wall, with roughly 0.7 m of extra collision at
    // each end. Keep only a small numerical tolerance around the visible
    // tread envelope so collision matches what the player can actually see.
    const visualHalfLength=length*.5,visualHalfWidth=width*.5;
    this.registerWalkSurface({
      type:"stairs",stationId,role,from:from.clone(),to:to.clone(),forward,right,
      halfLength:visualHalfLength+STAIR_SURFACE_LENGTH_TOLERANCE,
      halfWidth:visualHalfWidth+STAIR_SURFACE_WIDTH_TOLERANCE,
      visualHalfLength,visualHalfWidth,steps,
      structureDepth:STAIR_STRUCTURE_DEPTH,
      headClearance:STAIR_HEAD_CLEARANCE
    });

    // A thin inclined structural slab and shallow horizontal treads replace the
    // old stack of full-height boxes. The old boxes formed enormous saw-tooth
    // concrete wedges when the staircase was long, which is one of the shapes
    // visible in the supplied deformed-station screenshots.
    const slabFrom=from.clone();slabFrom.y-=.17;const slabTo=to.clone();slabTo.y-=.17;
    const slab=new THREE.Mesh(new THREE.BoxGeometry(1,1,1),this.materials.concrete);slab.applyMatrix4(segmentMatrix(slabFrom,slabTo,width-.18,.24));slab.castShadow=true;slab.receiveShadow=true;slab.name=`${stationId}-${role}-slab`;group.add(slab);
    const treadMatrices=[];
    for(let i=0;i<steps;i++){
      const alpha=(i+.5)/steps,topAlpha=(i+1)/steps,p=from.clone().addScaledVector(horizontal,alpha),topY=from.y+rise*topAlpha,o=new THREE.Object3D();
      o.position.set(p.x,topY-.055,p.z);o.rotation.y=Math.atan2(horizontal.x,horizontal.z);o.scale.set(width,.11,run+.035);o.updateMatrix();treadMatrices.push(o.matrix.clone());
    }
    const treads=instanceMesh(group,new THREE.BoxGeometry(1,1,1),this.materials.concrete,treadMatrices,{castShadow:true,receiveShadow:true});if(treads)treads.name=`${stationId}-${role}-treads`;
    for(const side of[-1,1]){
      const railFrom=from.clone().addScaledVector(right,side*(width*.5+.08));railFrom.y+=1.02;
      const railTo=to.clone().addScaledVector(right,side*(width*.5+.08));railTo.y+=1.02;
      const rail=new THREE.Mesh(new THREE.BoxGeometry(1,1,1),this.materials.post);rail.applyMatrix4(segmentMatrix(railFrom,railTo,.09,.09));rail.castShadow=true;rail.name=`${stationId}-${role}-handrail`;group.add(rail);
      const stringerFrom=from.clone().addScaledVector(right,side*(width*.5-.08));stringerFrom.y-=.03;
      const stringerTo=to.clone().addScaledVector(right,side*(width*.5-.08));stringerTo.y-=.03;
      const stringer=new THREE.Mesh(new THREE.BoxGeometry(1,1,1),this.materials.bridgeGirder);stringer.applyMatrix4(segmentMatrix(stringerFrom,stringerTo,.12,.20));stringer.name=`${stationId}-${role}-stringer`;group.add(stringer);
    }
    return{length,rise,steps};
  }

  walkSpatialKey(x,z){return`${Math.floor(x/this.walkSpatialCellSize)}:${Math.floor(z/this.walkSpatialCellSize)}`;}

  addWalkSpatialEntry(grid,entry,centre,forward,right,halfLength,halfWidth){
    const extentX=Math.abs(forward.x)*halfLength+Math.abs(right.x)*halfWidth+.5,extentZ=Math.abs(forward.z)*halfLength+Math.abs(right.z)*halfWidth+.5,minX=Math.floor((centre.x-extentX)/this.walkSpatialCellSize),maxX=Math.floor((centre.x+extentX)/this.walkSpatialCellSize),minZ=Math.floor((centre.z-extentZ)/this.walkSpatialCellSize),maxZ=Math.floor((centre.z+extentZ)/this.walkSpatialCellSize);
    for(let x=minX;x<=maxX;x++)for(let z=minZ;z<=maxZ;z++){const key=`${x}:${z}`,bucket=grid.get(key);if(bucket)bucket.push(entry);else grid.set(key,[entry]);}
  }

  buildWalkSpatialIndex(){
    this.walkSurfaceGrid.clear();this.walkBlockerGrid.clear();
    for(const surface of this.walkSurfaces){
      const centre=surface.type==="stairs"?new THREE.Vector3((surface.from.x+surface.to.x)*.5,(surface.from.y+surface.to.y)*.5,(surface.from.z+surface.to.z)*.5):surface.centre;
      this.addWalkSpatialEntry(this.walkSurfaceGrid,surface,centre,surface.forward,surface.right,surface.halfLength,surface.halfWidth);
    }
    for(const blocker of this.walkBlockers)this.addWalkSpatialEntry(this.walkBlockerGrid,blocker,blocker.centre,blocker.forward,blocker.right,blocker.halfLength,blocker.halfWidth);
  }

  walkSurfaceSample(surface,position){
    if(surface.type==="stairs"){
      const midpointX=(surface.from.x+surface.to.x)*.5,midpointZ=(surface.from.z+surface.to.z)*.5,dx=position.x-midpointX,dz=position.z-midpointZ,along=dx*surface.forward.x+dz*surface.forward.z,across=dx*surface.right.x+dz*surface.right.z,actualHalfLength=Math.max(.01,Math.hypot(surface.to.x-surface.from.x,surface.to.z-surface.from.z)*.5);
      if(Math.abs(along)>surface.halfLength||Math.abs(across)>surface.halfWidth)return null;
      const alpha=THREE.MathUtils.clamp((along+actualHalfLength)/(actualHalfLength*2),0,1);return{surface,height:THREE.MathUtils.lerp(surface.from.y,surface.to.y,alpha),alpha};
    }
    const dx=position.x-surface.centre.x,dz=position.z-surface.centre.z,along=dx*surface.forward.x+dz*surface.forward.z,across=dx*surface.right.x+dz*surface.right.z;
    if(Math.abs(along)>surface.halfLength||Math.abs(across)>surface.halfWidth)return null;return{surface,height:surface.height,alpha:.5};
  }

  walkBlockerAt(position,currentFeetY,bodyHeight=1.72){
    const blockers=this.walkBlockerGrid.get(this.walkSpatialKey(position.x,position.z))??this.walkBlockers,bodyTop=currentFeetY+bodyHeight;
    for(const blocker of blockers){
      const minimumHeight=blocker.minimumHeight??0,maximumHeight=blocker.maximumHeight??Infinity;if(bodyTop<=minimumHeight+.01||currentFeetY>=maximumHeight-.01)continue;
      const dx=position.x-blocker.centre.x,dz=position.z-blocker.centre.z,along=dx*blocker.forward.x+dz*blocker.forward.z,across=dx*blocker.right.x+dz*blocker.right.z;if(Math.abs(along)<blocker.halfLength&&Math.abs(across)<blocker.halfWidth)return blocker;
    }
    return null;
  }

  pointInsideWalkBlocker(position,currentFeetY,bodyHeight=1.72){return Boolean(this.walkBlockerAt(position,currentFeetY,bodyHeight));}

  resolveWalkSurface(position,currentFeetY=0,{maxStepUp=.58,maxStepDown=.92,bodyHeight=1.72}={}){
    const blocker=this.walkBlockerAt(position,currentFeetY,bodyHeight);if(blocker)return{height:currentFeetY,blocked:true,surface:null,blocker,reason:"station-structure"};
    const surfaces=this.walkSurfaceGrid.get(this.walkSpatialKey(position.x,position.z))??this.walkSurfaces;let best=null,bestPriority=-1,bestHeight=-Infinity,bestDelta=Infinity,nearest=null,nearestDelta=Infinity,highStair=null,hasReachableStair=false;
    const bodyTop=currentFeetY+bodyHeight;
    for(const surface of surfaces){
      const hit=this.walkSurfaceSample(surface,position);if(!hit)continue;
      const delta=hit.height-currentFeetY,absoluteDelta=Math.abs(delta);
      if(surface.type==="stairs"&&delta>maxStepUp){
        const structureDepth=surface.structureDepth??STAIR_STRUCTURE_DEPTH,headClearance=surface.headClearance??STAIR_HEAD_CLEARANCE,undersideHeight=hit.height-structureDepth;
        // A staircase only blocks the lower surface when the player's vertical
        // body envelope actually intersects the inclined slab/treads. The old
        // resolver blocked the whole XZ projection, creating a large invisible
        // wall beneath elevated stairs even when several metres of headroom
        // were visibly available.
        if(bodyTop<=undersideHeight-headClearance)continue;
        if(absoluteDelta<nearestDelta){nearest=hit;nearestDelta=absoluteDelta;}
        if(!highStair||undersideHeight<(highStair.undersideHeight??Infinity))highStair={...hit,undersideHeight,bodyTop,structureDepth,headClearance};
        continue;
      }
      if(absoluteDelta<nearestDelta){nearest=hit;nearestDelta=absoluteDelta;}
      if(surface.type==="stairs"&&delta<=maxStepUp&&delta>=-maxStepDown)hasReachableStair=true;
      if(delta>maxStepUp||delta<-maxStepDown)continue;
      const priority=surface.type==="stairs"?4:(surface.role==="footbridge"||surface.role==="footbridge-stair-landing")?3:surface.role==="platform"?2:1;
      if(!best||priority>bestPriority||(priority===bestPriority&&(hit.height>bestHeight+1e-6||(Math.abs(hit.height-bestHeight)<=1e-6&&absoluteDelta<bestDelta)))){best=hit;bestPriority=priority;bestHeight=hit.height;bestDelta=absoluteDelta;}
    }
    if(highStair&&!hasReachableStair)return{height:currentFeetY,blocked:true,surface:highStair.surface,reason:"stair-underside",surfaceHeight:highStair.height,undersideHeight:highStair.undersideHeight,bodyTop:highStair.bodyTop,structureDepth:highStair.structureDepth,headClearance:highStair.headClearance};
    if(best)return{height:best.height,blocked:false,surface:best.surface};
    if(nearest)return{height:currentFeetY,blocked:true,surface:nearest.surface,reason:"unreachable-height"};
    if(currentFeetY>.8)return{height:currentFeetY,blocked:true,surface:null,reason:"platform-edge"};
    return{height:0,blocked:false,surface:null};
  }

  spawnStationPedestrians(){
    const colours=[0x496b82,0x744b4b,0x5f704a,0x8a7454,0x675b7c,0x566e79];
    for(const station of this.plan.stations){
      const route=station.crossPlatformRoute?.map(point=>point.clone());
      if(!route||route.length<5)continue;
      for(const direction of[1,-1]){
        const mesh=createStationPedestrianMesh(colours[(this.nextStationPedestrianId-1)%colours.length]);
        mesh.name=`${station.id}-walker-${this.nextStationPedestrianId}`;
        this.scene.add(mesh);
        const path=direction>0?route.map(point=>point.clone()):route.slice().reverse().map(point=>point.clone());
        const agent={
          id:`station-ped-${String(this.nextStationPedestrianId++).padStart(3,"0")}`,stationId:station.id,mesh,path,baseRoute:route.map(point=>point.clone()),direction,segment:0,progress:Math.random(),speed:.78+Math.random()*.32,pause:Math.random()*1.2
        };
        this.stationPedestrians.push(agent);
        this.placeStationPedestrian(agent,0);
      }
    }
  }

  stationPedestrianVisible(agent,focus){
    const station=this.plan.stations.find(item=>item.id===agent.stationId);
    return station?station.renderTier==="full"&&station.position.distanceTo(focus)<qualityManager.current.rail.stationPedestrianDistance:true;
  }

  placeStationPedestrian(agent,time=0){
    const from=agent.path[agent.segment],to=agent.path[(agent.segment+1)%agent.path.length];
    if(!from||!to)return;
    const point=from.clone().lerp(to,agent.progress),direction=to.clone().sub(from).setY(0);
    agent.mesh.position.set(point.x,point.y+.02+Math.abs(Math.sin(time*4.2+agent.segment))*.03,point.z);
    if(direction.lengthSq()>1e-6)agent.mesh.rotation.y=Math.atan2(direction.x,direction.z);
  }

  updateStationPedestrians(dt,time,player){
    if(!this.stationPedestrians.length)return;
    this.stationPedestrianAccumulator+=dt;if(this.stationPedestrianAccumulator<1/15)return;
    const step=this.stationPedestrianAccumulator;this.stationPedestrianAccumulator=0;
    const focus=this.playerTrain?.headPosition??(player.inVehicle?player.position:this.camera.position);
    for(const agent of this.stationPedestrians){
      agent.mesh.visible=this.stationPedestrianVisible(agent,focus);
      if(!agent.mesh.visible)continue;
      if(agent.pause>0){agent.pause=Math.max(0,agent.pause-step);this.placeStationPedestrian(agent,time);continue;}
      const from=agent.path[agent.segment],to=agent.path[(agent.segment+1)%agent.path.length],distance=Math.max(.001,from.distanceTo(to));
      agent.progress+=agent.speed*step/distance;
      while(agent.progress>=1){
        agent.progress-=1;agent.segment++;
        if(agent.segment>=agent.path.length-1){
          agent.direction*=-1;agent.path=agent.direction>0?agent.baseRoute.map(point=>point.clone()):agent.baseRoute.slice().reverse().map(point=>point.clone());agent.segment=0;agent.pause=.7+Math.random()*1.4;
        }
      }
      this.placeStationPedestrian(agent,time);
    }
  }

  decorateAirportStation(station,group,platformTop){
    if(!station.airport)return;
    const terminal=new THREE.Vector3(station.terminalX??700,.04,station.terminalZ??617.2),start=station.entryPosition.clone(),direction=terminal.clone().sub(start).setY(0),length=direction.length();
    if(length>2){
      direction.normalize();const right=new THREE.Vector3(direction.z,0,-direction.x),centre=start.clone().add(terminal).multiplyScalar(.5),rotation=Math.atan2(direction.x,direction.z),halfWidth=2.5;
      const walkway=new THREE.Mesh(new THREE.BoxGeometry(5.4,.14,length),this.materials.concrete);walkway.position.copy(centre);walkway.position.y=.05;walkway.rotation.y=rotation;walkway.receiveShadow=true;walkway.name=`${station.id}-terminal-walkway`;group.add(walkway);
      this.registerWalkSurface({type:"platform",role:"airport-terminal-walkway",stationId:station.id,centre:centre.clone(),forward:direction.clone(),right,halfLength:length*.5+.3,halfWidth,height:.12});

      // Enclose the link as a proper airport-station connector rather than a
      // bare slab under a roof. Network Rail-style layered lighting, glazing and
      // repeated wayfinding cues make the destination legible down the full axis.
      const glass=new THREE.MeshStandardMaterial({color:0x7694a1,roughness:.22,metalness:.12,transparent:true,opacity:.42}),plinthMat=new THREE.MeshStandardMaterial({color:0x596368,roughness:.78,metalness:.12}),lightMat=new THREE.MeshStandardMaterial({color:0xffefc7,roughness:.28,emissive:0xffdf92,emissiveIntensity:1.35}),wayfindingMat=new THREE.MeshStandardMaterial({color:0x153957,roughness:.55,metalness:.08,emissive:0x071522,emissiveIntensity:.45}),stripeMat=new THREE.MeshStandardMaterial({color:0x4c91b8,roughness:.86});
      const roof=new THREE.Mesh(new THREE.BoxGeometry(5.7,.18,length),this.materials.canopy);roof.position.copy(centre);roof.position.y=3.18;roof.rotation.y=rotation;roof.castShadow=true;roof.name=`${station.id}-terminal-link-roof`;group.add(roof);
      const guideStripe=new THREE.Mesh(new THREE.BoxGeometry(.34,.025,length-.8),stripeMat);guideStripe.position.copy(centre);guideStripe.position.y=.135;guideStripe.rotation.y=rotation;guideStripe.name=`${station.id}-terminal-link-guide-stripe`;group.add(guideStripe);
      for(const side of[-1,1]){
        const wallCentre=centre.clone().addScaledVector(right,side*2.63),plinth=new THREE.Mesh(new THREE.BoxGeometry(.18,.62,length),plinthMat),wall=new THREE.Mesh(new THREE.BoxGeometry(.12,2.40,length),glass),rail=new THREE.Mesh(new THREE.BoxGeometry(.10,.10,length),this.materials.post);
        plinth.position.copy(wallCentre);plinth.position.y=.35;plinth.rotation.y=rotation;plinth.name=`${station.id}-terminal-link-plinth`;group.add(plinth);
        wall.position.copy(wallCentre);wall.position.y=1.72;wall.rotation.y=rotation;wall.name=`${station.id}-terminal-link-glazing`;group.add(wall);
        rail.position.copy(wallCentre).addScaledVector(right,-side*.08);rail.position.y=1.08;rail.rotation.y=rotation;rail.name=`${station.id}-terminal-link-handrail`;group.add(rail);
        this.registerWalkBlocker({name:`${station.id}-terminal-link-wall`,stationId:station.id,centre:wallCentre.clone(),forward:direction.clone(),right: right.clone(),halfLength:length*.5-.05,halfWidth:.10,minimumHeight:0,maximumHeight:3.12});
      }
      for(let d=2.5;d<length-2;d+=6){
        for(const side of[-1,1]){const p=start.clone().addScaledVector(direction,d).addScaledVector(right,side*2.63),post=new THREE.Mesh(new THREE.BoxGeometry(.16,3.0,.16),this.materials.post);post.position.set(p.x,1.57,p.z);post.name=`${station.id}-terminal-link-frame`;group.add(post);}
        const seamCentre=start.clone().addScaledVector(direction,d),seam=new THREE.Mesh(new THREE.BoxGeometry(5.05,.02,.055),plinthMat);seam.position.set(seamCentre.x,.14,seamCentre.z);seam.rotation.y=rotation;seam.name=`${station.id}-terminal-link-floor-joint`;group.add(seam);
      }
      for(let d=4;d<length-3;d+=7.5){const p=start.clone().addScaledVector(direction,d),luminaire=new THREE.Mesh(new THREE.BoxGeometry(1.9,.05,.42),lightMat);luminaire.position.set(p.x,3.03,p.z);luminaire.rotation.y=rotation;luminaire.name=`${station.id}-terminal-link-light`;group.add(luminaire);}
      for(let d=24;d<length-10;d+=38){
        const p=start.clone().addScaledVector(direction,d),board=new THREE.Mesh(new THREE.BoxGeometry(3.7,.82,.12),wayfindingMat);board.position.set(p.x,2.48,p.z);board.rotation.y=rotation;board.userData.displayText="TERMINAL  →";board.name=`${station.id}-terminal-link-wayfinding`;group.add(board);
        if(typeof document!=="undefined"&&typeof document.createElement==="function"){
          const canvas=document.createElement("canvas"),context=canvas.getContext?.("2d");if(context){canvas.width=512;canvas.height=128;context.fillStyle="#153957";context.fillRect(0,0,512,128);context.fillStyle="#ffffff";context.font="bold 44px sans-serif";context.fillText("TERMINAL  →",34,79);const texture=new THREE.CanvasTexture(canvas);texture.colorSpace=THREE.SRGBColorSpace;board.material=new THREE.MeshBasicMaterial({map:texture});}
        }
      }
      for(const endpoint of[start,terminal]){
        for(const side of[-1,1]){const jamb=new THREE.Mesh(new THREE.BoxGeometry(.22,3.05,.28),plinthMat),p=endpoint.clone().addScaledVector(right,side*2.68);jamb.position.set(p.x,1.55,p.z);jamb.rotation.y=rotation;jamb.name=`${station.id}-terminal-link-portal-jamb`;group.add(jamb);}
        const header=new THREE.Mesh(new THREE.BoxGeometry(5.55,.22,.28),plinthMat);header.position.set(endpoint.x,3.02,endpoint.z);header.rotation.y=rotation;header.name=`${station.id}-terminal-link-portal`;group.add(header);
      }
      station.terminalEntrancePosition=terminal.clone();station.terminalLinkLength=length;
    }
    const platformOffset=this.routeForStation(station).trackOffset+(this.plan.stationAccessPolicy.platformInnerClearance??2.15)+(this.plan.stationAccessPolicy.platformWidth??4.6)*.5;
    for(const side of[-1,1]){
      const sample=this.stationSample(station,-station.platformLength*.18,side*(platformOffset+.4),platformTop+2.35),board=new THREE.Mesh(new THREE.BoxGeometry(3.8,1.25,.16),this.materials.busStop);board.position.copy(sample.point);board.rotation.y=Math.atan2(sample.forward.x,sample.forward.z);board.userData.displayText="CITY LOOP  •  AIRPORT  •  NEXT TRAIN";board.name=`${station.id}-departure-display`;group.add(board);
      const barrierStart=this.stationSample(station,-station.platformLength*.47,side*(platformOffset+2.0),platformTop+1.0).point,barrierEnd=this.stationSample(station,station.platformLength*.47,side*(platformOffset+2.0),platformTop+1.0).point,barrier=new THREE.Mesh(new THREE.BoxGeometry(1,1,1),this.materials.post);barrier.applyMatrix4(segmentMatrix(barrierStart,barrierEnd,.10,1.65));barrier.name=`${station.id}-platform-safety-fence`;group.add(barrier);
    }
  }

  addPlatformRouteMap(group,station,platformCentre,platformTop,platformNumber){
    const route=this.routeForStation(station),sample=this.stationSample(station,-station.platformLength*.08,platformCentre,platformTop+1.72),canvas=typeof document!=="undefined"&&typeof document.createElement==="function"?document.createElement("canvas"):null;
    let material=this.materials.busStop,context=null,texture=null;
    if(canvas?.getContext){canvas.width=1024;canvas.height=256;context=canvas.getContext("2d");if(context?.fillRect){context.fillStyle="#10253d";context.fillRect(0,0,1024,256);context.fillStyle="#ffffff";context.font="bold 42px sans-serif";context.fillText(`PLATFORM ${platformNumber}`,28,54);context.font="28px sans-serif";context.fillStyle="#b8c8d8";context.fillText("Awaiting dispatcher allocation",28,112);texture=new THREE.CanvasTexture(canvas);texture.colorSpace=THREE.SRGBColorSpace;material=new THREE.MeshBasicMaterial({map:texture,side:THREE.DoubleSide});}}
    const board=new THREE.Mesh(new THREE.PlaneGeometry(5.8,1.45),material);board.position.copy(sample.point);board.rotation.y=Math.atan2(sample.forward.x,sample.forward.z);board.userData={platformNumber,routeId:route.id,routeStops:[]};board.name=`${station.id}-platform-${platformNumber}-route-map`;group.add(board);
    this.stationOperations.registerDisplay({board,canvas,context,texture,routeId:route.id,stationId:station.id,physicalStationId:this.network.physicalStationId(station),platformNumber});
  }

  createStationLowGroup(station,platformOffset,platformWidth,platformTop){
    const group=new THREE.Group();group.name=`station-low-${station.id}`;group.visible=false;
    const heading=Math.atan2(station.tangent.x,station.tangent.z),length=station.platformLength;
    const addBox=(name,width,height,depth,position,rotation=heading)=>{
      const mesh=new THREE.Mesh(new THREE.BoxGeometry(width,height,depth),this.materials.stationLow);mesh.name=`${station.id}-${name}`;
      mesh.position.copy(position);mesh.rotation.y=rotation;mesh.castShadow=false;mesh.receiveShadow=false;mesh.updateMatrix();mesh.matrixAutoUpdate=false;group.add(mesh);return mesh;
    };
    const platformCentres=this.plan.platformCentres??[-14,-7,0,7,14];
    for(const [index,platformCentre] of platformCentres.entries()){
      const platformPosition=station.position.clone().addScaledVector(station.normal,platformCentre);platformPosition.y+=platformTop-.18;
      addBox(`low-platform-${index+1}`,platformWidth,.32,length,platformPosition);
      const canopyPosition=station.position.clone().addScaledVector(station.normal,platformCentre);canopyPosition.y+=platformTop+2.8;
      addBox(`low-canopy-${index+1}`,3.1,.16,Math.min(42,length*.4),canopyPosition);
    }
    const building=station.stationBuilding;
    if(building){
      const buildingPosition=building.centre.clone();buildingPosition.y=building.height*.5;
      addBox("low-building",building.halfWidth*2,building.height,building.halfDepth*2,buildingPosition,Math.atan2(building.forward.x,building.forward.z));
      if(station.airport&&station.terminalEntrancePosition&&station.entryPosition){
        const linkDirection=station.terminalEntrancePosition.clone().sub(station.entryPosition).setY(0),linkLength=linkDirection.length(),linkCentre=station.entryPosition.clone().add(station.terminalEntrancePosition).multiplyScalar(.5);linkCentre.y=1.75;
        addBox("low-terminal-link",5.0,3.4,linkLength,linkCentre,Math.atan2(linkDirection.x,linkDirection.z));
      }
      if(building.platformLinkStart&&building.platformLinkEnd){
        const linkCentre=building.platformLinkStart.clone().add(building.platformLinkEnd).multiplyScalar(.5);linkCentre.y=building.platformLinkStart.y-.08;
        const linkDirection=building.platformLinkEnd.clone().sub(building.platformLinkStart).setY(0),linkLength=linkDirection.length();
        addBox("low-platform-link",3.6,.16,linkLength+.18,linkCentre,Math.atan2(linkDirection.x,linkDirection.z));
      }
    }
    this.railGroup.add(group);this.stationLowGroups.push({station,group});return group;
  }

  buildStations(){
    this.stationGroups=[];this.stationDiagnostics=[];
    const platformWidth=this.plan.stationAccessPolicy.platformWidth??4.6,innerClearance=this.plan.stationAccessPolicy.platformInnerClearance??2.15;
    const platformCentres=this.plan.platformCentres??[-14,-7,0,7,14],platformOffset=Math.max(...platformCentres.map(value=>Math.abs(value))),platformThickness=.56,platformTop=.92,segmentTarget=4.25;
    for(const station of this.plan.stations){
      const group=new THREE.Group();group.name=`station-${station.id}`;
      const length=station.platformLength,segmentCount=Math.max(18,Math.ceil(length/segmentTarget)),platformMatrices=[],edgeMatrices=[],fenceMatrices=[],canopyMatrices=[],canopyPostMatrices=[],platformColumnMatrices=[];
      const canopyLength=Math.min(52,length*.46),canopyStart=-canopyLength*.5,canopyEnd=canopyLength*.5,canopySegmentCount=Math.max(8,Math.ceil(canopyLength/segmentTarget));
      for(const platformCentre of platformCentres){
        const side=platformCentre===0?1:Math.sign(platformCentre);
        for(let index=0;index<segmentCount;index++){
          const a=-length*.5+index/segmentCount*length,b=-length*.5+(index+1)/segmentCount*length;
          platformMatrices.push(this.stationSegmentMatrix(station,a,b,platformCentre,platformWidth,platformThickness,platformTop-platformThickness*.5));
          edgeMatrices.push(this.stationSegmentMatrix(station,a+.08,b-.08,platformCentre-side*(platformWidth*.5-.12),.24,.08,platformTop+.04));
          fenceMatrices.push(this.stationSegmentMatrix(station,a+.12,b-.12,platformCentre+side*(platformWidth*.5-.08),.10,1.05,platformTop+.525));
          const mid=(a+b)*.5,sample=this.stationSample(station,mid,platformCentre,platformTop);
          this.registerWalkSurface({type:"platform",role:"platform",stationId:station.id,platformCentre,centre:sample.point.clone(),forward:sample.forward.clone(),right:sample.right.clone(),halfLength:(b-a)*.54,halfWidth:platformWidth*.49,height:sample.point.y});
        }
        for(let index=0;index<canopySegmentCount;index++){
          const a=canopyStart+index/canopySegmentCount*canopyLength,b=canopyStart+(index+1)/canopySegmentCount*canopyLength;
          canopyMatrices.push(this.stationSegmentMatrix(station,a,b,platformCentre+side*(platformWidth*.12),3.35,.20,platformTop+2.93));
        }
        for(let along=canopyStart+2;along<=canopyEnd-2;along+=11.5){
          const sample=this.stationSample(station,along,platformCentre+side*(platformWidth*.28)),height=2.75;
          canopyPostMatrices.push(uprightMatrix(sample.point,.16,height,.16,sample.centre.y+platformTop));
        }
        if(station.elevated){
          for(let along=-length*.42;along<=length*.42;along+=15.5)for(const lateralAdjust of[-1.25,1.25]){
            const sample=this.stationSample(station,along,platformCentre+lateralAdjust),height=Math.max(.5,sample.centre.y+platformTop-platformThickness);
            if(!this.supportPointClear(sample.point,{ignoreStations:true}))continue;
            platformColumnMatrices.push(uprightMatrix(sample.point,.46,height,.46,.02));
          }
        }
      }
      const platforms=instanceMesh(group,new THREE.BoxGeometry(1,1,1),this.materials.platform,platformMatrices,{castShadow:false,receiveShadow:true});if(platforms)platforms.name=`${station.id}-curved-platforms`;
      const edges=instanceMesh(group,new THREE.BoxGeometry(1,1,1),this.materials.platformEdge,edgeMatrices,{receiveShadow:true});if(edges)edges.name=`${station.id}-platform-edges`;
      const fences=instanceMesh(group,new THREE.BoxGeometry(1,1,1),this.materials.post,fenceMatrices,{castShadow:true});if(fences)fences.name=`${station.id}-outer-fences`;
      const canopies=instanceMesh(group,new THREE.BoxGeometry(1,1,1),this.materials.canopy,canopyMatrices,{castShadow:true,receiveShadow:true});if(canopies)canopies.name=`${station.id}-segmented-canopies`;
      const canopyPosts=instanceMesh(group,new THREE.BoxGeometry(1,1,1),this.materials.post,canopyPostMatrices,{castShadow:true});if(canopyPosts)canopyPosts.name=`${station.id}-canopy-posts`;
      const platformColumns=instanceMesh(group,new THREE.BoxGeometry(1,1,1),this.materials.concrete,platformColumnMatrices,{castShadow:true,receiveShadow:true});if(platformColumns)platformColumns.name=`${station.id}-platform-columns`;

      // Furniture is deliberately small and repeated at bounded intervals. No
      // station component is allowed to inherit the full platform length as a
      // single straight box on a curved railway.
      for(const [platformIndex,platformCentre] of platformCentres.entries()){
        const side=platformCentre===0?1:Math.sign(platformCentre);
        for(const along of[-length*.22,length*.22]){
          const benchSample=this.stationSample(station,along,platformCentre+side*(platformWidth*.08),platformTop+.38),bench=new THREE.Mesh(new THREE.BoxGeometry(1.8,.18,.48),this.materials.stationWall);
          bench.position.copy(benchSample.point);bench.rotation.y=Math.atan2(benchSample.forward.x,benchSample.forward.z);bench.name=`${station.id}-platform-${platformIndex+1}-bench`;group.add(bench);
          const signSample=this.stationSample(station,along+3.2,platformCentre+side*(platformWidth*.32),platformTop+1.58),sign=new THREE.Mesh(new THREE.BoxGeometry(2.9,.72,.12),this.materials.busStop);
          sign.position.copy(signSample.point);sign.rotation.y=Math.atan2(signSample.forward.x,signSample.forward.z);sign.userData.stationName=station.name;sign.name=`${station.id}-platform-${platformIndex+1}-sign`;group.add(sign);
        }
        this.addPlatformRouteMap(group,station,platformCentre,platformTop,platformIndex+1);
      }

      const bridgeAlong=length*.10,bridgeFrame=this.stationSample(station,bridgeAlong),bridgeDeckY=bridgeFrame.centre.y+platformTop+4.85,bridgeOuter=platformOffset+platformWidth*.5-.15;
      const bridgeA=this.stationSample(station,bridgeAlong,-bridgeOuter).point,bridgeB=this.stationSample(station,bridgeAlong,bridgeOuter).point;bridgeA.y=bridgeDeckY;bridgeB.y=bridgeDeckY;
      const footbridgeWidth=3.45,bridgeHalfWidth=footbridgeWidth*.5-0.10;
      const footbridge=new THREE.Mesh(new THREE.BoxGeometry(1,1,1),this.materials.concrete);footbridge.applyMatrix4(segmentMatrix(bridgeA,bridgeB,footbridgeWidth,.34));footbridge.castShadow=true;footbridge.receiveShadow=true;footbridge.name=`${station.id}-footbridge`;group.add(footbridge);
      const bridgeAcross=bridgeB.clone().sub(bridgeA).setY(0).normalize(),bridgeCentre=bridgeA.clone().add(bridgeB).multiplyScalar(.5),bridgeWalkY=bridgeDeckY+.17;
      this.registerWalkSurface({type:"platform",role:"footbridge",stationId:station.id,centre:bridgeCentre.clone(),forward:bridgeAcross,right:bridgeFrame.forward.clone(),halfLength:bridgeA.distanceTo(bridgeB)*.5+.78,halfWidth:bridgeHalfWidth,height:bridgeWalkY});
      for(const railSide of[-1,1]){
        const shift=bridgeFrame.forward.clone().multiplyScalar(railSide*(bridgeHalfWidth-.18)),railA=bridgeA.clone().add(shift),railB=bridgeB.clone().add(shift);railA.y=bridgeDeckY+1.05;railB.y=bridgeDeckY+1.05;
        const rail=new THREE.Mesh(new THREE.BoxGeometry(1,1,1),this.materials.post);rail.applyMatrix4(segmentMatrix(railA,railB,.09,.09));rail.name=`${station.id}-footbridge-railing`;group.add(rail);
      }
      const bridgeStairRuns=[],platformStairLandings=[];
      for(const [platformIndex,platformCentre] of platformCentres.entries()){
        const side=platformCentre===0?1:Math.sign(platformCentre);
        const lowerSample=this.stationSample(station,bridgeAlong+11.7,platformCentre+side*(platformWidth*.16),platformTop),lower=lowerSample.point;
        const upper=this.stationSample(station,bridgeAlong,platformCentre).point;upper.y=bridgeWalkY;
        const lowerForward=lowerSample.forward,lowerRight=lowerSample.right;
        this.registerWalkSurface({type:"platform",role:"footbridge-stair-landing",stationId:station.id,centre:lower.clone(),forward:lowerForward.clone(),right:lowerRight.clone(),halfLength:1.6,halfWidth:1.45,height:lower.y});
        this.registerWalkSurface({type:"platform",role:"footbridge-stair-landing",stationId:station.id,centre:upper.clone(),forward:bridgeAcross.clone(),right:bridgeFrame.forward.clone(),halfLength:1.55,halfWidth:1.38,height:upper.y});
        const lowerLanding=new THREE.Mesh(new THREE.BoxGeometry(3.0,.12,2.9),this.materials.concrete);lowerLanding.position.copy(lower);lowerLanding.position.y=lower.y-.02;lowerLanding.rotation.y=Math.atan2(lowerForward.x,lowerForward.z);lowerLanding.receiveShadow=true;lowerLanding.name=`${station.id}-footbridge-platform-landing`;group.add(lowerLanding);
        const upperLanding=new THREE.Mesh(new THREE.BoxGeometry(2.9,.12,2.8),this.materials.concrete);upperLanding.position.copy(upper);upperLanding.position.y=upper.y-.02;upperLanding.rotation.y=Math.atan2(bridgeAcross.x,bridgeAcross.z);upperLanding.receiveShadow=true;upperLanding.name=`${station.id}-footbridge-bridge-landing`;group.add(upperLanding);
        bridgeStairRuns.push(this.addStationStairs(group,lower,upper,2.2,30,station.id,"platform-footbridge-stairs"));
        platformStairLandings.push({lower:lower.clone(),upper:upper.clone()});
      }
      const firstLanding=platformStairLandings[0],lastLanding=platformStairLandings.at(-1);
      station.crossPlatformRoute=firstLanding&&lastLanding?[firstLanding.lower.clone(),...platformStairLandings.map(item=>item.upper.clone()),lastLanding.lower.clone()]:[];
      station.platformStairRoutes=platformStairLandings.map(item=>[item.lower.clone(),item.upper.clone()]);

      // Build the station entrance as a proper dog-leg stair hall. The old
      // single 8 m straight flight dominated the room, looked more like an
      // industrial ramp, and made the upper doorway difficult to read. Two
      // shorter parallel flights now turn through a central landing, matching
      // normal station architecture while preserving the proven walk-surface
      // and collision system.
      const centreFrame=this.stationSample(station,0),roadPoint=station.roadAccess.position.clone(),roadSide=roadPoint.clone().sub(centreFrame.centre).setY(0).dot(centreFrame.right)>=0?1:-1;
      const wallThickness=.30,doorWidth=3.30,doorHeight=3.10,buildingWidth=10.8,buildingHalfW=buildingWidth*.5;
      const requiredTrackClearance=this.plan.stationAccessPolicy.minimumBuildingTrackClearance??9.5,requiredRoadClearance=.75,route=this.routeForStation(station);
      const preferredAccessAlong=-length*.28,minimumHallOffset=route.trackOffset+requiredTrackClearance+.85,alongLimit=length*.43;
      const alongCandidates=[];
      for(let delta=0;delta<=Math.min(80,length*.72);delta+=5)for(const sign of delta===0?[0]:[-1,1]){const value=THREE.MathUtils.clamp(preferredAccessAlong+delta*sign,-alongLimit,alongLimit);if(!alongCandidates.some(existing=>Math.abs(existing-value)<.1))alongCandidates.push(value);}
      let selectedLayout=null;
      for(const accessSide of[roadSide,-roadSide])for(const accessAlong of alongCandidates){
        const accessFrame=this.stationSample(station,accessAlong),outward=accessFrame.right.clone().multiplyScalar(accessSide).normalize();
        const buildingForward=outward.clone().multiplyScalar(-1),buildingRight=new THREE.Vector3(buildingForward.z,0,-buildingForward.x);
        const platformEntrance=this.stationSample(station,accessAlong,accessSide*(platformOffset+platformWidth*.22),platformTop).point;
        const rearWallPoint=this.stationSample(station,accessAlong,accessSide*minimumHallOffset,platformTop).point;
        const totalStairRise=Math.max(.1,platformEntrance.y-.04),halfStairRise=totalStairRise*.5,stairPitch=THREE.MathUtils.degToRad(30),flightRun=THREE.MathUtils.clamp(halfStairRise/Math.tan(stairPitch),6.5,8.5);
        const frontFoyerDepth=2.9,rearLandingDepth=2.65,buildingDepth=frontFoyerDepth+flightRun+rearLandingDepth,frontWallPoint=rearWallPoint.clone().addScaledVector(buildingForward,-buildingDepth);
        const buildingHalfD=buildingDepth*.5,buildingCentre=frontWallPoint.clone().add(rearWallPoint).multiplyScalar(.5),buildingHeight=Math.max(6.2,platformEntrance.y+3.55),buildingYaw=Math.atan2(buildingForward.x,buildingForward.z);
        const exactBuildingTrackClearance=this.orientedTrackClearance(buildingCentre,buildingForward,buildingRight,buildingHalfD,buildingHalfW),exactBuildingRoadClearance=this.orientedRoadClearance(buildingCentre,buildingForward,buildingRight,buildingHalfD,buildingHalfW);
        if(exactBuildingTrackClearance<requiredTrackClearance||exactBuildingRoadClearance<requiredRoadClearance)continue;
        if(!this.stationFootprintClear(buildingCentre,buildingForward,buildingRight,buildingHalfD,buildingHalfW))continue;
        const oppositeSidePenalty=accessSide===roadSide?0:50,score=Math.abs(accessAlong-preferredAccessAlong)+oppositeSidePenalty+Math.max(0,4-exactBuildingRoadClearance)*2;
        if(!selectedLayout||score<selectedLayout.score)selectedLayout={score,accessSide,accessAlong,accessFrame,outward,buildingForward,buildingRight,platformEntrance,rearWallPoint,totalStairRise,halfStairRise,stairPitch,flightRun,frontFoyerDepth,rearLandingDepth,buildingDepth,frontWallPoint,buildingHalfD,buildingCentre,buildingHeight,buildingYaw,exactBuildingTrackClearance,exactBuildingRoadClearance};
      }
      if(!selectedLayout)throw new Error(`${station.name} station hall has no road-safe and track-safe placement`);
      const {accessSide,accessAlong,accessFrame,outward,buildingForward,buildingRight,platformEntrance,rearWallPoint,totalStairRise,halfStairRise,stairPitch,flightRun,frontFoyerDepth,rearLandingDepth,buildingDepth,frontWallPoint,buildingHalfD,buildingCentre,buildingHeight,buildingYaw,exactBuildingTrackClearance,exactBuildingRoadClearance}=selectedLayout;
      const placeBuildingBox=(name,width,height,depth,material,offsetRight=0,offsetForward=0,baseY=0,{castShadow=true,receiveShadow=true}={})=>{
        if(width<=.01||height<=.01||depth<=.01)return null;
        const mesh=new THREE.Mesh(new THREE.BoxGeometry(width,height,depth),material),centre=buildingCentre.clone().addScaledVector(buildingRight,offsetRight).addScaledVector(buildingForward,offsetForward);
        mesh.position.set(centre.x,baseY+height*.5,centre.z);mesh.rotation.y=buildingYaw;mesh.castShadow=castShadow;mesh.receiveShadow=receiveShadow;mesh.name=`${station.id}-${name}`;group.add(mesh);return{mesh,centre};
      };
      const blockerInset=.012,registerBuildingBlocker=(name,offsetRight,offsetForward,halfWidth,halfLength,maximumHeight=buildingHeight,minimumHeight=0)=>this.registerWalkBlocker({name,stationId:station.id,centre:buildingCentre.clone().addScaledVector(buildingRight,offsetRight).addScaledVector(buildingForward,offsetForward),forward:buildingForward.clone(),right:buildingRight.clone(),halfLength:Math.max(.01,halfLength-blockerInset),halfWidth:Math.max(.01,halfWidth-blockerInset),minimumHeight,maximumHeight,visualHalfLength:halfLength,visualHalfWidth:halfWidth,visualMinimumHeight:minimumHeight,visualMaximumHeight:maximumHeight,boundaryType:`station-${name}`});
      const frontOffset=-buildingHalfD+wallThickness*.5,rearOffset=buildingHalfD-wallThickness*.5,sideOffset=buildingHalfW-wallThickness*.5,sidePieceWidth=(buildingWidth-doorWidth)*.5;

      placeBuildingBox("station-floor",buildingWidth-.22,.12,buildingDepth-.22,this.materials.stationFloor,0,0,.02,{castShadow:false,receiveShadow:true});
      placeBuildingBox("station-roof",buildingWidth+.20,.20,buildingDepth+.20,this.materials.bridgeGirder,0,0,buildingHeight-.18,{castShadow:true,receiveShadow:true});
      this.registerWalkSurface({type:"platform",role:"station-interior-floor",stationId:station.id,centre:buildingCentre.clone().setY(.04),forward:buildingForward.clone(),right:buildingRight.clone(),halfLength:buildingHalfD-.26,halfWidth:buildingHalfW-.26,height:.04});

      for(const side of[-1,1]){
        const offsetRight=side*(doorWidth+sidePieceWidth)*.5;
        placeBuildingBox(`station-front-${side<0?"left":"right"}-wall`,sidePieceWidth,buildingHeight,wallThickness,this.materials.stationWall,offsetRight,frontOffset,0);
        registerBuildingBlocker(`front-${side<0?"left":"right"}-wall`,offsetRight,frontOffset,sidePieceWidth*.5,wallThickness*.5);
      }
      placeBuildingBox("station-front-lintel",doorWidth,buildingHeight-doorHeight,wallThickness,this.materials.stationWall,0,frontOffset,doorHeight);
      registerBuildingBlocker("front-lintel",0,frontOffset,doorWidth*.5,wallThickness*.5,buildingHeight,doorHeight);

      for(const side of[-1,1]){
        const offsetRight=side*(doorWidth+sidePieceWidth)*.5;
        placeBuildingBox(`station-rear-${side<0?"left":"right"}-wall`,sidePieceWidth,buildingHeight,wallThickness,this.materials.stationWall,offsetRight,rearOffset,0);
        registerBuildingBlocker(`rear-${side<0?"left":"right"}-wall`,offsetRight,rearOffset,sidePieceWidth*.5,wallThickness*.5);
      }
      const rearDoorBottom=Math.max(.15,platformEntrance.y-1.35),rearDoorTop=Math.min(buildingHeight-.15,platformEntrance.y+doorHeight);
      placeBuildingBox("station-rear-glazed-lower-panel",doorWidth,rearDoorBottom,wallThickness,this.materials.glass,0,rearOffset,0,{castShadow:false,receiveShadow:true});
      registerBuildingBlocker("rear-lower-panel",0,rearOffset,doorWidth*.5,wallThickness*.5,rearDoorBottom,0);
      placeBuildingBox("station-rear-lintel",doorWidth,buildingHeight-rearDoorTop,wallThickness,this.materials.stationWall,0,rearOffset,rearDoorTop);
      registerBuildingBlocker("rear-lintel",0,rearOffset,doorWidth*.5,wallThickness*.5,buildingHeight,rearDoorTop);

      for(const side of[-1,1]){
        placeBuildingBox(`station-side-${side<0?"left":"right"}-wall`,wallThickness,buildingHeight,buildingDepth,this.materials.stationWall,side*sideOffset,0,0);
        registerBuildingBlocker(`side-${side<0?"left":"right"}-wall`,side*sideOffset,0,wallThickness*.5,buildingHalfD);
        // A light interior lining makes the hall read as an occupied public
        // space instead of a dark empty concrete box.
        placeBuildingBox(`station-side-${side<0?"left":"right"}-inner-panel`,.08,buildingHeight-1.0,buildingDepth-1.0,this.materials.stationInterior,side*(sideOffset-.20),0,.25,{castShadow:false,receiveShadow:true});
      }

      const frontDoorOutside=frontWallPoint.clone().addScaledVector(buildingForward,-1.30);frontDoorOutside.y=.04;
      const frontDoorInside=frontWallPoint.clone().addScaledVector(buildingForward,1.30);frontDoorInside.y=.04;
      const rearDoorInside=rearWallPoint.clone().addScaledVector(buildingForward,-1.30);rearDoorInside.y=platformEntrance.y;
      const rearDoorOutside=rearWallPoint.clone().addScaledVector(buildingForward,1.30);rearDoorOutside.y=platformEntrance.y;

      const flightOffset=2.35,stairWidth=2.70,midHeight=.04+halfStairRise,flightRearPoint=rearWallPoint.clone().addScaledVector(buildingForward,-rearLandingDepth),flightFrontPoint=flightRearPoint.clone().addScaledVector(buildingForward,-flightRun);
      const lowerFlightBottom=flightRearPoint.clone().addScaledVector(buildingRight,-flightOffset);lowerFlightBottom.y=.04;
      const lowerFlightTop=flightFrontPoint.clone().addScaledVector(buildingRight,-flightOffset);lowerFlightTop.y=midHeight;
      const upperFlightBottom=flightFrontPoint.clone().addScaledVector(buildingRight,flightOffset);upperFlightBottom.y=midHeight;
      const upperFlightTop=flightRearPoint.clone().addScaledVector(buildingRight,flightOffset);upperFlightTop.y=platformEntrance.y;
      const lowerSteps=Math.max(20,Math.ceil(halfStairRise/.175)),upperSteps=Math.max(20,Math.ceil(halfStairRise/.175));
      const lowerFlight=this.addStationStairs(group,lowerFlightBottom,lowerFlightTop,stairWidth,lowerSteps,station.id,"ground-platform-stairs-lower");
      const upperFlight=this.addStationStairs(group,upperFlightBottom,upperFlightTop,stairWidth,upperSteps,station.id,"ground-platform-stairs-upper");

      const midLandingCentre=lowerFlightTop.clone().add(upperFlightBottom).multiplyScalar(.5),midLandingWidth=lowerFlightTop.distanceTo(upperFlightBottom)+stairWidth,midLandingDepth=3.05;
      this.registerWalkSurface({type:"platform",role:"station-mid-landing",stationId:station.id,centre:midLandingCentre.clone(),forward:buildingRight.clone(),right:buildingForward.clone().multiplyScalar(-1),halfLength:midLandingWidth*.5-.08,halfWidth:midLandingDepth*.5-.08,height:midHeight});
      const midLanding=new THREE.Mesh(new THREE.BoxGeometry(midLandingWidth,.16,midLandingDepth),this.materials.concrete);midLanding.position.copy(midLandingCentre);midLanding.position.y=midHeight-.02;midLanding.rotation.y=buildingYaw;midLanding.receiveShadow=true;midLanding.name=`${station.id}-interior-mid-landing`;group.add(midLanding);

      const upperLandingCentre=upperFlightTop.clone().add(rearDoorInside).multiplyScalar(.5),upperLandingWidth=upperFlightTop.distanceTo(rearDoorInside)+stairWidth,upperLandingDepth=3.10;
      this.registerWalkSurface({type:"platform",role:"station-upper-concourse",stationId:station.id,centre:upperLandingCentre.clone(),forward:buildingRight.clone().multiplyScalar(-1),right:buildingForward.clone(),halfLength:upperLandingWidth*.5+.20,halfWidth:upperLandingDepth*.5-.08,height:platformEntrance.y});
      const upperLanding=new THREE.Mesh(new THREE.BoxGeometry(upperLandingWidth,.16,upperLandingDepth),this.materials.concrete);upperLanding.position.copy(upperLandingCentre);upperLanding.position.y=platformEntrance.y-.02;upperLanding.rotation.y=buildingYaw;upperLanding.receiveShadow=true;upperLanding.name=`${station.id}-interior-upper-landing`;group.add(upperLanding);

      const addGuardRail=(name,a,b,baseY)=>{
        const ra=a.clone();ra.y=baseY+1.05;const rb=b.clone();rb.y=baseY+1.05;
        const rail=new THREE.Mesh(new THREE.BoxGeometry(1,1,1),this.materials.post);rail.applyMatrix4(segmentMatrix(ra,rb,.09,.09));rail.name=`${station.id}-${name}`;group.add(rail);
      };
      const midFrontA=midLandingCentre.clone().addScaledVector(buildingRight,-midLandingWidth*.5+.15).addScaledVector(buildingForward,-midLandingDepth*.5+.15),midFrontB=midLandingCentre.clone().addScaledVector(buildingRight,midLandingWidth*.5-.15).addScaledVector(buildingForward,-midLandingDepth*.5+.15);
      addGuardRail("mid-landing-guard",midFrontA,midFrontB,midHeight);
      const upperEdgeA=upperLandingCentre.clone().addScaledVector(buildingRight,-upperLandingWidth*.5+.15).addScaledVector(buildingForward,-upperLandingDepth*.5+.15),upperEdgeB=upperLandingCentre.clone().addScaledVector(buildingRight,upperLandingWidth*.5-.15).addScaledVector(buildingForward,-upperLandingDepth*.5+.15);
      addGuardRail("upper-landing-guard",upperEdgeA,upperEdgeB,platformEntrance.y);

      const rearDoorThresholdDirection=rearDoorOutside.clone().sub(rearDoorInside).setY(0).normalize(),rearDoorThresholdRight=new THREE.Vector3(rearDoorThresholdDirection.z,0,-rearDoorThresholdDirection.x),rearDoorThresholdCentre=rearDoorInside.clone().add(rearDoorOutside).multiplyScalar(.5),rearDoorThresholdLength=rearDoorInside.distanceTo(rearDoorOutside);
      this.registerWalkSurface({type:"platform",role:"station-platform-door-threshold",stationId:station.id,centre:rearDoorThresholdCentre.clone(),forward:rearDoorThresholdDirection.clone(),right:rearDoorThresholdRight.clone(),halfLength:rearDoorThresholdLength*.5+.25,halfWidth:doorWidth*.5-.10,height:platformEntrance.y});
      const rearDoorThreshold=new THREE.Mesh(new THREE.BoxGeometry(doorWidth,.12,rearDoorThresholdLength+.35),this.materials.concrete);rearDoorThreshold.position.copy(rearDoorThresholdCentre);rearDoorThreshold.position.y=platformEntrance.y-.02;rearDoorThreshold.rotation.y=Math.atan2(rearDoorThresholdDirection.x,rearDoorThresholdDirection.z);rearDoorThreshold.receiveShadow=true;rearDoorThreshold.name=`${station.id}-platform-door-threshold`;group.add(rearDoorThreshold);
      const platformLinkStart=rearDoorOutside.clone(),platformLinkEnd=platformEntrance.clone(),platformLinkDirection=platformLinkEnd.clone().sub(platformLinkStart).setY(0).normalize(),platformLinkRight=new THREE.Vector3(platformLinkDirection.z,0,-platformLinkDirection.x),platformLinkCentre=platformLinkStart.clone().add(platformLinkEnd).multiplyScalar(.5),platformLinkLength=platformLinkStart.distanceTo(platformLinkEnd),platformLinkWidth=3.6;
      this.registerWalkSurface({type:"platform",role:"station-platform-link",stationId:station.id,centre:platformLinkCentre.clone(),forward:platformLinkDirection.clone(),right:platformLinkRight.clone(),halfLength:platformLinkLength*.5+.55,halfWidth:platformLinkWidth*.5-.10,height:platformEntrance.y});
      const platformLink=new THREE.Mesh(new THREE.BoxGeometry(1,1,1),this.materials.concrete);platformLink.applyMatrix4(segmentMatrix(platformLinkStart,platformLinkEnd,platformLinkWidth,.16));platformLink.name=`${station.id}-platform-access-link`;platformLink.receiveShadow=true;group.add(platformLink);
      for(const side of[-1,1]){
        const railStart=platformLinkStart.clone().addScaledVector(platformLinkRight,side*(platformLinkWidth*.5-.15)),railEnd=platformLinkEnd.clone().addScaledVector(platformLinkRight,side*(platformLinkWidth*.5-.15));railStart.y+=1.05;railEnd.y+=1.05;
        const linkRail=new THREE.Mesh(new THREE.BoxGeometry(1,1,1),this.materials.post);linkRail.applyMatrix4(segmentMatrix(railStart,railEnd,.09,.09));linkRail.name=`${station.id}-platform-access-railing`;group.add(linkRail);
      }

      const addDoorFrame=(name,centre,height)=>{
        for(const side of[-1,1])placeBuildingBox(`${name}-${side<0?"left":"right"}-jamb`,.16,height,.18,this.materials.busStop,side*(doorWidth*.5+.08),centre.clone().sub(buildingCentre).dot(buildingForward),centre.y,{castShadow:false,receiveShadow:true});
        placeBuildingBox(`${name}-header`,doorWidth+.32,.16,.18,this.materials.busStop,0,centre.clone().sub(buildingCentre).dot(buildingForward),centre.y+height-.16,{castShadow:false,receiveShadow:true});
      };
      addDoorFrame("street-door-frame",frontWallPoint.clone().setY(.04),doorHeight);
      addDoorFrame("platform-door-frame",rearWallPoint.clone().setY(platformEntrance.y),doorHeight);
      for(const along of[-buildingHalfD*.45,0,buildingHalfD*.45]){
        const lightPosition=buildingCentre.clone().addScaledVector(buildingForward,along);lightPosition.y=buildingHeight-.55;
        const light=new THREE.PointLight(0xfff2d0,6.5,20,2);light.position.copy(lightPosition);light.castShadow=false;light.name=`${station.id}-interior-light`;group.add(light);
      }

      placeBuildingBox("ticket-desk",2.45,1.18,.92,this.materials.stationWall,3.72,frontOffset+2.0,.04,{castShadow:true,receiveShadow:true});
      registerBuildingBlocker("ticket-desk",3.72,frontOffset+2.0,1.225,.46,1.22,.04);
      placeBuildingBox("interior-bench",2.15,.46,.55,this.materials.stationWall,-3.75,frontOffset+1.9,.04,{castShadow:true,receiveShadow:true});
      registerBuildingBlocker("interior-bench",-3.75,frontOffset+1.9,1.075,.275,.50,.04);
      placeBuildingBox("vending-machine",.92,2.05,.82,this.materials.busStop,3.95,frontOffset+4.05,.04,{castShadow:true,receiveShadow:true});
      registerBuildingBlocker("vending-machine",3.95,frontOffset+4.05,.46,.41,2.09,.04);
      placeBuildingBox("notice-board",2.3,1.15,.10,this.materials.busStop,-3.95,frontOffset+.18,2.45,{castShadow:false,receiveShadow:true});

      const towardsRoad=roadPoint.clone().sub(frontDoorOutside).setY(0).normalize(),buildingSign=new THREE.Mesh(new THREE.BoxGeometry(6.2,.78,.18),this.materials.busStop);
      buildingSign.position.copy(frontDoorOutside.clone().addScaledVector(towardsRoad,.72));buildingSign.position.y=4.55;buildingSign.rotation.y=Math.atan2(towardsRoad.x,towardsRoad.z)+Math.PI*.5;buildingSign.userData.stationName=station.name;buildingSign.name=`${station.id}-entrance-sign`;group.add(buildingSign);

      const accessStair={length:lowerFlight.length+upperFlight.length+midLandingWidth,rise:totalStairRise,steps:lowerFlight.steps+upperFlight.steps};
      station.entryPosition=frontDoorOutside.clone();station.exitPosition=platformEntrance.clone();station.interiorPosition=frontDoorInside.clone();
      const groundAisleRear=flightRearPoint.clone();groundAisleRear.y=.04;
      const stairRoute=[frontDoorOutside,frontDoorInside,groundAisleRear,lowerFlightBottom,lowerFlightTop,upperFlightBottom,upperFlightTop,rearDoorInside,rearDoorOutside,platformEntrance].map(point=>point.clone());
      station.stationBuilding={centre:buildingCentre.clone(),forward:buildingForward.clone(),right:buildingRight.clone(),halfWidth:buildingHalfW,halfDepth:buildingHalfD,height:buildingHeight,frontDoorOutside:frontDoorOutside.clone(),frontDoorInside:frontDoorInside.clone(),rearDoorInside:rearDoorInside.clone(),rearDoorOutside:rearDoorOutside.clone(),platformEntrance:platformEntrance.clone(),platformLinkStart:platformLinkStart.clone(),platformLinkEnd:platformLinkEnd.clone(),platformLinkLength,stairRoute,lowerFlightBottom:lowerFlightBottom.clone(),lowerFlightTop:lowerFlightTop.clone(),upperFlightBottom:upperFlightBottom.clone(),upperFlightTop:upperFlightTop.clone(),midLandingCentre:midLandingCentre.clone(),upperLandingCentre:upperLandingCentre.clone(),stairFlightRun:flightRun,stairFlightRise:halfStairRise,stairPitch:THREE.MathUtils.radToDeg(stairPitch),stairRise:totalStairRise,minimumRailClearance:exactBuildingTrackClearance,minimumTrackClearance:exactBuildingTrackClearance,minimumRoadClearance:exactBuildingRoadClearance,roadSide,entranceSide:accessSide,usesPedestrianUnderpass:accessSide!==roadSide};
      this.decorateAirportStation(station,group,platformTop);
      const pathEnd=roadPoint.clone().addScaledVector(towardsRoad,-station.roadAccess.roadWidth*.5-1.9);pathEnd.y=.04;
      if(frontDoorOutside.distanceTo(pathEnd)>1){const path=new THREE.Mesh(new THREE.BoxGeometry(1,1,1),this.materials.concrete);path.applyMatrix4(segmentMatrix(frontDoorOutside,pathEnd,3.0,.08));path.receiveShadow=true;path.name=`${station.id}-access-path`;group.add(path);}
      const roadTangent=station.roadAccess.tangent.clone().setY(0).normalize(),roadRight=new THREE.Vector3(roadTangent.z,0,-roadTangent.x),roadAngle=Math.atan2(roadTangent.x,roadTangent.z),towardStation=centreFrame.centre.clone().sub(roadPoint).setY(0).normalize();
      const localBlockers=this.walkBlockers.filter(blocker=>blocker.stationId===station.id),minimumForecourtRailDistance=platformOffset+platformWidth*.5+1.0;
      let parkingCentre=null;
      parkingSearch:
      for(const sideDirection of[1,-1])for(const alongOffset of[18,-18,34,-34,50,-50,0]){
        const candidate=roadPoint.clone().addScaledVector(towardStation,sideDirection*(station.roadAccess.roadWidth*.5+13.2)).addScaledVector(roadTangent,alongOffset);candidate.y=.045;
        if(this.stationFootprintClear(candidate,roadTangent,roadRight,13.5,9,{minimumRailDistance:minimumForecourtRailDistance,blockers:localBlockers})){parkingCentre=candidate;break parkingSearch;}
      }
      if(parkingCentre){
        const parking=new THREE.Mesh(new THREE.BoxGeometry(18,.09,27),this.materials.tarmac);parking.position.copy(parkingCentre);parking.rotation.y=roadAngle;parking.receiveShadow=true;parking.name=`${station.id}-car-park`;group.add(parking);
        for(let bay=-3;bay<=3;bay++){
          const markingCentre=parkingCentre.clone().addScaledVector(roadTangent,bay*3.4),marking=new THREE.Mesh(new THREE.BoxGeometry(17,.018,.09),this.materials.marking);marking.position.set(markingCentre.x,.101,markingCentre.z);marking.rotation.y=roadAngle;marking.name=`${station.id}-parking-marking`;group.add(marking);
        }
      }
      let shelterPosition=null,busPosition=null;
      for(const alongOffset of[-10,10,-22,22,-34,34,0]){
        const shelterCandidate=roadPoint.clone().addScaledVector(towardStation,station.roadAccess.roadWidth*.5+4.7).addScaledVector(roadTangent,alongOffset);shelterCandidate.y=0;
        if(!this.stationFootprintClear(shelterCandidate,roadTangent,roadRight,1.7,1.0,{minimumRailDistance:minimumForecourtRailDistance,blockers:localBlockers}))continue;
        shelterPosition=shelterCandidate;busPosition=roadPoint.clone().addScaledVector(towardStation,station.roadAccess.roadWidth*.5+1.2).addScaledVector(roadTangent,alongOffset);busPosition.y=0;break;
      }
      if(busPosition){
        const busPole=new THREE.Mesh(new THREE.CylinderGeometry(.08,.10,2.8,8),this.materials.post);busPole.position.set(busPosition.x,1.4,busPosition.z);busPole.name=`${station.id}-bus-pole`;group.add(busPole);
        const busSign=new THREE.Mesh(new THREE.BoxGeometry(.54,.72,.12),this.materials.busStop);busSign.position.set(busPosition.x,2.38,busPosition.z);busSign.rotation.y=roadAngle;busSign.name=`${station.id}-bus-sign`;group.add(busSign);
        const shelter=new THREE.Mesh(new THREE.BoxGeometry(2.0,2.25,3.4),this.materials.glass);shelter.position.set(shelterPosition.x,1.13,shelterPosition.z);shelter.rotation.y=roadAngle;shelter.name=`${station.id}-bus-shelter`;group.add(shelter);
      }

      const liftFrame=this.stationSample(station,accessAlong+7.5,accessSide*(platformOffset+platformWidth*.5+2.5)),liftHeight=bridgeWalkY+1.05,lift=new THREE.Mesh(new THREE.BoxGeometry(3.2,liftHeight,3.2),this.materials.glass);
      lift.position.set(liftFrame.point.x,liftHeight*.5,liftFrame.point.z);lift.rotation.y=Math.atan2(liftFrame.forward.x,liftFrame.forward.z);lift.castShadow=true;lift.name=`${station.id}-lift-tower`;group.add(lift);
      this.registerWalkBlocker({name:"lift-tower",stationId:station.id,centre:liftFrame.point.clone(),forward:liftFrame.forward.clone(),right:liftFrame.right.clone(),halfLength:1.588,halfWidth:1.588,maximumHeight:liftHeight,visualHalfLength:1.6,visualHalfWidth:1.6,visualMinimumHeight:0,visualMaximumHeight:liftHeight,boundaryType:"station-lift-tower"});
      const liftLinkStart=liftFrame.point.clone(),liftLinkEnd=this.stationSample(station,accessAlong+7.5,accessSide*(platformOffset+platformWidth*.30)).point;liftLinkStart.y=bridgeWalkY;liftLinkEnd.y=bridgeWalkY;
      const liftLink=new THREE.Mesh(new THREE.BoxGeometry(1,1,1),this.materials.concrete);liftLink.applyMatrix4(segmentMatrix(liftLinkStart,liftLinkEnd,2.2,.28));liftLink.name=`${station.id}-lift-link`;group.add(liftLink);

      const maximumPlatformSegment=length/segmentCount,trackOffsets=this.plan.trackOffsets??[-10.5,-3.5,3.5,10.5];
      const platformTrackClearance=Math.min(...platformCentres.map(platformCentre=>Math.min(...trackOffsets.map(trackOffset=>Math.abs(platformCentre-trackOffset)))))-platformWidth*.5;
      const diagnostic={
        id:station.id,name:station.name,platformSegmentCount:platformMatrices.length,canopySegmentCount:canopyMatrices.length,maximumPlatformSegment,
        platformGradient:station.platformGradient,headingChange:station.headingChange,maximumChordDeviation:station.maximumChordDeviation,
        platformTrackClearance,accessStairRun:accessStair.length,accessStairRise:accessStair.rise,
        footbridgeUndersideClearance:bridgeDeckY-.17-(bridgeFrame.centre.y+4.05),parkingPresent:Boolean(parkingCentre),parkingRailDistance:parkingCentre?this.nearestRailDistance(parkingCentre):null,
        busStopPresent:Boolean(busPosition),busShelterRailDistance:shelterPosition?this.nearestRailDistance(shelterPosition):null,stationBuildingRoadClearance:exactBuildingRoadClearance,stationBuildingTrackClearance:exactBuildingTrackClearance,stationEntranceUsesUnderpass:accessSide!==roadSide,componentCount:group.children.length
      };
      group.userData={station,diagnostic};group.visible=false;this.stationDiagnostics.push(diagnostic);this.railGroup.add(group);this.stationGroups.push(group);
      station.lowGroup=this.createStationLowGroup(station,platformOffset,platformWidth,platformTop);
    }
  }

  createTrainLowMesh(formation,id){
    const mesh=new THREE.InstancedMesh(new THREE.BoxGeometry(1,1,1),this.materials.trainLow,formation.vehicles.length);mesh.name=`${id}-low-detail`;
    mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);mesh.castShadow=false;mesh.receiveShadow=false;mesh.frustumCulled=true;mesh.visible=false;this.scene.add(mesh);return mesh;
  }

  updateTrainLowMesh(train){
    if(!train.lowMesh)return;
    const transform=this.trainLowTransform,route=this.routeForTrain(train),position=train._samplePosition,tangent=train._sampleTangent;transform.rotation.order="YXZ";
    for(let index=0;index<train.formation.vehicles.length;index++){
      const vehicle=train.formation.vehicles[index],distanceFromHead=train.formation.spacings[index],t=wrappedProgress(train.progress-train.direction*distanceFromHead/route.length);trackPosition(route,t,train.trackIndex,position);trackTangent(route,t,train.direction,tangent);const rear=vehicle.userData.rear===true;
      const width=vehicle.userData.width??2.74,height=vehicle.userData.height??3.92,length=vehicle.userData.modelLength??14,pitch=Math.asin(THREE.MathUtils.clamp(tangent.y,-1,1));
      transform.position.copy(position);transform.position.y+=.18+height*.46;transform.rotation.set(rear?pitch:-pitch,Math.atan2(tangent.x,tangent.z)+(rear?Math.PI:0),0);transform.scale.set(width*.96,height*.82,length*.98);transform.updateMatrix();train.lowMesh.setMatrixAt(index,transform.matrix);
    }
    train.lowMesh.instanceMatrix.needsUpdate=true;train.lowMesh.computeBoundingSphere();
  }

  spawnFleet(services=this.services){
    for(const [index,service] of services.entries()){
      const route=this.routeById.get(service.initialRouteId)??this.routes[0],direction=service.direction,trackIndex=service.initialTrackIndex,progress=wrappedProgress(service.startProgress??index/services.length),id=`HST-${String(this.nextTrainId++).padStart(3,"0")}`,formation=createHSTFormation(this.scene,{id,coachCount:route.formationCoachCount});
      const train={id,service,serviceId:service.serviceId,route,routeId:route.id,direction,trackIndex,progress,speed:Math.min(service.maximumSpeed,(10+index%4*1.5)*CONFIG.trainSpeedMultiplier),throttle:0,brake:0,dwell:0,dwellTotal:0,manual:false,formation,nextStation:null,lastStationId:null,currentStation:null,routeLimit:Math.min(route.urbanLineSpeedMps*CONFIG.trainSpeedMultiplier,service.maximumSpeed),designLimit:Math.min(route.designSpeedMps*CONFIG.trainSpeedMultiplier,service.maximumSpeed),throughService:service.throughService,completedRouteTransfers:0,outline:this.createTrainOutline(),lowMesh:null,hornTimer:0,exhaust:this.createExhaustSystem(formation),doorAmount:0,doorTarget:0,doorsOpen:false,platformSide:1,openDoorSides:[1],renderTier:"low",lowUpdateAccumulator:Infinity,outlineUpdateAccumulator:Infinity,movementAuthority:null,nextSignal:null,signalAspect:"red",permittedSpeed:0,allocatedPlatform:null,signalWaitSeconds:0,waitingAtSignal:false,protectionIntervention:false,spadWarning:false,temporarySpeedLimit:Infinity,completedLoops:0,distanceTravelled:0,headPosition:new THREE.Vector3(),_samplePosition:new THREE.Vector3(),_sampleTangent:new THREE.Vector3(),_tailPosition:new THREE.Vector3()};
      train.lowMesh=this.createTrainLowMesh(formation,id);this.trains.push(train);this.updateTrainPlacement(train);this.updateTrainLighting(train);for(const vehicle of formation.vehicles)vehicle.visible=false;train.lowMesh.visible=true;this.selectNextStation(train);
    }
  }

  createExhaustSystem(formation){
    const puffs=[];
    for(const carIndex of[0,formation.vehicles.length-1])for(let i=0;i<5;i++){
      const mat=new THREE.MeshStandardMaterial({color:0x30363a,transparent:true,opacity:0,roughness:1,depthWrite:false});
      const mesh=new THREE.Mesh(new THREE.SphereGeometry(.20,8,6),mat);mesh.visible=false;mesh.castShadow=false;this.scene.add(mesh);
      puffs.push({mesh,carIndex,portIndex:i%2,phase:i/5,seed:i*.73+carIndex*.31});
    }
    return puffs;
  }

  updateTrainLighting(train){
    const first=train.formation.vehicles[0],last=train.formation.vehicles.at(-1);
    for(const car of train.formation.vehicles.filter(v=>v.userData.type==="class43-power")){
      const leading=car===first,trailing=car===last;
      for(const lamp of car.userData.frontLights??[]){lamp.material.emissiveIntensity=leading?3.4:.10;lamp.material.color.setHex(leading?0xfff7d7:0x777162);}
      for(const lamp of car.userData.tailLights??[]){lamp.material.emissiveIntensity=trailing?2.8:.10;lamp.material.color.setHex(trailing?0xff382c:0x69201b);}
    }
  }

  updateExhaust(train,dt,time){
    const effort=train.manual?train.throttle:THREE.MathUtils.clamp((train.routeLimit-train.speed)/Math.max(1,train.routeLimit),.12,.72);
    for(const puff of train.exhaust??[]){
      const car=train.formation.vehicles[puff.carIndex],port=car.userData.exhaustPorts?.[puff.portIndex];
      if(!port||!car.visible){puff.mesh.visible=false;continue;}
      puff.phase=(puff.phase+dt*(.22+effort*.62))%1;
      const world=car.localToWorld(this._scratchWorld.copy(port)),t=puff.phase;
      const drift=Math.sin(time*.7+puff.seed)*.18*t;
      puff.mesh.position.set(world.x+drift,world.y+t*(1.2+effort*1.6),world.z+Math.cos(time*.5+puff.seed)*.12*t);
      const scale=.45+t*(1.15+effort*.55);puff.mesh.scale.setScalar(scale);
      puff.mesh.material.opacity=(1-t)*(.035+effort*.14);puff.mesh.visible=puff.mesh.material.opacity>.012;
    }
  }

  createTrainOutline(){
    const geometry=new THREE.BufferGeometry();geometry.setAttribute("position",new THREE.Float32BufferAttribute(new Array(24).fill(0),3));
    const line=new THREE.LineSegments(geometry,new THREE.LineBasicMaterial({color:0xd6c54a,transparent:true,opacity:.55,depthWrite:false,fog:true}));line.visible=false;line.frustumCulled=true;this.scene.add(line);return line;
  }

  stationStopProgress(train,station,route=this.routeForTrain(train)){
    const centreOffset=Math.max(0,((train.formation?.totalLength??0)-(train.formation?.frontLength??0))*.5);
    return wrappedProgress(station.t+train.direction*centreOffset/route.length);
  }

  stationDistanceForTrain(train,station,route=this.routeForTrain(train)){
    return forwardArcDistance(train.progress,this.stationStopProgress(train,station,route),train.direction,route.length);
  }

  selectNextStation(train){
    const route=this.routeForTrain(train),all=train.direction>0?route.stations:[...route.stations].reverse(),serviceStops=train.service?.stopsForRoute(route.id)??[],ordered=serviceStops.length?all.filter(station=>serviceStops.includes(station.id)||serviceStops.includes(station.sharedPhysicalStationId)):all;
    const usable=ordered.length?ordered:all,candidates=usable.map(station=>({station,distance:this.stationDistanceForTrain(train,station,route)})).filter(x=>x.distance>8);
    candidates.sort((a,b)=>a.distance-b.distance);train.nextStation=candidates[0]?.station??usable[0];
  }

  trainAheadDistance(train){
    const route=this.routeForTrain(train);let best=Infinity;
    for(const other of this.trains){if(other===train||other.routeId!==train.routeId||other.trackIndex!==train.trackIndex||other.direction!==train.direction)continue;const d=forwardArcDistance(train.progress,other.progress,train.direction,route.length);if(d>1&&d<best)best=d;}
    return best;
  }

  localDoorSideForPlatformOffset(train,servedPlatform){
    const route=this.routeForTrain(train),baseTangent=train._sampleTangent;trackTangent(route,train.progress,1,baseTangent);const horizontalLength=Math.hypot(baseTangent.x,baseTangent.z)||1,normalX=-baseTangent.z/horizontalLength,normalZ=baseTangent.x/horizontalLength;
    const trackOffset=trackOffsetFor(route,train.trackIndex),side=Math.sign(servedPlatform-trackOffset)||1;
    trackTangent(route,train.progress,train.direction,baseTangent);const travelLength=Math.hypot(baseTangent.x,baseTangent.z)||1,localRightX=baseTangent.z/travelLength,localRightZ=-baseTangent.x/travelLength;
    return(normalX*side*localRightX+normalZ*side*localRightZ)>=0?1:-1;
  }

  adjacentPlatformCentresByDoorSide(train){
    const route=this.routeForTrain(train),trackOffset=trackOffsetFor(route,train.trackIndex),platformCentres=this.plan.platformCentres??[-14,-7,0,7,14],result=new Map();
    for(const centreOffset of platformCentres){
      const lateralDistance=Math.abs(centreOffset-trackOffset);if(lateralDistance<.5||lateralDistance>5.1)continue;
      const side=this.localDoorSideForPlatformOffset(train,centreOffset),previous=result.get(side);if(previous===undefined||lateralDistance<Math.abs(previous-trackOffset))result.set(side,centreOffset);
    }
    return result;
  }

  platformSideForTrain(train){
    const route=this.routeForTrain(train),platformCentres=this.plan.platformCentres??[-14,-7,0,7,14],allocation=this.stationOperations.platformForTrain(train),last=platformCentres.length-1,servedPlatform=allocation?.centreOffset??(train.trackIndex===0?platformCentres[0]??-14:train.trackIndex===1?platformCentres[1]??-7:train.trackIndex===2?platformCentres[last-1]??7:platformCentres[last]??14);
    return this.localDoorSideForPlatformOffset(train,servedPlatform);
  }

  platformSurfaceCandidatesForStation(station){
    const stationId=station?.id??null;if(!stationId)return[];
    return this.walkSurfaces.filter(surface=>surface.stationId===stationId&&surface.role==="platform");
  }

  doorPlatformOptions(train,vehicle,door,{maxDistance=4.2,margin=.38}={}){
    const routeStation=train.currentStation??this.stationForTrain(train,22),station=routeStation?.physicalStation??routeStation,platformSurfaces=this.platformSurfaceCandidatesForStation(station);if(!platformSurfaces.length)return[];
    const doorPoint=this.doorWorldPosition(vehicle,door,1.45),groups=new Map();
    for(const surface of platformSurfaces){
      const centre=surface.platformCentre;if(!Number.isFinite(centre))continue;const point=this.closestPointOnWalkSurface(surface,doorPoint,{margin}),distance=Math.hypot(point.x-doorPoint.x,point.z-doorPoint.z),previous=groups.get(centre);
      if(!previous||distance<previous.distance)groups.set(centre,{distance});
    }
    const nearest=[...groups.entries()].sort((a,b)=>a[1].distance-b[1].distance)[0];if(!nearest||nearest[1].distance>maxDistance)return[];const targetCentre=nearest[0],ranked=[];
    for(const surface of platformSurfaces){
      if(Math.abs((surface.platformCentre??Infinity)-targetCentre)>.05)continue;const point=this.closestPointOnWalkSurface(surface,doorPoint,{margin}),distance=Math.hypot(point.x-doorPoint.x,point.z-doorPoint.z);ranked.push({surface,point,distance,platformCentre:targetCentre});
    }
    ranked.sort((a,b)=>a.distance-b.distance);return ranked;
  }

  doorHasPlatformAccess(train,vehicle,door,options){return this.doorPlatformOptions(train,vehicle,door,options).length>0;}

  openDoorSidesForTrain(train){
    const coach=train.formation?.vehicles?.find?.(vehicle=>vehicle.userData.type==="mark3-coach"),sides=[];
    if(coach)for(const side of[-1,1]){
      const doors=(coach.userData.passengerDoors??[]).filter(door=>door.side===side);
      if(doors.some(door=>this.doorHasPlatformAccess(train,coach,door,{maxDistance:4.2})))sides.push(side);
    }
    // All generated stations use five platform faces around four tracks. If a
    // distant formation has not had its detailed transforms refreshed yet,
    // retain the topology-safe both-side result until the nearby geometry can
    // be queried exactly.
    if(!sides.length&&train.currentStation)return[-1,1];
    if(!sides.length)sides.push(train.platformSide||1);return sides;
  }

  isDoorOpenForTrain(train,door){
    return Boolean(train?.doorsOpen&&door&&(train.openDoorSides??[]).includes(door.side)&&door.amount>.82);
  }

  updateTrainDoors(train,dt,applyVisuals=true){
    train.platformSide=this.platformSideForTrain(train);
    const allocation=this.stationOperations.platformForTrain(train),stationPhysical=train.currentStation?this.network.physicalStationId(train.currentStation):null,safelyStopped=train.speed<.12&&Boolean(train.currentStation)&&Boolean(allocation)&&allocation.physicalStationId===stationPhysical,boardingWindow=train.dwell>2.25;
    train.doorTarget=safelyStopped&&boardingWindow?1:0;
    train.doorAmount=THREE.MathUtils.lerp(train.doorAmount??0,train.doorTarget,1-Math.exp(-dt*4.8));
    if(Math.abs(train.doorAmount-train.doorTarget)<.002)train.doorAmount=train.doorTarget;
    train.openDoorSides=train.doorTarget>0?this.openDoorSidesForTrain(train):[];
    train.doorsOpen=train.doorAmount>.82&&train.openDoorSides.length>0;
    for(const vehicle of train.formation.vehicles){
      for(const door of vehicle.userData.passengerDoors??[]){
        const amount=(train.openDoorSides??[]).includes(door.side)?train.doorAmount:0;door.amount=amount;
        if(applyVisuals){
          for(const leaf of door.leaves)leaf.group.position.z=leaf.baseZ+leaf.slide*amount;
          if(door.warningLight){const active=(train.openDoorSides??[]).includes(door.side)&&safelyStopped&&boardingWindow;door.warningLight.material.emissiveIntensity=active&&amount<.82?2.5:amount>.05?.75:.15;}
        }
      }
    }
  }

  update(dt,time,player,weather="clear"){
    this.lastDispatcherUpdateMsThisFrame=0;this.simulationSeconds+=dt;this.blockSystem.updateOccupancy(this.trains);this.dispatcherAccumulator+=dt;this.informationAccumulator+=dt;
    if(this.dispatcher&&this.dispatcherAccumulator>=.125){this.dispatcher.update(this.dispatcherAccumulator,this.simulationSeconds);this.lastDispatcherUpdateMsThisFrame=this.dispatcher.updateTimeMs??0;this.dispatcherAccumulator=0;this.signalRenderer?.update();}
    if(this.informationAccumulator>=1){this.stationOperations.updateInformation(this.trains,this.simulationSeconds);this.informationAccumulator=0;}
    if(this.input.consume("KeyV")){this.railDebugEnabled=this.signalRenderer?.toggleDebug()??false;this.toast(`Railway debug ${this.railDebugEnabled?"enabled":"disabled"}`);}
    let total=0;
    for(const train of this.trains){
      if(train.hornTimer>0)train.hornTimer-=dt;
      if(train.manual)this.updateManualTrain(train,dt);
      else this.updateAITrain(train,dt);
      const route=this.routeForTrain(train),previousProgress=train.progress;train.progress=wrappedProgress(train.progress+train.direction*(train.speed*dt/route.length));train.distanceTravelled=(train.distanceTravelled??0)+train.speed*dt;if((train.direction>0&&train.progress<previousProgress)||(train.direction<0&&train.progress>previousProgress))train.completedLoops=(train.completedLoops??0)+1;
      this.updateTrainHead(train);this.updateTrainVisibility(train,player);
      const full=train.renderTier==="full";
      this.updateTrainDoors(train,dt,full);
      if(full){
        this.updateFullTrainPlacement(train);
        if(train.lastVisualTier!=="full")this.updateTrainLighting(train);
        for(const vehicle of train.formation.vehicles)for(const wheel of vehicle.userData.wheels??[])wheel.rotation.x-=train.speed*dt/.42;
        this.updateExhaust(train,dt,time);
      }else{
        for(const puff of train.exhaust??[])puff.mesh.visible=false;
        if(train.renderTier==="low"){
          train.lowUpdateAccumulator+=dt;
          if(train.lowUpdateAccumulator>=qualityManager.current.rail.trainLowUpdateStep){this.updateTrainLowMesh(train);train.lowUpdateAccumulator=0;}
        }else{
          train.outlineUpdateAccumulator+=dt;
          if(train.outlineUpdateAccumulator>=qualityManager.current.rail.trainOutlineUpdateStep){this.updateTrainOutline(train,train.formation.totalLength);train.outlineUpdateAccumulator=0;}
        }
      }
      train.lastVisualTier=train.renderTier;total+=train.speed;
    }
    this.averageTrainSpeed=this.trains.length?total/this.trains.length*3.6:0;
    this.updateInfrastructureVisibility(player,false,dt);this.updateStationPedestrians(dt,time,player);this.updateInteractionPrompt(player);
    if(this.playerTrain){
      if(this.playerTrainMode==="passenger")this.updatePassengerRide(this.playerTrain,dt,player);
      else this.updateTrainCamera(this.playerTrain,dt);
      player.inTrain=true;
    }
    this.updateTrainAudio(time);
  }

  maybeTransferAirportService(train,station){
    if(!train.throughService||!station)return false;
    const cityRoute=this.routeById.get("city"),airportRoute=this.routeById.get("airport");if(!cityRoute||!airportRoute)return false;
    let targetRoute=null,targetStation=null;
    if(train.routeId==="airport"&&station.sharedPhysicalStationId){targetRoute=cityRoute;targetStation=cityRoute.stations.find(candidate=>candidate.id===station.sharedPhysicalStationId);}
    else if(train.routeId==="city"&&station.id===airportRoute.connectsAtStationId){targetRoute=airportRoute;targetStation=airportRoute.stations.find(candidate=>candidate.sharedPhysicalStationId===station.id);}
    if(!targetRoute||!targetStation)return false;
    const targetProgress=this.stationStopProgress(train,targetStation,targetRoute),requiredFrontGap=42,requiredRearGap=(train.formation?.totalLength??120)+42;
    for(const other of this.trains){if(other===train||other.routeId!==targetRoute.id||other.trackIndex!==train.trackIndex||other.direction!==train.direction)continue;const forwardGap=forwardArcDistance(targetProgress,other.progress,train.direction,targetRoute.length)-(other.formation?.totalLength??120),rearGap=forwardArcDistance(other.progress,targetProgress,train.direction,targetRoute.length)-(train.formation?.totalLength??120);if(forwardGap<requiredFrontGap||rearGap<42){train.waitingForJunction=true;train.junctionRouteSet=false;return null;}}
    const targetBlocks=new Set(),sampleStep=18,totalLength=train.formation?.totalLength??120;for(let distance=0;distance<=totalLength;distance+=sampleStep){const sampleT=wrappedProgress(targetProgress-train.direction*distance/targetRoute.length),block=this.network.blockForProgress(targetRoute.id,train.trackIndex,sampleT);if(block)targetBlocks.add(block);}
    if([...targetBlocks].some(block=>[...block.occupiedBy].some(owner=>owner!==train.id)||(block.reservedBy&&block.reservedBy!==train.id))){train.waitingForJunction=true;train.junctionRouteSet=false;return null;}
    const request=this.dispatcher?.requestTransfer(train,targetRoute.id);if(request&&!request.granted){train.waitingForJunction=true;train.junctionRouteSet=false;return null;}this.blockSystem.reserveBlocks(train,[...targetBlocks]);
    this.interlocking.markEntered(train);this.stationOperations.release(train.id);train.route=targetRoute;train.routeId=targetRoute.id;train.progress=targetProgress;train.trackIndex=Math.min(train.trackIndex,(targetRoute.trackOffsets?.length??4)-1);train.routeLimit=Math.min(targetRoute.urbanLineSpeedMps*CONFIG.trainSpeedMultiplier,train.service?.maximumSpeed??targetRoute.urbanLineSpeedMps*CONFIG.trainSpeedMultiplier);train.designLimit=Math.min(targetRoute.designSpeedMps*CONFIG.trainSpeedMultiplier,train.service?.maximumSpeed??targetRoute.designSpeedMps*CONFIG.trainSpeedMultiplier);train.currentStation=null;train.nextStation=null;train.completedRouteTransfers=(train.completedRouteTransfers??0)+1;train.waitingForJunction=false;train.junctionRouteSet=true;this.updateTrainHead(train);this.selectNextStation(train);this.dispatcher?.completeTransfer(train);return true;
  }

  updateAITrain(train,dt){
    if(train.dwell>0){
      train.dwell=Math.max(0,train.dwell-dt);train.speed=Math.max(0,train.speed-dt*1.3*CONFIG.trainSpeedMultiplier*CONFIG.trainSpeedMultiplier);
      if(train.dwell<=0){
        const departedStation=train.currentStation??train.nextStation,transfer=this.maybeTransferAirportService(train,departedStation);
        if(transfer===null){train.dwell=.6;train.speed=0;return;}
        train.dwell=0;train.lastStationId=departedStation?.id;this.stationOperations.release(train.id);if(!transfer){train.currentStation=null;this.selectNextStation(train);}
      }
      return;
    }
    if(!train.nextStation)this.selectNextStation(train);
    const route=this.routeForTrain(train),stationStop=this.stationStopProgress(train,train.nextStation,route),stationDistance=forwardArcDistance(train.progress,stationStop,train.direction,route.length),allocation=this.stationOperations.allocation(train.id);
    const speedScale=CONFIG.trainSpeedMultiplier,speedScaleSq=speedScale*speedScale,brakeRate=1.08*speedScaleSq,platformReady=allocation&&allocation.physicalStationId===this.network.physicalStationId(train.nextStation),stationBuffer=platformReady?1.5:85,stationTarget=Math.sqrt(Math.max(0,2*brakeRate*Math.max(0,stationDistance-stationBuffer))),authorityDistance=Math.max(0,(train.movementAuthority?.distance??0)-8),authorityTarget=Math.sqrt(Math.max(0,2*1.12*speedScaleSq*authorityDistance)),trainGap=Math.max(0,(train.trainAheadGap??Infinity)-24),trainAheadTarget=Math.sqrt(Math.max(0,2*1.18*speedScaleSq*trainGap));
    let target=Math.min(train.routeLimit,train.permittedSpeed??train.routeLimit,train.junctionSpeedLimit??Infinity,train.temporarySpeedLimit??Infinity,stationTarget,authorityTarget,trainAheadTarget);
    if(stationDistance<2.2&&train.speed<1.45*speedScale&&platformReady){train.progress=stationStop;train.speed=0;train.currentStation=train.nextStation;this.stationOperations.occupy(train,train.currentStation);train.dwellTotal=train.service?.dwellSeconds??13;train.dwell=train.dwellTotal;train.service.completedStops++;return;}
    const acceleration=.74*speedScaleSq,braking=1.16*speedScaleSq;if(train.speed<target)train.speed=Math.min(target,train.speed+acceleration*dt);else train.speed=Math.max(target,train.speed-braking*dt);
  }

  updateManualTrain(train,dt){
    const throttle=this.input.isDown("KeyW")?1:0,serviceBrake=this.input.isDown("KeyS")?1:0,emergency=this.input.isDown("Space");
    if(throttle&&train.dwell>0){train.dwell=0;train.currentStation=null;}
    const speedScale=CONFIG.trainSpeedMultiplier,speedScaleSq=speedScale*speedScale;
    train.throttle=THREE.MathUtils.lerp(train.throttle,throttle,1-Math.exp(-dt*2.1*speedScale));train.brake=THREE.MathUtils.lerp(train.brake,serviceBrake?1:0,1-Math.exp(-dt*4*speedScale));
    const authorityDistance=Math.max(0,(train.movementAuthority?.distance??0)-6),signalTarget=Math.sqrt(Math.max(0,2*1.25*speedScaleSq*authorityDistance)),trainGap=Math.max(0,(train.trainAheadGap??Infinity)-22),trainTarget=Math.sqrt(Math.max(0,2*1.3*speedScaleSq*trainGap)),safetyTarget=Math.min(signalTarget,trainTarget),permitted=Math.min(train.designLimit,train.permittedSpeed??train.designLimit,train.junctionSpeedLimit??Infinity,train.temporarySpeedLimit??Infinity,safetyTarget),stoppingDistance=train.speed*train.speed/(2*1.9*speedScaleSq)+train.speed*(.55/speedScale);
    train.protectionIntervention=stoppingDistance>authorityDistance&&train.signalAspect==="red";train.spadWarning=train.protectionIntervention;
    if(train.protectionIntervention&&!train.protectionAnnounced){this.toast("Train protection: emergency brake for red signal / occupied block");train.protectionAnnounced=true;}if(!train.protectionIntervention)train.protectionAnnounced=false;
    const power=.98*speedScaleSq*Math.max(.22,1-train.speed/train.designLimit*.72),drag=.010*speedScaleSq+.00013*train.speed*train.speed;
    train.speed+=train.throttle*power*dt;train.speed-=train.brake*1.28*speedScaleSq*dt;train.speed-=drag*dt;if(emergency||train.protectionIntervention)train.speed-=2.15*speedScaleSq*dt;
    train.speed=THREE.MathUtils.clamp(train.speed,0,permitted);
    if(this.input.consume("KeyR")&&train.speed<.4){train.direction*=-1;this.selectNextStation(train);this.toast("HST direction reversed on the same line");}
    if(this.input.consume("KeyC")){this.trainCameraIndex=(this.trainCameraIndex+1)%this.cameraModes.length;this.toast(`${this.cameraModes[this.trainCameraIndex]} train camera`);}
    if(this.input.consume("KeyH")){train.hornTimer=1.4;this.toast("Class 43 two-tone horn");}
    if(this.input.consume("KeyJ")&&train.speed<.4){const station=this.stationForTrain(train,18),wasThrough=train.throughService;train.throughService=true;const transferred=this.maybeTransferAirportService(train,station);train.throughService=wasThrough;if(transferred)this.toast(`Route set for ${train.route.name}`);else if(transferred===null)this.toast("Junction route unavailable — held at signal");else this.toast("Stop at Industrial Exchange to change railway loops");}
  }

  updateTrainHead(train){
    const route=this.routeForTrain(train);trackPosition(route,train.progress,train.trackIndex,train.headPosition);trackTangent(route,train.progress,train.direction,train._sampleTangent);train.heading=Math.atan2(train._sampleTangent.x,train._sampleTangent.z);
  }

  updateFullTrainPlacement(train){
    const route=this.routeForTrain(train),{vehicles,spacings}=train.formation,position=train._samplePosition,tangent=train._sampleTangent;
    for(let i=0;i<vehicles.length;i++){
      const distanceFromHead=spacings[i],t=wrappedProgress(train.progress-train.direction*distanceFromHead/route.length);trackPosition(route,t,train.trackIndex,position);trackTangent(route,t,train.direction,tangent);
      const vehicle=vehicles[i],rear=vehicle.userData.rear===true,pitch=Math.asin(THREE.MathUtils.clamp(tangent.y,-1,1));vehicle.position.copy(position);vehicle.position.y+=.18;vehicle.rotation.order="YXZ";vehicle.rotation.y=Math.atan2(tangent.x,tangent.z)+(rear?Math.PI:0);vehicle.rotation.x=rear?pitch:-pitch;
    }
  }

  updateTrainPlacement(train){
    this.updateTrainHead(train);this.updateFullTrainPlacement(train);this.updateTrainOutline(train,train.formation.totalLength);this.updateTrainLowMesh(train);
  }

  updateTrainOutline(train,totalLength){
    const route=this.routeForTrain(train),p=train.headPosition,tangent=train._sampleTangent;trackTangent(route,train.progress,train.direction,tangent);const tailT=wrappedProgress(train.progress-train.direction*totalLength/route.length),tail=trackPosition(route,tailT,train.trackIndex,train._tailPosition),horizontalLength=Math.hypot(tangent.x,tangent.z)||1,nx=-tangent.z/horizontalLength,nz=tangent.x/horizontalLength,w=1.6,yOffset=1.98;
    const pLeftX=p.x-nx*w,pLeftZ=p.z-nz*w,pRightX=p.x+nx*w,pRightZ=p.z+nz*w,tLeftX=tail.x-nx*w,tLeftZ=tail.z-nz*w,tRightX=tail.x+nx*w,tRightZ=tail.z+nz*w,py=p.y+yOffset,ty=tail.y+yOffset,attr=train.outline.geometry.attributes.position;
    attr.setXYZ(0,pLeftX,py,pLeftZ);attr.setXYZ(1,pRightX,py,pRightZ);attr.setXYZ(2,pRightX,py,pRightZ);attr.setXYZ(3,tRightX,ty,tRightZ);attr.setXYZ(4,tRightX,ty,tRightZ);attr.setXYZ(5,tLeftX,ty,tLeftZ);attr.setXYZ(6,tLeftX,ty,tLeftZ);attr.setXYZ(7,pLeftX,py,pLeftZ);attr.needsUpdate=true;
  }

  updateTrainVisibility(train,player){
    const focus=this.playerTrain?.headPosition??(player.inVehicle?player.position:this.camera.position),distance=train.headPosition.distanceTo(focus),key=chunkKeyForPosition(train.headPosition,this.chunkManager?.chunkSize),insideFourChunkRange=this.chunkManager?.neighbourhoodKeys?.has(key)??distance<qualityManager.current.rail.trainFullDistance;
    const full=this.playerTrain===train||(insideFourChunkRange&&distance<qualityManager.current.rail.trainFullDistance),low=!full&&distance<qualityManager.current.rail.trainLowDistance;
    for(const vehicle of train.formation.vehicles){
      vehicle.visible=full;
      if(vehicle.userData.interiorGroup){
        // Interior relevance is measured from the individual carriage rather
        // than the train head. This keeps the saloon visible through an open
        // doorway or nearby window even at the rear of a full-length HST.
        const nearby=vehicle.position.distanceToSquared(focus)<qualityManager.current.rail.trainInteriorDistance*qualityManager.current.rail.trainInteriorDistance;
        vehicle.userData.interiorGroup.visible=full&&(this.playerTrain===train||nearby);
      }
    }
    if(train.lowMesh)train.lowMesh.visible=low;
    train.outline.visible=!full&&!low;
    train.renderTier=full?"full":low?"low":"outline";
    return train.renderTier;
  }

  updateInfrastructureVisibility(player,force=true,dt=0){
    const focus=this.playerTrain?.headPosition??(player.inVehicle?player.position:this.camera.position),focusChunk=chunkKeyForPosition(focus,this.chunkManager?.chunkSize);
    this.railVisibilityAccumulator+=dt;
    if(!force&&focusChunk===this.lastRailFocusChunk&&this.railVisibilityAccumulator<qualityManager.current.rail.railVisibilityStep)return;
    this.railVisibilityAccumulator=0;this.lastRailFocusChunk=focusChunk;
    const neighbourhood=this.chunkManager?.neighbourhoodKeys??new Set([focusChunk]);
    for(const entry of this.trackChunkGroups.values()){
      const distance=entry.centre.distanceTo(focus),detailed=neighbourhood.has(entry.key);
      entry.detail.visible=detailed;entry.low.visible=!detailed&&distance<1350;
    }
    for(const entry of this.gradeChunkGroups.values())entry.detail.visible=neighbourhood.has(entry.key);
    for(const group of this.stationGroups){
      const station=group.userData.station,position=station.position,distance=position.distanceTo(focus),stationKey=chunkKeyForPosition(position,this.chunkManager?.chunkSize);
      const full=distance<95||(stationKey===focusChunk&&distance<qualityManager.current.rail.stationFullDistance),low=!full&&distance<qualityManager.current.rail.stationLowDistance;
      group.visible=full;if(station.lowGroup)station.lowGroup.visible=low;station.renderTier=full?"full":low?"low":"hidden";
    }
  }

  adjustRoadVehicleTarget(vehicle,lane,target){return target;}

  blocksPlayer(from,to){return false;}

  walkingTrainBlockerAt(from,to,currentFeetY=0){
    const clearance=.035;
    for(const train of this.trains)for(let vehicleIndex=0;vehicleIndex<train.formation.vehicles.length;vehicleIndex++){
      const vehicle=train.formation.vehicles[vehicleIndex],local=vehicle.worldToLocal(this._scratchLocal.copy(to)),profile=vehicle.userData.collisionProfile,minimumHeight=profile?.minimumHeight??0,maximumHeight=profile?.maximumHeight??(vehicle.userData.height??3.9);
      if(local.y<minimumHeight-.03||local.y>maximumHeight+.03)continue;
      const inside=profile?pointInsideCollisionProfileXZ(local.x,local.z,profile,clearance):(Math.abs(local.z)<(vehicle.userData.modelLength??14)*.5+clearance&&Math.abs(local.x)<(vehicle.userData.width??2.74)*.5+clearance);
      if(!inside)continue;
      if(vehicle.userData.type==="mark3-coach"){
        const doorway=(vehicle.userData.passengerDoors??[]).find(door=>this.isDoorOpenForTrain(train,door)&&Math.abs(local.z-door.z)<.50&&Math.sign(local.x||door.side)===door.side);
        if(doorway)return null;
      }
      return{train,vehicle,vehicleIndex,local:{x:local.x,y:local.y,z:local.z},profile,clearance};
    }
    return null;
  }

  blocksWalking(from,to,currentFeetY=0){return Boolean(this.walkingTrainBlockerAt(from,to,currentFeetY));}

  distanceToVehicleSurface(position,vehicle){
    const local=vehicle.worldToLocal(this._scratchLocal.copy(position)),profile=vehicle.userData.collisionProfile,minimumHeight=profile?.minimumHeight??0,maximumHeight=profile?.maximumHeight??(vehicle.userData.height??3.7);
    const horizontal=profile?distanceToCollisionProfileXZ(local.x,local.z,profile):Math.hypot(Math.max(0,Math.abs(local.x)-(vehicle.userData.width??2.74)*.5),Math.max(0,Math.abs(local.z)-(vehicle.userData.modelLength??14)*.5));
    const vertical=local.y<minimumHeight?minimumHeight-local.y:local.y>maximumHeight?local.y-maximumHeight:0;return Math.hypot(horizontal,vertical);
  }

  stationForTrain(train,maxDistance=13){
    const route=this.routeForTrain(train);let best=null,bestDistance=Infinity;
    for(const station of route.stations){
      const stopProgress=this.stationStopProgress(train,station,route),delta=Math.min(wrappedProgress(stopProgress-train.progress),wrappedProgress(train.progress-stopProgress))*route.length;
      if(delta<bestDistance){bestDistance=delta;best=station;}
    }
    return bestDistance<=maxDistance?best:null;
  }

  doorWorldPosition(vehicle,door,outside=0){
    const local=new THREE.Vector3(door.side*(1.40+outside),vehicle.userData.interior?.floorY??1.06,door.z);return vehicle.localToWorld(local);
  }

  closestPointOnWalkSurface(surface,position,{margin=.22}={}){
    const relative=position.clone().sub(surface.centre).setY(0),along=THREE.MathUtils.clamp(relative.dot(surface.forward),-Math.max(0,surface.halfLength-margin),Math.max(0,surface.halfLength-margin)),across=THREE.MathUtils.clamp(relative.dot(surface.right),-Math.max(0,surface.halfWidth-margin),Math.max(0,surface.halfWidth-margin));
    const point=surface.centre.clone().addScaledVector(surface.forward,along).addScaledVector(surface.right,across);point.y=surface.height;return point;
  }

  safePassengerAlightPosition(train,vehicle,door){
    const doorPoint=this.doorWorldPosition(vehicle,door,1.45),outward=new THREE.Vector3(door.side,0,0).transformDirection(vehicle.matrixWorld).normalize();
    const ranked=this.doorPlatformOptions(train,vehicle,door,{maxDistance:4.2,margin:.38});
    if(!ranked.length){const fallback=doorPoint.clone();fallback.y=Math.max(0,doorPoint.y-(vehicle.userData.interior?.floorY??1.06));return fallback;}
    for(const option of ranked.slice(0,10))for(const alongOffset of[0,-1.6,1.6,-3.2,3.2,-5.0,5.0,-7.0,7.0,-9.0,9.0,-12.0,12.0]){
      const shifted=doorPoint.clone().addScaledVector(option.surface.forward,alongOffset),point=this.closestPointOnWalkSurface(option.surface,shifted,{margin:.38}).addScaledVector(outward,.18),corrected=this.closestPointOnWalkSurface(option.surface,point,{margin:.38});corrected.y=option.surface.height;
      const resolved=this.resolveWalkSurface(corrected,corrected.y);if(!resolved.blocked&&Math.abs(resolved.height-corrected.y)<.08&&resolved.surface?.role==="platform")return corrected;
    }
    const fallback=ranked[0],feet=fallback.point.clone().addScaledVector(outward,.18),corrected=this.closestPointOnWalkSurface(fallback.surface,feet,{margin:.32});corrected.y=fallback.surface.height;return corrected;
  }

  nearestBoardableTrain(position,{includeMoving=false}={}){
    let best=null,bestDistance=Infinity;
    for(const train of this.trains){
      const stopped=train.speed<.55;
      if(!includeMoving&&!stopped)continue;
      for(let i=0;i<train.formation.vehicles.length;i++){
        const vehicle=train.formation.vehicles[i];
        if(vehicle.userData.type==="mark3-coach"){
          for(const door of vehicle.userData.passengerDoors??[]){
            if(!includeMoving&&!this.isDoorOpenForTrain(train,door))continue;
            const world=this.doorWorldPosition(vehicle,door,.72),distance=world.distanceTo(position);
            if(distance<bestDistance){bestDistance=distance;best={train,vehicle,vehicleIndex:i,door,distance,stopped,access:"passenger"};}
          }
        }else{
          const distance=this.distanceToVehicleSurface(position,vehicle);
          if(distance<bestDistance){bestDistance=distance;best={train,vehicle,vehicleIndex:i,distance,stopped,access:"cab"};}
        }
      }
    }
    const threshold=best?.access==="passenger"?3.8:3.2;return bestDistance<threshold?best:null;
  }

  nearestPassengerDoor(state,{requireOpen=true}={}){
    const doors=(state.vehicle.userData.passengerDoors??[]).filter(door=>!requireOpen||this.isDoorOpenForTrain(state.train,door));
    return doors.sort((a,b)=>{
      const da=Math.hypot(a.z-state.localPosition.z,a.side*.72-state.localPosition.x),db=Math.hypot(b.z-state.localPosition.z,b.side*.72-state.localPosition.x);
      return da-db;
    })[0]??null;
  }

  updatePassengerRide(train,dt,player){
    const state=this.passengerState;if(!state||state.train!==train)return;
    const vehicle=state.vehicle,interior=vehicle.userData.interior;if(!interior)return;
    const bufferedLookDX=Number.isFinite(this.pendingPassengerLookDX)?this.pendingPassengerLookDX:0,bufferedLookDY=Number.isFinite(this.pendingPassengerLookDY)?this.pendingPassengerLookDY:0;
    // In the browser, mouse movement is buffered by the dedicated pointer-lock
    // listener and must be consumed exactly once even when a low-FPS render
    // frame executes several fixed simulation steps. Input deltas remain as a
    // fallback for non-browser tests and embedded hosts without event listeners.
    const lookDX=this.passengerPointerLookListenerInstalled?bufferedLookDX:(bufferedLookDX!==0?bufferedLookDX:(Number.isFinite(this.input.mouseDX)?this.input.mouseDX:0)),lookDY=this.passengerPointerLookListenerInstalled?bufferedLookDY:(bufferedLookDY!==0?bufferedLookDY:(Number.isFinite(this.input.mouseDY)?this.input.mouseDY:0));this.pendingPassengerLookDX=0;this.pendingPassengerLookDY=0;
    state.yaw-=lookDX*.002;state.pitch=THREE.MathUtils.clamp((state.pitch??0)-lookDY*.0018,-THREE.MathUtils.degToRad(78),THREE.MathUtils.degToRad(78));state.rideTime=(state.rideTime??0)+dt;
    const forwardInput=(this.input.isDown("KeyW")?1:0)-(this.input.isDown("KeyS")?1:0),leftInput=(this.input.isDown("KeyA")?1:0),rightInput=(this.input.isDown("KeyD")?1:0);
    const forward=new THREE.Vector2(Math.sin(state.yaw),Math.cos(state.yaw)),screenLeft=new THREE.Vector2(Math.cos(state.yaw),-Math.sin(state.yaw)),move=forward.multiplyScalar(forwardInput).add(screenLeft.multiplyScalar(leftInput-rightInput));
    if(move.lengthSq()>0)move.normalize().multiplyScalar(dt*3.2);
    const next=state.localPosition.clone();next.x+=move.x;next.z+=move.y;const requestedX=next.x,requestedZ=next.z,previousVehicleIndex=state.vehicleIndex;let interiorCollision=null;
    if(next.z>interior.halfLength||next.z<-interior.halfLength){
      const towardsFront=next.z>0,targetIndex=state.vehicleIndex+(towardsFront?-1:1),target=train.formation.vehicles[targetIndex];
      if(target?.userData.type==="mark3-coach"){
        const targetInterior=target.userData.interior;state.vehicle=target;state.vehicleIndex=targetIndex;state.localPosition.set(THREE.MathUtils.clamp(next.x,-.48,.48),targetInterior.floorY,towardsFront?-targetInterior.halfLength+.28:targetInterior.halfLength-.28);
        if(diagnostics.isEnabled())diagnostics.logEvent("player","train-coach-traversed",{trainId:train.id,fromVehicleIndex:previousVehicleIndex,toVehicleIndex:targetIndex,direction:towardsFront?"forward":"rearward"},{entityId:train.id,position:train.headPosition});
      }else{next.z=THREE.MathUtils.clamp(next.z,-interior.halfLength,interior.halfLength);interiorCollision={axis:"z",reason:"formation-end-wall",requested:requestedZ,resolved:next.z};}
    }
    if(state.vehicle===vehicle){
      next.z=THREE.MathUtils.clamp(next.z,-interior.halfLength,interior.halfLength);
      const nearVestibule=interior.doorZ.some(z=>Math.abs(next.z-z)<.9),halfWidth=nearVestibule?interior.halfWidth:.46,clampedX=THREE.MathUtils.clamp(next.x,-halfWidth,halfWidth);
      if(Math.abs(clampedX-next.x)>1e-7)interiorCollision={axis:"x",reason:nearVestibule?"vestibule-side-wall":"saloon-aisle-boundary",requested:requestedX,resolved:clampedX,halfWidth};
      next.x=clampedX;state.localPosition.copy(next);
    }
    if(interiorCollision&&diagnostics.isEnabled()){
      const profile=vehicle.userData.collisionProfile,worldPosition=vehicle.localToWorld(new THREE.Vector3(state.localPosition.x,interior.eyeY,state.localPosition.z)),door=this.nearestPassengerDoor(state),allocation=this.stationOperations.platformForTrain(train);
      const interiorSpeed=dt>0?move.length()/dt:0;
      diagnostics.recordCollision({pairKey:`player|${train.id}:${previousVehicleIndex}|train-interior`,collisionCategory:"player-inside-train-to-interior-blocker",entityA:{id:"player",type:"walking-player",position:worldPosition,controlledByPlayer:true,velocity:{x:dt>0?move.x/dt:0,y:0,z:dt>0?move.y/dt:0},speed:interiorSpeed},entityB:{id:`${train.id}:vehicle-${previousVehicleIndex}:interior`,type:"train-interior",position:vehicle.position,heading:vehicle.rotation.y,lodTier:train.renderTier,trainId:train.id,coachIndex:previousVehicleIndex},contactPoint:worldPosition,relativeImpactSpeed:interiorSpeed,appliedCorrection:{x:interiorCollision.axis==="x"?interiorCollision.resolved-interiorCollision.requested:0,y:0,z:interiorCollision.axis==="z"?interiorCollision.resolved-interiorCollision.requested:0},resolved:true,reason:interiorCollision.reason,profile:{name:`${vehicle.userData.type}-interior`,dimensions:{halfWidth:interiorCollision.halfWidth??interior.halfWidth,halfLength:interior.halfLength,floorY:interior.floorY,eyeY:interior.eyeY},exteriorProfile:profile?.id??profile?.name??vehicle.userData.type,localVertices:profile?.polygons},hitbox:{localPosition:{x:requestedX,y:interior.floorY,z:requestedZ},currentCoachIndex:previousVehicleIndex,trainDoorOpen:Boolean(train.doorsOpen),doorSide:door?.side??null,platformSide:train.platformSide??null,stationBerthState:allocation?.status??null,platformId:allocation?.id??null}});
    }
    const activeVehicle=state.vehicle,activeInterior=activeVehicle.userData.interior,vibration=Math.min(.018,train.speed*.00055),localEye=new THREE.Vector3(state.localPosition.x+Math.sin(state.rideTime*8.7)*vibration*.35,activeInterior.eyeY+Math.sin(state.rideTime*13.1)*vibration,state.localPosition.z),worldEye=activeVehicle.localToWorld(localEye.clone());this.camera.position.copy(worldEye);
    const horizontal=Math.cos(state.pitch),localLook=new THREE.Vector3(Math.sin(state.yaw)*horizontal,Math.sin(state.pitch),Math.cos(state.yaw)*horizontal),worldLook=localLook.transformDirection(activeVehicle.matrixWorld);this.camera.lookAt(worldEye.clone().add(worldLook));
    player.walkYaw=activeVehicle.rotation.y+state.yaw;player.position.copy(worldEye);player.position.y=.05;
  }

  updateInteractionPrompt(player){
    if(!this.interactionPrompt)return;
    if(player.inBus){if(this.interactionPrompt.dataset.owner==="rail"){this.interactionPrompt.hidden=true;delete this.interactionPrompt.dataset.owner;}return;}
    if(player.inTrain){
      if(this.playerTrainMode==="passenger"){
        const door=this.passengerState&&this.nearestPassengerDoor(this.passengerState),canExit=Boolean(door&&this.playerTrain?.doorsOpen&&this.playerTrain.speed<.2&&Math.abs(this.passengerState.localPosition.z-door.z)<1.2);
        this.interactionPrompt.hidden=!canExit;if(canExit){this.interactionPrompt.dataset.owner="rail";this.interactionPrompt.querySelector("span").textContent="Exit passenger carriage";}
      }
      return;
    }
    if(player.inVehicle){if(this.interactionPrompt.dataset.owner==="rail"){this.interactionPrompt.hidden=true;delete this.interactionPrompt.dataset.owner;}this.lastBoardingCandidate=null;return;}
    const candidate=this.nearestBoardableTrain(this.camera.position),movingCandidate=candidate??this.nearestBoardableTrain(this.camera.position,{includeMoving:true});this.lastBoardingCandidate=candidate;
    if(candidate){
      this.interactionPrompt.hidden=false;this.interactionPrompt.dataset.owner="rail";
      this.interactionPrompt.querySelector("span").textContent=candidate.access==="passenger"?`Board ${candidate.train.id} passenger coach`:`Enter ${candidate.train.id} Class 43 cab`;
    }else if(movingCandidate){
      this.interactionPrompt.hidden=false;this.interactionPrompt.dataset.owner="rail";this.interactionPrompt.querySelector("span").textContent=movingCandidate.access==="passenger"?"Wait for the passenger doors to open":"Wait for the HST to stop";
    }else if(this.interactionPrompt.dataset.owner==="rail"){this.interactionPrompt.hidden=true;delete this.interactionPrompt.dataset.owner;}
  }

  handleInteract(player){
    if(player.inBus)return false;
    if(player.inTrain){
      const train=this.playerTrain;if(!train)return false;
      if(this.playerTrainMode==="passenger"){
        const state=this.passengerState,door=state&&this.nearestPassengerDoor(state);
        if(train.speed>.2||!train.doorsOpen){this.toast("Passenger doors are locked while the train is moving");return true;}
        if(!door||Math.abs(state.localPosition.z-door.z)>1.35){this.toast("Move to an open passenger doorway before leaving");return true;}
        const feet=this.safePassengerAlightPosition(train,state.vehicle,door),yaw=state.vehicle.rotation.y+(door.side>0?Math.PI*.5:-Math.PI*.5);
        if(player.releaseToWalking)player.releaseToWalking(feet,yaw,{collisionGrace:.45});
        else{this.camera.position.set(feet.x,feet.y+1.72,feet.z);player.walkYaw=yaw;player.inTrain=false;player.inVehicle=false;}
        if(diagnostics.isEnabled())diagnostics.logEvent("player","left-train",{trainId:train.id,mode:"passenger",vehicleIndex:state.vehicleIndex,doorSide:door.side,platformSide:train.platformSide,stationId:train.currentStation?.id??null},{entityId:train.id,position:feet});
        this.playerTrain=null;this.playerTrainMode=null;this.passengerState=null;this.pendingPassengerLookDX=0;this.pendingPassengerLookDY=0;
        if(this.interactionPrompt){this.interactionPrompt.hidden=true;delete this.interactionPrompt.dataset.owner;}this.toast(`Alighted from ${train.id}`);return true;
      }
      if(train.speed>.75){this.toast("Stop the HST before leaving the cab");return true;}
      const station=this.stationForTrain(train,18);if(!station?.entryPosition){this.toast("Stop alongside a station platform before leaving the cab");return true;}
      const feet=(station.exitPosition??station.entryPosition).clone(),yaw=train.heading+Math.PI*.5;
      if(player.releaseToWalking)player.releaseToWalking(feet,yaw,{collisionGrace:.25});
      else{this.camera.position.set(feet.x,feet.y+1.72,feet.z);player.walkYaw=yaw;player.inTrain=false;player.inVehicle=false;}
      if(diagnostics.isEnabled())diagnostics.logEvent("player","left-train-cab",{trainId:train.id,stationId:station.id??station.name},{entityId:train.id,position:feet});
      train.manual=false;train.dwell=Math.max(train.dwell,3);train.currentStation=station;this.playerTrain=null;this.playerTrainMode=null;
      if(this.interactionPrompt){this.interactionPrompt.hidden=true;delete this.interactionPrompt.dataset.owner;}this.toast(`Exited at ${station.name}`);return true;
    }
    if(player.inVehicle)return false;
    const near=this.nearestBoardableTrain(this.camera.position);
    if(!near){const moving=this.nearestBoardableTrain(this.camera.position,{includeMoving:true});if(moving){this.toast(moving.access==="passenger"?"Wait for the passenger doors to open":"Wait until the HST has stopped before boarding");return true;}return false;}
    this.playerTrain=near.train;player.inTrain=true;player.inBus=false;player.inVehicle=false;
    if(near.access==="passenger"){
      const interior=near.vehicle.userData.interior;this.playerTrainMode="passenger";this.pendingPassengerLookDX=0;this.pendingPassengerLookDY=0;this.passengerState={train:near.train,vehicle:near.vehicle,vehicleIndex:near.vehicleIndex,localPosition:new THREE.Vector3(near.door.side*.72,interior.floorY,near.door.z),yaw:near.door.side>0?-Math.PI*.5:Math.PI*.5,pitch:0,rideTime:0};
      if(diagnostics.isEnabled())diagnostics.logEvent("player","entered-train",{trainId:near.train.id,mode:"passenger",vehicleIndex:near.vehicleIndex,doorSide:near.door.side,platformSide:near.train.platformSide,stationId:near.train.currentStation?.id??null},{entityId:near.train.id,position:near.vehicle.position});
      this.toast(`Boarded ${near.train.id} passenger carriage`);
    }else{
      this.playerTrainMode="driver";near.train.manual=true;near.train.dwell=0;near.train.currentStation=null;near.train.speed=0;near.train.throttle=0;near.train.brake=0;this.trainCameraIndex=0;if(diagnostics.isEnabled())diagnostics.logEvent("player","entered-train-cab",{trainId:near.train.id,vehicleIndex:near.vehicleIndex},{entityId:near.train.id,position:near.vehicle.position});this.toast(`Driving ${near.train.id} · Class 43 HST`);
    }
    if(this.interactionPrompt){this.interactionPrompt.hidden=true;delete this.interactionPrompt.dataset.owner;}return true;
  }

  updateTrainCamera(train,dt){
    const route=this.routeForTrain(train),forward=trackTangent(route,train.progress,train.direction),right=new THREE.Vector3(forward.z,0,-forward.x),head=train.headPosition;let desired,look;
    switch(this.cameraModes[this.trainCameraIndex]){
      case"CHASE":desired=head.clone().addScaledVector(forward,-32).add(new THREE.Vector3(0,10,0));look=head.clone().addScaledVector(forward,30).add(new THREE.Vector3(0,2,0));break;
      case"SIDE":desired=head.clone().addScaledVector(right,25).addScaledVector(forward,-10).add(new THREE.Vector3(0,7,0));look=head.clone().addScaledVector(forward,-15).add(new THREE.Vector3(0,2,0));break;
      case"TOP-DOWN":desired=head.clone().add(new THREE.Vector3(0,105,0));look=head;break;
      default:desired=head.clone().addScaledVector(forward,4.7).add(new THREE.Vector3(0,3.05,0));look=head.clone().addScaledVector(forward,75).add(new THREE.Vector3(0,2.6,0));
    }
    this.camera.position.lerp(desired,1-Math.exp(-dt*5));this.camera.lookAt(look);
  }

  wantsPointerLock(){return this.playerTrainMode==="passenger"&&Boolean(this.passengerState);}

  getPlayerFocus(){return this.playerTrain?{position:this.playerTrain.headPosition,heading:this.playerTrain.heading,speed:this.playerTrain.speed}:null;}

  getOperationsDiagnostics(){return this.dispatcher?.diagnostics()??{occupiedBlocks:0,reservedBlocks:0,trainsWaitingAtSignals:0,activeJunctionRoutes:0,occupiedPlatforms:0,averageDelaySeconds:0,mostDelayedService:"—",dispatcherUpdateMs:0,deadlockRecoveryCount:0};}
  getPlayerState(){
    const train=this.playerTrain;if(!train)return null;
    const allocation=this.stationOperations.platformForTrain(train),signal=train.nextSignal;return{id:train.id,serviceId:train.service?.serviceId??train.id,serviceName:train.service?.displayName??"Railway service",route:train.route?.name??"Railway",speed:train.speed,nextStation:train.nextStation?.name??"—",mode:this.playerTrainMode==="passenger"?"PASSENGER":this.cameraModes[this.trainCameraIndex],designLimit:train.designLimit,permittedSpeed:train.permittedSpeed??train.designLimit,signalAspect:train.signalAspect??"red",distanceToSignal:signal?.distance??Infinity,allocatedPlatform:allocation?.platformNumber??"—",routeSet:Boolean(train.junctionRouteSet||!train.waitingForJunction),spadWarning:Boolean(train.spadWarning),doorsOpen:train.doorsOpen,passenger:this.playerTrainMode==="passenger"};
  }
}
