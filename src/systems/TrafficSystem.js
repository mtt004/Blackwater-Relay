import * as THREE from "three";
import { CONFIG,mulberry32 } from "../config.js?v=20261002-flight-sim-terrain";
import { qualityManager } from "../core/QualityManager.js?v=20261002-flight-sim-terrain";
import { createVehicleMesh,createVehicleLowMesh,animateVehicleMesh,setHeadlightState,getVehicleDimensions } from "../vehicles/VehicleFactory.js?v=20261002-flight-sim-terrain";
import { diagnostics } from "../core/DiagnosticsManager.js?v=20261002-flight-sim-terrain";

const profiles={
  cautious:{speed:.86,follow:17,accel:2.0,brake:5.8,reaction:.92,laneGap:1.24,laneCooldown:7.5,overtakeBias:.32},
  normal:{speed:1,follow:13,accel:2.7,brake:6.6,reaction:.68,laneGap:1,laneCooldown:5.4,overtakeBias:.62},
  impatient:{speed:1.10,follow:9.5,accel:3.25,brake:7.2,reaction:.48,laneGap:.88,laneCooldown:3.7,overtakeBias:.86},
  professional:{speed:.96,follow:14,accel:2.35,brake:6.8,reaction:.55,laneGap:1.12,laneCooldown:6.2,overtakeBias:.46},
  aggressive:{speed:1.16,follow:8,accel:3.55,brake:7.7,reaction:.38,laneGap:.78,laneCooldown:3.1,overtakeBias:.94}
};
const EMPTY_LIST=[];
const writeOutlineEdge=(buffer,cursor,ax,ay,az,bx,by,bz)=>{
  buffer[cursor]=ax;buffer[cursor+1]=ay;buffer[cursor+2]=az;
  buffer[cursor+3]=bx;buffer[cursor+4]=by;buffer[cursor+5]=bz;
  return cursor+6;
};

export class TrafficSystem{
  constructor(scene,graph,signals,player){
    this.scene=scene;this.graph=graph;this.signals=signals;this.player=player;this.chunkManager=null;
    this.vehicles=[];this.random=mulberry32(CONFIG.seed+99);this.nextId=1;this.averageSpeed=0;this.distantDemand=CONFIG.distantDemandBase;
    this.weatherFactor=1;this.incidentSystem=null;this.railSystem=null;this.night=false;
    this.activeLaneChanges=0;this.completedLaneChanges=0;this.laneChangeRejections=0;this.updateCycle=0;
    this._laneOccupancy=new Map();this._junctionOccupancy=new Map();this._roundaboutReservations=new Map();
    this._entryPoint=new THREE.Vector3();this.createFarOutlineProxy();
  }

  createFarOutlineProxy(){
    const maxVehicles=160,maxVertices=maxVehicles*24;
    this.farOutlinePositions=new Float32Array(maxVertices*3);
    const geometry=new THREE.BufferGeometry();geometry.setAttribute("position",new THREE.BufferAttribute(this.farOutlinePositions,3));geometry.setDrawRange(0,0);
    this.farOutline=new THREE.LineSegments(geometry,new THREE.LineBasicMaterial({color:0x87979f,transparent:true,opacity:.24,depthWrite:false,depthTest:true,fog:true}));
    this.farOutline.frustumCulled=false;this.scene.add(this.farOutline);
  }

  setChunkManager(manager){this.chunkManager=manager;}
  setIncidentSystem(system){this.incidentSystem=system;}
  setRailSystem(system){this.railSystem=system;}

  populate(target=CONFIG.detailedTrafficTarget){let tries=0;while(this.vehicles.length<target&&tries++<target*18)this.spawnRandom();}
  randomNode(exclude){const nodes=[...this.graph.nodes.values()].filter(n=>n.id!==exclude);return nodes[Math.floor(this.random()*nodes.length)];}
  randomKind(){const r=this.random();if(r<.042)return"lorry";if(r<.12)return"van";if(r<.21)return"suv";if(r<.29)return"hatchback";if(r<.35)return"taxi";if(r<.395)return"sports";return"car";}

  canSpawn(lane,progress,length=5){
    for(const v of this.vehicles){if(v.laneId!==lane.id)continue;const gap=Math.abs(v.progress-progress)*lane.length;if(gap<(v.mesh.userData.length+length)*.5+15)return false;}return true;
  }

  spawnRandom(kind){
    const nodes=[...this.graph.nodes.values()],start=nodes[Math.floor(this.random()*nodes.length)],end=this.randomNode(start.id),route=this.graph.route(start.id,end.id);if(route.length<2)return null;
    kind=kind??this.randomKind();
    const baseLane=this.graph.findLane(route[0],route[1],0);if(!baseLane)return null;
    const outer=this.graph.outermostLaneIndex(baseLane);
    // Most traffic enters in the left/outer lane. A minority starts in an inner lane so the
    // overtaking model has plausible traffic to resolve rather than a perfectly uniform stream.
    const preferredIndex=this.random()<.82?outer:Math.floor(this.random()*(outer+1));
    const lane=this.graph.findLane(route[0],route[1],preferredIndex)??baseLane;
    const progress=.05+this.random()*.64,p=lane.curve.getPointAt(progress);if(this.player?.position&&p.distanceTo(this.player.position)<90)return null;
    const length=getVehicleDimensions(kind).length;if(!this.canSpawn(lane,progress,length))return null;
    const profileName=kind==="bus"||kind==="lorry"||kind==="taxi"||kind==="van"?"professional":["cautious","normal","normal","impatient","aggressive"][Math.floor(this.random()*5)];
    return this.addVehicle({kind,route,lane,progress,profileName});
  }

  addVehicle({kind="car",route,lane,progress=0,profileName="normal",serviceNodes=null}){
    const mesh=createVehicleMesh(kind,Math.floor(this.random()*10));setHeadlightState(mesh,this.night);this.scene.add(mesh);
    const lowMesh=createVehicleLowMesh(kind,mesh.userData.bodyColor);lowMesh.visible=false;this.scene.add(lowMesh);
    const numericId=this.nextId++,vehicle={id:`veh-${String(numericId).padStart(5,"0")}`,kind,mesh,lowMesh,renderTier:"outline",route,routeIndex:0,laneId:lane.id,progress,speed:0,connector:null,laneChange:null,laneChangeCooldown:1.5+this.random()*3.5,laneDecisionTimer:this.random()*.55,profileName,profile:{...(profiles[profileName]??profiles.normal)},dwell:0,dwellReason:null,serviceNodes,serviceStopIndex:0,onNodeReached:null,onBusStop:null,stopTargets:new Map(),stopCooldownLaneId:null,completedTrips:0,stuckTime:0,lastSteer:0,collisionOffset:new THREE.Vector3(),behaviourPhase:numericId&3,_position:new THREE.Vector3(),_tangent:new THREE.Vector3(),_fromPoint:new THREE.Vector3(),_toPoint:new THREE.Vector3(),_fromTangent:new THREE.Vector3(),_toTangent:new THREE.Vector3(),_leadInfoA:{ahead:null,behind:null,aheadGap:Infinity,behindGap:Infinity},_leadInfoB:{ahead:null,behind:null,aheadGap:Infinity,behindGap:Infinity},_roundaboutPoint:new THREE.Vector3()};
    this.vehicles.push(vehicle);this.place(vehicle);this.updateVehicleVisibility(vehicle);if(diagnostics.isEnabled())diagnostics.logEvent("traffic","vehicle-spawned",{id:vehicle.id,kind,profileName,laneId:lane.id,route},{entityId:vehicle.id,position:vehicle.mesh.position});return vehicle;
  }

  spawnEmergency(startNode,endNode){const route=this.graph.route(startNode,endNode);if(route.length<2)return null;const lane=this.graph.findLane(route[0],route[1]);if(!lane)return null;return this.addVehicle({kind:"emergency",route,lane,profileName:"aggressive"});}
  reroute(vehicle,fromNode){
    const previousRoute=diagnostics.isEnabled()?(vehicle.route?.join(">")??""):null,end=this.randomNode(fromNode),route=this.graph.route(fromNode,end.id);if(route.length<2)return false;vehicle.route=route;vehicle.routeIndex=0;vehicle.completedTrips++;
    const base=this.graph.findLane(route[0],route[1],0);if(!base)return false;const lane=this.graph.findLane(route[0],route[1],this.graph.outermostLaneIndex(base))??base;
    if(vehicle.laneChange)this.activeLaneChanges=Math.max(0,this.activeLaneChanges-1);
    vehicle.laneId=lane.id;vehicle.progress=0;vehicle.connector=null;vehicle.laneChange=null;vehicle.mesh.userData.indicatorDirection=0;vehicle.stopCooldownLaneId=null;if(diagnostics.isEnabled())diagnostics.logEvent("traffic","vehicle-rerouted",{id:vehicle.id,fromNode,fromRoute:previousRoute,toRoute:route,laneId:lane.id,completedTrips:vehicle.completedTrips},{entityId:vehicle.id,position:vehicle.mesh.position});return true;
  }

  resetBucketMap(map){for(const list of map.values())list.length=0;}
  bucketPush(map,key,value){let list=map.get(key);if(!list){list=[];map.set(key,list);}list.push(value);}
  buildLaneOccupancy(){
    const map=this._laneOccupancy;this.resetBucketMap(map);
    for(const vehicle of this.vehicles){
      if(vehicle.connector)continue;
      if(vehicle.laneId)this.bucketPush(map,vehicle.laneId,vehicle);
      if(vehicle.laneChange?.toLaneId&&vehicle.laneChange.toLaneId!==vehicle.laneId)this.bucketPush(map,vehicle.laneChange.toLaneId,vehicle);
    }
    for(const list of map.values())if(list.length>1)list.sort((a,b)=>a.progress-b.progress);
    return map;
  }
  buildJunctionOccupancy(){
    const map=this._junctionOccupancy;this.resetBucketMap(map);
    for(const vehicle of this.vehicles)if(vehicle.connector)this.bucketPush(map,vehicle.connector.nodeId,vehicle);
    return map;
  }

  laneNeighbours(occupancy,laneId,vehicle,target=vehicle._leadInfoA){
    const lane=this.graph.lanes.get(laneId),list=occupancy.get(laneId);let ahead=null,behind=null,aheadGap=Infinity,behindGap=Infinity;
    if(lane&&list){const ownLength=vehicle.mesh.userData.length??4.5;for(const other of list){if(other===vehicle)continue;const otherLength=other.mesh.userData.length??4.5,delta=other.progress-vehicle.progress;if(delta>0){const gap=delta*lane.length-(ownLength+otherLength)*.5;if(gap<aheadGap){ahead=other;aheadGap=gap;}}else{const gap=-delta*lane.length-(ownLength+otherLength)*.5;if(gap<behindGap){behind=other;behindGap=gap;}}}}
    target.ahead=ahead;target.behind=behind;target.aheadGap=aheadGap;target.behindGap=behindGap;return target;
  }

  playerGapOnLane(laneId,vehicle){
    if(!this.player?.inVehicle||this.player.nearestLaneId!==laneId)return null;
    const lane=this.graph.lanes.get(laneId);if(!lane)return null;
    const delta=(this.player.nearestLaneT??0)-vehicle.progress;
    const gap=Math.abs(delta)*lane.length-((vehicle.mesh.userData.length??4.5)+(this.player.vehicle.userData.length??4.5))*.5;
    return{ahead:delta>0,gap,speed:Math.max(0,this.player.speed)};
  }

  upcomingOutgoingLane(vehicle,lane,index=0){
    const nextRouteIndex=vehicle.routeIndex+1;if(nextRouteIndex>=vehicle.route.length-1)return null;
    return this.graph.findLane(vehicle.route[nextRouteIndex],vehicle.route[nextRouteIndex+1],index);
  }

  preferredApproachIndex(vehicle,lane){
    const outer=this.graph.outermostLaneIndex(lane),outgoing=this.upcomingOutgoingLane(vehicle,lane,0);
    if(!outgoing)return outer;
    return this.graph.preferredApproachLaneIndex(lane.id,outgoing.id);
  }

  laneChangeSafe(vehicle,targetLane,occupancy){
    if(!targetLane||targetLane.closed||targetLane.roadId!==this.graph.lanes.get(vehicle.laneId)?.roadId||targetLane.direction!==this.graph.lanes.get(vehicle.laneId)?.direction)return false;
    const nearby=this.laneNeighbours(occupancy,targetLane.id,vehicle),profile=vehicle.profile,gapScale=profile.laneGap??1;
    const minAhead=(11+vehicle.speed*.95+(vehicle.mesh.userData.length??4.5)*.45)*gapScale;
    const behindSpeed=nearby.behind?.speed??0;
    const minBehind=(9+behindSpeed*.72+Math.max(0,behindSpeed-vehicle.speed)*1.9)*gapScale;
    if(nearby.aheadGap<minAhead||nearby.behindGap<minBehind)return false;
    const player=this.playerGapOnLane(targetLane.id,vehicle);
    if(player){const minimum=player.ahead?minAhead:minBehind;if(player.gap<minimum)return false;}
    return true;
  }

  startLaneChange(vehicle,targetLane,reason,duration){
    const fromLane=this.graph.lanes.get(vehicle.laneId);if(!fromLane||!targetLane)return false;
    const direction=targetLane.index<fromLane.index?1:-1; // +1 right, -1 left in vehicle coordinates
    vehicle.laneChange={fromLaneId:fromLane.id,toLaneId:targetLane.id,elapsed:0,duration,reason,direction};
    vehicle.laneChangeCooldown=reason==="route"?1.15+this.random()*.55:(vehicle.profile.laneCooldown??5)+this.random()*1.8;
    vehicle.mesh.userData.indicatorDirection=direction;this.activeLaneChanges++;if(diagnostics.isEnabled())diagnostics.logEvent("traffic","lane-change-started",{id:vehicle.id,fromLaneId:fromLane.id,toLaneId:targetLane.id,reason,duration},{entityId:vehicle.id,position:vehicle.mesh.position});return true;
  }

  completeLaneChange(vehicle){
    const state=vehicle.laneChange;if(!state)return;
    vehicle.laneId=state.toLaneId;vehicle.laneChange=null;vehicle.mesh.userData.indicatorDirection=0;
    this.activeLaneChanges=Math.max(0,this.activeLaneChanges-1);this.completedLaneChanges++;if(diagnostics.isEnabled())diagnostics.logEvent("traffic","lane-change-completed",{id:vehicle.id,fromLaneId:state.fromLaneId,toLaneId:state.toLaneId,reason:state.reason,duration:state.duration},{entityId:vehicle.id,position:vehicle.mesh.position});
  }

  cancelLaneChange(vehicle){
    if(!vehicle.laneChange)return;vehicle.laneChange=null;vehicle.mesh.userData.indicatorDirection=0;
    vehicle.laneChangeCooldown=Math.max(vehicle.laneChangeCooldown,2.5);this.activeLaneChanges=Math.max(0,this.activeLaneChanges-1);
  }

  considerLaneChange(vehicle,lane,occupancy,leadInfo){
    if(vehicle.laneChange||vehicle.connector||vehicle.dwell>0||vehicle.laneChangeCooldown>0)return false;
    const road=this.graph.roads.get(lane.roadId);if(!road||road.lanesEachWay<2||lane.closed)return false;
    if(vehicle.kind==="bus"||vehicle.kind==="emergency")return false;
    const remaining=(1-vehicle.progress)*lane.length,outer=this.graph.outermostLaneIndex(lane);
    const duration=THREE.MathUtils.clamp(2.75+vehicle.speed*.045+(vehicle.kind==="lorry"?.55:0),2.8,4.65);
    if(remaining<vehicle.speed*duration+24||vehicle.progress*lane.length<20)return false;

    const preferred=this.preferredApproachIndex(vehicle,lane);
    const routePrepareDistance=THREE.MathUtils.clamp(105+vehicle.speed*5.2,115,235);
    let targetIndex=null,reason=null;
    if(remaining<routePrepareDistance&&lane.index!==preferred){targetIndex=lane.index+Math.sign(preferred-lane.index);reason="route";}

    if(targetIndex===null&&vehicle.kind!=="lorry"){
      const desired=(lane.speedLimit/3.6)*vehicle.profile.speed*this.weatherFactor;
      const constrained=leadInfo.ahead&&leadInfo.aheadGap<Math.max(38,vehicle.speed*2.5)&&leadInfo.ahead.speed<desired-1.1;
      if(constrained&&lane.index>0&&this.random()<(vehicle.profile.overtakeBias??.6)){targetIndex=lane.index-1;reason="overtake";}
      else if(lane.index<outer){
        const rightTurnSoon=preferred===0&&remaining<routePrepareDistance*1.35;
        if(!rightTurnSoon&&(!leadInfo.ahead||leadInfo.aheadGap>Math.max(24,vehicle.speed*1.4))){targetIndex=lane.index+1;reason="keep-left";}
      }
    }

    if(targetIndex===null||targetIndex<0||targetIndex>outer)return false;
    const targetLane=this.graph.lanes.get(`${lane.roadId}:${lane.direction}:${targetIndex}`);
    if(!this.laneChangeSafe(vehicle,targetLane,occupancy)){this.laneChangeRejections++;return false;}
    const started=this.startLaneChange(vehicle,targetLane,reason,duration);
    if(started){
      if(!occupancy.has(targetLane.id))occupancy.set(targetLane.id,[]);
      const targetList=occupancy.get(targetLane.id);if(!targetList.includes(vehicle)){targetList.push(vehicle);targetList.sort((a,b)=>a.progress-b.progress);}
    }
    return started;
  }

  laneChangeSteer(vehicle){
    const state=vehicle.laneChange;if(!state)return 0;
    const p=THREE.MathUtils.clamp(state.elapsed/state.duration,0,1);
    return state.direction*Math.sin(p*Math.PI*2)*.38;
  }

  connectorSteer(connector,t,vehicle){const a=connector.curve.getTangentAt(Math.max(0,t-.018),vehicle._fromTangent),b=connector.curve.getTangentAt(Math.min(1,t+.018),vehicle._toTangent),cross=a.z*b.x-a.x*b.z,dot=THREE.MathUtils.clamp(a.dot(b),-1,1);return THREE.MathUtils.clamp(Math.atan2(cross,dot)*4.4,-1,1);}
  updateConnector(vehicle,dt,time){
    const connector=vehicle.connector,profile=vehicle.profile;let target=connector.speedLimit/3.6*profile.speed*this.weatherFactor;
    if(vehicle.kind==="bus"||vehicle.kind==="lorry")target*=.84;if(vehicle.kind==="emergency")target*=1.18;
    if(vehicle.speed<target)vehicle.speed=Math.min(target,vehicle.speed+profile.accel*dt);else vehicle.speed=Math.max(target,vehicle.speed-profile.brake*dt);
    connector.progress+=(vehicle.speed*dt)/Math.max(1,connector.length);vehicle.lastSteer=THREE.MathUtils.lerp(vehicle.lastSteer,this.connectorSteer(connector,Math.min(.99,connector.progress),vehicle),1-Math.exp(-dt*6));
    if(connector.progress>=1)this.finishConnector(vehicle);this.place(vehicle);this.updateVehicleVisibility(vehicle);if(vehicle.mesh.visible)animateVehicleMesh(vehicle.mesh,vehicle.speed,vehicle.lastSteer,dt,time);
  }
  finishConnector(vehicle){const state=vehicle.connector;if(!state)return;vehicle.laneId=state.outLaneId;vehicle.routeIndex=state.nextRouteIndex;vehicle.progress=0;vehicle.connector=null;vehicle.mesh.userData.indicatorDirection=0;vehicle.stopCooldownLaneId=null;}

  curvatureSteer(lane,t,vehicle){const t2=Math.min(.999,t+.025),a=lane.curve.getTangentAt(t,vehicle._fromTangent),b=lane.curve.getTangentAt(t2,vehicle._toTangent),cross=a.z*b.x-a.x*b.z,dot=THREE.MathUtils.clamp(a.dot(b),-1,1);return THREE.MathUtils.clamp(Math.atan2(cross,dot)*5.2,-1,1);}
  updateVehicleVisibility(vehicle){
    const tier=vehicle.playerOccupied?"full":this.chunkManager?this.chunkManager.renderTierForPosition(vehicle.mesh.position,this.player?.position):"full";
    vehicle.renderTier=tier;vehicle.mesh.visible=tier==="full";vehicle.lowMesh.visible=tier==="low";
    const playerPosition=this.player?.position,shadowDistance=qualityManager.current.traffic.shadowDistance,nearEnough=!playerPosition||vehicle.mesh.position.distanceToSquared(playerPosition)<shadowDistance*shadowDistance;
    const castsShadow=tier==="full"&&(vehicle.playerOccupied||nearEnough);
    if(vehicle.mesh.userData.shadowState!==castsShadow){vehicle.mesh.userData.shadowState=castsShadow;for(const mesh of vehicle.mesh.userData.shadowCasters??[])mesh.castShadow=castsShadow;}
  }

  upcomingBusStop(vehicle,lane){
    if(vehicle.kind!=="bus"||!vehicle.stopTargets?.size)return null;
    const stop=vehicle.stopTargets.get(lane.id);if(!stop||vehicle.stopCooldownLaneId===lane.id)return null;
    if(stop.progress<vehicle.progress-.015){vehicle.stopCooldownLaneId=lane.id;return null;}
    return stop;
  }

  beginBusStop(vehicle,stop){
    if(vehicle.dwell>0)return;
    vehicle.progress=stop.progress;vehicle.speed=0;vehicle.stopCooldownLaneId=vehicle.laneId;
    vehicle.dwellReason="bus-stop";vehicle.mesh.userData.doorsOpen=true;if(diagnostics.isEnabled())diagnostics.logEvent("bus","bus-stop-arrival",{id:vehicle.id,line:vehicle.line,stopKey:stop.key,laneId:stop.laneId,waiting:stop.waiting},{entityId:vehicle.id,position:vehicle.mesh.position});
    const requested=vehicle.onBusStop?.(vehicle,stop);
    vehicle.dwell=Math.max(3.2,Number.isFinite(requested)?requested:4.2);
  }

  update(dt,time){
    this.updateCycle++;const occupancy=this.buildLaneOccupancy(),junctionOccupancy=this.buildJunctionOccupancy(),roundaboutReservations=this._roundaboutReservations;this.resetBucketMap(roundaboutReservations);let sum=0,moving=0;
    for(const vehicle of this.vehicles){
      vehicle.laneChangeCooldown=Math.max(0,(vehicle.laneChangeCooldown??0)-dt);
      vehicle.laneDecisionTimer=(vehicle.laneDecisionTimer??0)-dt;
      if(vehicle.dwell>0){
        vehicle.dwell-=dt;vehicle.speed=Math.max(0,vehicle.speed-dt*7);
        if(vehicle.dwell<=0){vehicle.dwell=0;vehicle.dwellReason=null;vehicle.mesh.userData.doorsOpen=false;}
        this.updateVehicleVisibility(vehicle);if(vehicle.mesh.visible)animateVehicleMesh(vehicle.mesh,vehicle.speed,0,dt,time);continue;
      }
      if(vehicle.connector){this.updateConnector(vehicle,dt,time);sum+=vehicle.speed;if(vehicle.speed>.2)moving++;continue;}
      const lane=this.graph.lanes.get(vehicle.laneId);if(!lane)continue;
      if(vehicle.laneChange&&this.graph.lanes.get(vehicle.laneChange.toLaneId)?.closed)this.cancelLaneChange(vehicle);
      if(vehicle.collisionOffset)vehicle.collisionOffset.multiplyScalar(Math.exp(-dt*3.2));
      if(vehicle.kind==="emergency"&&this.graph.nodes.get(lane.to)?.signal&&1-vehicle.progress<.2)this.signals.requestPriority(lane.to,lane.id,4.5);
      const profile=vehicle.profile;let target=(lane.speedLimit/3.6)*profile.speed*this.weatherFactor;
      if(vehicle.kind==="bus"||vehicle.kind==="lorry")target*=.88;if(vehicle.kind==="emergency")target*=1.22;

      const busStop=this.upcomingBusStop(vehicle,lane);
      if(busStop){
        const stopDistance=(busStop.progress-vehicle.progress)*lane.length;
        if(stopDistance<95&&stopDistance>=-.8){
          const comfortableBrake=Math.max(2.1,Math.min(4.2,profile.brake*.58));
          const stopSpeed=Math.sqrt(Math.max(0,2*comfortableBrake*Math.max(0,stopDistance-.28)));
          target=Math.min(target,stopSpeed);
          if(stopDistance<.48&&vehicle.speed<1.05)this.beginBusStop(vehicle,busStop);
        }
      }

      if(this.railSystem)target=this.railSystem.adjustRoadVehicleTarget(vehicle,lane,target);

      const remaining=(1-vehicle.progress)*lane.length,nearDecisionPoint=remaining<95||vehicle.kind==="bus"||vehicle.kind==="emergency"||Boolean(vehicle.laneChange);
      const behaviourDue=vehicle.renderTier==="full"||nearDecisionPoint?true:vehicle.renderTier==="low"?((this.updateCycle+vehicle.behaviourPhase)&1)===0:((this.updateCycle+vehicle.behaviourPhase)&3)===0;
      let leadInfo=vehicle._leadInfoA;
      if(behaviourDue)leadInfo=this.laneNeighbours(occupancy,lane.id,vehicle,vehicle._leadInfoA);
      if(leadInfo.ahead){
        const safe=profile.follow+vehicle.speed*profile.reaction;
        if(leadInfo.aheadGap<safe)target=Math.max(0,leadInfo.ahead.speed-(safe-leadInfo.aheadGap)*.42);
        if(leadInfo.aheadGap<2.5)vehicle.speed=Math.min(vehicle.speed,leadInfo.ahead.speed);
      }
      if(vehicle.laneChange){
        const targetLead=this.laneNeighbours(occupancy,vehicle.laneChange.toLaneId,vehicle,vehicle._leadInfoB);
        if(targetLead.ahead){
          const safe=(profile.follow+vehicle.speed*profile.reaction)*.92;
          if(targetLead.aheadGap<safe)target=Math.min(target,Math.max(0,targetLead.ahead.speed-(safe-targetLead.aheadGap)*.46));
        }
      }

      if(this.player?.inVehicle){
        for(const relevantLane of [lane.id,vehicle.laneChange?.toLaneId]){
          if(!relevantLane||this.player.nearestLaneId!==relevantLane)continue;
          const playerProgress=this.player.nearestLaneT??0;
          if(playerProgress>vehicle.progress){
            const laneForGap=this.graph.lanes.get(relevantLane)??lane;
            const gap=(playerProgress-vehicle.progress)*laneForGap.length-(vehicle.mesh.userData.length+this.player.vehicle.userData.length)*.5;
            if(gap<28)target=Math.min(target,Math.max(0,this.player.speed-(28-gap)*.48));
          }
        }
      }

      if(vehicle.laneDecisionTimer<=0&&behaviourDue){this.considerLaneChange(vehicle,lane,occupancy,leadInfo);const tierDelay=vehicle.renderTier==="full"?1:vehicle.renderTier==="low"?1.8:3.2;vehicle.laneDecisionTimer=(.32+this.random()*.46)*tierDelay;}

      const state=this.signals.stateForLane(lane),brakingDistance=vehicle.speed*vehicle.speed/(2*Math.max(1,profile.brake));
      const targetNode=this.graph.nodes.get(lane.to),circulating=junctionOccupancy.get(lane.to)??EMPTY_LIST;
      if(targetNode?.control==="roundabout"){
        const entryWindow=remaining<Math.max(14,brakingDistance+6),entryPoint=lane.curve.getPointAt(1,this._entryPoint),criticalGap=16+Math.min(10,vehicle.speed*.75);
        let circulatingConflict=false,reservationConflict=false;
        const criticalGapSq=criticalGap*criticalGap;
        for(let index=0;index<circulating.length;index++)if(circulating[index].mesh.position.distanceToSquared(entryPoint)<criticalGapSq){circulatingConflict=true;break;}
        const reservations=roundaboutReservations.get(lane.to);
        if(reservations)for(let index=0;index<reservations.length;index++)if(reservations[index].distanceToSquared(entryPoint)<400){reservationConflict=true;break;}
        if(entryWindow&&(circulatingConflict||reservationConflict))target=0;
        else if(entryWindow){vehicle._roundaboutPoint.copy(entryPoint);this.bucketPush(roundaboutReservations,lane.to,vehicle._roundaboutPoint);}
      }
      if(state!=="green"&&remaining<Math.max(11,brakingDistance+5))target=state==="amber"&&remaining<4.2?target:0;
      if(lane.closed&&remaining>8)target=0;
      if(vehicle.dwell>0){this.place(vehicle);this.updateVehicleVisibility(vehicle);if(vehicle.mesh.visible)animateVehicleMesh(vehicle.mesh,0,vehicle.lastSteer,dt,time);continue;}

      if(vehicle.speed<target)vehicle.speed=Math.min(target,vehicle.speed+profile.accel*dt);else vehicle.speed=Math.max(target,vehicle.speed-profile.brake*dt);
      const previousProgress=vehicle.progress;
      vehicle.progress+=(vehicle.speed*dt)/lane.length;
      if(vehicle.laneChange){
        vehicle.laneChange.elapsed+=dt;
        if(vehicle.laneChange.elapsed>=vehicle.laneChange.duration)this.completeLaneChange(vehicle);
      }
      if(busStop&&previousProgress<=busStop.progress&&vehicle.progress>=busStop.progress)this.beginBusStop(vehicle,busStop);
      if(vehicle.progress>=1){const transitionLane=this.graph.lanes.get(vehicle.laneId)??lane;this.advance(vehicle,transitionLane);}
      this.place(vehicle);
      const currentLane=this.graph.lanes.get(vehicle.laneId)??lane;
      const curveSteer=vehicle.renderTier==="outline"&&!nearDecisionPoint?vehicle.lastSteer:this.curvatureSteer(currentLane,Math.min(.98,vehicle.progress),vehicle),changeSteer=this.laneChangeSteer(vehicle);
      vehicle.lastSteer=THREE.MathUtils.lerp(vehicle.lastSteer,THREE.MathUtils.clamp(curveSteer+changeSteer,-1,1),1-Math.exp(-dt*6));
      this.updateVehicleVisibility(vehicle);if(vehicle.mesh.visible)animateVehicleMesh(vehicle.mesh,vehicle.speed,vehicle.lastSteer,dt,time);
      sum+=vehicle.speed;if(vehicle.speed>.2)moving++;vehicle.stuckTime=vehicle.speed<.15?vehicle.stuckTime+dt:0;
      if(vehicle.stuckTime>30&&!lane.closed){if(diagnostics.isEnabled())diagnostics.logSystemWarning("traffic","Recovered a stuck vehicle",{id:vehicle.id,laneId:lane.id,stuckSeconds:vehicle.stuckTime});this.reroute(vehicle,lane.from);vehicle.stuckTime=0;console.warn("Recovered stuck vehicle",vehicle.id);}
    }
    this.updateFarOutlines();this.averageSpeed=this.vehicles.length?sum/this.vehicles.length*3.6:0;
    const congestion=Math.max(0,1-moving/Math.max(1,this.vehicles.length));this.distantDemand=Math.round(CONFIG.distantDemandBase*(.75+.5*Math.sin(time*.04))*(1+congestion*.22));
  }

  updateFarOutlines(){
    const output=this.farOutlinePositions;let cursor=0;
    for(const vehicle of this.vehicles){
      if(vehicle.renderTier!=="outline")continue;
      const data=vehicle.mesh.userData,halfWidth=(data.width??1.9)*.5,halfLength=(data.length??4.5)*.5,top=Math.max(.8,data.height??1.5);
      const x=vehicle.mesh.position.x,z=vehicle.mesh.position.z,sin=Math.sin(vehicle.mesh.rotation.y),cos=Math.cos(vehicle.mesh.rotation.y);
      const x0=x-halfWidth*cos-halfLength*sin,z0=z+halfWidth*sin-halfLength*cos;
      const x1=x+halfWidth*cos-halfLength*sin,z1=z-halfWidth*sin-halfLength*cos;
      const x2=x+halfWidth*cos+halfLength*sin,z2=z-halfWidth*sin+halfLength*cos;
      const x3=x-halfWidth*cos+halfLength*sin,z3=z+halfWidth*sin+halfLength*cos;
      cursor=writeOutlineEdge(output,cursor,x0,.15,z0,x1,.15,z1);cursor=writeOutlineEdge(output,cursor,x1,.15,z1,x2,.15,z2);
      cursor=writeOutlineEdge(output,cursor,x2,.15,z2,x3,.15,z3);cursor=writeOutlineEdge(output,cursor,x3,.15,z3,x0,.15,z0);
      cursor=writeOutlineEdge(output,cursor,x0,top,z0,x1,top,z1);cursor=writeOutlineEdge(output,cursor,x1,top,z1,x2,top,z2);
      cursor=writeOutlineEdge(output,cursor,x2,top,z2,x3,top,z3);cursor=writeOutlineEdge(output,cursor,x3,top,z3,x0,top,z0);
      cursor=writeOutlineEdge(output,cursor,x0,.15,z0,x0,top,z0);cursor=writeOutlineEdge(output,cursor,x1,.15,z1,x1,top,z1);
      cursor=writeOutlineEdge(output,cursor,x2,.15,z2,x2,top,z2);cursor=writeOutlineEdge(output,cursor,x3,.15,z3,x3,top,z3);
    }
    this.farOutline.geometry.setDrawRange(0,cursor/3);this.farOutline.geometry.attributes.position.needsUpdate=true;this.farOutline.visible=cursor>0;
  }

  setNight(night){if(this.night===night)return;this.night=night;for(const v of this.vehicles)setHeadlightState(v.mesh,night||v.kind==="emergency");}

  preferredOutgoingLaneIndex(vehicle,from,to,nextRouteIndex){
    const base=this.graph.findLane(from,to,0);if(!base)return 0;
    const outer=this.graph.outermostLaneIndex(base);
    if(vehicle.kind==="bus")return outer;
    if(nextRouteIndex+1<vehicle.route.length-1){
      const later=this.graph.findLane(vehicle.route[nextRouteIndex+1],vehicle.route[nextRouteIndex+2],0);
      if(later)return this.graph.preferredApproachLaneIndex(base.id,later.id);
    }
    return outer;
  }

  advance(vehicle,lane){
    if(vehicle.laneChange){this.completeLaneChange(vehicle);lane=this.graph.lanes.get(vehicle.laneId)??lane;}
    const reached=lane.to;vehicle.onNodeReached?.(vehicle,reached);if(vehicle.dwell>0){vehicle.progress=.995;return;}
    const nextRouteIndex=vehicle.routeIndex+1;
    if(nextRouteIndex>=vehicle.route.length-1){
      if(vehicle.serviceNodes){
        const base=this.graph.findLane(vehicle.route[0],vehicle.route[1],0);
        const loopLane=base?this.graph.findLane(vehicle.route[0],vehicle.route[1],vehicle.kind==="bus"?this.graph.outermostLaneIndex(base):0):null;
        if(loopLane){const connector=this.graph.getJunctionConnector(lane.id,loopLane.id);if(connector){vehicle.connector={...connector,progress:0,outLaneId:loopLane.id,nextRouteIndex:0};vehicle.progress=1;return;}vehicle.routeIndex=0;vehicle.laneId=loopLane.id;vehicle.progress=0;vehicle.stopCooldownLaneId=null;return;}
      }
      if(!this.reroute(vehicle,reached)){vehicle.progress=.98;vehicle.speed=0;}return;
    }
    const from=vehicle.route[nextRouteIndex],to=vehicle.route[nextRouteIndex+1];
    const desiredIndex=this.preferredOutgoingLaneIndex(vehicle,from,to,nextRouteIndex);
    const nextLane=this.graph.findLane(from,to,desiredIndex);
    if(!nextLane){if(!this.reroute(vehicle,reached)){vehicle.progress=.98;vehicle.speed=0;}return;}
    const connector=this.graph.getJunctionConnector(lane.id,nextLane.id);
    if(connector){vehicle.connector={...connector,progress:0,outLaneId:nextLane.id,nextRouteIndex};vehicle.progress=1;return;}
    vehicle.routeIndex=nextRouteIndex;vehicle.laneId=nextLane.id;vehicle.progress=0;vehicle.stopCooldownLaneId=null;
  }

  place(vehicle){
    let t;const position=vehicle._position,tangent=vehicle._tangent;
    if(vehicle.connector){const curve=vehicle.connector.curve;t=Math.max(0,Math.min(.9999,vehicle.connector.progress));curve.getPointAt(t,position);curve.getTangentAt(t,tangent);}
    else if(vehicle.laneChange){const from=this.graph.lanes.get(vehicle.laneChange.fromLaneId),to=this.graph.lanes.get(vehicle.laneChange.toLaneId);if(!from||!to)return;t=Math.max(0,Math.min(.9999,vehicle.progress));const alpha=THREE.MathUtils.smoothstep(THREE.MathUtils.clamp(vehicle.laneChange.elapsed/vehicle.laneChange.duration,0,1),0,1);from.curve.getPointAt(t,vehicle._fromPoint);to.curve.getPointAt(t,vehicle._toPoint);position.copy(vehicle._fromPoint).lerp(vehicle._toPoint,alpha);from.curve.getTangentAt(t,vehicle._fromTangent);to.curve.getTangentAt(t,vehicle._toTangent);tangent.copy(vehicle._fromTangent).lerp(vehicle._toTangent,alpha).normalize();}
    else{const lane=this.graph.lanes.get(vehicle.laneId);if(!lane)return;t=Math.max(0,Math.min(.9999,vehicle.progress));lane.curve.getPointAt(t,position);lane.curve.getTangentAt(t,tangent);}
    const rotation=Math.atan2(tangent.x,tangent.z);vehicle.mesh.position.copy(position);vehicle.mesh.position.y=.05;if(vehicle.collisionOffset)vehicle.mesh.position.add(vehicle.collisionOffset);vehicle.mesh.rotation.y=rotation;vehicle.lowMesh.position.copy(vehicle.mesh.position);vehicle.lowMesh.rotation.y=rotation;
  }

  remove(vehicle){if(vehicle.laneChange)this.activeLaneChanges=Math.max(0,this.activeLaneChanges-1);if(diagnostics.isEnabled())diagnostics.logEvent("traffic","vehicle-despawned",{id:vehicle.id,kind:vehicle.kind,laneId:vehicle.laneId,role:vehicle.diagnosticRole??null},{entityId:vehicle.id,position:vehicle.mesh.position});this.scene.remove(vehicle.mesh);this.scene.remove(vehicle.lowMesh);this.vehicles=this.vehicles.filter(v=>v!==vehicle);}
}
