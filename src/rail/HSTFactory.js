import * as THREE from "three";

const LIVERIES={
  classic:{name:"Original InterCity 125",body:0x1e4d7b,lower:0x193d63,roof:0x3c4348,band:0x16344f,stripe:0xf1c52b,nose:0xf1c52b,coachBody:0xc7c9c5,coachLower:0x244f7f,coachBand:0x253845,coachStripe:0xc63f35,number:"253001"},
  executive:{name:"InterCity Executive",body:0xc7c8c3,lower:0x244f7f,roof:0x454b50,band:0x20252b,stripe:0xc94135,nose:0xf0c72b,coachBody:0xc7c9c5,coachLower:0x244f7f,coachBand:0x20252b,coachStripe:0xc94135},
  green:{name:"Western green",body:0x173d2f,lower:0x102e25,roof:0x30383a,band:0x142326,stripe:0xd8b64a,nose:0xf2c72d,coachBody:0x173d2f,coachLower:0x102e25,coachBand:0x18272a,coachStripe:0xd8b64a},
  crosscountry:{name:"Cross-country maroon",body:0x352332,lower:0x211822,roof:0x292d31,band:0x1a2025,stripe:0xd8423e,nose:0xf0c728,coachBody:0x352332,coachLower:0x211822,coachBand:0x1a2025,coachStripe:0xd8423e},
  measurement:{name:"Infrastructure measurement",body:0xf0bf21,lower:0xd39d13,roof:0x33393d,band:0x1b252c,stripe:0x303b44,nose:0xf2c52c,coachBody:0xf0bf21,coachLower:0xd39d13,coachBand:0x26343b,coachStripe:0x303b44}
};
const FLEET_LIVERIES=["classic","executive","green","crosscountry","measurement"];
const CLASS43_COLLISION_PROFILE=Object.freeze({
  id:"class43-power",minimumHeight:0,maximumHeight:3.92,polygons:Object.freeze([Object.freeze([
    Object.freeze([-1.37,-6.85]),Object.freeze([1.37,-6.85]),Object.freeze([1.405,-5.88]),Object.freeze([1.405,2.68]),
    Object.freeze([1.34,3.55]),Object.freeze([1.16,4.55]),Object.freeze([.98,5.38]),Object.freeze([.76,6.05]),
    Object.freeze([1.16,6.43]),Object.freeze([1.16,6.57]),Object.freeze([.35,6.76]),Object.freeze([-.35,6.76]),
    Object.freeze([-1.16,6.57]),Object.freeze([-1.16,6.43]),Object.freeze([-.76,6.05]),Object.freeze([-.98,5.38]),
    Object.freeze([-1.16,4.55]),Object.freeze([-1.34,3.55]),Object.freeze([-1.405,2.68]),Object.freeze([-1.405,-5.88])
  ])])
});

const MARK3_COLLISION_PROFILE=Object.freeze({
  id:"mark3-coach",minimumHeight:0,maximumHeight:3.63,polygons:Object.freeze([
    Object.freeze([Object.freeze([-1.38,-7.275]),Object.freeze([1.38,-7.275]),Object.freeze([1.38,7.275]),Object.freeze([-1.38,7.275])]),
    Object.freeze([Object.freeze([1.38,-6.97]),Object.freeze([1.43,-6.97]),Object.freeze([1.43,-6.13]),Object.freeze([1.38,-6.13])]),
    Object.freeze([Object.freeze([-1.43,-6.97]),Object.freeze([-1.38,-6.97]),Object.freeze([-1.38,-6.13]),Object.freeze([-1.43,-6.13])]),
    Object.freeze([Object.freeze([1.38,6.13]),Object.freeze([1.43,6.13]),Object.freeze([1.43,6.97]),Object.freeze([1.38,6.97])]),
    Object.freeze([Object.freeze([-1.43,6.13]),Object.freeze([-1.38,6.13]),Object.freeze([-1.38,6.97]),Object.freeze([-1.43,6.97])])
  ])
});


const geometryCache=new Map(),materialCache=new Map(),loftCache=new Map();
function cachedGeometry(type,key,create){const cacheKey=`${type}:${key}`;let geometry=geometryCache.get(cacheKey);if(!geometry){geometry=create();geometryCache.set(cacheKey,geometry);}return geometry;}
function boxGeometry(w,h,d){return cachedGeometry("box",`${w}:${h}:${d}`,()=>new THREE.BoxGeometry(w,h,d));}
function unitBoxGeometry(){return boxGeometry(1,1,1);}
function cylinderGeometry(top,bottom,height,segments){return cachedGeometry("cylinder",`${top}:${bottom}:${height}:${segments}`,()=>new THREE.CylinderGeometry(top,bottom,height,segments));}
function torusGeometry(radius,tube,radial,tubular){return cachedGeometry("torus",`${radius}:${tube}:${radial}:${tubular}`,()=>new THREE.TorusGeometry(radius,tube,radial,tubular));}
function planeGeometry(w,h){return cachedGeometry("plane",`${w}:${h}`,()=>new THREE.PlaneGeometry(w,h));}
function material(color,roughness=.5,metalness=.12,extra={}){const{shared=true,...options}=extra;if(!shared)return new THREE.MeshStandardMaterial({color,roughness,metalness,...options});const key=JSON.stringify([color,roughness,metalness,Object.entries(options).sort(([a],[b])=>a.localeCompare(b))]);let result=materialCache.get(key);if(!result){result=new THREE.MeshStandardMaterial({color,roughness,metalness,...options});materialCache.set(key,result);}return result;}
function box(w,h,d,mat,x=0,y=0,z=0){const m=new THREE.Mesh(boxGeometry(w,h,d),mat);m.position.set(x,y,z);m.castShadow=true;m.receiveShadow=true;return m;}
function addInstancedBoxes(parent,mat,specs,name){if(!specs.length)return null;const mesh=new THREE.InstancedMesh(unitBoxGeometry(),mat,specs.length),transform=new THREE.Object3D();mesh.name=name;for(let index=0;index<specs.length;index++){const spec=specs[index];transform.position.set(spec.x,spec.y,spec.z);transform.rotation.set(0,spec.rotationY??0,0);transform.scale.set(spec.w,spec.h,spec.d);transform.updateMatrix();mesh.setMatrixAt(index,transform.matrix);}mesh.instanceMatrix.setUsage(THREE.StaticDrawUsage);mesh.computeBoundingSphere();parent.add(mesh);return mesh;}

function createCoachSidePanelSpecs(windowZ,{sideBottom=.24,sideTop=3.08,windowBottom=1.80,windowTop=2.80,doorBottom=.76,doorTop=2.66}={}){
  const halfLength=7.18,windowHalfLength=.61,doorHalfLength=.46;
  const openings=[
    ...windowZ.map(z=>({z0:z-windowHalfLength,z1:z+windowHalfLength,y0:windowBottom,y1:windowTop,type:"window"})),
    {z0:-6.55-doorHalfLength,z1:-6.55+doorHalfLength,y0:doorBottom,y1:doorTop,type:"door"},
    {z0:6.55-doorHalfLength,z1:6.55+doorHalfLength,y0:doorBottom,y1:doorTop,type:"door"}
  ];
  const zCuts=[-halfLength,halfLength],yCuts=[sideBottom,sideTop];
  for(const opening of openings){zCuts.push(opening.z0,opening.z1);yCuts.push(opening.y0,opening.y1);}
  zCuts.sort((a,b)=>a-b);yCuts.sort((a,b)=>a-b);
  const unique=values=>values.filter((value,index)=>index===0||Math.abs(value-values[index-1])>1e-6),zs=unique(zCuts),ys=unique(yCuts);
  const specs={lower:[],body:[],band:[]};
  for(let yi=0;yi<ys.length-1;yi++)for(let zi=0;zi<zs.length-1;zi++){
    const y0=ys[yi],y1=ys[yi+1],z0=zs[zi],z1=zs[zi+1],cy=(y0+y1)*.5,cz=(z0+z1)*.5;
    if(y1-y0<.015||z1-z0<.015)continue;
    if(openings.some(opening=>cy>opening.y0+1e-6&&cy<opening.y1-1e-6&&cz>opening.z0+1e-6&&cz<opening.z1-1e-6))continue;
    const bucket=cy<1.14?specs.lower:cy>=windowBottom&&cy<=windowTop?specs.band:specs.body;
    for(const side of[-1,1])bucket.push({w:.052,h:y1-y0,d:z1-z0,x:side*1.362,y:cy,z:cz});
  }
  return{specs,openings,windowBottom,windowTop,doorBottom,doorTop};
}

function loftGeometry(sections,{openSides=false}={}){
  const key=JSON.stringify({sections,openSides}),cached=loftCache.get(key);if(cached)return cached;
  const ringSize=6,vertices=[];
  for(const s of sections){
    vertices.push(
      -s.halfWidth,0,s.z,
      -s.halfWidth,s.shoulderY,s.z,
      -s.roofHalfWidth,s.roofY,s.z,
      s.roofHalfWidth,s.roofY,s.z,
      s.halfWidth,s.shoulderY,s.z,
      s.halfWidth,0,s.z
    );
  }
  const indices=[];
  for(let r=0;r<sections.length-1;r++)for(let i=0;i<ringSize;i++){
    // Mark 3 coaches use separately constructed side panels with real window
    // and doorway apertures. Omitting the two vertical loft faces prevents an
    // opaque shell from sitting behind otherwise transparent glass.
    if(openSides&&(i===0||i===4))continue;
    const n=(i+1)%ringSize,a=r*ringSize+i,b=r*ringSize+n,c=(r+1)*ringSize+n,d=(r+1)*ringSize+i;
    indices.push(a,b,c,a,c,d);
  }
  const cap=(ring,reverse)=>{
    const base=ring*ringSize;
    for(let i=1;i<ringSize-1;i++)reverse?indices.push(base,base+i+1,base+i):indices.push(base,base+i,base+i+1);
  };
  cap(0,true);cap(sections.length-1,false);
  const g=new THREE.BufferGeometry();g.setAttribute("position",new THREE.Float32BufferAttribute(vertices,3));g.setIndex(indices);g.computeVertexNormals();loftCache.set(key,g);return g;
}

function labelTexture(text,bg="#18232c",fg="#f4f0dc"){
  if(typeof document==="undefined"||!document.createElement)return null;
  const canvas=document.createElement("canvas");canvas.width=256;canvas.height=64;const ctx=canvas.getContext("2d");
  ctx.fillStyle=bg;ctx.fillRect(0,0,canvas.width,canvas.height);ctx.fillStyle=fg;ctx.font="700 38px Arial";ctx.textAlign="center";ctx.textBaseline="middle";ctx.fillText(text,128,34);
  const texture=new THREE.CanvasTexture(canvas);texture.colorSpace=THREE.SRGBColorSpace;texture.anisotropy=4;return texture;
}
function labelPlane(text,w,h,bg,fg){const tex=labelTexture(text,bg,fg);return new THREE.Mesh(planeGeometry(w,h),new THREE.MeshBasicMaterial(tex?{map:tex,transparent:false}:{color:bg,side:THREE.DoubleSide}));}

function addBogie(group,z){
  if(!group.userData.wheels)group.userData.wheels=[];
  const frameMat=material(0x252b2f,.86,.28),wheelMat=material(0x111518,.78,.38),steel=material(0x747b80,.42,.48),springMat=material(0x343a3e,.7,.32);
  group.add(box(2.3,.28,2.82,frameMat,0,.58,z));
  for(const x of[-1.0,1.0])group.add(box(.18,.60,2.50,frameMat,x,.54,z));
  for(const axleZ of[z-.80,z+.80]){
    const axle=new THREE.Mesh(cylinderGeometry(.065,.065,1.82,10),steel);axle.rotation.z=Math.PI/2;axle.position.set(0,.43,axleZ);group.add(axle);
    for(const x of[-.80,.80]){
      const tyre=new THREE.Mesh(cylinderGeometry(.42,.42,.22,20),wheelMat);tyre.rotation.z=Math.PI/2;tyre.position.set(x,.42,axleZ);group.add(tyre);group.userData.wheels.push(tyre);
      const hub=new THREE.Mesh(cylinderGeometry(.19,.19,.235,14),steel);hub.rotation.z=Math.PI/2;hub.position.set(x,.42,axleZ);group.add(hub);group.userData.wheels.push(hub);
    }
  }
  for(const x of[-.76,.76])for(const dz of[-.30,.30]){
    const spring=new THREE.Mesh(torusGeometry(.13,.035,6,12),springMat);spring.rotation.y=Math.PI/2;spring.position.set(x,.78,z+dz);group.add(spring);
  }
  for(const dz of[-.78,.78])group.add(box(1.95,.10,.12,steel,0,.70,z+dz));
}

function addRoofFan(group,z,w=1.24,l=1.08){
  const frame=box(w,.08,l,material(0x50575c,.62,.22),0,3.59,z);group.add(frame);
  const grille=material(0x20262a,.8,.22);
  for(let i=0;i<7;i++)group.add(box(w*.82,.025,.055,grille,0,3.64,z-l*.30+i*l*.10));
}

function addUnderframe(group,z0,z1){
  const dark=material(0x20252a,.88,.18),metal=material(0x646b70,.5,.36);const span=z1-z0;
  group.add(box(1.42,.58,span*.42,dark,0,.55,(z0+z1)*.5));
  group.add(box(.72,.42,1.46,dark,-.55,.50,z0+span*.18));group.add(box(.72,.42,1.46,dark,.55,.50,z1-span*.18));
  for(const x of[-.88,.88])for(const z of[z0+span*.14,z1-span*.14]){
    const pipe=new THREE.Mesh(cylinderGeometry(.04,.04,.78,8),metal);pipe.rotation.z=Math.PI/2;pipe.position.set(x,.46,z);group.add(pipe);
  }
}

function addRadiatorPanel(group,side,z,mat){
  const panel=box(.055,1.00,2.45,mat,side*1.372,2.23,z);group.add(panel);
  const slat=material(0x11171b,.82,.18);
  for(let i=0;i<13;i++)group.add(box(.064,.72,.055,slat,side*1.405,2.23,z-1.05+i*.175));
}

function addLightCluster(group,x,z,frontLights,tailLights){
  const surround=material(0x20262a,.48,.16);group.add(box(.62,.38,.08,surround,x,1.57,z));
  for(const dx of[-.15,.15]){
    const lampMat=material(0xf7f0d4,.18,.02,{emissive:0x8d8250,emissiveIntensity:.35,shared:false});
    const lamp=new THREE.Mesh(cylinderGeometry(.10,.10,.045,16),lampMat);lamp.rotation.x=Math.PI/2;lamp.position.set(x+dx,1.58,z+.055);group.add(lamp);frontLights.push(lamp);
  }
  const tailMat=material(0xbd2d24,.22,.02,{emissive:0x4f0a07,emissiveIntensity:.18,shared:false});
  const tail=new THREE.Mesh(cylinderGeometry(.065,.065,.05,14),tailMat);tail.rotation.x=Math.PI/2;tail.position.set(x,1.27,z+.06);group.add(tail);tailLights.push(tail);
}

export function createClass43PowerCar({rear=false,number="43002",livery="executive"}={}){
  const scheme=LIVERIES[livery]??LIVERIES.executive,g=new THREE.Group();
  const body=material(scheme.body,.50,.13),lower=material(scheme.lower,.46,.20),roof=material(scheme.roof,.74,.24),band=material(scheme.band,.30,.18),stripe=material(scheme.stripe,.46,.08),yellow=material(scheme.nose,.52,.05);
  const glass=material(0x8aa9b8,.12,.18,{transparent:true,opacity:.36,depthWrite:false,side:THREE.DoubleSide}),black=material(0x14191d,.84,.16),silver=material(0x7e878d,.40,.42),cabInterior=material(0x77736c,.82,.02);
  const frontLights=[],tailLights=[];

  // Long engine-room body with gently crowned roof.
  const rearShell=new THREE.Mesh(loftGeometry([
    {z:-6.85,halfWidth:1.37,shoulderY:2.82,roofHalfWidth:1.08,roofY:3.30},
    {z:-2.10,halfWidth:1.37,shoulderY:2.82,roofHalfWidth:1.08,roofY:3.30},
    {z:1.45,halfWidth:1.35,shoulderY:2.78,roofHalfWidth:1.04,roofY:3.28}
  ]),body);rearShell.position.y=.26;rearShell.castShadow=true;rearShell.receiveShadow=true;g.add(rearShell);
  g.add(box(2.76,.72,12.6,lower,0,.78,-.38));
  g.add(box(2.73,.78,8.20,band,0,2.30,-2.02));
  g.add(box(2.76,.11,8.32,stripe,0,2.89,-2.02));
  g.add(box(2.48,.16,7.88,roof,0,3.54,-2.02));

  // Multi-section aerodynamic nose inspired by the 43002 museum car and original publicity views.
  const noseSections=[
    {z:1.30,halfWidth:1.34,shoulderY:2.70,roofHalfWidth:1.02,roofY:3.25},
    {z:2.45,halfWidth:1.33,shoulderY:2.66,roofHalfWidth:.98,roofY:3.18},
    {z:3.55,halfWidth:1.28,shoulderY:2.55,roofHalfWidth:.90,roofY:3.03},
    {z:4.55,halfWidth:1.16,shoulderY:2.32,roofHalfWidth:.78,roofY:2.78},
    {z:5.38,halfWidth:.98,shoulderY:2.03,roofHalfWidth:.62,roofY:2.45},
    {z:6.05,halfWidth:.76,shoulderY:1.70,roofHalfWidth:.40,roofY:2.00},
    {z:6.46,halfWidth:.50,shoulderY:1.40,roofHalfWidth:.22,roofY:1.58}
  ];
  const nose=new THREE.Mesh(loftGeometry(noseSections),yellow);nose.position.y=.36;nose.castShadow=true;nose.receiveShadow=true;g.add(nose);

  // Blue/dark cab mask and window surround.
  g.add(box(2.33,.50,.20,scheme.name==="Original InterCity 125"?body:band,0,2.61,5.44));
  for(const x of[-.47,.47]){
    const windscreen=new THREE.Mesh(planeGeometry(.82,.64),glass);windscreen.position.set(x,2.74,5.98);windscreen.rotation.x=-.28;windscreen.rotation.y=x<0?.045:-.045;g.add(windscreen);
    const wiper=box(.018,.31,.024,black,x*.64,2.59,6.02);wiper.rotation.z=x<0?-.20:.20;wiper.rotation.x=-.27;g.add(wiper);
  }
  g.add(box(.075,.69,.05,black,0,2.73,5.99));

  // Side cab windows, doors and stainless handrails.
  for(const side of[-1,1]){
    const cabWindow=box(.055,.64,.88,glass,side*1.378,2.63,4.38);g.add(cabWindow);
    const door=box(.055,1.90,.82,body,side*1.382,1.72,2.10);g.add(door);
    const doorGlass=box(.062,.66,.46,glass,side*1.39,2.30,2.09);g.add(doorGlass);
    for(const z of[1.63,2.56]){
      const railMesh=new THREE.Mesh(cylinderGeometry(.018,.018,1.20,8),silver);railMesh.position.set(side*1.43,1.80,z);g.add(railMesh);
    }
    const mirrorArm=box(.03,.17,.28,black,side*1.18,2.66,5.28);mirrorArm.rotation.z=-side*.34;g.add(mirrorArm);
    g.add(box(.045,.18,.15,black,side*1.29,2.69,5.31));
  }

  // Large engine-room radiator grilles, smaller intake panels and roof equipment.
  for(const side of[-1,1]){
    addRadiatorPanel(g,side,-3.62,band);
    addRadiatorPanel(g,side,-.78,band);
    for(let i=0;i<5;i++)g.add(box(.06,.18,.44,black,side*1.40,1.23,-5.35+i*.72));
  }
  addRoofFan(g,-3.32,1.34,1.18);addRoofFan(g,-1.62,1.18,1.02);
  for(const x of[-.34,.34]){const exhaust=new THREE.Mesh(cylinderGeometry(.075,.095,.40,12),black);exhaust.position.set(x,3.72,-.30);g.add(exhaust);}

  // Fixed Class 43 driving cab: control desk, driver seat, instrument panel
  // and unobstructed forward glazing. This group is culled with other train
  // interiors when the player is not close to the formation.
  const cabInteriorGroup=new THREE.Group();cabInteriorGroup.name="class43-driving-cab-interior";
  cabInteriorGroup.add(box(1.55,.20,.58,cabInterior,0,2.13,5.48),box(1.36,.44,.12,black,0,2.39,5.67));
  const driverSeat=new THREE.Group();driverSeat.add(box(.42,.16,.46,material(0x46515b,.78,.04),0,.53,0),box(.42,.68,.13,material(0x46515b,.78,.04),0,.87,-.18));driverSeat.position.set(-.34,1.19,4.92);cabInteriorGroup.add(driverSeat);
  for(const x of[-.48,-.24,0,.24,.48]){const instrument=box(.12,.075,.035,material(0x1c292f,.42,.08,{emissive:0x4e776f,emissiveIntensity:.45}),x,2.43,5.75);instrument.castShadow=false;cabInteriorGroup.add(instrument);}
  cabInteriorGroup.add(box(.07,.07,.42,silver,.42,2.33,5.35),box(.32,.07,.20,black,-.35,1.28,5.35));
  cabInteriorGroup.traverse(object=>{if(object.isMesh){object.castShadow=false;object.receiveShadow=false;}});g.add(cabInteriorGroup);

  // Original-style front light band: paired lamps, central grille and yellow number panel.
  g.add(box(2.32,.48,.10,band,0,1.56,6.48));
  addLightCluster(g,-.74,6.54,frontLights,tailLights);addLightCluster(g,.74,6.54,frontLights,tailLights);
  const grilleFrame=box(.56,.40,.11,black,0,1.56,6.55);g.add(grilleFrame);
  for(let i=0;i<9;i++)g.add(box(.022,.31,.025,silver,-.21+i*.052,1.56,6.62));
  const numberText=scheme.number??number;
  const frontLabel=labelPlane(numberText,.95,.24,"#efc527","#1c2830");frontLabel.position.set(0,.91,6.56);g.add(frontLabel);
  for(const side of[-1,1]){
    const sideLabel=labelPlane(number,.80,.17,"#24303b","#f2eee0");sideLabel.position.set(side*1.405,1.12,1.10);sideLabel.rotation.y=side>0?Math.PI/2:-Math.PI/2;g.add(sideLabel);
  }

  // Front coupler hatch, underframe, skirts and detailed bogies.
  g.add(box(.62,.30,.12,black,0,.53,6.47));g.add(box(.25,.16,.28,silver,0,.47,6.62));g.add(box(2.08,.20,.15,black,0,.65,6.47));
  for(const side of[-1,1])g.add(box(.07,.36,8.55,lower,side*1.405,.75,-1.60));
  addUnderframe(g,-5.15,1.20);addBogie(g,-4.10);addBogie(g,3.05);

  // Exhaust reference points for the rail system's subtle diesel haze.
  const exhaustPorts=[new THREE.Vector3(-.34,3.83,-.30),new THREE.Vector3(.34,3.83,-.30)];

  if(rear)g.rotation.y=Math.PI;
  g.userData={...g.userData,type:"class43-power",length:17.79,modelLength:13.9,width:2.74,height:3.92,rear,livery,liveryName:scheme.name,frontLights,tailLights,exhaustPorts,interiorGroup:cabInteriorGroup,cabInterior:{fixedLayout:true,clearForwardView:true},collisionProfile:CLASS43_COLLISION_PROFILE};
  return g;
}

export function createMark3Coach(index=0,livery="executive"){
  const scheme=LIVERIES[livery]??LIVERIES.executive,g=new THREE.Group();
  const body=material(scheme.coachBody,.60,.08),lower=material(scheme.coachLower,.48,.16),roof=material(scheme.roof,.74,.20),band=material(scheme.coachBand,.24,.18),stripe=material(scheme.coachStripe,.46,.08);
  const glass=material(0xb6d2dc,.08,.02,{transparent:true,opacity:.20,depthWrite:false,side:THREE.DoubleSide}),dark=material(0x20252a,.84,.18);
  const interiorWall=material(0xd8d3c8,.86,.02),floorMat=material(0x3a4650,.94,.01),seatMat=material(0x315b77,.80,.02),headrestMat=material(0xe7e4d8,.88,.01),seatFrame=material(0x6d7478,.46,.38),tableMat=material(0xb8aa91,.76,.04),rackMat=material(0x9ba1a4,.42,.46);
  const lightMat=material(0xfff3d1,.30,.02,{emissive:0xffe6a8,emissiveIntensity:1.25}),displayMat=material(0x101b20,.58,.08,{emissive:0x234b55,emissiveIntensity:.45});
  const shell=new THREE.Mesh(loftGeometry([
    {z:-7.18,halfWidth:1.36,shoulderY:2.84,roofHalfWidth:1.08,roofY:3.33},
    {z:0,halfWidth:1.36,shoulderY:2.84,roofHalfWidth:1.08,roofY:3.33},
    {z:7.18,halfWidth:1.36,shoulderY:2.84,roofHalfWidth:1.08,roofY:3.33}
  ],{openSides:true}),body);shell.position.y=.24;shell.castShadow=true;shell.receiveShadow=true;g.add(shell);
  // The under-floor block stops below the passenger floor. The carriage sides
  // are assembled separately so windows and doors are genuine apertures rather
  // than transparent meshes painted over an opaque box.
  g.add(box(2.56,.70,14.40,lower,0,.56,0));g.add(box(2.76,.12,14.50,stripe,0,2.91,0));g.add(box(2.50,.16,14.20,roof,0,3.55,0));

  const windowZ=Array.from({length:8},(_,i)=>-5.25+i*1.50),windowMeshes=[];
  const sideLayout=createCoachSidePanelSpecs(windowZ);
  addInstancedBoxes(g,lower,sideLayout.specs.lower,"mark3-lower-side-panels",{castShadow:true,receiveShadow:true});
  addInstancedBoxes(g,body,sideLayout.specs.body,"mark3-body-side-panels",{castShadow:true,receiveShadow:true});
  addInstancedBoxes(g,band,sideLayout.specs.band,"mark3-window-surround-panels",{castShadow:true,receiveShadow:true});
  for(const side of[-1,1])for(const z of windowZ){const windowMesh=box(.040,1.00,1.20,glass,side*1.390,2.30,z);windowMesh.castShadow=false;windowMesh.receiveShadow=false;windowMesh.renderOrder=3;windowMeshes.push(windowMesh);g.add(windowMesh);}

  // Mark 3-style powered passenger doors. The leaves remain part of the
  // exterior so they can animate even when the saloon interior is culled.
  const passengerDoors=[];
  for(const side of[-1,1])for(const z of[-6.55,6.55]){
    const leaves=[],aperture=new THREE.Group(),threshold=box(.34,.07,.84,floorMat,side*1.20,1.06,z);
    aperture.name="mark3-passenger-door-frame";aperture.position.set(side*1.425,0,z);
    // Jambs and lintel frame the opening without leaving a permanent black
    // rectangle behind the animated door leaves.
    aperture.add(box(.075,1.88,.075,dark,0,1.70,-.43),box(.075,1.88,.075,dark,0,1.70,.43),box(.075,.10,.86,dark,0,2.59,0));
    g.add(aperture,threshold);
    const warningLight=box(.075,.11,.10,material(0xa82118,.28,.04,{emissive:0x5f0805,emissiveIntensity:.15,shared:false}),side*1.445,2.72,z-.48);warningLight.castShadow=false;g.add(warningLight);
    for(const leafSign of[-1,1]){
      const leaf=new THREE.Group(),panel=box(.062,1.84,.35,lower,0,0,0),windowMesh=box(.070,.66,.23,glass,side*.012,.57,0);
      leaf.add(panel,windowMesh);leaf.position.set(side*1.40,1.70,z+leafSign*.18);g.add(leaf);leaves.push({group:leaf,baseZ:leaf.position.z,slide:leafSign*.42});
    }
    passengerDoors.push({side,z,leaves,aperture,threshold,warningLight,amount:0});
  }

  // Fixed British Rail Mark 3-inspired standard-class saloon. It is a single
  // deterministic layout rather than a customisation or random-colour system.
  const interiorGroup=new THREE.Group();interiorGroup.name="mark3-fixed-passenger-interior";g.add(interiorGroup);
  interiorGroup.add(box(2.27,.12,13.28,floorMat,0,1.00,0),box(2.22,.09,13.08,interiorWall,0,3.28,0));
  for(const side of[-1,1]){
    // Dado and ceiling valance leave the exterior windows genuinely clear.
    interiorGroup.add(box(.050,.66,10.92,interiorWall,side*1.175,1.45,0));
    interiorGroup.add(box(.050,.38,10.92,interiorWall,side*1.175,3.00,0));
    const boundaries=[-5.98,...windowZ.slice(0,-1).map((z,i)=>(z+windowZ[i+1])*.5),5.98];
    for(const z of boundaries)interiorGroup.add(box(.052,.98,.17,interiorWall,side*1.175,2.25,z));
  }

  const seats=[],seatColliders=[],seatCushions=[],seatBacks=[],seatHeadrests=[],seatLegs=[],seatArmrests=[];
  const seatXs=[-1.00,-.66,.66,1.00];
  for(let row=0;row<windowZ.length;row++){
    const facing=row%2===0?1:-1,rotationY=facing>0?0:Math.PI,z=windowZ[row];
    for(const x of seatXs){
      const seat=new THREE.Object3D();seat.name="mark3-seat";seat.position.set(x,1.00,z);seat.rotation.y=rotationY;seats.push(seat);seatColliders.push({x,z,halfWidth:.19,halfLength:.29});
      const rotatedZ=facing>0?1:-1;
      seatCushions.push({w:.31,h:.16,d:.48,x,y:1.53,z,rotationY});
      seatBacks.push({w:.31,h:.67,d:.12,x,y:1.88,z:z-.19*rotatedZ,rotationY});
      seatHeadrests.push({w:.27,h:.16,d:.135,x,y:2.13,z:z-.20*rotatedZ,rotationY});
      for(const sx of[-.12,.12])seatLegs.push({w:.035,h:.46,d:.035,x:x+(facing>0?sx:-sx),y:1.27,z:z+.03*rotatedZ,rotationY});
      for(const sx of[-.18,.18])seatArmrests.push({w:.035,h:.08,d:.42,x:x+(facing>0?sx:-sx),y:1.68,z:z+.02*rotatedZ,rotationY});
    }
  }
  addInstancedBoxes(interiorGroup,seatMat,seatCushions,"mark3-seat-cushions");addInstancedBoxes(interiorGroup,seatMat,seatBacks,"mark3-seat-backs");addInstancedBoxes(interiorGroup,headrestMat,seatHeadrests,"mark3-seat-headrests");addInstancedBoxes(interiorGroup,seatFrame,seatLegs,"mark3-seat-legs");addInstancedBoxes(interiorGroup,seatFrame,seatArmrests,"mark3-seat-armrests");

  const tables=[],tableColliders=[],tableTops=[],tableLegs=[];
  for(let pair=0;pair<windowZ.length;pair+=2){
    const z=(windowZ[pair]+windowZ[pair+1])*.5;
    for(const side of[-1,1]){const x=side*.83,table=new THREE.Object3D();table.name="mark3-window-table";table.position.set(x,1.00,z);tables.push(table);tableColliders.push({x,z,halfWidth:.39,halfLength:.31});tableTops.push({w:.73,h:.055,d:.56,x,y:1.76,z});tableLegs.push({w:.055,h:.70,d:.055,x,y:1.36,z});}
  }
  addInstancedBoxes(interiorGroup,tableMat,tableTops,"mark3-table-tops");addInstancedBoxes(interiorGroup,seatFrame,tableLegs,"mark3-table-legs");

  const luggageRacks=[],rackShelves=[],rackBars=[],rackSupports=[];
  for(const side of[-1,1]){
    const rack=new THREE.Object3D();rack.name="mark3-luggage-rack";luggageRacks.push(rack);rackShelves.push({w:.36,h:.035,d:10.65,x:side*.99,y:2.73,z:0});
    for(let i=0;i<12;i++)rackBars.push({w:.025,h:.08,d:.62,x:side*.99,y:2.77,z:-5.05+i*.92});
    for(const z of[-5.05,-3.35,-1.65,.05,1.75,3.45,5.05])rackSupports.push({w:.035,h:.42,d:.035,x:side*1.12,y:2.55,z});
  }
  addInstancedBoxes(interiorGroup,rackMat,rackShelves,"mark3-rack-shelves");addInstancedBoxes(interiorGroup,rackMat,rackBars,"mark3-rack-bars");addInstancedBoxes(interiorGroup,rackMat,rackSupports,"mark3-rack-supports");

  const vestibules=[];
  for(const z of[-5.98,5.98]){
    const vestibule=new THREE.Group();vestibule.name="mark3-vestibule";
    vestibule.add(box(.72,2.05,.08,interiorWall,-.82,2.03,z),box(.72,2.05,.08,interiorWall,.82,2.03,z),box(1.56,.25,.08,interiorWall,0,3.02,z));
    vestibule.add(box(.31,.70,.46,material(0x565d60,.78,.16),-1.00,1.43,z-(z>0?.30:-.30)),box(.31,.70,.46,material(0x565d60,.78,.16),1.00,1.43,z-(z>0?.30:-.30)));
    interiorGroup.add(vestibule);vestibules.push(vestibule);
  }

  const pisDisplays=[];
  for(const z of[-5.86,5.86]){
    const screen=box(.76,.24,.055,displayMat,0,2.87,z);screen.rotation.y=z<0?0:Math.PI;screen.castShadow=false;interiorGroup.add(screen);pisDisplays.push(screen);
    const label=labelPlane("CITY  •  AIRPORT",.70,.16,"#101b20","#d7d27a");label.position.set(0,2.87,z+(z<0?-.031:.031));label.rotation.y=z<0?Math.PI:0;interiorGroup.add(label);
  }

  const ceilingLights=[];
  for(const z of[-5.25,-3.75,-2.25,-.75,.75,2.25,3.75,5.25]){const lamp=box(.64,.035,.20,lightMat,0,3.19,z);lamp.castShadow=false;interiorGroup.add(lamp);ceilingLights.push(lamp);}

  // Open pressure-sealed gangway apertures and flexible bellows allow a
  // continuous usable route between adjacent coaches.
  const connectingDoors=[],gangways=[];
  for(const z of[-7.08,7.08]){
    const gangway=new THREE.Group();gangway.name="mark3-gangway-bellows";
    gangway.add(box(.16,2.18,.16,dark,-.78,2.03,z),box(.16,2.18,.16,dark,.78,2.03,z),box(1.72,.16,.16,dark,0,3.08,z),box(1.72,.14,.16,dark,0,1.02,z));
    g.add(gangway);gangways.push(gangway);
    const leftLeaf=box(.27,1.84,.055,glass,-.63,2.03,z+(z>0?-.05:.05)),rightLeaf=box(.27,1.84,.055,glass,.63,2.03,z+(z>0?-.05:.05));interiorGroup.add(leftLeaf,rightLeaf);connectingDoors.push({z,leftLeaf,rightLeaf,open:true});
  }

  // The detailed saloon is lighting-only at close range; avoiding shadow maps
  // for dozens of seats and racks is important when several HSTs are nearby.
  interiorGroup.traverse(object=>{if(object.isMesh){object.castShadow=false;object.receiveShadow=false;}});
  g.add(box(1.52,.48,4.20,dark,0,.57,0));addBogie(g,-5.08);addBogie(g,5.08);
  g.userData={...g.userData,type:"mark3-coach",length:23,modelLength:15.1,width:2.74,height:3.92,index,livery,liveryName:scheme.name,passengerDoors,connectingDoors,seats,tables,luggageRacks,pisDisplays,vestibules,gangways,windowMeshes,interiorGroup,interior:{layout:"fixed-mark3-standard-class",seatingArrangement:"2+2",seatCount:seats.length,halfWidth:1.02,halfLength:6.45,floorY:1.06,eyeY:2.66,windowBottom:sideLayout.windowBottom,windowTop:sideLayout.windowTop,doorZ:[-6.55,6.55],windowZ,aisleHalfWidth:.49,vestibuleHalfWidth:1.02,seatColliders,tableColliders},collisionProfile:MARK3_COLLISION_PROFILE};
  return g;
}
export function createHSTFormation(scene,{id="HST-001",coachCount=5,livery=null}={}){
  const fleetIndex=Math.max(0,(Number(id.slice(-3))||1)-1),chosen=livery??FLEET_LIVERIES[fleetIndex%FLEET_LIVERIES.length];
  const leadingNumber=chosen==="classic"?"43002":String(43000+(fleetIndex+2)%197).padStart(5,"0");
  const trailingNumber=String(43100+(fleetIndex+2)%97).padStart(5,"0");
  const vehicles=[createClass43PowerCar({number:leadingNumber,livery:chosen})];
  for(let i=0;i<coachCount;i++)vehicles.push(createMark3Coach(i,chosen));
  vehicles.push(createClass43PowerCar({rear:true,number:trailingNumber,livery:chosen}));
  for(const vehicle of vehicles){vehicle.name=`${id}-${vehicle.userData.type}`;scene.add(vehicle);}
  const spacings=[];let distance=0;
  for(let i=0;i<vehicles.length;i++){
    if(i===0)spacings.push(0);else{const prev=vehicles[i-1].userData.modelLength,curr=vehicles[i].userData.modelLength;distance+=(prev+curr)*.5+.52;spacings.push(distance);}
  }
  return{vehicles,spacings,totalLength:distance+vehicles.at(-1).userData.modelLength*.5,frontLength:vehicles[0].userData.modelLength*.5,livery:chosen,liveryName:LIVERIES[chosen].name};
}
