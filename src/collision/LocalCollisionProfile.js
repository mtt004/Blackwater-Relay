import * as THREE from "three";

const debugGeometryCache=new WeakMap(),debugMaterialCache=new Map();

function pointOnSegment(x,z,ax,az,bx,bz,epsilon=1e-7){
  const abx=bx-ax,abz=bz-az,apx=x-ax,apz=z-az,cross=Math.abs(abx*apz-abz*apx);
  if(cross>epsilon*Math.max(1,Math.hypot(abx,abz)))return false;
  const dot=apx*abx+apz*abz;if(dot<-epsilon)return false;
  return dot<=abx*abx+abz*abz+epsilon;
}

export function pointInsidePolygonXZ(x,z,polygon){
  let inside=false;
  for(let i=0,j=polygon.length-1;i<polygon.length;j=i++){
    const a=polygon[j],b=polygon[i];
    if(pointOnSegment(x,z,a[0],a[1],b[0],b[1]))return true;
    const crosses=(a[1]>z)!==(b[1]>z)&&x<(b[0]-a[0])*(z-a[1])/((b[1]-a[1])||Number.EPSILON)+a[0];
    if(crosses)inside=!inside;
  }
  return inside;
}

function pointSegmentDistanceSquared(x,z,ax,az,bx,bz){
  const abx=bx-ax,abz=bz-az,den=abx*abx+abz*abz||1,t=Math.max(0,Math.min(1,((x-ax)*abx+(z-az)*abz)/den));
  const dx=x-(ax+abx*t),dz=z-(az+abz*t);return dx*dx+dz*dz;
}

export function distanceToPolygonXZ(x,z,polygon){
  if(pointInsidePolygonXZ(x,z,polygon))return 0;
  let best=Infinity;
  for(let i=0;i<polygon.length;i++){
    const a=polygon[i],b=polygon[(i+1)%polygon.length],distanceSquared=pointSegmentDistanceSquared(x,z,a[0],a[1],b[0],b[1]);
    if(distanceSquared<best)best=distanceSquared;
  }
  return Math.sqrt(best);
}

export function pointInsideCollisionProfileXZ(x,z,profile,padding=0){
  if(!profile?.polygons?.length)return false;
  for(const polygon of profile.polygons){
    if(pointInsidePolygonXZ(x,z,polygon))return true;
    if(padding>0&&distanceToPolygonXZ(x,z,polygon)<=padding)return true;
  }
  return false;
}

export function distanceToCollisionProfileXZ(x,z,profile){
  if(!profile?.polygons?.length)return Infinity;
  let best=Infinity;
  for(const polygon of profile.polygons){const distance=distanceToPolygonXZ(x,z,polygon);if(distance<best)best=distance;if(best===0)break;}
  return best;
}

export function createCollisionProfileDebug(profile,color=0x58e3ff){
  let geometry=profile&&debugGeometryCache.get(profile);
  if(!geometry){
    const positions=[],y0=profile?.minimumHeight??.02,y1=profile?.maximumHeight??3.5;
    for(const polygon of profile?.polygons??[])for(let i=0;i<polygon.length;i++){
      const a=polygon[i],b=polygon[(i+1)%polygon.length];
      positions.push(a[0],y0,a[1],b[0],y0,b[1],a[0],y1,a[1],b[0],y1,b[1],a[0],y0,a[1],a[0],y1,a[1]);
    }
    geometry=new THREE.BufferGeometry();geometry.setAttribute("position",new THREE.Float32BufferAttribute(positions,3));if(profile)debugGeometryCache.set(profile,geometry);
  }
  let material=debugMaterialCache.get(color);if(!material){material=new THREE.LineBasicMaterial({color,transparent:true,opacity:.9,depthWrite:false,toneMapped:false});debugMaterialCache.set(color,material);}
  const result=new THREE.LineSegments(geometry,material);result.visible=false;result.frustumCulled=false;result.renderOrder=45;result.userData.isCollisionProfileDebug=true;return result;
}
