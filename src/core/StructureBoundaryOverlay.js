import * as THREE from "three";
import { colliderWorldPolygon,getColliderLocalExtents } from "../vehicles/VehicleHitboxes.js?v=20261002-flight-sim-terrain";

const BUILDING_COLOR=0xff4fd8;
const STRUCTURE_COLOR=0xffd45c;

function finite(value,fallback=0){return Number.isFinite(value)?value:fallback;}

function appendPrismEdges(positions,vertices,y0,y1){
  for(let index=0;index<vertices.length;index++){
    const a=vertices[index],b=vertices[(index+1)%vertices.length];
    positions.push(a.x,y0,a.z,b.x,y0,b.z,a.x,y1,a.z,b.x,y1,b.z,a.x,y0,a.z,a.x,y1,a.z);
  }
}

function makeLines(positions,color,name){
  if(!positions.length)return null;
  const geometry=new THREE.BufferGeometry();
  geometry.setAttribute("position",new THREE.Float32BufferAttribute(positions,3));
  geometry.computeBoundingSphere();
  const material=new THREE.LineBasicMaterial({color,transparent:true,opacity:.9,depthTest:false,depthWrite:false,toneMapped:false});
  const lines=new THREE.LineSegments(geometry,material);
  lines.name=name;lines.frustumCulled=true;lines.renderOrder=65;
  return lines;
}

function cityBoundaryRecord(collider){
  const collision=getColliderLocalExtents(collider),visualHalfWidth=finite(collider.visualHalfW,finite(collider.w,collision.halfW*2)*.5),visualHalfDepth=finite(collider.visualHalfD,finite(collider.d,collision.halfD*2)*.5),rotation=finite(collider.rotation,finite(collider.collisionRotation,0));
  const visualCollider={...collider,collisionHalfW:visualHalfWidth,collisionHalfD:visualHalfDepth,collisionRotation:rotation};
  const vertices=colliderWorldPolygon(visualCollider).map(point=>({x:finite(point.x),z:finite(point.z)}));
  const minimumY=finite(collider.visualMinimumY,0),maximumY=Math.max(minimumY+.05,finite(collider.visualHeight,finite(collider.h,finite(collider.height,4))));
  const category=collider.boundaryCategory??(String(collider.id??"").startsWith("bld-")?"building":"structure");
  return{
    id:String(collider.id??collider.name??`static-${Math.round(collider.x??0)}-${Math.round(collider.z??0)}`),
    category,
    objectType:String(collider.boundaryType??collider.district??collider.colliderType??"static-structure"),
    source:String(collider.boundarySource??"city-collider"),
    position:{x:finite(collider.x),y:minimumY,z:finite(collider.z)},
    rotationY:rotation,
    dimensions:{width:visualHalfWidth*2,depth:visualHalfDepth*2,height:maximumY-minimumY,minimumY,maximumY},
    footprintVertices:vertices,
    collisionProfile:{halfWidth:collision.halfW,halfDepth:collision.halfD,rotation:collision.rotation},
    district:collider.district??null,
    chunkKey:collider.chunkKey??null
  };
}

function stationBoundaryRecord(blocker,index){
  const forward=blocker.forward??{x:0,z:1},right=blocker.right??{x:1,z:0},halfLength=finite(blocker.visualHalfLength,finite(blocker.halfLength)),halfWidth=finite(blocker.visualHalfWidth,finite(blocker.halfWidth));
  const centre=blocker.centre??{x:0,y:0,z:0},minimumY=finite(blocker.visualMinimumHeight,finite(blocker.minimumHeight,0)),maximumY=Math.max(minimumY+.05,finite(blocker.visualMaximumHeight,finite(blocker.maximumHeight,minimumY+4)));
  const vertices=[];
  for(const along of[-1,1])for(const across of[-1,1])vertices.push({x:finite(centre.x)+finite(forward.x)*halfLength*along+finite(right.x)*halfWidth*across,z:finite(centre.z)+finite(forward.z)*halfLength*along+finite(right.z)*halfWidth*across});
  const ordered=[vertices[0],vertices[2],vertices[3],vertices[1]];
  return{
    id:`station:${blocker.stationId??"unknown"}:${blocker.name??`structure-${index}`}`,
    category:"structure",
    objectType:String(blocker.boundaryType??blocker.name??"station-structure"),
    source:"rail-walk-blocker",
    position:{x:finite(centre.x),y:minimumY,z:finite(centre.z)},
    rotationY:Math.atan2(finite(forward.x),finite(forward.z,1)),
    dimensions:{width:halfWidth*2,depth:halfLength*2,height:maximumY-minimumY,minimumY,maximumY},
    footprintVertices:ordered,
    collisionProfile:{halfWidth:finite(blocker.halfWidth),halfLength:finite(blocker.halfLength),minimumHeight:finite(blocker.minimumHeight,0),maximumHeight:Number.isFinite(blocker.maximumHeight)?blocker.maximumHeight:null},
    stationId:blocker.stationId??null,
    structureName:blocker.name??null
  };
}

export class StructureBoundaryOverlay{
  constructor(scene,{colliders=[],railSystem=null}={}){
    this.scene=scene;this.colliders=colliders;this.railSystem=railSystem;this.enabled=false;this.group=null;this.records=null;this.counts={buildings:0,structures:0,total:0};
  }

  collectRecords(){
    if(this.records)return this.records;
    const records=[];
    for(const collider of this.colliders??[])records.push(cityBoundaryRecord(collider));
    const blockers=this.railSystem?.walkBlockers??[];
    for(let index=0;index<blockers.length;index++)records.push(stationBoundaryRecord(blockers[index],index));
    this.records=records;
    let buildings=0,structures=0;for(const record of records){if(record.category==="building")buildings++;else structures++;}
    this.counts={buildings,structures,total:records.length};
    return records;
  }

  buildVisuals(){
    if(this.group)return;
    const buildingPositions=[],structurePositions=[];
    for(const record of this.collectRecords()){
      const target=record.category==="building"?buildingPositions:structurePositions;
      appendPrismEdges(target,record.footprintVertices,record.dimensions.minimumY+.025,record.dimensions.maximumY);
    }
    const group=new THREE.Group();group.name="building-structure-boundary-overlay";group.visible=false;
    const buildings=makeLines(buildingPositions,BUILDING_COLOR,"building-object-boundaries"),structures=makeLines(structurePositions,STRUCTURE_COLOR,"structure-object-boundaries");
    if(buildings)group.add(buildings);if(structures)group.add(structures);
    this.scene.add(group);this.group=group;
  }

  setEnabled(enabled){
    this.enabled=Boolean(enabled);if(this.enabled)this.buildVisuals();if(this.group)this.group.visible=this.enabled;return this.enabled;
  }
  toggle(){return this.setEnabled(!this.enabled);}
  isEnabled(){return this.enabled;}
  getBoundaryRecords(){return this.collectRecords();}
  getStats(){
    if(!this.records){let buildings=0,structures=0;for(const collider of this.colliders??[]){if((collider.boundaryCategory??(String(collider.id??"").startsWith("bld-")?"building":"structure"))==="building")buildings++;else structures++;}structures+=(this.railSystem?.walkBlockers?.length??0);this.counts={buildings,structures,total:buildings+structures};}
    return{...this.counts,visible:this.enabled};
  }
  dispose(){if(!this.group)return;for(const child of this.group.children){child.geometry?.dispose?.();child.material?.dispose?.();}this.group.removeFromParent();this.group=null;}
}
