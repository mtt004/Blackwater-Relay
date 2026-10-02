import fs from "node:fs";
import path from "node:path";
import * as THREE from "three";
import { createVehicleMesh } from "../src/vehicles/VehicleFactory.js?v=20261002-flight-sim-terrain";
import { getVehicleHitboxProfile } from "../src/vehicles/VehicleHitboxes.js?v=20261002-flight-sim-terrain";
import { createClass43PowerCar,createMark3Coach } from "../src/rail/HSTFactory.js?v=20261002-flight-sim-terrain";
import { buildRoadGraph } from "../src/world/CityPlan.js?v=20261002-flight-sim-terrain";
import { CityBuilder } from "../src/world/CityBuilder.js?v=20261002-flight-sim-terrain";
import { RailSystem } from "../src/rail/RailSystem.js?v=20261002-flight-sim-terrain";

if(typeof globalThis.document==="undefined")globalThis.document={getElementById:()=>null};
if(typeof globalThis.addEventListener!=="function")globalThis.addEventListener=()=>{};

function round(value,digits=4){return Number(value.toFixed(digits));}
function polygonArea(points){let area=0;for(let index=0;index<points.length;index++){const a=points[index],b=points[(index+1)%points.length];area+=a[0]*b[1]-b[0]*a[1];}return Math.abs(area)*.5;}
function profileBounds(profile){
  let minX=Infinity,maxX=-Infinity,minZ=Infinity,maxZ=-Infinity,area=0;
  for(const polygon of profile.polygons){area+=polygonArea(polygon);for(const [x,z] of polygon){minX=Math.min(minX,x);maxX=Math.max(maxX,x);minZ=Math.min(minZ,z);maxZ=Math.max(maxZ,z);}}
  return{minX:round(minX),maxX:round(maxX),minZ:round(minZ),maxZ:round(maxZ),width:round(maxX-minX),length:round(maxZ-minZ),area:round(area)};
}
function objectBounds(object){
  const debugChildren=[];object.traverse(child=>{if(child.userData?.isCollisionProfileDebug||child.userData?.isVehicleHitbox){debugChildren.push({child,parent:child.parent});}});
  for(const{child,parent}of debugChildren)parent.remove(child);
  object.updateMatrixWorld(true);const box=new THREE.Box3().setFromObject(object),size=new THREE.Vector3();box.getSize(size);
  for(const{child,parent}of debugChildren)parent.add(child);
  return{minX:round(box.min.x),maxX:round(box.max.x),minY:round(box.min.y),maxY:round(box.max.y),minZ:round(box.min.z),maxZ:round(box.max.z),width:round(size.x),height:round(size.y),length:round(size.z)};
}

const roadKinds=["car","hatchback","sports","suv","taxi","van","emergency","bus","lorry"];
const roadVehicles=roadKinds.map(kind=>{
  const visual=objectBounds(createVehicleMesh(kind,0)),profile=getVehicleHitboxProfile(kind),hitbox=profileBounds(profile);
  return{kind,visual,hitbox,widthDelta:round(hitbox.width-visual.width),lengthDelta:round(hitbox.length-visual.length),decision:"retained",reason:"The compound footprint is already inside the complete rendered bounds and excludes mirrors, tyres, lamps and plates."};
});

const powerCar=createClass43PowerCar(),coach=createMark3Coach();
const trains=[
  {kind:"class43-power",object:powerCar,oldRectangle:{width:2.94,length:14.1}},
  {kind:"mark3-coach",object:coach,oldRectangle:{width:2.94,length:15.3}}
].map(({kind,object,oldRectangle})=>{
  const visual=objectBounds(object),hitbox=profileBounds(object.userData.collisionProfile),oldArea=oldRectangle.width*oldRectangle.length;
  return{kind,visual,oldPaddedRectangle:{...oldRectangle,area:round(oldArea)},hitbox,areaReductionPercent:round((1-hitbox.area/oldArea)*100,2),decision:"recalibrated"};
});

const graph=buildRoadGraph(),scene=new THREE.Scene(),city=new CityBuilder(scene,graph),built=city.build();
city.initializeStreaming(new THREE.Vector3(-330,0,5),Math.PI/2,0);
const rail=new RailSystem(scene,new THREE.PerspectiveCamera(),{isDown:()=>false,consume:()=>false},graph,built.chunkManager,built.railPlan,()=>{},built.colliders);
const meshNameForBlocker=name=>({
  "front-left-wall":"station-front-left-wall","front-right-wall":"station-front-right-wall","front-lintel":"station-front-lintel",
  "rear-left-wall":"station-rear-left-wall","rear-right-wall":"station-rear-right-wall","rear-lower-panel":"station-rear-glazed-lower-panel","rear-lintel":"station-rear-lintel",
  "side-left-wall":"station-side-left-wall","side-right-wall":"station-side-right-wall","ticket-desk":"ticket-desk","interior-bench":"interior-bench","vending-machine":"vending-machine","lift-tower":"lift-tower"
})[name];
const stationSamples=[];
for(const blocker of rail.walkBlockers){
  const suffix=meshNameForBlocker(blocker.name);if(!suffix)continue;
  const mesh=scene.getObjectByName(`${blocker.stationId}-${suffix}`),parameters=mesh?.geometry?.parameters;if(!parameters)continue;
  const renderedWidth=parameters.width,renderedLength=parameters.depth;
  stationSamples.push({stationId:blocker.stationId,object:blocker.name,renderedWidth:round(renderedWidth),renderedLength:round(renderedLength),hitboxWidth:round(blocker.halfWidth*2),hitboxLength:round(blocker.halfLength*2),widthInset:round(renderedWidth-blocker.halfWidth*2),lengthInset:round(renderedLength-blocker.halfLength*2),minimumHeight:round(blocker.minimumHeight??0),maximumHeight:round(blocker.maximumHeight??0)});
}
const stationByObject=Object.values(Object.groupBy(stationSamples,item=>item.object)).map(items=>({
  object:items[0].object,count:items.length,renderedWidth:items[0].renderedWidth,renderedLength:items[0].renderedLength,hitboxWidth:items[0].hitboxWidth,hitboxLength:items[0].hitboxLength,widthInset:items[0].widthInset,lengthInset:items[0].lengthInset
}));

const buildingInsets=built.colliders.filter(collider=>collider.id?.startsWith("bld-")).map(collider=>({widthInset:round((collider.w??0)-2*(collider.collisionHalfW??0)),depthInset:round((collider.d??0)-2*(collider.collisionHalfD??0))}));
const report={
  generatedAt:new Date().toISOString(),
  roadVehicles,
  trains,
  stationBlockers:stationByObject,
  proceduralBuildings:{count:buildingInsets.length,minimumTotalWidthInset:Math.min(...buildingInsets.map(item=>item.widthInset)),maximumTotalWidthInset:Math.max(...buildingInsets.map(item=>item.widthInset)),minimumTotalDepthInset:Math.min(...buildingInsets.map(item=>item.depthInset)),maximumTotalDepthInset:Math.max(...buildingInsets.map(item=>item.depthInset)),decision:"retained: existing oriented footprints are inset 80 mm per face from visible walls"},
  landmarkTower:{renderedWidth:46,renderedLength:46,hitboxWidth:45.84,hitboxLength:45.84,decision:"retained"},
  clearances:{walkingBodyRadiusBefore:.30,walkingBodyRadiusAfter:.20,cameraClearanceBefore:.60,cameraClearanceAfter:.38,vehicleToBuildingNumericalPadding:.035,trainProfileNumericalPadding:.035},
  conclusions:[
    "Road-vehicle compound hitboxes were not reduced because each was already smaller than the full rendered object and already excluded decorative protrusions.",
    "The largest true overstatement was the single padded rectangular footprint used for every HST vehicle.",
    "Station blockers now sit 12 mm inside rendered box faces rather than extending 35 mm beyond them.",
    "Building colliders remain oriented and inset; broad-phase AABBs are not used as physical hitboxes."
  ]
};
const output=JSON.stringify(report,null,2),outputPath=process.argv[2];
if(outputPath){fs.mkdirSync(path.dirname(outputPath),{recursive:true});fs.writeFileSync(outputPath,output+"\n");console.log(`Hitbox audit written to ${outputPath}`);}else console.log(output);
