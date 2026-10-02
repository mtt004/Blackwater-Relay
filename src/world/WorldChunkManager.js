import * as THREE from "three";
import { CONFIG } from "../config.js?v=20261002-flight-sim-terrain";
import { qualityManager } from "../core/QualityManager.js?v=20261002-flight-sim-terrain";
import { WORLD_DEFINITION } from "./WorldDefinition.js?v=20261002-flight-sim-terrain";
import { diagnostics } from "../core/DiagnosticsManager.js?v=20261002-flight-sim-terrain";

const BOX_EDGES=[
  [0,1],[1,2],[2,3],[3,0],
  [4,5],[5,6],[6,7],[7,4],
  [0,4],[1,5],[2,6],[3,7]
];

export function chunkCoord(value,chunkSize=CONFIG.chunkSize){return Math.floor(value/chunkSize);}
export function chunkKey(cx,cz){return `${cx}:${cz}`;}
export function chunkKeyForPosition(position,chunkSize=CONFIG.chunkSize){return chunkKey(chunkCoord(position.x,chunkSize),chunkCoord(position.z,chunkSize));}

export function predictAheadChunk(position,heading,speed,chunkSize=CONFIG.chunkSize){
  const directionSign=speed<-.5?-1:1;
  const dirX=Math.sin(heading)*directionSign,dirZ=Math.cos(heading)*directionSign;
  const lookAhead=chunkSize*.68+Math.min(chunkSize*.42,Math.abs(speed)*4.5);
  const x=position.x+dirX*lookAhead,z=position.z+dirZ*lookAhead;
  let cx=chunkCoord(x,chunkSize),cz=chunkCoord(z,chunkSize);
  const currentCx=chunkCoord(position.x,chunkSize),currentCz=chunkCoord(position.z,chunkSize);
  if(cx===currentCx&&cz===currentCz){
    if(Math.abs(dirX)>=Math.abs(dirZ))cx+=dirX>=0?1:-1;
    else cz+=dirZ>=0?1:-1;
  }
  return chunkKey(cx,cz);
}

export function cardinalNeighbourKeysForChunk(key){
  const[cx,cz]=key.split(":").map(Number);
  return[
    chunkKey(cx-1,cz),
    chunkKey(cx+1,cz),
    chunkKey(cx,cz-1),
    chunkKey(cx,cz+1)
  ];
}

export function neighbourhoodKeysForPosition(position,chunkSize=CONFIG.chunkSize){
  const current=chunkKeyForPosition(position,chunkSize);
  return new Set([current,...cardinalNeighbourKeysForChunk(current)]);
}

export function predictAheadChunks(position,heading,speed,count=qualityManager.current.world.chunkAheadCount,chunkSize=CONFIG.chunkSize){
  const directionSign=speed<-.5?-1:1;
  const dirX=Math.sin(heading)*directionSign,dirZ=Math.cos(heading)*directionSign;
  const current=chunkKeyForPosition(position,chunkSize);
  const keys=[];
  for(let i=0;i<count;i++){
    const distance=chunkSize*(.72+i*.92)+Math.min(chunkSize*.38,Math.abs(speed)*4.2);
    let cx=chunkCoord(position.x+dirX*distance,chunkSize);
    let cz=chunkCoord(position.z+dirZ*distance,chunkSize);
    let key=chunkKey(cx,cz);
    if(key===current||keys.includes(key)){
      const step=i+1;
      const baseCx=chunkCoord(position.x,chunkSize);
      const baseCz=chunkCoord(position.z,chunkSize);
      if(Math.abs(dirX)>=Math.abs(dirZ))cx=baseCx+(dirX>=0?step:-step);
      else cz=baseCz+(dirZ>=0?step:-step);
      key=chunkKey(cx,cz);
    }
    if(key!==current&&!keys.includes(key))keys.push(key);
  }
  return keys;
}

function appendLine(array,ax,ay,az,bx,by,bz){array.push(ax,ay,az,bx,by,bz);}

function rotateXZ(x,z,cx,cz,rotation=0){
  if(!rotation)return[x+cx,z+cz];
  const c=Math.cos(rotation),s=Math.sin(rotation);
  return[cx+x*c+z*s,cz-x*s+z*c];
}

function appendCircleOutline(array,x,z,r,segments=36,y=.09){
  for(let i=0;i<segments;i++){
    const a=i/segments*Math.PI*2,b=(i+1)/segments*Math.PI*2;
    appendLine(array,x+Math.cos(a)*r,y,z+Math.sin(a)*r,x+Math.cos(b)*r,y,z+Math.sin(b)*r);
  }
}

function appendBoxOutline(array,{x,y=0,z,w,h,d,rotation=0}){
  const hw=w*.5,hd=d*.5,y0=y,y1=y+h;
  const local=[[-hw,-hd],[hw,-hd],[hw,hd],[-hw,hd]];
  const floor=local.map(([lx,lz])=>{const[wx,wz]=rotateXZ(lx,lz,x,z,rotation);return[wx,y0,wz];});
  const roof=local.map(([lx,lz])=>{const[wx,wz]=rotateXZ(lx,lz,x,z,rotation);return[wx,y1,wz];});
  const corners=[...floor,...roof];
  for(const[a,b]of BOX_EDGES)appendLine(array,...corners[a],...corners[b]);
}

function appendRoofOutline(array,desc){
  const{x,z,w,d,wallHeight,roofHeight,rotation=0}=desc;
  const baseY=wallHeight??desc.h*.72,apexY=baseY+(roofHeight??desc.h*.28),hw=w*.52,hd=d*.52;
  const local=[[-hw,-hd],[hw,-hd],[hw,hd],[-hw,hd]];
  const corners=local.map(([lx,lz])=>{const[wx,wz]=rotateXZ(lx,lz,x,z,rotation);return[wx,baseY,wz];});
  const ridgeA=rotateXZ(0,-hd,x,z,rotation),ridgeB=rotateXZ(0,hd,x,z,rotation);
  appendLine(array,ridgeA[0],apexY,ridgeA[1],ridgeB[0],apexY,ridgeB[1]);
  appendLine(array,...corners[0],ridgeA[0],apexY,ridgeA[1]);appendLine(array,...corners[1],ridgeA[0],apexY,ridgeA[1]);
  appendLine(array,...corners[2],ridgeB[0],apexY,ridgeB[1]);appendLine(array,...corners[3],ridgeB[0],apexY,ridgeB[1]);
}

function appendSpecialOutline(array,special){
  if(special.type==="station")appendBoxOutline(array,{x:special.x,y:0,z:special.z,w:142,h:22,d:44});
  else if(special.type==="tower")appendBoxOutline(array,{x:special.x,y:0,z:special.z,w:46,h:160,d:46});
  else if(special.type==="quay")appendBoxOutline(array,{x:special.x,y:0,z:special.z,w:special.w,h:.65,d:special.d});
  else if(special.type==="dock")appendBoxOutline(array,{x:special.x,y:0,z:special.z,w:special.w,h:.55,d:special.d});
  else if(special.type==="boat")appendBoxOutline(array,{x:special.x,y:.2,z:special.z,w:special.w,h:1.2,d:special.d});
  else if(special.type==="fountain")appendBoxOutline(array,{x:special.x,y:0,z:special.z,w:16,h:1,d:16});
  else if(special.type==="roundabout"){appendCircleOutline(array,special.x,special.z,special.outerRadius,42,.09);appendCircleOutline(array,special.x,special.z,special.innerRadius,42,.09);}
  else if(special.type==="junctionApron"||special.type==="roadEndCap")appendCircleOutline(array,special.x,special.z,special.radius,36,.09);
  else if(special.type==="junctionSurface"&&special.points?.length>1){for(let i=0;i<special.points.length;i++){const a=special.points[i],b=special.points[(i+1)%special.points.length];appendLine(array,a.x,.09,a.z,b.x,.09,b.z);}}
}

export class WorldChunkManager{
  constructor(scene,{chunkSize=CONFIG.chunkSize,buildChunk,maxCachedDetailed=null,worldDefinition=WORLD_DEFINITION}={}){
    this.scene=scene;this.chunkSize=chunkSize;this.buildChunk=buildChunk;this.maxCachedDetailed=maxCachedDetailed??qualityManager.current.world.maxCachedDetailedChunks;this.worldDefinition=worldDefinition;
    this.chunks=new Map();this.queue=[];this.currentKey=null;this.preloadKey=null;this.lastBuildMs=0;this.lastQueueMs=0;this.lastBuiltCount=0;this.maximumBuildMs=0;
    this.neighbourhoodKeys=new Set();this.aheadKeys=new Set();this.futurePreloadKeys=new Set();this.previousVisibleUntil=new Map();
    this.visibleTargetKeys=new Set();this.visibleDetailKeys=new Set();this.visibleBuildingKeys=new Set();this.visibleLowBuildingKeys=new Set();this.buildingHaloKeys=new Set();this.focus=new THREE.Vector3();
    this.outlineMaterialTemplate=new THREE.LineBasicMaterial({color:0x71838c,transparent:true,opacity:.12,depthWrite:false,depthTest:true,fog:true});
    this.lowBuildingGeometry=new THREE.BoxGeometry(1,1,1);
    this.lowBuildingMaterial=new THREE.MeshLambertMaterial({color:0x6e7774,fog:true});
    this.debugVisible=false;this.debugGroup=this.createDebugGrid();scene.add(this.debugGroup);
    this.currentDebug=this.createDebugRect(0xe9f4f7);this.preloadDebug=this.createDebugRect(0x69bdd8);
    this.neighbourDebugGroup=new THREE.Group();this.aheadDebugGroup=new THREE.Group();
    this.debugGroup.add(this.currentDebug,this.preloadDebug,this.neighbourDebugGroup,this.aheadDebugGroup);
  }

  createDebugGrid(){
    const group=new THREE.Group();group.visible=false;
    const positions=[],size=this.chunkSize,bounds=this.worldDefinition.bounds;
    const minX=Math.floor(bounds.minX/size)*size,maxX=Math.ceil(bounds.maxX/size)*size;
    const minZ=Math.floor(bounds.minZ/size)*size,maxZ=Math.ceil(bounds.maxZ/size)*size;
    for(let x=minX;x<=maxX;x+=size)appendLine(positions,x,.12,minZ,x,.12,maxZ);
    for(let z=minZ;z<=maxZ;z+=size)appendLine(positions,minX,.12,z,maxX,.12,z);
    const geometry=new THREE.BufferGeometry();geometry.setAttribute("position",new THREE.Float32BufferAttribute(positions,3));
    group.add(new THREE.LineSegments(geometry,new THREE.LineBasicMaterial({color:0x7fb1c2,transparent:true,opacity:.28,depthWrite:false})));
    return group;
  }

  createDebugRect(color){
    const s=this.chunkSize*.5,positions=[-s,.2,-s,s,.2,-s,s,.2,-s,s,.2,s,s,.2,s,-s,.2,s,-s,.2,s,-s,.2,-s];
    const geometry=new THREE.BufferGeometry();geometry.setAttribute("position",new THREE.Float32BufferAttribute(positions,3));
    const lines=new THREE.LineSegments(geometry,new THREE.LineBasicMaterial({color,transparent:true,opacity:.8,depthWrite:false}));lines.visible=false;return lines;
  }

  ensure(cx,cz){
    const key=chunkKey(cx,cz);
    if(!this.chunks.has(key))this.chunks.set(key,{
      key,cx,cz,
      roads:{asphalt:[],sidewalk:[],curb:[],white:[],yellow:[],median:[],junction:[]},
      props:{poles:[],lamps:[],trunks:[],crowns:[],bollards:[]},
      buildings:[],specials:[],outlineSegments:[],outline:null,outlineRoad:null,outlineBuildings:null,lowBuildings:null,detail:null,state:"unloaded",lastUsed:0
    });
    return this.chunks.get(key);
  }

  chunkIntersectsWorld(key){
    const[cx,cz]=key.split(":").map(Number),bounds=this.worldDefinition.bounds;
    const minX=cx*this.chunkSize,maxX=minX+this.chunkSize,minZ=cz*this.chunkSize,maxZ=minZ+this.chunkSize;
    return maxX>=bounds.minX&&minX<=bounds.maxX&&maxZ>=bounds.minZ&&minZ<=bounds.maxZ;
  }

  chunkAt(x,z){return this.ensure(chunkCoord(x,this.chunkSize),chunkCoord(z,this.chunkSize));}
  chunkByKey(key){const[cx,cz]=key.split(":").map(Number);return this.ensure(cx,cz);}
  addRoadMatrix(x,z,type,matrix){this.chunkAt(x,z).roads[type].push(matrix);}
  addPropMatrix(x,z,type,matrix){this.chunkAt(x,z).props[type].push(matrix);}
  addBuilding(desc){this.chunkAt(desc.x,desc.z).buildings.push(desc);}
  addSpecial(desc){this.chunkAt(desc.x,desc.z).specials.push(desc);}
  addOutlineSegment(a,b){
    const x=(a.x+b.x)*.5,z=(a.z+b.z)*.5;appendLine(this.chunkAt(x,z).outlineSegments,a.x,a.y??.08,a.z,b.x,b.y??.08,b.z);
  }

  finalize(){for(const chunk of this.chunks.values())this.buildOutline(chunk);}

  buildLowBuildings(chunk){
    const transforms=[];
    for(const building of chunk.buildings){
      const height=building.wallHeight??building.h,object=new THREE.Object3D();
      object.position.set(building.x,height*.5,building.z);object.rotation.y=building.rotation??0;object.scale.set(building.w,height,building.d);object.updateMatrix();transforms.push(object.matrix.clone());
    }
    for(const special of chunk.specials){
      let width=0,height=0,depth=0;
      if(special.type==="station"){width=142;height=16;depth=44;}
      else if(special.type==="tower"){width=34;height=152;depth=34;}
      else continue;
      const object=new THREE.Object3D();object.position.set(special.x,height*.5,special.z);object.scale.set(width,height,depth);object.updateMatrix();transforms.push(object.matrix.clone());
    }
    if(!transforms.length)return null;
    const mesh=new THREE.InstancedMesh(this.lowBuildingGeometry,this.lowBuildingMaterial,transforms.length);
    transforms.forEach((matrix,index)=>mesh.setMatrixAt(index,matrix));mesh.instanceMatrix.setUsage(THREE.StaticDrawUsage);mesh.computeBoundingSphere();mesh.castShadow=false;mesh.receiveShadow=false;mesh.frustumCulled=true;mesh.matrixAutoUpdate=false;mesh.updateMatrix();mesh.visible=false;mesh.name=`building-low-${chunk.key}`;this.scene.add(mesh);return mesh;
  }

  buildOutline(chunk){
    const roadPositions=[...chunk.outlineSegments],buildingPositions=[];
    for(const b of chunk.buildings){
      const wallHeight=b.wallHeight??(b.district==="res"||b.district==="old"?b.h*.72:b.h);
      appendBoxOutline(buildingPositions,{x:b.x,y:0,z:b.z,w:b.w,h:wallHeight,d:b.d,rotation:b.rotation});
      if(b.district==="res"||b.district==="old")appendRoofOutline(buildingPositions,{...b,wallHeight,roofHeight:b.h-wallHeight});
    }
    for(const special of chunk.specials){
      if(special.type==="roundabout"||special.type==="junctionSurface"||special.type==="junctionApron"||special.type==="roadEndCap")appendSpecialOutline(roadPositions,special);
      else appendSpecialOutline(buildingPositions,special);
    }
    if(!roadPositions.length&&!buildingPositions.length)return;
    const group=new THREE.Group();group.name=`outline-${chunk.key}`;
    const makeLines=(positions,name,opacity)=>{
      if(!positions.length)return null;
      const geometry=new THREE.BufferGeometry();geometry.setAttribute("position",new THREE.Float32BufferAttribute(positions,3));geometry.computeBoundingSphere();
      const material=this.outlineMaterialTemplate.clone();material.opacity=opacity;
      const lines=new THREE.LineSegments(geometry,material);lines.name=name;lines.frustumCulled=true;group.add(lines);return lines;
    };
    chunk.outlineRoad=makeLines(roadPositions,`road-outline-${chunk.key}`,.10);
    chunk.outlineBuildings=makeLines(buildingPositions,`building-outline-${chunk.key}`,.10);
    chunk.outline=group;this.scene.add(group);chunk.lowBuildings=this.buildLowBuildings(chunk);
  }

  initialize(position,heading,speed=0){
    this.focus.copy(position);this.updateTargets(position,heading,speed,0,true);
    for(const key of this.visibleTargetKeys)this.buildNow(this.chunkByKey(key));
    for(const key of this.buildingHaloKeys)if(!this.visibleTargetKeys.has(key))this.buildNow(this.chunkByKey(key));
    for(const key of this.futurePreloadKeys){
      if(!this.visibleTargetKeys.has(key)&&!this.buildingHaloKeys.has(key))this.buildNow(this.chunkByKey(key));
    }
    this.applyVisibility(0);this.updateDebugRects();this.updateOutlineAppearance();
  }

  async initializeAsync(position,heading,speed=0,onProgress=()=>{}){
    this.focus.copy(position);this.updateTargets(position,heading,speed,0,false);
    const local=[this.currentKey,...cardinalNeighbourKeysForChunk(this.currentKey)].filter(key=>this.chunkIntersectsWorld(key));
    const primaryAhead=[...this.aheadKeys].slice(0,1);
    const required=[...new Set([...local,...primaryAhead])];
    let completed=0;
    for(const key of required){
      const chunk=this.chunkByKey(key);
      if(chunk.state!=="loaded")this.buildNow(chunk);
      completed++;this.applyVisibility(0);this.updateDebugRects();this.updateOutlineAppearance();
      onProgress(completed,required.length,key);
      await new Promise(resolve=>requestAnimationFrame(()=>resolve()));
    }
    this.queue=this.queue.filter(item=>item?.chunk?.state==="queued");
    return this.getStats();
  }

  update(position,heading,speed,nowSeconds){
    this.focus.copy(position);this.updateTargets(position,heading,speed,nowSeconds,false);
    this.processQueue();this.applyVisibility(nowSeconds);this.evictHidden();this.updateDebugRects();this.updateOutlineAppearance();
  }

  computeBuildingHaloKeys(position){
    const cx=chunkCoord(position.x,this.chunkSize),cz=chunkCoord(position.z,this.chunkSize);
    const localX=position.x-cx*this.chunkSize,localZ=position.z-cz*this.chunkSize,d=qualityManager.current.world.buildingHaloDistance;
    const xOffsets=[0],zOffsets=[0];
    if(localX<d)xOffsets.push(-1);else if(this.chunkSize-localX<d)xOffsets.push(1);
    if(localZ<d)zOffsets.push(-1);else if(this.chunkSize-localZ<d)zOffsets.push(1);
    const keys=new Set();
    for(const dx of xOffsets)for(const dz of zOffsets){
      if(!dx&&!dz)continue;
      const key=chunkKey(cx+dx,cz+dz);
      if(this.chunkIntersectsWorld(key)&&!this.neighbourhoodKeys.has(key)&&!this.aheadKeys.has(key))keys.add(key);
    }
    return keys;
  }

  computeFuturePreloadKeys(primaryAhead){
    if(!primaryAhead)return new Set();
    const keys=new Set(cardinalNeighbourKeysForChunk(primaryAhead));
    keys.add(primaryAhead);
    for(const key of this.aheadKeys)keys.add(key);
    for(const key of this.visibleTargetKeys)keys.delete(key);
    return keys;
  }

  updateTargets(position,heading,speed,nowSeconds,immediate){
    const nextCurrent=chunkKeyForPosition(position,this.chunkSize);
    const nextNeighbourhood=new Set([...neighbourhoodKeysForPosition(position,this.chunkSize)].filter(key=>this.chunkIntersectsWorld(key)));
    const nextAhead=new Set(predictAheadChunks(position,heading,speed,qualityManager.current.world.chunkAheadCount,this.chunkSize).filter(key=>this.chunkIntersectsWorld(key)));
    const nextVisible=new Set([...nextNeighbourhood,...nextAhead]);

    if(this.visibleTargetKeys.size){
      for(const key of this.visibleTargetKeys){
        if(!nextVisible.has(key))this.previousVisibleUntil.set(key,nowSeconds+qualityManager.current.world.transitionGrace);
      }
    }

    this.currentKey=nextCurrent;
    this.neighbourhoodKeys=nextNeighbourhood;
    this.aheadKeys=nextAhead;
    this.preloadKey=[...nextAhead][0]??null;
    this.visibleTargetKeys=nextVisible;
    this.buildingHaloKeys=this.computeBuildingHaloKeys(position);
    this.futurePreloadKeys=this.computeFuturePreloadKeys(this.preloadKey);

    this.requestDetail(this.currentKey,7,immediate);
    for(const key of this.neighbourhoodKeys)if(key!==this.currentKey)this.requestDetail(key,6,immediate);
    for(const key of this.aheadKeys)this.requestDetail(key,5,immediate);
    for(const key of this.buildingHaloKeys)this.requestDetail(key,3,immediate);
    for(const key of this.futurePreloadKeys)this.requestDetail(key,2,immediate);
  }

  requestDetail(key,priority=0,immediate=false){
    if(!key||!this.chunkIntersectsWorld(key))return;
    const chunk=this.chunkByKey(key);chunk.lastUsed=performance.now();
    if(chunk.state==="loaded"||chunk.state==="building")return;
    if(chunk.state==="queued"){
      const item=this.queue.find(entry=>entry.chunk===chunk);
      if(item&&priority>item.priority)item.priority=priority;
      this.queue.sort((a,b)=>b.priority-a.priority);
      return;
    }
    if(immediate){this.buildNow(chunk);return;}
    chunk.state="queued";this.queue.push({chunk,priority});this.queue.sort((a,b)=>b.priority-a.priority);if(diagnostics.isEnabled())diagnostics.logEvent("chunk","chunk-load-requested",{key:chunk.key,priority,immediate:false});
  }

  processQueue(){
    const start=performance.now();let built=0,totalBuildMs=0;
    while(this.queue.length&&built<CONFIG.chunkBuildsPerFrame&&performance.now()-start<CONFIG.chunkBuildBudgetMs){
      const item=this.queue.shift();if(item?.chunk.state!=="queued")continue;
      const key=item.chunk.key,relevant=this.visibleTargetKeys.has(key)||this.buildingHaloKeys.has(key)||this.futurePreloadKeys.has(key);if(!relevant){item.chunk.state="unloaded";if(diagnostics.isEnabled())diagnostics.logEvent("chunk","chunk-generation-cancelled",{key,reason:"no-longer-relevant"});continue;}
      const buildStart=performance.now();this.buildNow(item.chunk);const buildMs=performance.now()-buildStart;totalBuildMs+=buildMs;if(buildMs>this.maximumBuildMs)this.maximumBuildMs=buildMs;built++;
    }
    this.lastBuildMs=totalBuildMs;this.lastBuiltCount=built;this.lastQueueMs=performance.now()-start;
  }

  buildNow(chunk){
    if(chunk.state==="loaded")return;const recording=diagnostics.isEnabled(),startedAt=recording?performance.now():0;chunk.state="building";
    if(recording)diagnostics.logEvent("chunk","chunk-generation-started",{key:chunk.key,cx:chunk.cx,cz:chunk.cz});
    chunk.detail=this.buildChunk?.(chunk)??new THREE.Group();chunk.detail.name=`detail-${chunk.key}`;chunk.detail.visible=false;
    this.scene.add(chunk.detail);chunk.state="loaded";chunk.lastUsed=performance.now();
    if(recording){const durationMs=performance.now()-startedAt;diagnostics.incrementCounter("chunkGeneration");diagnostics.recordSystemTiming("chunkGeneration",durationMs);diagnostics.logEvent("chunk","chunk-generated",{key:chunk.key,cx:chunk.cx,cz:chunk.cz,durationMs,buildings:chunk.buildings?.length??0,specials:chunk.specials?.length??0});}
  }

  desiredKeys(nowSeconds){
    const desired=new Set(this.visibleTargetKeys);
    for(const[key,until]of [...this.previousVisibleUntil]){
      if(nowSeconds<until)desired.add(key);
      else this.previousVisibleUntil.delete(key);
    }
    return desired;
  }

  applyVisibility(nowSeconds){
    const desired=this.desiredKeys(nowSeconds);this.visibleDetailKeys.clear();this.visibleBuildingKeys.clear();this.visibleLowBuildingKeys.clear();
    for(const chunk of this.chunks.values()){
      const fullInfrastructure=desired.has(chunk.key)&&chunk.state==="loaded";
      const fullBuildings=(chunk.key===this.currentKey||this.buildingHaloKeys.has(chunk.key))&&chunk.state==="loaded";
      const lowBuildings=!fullBuildings&&desired.has(chunk.key)&&Boolean(chunk.lowBuildings);
      if(chunk.detail){
        chunk.detail.visible=fullInfrastructure||fullBuildings;
        const infrastructure=chunk.detail.userData?.infrastructureGroup,buildings=chunk.detail.userData?.buildingGroup;
        if(infrastructure)infrastructure.visible=fullInfrastructure;if(buildings)buildings.visible=fullBuildings;
      }
      if(chunk.lowBuildings)chunk.lowBuildings.visible=lowBuildings;
      if(chunk.outline){
        chunk.outline.visible=!fullInfrastructure||!fullBuildings;
        if(chunk.outlineRoad)chunk.outlineRoad.visible=!fullInfrastructure;
        if(chunk.outlineBuildings)chunk.outlineBuildings.visible=!fullBuildings&&!lowBuildings;
      }
      if(fullInfrastructure){chunk.lastUsed=performance.now();this.visibleDetailKeys.add(chunk.key);}
      if(fullBuildings){chunk.lastUsed=performance.now();this.visibleBuildingKeys.add(chunk.key);}
      if(lowBuildings)this.visibleLowBuildingKeys.add(chunk.key);
    }
  }

  updateOutlineAppearance(){
    for(const chunk of this.chunks.values()){
      const cx=(chunk.cx+.5)*this.chunkSize,cz=(chunk.cz+.5)*this.chunkSize;
      const dist=Math.hypot(cx-this.focus.x,cz-this.focus.z),fade=THREE.MathUtils.clamp((dist-this.chunkSize*.75)/(this.chunkSize*2.8),0,1);
      if(chunk.outlineRoad){const eligible=!this.visibleDetailKeys.has(chunk.key)&&dist<qualityManager.current.world.roadOutlineDistance;chunk.outlineRoad.visible=eligible;if(eligible)chunk.outlineRoad.material.opacity=.07+fade*.07;}
      if(chunk.outlineBuildings){const eligible=!this.visibleBuildingKeys.has(chunk.key)&&!this.visibleLowBuildingKeys.has(chunk.key)&&dist<qualityManager.current.world.buildingOutlineDistance;chunk.outlineBuildings.visible=eligible;if(eligible)chunk.outlineBuildings.material.opacity=.05+fade*.10;}
      if(chunk.outline)chunk.outline.visible=Boolean(chunk.outlineRoad?.visible||chunk.outlineBuildings?.visible);
    }
  }

  evictHidden(){
    const protectedKeys=new Set([...this.visibleDetailKeys,...this.visibleBuildingKeys,...this.futurePreloadKeys]);
    const loaded=[...this.chunks.values()].filter(c=>c.state==="loaded"&&!protectedKeys.has(c.key));
    const cacheLimit=qualityManager.current.world.maxCachedDetailedChunks;this.maxCachedDetailed=cacheLimit;const allowed=Math.max(0,cacheLimit-protectedKeys.size);if(loaded.length<=allowed)return;
    loaded.sort((a,b)=>a.lastUsed-b.lastUsed);
    for(const chunk of loaded.slice(0,loaded.length-allowed)){
      if(chunk.detail){this.scene.remove(chunk.detail);chunk.detail.traverse?.(o=>{if(o.isInstancedMesh)o.dispose?.();});chunk.detail.clear();chunk.detail=null;}
      chunk.state="unloaded";if(diagnostics.isEnabled())diagnostics.logEvent("chunk","chunk-evicted",{key:chunk.key,lastUsed:chunk.lastUsed});
    }
  }

  isDetailedPosition(position){return this.visibleDetailKeys.has(chunkKeyForPosition(position,this.chunkSize));}
  isDetailedXZ(x,z){return this.visibleDetailKeys.has(chunkKey(chunkCoord(x,this.chunkSize),chunkCoord(z,this.chunkSize)));}
  renderTierForPosition(position,focus=this.focus){
    const key=chunkKeyForPosition(position,this.chunkSize);
    if(key===this.currentKey&&position.distanceToSquared(focus)<=qualityManager.current.world.fullVehicleDistance*qualityManager.current.world.fullVehicleDistance)return"full";
    if(this.visibleDetailKeys.has(key))return"low";
    return"outline";
  }

  getStats(){
    return{
      current:this.currentKey??"—",
      preload:this.preloadKey??"—",
      neighbours:this.neighbourhoodKeys.size,
      ahead:this.aheadKeys.size,
      visible:this.visibleDetailKeys.size,
      buildingOnly:this.visibleBuildingKeys.size,
      lowBuildings:this.visibleLowBuildingKeys.size,
      preloaded:[...this.futurePreloadKeys].filter(key=>this.chunkByKey(key).state==="loaded").length,
      cached:[...this.chunks.values()].filter(c=>c.state==="loaded").length,
      queued:this.queue.length,
      total:this.chunks.size,
      queueMs:this.lastQueueMs,
      buildMs:this.lastBuildMs,
      builtThisFrame:this.lastBuiltCount,
      maximumBuildMs:this.maximumBuildMs
    };
  }

  toggleDebug(){this.debugVisible=!this.debugVisible;this.debugGroup.visible=this.debugVisible;return this.debugVisible;}
  updateDebugRects(){
    const place=(mesh,key)=>{if(!key){mesh.visible=false;return;}const[cx,cz]=key.split(":").map(Number);mesh.position.set((cx+.5)*this.chunkSize,0,(cz+.5)*this.chunkSize);mesh.visible=true;};
    const repopulate=(group,keys,color)=>{
      group.clear();
      for(const key of keys){
        if(key===this.currentKey||key===this.preloadKey)continue;
        const rect=this.createDebugRect(color);place(rect,key);group.add(rect);
      }
    };
    place(this.currentDebug,this.currentKey);place(this.preloadDebug,this.preloadKey);
    repopulate(this.neighbourDebugGroup,this.neighbourhoodKeys,0x78d49a);
    repopulate(this.aheadDebugGroup,this.aheadKeys,0xf1c86a);
  }
}
