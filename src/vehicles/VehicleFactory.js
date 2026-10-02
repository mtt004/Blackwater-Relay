import * as THREE from "three";

const bodyPalette = [0x254f6d,0x7b2929,0x355f43,0x5e6068,0x9b6227,0xd4d3ce,0x171c21,0x6f6040,0x8b8e91,0x31432e];

const geometryCache=new Map(),bodyMaterialCache=new Map(),lowMaterialCache=new Map();
const numericKey=value=>Number(value).toFixed(4);
function cachedBoxGeometry(w,h,d){
  const key=`box:${numericKey(w)}:${numericKey(h)}:${numericKey(d)}`;let geometry=geometryCache.get(key);
  if(!geometry){geometry=new THREE.BoxGeometry(w,h,d);geometryCache.set(key,geometry);}return geometry;
}
function cachedCylinderGeometry(radiusTop,radiusBottom,height,segments=12,rotateZ=false){
  const key=`cylinder:${numericKey(radiusTop)}:${numericKey(radiusBottom)}:${numericKey(height)}:${segments}:${rotateZ?1:0}`;let geometry=geometryCache.get(key);
  if(!geometry){geometry=new THREE.CylinderGeometry(radiusTop,radiusBottom,height,segments);if(rotateZ)geometry.rotateZ(Math.PI/2);geometryCache.set(key,geometry);}return geometry;
}
function cachedBodyMaterial(color){
  const key=Number(color);let result=bodyMaterialCache.get(key);if(!result){result=new THREE.MeshStandardMaterial({color:key,roughness:.38,metalness:.28});bodyMaterialCache.set(key,result);}return result;
}
function cachedLowMaterial(kind,color){
  const key=`${kind}:${Number(color)}`;let result=lowMaterialCache.get(key);if(!result){result=new THREE.MeshLambertMaterial({color});lowMaterialCache.set(key,result);}return result;
}

const shared = {
  tyre: new THREE.MeshStandardMaterial({color:0x0b0d0f,roughness:.92,metalness:.02}),
  rim: new THREE.MeshStandardMaterial({color:0x92979b,roughness:.28,metalness:.82}),
  dark: new THREE.MeshStandardMaterial({color:0x11161b,roughness:.48,metalness:.22}),
  glass: new THREE.MeshPhysicalMaterial({color:0x5d7d8c,roughness:.12,metalness:.08,transmission:.06,transparent:true,opacity:.76}),
  plate: new THREE.MeshStandardMaterial({color:0xe6e4ce,roughness:.55,metalness:.03}),
  blackPlate: new THREE.MeshStandardMaterial({color:0xe5bd45,roughness:.55,metalness:.03})
};

const specs = {
  car:{length:4.62,width:1.86,height:1.44,wheelbase:2.72,wheelRadius:.33,body:"sedan"},
  hatchback:{length:4.15,width:1.82,height:1.50,wheelbase:2.58,wheelRadius:.32,body:"hatch"},
  sports:{length:4.48,width:1.94,height:1.18,wheelbase:2.70,wheelRadius:.35,body:"sports"},
  suv:{length:4.82,width:1.96,height:1.78,wheelbase:2.82,wheelRadius:.38,body:"suv"},
  taxi:{length:4.66,width:1.86,height:1.46,wheelbase:2.74,wheelRadius:.33,body:"sedan"},
  van:{length:5.34,width:2.05,height:2.32,wheelbase:3.25,wheelRadius:.36,body:"van"},
  emergency:{length:5.42,width:2.08,height:2.38,wheelbase:3.28,wheelRadius:.37,body:"van"},
  bus:{length:10.8,width:2.52,height:3.18,wheelbase:5.9,wheelRadius:.46,body:"bus"},
  lorry:{length:12.2,width:2.52,height:3.48,wheelbase:6.5,wheelRadius:.47,body:"lorry"}
};

function taperedBox(widthBottom,widthTop,height,length,frontInset=0,rearInset=0){
  const key=`taper:${numericKey(widthBottom)}:${numericKey(widthTop)}:${numericKey(height)}:${numericKey(length)}:${numericKey(frontInset)}:${numericKey(rearInset)}`;
  const cached=geometryCache.get(key);if(cached)return cached;
  const wb=widthBottom*.5,wt=widthTop*.5,l=length*.5;
  const vertices=new Float32Array([
    -wb,0,-l, wb,0,-l, wb,0,l, -wb,0,l,
    -wt,height,-l+rearInset, wt,height,-l+rearInset, wt,height,l-frontInset, -wt,height,l-frontInset
  ]);
  const indices=[
    0,1,2,0,2,3, 4,6,5,4,7,6,
    0,4,5,0,5,1, 1,5,6,1,6,2,
    2,6,7,2,7,3, 3,7,4,3,4,0
  ];
  const g=new THREE.BufferGeometry();
  g.setAttribute("position",new THREE.BufferAttribute(vertices,3));
  g.setIndex(indices);g.computeVertexNormals();geometryCache.set(key,g);
  return g;
}

function box(w,h,d,material,x,y,z){
  const mesh=new THREE.Mesh(cachedBoxGeometry(w,h,d),material);
  mesh.position.set(x,y,z);mesh.castShadow=true;mesh.receiveShadow=true;
  return mesh;
}

function lampMaterial(color,emissive,intensity=.5){
  return new THREE.MeshStandardMaterial({color,emissive,emissiveIntensity:intensity,roughness:.35,metalness:.08});
}

function addWheel(root,spec,x,z,isFront,wheels,frontPivots){
  const pivot=new THREE.Group();pivot.position.set(x,spec.wheelRadius,z);root.add(pivot);
  const tyre=new THREE.Mesh(cachedCylinderGeometry(spec.wheelRadius,spec.wheelRadius,.25,18,true),shared.tyre);tyre.castShadow=true;pivot.add(tyre);
  const rim=new THREE.Mesh(cachedCylinderGeometry(spec.wheelRadius*.54,spec.wheelRadius*.54,.265,14,true),shared.rim);pivot.add(rim);
  wheels.push(tyre,rim);if(isFront)frontPivots.push(pivot);
}

function addLights(root,spec,brakeMat,headMat,indicatorLeftMat,indicatorRightMat){
  const brakeLights=[],leftIndicators=[],rightIndicators=[];
  for(const x of [-spec.width*.31,spec.width*.31]){
    const tail=box(.28,.14,.075,brakeMat,x,spec.wheelRadius+.34,-spec.length*.502);root.add(tail);brakeLights.push(tail);
    const head=box(.32,.15,.075,headMat,x,spec.wheelRadius+.36,spec.length*.502);root.add(head);
    const indicatorMat=x<0?indicatorLeftMat:indicatorRightMat;
    const collection=x<0?leftIndicators:rightIndicators;
    const rearInd=box(.11,.12,.082,indicatorMat,x>0?spec.width*.43:-spec.width*.43,spec.wheelRadius+.34,-spec.length*.503);root.add(rearInd);collection.push(rearInd);
    const frontInd=box(.11,.12,.082,indicatorMat,x>0?spec.width*.43:-spec.width*.43,spec.wheelRadius+.34,spec.length*.503);root.add(frontInd);collection.push(frontInd);
  }
  const frontPlate=box(.48,.12,.045,shared.plate,0,spec.wheelRadius+.17,spec.length*.51);root.add(frontPlate);
  const rearPlate=box(.48,.12,.045,shared.blackPlate,0,spec.wheelRadius+.17,-spec.length*.51);root.add(rearPlate);
  return {brakeLights,leftIndicators,rightIndicators};
}

function addCarBody(root,spec,bodyMat,glassMat,style){
  const floorY=spec.wheelRadius*.58;
  const lowerH=style==="sports"?.46:.56;
  const lower=new THREE.Mesh(taperedBox(spec.width,spec.width*.94,lowerH,spec.length,.16,.08),bodyMat);
  lower.position.y=floorY;lower.castShadow=true;lower.receiveShadow=true;root.add(lower);

  const hoodLength=style==="hatch"?1.05:style==="sports"?1.48:1.28;
  const hood=box(spec.width*.88,.17,hoodLength,bodyMat,0,floorY+lowerH+.04,spec.length*.5-hoodLength*.54);root.add(hood);
  hood.rotation.x=style==="sports"?-.035:0;

  const cabinLength=style==="hatch"?2.28:style==="sports"?2.05:style==="suv"?2.45:2.28;
  const cabinHeight=spec.height-floorY-lowerH*.55;
  const cabinZ=style==="hatch"?-.18:style==="sports"?-.18:-.25;
  const cabin=new THREE.Mesh(taperedBox(spec.width*.82,spec.width*.66,cabinHeight,cabinLength,.32,.22),glassMat);
  cabin.position.set(0,floorY+lowerH*.78,cabinZ);cabin.castShadow=true;root.add(cabin);

  const roof=box(spec.width*.62,.08,cabinLength*.48,bodyMat,0,floorY+lowerH*.78+cabinHeight+.015,cabinZ-.04);root.add(roof);
  root.add(box(spec.width*.98,.16,.16,shared.dark,0,floorY+.16,spec.length*.5+.02));
  root.add(box(spec.width*.98,.16,.16,shared.dark,0,floorY+.16,-spec.length*.5-.02));
  root.add(box(.08,.18,.42,shared.dark,-spec.width*.51,floorY+lowerH+.15,.42));
  root.add(box(.08,.18,.42,shared.dark,spec.width*.51,floorY+lowerH+.15,.42));
}

function addVanBody(root,spec,bodyMat,glassMat,isEmergency){
  const floorY=spec.wheelRadius*.56;
  const lower=new THREE.Mesh(taperedBox(spec.width,spec.width*.96,.62,spec.length,.08,.05),bodyMat);
  lower.position.y=floorY;lower.castShadow=true;lower.receiveShadow=true;root.add(lower);
  const cargo=box(spec.width*.95,spec.height-1.0,spec.length*.58,bodyMat,0,1.25,-spec.length*.17);root.add(cargo);
  const cab=new THREE.Mesh(taperedBox(spec.width*.93,spec.width*.80,1.25,spec.length*.34,.28,.08),glassMat);
  cab.position.set(0,.9,spec.length*.29);cab.castShadow=true;root.add(cab);
  root.add(box(spec.width*.86,.18,spec.length*.25,bodyMat,0,.83,spec.length*.39));
  root.add(box(.08,.75,spec.length*.38,shared.dark,-spec.width*.49,1.38,-spec.length*.12));
  if(isEmergency){
    const stripe=box(spec.width*1.01,.18,spec.length*.58,new THREE.MeshStandardMaterial({color:0xe83c32,emissive:0x350503,emissiveIntensity:.25}),0,1.15,-spec.length*.17);root.add(stripe);
  }
}

function addBusBody(root,spec,bodyMat,glassMat){
  const lower=box(spec.width,.74,spec.length,bodyMat,0,.72,0);root.add(lower);
  const upper=box(spec.width*.96,1.75,spec.length*.92,bodyMat,0,1.85,-.12);root.add(upper);
  const windows=box(spec.width*.975,.82,spec.length*.82,glassMat,0,2.18,.05);root.add(windows);
  const roof=box(spec.width*.92,.16,spec.length*.88,shared.dark,0,3.05,-.05);root.add(roof);
  const destination=box(spec.width*.7,.25,.06,lampMaterial(0x162119,0x73ff8c,1.1),0,2.73,spec.length*.465);root.add(destination);

  // A lightweight but complete saloon makes the passenger camera feel like it is inside a bus,
  // rather than clipping into an empty exterior shell.
  const floorMat=new THREE.MeshStandardMaterial({color:0x57595a,roughness:.92});
  const seatMat=new THREE.MeshStandardMaterial({color:0x345879,roughness:.76});
  const poleMat=new THREE.MeshStandardMaterial({color:0xd3bd48,roughness:.42,metalness:.28});
  const partitionMat=new THREE.MeshStandardMaterial({color:0x6e858d,transparent:true,opacity:.42,roughness:.22});
  root.add(box(spec.width*.84,.08,spec.length*.78,floorMat,0,1.06,-.20));
  root.add(box(spec.width*.78,.06,spec.length*.72,new THREE.MeshStandardMaterial({color:0xe8e4d4,roughness:.82}),0,2.91,-.18));
  const passengerSeatOffsets=[];
  const seatRows=[-3.65,-2.65,-1.65,-.65,.35,1.35,2.35];
  for(const z of seatRows)for(const x of[-.72,.72]){
    const seatRoot=new THREE.Group();seatRoot.position.set(x,1.18,z);root.add(seatRoot);
    seatRoot.add(box(.52,.17,.48,seatMat,0,.28,0));
    seatRoot.add(box(.52,.64,.15,seatMat,0,.56,-.18));
    seatRoot.add(box(.06,.34,.06,shared.dark,-.18,.02,-.12));seatRoot.add(box(.06,.34,.06,shared.dark,.18,.02,-.12));
    passengerSeatOffsets.push(new THREE.Vector3(x,1.85,z+.06));
  }
  for(const z of[-3.2,-1.2,.8,2.2]){
    const pole=new THREE.Mesh(cachedCylinderGeometry(.025,.025,1.75,8),poleMat);pole.position.set(0,1.96,z);root.add(pole);
  }
  const grabRail=new THREE.Mesh(cachedCylinderGeometry(.025,.025,6.9,8),poleMat);grabRail.rotation.x=Math.PI/2;grabRail.position.set(0,2.62,-.25);root.add(grabRail);
  root.add(box(.06,1.42,1.18,partitionMat,-.42,1.78,3.70));
  root.add(box(.64,.48,.46,shared.dark,.52,1.55,4.10));
  root.add(box(.52,.72,.38,seatMat,.56,1.43,3.54));

  const doorRoot=new THREE.Group();doorRoot.position.set(-spec.width*.505,1.55,spec.length*.28);root.add(doorRoot);
  const frontLeaf=box(.05,1.55,.64,glassMat,0,0,.34),rearLeaf=box(.05,1.55,.64,glassMat,0,0,-.34);
  doorRoot.add(frontLeaf,rearLeaf);
  return{doorRoot,doorLeaves:[frontLeaf,rearLeaf],doorLocalPosition:new THREE.Vector3(-spec.width*.58,1.2,spec.length*.28),passengerSeatOffsets};
}

function addLorryBody(root,spec,bodyMat,glassMat){
  const cabLength=3.5;
  const trailerLength=8.0;
  const cab=box(spec.width,2.5,cabLength,bodyMat,0,1.55,spec.length*.5-cabLength*.55);root.add(cab);
  const windscreen=box(spec.width*.78,.75,.07,glassMat,0,2.15,spec.length*.5-.07);root.add(windscreen);
  const trailer=box(spec.width,2.75,trailerLength,new THREE.MeshStandardMaterial({color:0xc2c5c5,roughness:.64,metalness:.12}),0,1.75,-spec.length*.22);root.add(trailer);
  const chassis=box(spec.width*.72,.24,spec.length*.85,shared.dark,0,.63,-.15);root.add(chassis);
}

export function getVehicleDimensions(kind="car"){
  const spec=specs[kind]??specs.car;
  return {length:spec.length,width:spec.width,height:spec.height,wheelbase:spec.wheelbase,wheelRadius:spec.wheelRadius};
}

export function createVehicleMesh(kind="car",colorIndex=0){
  const spec={...(specs[kind]??specs.car)};
  const group=new THREE.Group();
  const bodyRoot=new THREE.Group();group.add(bodyRoot);
  const isEmergency=kind==="emergency";
  const bodyColor=isEmergency?0xf1f1ed:kind==="taxi"?0xcaa72b:bodyPalette[colorIndex%bodyPalette.length];
  const bodyMat=cachedBodyMaterial(bodyColor);
  const glassMat=shared.glass;
  const brakeMat=lampMaterial(0x61110d,0x330200,.35);
  const headMat=lampMaterial(0xe7e5cf,0xb8b078,.85);
  const indicatorLeftMat=lampMaterial(0x5a3510,0x381800,.18);
  const indicatorRightMat=indicatorLeftMat.clone();
  const wheels=[],frontPivots=[];

  let bodyFeatures={};
  if(spec.body==="bus")bodyFeatures=addBusBody(bodyRoot,spec,bodyMat,glassMat)??{};
  else if(spec.body==="lorry")addLorryBody(bodyRoot,spec,bodyMat,glassMat);
  else if(spec.body==="van")addVanBody(bodyRoot,spec,bodyMat,glassMat,isEmergency);
  else addCarBody(bodyRoot,spec,bodyMat,glassMat,spec.body);

  const frontZ=spec.wheelbase*.5,rearZ=-spec.wheelbase*.5;
  const wheelXs=[-spec.width*.49,spec.width*.49];
  for(const x of wheelXs){addWheel(bodyRoot,spec,x,frontZ,true,wheels,frontPivots);addWheel(bodyRoot,spec,x,rearZ,false,wheels,frontPivots);}
  if(kind==="bus"||kind==="lorry")for(const x of wheelXs)addWheel(bodyRoot,spec,x,-spec.wheelbase*.15,false,wheels,frontPivots);

  const lightRefs=addLights(bodyRoot,spec,brakeMat,headMat,indicatorLeftMat,indicatorRightMat);
  if(kind==="taxi")bodyRoot.add(box(.72,.22,.42,lampMaterial(0xf2e7b4,0x756a2c,.55),0,spec.height+.12,-.08));
  if(isEmergency){
    const lightbarMat=lampMaterial(0x2775ff,0x0a42b4,2.4);
    const bar=box(spec.width*.62,.13,.38,lightbarMat,0,spec.height+.12,-.15);bodyRoot.add(bar);group.userData.lightbar=bar;
  }

  const dynamicObjects=new Set([bodyRoot,...wheels,...frontPivots,...(bodyFeatures.doorLeaves??[])]),shadowCasters=[];
  group.traverse(object=>{
    if(object.isMesh&&object.castShadow)shadowCasters.push(object);
    if(object===group||dynamicObjects.has(object))return;
    object.updateMatrix();object.matrixAutoUpdate=false;
  });
  group.userData={...group.userData,kind,length:spec.length,width:spec.width,height:spec.height,wheelbase:spec.wheelbase,wheelRadius:spec.wheelRadius,wheels,frontPivots,bodyMat,bodyColor,bodyRoot,brakeMat,headMat,indicatorLeftMat,indicatorRightMat,indicatorDirection:0,...lightRefs,...bodyFeatures,shadowCasters,shadowState:true,previousSpeed:0,suspensionBase:0,doorsOpen:false,doorAmount:0};
  return group;
}

export function createVehicleLowMesh(kind="car",color=0x66717a){
  const spec=specs[kind]??specs.car,group=new THREE.Group();
  const bodyColor=color?.isColor?color:new THREE.Color(color);
  const bodyMat=cachedLowMaterial(kind,bodyColor);
  const glassMat=cachedLowMaterial("glass",0x38515c);
  const lower=new THREE.Mesh(cachedBoxGeometry(spec.width,spec.height*.42,spec.length),bodyMat);
  lower.position.y=spec.wheelRadius+spec.height*.21;group.add(lower);
  if(kind==="lorry"){
    const trailer=new THREE.Mesh(cachedBoxGeometry(spec.width,2.45,spec.length*.62),cachedLowMaterial("trailer",0xaeb3b4));
    trailer.position.set(0,1.65,-spec.length*.18);group.add(trailer);
    const cab=new THREE.Mesh(cachedBoxGeometry(spec.width*.94,1.95,spec.length*.28),bodyMat);cab.position.set(0,1.45,spec.length*.34);group.add(cab);
  }else{
    const upperLength=kind==="bus"?spec.length*.88:kind==="van"||kind==="emergency"?spec.length*.55:spec.length*.48;
    const upperHeight=kind==="bus"?spec.height*.56:kind==="van"||kind==="emergency"?spec.height*.55:spec.height*.42;
    const upper=new THREE.Mesh(cachedBoxGeometry(spec.width*.88,upperHeight,upperLength),glassMat);
    upper.position.set(0,spec.wheelRadius+spec.height*.52,kind==="bus"?0:-spec.length*.05);group.add(upper);
  }
  group.traverse(object=>{if(object===group)return;object.updateMatrix();object.matrixAutoUpdate=false;});
  group.userData={kind,length:spec.length,width:spec.width,height:spec.height};
  return group;
}

export function setHeadlightState(mesh,on){
  if(!mesh?.userData?.headMat)return;
  mesh.userData.headMat.emissiveIntensity=on?2.2:.65;
  mesh.userData.headMat.color.setHex(on?0xfff9db:0xe7e5cf);
}

export function animateVehicleMesh(mesh,speed,steer,dt,time){
  const data=mesh.userData;
  const wheelRadius=data.wheelRadius??.34;
  for(const wheel of data.wheels??[])wheel.rotation.x-=speed*dt/wheelRadius;
  for(const pivot of data.frontPivots??[])pivot.rotation.y=THREE.MathUtils.lerp(pivot.rotation.y,-steer*.42,1-Math.exp(-dt*12));

  const decel=(data.previousSpeed-speed)/Math.max(dt,.001);
  data.previousSpeed=speed;
  if(data.brakeMat)data.brakeMat.emissiveIntensity=decel>1.2?3.6:.42;
  if(data.indicatorLeftMat&&data.indicatorRightMat){
    const automaticDirection=data.indicatorDirection??0;
    const steeringDirection=automaticDirection===0&&Math.abs(steer)>.22?(steer>0?-1:1):0;
    const direction=automaticDirection||steeringDirection;
    const flash=Math.sin(time*8)>0;
    data.indicatorLeftMat.emissiveIntensity=direction<0&&flash?2.8:.16;
    data.indicatorRightMat.emissiveIntensity=direction>0&&flash?2.8:.16;
  }
  if(data.bodyRoot){
    const speedRatio=Math.min(1,Math.abs(speed)/25);
    data.bodyRoot.position.y=data.suspensionBase+Math.sin(time*9+mesh.id)*.008*speedRatio;
    data.bodyRoot.rotation.z=THREE.MathUtils.lerp(data.bodyRoot.rotation.z,-steer*speedRatio*.035,1-Math.exp(-dt*5));
    data.bodyRoot.rotation.x=THREE.MathUtils.lerp(data.bodyRoot.rotation.x,THREE.MathUtils.clamp(decel*.0025,-.025,.035),1-Math.exp(-dt*7));
  }
  if(data.doorLeaves){
    const target=data.doorsOpen?1:0;
    data.doorAmount=THREE.MathUtils.lerp(data.doorAmount??0,target,1-Math.exp(-dt*5.5));
    data.doorLeaves[0].position.z=.34+data.doorAmount*.42;
    data.doorLeaves[1].position.z=-.34-data.doorAmount*.42;
  }
  if(data.lightbar){
    const blue=Math.sin(time*18)>0;
    data.lightbar.material.emissiveIntensity=blue?5:.7;
    data.lightbar.material.color.setHex(blue?0x2775ff:0xff3030);
    data.lightbar.material.emissive.setHex(blue?0x0a42b4:0x8b0505);
  }
}
