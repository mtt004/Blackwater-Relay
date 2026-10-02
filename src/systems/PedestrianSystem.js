import * as THREE from "three";
import { CONFIG,mulberry32 } from "../config.js?v=20261002-flight-sim-terrain";
import { qualityManager } from "../core/QualityManager.js?v=20261002-flight-sim-terrain";

const materialCache=new Map(),geometryCache=new Map();
function cachedMaterial(color,roughness=.82){const key=`${color}:${roughness}`;if(!materialCache.has(key))materialCache.set(key,new THREE.MeshStandardMaterial({color,roughness}));return materialCache.get(key);}
function cachedGeometry(type,args){const key=`${type}:${args.join(":")}`;if(geometryCache.has(key))return geometryCache.get(key);let geometry;if(type==="capsule")geometry=new THREE.CapsuleGeometry(...args);else if(type==="sphere")geometry=new THREE.SphereGeometry(...args);else geometry=new THREE.BoxGeometry(...args);geometryCache.set(key,geometry);return geometry;}
function createPedestrianMesh(style){
  const group=new THREE.Group(),skin=cachedMaterial(style.skin,.86),top=cachedMaterial(style.top,.80),bottom=cachedMaterial(style.bottom,.86),shoe=cachedMaterial(0x25282a,.9),hair=cachedMaterial(style.hair,.92);
  const torso=new THREE.Mesh(cachedGeometry("capsule",[.23,.58,4,8]),top);torso.position.y=1.22;torso.scale.set(1,1,style.build);group.add(torso);
  const head=new THREE.Mesh(cachedGeometry("sphere",[.205,12,9]),skin);head.position.y=1.83;group.add(head);
  const hairMesh=new THREE.Mesh(cachedGeometry("sphere",[.211,12,7,0,Math.PI*2,0,Math.PI*.52]),hair);hairMesh.position.y=1.86;group.add(hairMesh);
  const limbs={legs:[],arms:[]};
  for(const side of[-1,1]){
    const legPivot=new THREE.Group(),leg=new THREE.Mesh(cachedGeometry("capsule",[.075,.50,3,7]),bottom),foot=new THREE.Mesh(cachedGeometry("box",[.16,.10,.28]),shoe);leg.position.y=-.30;foot.position.set(0,-.63,.08);legPivot.position.set(side*.12,.88,0);legPivot.add(leg,foot);group.add(legPivot);limbs.legs.push(legPivot);
    const armPivot=new THREE.Group(),arm=new THREE.Mesh(cachedGeometry("capsule",[.055,.43,3,7]),skin),sleeve=new THREE.Mesh(cachedGeometry("capsule",[.075,.22,3,7]),top);arm.position.y=-.26;sleeve.position.y=-.08;armPivot.position.set(side*.31,1.45,0);armPivot.add(arm,sleeve);group.add(armPivot);limbs.arms.push(armPivot);
  }
  group.scale.setScalar(style.scale);group.userData={limbs,baseScale:style.scale};return group;
}
function gridKey(cx,cz){return cx*65536+cz;}
function resetGrid(index){for(const bucket of index.active)bucket.length=0;index.active.length=0;index.map.clear();}
function addToGrid(index,cx,cz,value){const key=gridKey(cx,cz);let bucket=index.map.get(key);if(!bucket){bucket=index.pool.pop()??[];index.map.set(key,bucket);index.active.push(bucket);}bucket.push(value);}

export class PedestrianSystem{
  constructor(scene,graph,signals){
    this.scene=scene;this.graph=graph;this.signals=signals;this.chunkManager=null;this.traffic=null;this.police=null;this.rail=null;this.incidents=null;this.agents=[];this.random=mulberry32(CONFIG.seed+201);this.nextId=1;this.updateCycle=0;
    this.nodes=[...graph.nodes.values()];this.roadByNodePair=new Map();for(const road of graph.roads.values()){this.roadByNodePair.set(`${road.from}>${road.to}`,road);this.roadByNodePair.set(`${road.to}>${road.from}`,road);}
    this.pedestrianIndex={map:new Map(),active:[],pool:[],size:3};this.trafficIndex={map:new Map(),active:[],pool:[],size:12};
    const positions=new Float32Array(Math.max(160,CONFIG.pedestrianTarget+24)*3),geometry=new THREE.BufferGeometry();geometry.setAttribute("position",new THREE.BufferAttribute(positions,3));geometry.setDrawRange(0,0);
    this.farPositions=positions;this.farPoints=new THREE.Points(geometry,new THREE.PointsMaterial({color:0x8ea2ad,size:.65,sizeAttenuation:true,transparent:true,opacity:.52,depthWrite:false,fog:true}));this.farPoints.frustumCulled=false;scene.add(this.farPoints);
  }
  setChunkManager(manager){this.chunkManager=manager;}
  setTrafficSystem(system){this.traffic=system;}
  setPoliceSystem(system){this.police=system;}
  setRailSystem(system){this.rail=system;}
  setIncidentSystem(system){this.incidents=system;}
  populate(count=CONFIG.pedestrianTarget){let tries=0;while(this.agents.length<count&&tries++<count*12)this.spawn();}
  style(){return{skin:[0xf1c7a2,0xd89b73,0xb97854,0x754630][Math.floor(this.random()*4)],top:[0x315b77,0x744b4b,0x5f704a,0x8a7454,0x675b7c,0xb58d3d][Math.floor(this.random()*6)],bottom:[0x29333b,0x4b5155,0x26394c,0x514338][Math.floor(this.random()*4)],hair:[0x211a16,0x5b3b25,0x2b2926,0xb58b5b][Math.floor(this.random()*4)],scale:.91+this.random()*.16,build:.88+this.random()*.20};}
  randomNode(){return this.nodes[Math.floor(this.random()*this.nodes.length)];}
  spawn(){
    const a=this.randomNode();let finalTarget=null,b;
    if(this.rail&&this.random()<.18){const station=this.rail.plan.stations[Math.floor(this.random()*this.rail.plan.stations.length)];b=this.graph.nearestNode(station.entryPosition??station.position);finalTarget=station.entryPosition?.clone()??null;}else b=this.randomNode();
    const route=this.graph.route(a.id,b.id);if(route.length<2)return;
    const mesh=createPedestrianMesh(this.style());this.scene.add(mesh);
    const agent={id:`ped-${String(this.nextId++).padStart(5,"0")}`,mesh,route,index:0,progress:this.random(),speed:.88+this.random()*.72,wait:0,activity:"walking",side:this.random()>.5?1:-1,phase:this.random()*Math.PI*2,finalTarget,goalProgress:0,reactionTimer:0,_segment:{from:null,to:null,road:null},_sample:{point:new THREE.Vector3(),tangent:new THREE.Vector3(0,0,1),road:null},_delta:new THREE.Vector3(),behaviourPhase:this.nextId&3,behaviourFactor:1};
    this.agents.push(agent);this.place(agent);this.updateVisibility(agent);
  }
  segment(agent){
    const state=agent._segment,from=this.graph.nodes.get(agent.route[agent.index]),to=this.graph.nodes.get(agent.route[agent.index+1]);state.from=from;state.to=to;state.road=from&&to?this.roadByNodePair.get(`${from.id}>${to.id}`)??null:null;return state;
  }
  pavementPosition(agent){
    const state=this.segment(agent),sample=agent._sample,{from,to,road}=state;if(!from||!to)return null;
    sample.road=road;
    if(!road){sample.point.copy(from.position).lerp(to.position,agent.progress);sample.tangent.copy(to.position).sub(from.position).setY(0).normalize();return sample;}
    const forwardDirection=road.from===from.id,t=forwardDirection?agent.progress:1-agent.progress;road.centerCurve.getPointAt(t,sample.point);road.centerCurve.getTangentAt(t,sample.tangent).setY(0).normalize();if(!forwardDirection)sample.tangent.multiplyScalar(-1);
    const offset=road.width*.5+Math.max(.8,road.sidewalkWidth*.52),sideOffset=agent.side*offset;sample.point.x+=-sample.tangent.z*sideOffset;sample.point.z+=sample.tangent.x*sideOffset;return sample;
  }
  place(agent){const sample=this.pavementPosition(agent);if(!sample)return;agent.mesh.position.set(sample.point.x,.02,sample.point.z);agent.mesh.rotation.y=Math.atan2(sample.tangent.x,sample.tangent.z);}
  updateVisibility(agent){agent.mesh.visible=this.chunkManager?this.chunkManager.isDetailedPosition(agent.mesh.position):true;}
  buildPedestrianGrid(){
    const index=this.pedestrianIndex,size=index.size;resetGrid(index);
    for(const agent of this.agents)addToGrid(index,Math.floor(agent.mesh.position.x/size),Math.floor(agent.mesh.position.z/size),agent);
    return index;
  }
  neighbourFactor(agent,index){
    const size=index.size,cx=Math.floor(agent.mesh.position.x/size),cz=Math.floor(agent.mesh.position.z/size),position=agent.mesh.position;let factor=1;
    for(let x=cx-1;x<=cx+1;x++)for(let z=cz-1;z<=cz+1;z++){const bucket=index.map.get(gridKey(x,z));if(!bucket)continue;for(const other of bucket){if(other===agent)continue;const dx=position.x-other.mesh.position.x,dz=position.z-other.mesh.position.z,d2=dx*dx+dz*dz;if(d2<.3364)factor=Math.min(factor,.05);else if(d2<1.3225)factor=Math.min(factor,.42);}}
    return factor;
  }
  buildTrafficGrid(){
    const index=this.trafficIndex,size=index.size;resetGrid(index);
    for(const vehicle of this.traffic?.vehicles??[]){if(vehicle.renderTier==="outline")continue;addToGrid(index,Math.floor(vehicle.mesh.position.x/size),Math.floor(vehicle.mesh.position.z/size),vehicle);}
    return index;
  }
  trafficHazard(agent,index){
    let factor=1;const size=index.size,cx=Math.floor(agent.mesh.position.x/size),cz=Math.floor(agent.mesh.position.z/size),position=agent.mesh.position;
    for(let x=cx-1;x<=cx+1;x++)for(let z=cz-1;z<=cz+1;z++){const bucket=index.map.get(gridKey(x,z));if(!bucket)continue;for(const vehicle of bucket){const dx=vehicle.mesh.position.x-position.x,dz=vehicle.mesh.position.z-position.z,d2=dx*dx+dz*dz;if(d2<10.24&&vehicle.speed>1.5)return 0;if(d2<36&&vehicle.speed>5)factor=Math.min(factor,.25);}}
    for(const incident of this.incidents?.incidents??[]){const dx=incident.marker.position.x-position.x,dz=incident.marker.position.z-position.z;if(dx*dx+dz*dz<64)factor=Math.min(factor,.15);}
    if(this.police?.nearbyPolice(position,28))factor=Math.min(factor,.58);return factor;
  }
  animate(agent,time,moving){const phase=time*7.2*agent.speed+agent.phase,swing=moving?Math.sin(phase)*.52:0;agent.mesh.userData.limbs.legs[0].rotation.x=swing;agent.mesh.userData.limbs.legs[1].rotation.x=-swing;agent.mesh.userData.limbs.arms[0].rotation.x=-swing*.72;agent.mesh.userData.limbs.arms[1].rotation.x=swing*.72;agent.mesh.position.y=.02+(moving?Math.abs(Math.sin(phase))*.025:0);}
  animateDue(agent){const stride=qualityManager.current.pedestrians.animationStride;if(stride<=1)return true;const focus=this.chunkManager?.focus;if(!focus||agent.mesh.position.distanceToSquared(focus)<6400)return true;return((this.updateCycle+agent.behaviourPhase)%stride)===0;}
  chooseNewRoute(agent,startId){const end=this.randomNode(),route=this.graph.route(startId,end.id);if(route.length>1){agent.route=route;agent.index=0;agent.progress=0;return true;}return false;}
  update(dt,time,weather){
    this.updateCycle++;const index=this.buildPedestrianGrid(),trafficIndex=this.buildTrafficGrid(),weatherSlow=weather==="rain"?.82:weather==="snow"?.68:1;
    for(const agent of this.agents){
      const detailed=agent.mesh.visible,evaluateBehaviour=detailed||((this.updateCycle+agent.behaviourPhase)&3)===0;
      if(agent.accessingTarget&&agent.finalTarget){
        const delta=agent._delta.copy(agent.finalTarget).sub(agent.mesh.position).setY(0),distanceSq=delta.lengthSq(),distance=Math.sqrt(distanceSq);if(evaluateBehaviour)agent.behaviourFactor=this.neighbourFactor(agent,index)*this.trafficHazard(agent,trafficIndex);const factor=agent.behaviourFactor;
        if(distance<.75){agent.accessingTarget=false;agent.finalTarget=null;agent.wait=1.2;const start=this.graph.nearestNode(agent.mesh.position);this.chooseNewRoute(agent,start.id);}
        else if(factor>.08){delta.multiplyScalar(1/distance);agent.mesh.position.addScaledVector(delta,agent.speed*factor*dt);agent.mesh.rotation.y=Math.atan2(delta.x,delta.z);}
        this.updateVisibility(agent);if(agent.mesh.visible&&this.animateDue(agent))this.animate(agent,time,distance>=.75&&factor>.08);continue;
      }
      const segment=this.segment(agent),from=segment.from,to=segment.to;if(!from||!to)continue;const dx=to.position.x-from.position.x,dz=to.position.z-from.position.z,roadDistance=Math.hypot(dx,dz),remaining=(1-agent.progress)*roadDistance;
      if(evaluateBehaviour){const nearCrossing=remaining<20;agent.behaviourFactor=this.neighbourFactor(agent,index)*(detailed||nearCrossing?this.trafficHazard(agent,trafficIndex):1);}const factor=agent.behaviourFactor,mustWait=Boolean(to.signal&&remaining<7&&!this.signals.pedestrianCanCross(to.id));
      if(mustWait||factor<.08){agent.wait+=dt;agent.activity=agent.wait>3?"waiting":"watching-traffic";}else{agent.wait=Math.max(0,agent.wait-dt);agent.activity=factor<.65?"cautious":"walking";agent.progress+=(agent.speed*weatherSlow*factor*dt)/Math.max(1,roadDistance);}
      if(agent.progress>=1){
        agent.index++;agent.progress=0;
        if(agent.index>=agent.route.length-1){if(agent.finalTarget){agent.accessingTarget=true;agent.index=Math.max(0,agent.route.length-2);agent.progress=1;}else if(this.chooseNewRoute(agent,agent.route.at(-1)))agent.side=this.random()>.5?1:-1;}
      }
      if(!agent.accessingTarget)this.place(agent);this.updateVisibility(agent);if(agent.mesh.visible&&this.animateDue(agent))this.animate(agent,time,agent.activity==="walking"||agent.activity==="cautious");
    }
    this.updateFarPoints();
  }
  updateFarPoints(){let cursor=0;for(const agent of this.agents)if(!agent.mesh.visible){this.farPositions[cursor++]=agent.mesh.position.x;this.farPositions[cursor++]=1;this.farPositions[cursor++]=agent.mesh.position.z;}this.farPoints.geometry.setDrawRange(0,cursor/3);this.farPoints.geometry.attributes.position.needsUpdate=true;this.farPoints.visible=cursor>0;}
}
