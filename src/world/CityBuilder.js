import * as THREE from "three";
import { CONFIG,mulberry32 } from "../config.js?v=20261002-flight-sim-terrain";
import { WORLD_DEFINITION,worldHeight,worldWidth } from "./WorldDefinition.js?v=20261002-flight-sim-terrain";
import { WorldChunkManager } from "./WorldChunkManager.js?v=20261002-flight-sim-terrain";
import { createRailPlan,getRailReservationSegments } from "../rail/RailPlan.js?v=20261002-flight-sim-terrain";

function pointSegmentDistance2D(px,pz,ax,az,bx,bz){
  const abx=bx-ax,abz=bz-az,apx=px-ax,apz=pz-az,denom=abx*abx+abz*abz||1;
  const t=Math.max(0,Math.min(1,(apx*abx+apz*abz)/denom));
  const dx=px-(ax+abx*t),dz=pz-(az+abz*t);return{distance:Math.hypot(dx,dz),t};
}

function stripMatrix(a,b,width,y=.02,overlap=.35){
  const len=a.distanceTo(b),mid=a.clone().add(b).multiplyScalar(.5),dummy=new THREE.Object3D();
  dummy.position.set(mid.x,y,mid.z);dummy.rotation.set(-Math.PI/2,0,-Math.atan2(b.z-a.z,b.x-a.x)+Math.PI/2);
  dummy.scale.set(width,len+overlap,1);dummy.updateMatrix();return dummy.matrix.clone();
}

function boxMatrix(a,b,width,height,y=0,overlap=.25){
  const len=a.distanceTo(b),mid=a.clone().add(b).multiplyScalar(.5),dummy=new THREE.Object3D();
  dummy.position.set(mid.x,y+height*.5,mid.z);dummy.rotation.y=Math.atan2(b.x-a.x,b.z-a.z);
  dummy.scale.set(width,height,len+overlap);dummy.updateMatrix();return dummy.matrix.clone();
}

function transformMatrix(x,y,z,sx,sy,sz,rx=0,ry=0,rz=0){
  const dummy=new THREE.Object3D();dummy.position.set(x,y,z);dummy.rotation.set(rx,ry,rz);dummy.scale.set(sx,sy,sz);dummy.updateMatrix();return dummy.matrix.clone();
}

function buildingMatrix(b,lx,y,lz,sx,sy,sz,localRy=0,rx=0,rz=0){
  const rotation=b.rotation??0,c=Math.cos(rotation),s=Math.sin(rotation);
  const x=b.x+lx*c+lz*s,z=b.z-lx*s+lz*c;
  return transformMatrix(x,y,z,sx,sy,sz,rx,rotation+localRy,rz);
}

function addInstances(parent,geometry,material,matrices,{castShadow=false,receiveShadow=false}={}){
  if(!matrices.length)return null;
  const mesh=new THREE.InstancedMesh(geometry,material,matrices.length);mesh.castShadow=castShadow;mesh.receiveShadow=receiveShadow;
  matrices.forEach((matrix,i)=>mesh.setMatrixAt(i,matrix));mesh.instanceMatrix.setUsage(THREE.StaticDrawUsage);mesh.computeBoundingSphere();mesh.matrixAutoUpdate=false;mesh.updateMatrix();parent.add(mesh);return mesh;
}

function overlapsAABB(a,b,pad=0){return Math.abs(a.x-b.x)<a.halfW+b.halfW+pad&&Math.abs(a.z-b.z)<a.halfD+b.halfD+pad;}
function pushBucket(map,key,matrix){if(!map.has(key))map.set(key,[]);map.get(key).push(matrix);}
function rotatedExtents(w,d,rotation){const c=Math.abs(Math.cos(rotation)),s=Math.abs(Math.sin(rotation));return{halfW:(w*c+d*s)*.5,halfD:(w*s+d*c)*.5};}

function convexHullXZ(points){
  const unique=[...new Map(points.map(p=>[`${p.x.toFixed(4)}:${p.z.toFixed(4)}`,p])).values()].sort((a,b)=>a.x-b.x||a.z-b.z);
  if(unique.length<=3)return unique;
  const cross=(o,a,b)=>(a.x-o.x)*(b.z-o.z)-(a.z-o.z)*(b.x-o.x);
  const lower=[];for(const p of unique){while(lower.length>=2&&cross(lower.at(-2),lower.at(-1),p)<=0)lower.pop();lower.push(p);}
  const upper=[];for(let i=unique.length-1;i>=0;i--){const p=unique[i];while(upper.length>=2&&cross(upper.at(-2),upper.at(-1),p)<=0)upper.pop();upper.push(p);}
  lower.pop();upper.pop();return[...lower,...upper];
}


function proceduralTexture(size,pixelFn,{repeatX=1,repeatY=1}={}){
  const data=new Uint8Array(size*size*4);
  for(let y=0;y<size;y++)for(let x=0;x<size;x++){const [r,g,b,a=255]=pixelFn(x,y,size);const i=(y*size+x)*4;data[i]=r;data[i+1]=g;data[i+2]=b;data[i+3]=a;}
  const texture=new THREE.DataTexture(data,size,size,THREE.RGBAFormat);texture.wrapS=THREE.RepeatWrapping;texture.wrapT=THREE.RepeatWrapping;texture.repeat.set(repeatX,repeatY);texture.needsUpdate=true;if("colorSpace" in texture)texture.colorSpace=THREE.SRGBColorSpace;return texture;
}

function createGroundTexture(seed=CONFIG.seed){
  const random=mulberry32(seed^0x51f15e),phaseA=random()*Math.PI*2,phaseB=random()*Math.PI*2;
  return proceduralTexture(128,(x,y,size)=>{
    const nx=x/size,ny=y/size,low=Math.sin(nx*Math.PI*6+phaseA)*6+Math.cos(ny*Math.PI*5+phaseB)*5,furrow=Math.sin((x+y*.22)*Math.PI/7)*3,noise=(random()-.5)*10;
    return[84+low+noise*.45,105+low+noise,73+low*.55+furrow+noise*.35,255];
  },{repeatX:18,repeatY:16});
}

function createWaterTexture(seed=CONFIG.seed){
  const random=mulberry32(seed^0x0cea5eed),phase=random()*Math.PI*2;
  return proceduralTexture(128,(x,y)=>{
    const wave=Math.sin(x*.34+y*.12+phase)*12+Math.sin(x*.11-y*.27+phase*.7)*8,glint=Math.max(0,Math.sin(x*.62+y*.21+phase))*12,noise=(random()-.5)*5;
    return[174+wave*.18+noise,207+wave*.32+glint+noise,220+wave*.45+glint+noise,255];
  },{repeatX:22,repeatY:17});
}

function createFieldTexture(seed=CONFIG.seed){
  const random=mulberry32(seed^0x7a11f13d);
  return proceduralTexture(64,(x,y)=>{const rows=Math.sin((y+Math.sin(x*.18)*1.7)*Math.PI/3.2)*17,tram=Math.abs((x%20)-10)<1.3?-18:0,noise=(random()-.5)*9,value=THREE.MathUtils.clamp(215+rows+tram+noise,155,245);return[value,value,value,255];},{repeatX:7,repeatY:5});
}

function createGableRoofGeometry(){
  const vertices=new Float32Array([
    -.5,0,-.5, .5,0,-.5, 0,1,-.5,
    -.5,0,.5,  .5,0,.5,  0,1,.5
  ]);
  const indices=[
    0,1,2, 3,5,4,
    0,3,4,0,4,1,
    0,2,5,0,5,3,
    1,4,5,1,5,2
  ];
  const geometry=new THREE.BufferGeometry();geometry.setAttribute("position",new THREE.BufferAttribute(vertices,3));geometry.setIndex(indices);geometry.computeVertexNormals();return geometry;
}

export class CityBuilder{
  constructor(scene,graph,definition=WORLD_DEFINITION){
    this.scene=scene;this.graph=graph;this.definition=definition;this.roadMaterials=[];this.colliders=[];this.lots=[];this.random=mulberry32(CONFIG.seed);
    this.railPlan=createRailPlan(definition,graph);this.railSegments=getRailReservationSegments(this.railPlan);
    this.reservedZones=[
      ...definition.reservedZones.map(zone=>({...zone})),
      ...this.railPlan.stations.flatMap(station=>{
        const access=station.roadAccess?.position??station.position,mid=station.position.clone().add(access).multiplyScalar(.5);
        return[
          {id:`rail-station-${station.id}`,x:station.x,z:station.z,halfW:72,halfD:46},
          {id:`rail-access-${station.id}`,x:mid.x,z:mid.z,halfW:Math.max(16,Math.abs(access.x-station.x)*.5+8),halfD:Math.max(16,Math.abs(access.z-station.z)*.5+8)}
        ];
      })
    ];
    this.buildRoadReservations();this.createSharedResources();
    this.permanentRoadGroup=new THREE.Group();this.permanentRoadGroup.name="permanent-road-junctions";this.scene.add(this.permanentRoadGroup);
    this.chunkManager=new WorldChunkManager(scene,{worldDefinition:definition,buildChunk:chunk=>this.createChunkDetail(chunk)});
  }

  createSharedResources(){
    this.geometry={
      plane:new THREE.PlaneGeometry(1,1),box:new THREE.BoxGeometry(1,1,1),circle:new THREE.CircleGeometry(1,28),
      cylinder:new THREE.CylinderGeometry(1,1,1,8),sphere:new THREE.SphereGeometry(1,10,8),gableRoof:createGableRoofGeometry(),
      stationRoof:new THREE.CylinderGeometry(27,27,142,24,1,false,0,Math.PI),boat:new THREE.CapsuleGeometry(1,3.8,4,10),
      pole:new THREE.CylinderGeometry(.08,.12,5.2,8),lamp:new THREE.BoxGeometry(.42,.18,.28),
      trunk:new THREE.CylinderGeometry(.18,.24,2.2,8),crown:new THREE.SphereGeometry(1.35,10,8),bollard:new THREE.CylinderGeometry(.11,.14,.9,8),flower:new THREE.SphereGeometry(.22,8,6),shrub:new THREE.SphereGeometry(1,12,8),signDisc:new THREE.CircleGeometry(.58,24)
    };
    this.groundTexture=createGroundTexture();this.waterTexture=createWaterTexture();this.fieldTexture=createFieldTexture();
    this.materials={
      asphalt:new THREE.MeshStandardMaterial({color:0x24292c,roughness:.88,metalness:.025}),
      sidewalk:new THREE.MeshStandardMaterial({color:0x85867f,roughness:.95}),curb:new THREE.MeshStandardMaterial({color:0xa6a59d,roughness:.94}),
      white:new THREE.MeshBasicMaterial({color:0xf0eee2,transparent:true,opacity:.92}),yellow:new THREE.MeshBasicMaterial({color:0xd4ad35,transparent:true,opacity:.86}),
      median:new THREE.MeshStandardMaterial({color:0x465046,roughness:.98}),barrier:new THREE.MeshStandardMaterial({color:0xb8b8b2,roughness:.82,metalness:.12}),
      trim:new THREE.MeshStandardMaterial({color:0x3c4143,roughness:.7,metalness:.12}),roof:new THREE.MeshStandardMaterial({color:0x51443e,roughness:.94}),
      glass:new THREE.MeshStandardMaterial({color:0x496673,emissive:0x13262e,emissiveIntensity:.48,roughness:.24,metalness:.34}),
      shopGlass:new THREE.MeshStandardMaterial({color:0x304d59,emissive:0x17323d,emissiveIntensity:.72,roughness:.18,metalness:.4}),
      door:new THREE.MeshStandardMaterial({color:0x392d27,roughness:.82}),sign:new THREE.MeshStandardMaterial({color:0x71bfd8,emissive:0x174d5c,emissiveIntensity:1.1}),
      pole:new THREE.MeshStandardMaterial({color:0x303537,roughness:.78}),lamp:new THREE.MeshStandardMaterial({color:0xf0e6b8,emissive:0x8d7d43,emissiveIntensity:.35}),
      trunk:new THREE.MeshStandardMaterial({color:0x5a4431,roughness:.97}),leaf:new THREE.MeshStandardMaterial({color:0x315f39,roughness:.96}),bollard:new THREE.MeshStandardMaterial({color:0x4a4f51,roughness:.78}),
      station:new THREE.MeshStandardMaterial({color:0x92918d,roughness:.62}),stationRoof:new THREE.MeshPhysicalMaterial({color:0x456e7d,metalness:.24,roughness:.24,transparent:true,opacity:.84}),
      tower:new THREE.MeshStandardMaterial({color:0x596a72,roughness:.42,metalness:.22}),crown:new THREE.MeshStandardMaterial({color:0x35464d,emissive:0x15232a,emissiveIntensity:.26}),
      plaza:new THREE.MeshStandardMaterial({color:0x99978f,roughness:.96}),fountain:new THREE.MeshStandardMaterial({color:0x777b7d,roughness:.72}),
      quay:new THREE.MeshStandardMaterial({color:0x72736e,roughness:.91}),dock:new THREE.MeshStandardMaterial({color:0x514940,roughness:.93}),
      boatA:new THREE.MeshStandardMaterial({color:0xe6e4dd,roughness:.48,metalness:.1}),boatB:new THREE.MeshStandardMaterial({color:0x345f79,roughness:.48,metalness:.1}),
      ruralHedge:new THREE.MeshStandardMaterial({color:0x294b2d,roughness:1}),farmTrack:new THREE.MeshStandardMaterial({color:0x816e4e,roughness:1}),barnWall:new THREE.MeshStandardMaterial({color:0x77513f,roughness:.94}),barnRoof:new THREE.MeshStandardMaterial({color:0x493b35,roughness:.92}),silo:new THREE.MeshStandardMaterial({color:0x92958e,roughness:.72,metalness:.12}),
      roundaboutGrass:new THREE.MeshStandardMaterial({color:0x426a3f,roughness:.98}),roundaboutCurb:new THREE.MeshStandardMaterial({color:0xd4d1c8,roughness:.9}),
      flowerA:new THREE.MeshStandardMaterial({color:0xe85c73,roughness:.82}),flowerB:new THREE.MeshStandardMaterial({color:0xf1c84b,roughness:.82}),flowerC:new THREE.MeshStandardMaterial({color:0x9c78d5,roughness:.82}),roundaboutSign:new THREE.MeshStandardMaterial({color:0x2876c7,roughness:.52,metalness:.08})
    };
    this.facadeMaterials=new Map();this.roadMaterials.push(this.materials.asphalt);this.streetLightMaterial=this.materials.lamp;
  }

  facadeMaterial(color){
    if(!this.facadeMaterials.has(color)){
      const base=new THREE.Color(color),emissive=base.clone().multiplyScalar(.18);
      this.facadeMaterials.set(color,new THREE.MeshStandardMaterial({color:base,emissive,emissiveIntensity:.18,roughness:.76,metalness:.055}));
    }
    return this.facadeMaterials.get(color);
  }

  build(){
    this.buildTerrain();this.buildRoads();this.buildWaterfront();this.buildLandmarks();this.buildDistricts();this.buildRuralScenery();this.buildStreetFurniture();this.chunkManager.finalize();
    return{roadMaterials:this.roadMaterials,colliders:this.colliders,chunkManager:this.chunkManager,railPlan:this.railPlan,worldDefinition:this.definition};
  }
  initializeStreaming(position,heading,speed=0){this.chunkManager.initialize(position,heading,speed);}
  initializeStreamingAsync(position,heading,speed=0,onProgress){return this.chunkManager.initializeAsync(position,heading,speed,onProgress);}
  updateStreaming(position,heading,speed,time){this.chunkManager.update(position,heading,speed,time);}

  buildRoadReservations(){
    this.roadSegments=[];
    for(const road of this.graph.roads.values()){
      const pts=road.centerCurve.getPoints(Math.max(28,Math.ceil(road.length/6)));
      for(let i=0;i<pts.length-1;i++)this.roadSegments.push({a:pts[i],b:pts[i+1],radius:road.width*.5+road.sidewalkWidth+1.1,road});
    }
    this.junctionZones=[];
    for(const node of this.graph.nodes.values()){
      const connected=node.connectedRoadIds?.map(id=>this.graph.roads.get(id))??[];
      this.junctionZones.push({x:node.position.x,z:node.position.z,radius:Math.max(node.junctionRadius??0,connected.length?Math.max(...connected.map(r=>r.width*.5))+2:4),degree:connected.length,control:node.control});
    }
  }

  buildTerrain(){
    const bounds=this.definition.bounds,seaMaterial=new THREE.MeshPhysicalMaterial({color:0x2b6c82,map:this.waterTexture,bumpMap:this.waterTexture,bumpScale:.055,roughness:.24,metalness:.16,transmission:.02,transparent:true,opacity:.97});
    const ocean=new THREE.Mesh(new THREE.PlaneGeometry(worldWidth(this.definition),worldHeight(this.definition)),seaMaterial);
    ocean.position.set((bounds.minX+bounds.maxX)*.5,-.34,(bounds.minZ+bounds.maxZ)*.5);ocean.rotation.x=-Math.PI/2;ocean.receiveShadow=false;ocean.name="regional-sea";this.scene.add(ocean);this.ocean=ocean;
    const cityBounds=this.definition.mapRegions?.city??bounds,cityWidth=cityBounds.maxX-cityBounds.minX,cityHeight=cityBounds.maxZ-cityBounds.minZ;
    const ground=new THREE.Mesh(new THREE.PlaneGeometry(cityWidth,cityHeight),new THREE.MeshStandardMaterial({color:0xffffff,map:this.groundTexture,roughness:1}));
    ground.position.x=(cityBounds.minX+cityBounds.maxX)*.5;ground.position.z=(cityBounds.minZ+cityBounds.maxZ)*.5;
    ground.rotation.x=-Math.PI/2;ground.position.y=-.10;ground.receiveShadow=true;ground.name="eastmere-mainland";this.scene.add(ground);
  }

  addRoadSegment(type,a,b,width,y=.02,overlap=.4){
    const matrix=stripMatrix(a,b,width,y,overlap),mid=a.clone().add(b).multiplyScalar(.5);this.chunkManager.addRoadMatrix(mid.x,mid.z,type,matrix);
  }

  offsetPoint(road,t,offset){
    const p=road.centerCurve.getPointAt(THREE.MathUtils.clamp(t,0,1)),tan=road.centerCurve.getTangentAt(THREE.MathUtils.clamp(t,0,1)).setY(0).normalize();
    return p.addScaledVector(new THREE.Vector3(-tan.z,0,tan.x),offset);
  }

  roadRange(road,extraTrim=0){
    const startExtra=typeof extraTrim==="number"?extraTrim:(extraTrim.start??0),endExtra=typeof extraTrim==="number"?extraTrim:(extraTrim.end??0);
    return{
      start:THREE.MathUtils.clamp((road.startT??0)+startExtra/Math.max(1,road.length),0,.48),
      end:THREE.MathUtils.clamp((road.endT??1)-endExtra/Math.max(1,road.length),.52,1)
    };
  }

  curveRangePoints(road,spacing=4.6,extraTrim=0){
    const{start,end}=this.roadRange(road,extraTrim),distance=Math.max(2,(end-start)*road.length),segments=Math.max(3,Math.ceil(distance/spacing)),points=[];
    for(let i=0;i<=segments;i++)points.push(road.centerCurve.getPointAt(THREE.MathUtils.lerp(start,end,i/segments)));
    return points;
  }

  addSolidCurve(road,offset,width,y,type="white",trim=0){
    const{start,end}=this.roadRange(road,trim),distance=Math.max(1,(end-start)*road.length),segments=Math.max(3,Math.ceil(distance/5));
    for(let i=0;i<segments;i++){
      const t1=THREE.MathUtils.lerp(start,end,i/segments),t2=THREE.MathUtils.lerp(start,end,(i+1)/segments);
      this.addRoadSegment(type,this.offsetPoint(road,t1,offset),this.offsetPoint(road,t2,offset),width,y,.28);
    }
  }

  addDashedCurve(road,offset,width,y,{dash=4,gap=7,trim=12,type="white"}={}){
    const range=this.roadRange(road,trim),startDistance=range.start*road.length,endDistance=range.end*road.length;
    for(let distance=startDistance;distance<endDistance;distance+=dash+gap){
      const finish=Math.min(endDistance,distance+dash);if(finish<=distance)continue;
      this.addRoadSegment(type,this.offsetPoint(road,distance/road.length,offset),this.offsetPoint(road,finish/road.length,offset),width,y,.12);
    }
  }

  junctionMouth(road,node){
    const atStart=road.from===node.id,t=atStart?road.startT:road.endT;
    const centre=road.centerCurve.getPointAt(t),baseTangent=road.centerCurve.getTangentAt(t).setY(0).normalize();
    const away=atStart?baseTangent:baseTangent.clone().multiplyScalar(-1),normal=new THREE.Vector3(-away.z,0,away.x),half=road.width*.5+.30;
    return{road,centre,away,normal,left:centre.clone().addScaledVector(normal,half),right:centre.clone().addScaledVector(normal,-half)};
  }

  addSignalStopLine(node,road){
    const incoming=[...this.graph.lanes.values()].filter(l=>l.to===node.id&&l.roadId===road.id).sort((a,b)=>a.index-b.index);if(!incoming.length)return;
    const inner=incoming[0],outer=incoming.at(-1),tangent=inner.curve.getTangentAt(1).setY(0).normalize(),left=new THREE.Vector3(-tangent.z,0,tangent.x);
    const a=outer.curve.getPointAt(1).addScaledVector(left,road.laneWidth*.50),b=inner.curve.getPointAt(1).addScaledVector(left,-road.laneWidth*.50);
    this.addRoadSegment("white",a,b,.34,.078,.04);
  }

  addCrosswalk(node,road){
    const incoming=[...this.graph.lanes.values()].find(l=>l.to===node.id&&l.roadId===road.id);if(!incoming)return;
    const tangent=incoming.curve.getTangentAt(1).setY(0).normalize(),normal=new THREE.Vector3(-tangent.z,0,tangent.x),centre=incoming.curve.getPointAt(1).addScaledVector(tangent,-3.4),half=Math.max(2.4,road.width*.5-.35);
    for(let stripe=-2;stripe<=2;stripe++){
      const stripeCentre=centre.clone().addScaledVector(tangent,stripe*.92),a=stripeCentre.clone().addScaledVector(normal,-half),b=stripeCentre.clone().addScaledVector(normal,half);
      this.addRoadSegment("white",a,b,.42,.076,.04);
    }
  }

  addRoundaboutEntryMarking(node,road){
    const incoming=[...this.graph.lanes.values()].filter(l=>l.to===node.id&&l.roadId===road.id).sort((a,b)=>a.index-b.index);if(!incoming.length)return;
    const inner=incoming[0],outer=incoming.at(-1),tangent=inner.curve.getTangentAt(1).setY(0).normalize(),left=new THREE.Vector3(-tangent.z,0,tangent.x);
    const a=outer.curve.getPointAt(1).addScaledVector(left,road.laneWidth*.50).addScaledVector(tangent,-1.0),b=inner.curve.getPointAt(1).addScaledVector(left,-road.laneWidth*.50).addScaledVector(tangent,-1.0);
    this.addRoadSegment("white",a,b,.20,.078,.04);
    // UK give-way triangle on the left-hand approach, pointing towards circulating traffic.
    const kerbLane=outer,tip=kerbLane.curve.getPointAt(1).addScaledVector(tangent,-3.1),base=tip.clone().addScaledVector(tangent,-3.0);
    this.addRoadSegment("white",base.clone().addScaledVector(left,-1.18),tip,.18,.079,.02);
    this.addRoadSegment("white",tip,base.clone().addScaledVector(left,1.18),.18,.079,.02);
    this.addRoadSegment("white",base.clone().addScaledVector(left,-1.18),base.clone().addScaledVector(left,1.18),.18,.079,.02);
  }

  buildRoads(){
    for(const road of this.graph.roads.values()){
      const pts=this.curveRangePoints(road),roadWidth=road.width+.55;
      for(let i=0;i<pts.length-1;i++){
        const a=pts[i],b=pts[i+1],tangent=b.clone().sub(a).setY(0).normalize(),normal=new THREE.Vector3(-tangent.z,0,tangent.x);
        this.addRoadSegment("asphalt",a,b,roadWidth,.025,.80);
        const left=a.clone().addScaledVector(normal,roadWidth*.5),leftB=b.clone().addScaledVector(normal,roadWidth*.5),right=a.clone().addScaledVector(normal,-roadWidth*.5),rightB=b.clone().addScaledVector(normal,-roadWidth*.5);
        this.chunkManager.addOutlineSegment(left,leftB);this.chunkManager.addOutlineSegment(right,rightB);
      }

      const startNode=this.graph.nodes.get(road.from),endNode=this.graph.nodes.get(road.to);
      const edgeTrim={start:(startNode?.connectedRoadIds?.length??0)>1?1.1:0,end:(endNode?.connectedRoadIds?.length??0)>1?1.1:0};
      const edgePts=this.curveRangePoints(road,4.6,edgeTrim);
      for(let i=0;i<edgePts.length-1;i++){
        const a=edgePts[i],b=edgePts[i+1],tangent=b.clone().sub(a).setY(0).normalize(),normal=new THREE.Vector3(-tangent.z,0,tangent.x);
        if(road.category!=="motorway"){
          const sw=road.sidewalkWidth,sidewalkOffset=roadWidth*.5+sw*.5+.30,edgeOffset=roadWidth*.5+.08;
          if(sw>.7){
            this.addRoadSegment("sidewalk",a.clone().addScaledVector(normal,sidewalkOffset),b.clone().addScaledVector(normal,sidewalkOffset),sw,.052,.70);
            this.addRoadSegment("sidewalk",a.clone().addScaledVector(normal,-sidewalkOffset),b.clone().addScaledVector(normal,-sidewalkOffset),sw,.052,.70);
          }
          const ca=a.clone().addScaledVector(normal,edgeOffset),cb=b.clone().addScaledVector(normal,edgeOffset),ra=a.clone().addScaledVector(normal,-edgeOffset),rb=b.clone().addScaledVector(normal,-edgeOffset),cm=ca.clone().add(cb).multiplyScalar(.5),rm=ra.clone().add(rb).multiplyScalar(.5);
          this.chunkManager.addRoadMatrix(cm.x,cm.z,"curb",boxMatrix(ca,cb,.18,.15,.035,.30));this.chunkManager.addRoadMatrix(rm.x,rm.z,"curb",boxMatrix(ra,rb,.18,.15,.035,.30));
        }
      }

      if(road.medianWidth>0){
        const medianPts=this.curveRangePoints(road,4.6,{start:edgeTrim.start+1.8,end:edgeTrim.end+1.8});
        for(let i=0;i<medianPts.length-1;i++){
          const a=medianPts[i],b=medianPts[i+1],tangent=b.clone().sub(a).setY(0).normalize(),normal=new THREE.Vector3(-tangent.z,0,tangent.x),mid=a.clone().add(b).multiplyScalar(.5);
          this.chunkManager.addRoadMatrix(mid.x,mid.z,"median",boxMatrix(a,b,road.medianWidth*.66,.16,.025,.42));
          if(road.category==="motorway")for(const side of[-1,1]){
            const oa=a.clone().addScaledVector(normal,side*road.medianWidth*.37),ob=b.clone().addScaledVector(normal,side*road.medianWidth*.37),om=oa.clone().add(ob).multiplyScalar(.5);
            this.chunkManager.addRoadMatrix(om.x,om.z,"curb",boxMatrix(oa,ob,.12,.48,.08,.34));
          }
        }
      }
      const trim=road.category==="motorway"?8:road.speedLimit<=30?3.5:5.5;
      if(!road.oneWay){
        if(road.medianWidth>0){this.addSolidCurve(road,road.medianWidth*.5+.14,.10,.068,"white",trim);this.addSolidCurve(road,-road.medianWidth*.5-.14,.10,.068,"white",trim);}
        else this.addDashedCurve(road,0,.105,.068,{dash:road.laneWidth<3.15?2.8:4.2,gap:road.laneWidth<3.15?5.8:7.2,trim});
      }
      for(const side of[-1,1])for(let divider=1;divider<road.lanesEachWay;divider++)this.addDashedCurve(road,side*(road.medianWidth*.5+divider*road.laneWidth),.09,.067,{dash:4,gap:7.5,trim});
      if(road.category==="motorway"||road.speedLimit>=60||road.lanesEachWay>1){const edge=road.width*.5-.28;this.addSolidCurve(road,edge,.11,.067,"white",trim*.55);this.addSolidCurve(road,-edge,.11,.067,"white",trim*.55);}
    }

    for(const node of this.graph.nodes.values()){
      const connected=(node.connectedRoadIds??[]).map(id=>this.graph.roads.get(id));
      if(connected.length===1){
        const road=connected[0],radius=road.width*.53+.35,special={type:"roadEndCap",permanent:true,x:node.position.x,z:node.position.z,radius};
        this.addInfrastructureSpecials(this.permanentRoadGroup,[special]);this.chunkManager.addSpecial(special);continue;
      }
      if(connected.length<2)continue;
      if(node.control==="roundabout"){
        const special={type:"roundabout",permanent:true,x:node.position.x,z:node.position.z,nodeId:node.id,outerRadius:node.roundaboutRadius,innerRadius:node.roundaboutInnerRadius,approaches:connected.map(road=>{const mouth=this.junctionMouth(road,node);return{x:mouth.away.x,z:mouth.away.z,width:road.width,centre:{x:mouth.centre.x,z:mouth.centre.z},left:{x:mouth.left.x,z:mouth.left.z},right:{x:mouth.right.x,z:mouth.right.z}};})};
        this.addInfrastructureSpecials(this.permanentRoadGroup,[special]);this.chunkManager.addSpecial(special);
        for(const road of connected)this.addRoundaboutEntryMarking(node,road);
      }else{
        let special;
        if(connected.length>=3){
          const radius=Math.max(node.junctionRadius??0,...connected.map(road=>road.width*.5+.9));
          special={type:"junctionApron",permanent:true,x:node.position.x,z:node.position.z,nodeId:node.id,radius};
        }else{
          const corners=[];for(const road of connected){const mouth=this.junctionMouth(road,node);corners.push(mouth.left,mouth.right);}
          const hull=convexHullXZ(corners);special={type:"junctionSurface",permanent:true,x:node.position.x,z:node.position.z,nodeId:node.id,points:hull.map(p=>({x:p.x,z:p.z}))};
        }
        this.addInfrastructureSpecials(this.permanentRoadGroup,[special]);this.chunkManager.addSpecial(special);
        if(node.control==="signal")for(const road of connected){this.addSignalStopLine(node,road);this.addCrosswalk(node,road);}
      }
    }
  }

  nearestRoadInfo(x,z){
    let best=null;
    for(const s of this.roadSegments){
      const result=pointSegmentDistance2D(x,z,s.a.x,s.a.z,s.b.x,s.b.z);
      if(!best||result.distance<best.distance){
        const tangent=s.b.clone().sub(s.a).setY(0).normalize(),closest=new THREE.Vector3(
          s.a.x+(s.b.x-s.a.x)*result.t,0,s.a.z+(s.b.z-s.a.z)*result.t
        );
        best={distance:result.distance,tangent,road:s.road,closest};
      }
    }
    return best;
  }

  isFootprintClear(x,z,w,d,setback=3,rotation=0){
    const radius=Math.hypot(w*.5,d*.5);
    for(const s of this.roadSegments)if(pointSegmentDistance2D(x,z,s.a.x,s.a.z,s.b.x,s.b.z).distance<s.radius+setback+radius)return false;
    for(const rail of this.railSegments)if(pointSegmentDistance2D(x,z,rail.a.x,rail.a.z,rail.b.x,rail.b.z).distance<rail.radius+setback+radius)return false;
    for(const j of this.junctionZones)if(Math.hypot(x-j.x,z-j.z)<j.radius+radius+setback)return false;
    const ext=rotatedExtents(w,d,rotation),candidate={x,z,...ext};
    for(const r of this.reservedZones)if(overlapsAABB(candidate,r,3))return false;
    for(const lot of this.lots)if(overlapsAABB(candidate,lot,2.8))return false;
    return true;
  }

  reserveLot(x,z,w,d,id=null,rotation=0,metadata={}){
    const ext=rotatedExtents(w,d,rotation),collisionInset=.08,collisionHalfW=Math.max(.2,w*.5-collisionInset),collisionHalfD=Math.max(.2,d*.5-collisionInset);
    const collisionExt=rotatedExtents(collisionHalfW*2,collisionHalfD*2,rotation),lot={
      id:id??`bld-${String(this.lots.length+1).padStart(4,"0")}`,x,z,...ext,rotation,w,d,
      colliderType:"obb",collisionRotation:rotation,collisionHalfW,collisionHalfD,collisionAabbHalfW:collisionExt.halfW,collisionAabbHalfD:collisionExt.halfD,
      visualHalfW:w*.5,visualHalfD:d*.5,visualHeight:metadata.visualHeight??metadata.height??4,visualMinimumY:metadata.visualMinimumY??0,boundaryCategory:metadata.boundaryCategory??"building",boundaryType:metadata.boundaryType??metadata.district??"building",boundarySource:metadata.boundarySource??"procedural-city",district:metadata.district??null
    };
    this.lots.push(lot);this.colliders.push(lot);return lot;
  }

  validateRoadBuildingClearance(){
    const violations=[];
    for(const lot of this.lots){
      const radius=Math.hypot((lot.w??lot.halfW*2)*.5,(lot.d??lot.halfD*2)*.5);
      for(const s of this.roadSegments)if(pointSegmentDistance2D(lot.x,lot.z,s.a.x,s.a.z,s.b.x,s.b.z).distance<s.radius+radius){violations.push({buildingId:lot.id,roadId:s.road.id});break;}
      if(!violations.some(v=>v.buildingId===lot.id))for(const rail of this.railSegments)if(pointSegmentDistance2D(lot.x,lot.z,rail.a.x,rail.a.z,rail.b.x,rail.b.z).distance<rail.radius+radius){violations.push({buildingId:lot.id,roadId:"rail-corridor"});break;}
    }
    return violations;
  }

  buildDistricts(){
    const palettes={
      cbd:[0x71808a,0x879197,0x64747e,0x8b8179],old:[0xa47c65,0x9a846e,0x82695c,0xb09272],
      res:[0xa69984,0x8f8173,0xb0a38e],ind:[0x6d787d,0x817d72,0x626b70],water:[0x71848d,0x918f84],
      commercial:[0x81838a,0x958a7e,0x727b82],hub:[0x75818a,0x8b8379]
    };
    for(const d of this.definition.districts){
      const step=d.id==="cbd"?31:d.id==="old"?26:d.id==="res"?37:35;
      for(let x=d.minX+step*.5;x<d.maxX;x+=step)for(let z=d.minZ+step*.5;z<d.maxZ;z+=step){
        if(this.random()>d.density)continue;
        let w=step*(.50+this.random()*.24),dep=step*(.46+this.random()*.25);
        const px=x+(this.random()-.5)*7,pz=z+(this.random()-.5)*7,road=this.nearestRoadInfo(px,pz);
        const rotation=road?Math.atan2(road.tangent.x,road.tangent.z)-Math.PI/2:0;
        const localZ=new THREE.Vector3(Math.sin(rotation),0,Math.cos(rotation));
        const toRoad=road?.closest?.clone().sub(new THREE.Vector3(px,0,pz));
        const frontSign=toRoad&&toRoad.lengthSq()>0&&toRoad.dot(localZ)<0?-1:1;
        let h=d.height[0]+this.random()*(d.height[1]-d.height[0]);
        if(d.id==="res")h=this.random()>.78?12:6.8+this.random()*3.2;
        if(d.id==="old")h=9+this.random()*10;
        const wallRatio=d.id==="res"?.68:d.id==="old"?.76:1,wallHeight=h*wallRatio,roofHeight=h-wallHeight;
        if(!this.isFootprintClear(px,pz,w,dep,d.id==="old"?1.7:3.6,rotation))continue;
        const colors=palettes[d.id]??palettes.cbd,facadeColor=colors[Math.floor(this.random()*colors.length)],id=`bld-${String(this.lots.length+1).padStart(4,"0")}`;
        this.chunkManager.addBuilding({id,district:d.id,x:px,z:pz,w,d:dep,h,wallHeight,roofHeight,rotation,frontSign,facadeColor});
        this.reserveLot(px,pz,w,dep,id,rotation,{visualHeight:h,district:d.id,boundaryType:`${d.id}-building`});
      }
    }
  }

  buildWaterfront(){
    const waterMat=new THREE.MeshPhysicalMaterial({color:0x3a788d,map:this.waterTexture,bumpMap:this.waterTexture,bumpScale:.07,roughness:.20,metalness:.18,transmission:.03,transparent:true,opacity:.95});
    const water=new THREE.Mesh(new THREE.PlaneGeometry(170,370),waterMat);water.rotation.x=-Math.PI/2;water.position.set(605,-.035,-420);water.receiveShadow=false;this.scene.add(water);this.water=water;
    this.chunkManager.addSpecial({type:"quay",x:515,z:-420,w:18,d:360});
    for(let i=0;i<5;i++){const z=-535+i*57;this.chunkManager.addSpecial({type:"dock",x:575,z,w:150,d:7});this.chunkManager.addSpecial({type:"boat",x:625,z:z+9,w:4.4,d:12,index:i});}
  }

  buildLandmarks(){
    this.chunkManager.addSpecial({type:"tower",x:78,z:72});this.colliders.push({id:"tower",x:78,z:72,halfW:23,halfD:23,colliderType:"obb",collisionRotation:0,collisionHalfW:22.92,collisionHalfD:22.92,collisionAabbHalfW:22.92,collisionAabbHalfD:22.92,visualHalfW:23,visualHalfD:23,visualHeight:152,visualMinimumY:0,boundaryCategory:"structure",boundaryType:"landmark-tower",boundarySource:"procedural-city"});
    this.chunkManager.addSpecial({type:"fountain",x:-52,z:-92});
  }

  buildRuralScenery(){
    const cityBounds=this.definition.mapRegions?.city??this.definition.bounds,group=new THREE.Group();group.name="eastmere-rural-scenery";this.scene.add(group);this.ruralGroup=group;
    const fieldColors=[0x83985a,0x9b9a5b,0x6f8e50,0xa48f56,0x78975f],fieldMaterials=fieldColors.map(color=>new THREE.MeshStandardMaterial({color,map:this.fieldTexture,roughness:1}));
    const intersectsDistrict=(x,z,w,d,margin=18)=>this.definition.districts.some(area=>area.id!=="merehaven"&&x+w*.5>area.minX-margin&&x-w*.5<area.maxX+margin&&z+d*.5>area.minZ-margin&&z-d*.5<area.maxZ+margin);
    const random=mulberry32(CONFIG.seed^0x51ce7a),fieldGeometryCache=new Map(),geometryFor=(w,d)=>{const key=`${w}:${d}`;if(!fieldGeometryCache.has(key))fieldGeometryCache.set(key,new THREE.PlaneGeometry(w,d));return fieldGeometryCache.get(key);};
    const fields=[];
    for(let x=cityBounds.minX+70;x<cityBounds.maxX-70;x+=135)for(let z=cityBounds.minZ+65;z<cityBounds.maxZ-65;z+=125){
      if(random()<.23)continue;const w=86+random()*34,d=70+random()*32,px=x+(random()-.5)*34,pz=z+(random()-.5)*30,rot=(random()-.5)*.34;if(intersectsDistrict(px,pz,w,d,24)||!this.isFootprintClear(px,pz,w,d,6,rot))continue;
      const field=new THREE.Mesh(geometryFor(w,d),fieldMaterials[fields.length%fieldMaterials.length]);field.rotation.set(-Math.PI/2,0,rot);field.position.set(px,-.065,pz);field.receiveShadow=true;field.name="eastmere-farm-field";group.add(field);fields.push({x:px,z:pz,w,d,rot});
      const c=Math.cos(rot),sn=Math.sin(rot),toWorld=(lx,lz)=>new THREE.Vector3(px+lx*c+lz*sn,.28,pz-lx*sn+lz*c),corners=[toWorld(-w*.5,-d*.5),toWorld(w*.5,-d*.5),toWorld(w*.5,d*.5),toWorld(-w*.5,d*.5)];
      for(let edge=0;edge<4;edge++){if(edge===2&&random()<.35)continue;const hedge=new THREE.Mesh(this.geometry.box,this.materials.ruralHedge);hedge.applyMatrix4(boxMatrix(corners[edge],corners[(edge+1)%4],.72,.85,.02,.2));hedge.castShadow=false;hedge.receiveShadow=true;hedge.name="eastmere-field-hedge";group.add(hedge);}
      const rows=4+Math.floor(random()*3);for(let row=1;row<rows;row++){const lx=-w*.5+(w/rows)*row,a=toWorld(lx,-d*.43),b=toWorld(lx,d*.43),track=new THREE.Mesh(this.geometry.box,this.materials.farmTrack);track.applyMatrix4(boxMatrix(a,b,.42,.025,.005,.1));track.name="eastmere-field-tramline";group.add(track);}
      if(fields.length%3===0){for(let t=0;t<8;t++){const side=t%2?-1:1,localX=(random()-.5)*w*.8,localZ=side*(d*.5+2+random()*5),pos=toWorld(localX,localZ);if(!this.isFootprintClear(pos.x,pos.z,2.8,2.8,0))continue;const scale=.78+random()*.48;this.chunkManager.addPropMatrix(pos.x,pos.z,"trunks",transformMatrix(pos.x,1.0*scale,pos.z,scale,scale,scale));this.chunkManager.addPropMatrix(pos.x,pos.z,"crowns",transformMatrix(pos.x,2.55*scale,pos.z,scale*1.2,scale,scale*1.2));}}
      if(fields.length%5===0){const farmPos=toWorld(w*.30,d*.28),barn=new THREE.Mesh(this.geometry.box,this.materials.barnWall);barn.position.set(farmPos.x,2.8,farmPos.z);barn.rotation.y=rot;barn.scale.set(9,5.6,14);barn.castShadow=true;barn.receiveShadow=true;barn.name="eastmere-farm-barn";group.add(barn);const roof=new THREE.Mesh(this.geometry.gableRoof,this.materials.barnRoof);roof.position.set(farmPos.x,5.6,farmPos.z);roof.rotation.y=rot;roof.scale.set(9.8,2.6,14.8);roof.castShadow=true;roof.name="eastmere-farm-barn-roof";group.add(roof);const silo=new THREE.Mesh(new THREE.CylinderGeometry(2.2,2.4,7.2,12),this.materials.silo);silo.position.set(farmPos.x+Math.cos(rot)*8.0,3.6,farmPos.z-Math.sin(rot)*8.0);silo.castShadow=true;silo.name="eastmere-farm-silo";group.add(silo);}
    }
    // Larger woodland clumps in non-urban green gaps create parallax and horizon
    // references without filling the built-up districts with random trees.
    const woodlandSeeds=[[-585,-555],[-545,650],[-250,770],[255,715],[365,-615],[840,-430],[930,250],[-610,845]];
    for(const [cx,cz] of woodlandSeeds){if(intersectsDistrict(cx,cz,95,95,5))continue;for(let i=0;i<22;i++){const angle=random()*Math.PI*2,radius=Math.sqrt(random())*48,x=cx+Math.cos(angle)*radius,z=cz+Math.sin(angle)*radius;if(!this.isFootprintClear(x,z,3,3,.5))continue;const scale=.72+random()*.72;this.chunkManager.addPropMatrix(x,z,"trunks",transformMatrix(x,1.08*scale,z,scale,scale,scale));this.chunkManager.addPropMatrix(x,z,"crowns",transformMatrix(x,2.7*scale,z,scale*(1.0+random()*.35),scale,scale*(1.0+random()*.35)));}}
  }

  buildStreetFurniture(){
    for(const road of this.graph.roads.values()){
      if(road.category==="motorway"||road.category==="slip")continue;
      const spacing=road.laneWidth<3.15?36:48,count=Math.max(2,Math.floor(road.length/spacing));
      for(let i=1;i<count;i++){
        const t=i/count,p=road.centerCurve.getPointAt(t),tan=road.centerCurve.getTangentAt(t),normal=new THREE.Vector3(-tan.z,0,tan.x);
        for(const side of[-1,1]){
          const pos=p.clone().addScaledVector(normal,side*(road.width*.5+road.sidewalkWidth+.65));
          this.chunkManager.addPropMatrix(pos.x,pos.z,"poles",transformMatrix(pos.x,2.6,pos.z,1,1,1));
          this.chunkManager.addPropMatrix(pos.x,pos.z,"lamps",transformMatrix(pos.x,5.05,pos.z,1,1,1));
          const tx=pos.x+normal.x*side*3.2,tz=pos.z+normal.z*side*3.2;
          if(i%2===0&&road.laneWidth>=3.15&&this.isFootprintClear(tx,tz,2.4,2.4,0)){
            this.chunkManager.addPropMatrix(tx,tz,"trunks",transformMatrix(tx,1.1,tz,1,1,1));this.chunkManager.addPropMatrix(tx,tz,"crowns",transformMatrix(tx,2.8,tz,1,1,1));
          }
          if(road.laneWidth<3.15&&i%2===1){
            const bp=p.clone().addScaledVector(normal,side*(road.width*.5+road.sidewalkWidth*.55));this.chunkManager.addPropMatrix(bp.x,bp.z,"bollards",transformMatrix(bp.x,.45,bp.z,1,1,1));
          }
        }
      }
    }
  }

  addWindowGrid(b,arrays,{width=b.w,depth=b.d,baseY=3.2,height=b.wallHeight??b.h,rows=3,columns=3,front=true,sides=true}={}){
    const rowGap=Math.max(2.6,(height-baseY-1)/Math.max(1,rows));
    for(let row=0;row<rows;row++){
      const y=Math.min(height-1.1,baseY+row*rowGap);
      if(front){
        for(let col=0;col<columns;col++){
          const lx=(col-(columns-1)*.5)*(width*.72/Math.max(1,columns-1||1));
          arrays.windows.push(buildingMatrix(b,lx,y,depth*.505,.82,.82,.07));arrays.windows.push(buildingMatrix(b,-lx,y,-depth*.505,.82,.82,.07));
        }
      }
      if(sides){
        const sideCols=Math.max(1,Math.round(columns*depth/Math.max(width,1)));
        for(let col=0;col<sideCols;col++){
          const lz=(col-(sideCols-1)*.5)*(depth*.68/Math.max(1,sideCols-1||1));
          arrays.windows.push(buildingMatrix(b,width*.505,y,lz,.07,.82,.82));arrays.windows.push(buildingMatrix(b,-width*.505,y,-lz,.07,.82,.82));
        }
      }
    }
  }

  addInfrastructureSpecials(group,specials){
    for(const special of specials){
      if(special.type==="junctionSurface"&&special.points?.length>=3){
        const shape=new THREE.Shape();special.points.forEach((p,i)=>i?shape.lineTo(p.x,-p.z):shape.moveTo(p.x,-p.z));shape.closePath();
        const mesh=new THREE.Mesh(new THREE.ShapeGeometry(shape),this.materials.asphalt);mesh.rotation.x=-Math.PI/2;mesh.position.y=.031;mesh.receiveShadow=true;group.add(mesh);
      }else if(special.type==="junctionApron"||special.type==="roadEndCap"){
        const mesh=new THREE.Mesh(new THREE.CircleGeometry(special.radius,40),this.materials.asphalt);mesh.rotation.x=-Math.PI/2;mesh.position.set(special.x,.031,special.z);mesh.receiveShadow=true;group.add(mesh);
      }else if(special.type==="roundabout"){
        const centre=new THREE.Vector3(special.x,0,special.z);
        // Build a flared asphalt throat from every trimmed road mouth to the
        // circulating carriageway. Roads are deliberately trimmed several
        // metres before the roundabout so their kerbs and markings cannot cut
        // across the central island or leave triangular gaps at acute entries.
        for(const approach of special.approaches??[]){
          const away=new THREE.Vector3(approach.x,0,approach.z).normalize(),normal=new THREE.Vector3(-away.z,0,away.x);
          const mouth=approach.centre?new THREE.Vector3(approach.centre.x,0,approach.centre.z):centre.clone().addScaledVector(away,special.outerRadius+5.5);
          const ringCentre=centre.clone().addScaledVector(away,special.outerRadius-.12),mouthHalf=approach.width*.5+.30,ringHalf=Math.min(approach.width*.58,special.outerRadius*.43);
          const mouthLeft=mouth.clone().addScaledVector(normal,mouthHalf),mouthRight=mouth.clone().addScaledVector(normal,-mouthHalf),ringLeft=ringCentre.clone().addScaledVector(normal,ringHalf),ringRight=ringCentre.clone().addScaledVector(normal,-ringHalf);
          const throatShape=new THREE.Shape();[mouthLeft,ringLeft,ringRight,mouthRight].forEach((p,i)=>i?throatShape.lineTo(p.x,-p.z):throatShape.moveTo(p.x,-p.z));throatShape.closePath();
          const throat=new THREE.Mesh(new THREE.ShapeGeometry(throatShape),this.materials.asphalt);throat.rotation.x=-Math.PI/2;throat.position.y=.034;throat.receiveShadow=true;group.add(throat);
          for(const [a,b] of [[mouthLeft,ringLeft],[mouthRight,ringRight]]){
            const kerb=new THREE.Mesh(this.geometry.box,this.materials.curb);kerb.applyMatrix4(boxMatrix(a,b,.18,.15,.036,.18));kerb.receiveShadow=true;group.add(kerb);
          }
          const splitterStart=centre.clone().addScaledVector(away,special.outerRadius+1.0),splitterEnd=mouth.clone().addScaledVector(away,-1.15);
          if(splitterStart.distanceTo(splitterEnd)>2.2){
            const splitter=new THREE.Mesh(this.geometry.box,this.materials.roundaboutCurb);splitter.applyMatrix4(boxMatrix(splitterStart,splitterEnd,.66,.12,.04,.08));splitter.receiveShadow=true;group.add(splitter);
          }
        }
        const ring=new THREE.Mesh(new THREE.RingGeometry(special.innerRadius+.65,special.outerRadius,72),this.materials.asphalt);ring.rotation.x=-Math.PI/2;ring.position.set(special.x,.032,special.z);ring.receiveShadow=true;group.add(ring);
        const curb=new THREE.Mesh(new THREE.RingGeometry(special.innerRadius-.42,special.innerRadius+.68,72),this.materials.roundaboutCurb);curb.rotation.x=-Math.PI/2;curb.position.set(special.x,.075,special.z);curb.receiveShadow=true;group.add(curb);
        const island=new THREE.Mesh(new THREE.CircleGeometry(special.innerRadius-.45,72),this.materials.roundaboutGrass);island.rotation.x=-Math.PI/2;island.position.set(special.x,.083,special.z);island.receiveShadow=true;group.add(island);
        const shrub=new THREE.Mesh(this.geometry.shrub,this.materials.leaf);shrub.scale.set(2.1,1.25,2.1);shrub.position.set(special.x,1.12,special.z);shrub.castShadow=true;group.add(shrub);
        const flowerMaterials=[this.materials.flowerA,this.materials.flowerB,this.materials.flowerC];
        for(let i=0;i<30;i++){
          const angle=i*(Math.PI*2/30)+(i%3)*.13,radius=(special.innerRadius*.38)+(i%4)*special.innerRadius*.09;
          const flower=new THREE.Mesh(this.geometry.flower,flowerMaterials[i%flowerMaterials.length]);flower.position.set(special.x+Math.cos(angle)*radius,.28+(i%2)*.04,special.z+Math.sin(angle)*radius);flower.scale.set(1,1.35,1);group.add(flower);
        }
        for(const approach of special.approaches??[]){
          const away=new THREE.Vector3(approach.x,0,approach.z).normalize(),incomingLeft=new THREE.Vector3(away.z,0,-away.x);
          const position=centre.clone().addScaledVector(away,special.outerRadius+7.2).addScaledVector(incomingLeft,approach.width*.5+1.1);
          const post=new THREE.Mesh(new THREE.CylinderGeometry(.07,.09,2.2,8),this.materials.pole);post.position.set(position.x,1.1,position.z);group.add(post);
          const disc=new THREE.Mesh(this.geometry.signDisc,this.materials.roundaboutSign);disc.position.set(position.x,2.28,position.z);disc.rotation.y=Math.atan2(away.x,away.z);group.add(disc);
        }
      }
    }
  }

  createChunkDetail(chunk){
    const group=new THREE.Group();group.name=`chunk-${chunk.key}`;
    const infrastructureGroup=new THREE.Group(),buildingGroup=new THREE.Group();
    infrastructureGroup.name=`infrastructure-${chunk.key}`;buildingGroup.name=`buildings-${chunk.key}`;
    group.add(infrastructureGroup,buildingGroup);group.userData={infrastructureGroup,buildingGroup};
    addInstances(infrastructureGroup,this.geometry.plane,this.materials.asphalt,chunk.roads.asphalt,{receiveShadow:true});
    addInstances(infrastructureGroup,this.geometry.plane,this.materials.sidewalk,chunk.roads.sidewalk,{receiveShadow:true});
    addInstances(infrastructureGroup,this.geometry.box,this.materials.curb,chunk.roads.curb,{castShadow:false,receiveShadow:true});
    addInstances(infrastructureGroup,this.geometry.plane,this.materials.white,chunk.roads.white);addInstances(infrastructureGroup,this.geometry.plane,this.materials.yellow,chunk.roads.yellow);
    addInstances(infrastructureGroup,this.geometry.box,this.materials.median,chunk.roads.median,{receiveShadow:true});
    addInstances(infrastructureGroup,this.geometry.circle,this.materials.asphalt,chunk.roads.junction,{receiveShadow:true});
    this.addInfrastructureSpecials(infrastructureGroup,chunk.specials.filter(special=>!special.permanent));

    const facadeBatches=new Map(),windows=[],shopfronts=[],trims=[],roofs=[],signs=[],vents=[],masts=[],chimneys=[],doors=[],roofCaps=[];
    const arrays={windows,shopfronts,trims,roofs,signs,vents,masts,chimneys,doors,roofCaps};
    for(const b of chunk.buildings){
      const rot=b.rotation??0;
      if(b.district==="res"||b.district==="old"){
        const wallH=b.wallHeight??b.h*.72;
        pushBucket(facadeBatches,b.facadeColor,buildingMatrix(b,0,wallH*.5,0,b.w,wallH,b.d));
        roofs.push(buildingMatrix(b,0,wallH,0,b.w*1.08,Math.max(1,b.roofHeight),b.d*1.08));
        const floors=Math.max(1,Math.floor((wallH-2.2)/2.8)),cols=Math.max(2,Math.floor(b.w/5));
        this.addWindowGrid(b,arrays,{baseY:3.1,height:wallH,rows:floors,columns:cols});
        const front=(b.frontSign??1)*b.d*.51;
        doors.push(buildingMatrix(b,-b.w*.27,1.15,front,.9,2.15,.10));
        if(b.district==="old"&&wallH>10){
          shopfronts.push(buildingMatrix(b,b.w*.12,1.65,(b.frontSign??1)*b.d*.512,b.w*.46,2.5,.11));
          trims.push(buildingMatrix(b,0,wallH-.22,(b.frontSign??1)*b.d*.506,b.w*.96,.32,.12));
        }
        chimneys.push(buildingMatrix(b,b.w*.24,wallH+b.roofHeight*.55,-b.d*.12,.52,1.5,.52));
        continue;
      }

      if(b.district==="ind"){
        pushBucket(facadeBatches,b.facadeColor,buildingMatrix(b,0,b.h*.5,0,b.w,b.h,b.d));
        shopfronts.push(buildingMatrix(b,0,1.75,(b.frontSign??1)*b.d*.507,b.w*.54,3.1,.13));
        for(let i=-1;i<=1;i++)vents.push(buildingMatrix(b,i*b.w*.22,b.h+.62,0,.38,1.24,.38));
        for(let i=-1;i<=1;i++)roofCaps.push(buildingMatrix(b,i*b.w*.24,b.h+.05,0,b.w*.14,.10,b.d*.54));
        this.addWindowGrid(b,arrays,{baseY:b.h*.58,height:b.h,rows:1,columns:Math.max(2,Math.floor(b.w/7)),sides:true});
        continue;
      }

      const podiumH=b.district==="cbd"&&b.h>55?7:Math.min(4.6,b.h*.22),taper=b.district==="cbd"&&b.h>65?.78:1,towerW=b.w*taper,towerD=b.d*taper;
      if(podiumH>3)pushBucket(facadeBatches,b.facadeColor,buildingMatrix(b,0,podiumH*.5,0,b.w,podiumH,b.d));
      pushBucket(facadeBatches,b.facadeColor,buildingMatrix(b,0,podiumH+(b.h-podiumH)*.5,0,towerW,b.h-podiumH,towerD));
      const rows=Math.min(12,Math.max(3,Math.floor((b.h-podiumH)/5.2)));
      for(let r=0;r<rows;r++){
        const y=podiumH+2.5+r*(b.h-podiumH-4)/Math.max(1,rows-1);
        windows.push(buildingMatrix(b,0,y,towerD*.505,towerW*.72,.50,.07));windows.push(buildingMatrix(b,0,y,-towerD*.505,towerW*.72,.50,.07));
        windows.push(buildingMatrix(b,towerW*.505,y,0,.07,.50,towerD*.72));windows.push(buildingMatrix(b,-towerW*.505,y,0,.07,.50,towerD*.72));
      }
      shopfronts.push(buildingMatrix(b,0,1.75,(b.frontSign??1)*b.d*.512,b.w*.66,2.6,.11));
      if(b.district==="commercial")signs.push(buildingMatrix(b,0,3.55,(b.frontSign??1)*b.d*.52,b.w*.5,.72,.10));
      roofCaps.push(buildingMatrix(b,0,b.h+.35,0,towerW*.42,.7,towerD*.42));
      if(b.h>55)masts.push(buildingMatrix(b,0,b.h+4.2,0,.14,7,.14));
      // Corner mullions break up otherwise blank side elevations.
      for(const x of[-towerW*.48,towerW*.48])for(const z of[-towerD*.48,towerD*.48])trims.push(buildingMatrix(b,x,podiumH+(b.h-podiumH)*.5,z,.18,b.h-podiumH,.18));
    }

    for(const[color,matrices]of facadeBatches)addInstances(buildingGroup,this.geometry.box,this.facadeMaterial(color),matrices,{castShadow:true,receiveShadow:true});
    addInstances(buildingGroup,this.geometry.box,this.materials.glass,windows);addInstances(buildingGroup,this.geometry.box,this.materials.shopGlass,shopfronts);
    addInstances(buildingGroup,this.geometry.box,this.materials.trim,trims,{castShadow:false});addInstances(buildingGroup,this.geometry.gableRoof,this.materials.roof,roofs,{castShadow:true,receiveShadow:true});
    addInstances(buildingGroup,this.geometry.box,this.materials.sign,signs);addInstances(buildingGroup,this.geometry.cylinder,this.materials.trim,vents,{castShadow:false});
    addInstances(buildingGroup,this.geometry.cylinder,this.materials.trim,masts);addInstances(buildingGroup,this.geometry.box,this.materials.trim,chimneys,{castShadow:true});
    addInstances(buildingGroup,this.geometry.box,this.materials.door,doors);addInstances(buildingGroup,this.geometry.box,this.materials.trim,roofCaps,{castShadow:false});

    addInstances(infrastructureGroup,this.geometry.pole,this.materials.pole,chunk.props.poles,{castShadow:false});
    addInstances(infrastructureGroup,this.geometry.lamp,this.materials.lamp,chunk.props.lamps);addInstances(infrastructureGroup,this.geometry.trunk,this.materials.trunk,chunk.props.trunks,{castShadow:true});
    addInstances(infrastructureGroup,this.geometry.crown,this.materials.leaf,chunk.props.crowns,{castShadow:true});addInstances(infrastructureGroup,this.geometry.bollard,this.materials.bollard,chunk.props.bollards);

    this.addSpecialDetails(buildingGroup,chunk.specials);return group;
  }

  addSpecialDetails(group,specials){
    const quay=[],docks=[],boatsA=[],boatsB=[];
    for(const s of specials){
      if(s.type==="quay")quay.push(transformMatrix(s.x,.25,s.z,s.w,.65,s.d));
      else if(s.type==="dock")docks.push(transformMatrix(s.x,.20,s.z,s.w,.55,s.d));
      else if(s.type==="boat")(s.index%2?boatsA:boatsB).push(transformMatrix(s.x,.55,s.z,2.2,.45,2.2,0,Math.PI/2,Math.PI/2));
      else if(s.type==="station"){
        const base=new THREE.Mesh(new THREE.BoxGeometry(142,16,44),this.materials.station);base.position.set(s.x,8,s.z);base.castShadow=true;base.receiveShadow=true;group.add(base);
        const roof=new THREE.Mesh(this.geometry.stationRoof,this.materials.stationRoof);roof.rotation.z=Math.PI/2;roof.position.set(s.x,18.5,s.z);roof.castShadow=true;group.add(roof);
      }else if(s.type==="tower"){
        const podium=new THREE.Mesh(new THREE.BoxGeometry(46,8,46),this.materials.tower);podium.position.set(s.x,4,s.z);podium.castShadow=true;group.add(podium);
        const shaft=new THREE.Mesh(new THREE.BoxGeometry(31,145,31),this.materials.tower);shaft.position.set(s.x,80.5,s.z);shaft.castShadow=true;group.add(shaft);
        const crown=new THREE.Mesh(new THREE.BoxGeometry(25,8,25),this.materials.crown);crown.position.set(s.x,157,s.z);group.add(crown);
      }else if(s.type==="fountain"){
        const square=new THREE.Mesh(new THREE.PlaneGeometry(58,58),this.materials.plaza);square.rotation.x=-Math.PI/2;square.position.set(s.x,.035,s.z);square.receiveShadow=true;group.add(square);
        const fountain=new THREE.Mesh(new THREE.CylinderGeometry(7.5,8,.8,28),this.materials.fountain);fountain.position.set(s.x,.4,s.z);group.add(fountain);
      }
    }
    addInstances(group,this.geometry.box,this.materials.quay,quay,{castShadow:true,receiveShadow:true});addInstances(group,this.geometry.box,this.materials.dock,docks,{castShadow:true,receiveShadow:true});
    addInstances(group,this.geometry.boat,this.materials.boatA,boatsA);addInstances(group,this.geometry.boat,this.materials.boatB,boatsB);
  }

  update(time,weather,timeOfDay=12){
    if(this.waterTexture){this.waterTexture.offset.x=(time*.010)%1;this.waterTexture.offset.y=(time*.006)%1;}
    if(this.ocean){this.ocean.material.opacity=.95+Math.sin(time*.31)*.012;this.ocean.material.roughness=weather==="rain"?.14:.28;this.ocean.position.y=-.34+Math.sin(time*.24)*.018;}
    if(this.water){this.water.material.opacity=.92+Math.sin(time*.55)*.02;this.water.material.roughness=weather==="rain"?.12:.22;this.water.position.y=-.035+Math.sin(time*.42)*.016;}
    const night=timeOfDay<6.5||timeOfDay>18.5;this.materials.lamp.emissiveIntensity=night?2.1:.28;this.materials.glass.emissiveIntensity=night?.72:.42;this.materials.shopGlass.emissiveIntensity=night?1.0:.62;
  }
}
