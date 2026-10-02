import * as THREE from "three";
import { CONFIG,mulberry32 } from "../config.js?v=20261002-flight-sim-terrain";
import { WORLD_DEFINITION } from "../world/WorldDefinition.js?v=20261002-flight-sim-terrain";
import { diagnostics } from "../core/DiagnosticsManager.js?v=20261002-flight-sim-terrain";

function alignedBox(width,height,length,material,position,heading,y){
  const mesh=new THREE.Mesh(new THREE.BoxGeometry(width,height,length),material);
  mesh.position.set(position.x,y,position.z);mesh.rotation.y=heading;mesh.castShadow=true;mesh.receiveShadow=true;return mesh;
}

export class TransitSystem{
  constructor(scene,graph,traffic,camera=null,input=null,player=null,toast=()=>{},railSystem=null){
    this.scene=scene;this.graph=graph;this.traffic=traffic;this.camera=camera;this.input=input;this.player=player;this.toast=toast;this.railSystem=railSystem;
    this.random=mulberry32(CONFIG.seed+611);this.time=0;
    this.routes=WORLD_DEFINITION.transit.routes.map(route=>({...route,nodes:[...route.nodes]}));
    this.stops=new Map();this.buses=[];this.punctuality=100;this.busesAtStops=0;
    this.playerBus=null;this.busCameraIndex=0;this.busCameraModes=["WINDOW","FRONT","CHASE","TOP-DOWN"];this.stopRequested=false;
    this.interactionPrompt=typeof document!=="undefined"?document.getElementById("interaction-prompt"):null;
    this.prepareRoutes();this.spawnBuses();
  }

  prepareRoutes(){
    for(const route of this.routes){
      route.path=this.expandRoute(route.nodes);route.stopTargets=new Map();
      for(let i=0;i<route.path.length-1;i++){
        const from=route.path[i],to=route.path[i+1];if(!route.nodes.includes(to))continue;
        const baseLane=this.graph.findLane(from,to,0);if(!baseLane)continue;
        const lane=this.graph.findLane(from,to,this.graph.outermostLaneIndex(baseLane))??baseLane;
        const stop=this.ensureStop(lane,to,route.id);route.stopTargets.set(lane.id,stop);
      }
    }
  }

  ensureStop(lane,nodeId,lineId){
    const key=`${lane.id}@${nodeId}`;
    if(this.stops.has(key)){const existing=this.stops.get(key);existing.lines.add(lineId);return existing;}
    const stopDistance=Math.min(10.5,Math.max(6.8,lane.length*.075));
    const progress=THREE.MathUtils.clamp(1-stopDistance/lane.length,.72,.94);
    const lanePoint=lane.curve.getPointAt(progress),tangent=lane.curve.getTangentAt(progress).setY(0).normalize();
    const left=new THREE.Vector3(-tangent.z,0,tangent.x),heading=Math.atan2(tangent.x,tangent.z);
    const curbOffset=(lane.laneWidth??CONFIG.laneWidth)*.5+1.15;
    const pavementPoint=lanePoint.clone().addScaledVector(left,curbOffset);
    const stop={key,nodeId,laneId:lane.id,progress,position:lanePoint.clone(),pavementPoint,heading,lines:new Set([lineId]),waiting:2+Math.floor(this.random()*9),served:0,arrivals:0,lastArrival:-Infinity};
    this.stops.set(key,stop);this.buildStopVisual(stop,left);return stop;
  }

  buildStopVisual(stop,left){
    const group=new THREE.Group();group.position.copy(stop.pavementPoint);group.rotation.y=stop.heading;
    const poleMat=new THREE.MeshStandardMaterial({color:0x30373b,roughness:.72});
    const signMat=new THREE.MeshStandardMaterial({color:0x3aa6c9,emissive:0x0c3340,emissiveIntensity:.72,roughness:.38});
    const glassMat=new THREE.MeshStandardMaterial({color:0x7d9ba8,transparent:true,opacity:.34,roughness:.18,metalness:.12});
    const frameMat=new THREE.MeshStandardMaterial({color:0x3b4449,roughness:.62,metalness:.2});
    const benchMat=new THREE.MeshStandardMaterial({color:0x785b3d,roughness:.84});
    const pole=new THREE.Mesh(new THREE.CylinderGeometry(.07,.09,2.75,8),poleMat);pole.position.set(0,1.375,0);group.add(pole);
    const sign=new THREE.Mesh(new THREE.BoxGeometry(.52,.68,.10),signMat);sign.position.set(0,2.28,0);group.add(sign);
    const shelter=new THREE.Group();shelter.position.set(0,0,-2.05);group.add(shelter);
    const roof=new THREE.Mesh(new THREE.BoxGeometry(1.75,.12,3.45),frameMat);roof.position.set(.65,2.25,0);shelter.add(roof);
    const back=new THREE.Mesh(new THREE.BoxGeometry(.08,2.05,3.25),glassMat);back.position.set(1.42,1.08,0);shelter.add(back);
    const side=new THREE.Mesh(new THREE.BoxGeometry(1.55,2.05,.08),glassMat);side.position.set(.65,1.08,-1.58);shelter.add(side);
    const bench=new THREE.Mesh(new THREE.BoxGeometry(.58,.16,2.15),benchMat);bench.position.set(.94,.58,.05);shelter.add(bench);
    const bayMat=new THREE.MeshStandardMaterial({color:0xd8b83d,roughness:.72,emissive:0x2e2503,emissiveIntensity:.12});
    const bay=alignedBox(.12,.025,8.5,bayMat,stop.position.clone().addScaledVector(left,(this.graph.lanes.get(stop.laneId)?.laneWidth??CONFIG.laneWidth)*.42),stop.heading,.065);
    this.scene.add(group,bay);stop.group=group;stop.bay=bay;
  }

  spawnBuses(){
    for(const route of this.routes){
      const cycle=route.path.at(-1)===route.path[0]?route.path.slice(0,-1):[...route.path];
      for(let i=0;i<2;i++){
        const startIndex=Math.floor(i*cycle.length/2),rotated=[...cycle.slice(startIndex),...cycle.slice(0,startIndex)];rotated.push(rotated[0]);
        const baseLane=this.graph.findLane(rotated[0],rotated[1],0);if(!baseLane)continue;
        const lane=this.graph.findLane(rotated[0],rotated[1],this.graph.outermostLaneIndex(baseLane))??baseLane;
        const bus=this.traffic.addVehicle({kind:"bus",route:rotated,lane,profileName:"professional",serviceNodes:route.nodes});
        bus.line=route.id;bus.capacity=68;bus.passengers=8+Math.floor(this.random()*18);bus.stopTargets=new Map(route.stopTargets);bus.playerOccupied=false;bus.passengerStopRequested=false;
        bus.onBusStop=(vehicle,stop)=>this.serviceStop(vehicle,stop);this.buses.push(bus);
      }
    }
  }

  serviceStop(bus,stop){
    const alighting=Math.min(bus.passengers,Math.floor(this.random()*Math.min(12,bus.passengers+1)));bus.passengers-=alighting;
    const free=Math.max(0,bus.capacity-bus.passengers),boarding=Math.min(stop.waiting,free,5+Math.floor(this.random()*14));
    stop.waiting-=boarding;stop.served+=boarding;stop.arrivals++;stop.lastArrival=this.time;bus.passengers+=boarding;
    const requestedBonus=bus.passengerStopRequested?1.1:0;bus.passengerStopRequested=false;
    const dwell=3.4+Math.max(boarding,alighting)*.26+Math.min(boarding,alighting)*.09+requestedBonus;
    bus.lastStop={key:stop.key,boarding,alighting,dwell};if(diagnostics.isEnabled())diagnostics.logEvent("bus","passenger-exchange",{busId:bus.id,line:bus.line,stopKey:stop.key,boarding,alighting,passengersAfter:bus.passengers,waitingAfter:stop.waiting,dwellSeconds:dwell},{entityId:bus.id,position:bus.mesh.position});return dwell;
  }

  expandRoute(stops){
    const full=[];
    for(let i=0;i<stops.length-1;i++){const part=this.graph.route(stops[i],stops[i+1]);if(!part.length)continue;full.push(...(full.length?part.slice(1):part));}
    const back=[];
    for(let i=stops.length-1;i>0;i--){const part=this.graph.route(stops[i],stops[i-1]);if(part.length)back.push(...(back.length?part.slice(1):part));}
    full.push(...back.slice(1));return full;
  }

  busDoorWorld(bus){
    const local=(bus.mesh.userData.doorLocalPosition??new THREE.Vector3(-1.55,1.2,2.8)).clone();return bus.mesh.localToWorld(local);
  }

  nearestBoardableBus(position,{includeMoving=false}={}){
    let best=null,bestDistance=Infinity;
    for(const bus of this.buses){
      const stopped=bus.dwellReason==="bus-stop"&&bus.dwell>0&&bus.speed<.65;
      if(!includeMoving&&!stopped)continue;
      const door=this.busDoorWorld(bus),distance=door.distanceTo(position);
      if(distance<bestDistance){bestDistance=distance;best={bus,door,distance,stopped};}
    }
    return bestDistance<4.5?best:null;
  }

  updateInteractionPrompt(player){
    if(!this.interactionPrompt)return;
    if(player.inBus){
      const canExit=this.playerBus?.dwellReason==="bus-stop"&&this.playerBus.dwell>0&&this.playerBus.speed<.65;
      if(canExit){this.interactionPrompt.hidden=false;this.interactionPrompt.dataset.owner="bus";this.interactionPrompt.querySelector("span").textContent=`Exit bus ${this.playerBus.line}`;}
      else if(this.interactionPrompt.dataset.owner==="bus"){this.interactionPrompt.hidden=true;delete this.interactionPrompt.dataset.owner;}
      return;
    }
    if(player.inVehicle||player.inTrain){if(this.interactionPrompt.dataset.owner==="bus"){this.interactionPrompt.hidden=true;delete this.interactionPrompt.dataset.owner;}return;}
    if(!this.interactionPrompt.hidden&&this.interactionPrompt.dataset.owner==="rail")return;
    const candidate=this.nearestBoardableBus(this.camera?.position??player.position),moving=candidate??this.nearestBoardableBus(this.camera?.position??player.position,{includeMoving:true});
    if(candidate){this.interactionPrompt.hidden=false;this.interactionPrompt.dataset.owner="bus";this.interactionPrompt.querySelector("span").textContent=`Board bus ${candidate.bus.line}`;}
    else if(moving&&moving.bus.speed<3.0){this.interactionPrompt.hidden=false;this.interactionPrompt.dataset.owner="bus";this.interactionPrompt.querySelector("span").textContent="Wait for the bus doors to open";}
    else if(this.interactionPrompt.dataset.owner==="bus"){this.interactionPrompt.hidden=true;delete this.interactionPrompt.dataset.owner;}
  }

  handleInteract(player){
    if(player.inTrain)return false;
    if(player.inBus){
      const bus=this.playerBus;if(!bus)return false;
      if(!(bus.dwellReason==="bus-stop"&&bus.dwell>0&&bus.speed<.65)){this.toast("Wait until the bus reaches a stop");return true;}
      const door=this.busDoorWorld(bus),left=new THREE.Vector3(-1,0,0).applyQuaternion(bus.mesh.quaternion);
      this.camera.position.copy(door).addScaledVector(left,1.8);this.camera.position.y=1.72;player.walkYaw=bus.mesh.rotation.y+Math.PI*.5;
      player.inBus=false;bus.playerOccupied=false;bus.passengers=Math.max(0,bus.passengers-1);if(diagnostics.isEnabled())diagnostics.logEvent("player","left-bus",{busId:bus.id,line:bus.line,passengers:bus.passengers},{entityId:bus.id,position:door});this.playerBus=null;this.stopRequested=false;
      if(this.interactionPrompt){this.interactionPrompt.hidden=true;delete this.interactionPrompt.dataset.owner;}this.toast(`Left bus ${bus.line}`);return true;
    }
    if(player.inVehicle)return false;
    const near=this.nearestBoardableBus(this.camera.position);
    if(!near){const moving=this.nearestBoardableBus(this.camera.position,{includeMoving:true});if(moving){this.toast("Wait for the bus to stop and open its doors");return true;}return false;}
    this.playerBus=near.bus;near.bus.playerOccupied=true;near.bus.passengers=Math.min(near.bus.capacity,near.bus.passengers+1);
    player.inBus=true;player.inTrain=false;player.inVehicle=false;this.busCameraIndex=0;this.stopRequested=false;if(diagnostics.isEnabled())diagnostics.logEvent("player","boarded-bus",{busId:near.bus.id,line:near.bus.line,passengers:near.bus.passengers},{entityId:near.bus.id,position:near.door});
    if(this.interactionPrompt){this.interactionPrompt.hidden=true;delete this.interactionPrompt.dataset.owner;}this.toast(`Riding bus ${near.bus.line} · press H to request the next stop`);return true;
  }

  updateBusCamera(bus,dt){
    const forward=new THREE.Vector3(Math.sin(bus.mesh.rotation.y),0,Math.cos(bus.mesh.rotation.y)),right=new THREE.Vector3(forward.z,0,-forward.x),position=bus.mesh.position;let desired,look;
    switch(this.busCameraModes[this.busCameraIndex]){
      case"FRONT":desired=position.clone().addScaledVector(forward,3.65).addScaledVector(right,-.36).add(new THREE.Vector3(0,2.25,0));look=position.clone().addScaledVector(forward,45).add(new THREE.Vector3(0,1.9,0));break;
      case"CHASE":desired=position.clone().addScaledVector(forward,-15).add(new THREE.Vector3(0,6.5,0));look=position.clone().addScaledVector(forward,9).add(new THREE.Vector3(0,1.8,0));break;
      case"TOP-DOWN":desired=position.clone().add(new THREE.Vector3(0,72,0));look=position;break;
      default:{
        const seats=bus.mesh.userData.passengerSeatOffsets??[],seat=seats[4]??new THREE.Vector3(-.72,1.85,.5),world=bus.mesh.localToWorld(seat.clone());
        desired=world;look=world.clone().addScaledVector(forward,24).addScaledVector(right,-4);break;
      }
    }
    this.camera.position.lerp(desired,1-Math.exp(-dt*7));this.camera.lookAt(look);
  }

  updatePassengerRide(dt,player){
    this.updateInteractionPrompt(player);
    if(!player.inBus||!this.playerBus)return;
    const bus=this.playerBus;bus.playerOccupied=true;
    if(this.input?.consume("KeyC")){this.busCameraIndex=(this.busCameraIndex+1)%this.busCameraModes.length;this.toast(`${this.busCameraModes[this.busCameraIndex]} bus camera`);}
    if(this.input?.consume("KeyH")){bus.passengerStopRequested=true;this.stopRequested=true;this.toast("Bus stop requested");}
    this.updateBusCamera(bus,dt);
  }

  getPlayerFocus(){return this.playerBus?{position:this.playerBus.mesh.position,heading:this.playerBus.mesh.rotation.y,speed:this.playerBus.speed}:null;}
  getPlayerState(){
    const bus=this.playerBus;if(!bus)return null;const lane=this.graph.lanes.get(bus.laneId),next=this.traffic.upcomingBusStop?.(bus,lane);
    return{line:bus.line,speed:bus.speed,mode:this.busCameraModes[this.busCameraIndex],nextStop:next?.nodeId??bus.lastStop?.key?.split("@").at(-1)??"—",passengers:bus.passengers,requested:bus.passengerStopRequested,limit:lane?.speedLimit??30};
  }

  update(dt,time){
    this.time=time;this.busesAtStops=this.buses.filter(b=>b.dwellReason==="bus-stop"&&b.dwell>0).length;
    for(const stop of this.stops.values()){const demandPulse=Math.sin(time*.055+stop.position.x*.017+stop.position.z*.009);if(demandPulse>.996)stop.waiting=Math.min(34,stop.waiting+1+Math.floor(this.random()*2));}
    const delays=this.buses.reduce((sum,b)=>sum+Math.min(24,b.stuckTime*1.25)+(b.dwellReason==="bus-stop"?0:Math.max(0,b.dwell-8)),0);
    this.punctuality=Math.max(68,Math.round(100-delays/Math.max(1,this.buses.length)));
  }
}
