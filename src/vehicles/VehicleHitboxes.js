import * as THREE from "three";

const DIMENSIONS={
  car:{length:4.62,width:1.86,height:1.44,mass:1480,shape:"sedan"},
  hatchback:{length:4.15,width:1.82,height:1.50,mass:1320,shape:"hatch"},
  sports:{length:4.48,width:1.94,height:1.18,mass:1420,shape:"sports"},
  suv:{length:4.82,width:1.96,height:1.78,mass:1940,shape:"suv"},
  taxi:{length:4.66,width:1.86,height:1.46,mass:1620,shape:"sedan"},
  van:{length:5.34,width:2.05,height:2.32,mass:2650,shape:"van"},
  emergency:{length:5.42,width:2.08,height:2.38,mass:3150,shape:"van"},
  bus:{length:10.8,width:2.52,height:3.18,mass:11600,shape:"bus"},
  lorry:{length:12.2,width:2.52,height:3.48,mass:17800,shape:"lorry"}
};

function taperedPolygon(length,width,{front=.78,rear=.86,shoulder=.97}={}){
  const l=length*.5,w=width*.5;
  return [
    [-rear*w,-l],[rear*w,-l],
    [shoulder*w,-l*.34],[w,l*.25],
    [front*w,l],[-front*w,l],
    [-w,l*.25],[-shoulder*w,-l*.34]
  ];
}

function roundedRectangle(length,width,corner=.12,zOffset=0){
  const l=length*.5,w=width*.5,c=Math.min(corner,Math.min(l,w)*.45);
  return [
    [-w+c,-l+zOffset],[w-c,-l+zOffset],[w,-l+c+zOffset],[w,l-c+zOffset],
    [w-c,l+zOffset],[-w+c,l+zOffset],[-w,l-c+zOffset],[-w,-l+c+zOffset]
  ];
}

function offsetPolygon(points,x=0,z=0){return points.map(([px,pz])=>[px+x,pz+z]);}

function makeProfile(kind){
  const d=DIMENSIONS[kind]??DIMENSIONS.car;
  let polygons;
  switch(d.shape){
    case"sports":polygons=[taperedPolygon(d.length,d.width,{front:.68,rear:.82,shoulder:.96})];break;
    case"hatch":polygons=[taperedPolygon(d.length,d.width,{front:.77,rear:.94,shoulder:.98})];break;
    case"suv":polygons=[taperedPolygon(d.length,d.width,{front:.86,rear:.91,shoulder:.99})];break;
    case"van":polygons=[taperedPolygon(d.length,d.width,{front:.84,rear:.96,shoulder:.99})];break;
    case"bus":polygons=[roundedRectangle(d.length,d.width,.22)];break;
    case"lorry":{
      const cabLength=3.55,trailerLength=7.95;
      const cabCentre=d.length*.5-cabLength*.55;
      const trailerCentre=-d.length*.22;
      polygons=[
        offsetPolygon(taperedPolygon(cabLength,d.width,{front:.88,rear:.96,shoulder:.99}),0,cabCentre),
        offsetPolygon(roundedRectangle(trailerLength,d.width,.14),0,trailerCentre)
      ];
      break;
    }
    default:polygons=[taperedPolygon(d.length,d.width,{front:.77,rear:.86,shoulder:.98})];
  }
  return Object.freeze({kind,...d,polygons:Object.freeze(polygons.map(p=>Object.freeze(p.map(v=>Object.freeze(v)))))});
}

const PROFILES=Object.freeze(Object.fromEntries(Object.keys(DIMENSIONS).map(kind=>[kind,makeProfile(kind)])));

export function getVehicleHitboxProfile(kind="car"){return PROFILES[kind]??PROFILES.car;}
export function getVehicleMass(kind="car"){return getVehicleHitboxProfile(kind).mass;}

export function createWorldHitboxBuffer(kind="car"){
  return getVehicleHitboxProfile(kind).polygons.map(points=>points.map(()=>new THREE.Vector2()));
}

export function populateWorldHitboxPolygons(kind,position,heading,target=createWorldHitboxBuffer(kind)){
  const localPolygons=getVehicleHitboxProfile(kind).polygons,sin=Math.sin(heading),cos=Math.cos(heading);
  for(let polygonIndex=0;polygonIndex<localPolygons.length;polygonIndex++){
    const local=localPolygons[polygonIndex];let world=target[polygonIndex];
    if(!world||world.length!==local.length){world=local.map(()=>new THREE.Vector2());target[polygonIndex]=world;}
    for(let pointIndex=0;pointIndex<local.length;pointIndex++){
      const point=local[pointIndex],x=point[0],z=point[1];world[pointIndex].set(position.x+x*cos+z*sin,position.z-x*sin+z*cos);
    }
  }
  target.length=localPolygons.length;return target;
}

export function transformPolygon(localPoints,position,heading){
  const target=[localPoints.map(()=>new THREE.Vector2())];populateWorldHitboxPolygonsFromLocal(localPoints,position,heading,target[0]);return target[0];
}

function populateWorldHitboxPolygonsFromLocal(localPoints,position,heading,target){
  const sin=Math.sin(heading),cos=Math.cos(heading);
  for(let index=0;index<localPoints.length;index++){const point=localPoints[index],x=point[0],z=point[1];target[index].set(position.x+x*cos+z*sin,position.z-x*sin+z*cos);}return target;
}

export function getWorldHitboxPolygons(kind,position,heading){return populateWorldHitboxPolygons(kind,position,heading);}

export function computePolygonsAABB(polygons,target={minX:0,maxX:0,minZ:0,maxZ:0}){
  let minX=Infinity,maxX=-Infinity,minZ=Infinity,maxZ=-Infinity;
  for(const poly of polygons)for(const point of poly){if(point.x<minX)minX=point.x;if(point.x>maxX)maxX=point.x;if(point.y<minZ)minZ=point.y;if(point.y>maxZ)maxZ=point.y;}
  target.minX=minX;target.maxX=maxX;target.minZ=minZ;target.maxZ=maxZ;return target;
}

function projectBounds(poly,axisX,axisY){
  let min=Infinity,max=-Infinity;
  for(const point of poly){const projection=point.x*axisX+point.y*axisY;if(projection<min)min=projection;if(projection>max)max=projection;}
  return[min,max];
}

export function intersectConvexPolygons(a,b){
  let minOverlap=Infinity,bestAxisX=0,bestAxisY=0;
  for(let polygonIndex=0;polygonIndex<2;polygonIndex++){
    const poly=polygonIndex===0?a:b;
    for(let index=0;index<poly.length;index++){
      const p0=poly[index],p1=poly[(index+1)%poly.length],edgeX=p1.x-p0.x,edgeY=p1.y-p0.y,lengthSq=edgeX*edgeX+edgeY*edgeY;if(lengthSq<1e-8)continue;
      const inverseLength=1/Math.sqrt(lengthSq),axisX=-edgeY*inverseLength,axisY=edgeX*inverseLength,pa=projectBounds(a,axisX,axisY),pb=projectBounds(b,axisX,axisY),overlap=Math.min(pa[1],pb[1])-Math.max(pa[0],pb[0]);
      if(overlap<=0)return null;if(overlap<minOverlap){minOverlap=overlap;bestAxisX=axisX;bestAxisY=axisY;}
    }
  }
  let centreAX=0,centreAY=0,centreBX=0,centreBY=0;for(const point of a){centreAX+=point.x;centreAY+=point.y;}for(const point of b){centreBX+=point.x;centreBY+=point.y;}centreAX/=a.length;centreAY/=a.length;centreBX/=b.length;centreBY/=b.length;
  if((centreBX-centreAX)*bestAxisX+(centreBY-centreAY)*bestAxisY<0){bestAxisX=-bestAxisX;bestAxisY=-bestAxisY;}
  return{normal:new THREE.Vector2(bestAxisX,bestAxisY),depth:minOverlap};
}

export function intersectCompoundHitboxes(aPolygons,bPolygons){
  let best=null;
  for(const a of aPolygons)for(const b of bPolygons){const contact=intersectConvexPolygons(a,b);if(contact&&(!best||contact.depth<best.depth))best=contact;}
  return best;
}

export function getColliderBroadphaseExtents(collider){
  return{
    halfW:collider.collisionAabbHalfW??collider.halfW??collider.collisionHalfW??0,
    halfD:collider.collisionAabbHalfD??collider.halfD??collider.collisionHalfD??0
  };
}

export function getColliderLocalExtents(collider,padding=0){
  return{
    halfW:Math.max(0,(collider.collisionHalfW??collider.halfW??0)+padding),
    halfD:Math.max(0,(collider.collisionHalfD??collider.halfD??0)+padding),
    rotation:collider.collisionRotation??collider.rotation??0
  };
}

export function colliderWorldPolygon(collider,padding=0){
  const{halfW,halfD,rotation}=getColliderLocalExtents(collider,padding);
  return transformPolygon([
    [-halfW,-halfD],[halfW,-halfD],[halfW,halfD],[-halfW,halfD]
  ],new THREE.Vector3(collider.x??0,0,collider.z??0),rotation);
}

export function pointInsideColliderXZ(point,collider,padding=0){
  const{halfW,halfD,rotation}=getColliderLocalExtents(collider,padding),dx=point.x-(collider.x??0),dz=point.z-(collider.z??0),cos=Math.cos(rotation),sin=Math.sin(rotation);
  const localX=dx*cos-dz*sin,localZ=dx*sin+dz*cos;
  return Math.abs(localX)<halfW&&Math.abs(localZ)<halfD;
}

export function vehicleIntersectsCollider(kind,position,heading,collider,padding=0){
  const polygon=colliderWorldPolygon(collider,padding);
  return getWorldHitboxPolygons(kind,position,heading).some(poly=>intersectConvexPolygons(poly,polygon));
}

// Backwards-compatible name retained for older callers. It now supports both
// axis-aligned boxes and the tighter oriented building footprints.
export function vehicleIntersectsAABB(kind,position,heading,box,padding=0){return vehicleIntersectsCollider(kind,position,heading,box,padding);}

export function createVehicleHitboxDebug(kind="car",color=0x42d9ff){
  const profile=getVehicleHitboxProfile(kind),positions=[];
  const y0=.08,y1=Math.max(.58,profile.height*.82);
  for(const poly of profile.polygons){
    for(let i=0;i<poly.length;i++){
      const a=poly[i],b=poly[(i+1)%poly.length];
      positions.push(a[0],y0,a[1],b[0],y0,b[1]);
      positions.push(a[0],y1,a[1],b[0],y1,b[1]);
      positions.push(a[0],y0,a[1],a[0],y1,a[1]);
    }
  }
  const geometry=new THREE.BufferGeometry();geometry.setAttribute("position",new THREE.Float32BufferAttribute(positions,3));
  const material=new THREE.LineBasicMaterial({color,transparent:true,opacity:.84,depthTest:true,depthWrite:false,toneMapped:false});
  const lines=new THREE.LineSegments(geometry,material);lines.visible=false;lines.renderOrder=40;lines.frustumCulled=false;
  lines.userData.isVehicleHitbox=true;return lines;
}
