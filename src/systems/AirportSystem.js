import * as THREE from "three";
import { CONFIG } from "../config.js?v=20261002-flight-sim-terrain";
import { qualityManager } from "../core/QualityManager.js?v=20261002-flight-sim-terrain";

const AIRCRAFT_SPEED={taxiOut:8,holdShort:0,takeoff:70,climb:72,enroute:88,holding:70,goAround:74,descent:66,approach:48,landingRoll:32,runwayExit:10,taxiIn:7};
const ACTIVE_FLIGHT_STATES=new Set(["takeoff","climb","enroute","holding","goAround","descent","approach","landingRoll"]);
// Only low-speed taxi states may yield by braking to a stop. Once an aircraft is
// committed to take-off or landing, runway ownership provides separation; a
// collision check must never make an airborne aircraft or landing roll hover.
const TAXI_CONFLICT_STATES=new Set(["taxiOut","runwayExit","taxiIn"]);
const GROUND_QUEUE_STATES=new Set(["taxiOut","holdShort","runwayExit","taxiIn","manual"]);
const AIRCRAFT_LENGTH=15.1,AIRCRAFT_HALF_LENGTH=AIRCRAFT_LENGTH*.5,AIRCRAFT_QUEUE_GAP=5.5,AIRCRAFT_QUEUE_LATERAL=15.0;
const DOOR_OPEN_STATES=new Set(["parked","turnaround","boarding"]);
const SERVICE_STATES=new Set(["parked","turnaround","boarding","prepare"]);
const DEG=Math.PI/180;
const AIRCRAFT_CAMERA_MODES=Object.freeze(["PILOT","COPILOT","CHASE","LEFT WING","RIGHT WING"]);
const MANUAL_FLIGHT=Object.freeze({
  gravity:9.81,stallAoADeg:14.5,deepStallAoADeg:21,referenceLiftSpeed:58,maxBankDeg:45,
  maxRollRateDeg:42,maxRudderYawDeg:7.5,maxElevatorAoADeg:13.0,trimAoADeg:3.0,
  maxFlightSpeed:102,takeoffSpeed:40,groundMaxSpeed:45,engineSpoolUp:0.42,engineSpoolDown:0.62
});
const geometryCache=new Map(),primitiveGeometryCache=new Map();

function cachedPrimitive(type,args){const key=`${type}:${args.join(":")}`;let geometry=primitiveGeometryCache.get(key);if(geometry)return geometry;if(type==="cylinder")geometry=new THREE.CylinderGeometry(...args);else if(type==="torus")geometry=new THREE.TorusGeometry(...args);else if(type==="sphere")geometry=new THREE.SphereGeometry(...args);else if(type==="plane")geometry=new THREE.PlaneGeometry(...args);else if(type==="circle")geometry=new THREE.CircleGeometry(...args);else if(type==="cone")geometry=new THREE.ConeGeometry(...args);else throw new Error(`Unknown primitive geometry ${type}`);primitiveGeometryCache.set(key,geometry);return geometry;}
function boxGeometry(w,h,d){const key=`${w}:${h}:${d}`;let geometry=geometryCache.get(key);if(!geometry){geometry=new THREE.BoxGeometry(w,h,d);geometryCache.set(key,geometry);}return geometry;}
function material(color,roughness=.75,metalness=.05,extra={}){return new THREE.MeshStandardMaterial({color,roughness,metalness,...extra});}
function moveToward(current,target,maxDelta){if(current<target)return Math.min(target,current+maxDelta);if(current>target)return Math.max(target,current-maxDelta);return target;}
function moveAngleToward(current,target,maxDelta){const delta=Math.atan2(Math.sin(target-current),Math.cos(target-current));return current+THREE.MathUtils.clamp(delta,-maxDelta,maxDelta);}
function smooth01(value){const t=THREE.MathUtils.clamp(value,0,1);return t*t*(3-2*t);}
function basicMaterial(color,extra={}){return new THREE.MeshBasicMaterial({color,...extra});}
function box(w,h,d,mat,{cast=true,receive=true}={}){const mesh=new THREE.Mesh(boxGeometry(w,h,d),mat);mesh.castShadow=cast;mesh.receiveShadow=receive;return mesh;}
function trapezoidGeometry(bottomWidth,topWidth,height){
  const key=`trapezoid:${bottomWidth}:${topWidth}:${height}`;let geometry=geometryCache.get(key);if(geometry)return geometry;
  const shape=new THREE.Shape();shape.moveTo(-bottomWidth*.5,-height*.5);shape.lineTo(bottomWidth*.5,-height*.5);shape.lineTo(topWidth*.5,height*.5);shape.lineTo(-topWidth*.5,height*.5);shape.closePath();geometry=new THREE.ShapeGeometry(shape);geometryCache.set(key,geometry);return geometry;
}
function addInstancedBoxes(group,w,h,d,mat,transforms,name,{cast=false,receive=true}={}){
  if(!transforms.length)return null;const mesh=new THREE.InstancedMesh(boxGeometry(w,h,d),mat,transforms.length),dummy=new THREE.Object3D();
  transforms.forEach((t,index)=>{dummy.position.set(t.x,t.y,t.z);dummy.rotation.set(t.rx??0,t.ry??0,t.rz??0);dummy.updateMatrix();mesh.setMatrixAt(index,dummy.matrix);});
  mesh.instanceMatrix.setUsage(THREE.StaticDrawUsage);mesh.instanceMatrix.needsUpdate=true;mesh.computeBoundingSphere();mesh.castShadow=cast;mesh.receiveShadow=receive;mesh.name=name;group.add(mesh);return mesh;
}
function stripBetween(a,b,width,height,mat){
  const direction=b.clone().sub(a),length=direction.length(),mesh=box(width,height,length,mat);mesh.position.copy(a).add(b).multiplyScalar(.5);mesh.quaternion.setFromUnitVectors(new THREE.Vector3(0,0,1),direction.normalize());return mesh;
}
function localBasis(def){const forward=new THREE.Vector3(Math.sin(def.heading),0,Math.cos(def.heading)),right=new THREE.Vector3(forward.z,0,-forward.x);return{forward,right};}
function localPoint(def,x,y,z){const {forward,right}=localBasis(def);return new THREE.Vector3(def.x,y,def.z).addScaledVector(forward,x).addScaledVector(right,z);}
function localBox(def,x,y,z,lengthX,height,widthZ,mat,options){
  const mesh=box(widthZ,height,lengthX,mat,options);mesh.position.copy(localPoint(def,x,y,z));mesh.rotation.y=def.heading;return mesh;
}
function curveFromLocal(def,points,tension=.35){return new THREE.CatmullRomCurve3(points.map(([x,y,z])=>localPoint(def,x,y,z)),false,"centripetal",tension);}
function addCurveStrip(group,curve,width,height,mat,segments=18,name=""){
  let previous=curve.getPointAt(0);const meshes=[];
  for(let i=1;i<=segments;i++){
    const next=curve.getPointAt(i/segments),mesh=stripBetween(previous,next,width,height,mat);if(name)mesh.name=`${name}-${i}`;group.add(mesh);meshes.push(mesh);previous=next;
  }
  return meshes;
}
function addLocalLine(group,def,a,b,width,height,mat,name=""){
  const mesh=stripBetween(localPoint(def,a[0],a[1],a[2]),localPoint(def,b[0],b[1],b[2]),width,height,mat);if(name)mesh.name=name;group.add(mesh);return mesh;
}
function normalizeDegrees(value){return((value%360)+360)%360;}
function bearingFromWorldVector(x,z){return normalizeDegrees(THREE.MathUtils.radToDeg(Math.atan2(x,-z)));}
function runwayDesignators(def){
  const {forward}=localBasis(def),bearing=bearingFromWorldVector(forward.x,forward.z),opposite=normalizeDegrees(bearing+180);
  const format=value=>String((Math.round(value/10)%36)||36).padStart(2,"0");
  return[format(bearing),format(opposite)];
}

const DIGIT_SEGMENTS={
  "0":["a","b","c","d","e","f"],"1":["b","c"],"2":["a","b","g","e","d"],"3":["a","b","c","d","g"],"4":["f","g","b","c"],
  "5":["a","f","g","c","d"],"6":["a","f","g","e","c","d"],"7":["a","b","c"],"8":["a","b","c","d","e","f","g"],"9":["a","b","c","d","f","g"]
};
const SEGMENT_POINTS={
  a:[[-.55,1],[.55,1]],b:[[.65,.9],[.65,.1]],c:[[.65,-.1],[.65,-.9]],d:[[-.55,-1],[.55,-1]],e:[[-.65,-.9],[-.65,-.1]],f:[[-.65,.1],[-.65,.9]],g:[[-.55,0],[.55,0]]
};
function addGroundDigit(group,def,digit,centreX,centreZ,scale,facing,mat,namePrefix){
  for(const segment of DIGIT_SEGMENTS[digit]??[]){
    const [a,b]=SEGMENT_POINTS[segment],map=([sx,sy])=>[centreX+sy*scale*facing,.152,centreZ+sx*scale*facing];
    addLocalLine(group,def,map(a),map(b),Math.max(.45,scale*.18),.018,mat,`${namePrefix}-${digit}-${segment}`);
  }
}
function addRunwayDesignation(group,def,text,centreX,facing,mat,namePrefix){
  const scale=4.2,spacing=6.8;
  for(let i=0;i<text.length;i++)addGroundDigit(group,def,text[i],centreX,(-spacing*.5)+(i*spacing),scale,facing,mat,namePrefix);
}
function addStandNumber(group,def,number,x,z,mat){addGroundDigit(group,def,String(number),x,z,1.7,-1,mat,`airport-stand-${number}-number`);}

const PIXEL_FONT={
  "0":["01110","10001","10011","10101","11001","10001","01110"],"1":["00100","01100","00100","00100","00100","00100","01110"],
  "2":["01110","10001","00001","00010","00100","01000","11111"],"3":["11110","00001","00001","01110","00001","00001","11110"],
  "4":["00010","00110","01010","10010","11111","00010","00010"],"5":["11111","10000","10000","11110","00001","00001","11110"],
  "6":["01110","10000","10000","11110","10001","10001","01110"],"7":["11111","00001","00010","00100","01000","01000","01000"],
  "8":["01110","10001","10001","01110","10001","10001","01110"],"9":["01110","10001","10001","01111","00001","00001","01110"],
  A:["01110","10001","10001","11111","10001","10001","10001"],B:["11110","10001","10001","11110","10001","10001","11110"],
  C:["01111","10000","10000","10000","10000","10000","01111"],D:["11110","10001","10001","10001","10001","10001","11110"],
  E:["11111","10000","10000","11110","10000","10000","11111"],F:["11111","10000","10000","11110","10000","10000","10000"],
  G:["01110","10001","10000","10111","10001","10001","01110"],H:["10001","10001","10001","11111","10001","10001","10001"],
  I:["11111","00100","00100","00100","00100","00100","11111"],L:["10000","10000","10000","10000","10000","10000","11111"],
  M:["10001","11011","10101","10101","10001","10001","10001"],N:["10001","11001","10101","10011","10001","10001","10001"],
  O:["01110","10001","10001","10001","10001","10001","01110"],P:["11110","10001","10001","11110","10000","10000","10000"],
  R:["11110","10001","10001","11110","10100","10010","10001"],S:["01111","10000","10000","01110","00001","00001","11110"],
  T:["11111","00100","00100","00100","00100","00100","00100"],U:["10001","10001","10001","10001","10001","10001","01110"],
  V:["10001","10001","10001","10001","10001","01010","00100"],Y:["10001","10001","01010","00100","00100","00100","00100"],
  "-":["00000","00000","00000","11111","00000","00000","00000"]," ":["00000","00000","00000","00000","00000","00000","00000"]
};
function addFacadeText(group,def,text,centreX,centreY,z,height,mat,name){
  const glyphs=[...text].map(char=>PIXEL_FONT[char]??PIXEL_FONT[" "]),pixel=height/7,gap=pixel*.75,charWidth=pixel*5,totalWidth=glyphs.length*charWidth+Math.max(0,glyphs.length-1)*gap,points=[];
  glyphs.forEach((rows,charIndex)=>rows.forEach((row,rowIndex)=>[...row].forEach((value,columnIndex)=>{if(value!=="1")return;points.push([centreX-totalWidth*.5+charIndex*(charWidth+gap)+(columnIndex+.5)*pixel,centreY+height*.5-(rowIndex+.5)*pixel]);})));
  if(!points.length)return null;
  const geometry=boxGeometry(.10,pixel*.92,pixel*.92),instances=new THREE.InstancedMesh(geometry,mat,points.length),dummy=new THREE.Object3D();let index=0;
  for(const [x,y] of points){dummy.position.copy(localPoint(def,x,y,z));dummy.rotation.y=def.heading;dummy.updateMatrix();instances.setMatrixAt(index++,dummy.matrix);}instances.instanceMatrix.needsUpdate=true;instances.castShadow=false;instances.receiveShadow=false;instances.name=name;group.add(instances);return instances;
}

// Independent Blackwater Relay aircraft asset.
// Geometry below was authored procedurally for this project from public dimensional
// data and photographic reference. It does not load, trace or derive topology from
// any third-party 3D model. See ASSET_PROVENANCE.md.
const A320_REFERENCE=Object.freeze({lengthM:37.57,spanM:35.80,heightM:11.76,fuselageDiameterM:3.95});
const AIRCRAFT_MODEL=Object.freeze({length:15.1,span:15.1*(A320_REFERENCE.spanM/A320_REFERENCE.lengthM),height:4.9});
let sharedWingGeometry=null,sharedTailplaneGeometry=null,sharedFinGeometry=null,independentFuselageGeometry=null,independentLiveryTexture=null;

function createWingGeometry(){
  if(sharedWingGeometry)return sharedWingGeometry;
  // A320-family-inspired planform: swept leading edge, broad root, tapered tip.
  // The game's walkable interior forces non-uniform scale, but span:length is kept
  // close to the public A320neo ratio (35.80:37.57).
  const shape=new THREE.Shape();
  shape.moveTo(-.98,1.48);shape.lineTo(-6.98,-1.72);shape.lineTo(-6.72,-2.28);shape.lineTo(-1.02,-1.10);
  shape.lineTo(1.02,-1.10);shape.lineTo(6.72,-2.28);shape.lineTo(6.98,-1.72);shape.lineTo(.98,1.48);shape.closePath();
  const geometry=new THREE.ShapeGeometry(shape);geometry.rotateX(Math.PI/2);geometry.computeVertexNormals();sharedWingGeometry=geometry;return geometry;
}
function createTailplaneGeometry(){
  if(sharedTailplaneGeometry)return sharedTailplaneGeometry;
  const shape=new THREE.Shape();
  shape.moveTo(-.42,.82);shape.lineTo(-3.08,-.70);shape.lineTo(-2.82,-1.18);shape.lineTo(-.44,-.70);
  shape.lineTo(.44,-.70);shape.lineTo(2.82,-1.18);shape.lineTo(3.08,-.70);shape.lineTo(.42,.82);shape.closePath();
  const geometry=new THREE.ShapeGeometry(shape);geometry.rotateX(Math.PI/2);geometry.computeVertexNormals();sharedTailplaneGeometry=geometry;return geometry;
}
function createFinGeometry(){
  if(sharedFinGeometry)return sharedFinGeometry;
  const shape=new THREE.Shape();shape.moveTo(0,0);shape.lineTo(.12,3.42);shape.lineTo(-.58,3.30);shape.lineTo(-2.02,.56);shape.lineTo(-1.78,.05);shape.closePath();
  const geometry=new THREE.ShapeGeometry(shape);geometry.computeVertexNormals();sharedFinGeometry=geometry;return geometry;
}
function wheelMesh(dark,radius=.22,width=.15,segments=14){const wheel=new THREE.Mesh(cachedPrimitive("cylinder",[radius,radius,width,segments]),dark);wheel.rotation.z=Math.PI/2;wheel.castShadow=true;return wheel;}

const AIRCRAFT_CABIN_WINDOW_Z=Object.freeze([4.00,3.27,2.54,1.81,1.08,.35,-.38,-1.11,-1.84,-2.57,-3.30,-4.03]);
const AIRCRAFT_FUSELAGE_PROFILE=Object.freeze([
  [-7.55,.04],[-7.28,.36],[-6.82,.68],[-6.20,.88],[-5.35,1.02],[-4.35,1.085],
  [4.65,1.085],[5.25,1.02],[5.78,.91],[6.25,.78],[6.73,.60],[7.12,.38],[7.42,.17],[7.55,.035]
]);
const AIRCRAFT_FUSELAGE_CENTER_Y=1.94,AIRCRAFT_FUSELAGE_X_SCALE=1.24,AIRCRAFT_FUSELAGE_Y_SCALE=1.20,AIRCRAFT_DOOR_LOCAL_X=1.31,AIRCRAFT_DOOR_LOCAL_Z=4.35;
function fuselageRadiusAt(z){
  const p=AIRCRAFT_FUSELAGE_PROFILE;if(z<=p[0][0])return p[0][1];if(z>=p.at(-1)[0])return p.at(-1)[1];
  for(let i=0;i<p.length-1;i++){const a=p[i],b=p[i+1];if(z>=a[0]&&z<=b[0]){const t=(z-a[0])/(b[0]-a[0]),s=smooth01(t);return THREE.MathUtils.lerp(a[1],b[1],s);}}
  return 1;
}
function createIndependentLiveryTexture(){
  if(independentLiveryTexture)return independentLiveryTexture;
  const width=64,height=64,data=new Uint8Array(width*height*4);
  for(let y=0;y<height;y++)for(let x=0;x<width;x++){
    const theta=x/(width-1)*Math.PI*2,vertical=Math.cos(theta),v=y/(height-1);
    let rgb=[232,237,239];
    // Dark belly and a thin turquoise belt give useful orientation without using
    // an airline logo, wordmark or copied livery.
    if(vertical<-.28)rgb=[38,55,66];
    if(Math.abs(vertical)<.34&&v>.13&&v<.87)rgb=[38,126,139];
    if(Math.abs(vertical)<.20&&v>.18&&v<.82)rgb=[203,169,78];
    // Tail cone accent.
    if(v<.13&&vertical>-.45)rgb=[25,82,94];
    const i=(y*width+x)*4;data[i]=rgb[0];data[i+1]=rgb[1];data[i+2]=rgb[2];data[i+3]=255;
  }
  const texture=new THREE.DataTexture(data,width,height,THREE.RGBAFormat);texture.needsUpdate=true;texture.wrapS=THREE.RepeatWrapping;texture.wrapT=THREE.ClampToEdgeWrapping;texture.colorSpace=THREE.SRGBColorSpace;independentLiveryTexture=texture;return texture;
}
function getAirlinerFuselageGeometry(){
  if(independentFuselageGeometry)return independentFuselageGeometry;
  const radialSegments=64,zCuts=[];
  for(let z=-7.55;z<=7.53;z+=.13)zCuts.push(Number(z.toFixed(4)));
  for(const z of AIRCRAFT_CABIN_WINDOW_Z)zCuts.push(z-.20,z+.20);
  zCuts.push(3.86,4.84,5.25,5.55,5.82,6.10,6.34,6.62,6.92,...AIRCRAFT_FUSELAGE_PROFILE.map(item=>item[0]));
  zCuts.sort((a,b)=>a-b);const zs=zCuts.filter((z,i)=>i===0||Math.abs(z-zCuts[i-1])>1e-4),vertices=[],uvs=[];
  for(const z of zs){
    const r=fuselageRadiusAt(z),rx=r*AIRCRAFT_FUSELAGE_X_SCALE,ry=r*AIRCRAFT_FUSELAGE_Y_SCALE;
    for(let j=0;j<=radialSegments;j++){const theta=j/radialSegments*Math.PI*2;vertices.push(rx*Math.sin(theta),ry*Math.cos(theta),z);uvs.push(j/radialSegments,(z+7.55)/15.10);}
  }
  const indices=[],ring=radialSegments+1,isOpening=(theta,z,worldY,rx)=>{
    const side=Math.sin(theta),x=rx*side,windowBand=worldY>=2.02&&worldY<=2.48&&Math.abs(side)>=.90;
    const window=windowBand&&AIRCRAFT_CABIN_WINDOW_Z.some(wz=>Math.abs(z-wz)<=.205);
    const door=side>.80&&z>=3.86&&z<=4.84&&worldY>=1.12&&worldY<=3.12;
    // Four-pane cockpit aperture: two forward panes plus side panes.
    const forwardWindshield=z>=6.02&&z<=6.88&&worldY>=2.18&&worldY<=2.66&&Math.abs(x)<=.60;
    const sideWindshield=z>=5.48&&z<=6.32&&worldY>=2.13&&worldY<=2.63&&Math.abs(x)>=.42;
    return window||door||forwardWindshield||sideWindshield;
  };
  for(let i=0;i<zs.length-1;i++)for(let j=0;j<radialSegments;j++){
    const z=(zs[i]+zs[i+1])*.5,theta=(j+.5)/radialSegments*Math.PI*2,r=fuselageRadiusAt(z),rx=r*AIRCRAFT_FUSELAGE_X_SCALE,ry=r*AIRCRAFT_FUSELAGE_Y_SCALE,worldY=AIRCRAFT_FUSELAGE_CENTER_Y+ry*Math.cos(theta);
    if(isOpening(theta,z,worldY,rx))continue;
    const a=i*ring+j,b=(i+1)*ring+j,c=(i+1)*ring+j+1,d=i*ring+j+1;indices.push(a,b,d,b,c,d);
  }
  const geometry=new THREE.BufferGeometry();geometry.setAttribute("position",new THREE.Float32BufferAttribute(vertices,3));geometry.setAttribute("uv",new THREE.Float32BufferAttribute(uvs,2));geometry.setIndex(indices);geometry.computeVertexNormals();geometry.computeBoundingSphere();independentFuselageGeometry=geometry;return geometry;
}
function fuselageSideXAt(z,y){const r=fuselageRadiusAt(z),rx=r*AIRCRAFT_FUSELAGE_X_SCALE,ry=r*AIRCRAFT_FUSELAGE_Y_SCALE,rel=(y-AIRCRAFT_FUSELAGE_CENTER_Y)/Math.max(.001,ry);return rx*Math.sqrt(Math.max(0,1-rel*rel));}

const aircraftProxyMaterialSets=new Map();
function getAircraftProxyMaterials(index){
  const variant=index%3;if(aircraftProxyMaterialSets.has(variant))return aircraftProxyMaterialSets.get(variant);
  const set={white:material(0xe9eef0,.44,.10,{side:THREE.DoubleSide}),dark:material(0x263138,.50,.12),tail:material([0x19525e,0x235966,0x164954][variant],.55,.10,{side:THREE.DoubleSide}),glass:material(0x214958,.18,.18,{transparent:true,opacity:.66}),accent:material(0xcba94e,.60,.08)};
  aircraftProxyMaterialSets.set(variant,set);return set;
}
function createAircraftProxy(index,tier){
  const group=new THREE.Group(),m=getAircraftProxyMaterials(index),segments=tier==="medium"?18:tier==="low"?12:8;group.name=`aircraft-${tier}-detail`;
  const fuselage=new THREE.Mesh(cachedPrimitive("cylinder",[1.05,.84,15.0,segments,1,false]),m.white);fuselage.rotation.x=Math.PI/2;fuselage.position.set(0,1.94,0);fuselage.name=`aircraft-${tier}-fuselage`;group.add(fuselage);
  const nose=new THREE.Mesh(cachedPrimitive("sphere",[1.02,segments,Math.max(6,Math.floor(segments/2))]),m.white);nose.scale.set(1.18,1.16,1.55);nose.position.set(0,1.94,6.73);nose.name=`aircraft-${tier}-nose`;group.add(nose);
  const wing=new THREE.Mesh(createWingGeometry(),m.white);wing.position.set(0,1.50,-.10);wing.name=`aircraft-${tier}-wing`;group.add(wing);
  if(tier!=="far"){const tail=new THREE.Mesh(createTailplaneGeometry(),m.white);tail.position.set(0,2.38,-5.72);tail.name=`aircraft-${tier}-tailplane`;group.add(tail);const fin=new THREE.Mesh(createFinGeometry(),m.tail);fin.rotation.y=Math.PI/2;fin.position.set(.03,2.12,-5.95);fin.name=`aircraft-${tier}-fin`;group.add(fin);}
  if(tier==="medium"||tier==="low")for(const x of[-2.55,2.55]){const engine=new THREE.Mesh(cachedPrimitive("cylinder",[.61,.70,2.05,tier==="medium"?16:10]),m.white);engine.rotation.x=Math.PI/2;engine.position.set(x,.88,.02);engine.name=`aircraft-${tier}-engine`;group.add(engine);}
  if(tier==="medium"){
    for(const side of[-1,1]){const windshield=box(.43,.27,.04,m.glass,{cast:false});windshield.position.set(side*.24,2.42,6.58);windshield.rotation.set(-.30,-side*.13,0);windshield.name="aircraft-medium-cockpit";group.add(windshield);}
    for(const side of[-1,1]){const winglet=box(.14,.90,.32,m.tail,{cast:false});winglet.position.set(side*6.86,2.00,-2.00);winglet.rotation.z=side*.30;group.add(winglet);}
  }
  group.traverse(object=>{if(object.isMesh){object.castShadow=false;object.receiveShadow=false;}});return group;
}

function createAircraft(index=0){
  const root=new THREE.Group(),group=new THREE.Group(),white=material(0xffffff,.36,.11,{map:createIndependentLiveryTexture()}),dark=material(0x1f292f,.34,.25),glass=material(0x6f9eaf,.08,.18,{transparent:true,opacity:.22,side:THREE.DoubleSide,depthWrite:false}),tailAccent=material([0x19525e,0x235966,0x164954][index%3],.48,.12),silver=material(0x9ca5a8,.36,.44),navRed=material(0xff2020,.22,.05,{emissive:0xff0000,emissiveIntensity:2.2}),navGreen=material(0x20ff6a,.22,.05,{emissive:0x00ff55,emissiveIntensity:2.2}),lamp=material(0xfff7d5,.22,.02,{emissive:0xfff0c2,emissiveIntensity:2.5}),livery=tailAccent,accentGold=material(0xcba94e,.56,.12);group.name="aircraft-full-detail";root.add(group);
  const fuselage=new THREE.Mesh(getAirlinerFuselageGeometry(),white);fuselage.position.set(0,AIRCRAFT_FUSELAGE_CENTER_Y,0);fuselage.castShadow=true;fuselage.receiveShadow=true;fuselage.name="aircraft-fuselage";group.add(fuselage);fuselage.userData.hasRealWindowOpenings=true;

  // Wings are kept lightweight but gain thickness cues, articulated flaps/slats,
  // spoiler panels and winglets so the silhouette reads as a working airliner.
  const wing=new THREE.Mesh(createWingGeometry(),white);wing.position.set(0,1.50,-.10);wing.castShadow=true;wing.material.side=THREE.DoubleSide;wing.name="aircraft-main-wing";group.add(wing);
  const flapMeshes=[],slatMeshes=[];
  for(const side of[-1,1]){
    const rootFairing=box(2.85,.26,1.16,white);rootFairing.position.set(side*1.62,1.40,-.28);rootFairing.rotation.y=side*.04;rootFairing.name="aircraft-wing-root-fairing";group.add(rootFairing);
    const flap=box(3.75,.07,.25,material(0xb8c0c2,.58,.16),{cast:false});flap.position.set(side*4.05,1.45,-1.67);flap.rotation.y=side*.11;flap.userData.baseRotationX=0;flap.name="aircraft-wing-flap";group.add(flap);flapMeshes.push(flap);
    const slat=box(3.62,.055,.17,material(0xd5dadd,.48,.20),{cast:false});slat.position.set(side*3.92,1.49,.18);slat.rotation.y=side*.10;slat.userData.baseZ=slat.position.z;slat.name="aircraft-wing-slat";group.add(slat);slatMeshes.push(slat);
    const spoiler=box(1.72,.035,.38,material(0x9fa9ad,.58,.18),{cast:false});spoiler.position.set(side*3.25,1.50,-.92);spoiler.rotation.y=side*.08;spoiler.name="aircraft-wing-spoiler";group.add(spoiler);
    const aileron=box(1.48,.055,.22,material(0xaeb8bb,.58,.16),{cast:false});aileron.position.set(side*5.63,1.47,-1.75);aileron.rotation.y=side*.12;aileron.name="aircraft-aileron";group.add(aileron);
    const winglet=box(.16,1.15,.42,livery);winglet.position.set(side*6.86,2.03,-2.03);winglet.rotation.z=side*.28;winglet.rotation.y=side*.08;winglet.name="aircraft-winglet";group.add(winglet);
  }
  const tail=new THREE.Mesh(createTailplaneGeometry(),white);tail.position.set(0,2.38,-5.72);tail.castShadow=true;tail.material.side=THREE.DoubleSide;tail.name="aircraft-tailplane";group.add(tail);
  const fin=new THREE.Mesh(createFinGeometry(),tailAccent);fin.rotation.y=Math.PI/2;fin.position.set(.03,2.12,-5.95);fin.castShadow=true;fin.material.side=THREE.DoubleSide;fin.name="aircraft-fin";group.add(fin);
  const finCap=box(.16,.20,.90,accentGold);finCap.position.set(.10,4.83,-6.20);group.add(finCap);

  // Cockpit glazing follows a modern transport-aircraft layout: two raked
  // forward panes and two side panes, all sitting over genuine apertures in the
  // fuselage shell. The low-opacity double-sided glass remains transparent from
  // the pilot eye point as well as from outside.
  const windscreenFrameMat=material(0x242b2f,.54,.16);
  for(const side of[-1,1]){
    const front=new THREE.Mesh(trapezoidGeometry(.50,.42,.38),glass);front.position.set(side*.255,2.43,6.50);front.rotation.set(-.31,-side*.13,0);front.name="aircraft-cockpit-windshield";front.renderOrder=7;group.add(front);
    const sidePane=new THREE.Mesh(trapezoidGeometry(.46,.36,.34),glass);sidePane.position.set(side*.605,2.36,6.20);sidePane.rotation.set(-.17,-side*.82,0);sidePane.name="aircraft-cockpit-side-window";sidePane.renderOrder=7;group.add(sidePane);
    const brow=box(.42,.045,.045,windscreenFrameMat,{cast:false});brow.position.set(side*.255,2.595,6.45);brow.rotation.set(-.30,-side*.13,0);brow.name="aircraft-windscreen-frame";group.add(brow);
    const sill=box(.42,.045,.045,windscreenFrameMat,{cast:false});sill.position.set(side*.255,2.245,6.54);sill.rotation.set(-.30,-side*.13,0);sill.name="aircraft-windscreen-frame";group.add(sill);
    const wiper=box(.018,.20,.018,dark,{cast:false});wiper.position.set(side*.21,2.34,6.47);wiper.rotation.set(-.18,0,side*.34);wiper.name="aircraft-windscreen-wiper";group.add(wiper);
  }
  const centreMullion=box(.045,.42,.045,windscreenFrameMat,{cast:false});centreMullion.position.set(0,2.42,6.49);centreMullion.rotation.x=-.30;centreMullion.name="aircraft-windscreen-centre-mullion";group.add(centreMullion);
  // Small nose details give the full-detail aircraft the visual cues of a real
  // transport rather than a smooth toy shell.
  for(const side of[-1,1]){const pitot=box(.025,.025,.34,silver,{cast:false});pitot.position.set(side*.72,2.17,5.82);pitot.rotation.y=side*.035;pitot.name="aircraft-pitot-probe";group.add(pitot);const aoa=box(.035,.13,.06,dark,{cast:false});aoa.position.set(side*.76,2.06,5.54);aoa.rotation.z=side*.22;aoa.name="aircraft-aoa-vane";group.add(aoa);}
  const radomeSeam=new THREE.Mesh(new THREE.TorusGeometry(.70,.018,5,28),material(0x9da6a9,.52,.16));radomeSeam.scale.set(1,.93,1);radomeSeam.rotation.x=Math.PI/2;radomeSeam.position.set(0,1.94,6.72);radomeSeam.name="aircraft-radome-seam";group.add(radomeSeam);

  // Engines use an intake lip, recessed fan face and separate exhaust cone.
  for(const x of[-2.55,2.55]){
    const pylon=box(.30,.54,1.42,silver);pylon.position.set(x,1.30,.05);pylon.rotation.z=x<0?-.08:.08;pylon.name="aircraft-engine-pylon";group.add(pylon);
    const nacelle=new THREE.Mesh(cachedPrimitive("cylinder",[.61,.70,2.08,28]),white);nacelle.rotation.x=Math.PI/2;nacelle.position.set(x,.88,.02);nacelle.castShadow=true;nacelle.name="aircraft-engine-nacelle";group.add(nacelle);
    const intakeLip=new THREE.Mesh(cachedPrimitive("torus",[.60,.075,8,28]),silver);intakeLip.position.set(x,.88,1.08);intakeLip.rotation.x=Math.PI/2;intakeLip.name="aircraft-engine-intake";group.add(intakeLip);
    const fanDisc=new THREE.Mesh(cachedPrimitive("circle",[.50,28]),dark);fanDisc.position.set(x,.88,1.01);fanDisc.rotation.x=-Math.PI/2;fanDisc.name="aircraft-engine-fan";group.add(fanDisc);
    for(let blade=0;blade<14;blade++){const b=box(.038,.024,.42,silver,{cast:false});b.position.set(x,.88,1.00);b.rotation.y=blade*Math.PI/7;b.name="aircraft-engine-fan-blade";group.add(b);}
    const spinner=new THREE.Mesh(cachedPrimitive("cone",[.13,.34,14]),silver);spinner.position.set(x,.88,1.05);spinner.rotation.x=Math.PI/2;spinner.name="aircraft-engine-spinner";group.add(spinner);
    const exhaust=new THREE.Mesh(cachedPrimitive("cylinder",[.34,.46,.42,24]),dark);exhaust.rotation.x=Math.PI/2;exhaust.position.set(x,.88,-1.20);exhaust.name="aircraft-engine-exhaust";group.add(exhaust);
    const exhaustCone=new THREE.Mesh(cachedPrimitive("cone",[.16,.34,14]),silver);exhaustCone.position.set(x,.88,-1.50);exhaustCone.rotation.x=-Math.PI/2;exhaustCone.name="aircraft-engine-exhaust-cone";group.add(exhaustCone);
    const nacelleBand=new THREE.Mesh(cachedPrimitive("torus",[.63,.018,6,28]),accentGold);nacelleBand.position.set(x,.88,.67);nacelleBand.rotation.x=Math.PI/2;nacelleBand.name="aircraft-engine-accent-band";group.add(nacelleBand);
  }

  // True transparent passenger windows. The opaque fuselage geometry has matching
  // cut-outs, so these panes show the actual scene rather than a dark rectangle.
  const windowGlass=material(0xb9e5f4,.08,.02,{transparent:true,opacity:.22,side:THREE.DoubleSide,depthWrite:false}),windowFrameMat=material(0x707b80,.34,.28);
  const exteriorWindows=[];
  for(const side of[-1,1])for(const z of AIRCRAFT_CABIN_WINDOW_Z){
    if(side>0&&z>3.55)continue;const x=fuselageSideXAt(z,2.28)*side,windowMesh=new THREE.Mesh(cachedPrimitive("plane",[.40,.46]),windowGlass);windowMesh.position.set(x*1.002,2.28,z);windowMesh.rotation.y=side>0?Math.PI/2:-Math.PI/2;windowMesh.name="aircraft-passenger-window";windowMesh.castShadow=false;windowMesh.receiveShadow=false;windowMesh.renderOrder=4;group.add(windowMesh);exteriorWindows.push(windowMesh);
    const frameX=x*1.004;for(const [y,dz,w,h,d] of[[2.535,0,.026,.035,.48],[2.025,0,.026,.035,.48],[2.28,-.235,.026,.54,.035],[2.28,.235,.026,.54,.035]]){const frame=box(w,h,d,windowFrameMat,{cast:false});frame.position.set(frameX,y,z+dz);frame.name="aircraft-window-outer-frame";group.add(frame);}
  }
  for(const side of[-1,1]){const x=side*fuselageSideXAt(0,1.98)*1.003,stripe=box(.026,.060,9.25,accentGold,{cast:false});stripe.position.set(x,1.96,-.08);stripe.name="aircraft-fictional-livery-accent";group.add(stripe);}

  // The forward passenger door is now a genuine opening in the fuselage skin.
  // Only the movable door leaf and the structural frame remain as geometry.
  const doorway=new THREE.Object3D();doorway.position.set(AIRCRAFT_DOOR_LOCAL_X,2.10,AIRCRAFT_DOOR_LOCAL_Z);doorway.name="aircraft-forward-doorway";group.add(doorway);
  const threshold=box(.30,.055,.88,silver,{cast:false});threshold.position.set(AIRCRAFT_DOOR_LOCAL_X-.11,1.13,AIRCRAFT_DOOR_LOCAL_Z);threshold.name="aircraft-door-threshold";group.add(threshold);
  for(const z of[3.92,4.78]){const frame=box(.075,1.98,.075,silver,{cast:false});frame.position.set(AIRCRAFT_DOOR_LOCAL_X+.02,2.11,z);frame.name="aircraft-door-frame";group.add(frame);}
  const frameTop=box(.075,.08,.94,silver,{cast:false});frameTop.position.set(AIRCRAFT_DOOR_LOCAL_X+.02,3.09,AIRCRAFT_DOOR_LOCAL_Z);frameTop.name="aircraft-door-frame-top";group.add(frameTop);
  const door=box(.065,1.80,.76,white);door.position.set(AIRCRAFT_DOOR_LOCAL_X+.055,2.08,AIRCRAFT_DOOR_LOCAL_Z);door.name="aircraft-forward-door";group.add(door);
  const rearDoor=box(.055,1.25,.62,white);rearDoor.position.set(fuselageSideXAt(-4.05,1.78),1.76,-4.05);rearDoor.name="aircraft-rear-door";group.add(rearDoor);

  // Passenger cabin: keep the lightweight procedural construction, but make the
  // first-person view read as an aircraft rather than a rectangular corridor.
  // The sidewall is deliberately split around the window belt so the exterior
  // window glazing is actually visible from inside the cabin.
  const cabinFloorMat=material(0x777875,.88,.02),aisleMat=material(0x303940,.88,.02),linerMat=material(0xe8e6de,.66,.02),linerShadow=material(0xc8cbc8,.72,.02),seatMat=material([0x315d7b,0x655777,0x496b60][index%3],.78,.03),seatDark=material(0x252a2d,.74,.08),cabinLight=material(0xfff3d6,.26,.02,{emissive:0xffe9b8,emissiveIntensity:1.42}),windowInner=material(0xc5e9f5,.08,.01,{transparent:true,opacity:.10,side:THREE.DoubleSide,depthWrite:false}),accentMat=material([0x4e86a6,0x826e9b,0x658d78][index%3],.62,.04);
  const cabinFloor=box(2.34,.10,9.70,cabinFloorMat,{cast:false});cabinFloor.position.set(0,1.10,-.03);cabinFloor.name="aircraft-cabin-floor";group.add(cabinFloor);
  const aisle=box(.50,.035,9.22,aisleMat,{cast:false});aisle.position.set(0,1.17,-.06);aisle.name="aircraft-cabin-aisle";group.add(aisle);

  // Lower dado panels and angled shoulder panels leave the window belt genuinely
  // open. The liners sit inside the curved pressure shell instead of forming a
  // second opaque wall behind the glazing.
  for(const side of[-1,1]){
    const lower=box(.075,.78,9.12,linerMat,{cast:false});lower.position.set(side*1.18,1.58,-.15);lower.name="aircraft-cabin-lower-sidewall";group.add(lower);
    const upper=box(.38,.52,9.00,linerMat,{cast:false});upper.position.set(side*1.02,2.93,-.18);upper.rotation.z=side*.34;upper.name="aircraft-cabin-upper-shoulder";group.add(upper);
    const kick=box(.10,.22,9.15,linerShadow,{cast:false});kick.position.set(side*1.12,1.25,-.15);kick.name="aircraft-cabin-kick-panel";group.add(kick);
  }
  // Forward right-side vestibule panel stops short of the passenger doorway.
  const vestibuleLower=box(.075,.78,1.18,linerMat,{cast:false});vestibuleLower.position.set(1.18,1.58,3.52);vestibuleLower.name="aircraft-cabin-vestibule-lower-panel";group.add(vestibuleLower);

  const cabinWindowZ=[...AIRCRAFT_CABIN_WINDOW_Z],seatRows=[];
  for(const side of[-1,1]){
    for(const z of cabinWindowZ){
      if(side>0&&z>3.55)continue;const skinX=fuselageSideXAt(z,2.28),innerX=side*(skinX-.055),pane=new THREE.Mesh(cachedPrimitive("plane",[.36,.41]),windowInner);pane.position.set(innerX,2.28,z);pane.rotation.y=side>0?Math.PI/2:-Math.PI/2;pane.name="aircraft-cabin-window";pane.renderOrder=5;group.add(pane);
      const frameX=side*(skinX-.075),top=box(.035,.060,.48,linerShadow,{cast:false});top.position.set(frameX,2.525,z);top.name="aircraft-cabin-window-frame";group.add(top);
      const bottom=box(.035,.060,.48,linerShadow,{cast:false});bottom.position.set(frameX,2.035,z);bottom.name="aircraft-cabin-window-frame";group.add(bottom);
      for(const dz of[-.225,.225]){const jamb=box(.035,.53,.055,linerShadow,{cast:false});jamb.position.set(frameX,2.28,z+dz);jamb.name="aircraft-cabin-window-frame";group.add(jamb);}
      const revealTop=box(.13,.035,.42,linerShadow,{cast:false});revealTop.position.set(side*(skinX-.12),2.49,z);revealTop.rotation.z=side*.08;revealTop.name="aircraft-window-reveal";group.add(revealTop);
      const revealBottom=box(.13,.035,.42,linerShadow,{cast:false});revealBottom.position.set(side*(skinX-.12),2.07,z);revealBottom.rotation.z=-side*.08;revealBottom.name="aircraft-window-reveal";group.add(revealBottom);
    }
    for(let i=0;i<cabinWindowZ.length-1;i++){
      const a=cabinWindowZ[i],b=cabinWindowZ[i+1],centre=(a+b)*.5,depth=Math.max(.08,Math.abs(a-b)-.50),panel=box(.07,.50,depth,linerMat,{cast:false});panel.position.set(side*1.18,2.28,centre);panel.name="aircraft-cabin-window-belt-panel";group.add(panel);
    }
    const rearPanel=box(.07,.50,.28,linerMat,{cast:false});rearPanel.position.set(side*1.18,2.28,-4.40);rearPanel.name="aircraft-cabin-window-belt-panel";group.add(rearPanel);
    if(side<0){const frontPanel=box(.07,.50,.55,linerMat,{cast:false});frontPanel.position.set(side*1.18,2.28,4.02);frontPanel.name="aircraft-cabin-window-belt-panel";group.add(frontPanel);}
  }

  // A gently faceted ceiling and centre services strip avoid the flat tunnel look.
  const ceiling=box(1.54,.07,9.10,linerMat,{cast:false});ceiling.position.set(0,3.28,-.10);ceiling.name="aircraft-cabin-ceiling";group.add(ceiling);
  for(const side of[-1,1]){const shoulder=box(.60,.07,9.02,linerMat,{cast:false});shoulder.position.set(side*.76,3.12,-.13);shoulder.rotation.z=side*.34;shoulder.name="aircraft-cabin-ceiling-shoulder";group.add(shoulder);}
  const serviceStrip=box(.28,.035,8.95,accentMat,{cast:false});serviceStrip.position.set(0,3.235,-.12);serviceStrip.name="aircraft-cabin-service-strip";group.add(serviceStrip);
  for(const x of[-.91,.91]){const bin=box(.42,.34,8.25,linerMat,{cast:false});bin.position.set(x,2.88,-.22);bin.rotation.z=x<0?-.08:.08;bin.name="aircraft-overhead-bin";group.add(bin);}

  // Genuine 2+2 regional-jet seating. The E190 reference cabin is 2.74 m wide
  // with a 0.49 m aisle; these dimensions are compressed to Eastmere's scale
  // while preserving the four-abreast visual arrangement.
  const seats=[],seatXs=[-.98,-.58,.58,.98],seatBeltMat=material(0x9aa3a6,.55,.22);
  const seatInstances={cushion:[],back:[],headrest:[],tray:[],armrest:[],leg:[],belt:[]};
  for(let row=0;row<7;row++){
    const z=2.78-row*1.06;seatRows.push(z);
    for(const x of seatXs){const side=x<0?-1:1;
      seatInstances.cushion.push({x,y:1.31,z});seatInstances.back.push({x,y:1.70,z:z-.24,rx:-.06});seatInstances.headrest.push({x,y:2.01,z:z-.25});seatInstances.tray.push({x,y:1.68,z:z-.315});
      for(const armX of[x-.19,x+.19])seatInstances.armrest.push({x:armX,y:1.48,z});for(const legX of[x-.11,x+.11])seatInstances.leg.push({x:legX,y:1.20,z:z+.06});seatInstances.belt.push({x,y:1.405,z:z+.04,ry:side*.18});
      seats.push({x,z,row:row+1,side:x<-.75?"LA":x<0?"LB":x<.75?"RB":"RA"});
    }
  }
  addInstancedBoxes(group,.36,.17,.50,seatMat,seatInstances.cushion,"aircraft-passenger-seats");
  addInstancedBoxes(group,.36,.70,.13,seatMat,seatInstances.back,"aircraft-passenger-seat-backs");
  addInstancedBoxes(group,.33,.16,.10,linerMat,seatInstances.headrest,"aircraft-seat-headrests");
  addInstancedBoxes(group,.25,.18,.035,seatDark,seatInstances.tray,"aircraft-seat-trays");
  addInstancedBoxes(group,.045,.08,.45,seatDark,seatInstances.armrest,"aircraft-seat-armrests");
  addInstancedBoxes(group,.050,.27,.050,seatDark,seatInstances.leg,"aircraft-seat-legs");
  addInstancedBoxes(group,.23,.025,.045,seatBeltMat,seatInstances.belt,"aircraft-seatbelts");
  // Overhead PSU/light rhythm and soft sidewall wash.
  for(let z=-3.70;z<=3.55;z+=1.05){
    const light=box(.38,.032,.46,cabinLight,{cast:false});light.position.set(0,3.205,z);light.name="aircraft-cabin-light";group.add(light);
    for(const side of[-1,1]){const reading=new THREE.Mesh(new THREE.CircleGeometry(.055,10),cabinLight);reading.position.set(side*.32,3.165,z);reading.rotation.x=Math.PI/2;reading.name="aircraft-reading-light";group.add(reading);}
  }
  for(const side of[-1,1]){const mood=box(.025,.045,8.65,accentMat,{cast:false});mood.position.set(side*.78,2.76,-.18);mood.name="aircraft-cabin-mood-strip";group.add(mood);}

  for(const side of[-1,1]){const cockpitBulkhead=box(.50,2.05,.10,linerMat,{cast:false});cockpitBulkhead.position.set(side*.60,2.18,4.82);cockpitBulkhead.name="aircraft-cockpit-bulkhead";group.add(cockpitBulkhead);}const cockpitHeader=box(1.70,.26,.10,linerMat,{cast:false});cockpitHeader.position.set(0,3.075,4.82);cockpitHeader.name="aircraft-cockpit-bulkhead-header";group.add(cockpitHeader);
  const cockpitDoor=box(.62,1.72,.045,seatDark,{cast:false});cockpitDoor.position.set(-.64,2.05,4.755);cockpitDoor.rotation.y=-Math.PI*.48;cockpitDoor.name="aircraft-cockpit-door-open";group.add(cockpitDoor);
  const galleyLeft=box(.38,1.55,.68,linerShadow,{cast:false});galleyLeft.position.set(-.62,1.90,4.28);galleyLeft.name="aircraft-forward-galley";group.add(galleyLeft);
  const servicePanel=box(.42,.68,.12,linerShadow,{cast:false});servicePanel.position.set(.56,1.78,3.50);servicePanel.name="aircraft-door-service-panel";group.add(servicePanel);

  // Usable flight deck. The geometry is intentionally lightweight, but it now
  // carries the visual hierarchy of a modern transport cockpit: dual PFD/ND
  // pairs, centre system displays, FCU/glareshield controls, standby instruments,
  // pedestal radios and levers, rudder pedals, side consoles and a populated
  // overhead panel. The added contrast also makes head movement much easier to
  // read from the pilot camera.
  const cockpitFloor=box(1.55,.08,1.58,linerShadow,{cast:false});cockpitFloor.position.set(0,1.18,5.56);cockpitFloor.name="aircraft-cockpit-floor";group.add(cockpitFloor);
  const panelMat=material(0x20282d,.46,.20),panelEdge=material(0x333c40,.50,.16),screenMat=material(0x12394a,.20,.10,{emissive:0x123f54,emissiveIntensity:1.05}),navScreenMat=material(0x163f32,.22,.10,{emissive:0x0f4938,emissiveIntensity:.92}),systemScreenMat=material(0x2f3218,.24,.10,{emissive:0x5b4c12,emissiveIntensity:.75}),controlMat=material(0x11171a,.50,.20),labelMat=material(0xc8d0cc,.52,.05),amberMat=material(0xf1a632,.26,.05,{emissive:0xd27a12,emissiveIntensity:1.5}),greenMat=material(0x55d98a,.24,.05,{emissive:0x2ab966,emissiveIntensity:1.25}),redIndicatorMat=material(0xe35a4f,.28,.05,{emissive:0xbe342d,emissiveIntensity:1.15});
  const glareshield=box(1.48,.18,.43,panelMat,{cast:false});glareshield.position.set(0,2.15,6.00);glareshield.rotation.x=-.16;glareshield.name="aircraft-cockpit-glareshield";group.add(glareshield);
  const mainPanel=box(1.48,.62,.11,panelEdge,{cast:false});mainPanel.position.set(0,1.88,5.91);mainPanel.rotation.x=-.10;mainPanel.name="aircraft-cockpit-main-panel";group.add(mainPanel);
  for(const side of[-1,1]){
    const pilotX=side*.40;
    for(const [xOffset,mat,name] of[[-.145,screenMat,"pfd"],[.145,navScreenMat,"nd"]]){const display=box(.255,.31,.035,mat,{cast:false});display.position.set(pilotX+xOffset,1.94,5.835);display.rotation.x=-.11;display.name=`aircraft-cockpit-${name}`;group.add(display);const bezel=box(.29,.35,.025,controlMat,{cast:false});bezel.position.set(pilotX+xOffset,1.94,5.87);bezel.rotation.x=-.11;bezel.name="aircraft-cockpit-display-bezel";group.add(bezel);group.remove(display);group.add(bezel,display);}
    const seatBase=box(.43,.18,.50,seatDark,{cast:false});seatBase.position.set(pilotX,1.34,5.16);seatBase.name="aircraft-pilot-seat";group.add(seatBase);const seatBack=box(.43,.62,.14,seatDark,{cast:false});seatBack.position.set(pilotX,1.66,4.96);seatBack.rotation.x=-.08;seatBack.name="aircraft-pilot-seat-back";group.add(seatBack);
    const headrest=box(.34,.16,.13,seatDark,{cast:false});headrest.position.set(pilotX,2.00,4.93);headrest.name="aircraft-pilot-headrest";group.add(headrest);
    const sideConsole=box(.30,.38,.88,panelMat,{cast:false});sideConsole.position.set(side*.70,1.42,5.33);sideConsole.name="aircraft-side-console";group.add(sideConsole);
    // A320-family style sidestick rather than a central yoke. Geometry is newly
    // authored and intentionally simplified; it is not copied from a 3D asset.
    const stickStem=box(.045,.24,.045,controlMat,{cast:false});stickStem.position.set(side*.69,1.68,5.55);stickStem.rotation.z=-side*.16;stickStem.name="aircraft-sidestick-stem";group.add(stickStem);
    const stickGrip=box(.10,.16,.065,controlMat,{cast:false});stickGrip.position.set(side*.72,1.80,5.54);stickGrip.rotation.z=-side*.12;stickGrip.name="aircraft-sidestick-grip";group.add(stickGrip);
    const armrest=box(.24,.08,.40,seatDark,{cast:false});armrest.position.set(side*.66,1.55,5.08);armrest.name="aircraft-pilot-armrest";group.add(armrest);
    const rudderPedalL=box(.14,.055,.16,silver,{cast:false}),rudderPedalR=rudderPedalL.clone();rudderPedalL.position.set(pilotX-.10,1.23,5.82);rudderPedalR.position.set(pilotX+.10,1.23,5.82);rudderPedalL.rotation.x=rudderPedalR.rotation.x=-.48;rudderPedalL.name=rudderPedalR.name="aircraft-rudder-pedal";group.add(rudderPedalL,rudderPedalR);
  }
  for(const [y,mat,name] of[[1.995,systemScreenMat,"upper-ecam"],[1.70,screenMat,"lower-ecam"]]){const centreDisplay=box(.31,.23,.038,mat,{cast:false});centreDisplay.position.set(0,y,5.82);centreDisplay.rotation.x=-.10;centreDisplay.name=`aircraft-${name}`;group.add(centreDisplay);}
  const fcu=box(1.16,.15,.13,panelMat,{cast:false});fcu.position.set(0,2.18,5.85);fcu.rotation.x=-.13;fcu.name="aircraft-flight-control-unit";group.add(fcu);
  for(const x of[-.44,-.22,0,.22,.44]){const knob=new THREE.Mesh(cachedPrimitive("cylinder",[.035,.035,.055,10]),silver);knob.rotation.x=Math.PI/2;knob.position.set(x,2.185,5.765);knob.name="aircraft-fcu-knob";group.add(knob);}
  for(const x of[-.36,-.12,.12,.36]){const indicator=box(.08,.025,.018,x===-.36?amberMat:greenMat,{cast:false});indicator.position.set(x,2.235,5.77);indicator.name="aircraft-fcu-indicator";group.add(indicator);}
  const standby=box(.15,.15,.03,screenMat,{cast:false});standby.position.set(0,1.93,5.76);standby.name="aircraft-standby-instrument";group.add(standby);
  const gearLever=box(.035,.20,.035,silver,{cast:false});gearLever.position.set(.57,1.83,5.79);gearLever.rotation.x=-.42;gearLever.name="aircraft-gear-lever";group.add(gearLever);
  const gearHandle=box(.085,.06,.055,controlMat,{cast:false});gearHandle.position.set(.57,1.93,5.74);gearHandle.name="aircraft-gear-handle";group.add(gearHandle);
  for(const x of[-.58,.58]){for(let i=0;i<3;i++){const annunciator=box(.085,.025,.018,i===0?greenMat:(i===1?amberMat:labelMat),{cast:false});annunciator.position.set(x,1.72+i*.06,5.79);annunciator.name="aircraft-panel-annunciator";group.add(annunciator);}}
  const pedestal=box(.40,.62,.98,panelMat,{cast:false});pedestal.position.set(0,1.52,5.27);pedestal.name="aircraft-centre-pedestal";group.add(pedestal);
  for(const [x,z] of[[-.07,5.12],[.07,5.12]]){const lever=box(.035,.27,.035,silver,{cast:false});lever.position.set(x,1.92,z);lever.rotation.x=-.35;lever.name="aircraft-thrust-lever";group.add(lever);const grip=box(.07,.06,.09,controlMat,{cast:false});grip.position.set(x,2.04,z-.055);grip.rotation.x=-.35;grip.name="aircraft-thrust-lever-grip";group.add(grip);}
  for(const [x,z,name] of[[-.13,5.37,"speedbrake"],[.13,5.37,"flap"]]){const lever=box(.026,.20,.026,silver,{cast:false});lever.position.set(x,1.87,z);lever.rotation.x=-.45;lever.name=`aircraft-${name}-lever`;group.add(lever);}
  for(const side of[-1,1]){
    const mcdu=box(.16,.20,.18,controlMat,{cast:false});mcdu.position.set(side*.105,1.72,5.55);mcdu.rotation.x=-.18;mcdu.name="aircraft-mcdu";group.add(mcdu);
    const mcduScreen=box(.105,.055,.012,greenMat,{cast:false});mcduScreen.position.set(side*.105,1.815,5.455);mcduScreen.rotation.x=-.18;mcduScreen.name="aircraft-mcdu-screen";group.add(mcduScreen);
    for(let row=0;row<4;row++)for(let col=0;col<3;col++){const key=box(.025,.012,.018,labelMat,{cast:false});key.position.set(side*.105+(col-1)*.035,1.70-row*.028,5.455);key.name="aircraft-mcdu-key";group.add(key);}
  }
  for(const z of[4.93,5.17]){const radio=box(.30,.10,.16,controlMat,{cast:false});radio.position.set(0,1.70,z);radio.name="aircraft-pedestal-radio";group.add(radio);for(const x of[-.10,.10]){const light=box(.045,.018,.012,greenMat,{cast:false});light.position.set(x,1.755,z-.085);group.add(light);}}
  const parkingBrake=new THREE.Mesh(cachedPrimitive("cylinder",[.045,.045,.07,10]),controlMat);parkingBrake.rotation.z=Math.PI/2;parkingBrake.position.set(.14,1.78,4.86);parkingBrake.name="aircraft-parking-brake";group.add(parkingBrake);
  for(const side of[-1,1]){const trimWheel=new THREE.Mesh(cachedPrimitive("cylinder",[.10,.10,.04,16]),controlMat);trimWheel.rotation.z=Math.PI/2;trimWheel.position.set(side*.22,1.56,5.06);trimWheel.name="aircraft-trim-wheel";group.add(trimWheel);}
  const overhead=box(1.16,.055,.78,panelMat,{cast:false});overhead.position.set(0,3.03,5.50);overhead.rotation.x=.18;overhead.name="aircraft-cockpit-overhead-panel";group.add(overhead);
  for(let row=0;row<5;row++)for(let col=0;col<8;col++){const x=(col-3.5)*.13,z=5.22+row*.13,lit=(row+col)%6===0,sw=box(.050,.018,.030,lit?(row%2?amberMat:greenMat):labelMat,{cast:false});sw.position.set(x,2.978+row*.021,z);sw.rotation.x=.18;sw.name="aircraft-overhead-switch";group.add(sw);}
  for(const x of[-.39,-.13,.13,.39]){const guard=box(.10,.035,.08,panelEdge,{cast:false});guard.position.set(x,3.045,5.77);guard.rotation.x=.18;guard.name="aircraft-overhead-guard";group.add(guard);}
  for(const side of[-1,1]){const visor=box(.42,.025,.22,material(0x4f5a60,.30,.12,{transparent:true,opacity:.42}),{cast:false});visor.position.set(side*.40,2.76,6.08);visor.rotation.x=-.20;visor.name="aircraft-sun-visor";group.add(visor);}
  const firePanel=box(.34,.08,.08,panelMat,{cast:false});firePanel.position.set(0,2.20,5.69);firePanel.name="aircraft-fire-panel";group.add(firePanel);for(const x of[-.09,.09]){const fireLight=box(.055,.025,.018,redIndicatorMat,{cast:false});fireLight.position.set(x,2.22,5.64);group.add(fireLight);}
  // Retractable landing gear: paired mains and twin nose wheels, with simple
  // bay doors. The whole assembly animates into the fuselage after departure.
  const gearStrutMat=silver,tireMat=material(0x171b1d,.72,.10),gearGroup=new THREE.Group();gearGroup.name="aircraft-landing-gear-assembly";group.add(gearGroup);
  const addWheelPair=(x,y,z,spacing=.18)=>{for(const offset of[-spacing,spacing]){const wheel=wheelMesh(tireMat);wheel.position.set(x+offset,y,z);wheel.name="aircraft-landing-wheel";gearGroup.add(wheel);}};
  const noseStrut=box(.075,.96,.075,gearStrutMat);noseStrut.position.set(0,1.04,4.62);noseStrut.name="aircraft-nose-gear";gearGroup.add(noseStrut);addWheelPair(0,.53,4.62,.11);
  const noseDoorLeft=box(.05,.08,.72,white,{cast:false}),noseDoorRight=noseDoorLeft.clone();noseDoorLeft.position.set(-.18,1.43,4.54);noseDoorRight.position.set(.18,1.43,4.54);noseDoorLeft.name=noseDoorRight.name="aircraft-nose-gear-door";gearGroup.add(noseDoorLeft,noseDoorRight);
  for(const x of[-1.52,1.52]){
    const strut=box(.09,1.04,.09,gearStrutMat);strut.position.set(x,1.05,-.86);strut.name="aircraft-main-gear";gearGroup.add(strut);
    addWheelPair(x,.50,-.92,.17);
    const dragBrace=box(.055,.64,.055,gearStrutMat);dragBrace.position.set(x+(x<0?.16:-.16),1.18,-1.10);dragBrace.rotation.x=.46;dragBrace.rotation.z=x<0?-.20:.20;dragBrace.name="aircraft-main-gear-drag-brace";gearGroup.add(dragBrace);
    const torqueLink=box(.04,.25,.04,gearStrutMat);torqueLink.position.set(x,.72,-.78);torqueLink.rotation.x=-.50;torqueLink.name="aircraft-main-gear-torque-link";gearGroup.add(torqueLink);
    const door=box(.07,.08,.92,white,{cast:false});door.position.set(x+(x<0?.17:-.17),1.43,-.90);door.rotation.z=x<0?-.14:.14;door.name="aircraft-main-gear-door";gearGroup.add(door);
  }

  const navLeft=new THREE.Mesh(cachedPrimitive("sphere",[.10,7,5]),navRed),navRight=new THREE.Mesh(cachedPrimitive("sphere",[.10,7,5]),navGreen);navLeft.position.set(-6.96,1.54,-2.04);navRight.position.set(6.96,1.54,-2.04);group.add(navLeft,navRight);
  const beaconLens=new THREE.Mesh(cachedPrimitive("sphere",[.10,8,6]),navRed);beaconLens.position.set(0,3.43,-.65);group.add(beaconLens);
  const landingLeft=new THREE.Mesh(cachedPrimitive("sphere",[.09,7,5]),lamp),landingRight=landingLeft.clone();landingLeft.position.set(-1.18,1.42,1.22);landingRight.position.set(1.18,1.42,1.22);group.add(landingLeft,landingRight);
  const beacon=new THREE.PointLight(0xff2f2f,0,18);beacon.position.set(0,3.48,-.65);group.add(beacon);
  const noseLight=new THREE.PointLight(0xfff3d1,0,38);noseLight.position.set(0,1.32,6.10);group.add(noseLight);
  group.remove(beacon,noseLight);root.add(beacon,noseLight);const mediumDetail=createAircraftProxy(index,"medium"),lowDetail=createAircraftProxy(index,"low"),farDetail=createAircraftProxy(index,"far");mediumDetail.visible=false;lowDetail.visible=false;farDetail.visible=false;root.add(mediumDetail,lowDetail,farDetail);
  const fullShadowCasters=[],proxyShadowCasters=[];group.traverse(object=>{if(object.isMesh&&object.castShadow)fullShadowCasters.push(object);});for(const proxy of[mediumDetail,lowDetail,farDetail])proxy.traverse(object=>{if(object.isMesh)proxyShadowCasters.push(object);});
  root.userData={door,doorClosedX:AIRCRAFT_DOOR_LOCAL_X+.055,doorClosedZ:AIRCRAFT_DOOR_LOCAL_Z,beacon,noseLight,gearGroup,gearDeployment:1,flapMeshes,slatMeshes,flapDeployment:0,length:AIRCRAFT_MODEL.length,width:AIRCRAFT_MODEL.span,height:AIRCRAFT_MODEL.height,cabinFloorY:1.15,cabinCeilingY:3.28,cabinHalfWidth:1.18,cabinMinZ:-4.55,cabinMaxZ:5.92,cockpitMinZ:4.82,cockpitMaxZ:6.20,pilotEyeY:2.47,pilotEyeZ:5.42,doorLocalX:AIRCRAFT_DOOR_LOCAL_X,doorLocalZ:AIRCRAFT_DOOR_LOCAL_Z,doorSillY:1.15,doorOpeningHeight:1.90,fuselageTopY:3.40,seats,standingEyeY:2.87,seatedEyeY:2.23,exteriorWindows,seatLayout:"2+2",lodGroups:{full:group,medium:mediumDetail,low:lowDetail,far:farDetail},fullShadowCasters,proxyShadowCasters,lodTier:"full",shadowMode:"full"};return root;
}

export class AirportSystem{
  constructor(scene,definition,chunkManager=null,camera=null,input=null,toast=null){
    this.scene=scene;this.networkDefinition=definition?.airports?definition:null;this.airportDefinitions=this.networkDefinition?.airports??[definition];
    this.definition=this.airportDefinitions.find(airport=>airport.id==="eastmere-airport")??this.airportDefinitions[0];
    this.islandDefinition=this.airportDefinitions.find(airport=>airport.id!==this.definition.id)??null;
    this.aviation=this.networkDefinition?.aviation??{aircraftCount:definition?.aircraftCount??3,cruiseAltitude:178,cruiseSpeed:78,turnaroundSeconds:9,boardingSeconds:10,prepareSeconds:3,minimumAirportReserve:1};
    this.airportById=new Map(this.airportDefinitions.map(airport=>[airport.id,airport]));this.chunkManager=chunkManager;this.camera=camera;this.input=input;this.toast=toast??(()=>{});
    this.group=new THREE.Group();this.group.name="eastmere-airport";scene.add(this.group);this.islandGroup=new THREE.Group();this.islandGroup.name="merehaven-island";scene.add(this.islandGroup);
    this.aircraft=[];this.completedCycles=0;this.activeFlights=0;this.runwayOwners=new Map(this.airportDefinitions.map(airport=>[airport.id,null]));this.runwayOwnerId=null;this.standOccupancy=new Map(this.airportDefinitions.map(airport=>[airport.id,Array(airport.standCount??4).fill(null)]));
    this.runwayDesignators=runwayDesignators(this.definition);this.standLocalZ=this.definition.terminalOffset-29;
    this.walkSurfaces=[];this.walkBlockers=[];this.gateWalkways=[];this.islandStairs=[];this.terminalFloorHeight=.18;this.passengerState=null;this.initializedNetwork=this.airportDefinitions.length>1;
    this._passengerLocal=new THREE.Vector3();this._passengerEye=new THREE.Vector3();this._passengerLook=new THREE.Vector3();this._passengerWorldLook=new THREE.Vector3();this._passengerWorldEye=new THREE.Vector3();this._passengerLookTarget=new THREE.Vector3();this._passengerNext=new THREE.Vector3();this._passengerMove=new THREE.Vector2();this._passengerScreenLeft=new THREE.Vector2();this._queueOffset=new THREE.Vector3();this._manualForward=new THREE.Vector3();
    this._forwardX=Math.sin(this.definition.heading);this._forwardZ=Math.cos(this.definition.heading);this._rightX=this._forwardZ;this._rightZ=-this._forwardX;
    this.buildAirport();if(this.islandDefinition)this.buildIslandDestination();this.organizeQualityDetailGroups();this.freezeStaticGroup();this.freezeIslandStaticGroup();this.spawnAircraft(this.aviation.aircraftCount??3);this.applyQualityProfile();this._unsubscribeQuality=qualityManager.subscribe(profile=>this.applyQualityProfile(profile));
  }

  buildAirport(){
    const d=this.definition,asphalt=material(0x2a2f31,.97,.01),asphaltAlt=material(0x33383a,.98,.01),shoulder=material(0x414748,.97,.01),taxi=material(0x353b3d,.95,.02),concrete=material(0x777b78,.92,.04),concreteAlt=material(0x858982,.94,.03),terminalMat=material(0xaeb8bc,.54,.12),terminalDark=material(0x7a868b,.56,.16),glass=material(0x658694,.15,.26,{transparent:true,opacity:.66}),marking=basicMaterial(0xf2f0df),yellow=basicMaterial(0xe4c847),apronWhite=basicMaterial(0xe9e7dd),safetyRed=basicMaterial(0xd95143),fence=material(0x566066,.68,.34),grass=material(0x496448,1,0),signRed=material(0xa71f1f,.55,.12,{emissive:0x260000,emissiveIntensity:.35}),signBlack=material(0x111719,.55,.18),signYellow=material(0xe0bd39,.55,.08),signWhite=basicMaterial(0xf5f2e8),lampHousing=material(0x30373a,.5,.35);
    const runwayHalf=d.runway.length*.5,taxiZ=d.taxiwayOffset,standZ=this.standLocalZ,holdZ=d.runway.width*.5+13,holdOutX=-d.runway.length*.35,exitX=d.runway.length*.28;

    // Grassy movement-area base and runway shoulder stay inside the existing macro footprint.
    const movementGrass=localBox(d,0,-.08,8,d.runway.length+24,.10,d.runway.width+118,grass,{cast:false});movementGrass.name="airport-movement-grass";this.group.add(movementGrass);
    const runwayShoulder=localBox(d,0,.005,0,d.runway.length+4,.10,d.runway.width+4,shoulder,{cast:false});runwayShoulder.name="airport-runway-shoulder";this.group.add(runwayShoulder);
    const runway=localBox(d,0,.09,0,d.runway.length,.18,d.runway.width,asphalt);runway.name="airport-runway";this.group.add(runway);

    // Subtle asphalt panels/seams and rubber staining, deliberately low-contrast.
    for(const x of[-145,-62,35,126]){const patch=localBox(d,x,.192,(x%2)*.015,44,.012,d.runway.width-2,asphaltAlt,{cast:false});patch.name="airport-runway-tonal-panel";this.group.add(patch);}
    for(let x=-runwayHalf+28;x<runwayHalf-20;x+=52)addLocalLine(this.group,d,[x,.198,-d.runway.width*.5+1],[x,.198,d.runway.width*.5-1],.08,.012,basicMaterial(0x202527),"airport-runway-seam");
    for(const x of[-runwayHalf+72,runwayHalf-72])for(const z of[-2.6,2.6]){const rubber=localBox(d,x,.205,z,26,.010,1.0,basicMaterial(0x171a1b,{transparent:true,opacity:.34}),{cast:false});rubber.name="airport-touchdown-rubber";this.group.add(rubber);}

    // Centreline: compressed but keeps the real-world stripe/gap rhythm rather than a continuous arcade.
    const centreStripeLength=14,centreGap=10,centreStep=centreStripeLength+centreGap;
    for(let x=-runwayHalf+46;x<=runwayHalf-46;x+=centreStep){const stripe=localBox(d,x,.208,0,centreStripeLength,.018,.72,marking,{cast:false});stripe.name="airport-runway-centreline";this.group.add(stripe);}
    for(const z of[-d.runway.width*.5+.45,d.runway.width*.5-.45])addLocalLine(this.group,d,[-runwayHalf,.208,z],[runwayHalf,.208,z],.62,.018,marking,"airport-runway-side-stripe");

    // Threshold bars, aiming points and restrained touchdown-zone blocks.
    const thresholdX=runwayHalf-15;
    for(const side of[-1,1]){
      for(let i=0;i<8;i++){
        const z=-12.25+i*3.5,bar=localBox(d,side*thresholdX,.21,z,10,.02,1.45,marking,{cast:false});bar.name="airport-runway-threshold-bar";this.group.add(bar);
      }
      const inward=-side;
      for(const z of[-7,7]){const aim=localBox(d,side*(runwayHalf-76),.21,z,12,.02,2.4,marking,{cast:false});aim.name="airport-runway-aiming-point";this.group.add(aim);}
      for(const distance of[48,104])for(const z of[-8.3,8.3]){const tdz=localBox(d,side*(runwayHalf-distance),.21,z,5.5,.02,1.3,marking,{cast:false});tdz.name="airport-runway-touchdown-zone";this.group.add(tdz);}
      const numberX=side*(runwayHalf-31);addRunwayDesignation(this.group,d,side<0?this.runwayDesignators[0]:this.runwayDesignators[1],numberX,inward,marking,`airport-runway-designator-${side<0?this.runwayDesignators[0]:this.runwayDesignators[1]}`);
    }

    // Aeronautical ground lighting: white runway edges, green thresholds and red ends.
    const edgeLightGeometry=new THREE.SphereGeometry(.14,7,5),whiteLight=material(0xeaf5ff,.18,.02,{emissive:0xd5edff,emissiveIntensity:1.65}),greenLight=material(0x3ef07d,.18,.02,{emissive:0x18d65c,emissiveIntensity:1.8}),redLight=material(0xff4a42,.18,.02,{emissive:0xef241c,emissiveIntensity:1.8}),blueLight=material(0x4ea2ff,.18,.02,{emissive:0x247dff,emissiveIntensity:1.6});
    const edgeXs=[];for(let x=-runwayHalf+6;x<=runwayHalf-6;x+=22)edgeXs.push(x);
    const runwayLights=new THREE.InstancedMesh(edgeLightGeometry,whiteLight,edgeXs.length*2),dummy=new THREE.Object3D();let lightIndex=0;
    for(const x of edgeXs)for(const z of[-d.runway.width*.5-1.1,d.runway.width*.5+1.1]){dummy.position.copy(localPoint(d,x,.31,z));dummy.updateMatrix();runwayLights.setMatrixAt(lightIndex++,dummy.matrix);}runwayLights.count=lightIndex;runwayLights.instanceMatrix.needsUpdate=true;runwayLights.name="airport-runway-edge-lights";this.group.add(runwayLights);
    const thresholdPositions=[];for(const side of[-1,1])for(let z=-d.runway.width*.5+1.8;z<=d.runway.width*.5-1.8;z+=4.2)thresholdPositions.push([side*(runwayHalf-1),z]);
    for(const [mat,name,xShift] of [[greenLight,"airport-threshold-lights",0],[redLight,"airport-runway-end-lights",2.0]]){
      const lights=new THREE.InstancedMesh(edgeLightGeometry,mat,thresholdPositions.length);let idx=0;
      for(const [x,z] of thresholdPositions){dummy.position.copy(localPoint(d,x+Math.sign(x)*xShift,.33,z));dummy.updateMatrix();lights.setMatrixAt(idx++,dummy.matrix);}lights.instanceMatrix.needsUpdate=true;lights.name=name;this.group.add(lights);
    }

    // PAPIs on the left side for each approach; compressed siting appropriate to the game scale.
    for(const side of[-1,1]){
      const x=side*(runwayHalf-40),z=side<0?-d.runway.width*.5-5:d.runway.width*.5+5;
      for(let i=0;i<4;i++){
        const housing=localBox(d,x,.28,z+(i-1.5)*1.1,1.0,.32,.72,lampHousing);housing.name="airport-papi-housing";this.group.add(housing);
        const lens=new THREE.Mesh(cachedPrimitive("sphere",[.09,7,5]),i<2?redLight:whiteLight);lens.position.copy(localPoint(d,x+side*.18,.47,z+(i-1.5)*1.1));lens.name="airport-papi-lamp";this.group.add(lens);
      }
    }

    // Taxiway and connectors: shoulder underlay + smooth curved centreline geometry.
    const taxiStart=-d.runway.length*.42,taxiEnd=d.runway.length*.42;
    const taxiCurve=curveFromLocal(d,[[taxiStart,.11,taxiZ],[-70,.11,taxiZ],[70,.11,taxiZ],[taxiEnd,.11,taxiZ]]);
    addCurveStrip(this.group,taxiCurve,19,.12,shoulder,24,"airport-taxiway-shoulder");
    addCurveStrip(this.group,taxiCurve,15,.14,taxi,24,"airport-taxiway");
    addCurveStrip(this.group,taxiCurve,.34,.022,yellow,24,"airport-taxiway-centreline");
    const connectorDefs=[{x:holdOutX,name:"A"},{x:exitX,name:"B"}];
    for(const connector of connectorDefs){
      const sign=connector.x<0?-1:1,curve=curveFromLocal(d,[[connector.x+sign*10,.11,taxiZ],[connector.x,.11,taxiZ-8],[connector.x,.11,holdZ],[connector.x-sign*3,.11,18],[connector.x-sign*10,.11,7],[connector.x-sign*18,.11,0]],.42);
      addCurveStrip(this.group,curve,16,.13,shoulder,18,`airport-taxiway-${connector.name}-shoulder`);addCurveStrip(this.group,curve,13.5,.145,taxi,18,`airport-taxiway-${connector.name}`);addCurveStrip(this.group,curve,.34,.024,yellow,18,`airport-taxiway-${connector.name}-centreline`);
      // Pattern A holding position: two solid and two broken yellow bars, with broken side closer to runway.
      for(const offset of[0,1.1])addLocalLine(this.group,d,[connector.x-6.6,.24,holdZ+offset],[connector.x+6.6,.24,holdZ+offset],.38,.022,yellow,`airport-hold-${connector.name}-solid`);
      for(const offset of[-1.4,-2.5])for(let k=-2;k<=2;k++){const cx=connector.x+k*2.8;addLocalLine(this.group,d,[cx-1.0,.24,holdZ+offset],[cx+1.0,.24,holdZ+offset],.38,.022,yellow,`airport-hold-${connector.name}-broken`);}
    }
    const taxiEdgePoints=[];for(let x=taxiStart+4;x<=taxiEnd-4;x+=24)for(const z of[taxiZ-8.3,taxiZ+8.3])taxiEdgePoints.push([x,z]);
    const taxiLights=new THREE.InstancedMesh(edgeLightGeometry,blueLight,taxiEdgePoints.length);let taxiLightIndex=0;for(const [x,z] of taxiEdgePoints){dummy.position.copy(localPoint(d,x,.28,z));dummy.updateMatrix();taxiLights.setMatrixAt(taxiLightIndex++,dummy.matrix);}taxiLights.instanceMatrix.needsUpdate=true;taxiLights.name="airport-taxiway-edge-lights";this.group.add(taxiLights);

    // Apron uses the authoritative 155 x 70 local footprint (previous mesh axes were transposed).
    const apron=localBox(d,20,.10,d.terminalOffset-35,155,.18,70,concrete);apron.name="airport-apron";this.group.add(apron);
    for(const x of[-45,-8,29,66]){const panel=localBox(d,x,.202,d.terminalOffset-35,32,.012,68,concreteAlt,{cast:false});panel.name="airport-apron-tonal-panel";this.group.add(panel);}
    for(const x of[-57,-19,19,57])addLocalLine(this.group,d,[x,.21,d.terminalOffset-68],[x,.21,d.terminalOffset-3],.08,.014,basicMaterial(0x656965),"airport-apron-seam");

    // Apron service road and safety separation.
    const serviceRoadZ=d.terminalOffset-11,serviceRoadA=localPoint(d,-57,.18,serviceRoadZ),serviceRoadB=localPoint(d,97,.18,serviceRoadZ);const serviceRoad=stripBetween(serviceRoadA,serviceRoadB,7,.06,asphalt);serviceRoad.name="airport-airside-service-road";this.group.add(serviceRoad);
    addLocalLine(this.group,d,[-57,.225,serviceRoadZ-4.0],[97,.225,serviceRoadZ-4.0],.28,.018,safetyRed,"airport-apron-safety-line");

    // Four stands with lead-in lines, stop bars, envelopes, equipment boxes and stand numbers.
    const gateXs=[];for(let i=0;i<4;i++)gateXs.push(-34+i*23);
    for(let i=0;i<gateXs.length;i++){
      const gateX=gateXs[i],standNo=i+1;
      const leadCurve=curveFromLocal(d,[[gateX+(i<2?-5:5),.225,taxiZ],[gateX,.225,taxiZ+8],[gateX,.225,standZ-4],[gateX,.225,standZ+7]],.45);addCurveStrip(this.group,leadCurve,.32,.022,yellow,14,`airport-stand-${standNo}-lead-in`);
      addLocalLine(this.group,d,[gateX-4.8,.225,standZ+4.5],[gateX+4.8,.225,standZ+4.5],.38,.022,yellow,`airport-stand-${standNo}-stop-line`);
      // U-shaped stand safety envelope.
      addLocalLine(this.group,d,[gateX-8.1,.224,standZ-9],[gateX-8.1,.224,standZ+10],.22,.018,apronWhite,`airport-stand-${standNo}-envelope`);
      addLocalLine(this.group,d,[gateX+8.1,.224,standZ-9],[gateX+8.1,.224,standZ+10],.22,.018,apronWhite,`airport-stand-${standNo}-envelope`);
      addLocalLine(this.group,d,[gateX-8.1,.224,standZ-9],[gateX+8.1,.224,standZ-9],.22,.018,apronWhite,`airport-stand-${standNo}-envelope`);
      addStandNumber(this.group,d,standNo,gateX,standZ-12,apronWhite);
      // Equipment parking box at alternating side of stand.
      const equipmentX=gateX+(i%2===0?8.8:-8.8),equipmentZ=standZ+8.5;for(const [a,b] of [[[equipmentX-3,.224,equipmentZ-3],[equipmentX+3,.224,equipmentZ-3]],[[equipmentX+3,.224,equipmentZ-3],[equipmentX+3,.224,equipmentZ+3]],[[equipmentX+3,.224,equipmentZ+3],[equipmentX-3,.224,equipmentZ+3]],[[equipmentX-3,.224,equipmentZ+3],[equipmentX-3,.224,equipmentZ-3]]])addLocalLine(this.group,d,a,b,.18,.016,apronWhite,`airport-stand-${standNo}-equipment-box`);
    }

    // Lightweight GSE: baggage carts, tugs, GPUs and cones, kept deliberately ordered around stands.
    const tugMat=material(0xe2b940,.62,.12),cartMat=material(0x7a8588,.70,.22),gpuMat=material(0xeee9d7,.66,.18),wheelMat=material(0x1f2426,.70,.12);
    for(let i=0;i<4;i++){
      const gateX=gateXs[i],side=i%2===0?1:-1;
      const tug=localBox(d,gateX+side*9.6,.52,standZ+9,3.2,.9,1.55,tugMat);tug.name=`airport-stand-${i+1}-baggage-tug`;this.group.add(tug);
      const cart=localBox(d,gateX+side*12.4,.62,standZ+9,3.0,1.15,1.65,cartMat);cart.name=`airport-stand-${i+1}-baggage-cart`;this.group.add(cart);
      const gpu=localBox(d,gateX-side*9.4,.62,standZ+8.7,2.0,1.2,1.4,gpuMat);gpu.name=`airport-stand-${i+1}-gpu`;this.group.add(gpu);
      for(const gx of[gateX+side*8.5,gateX+side*10.7,gateX+side*13.8]){const wheel=localBox(d,gx,.22,standZ+8.2,.35,.35,.35,wheelMat);wheel.name="airport-gse-wheel";this.group.add(wheel);}
    }
    const coneGeometry=new THREE.ConeGeometry(.22,.72,8),coneMaterial=material(0xe86d2d,.62,.04),conePositions=[];for(let i=0;i<4;i++){const gx=gateXs[i];conePositions.push([gx-6.5,standZ+7],[gx+6.5,standZ+7]);}
    const cones=new THREE.InstancedMesh(coneGeometry,coneMaterial,conePositions.length);let coneIndex=0;for(const [x,z] of conePositions){dummy.position.copy(localPoint(d,x,.55,z));dummy.updateMatrix();cones.setMatrixAt(coneIndex++,dummy.matrix);}cones.instanceMatrix.needsUpdate=true;cones.name="airport-apron-cones";this.group.add(cones);

    // Terminal interior and shell. Keep the existing macro footprint, but make the
    // passenger route legible from rail/landside entrance -> processing -> gates.
    // The shell is now assembled from floors, walls and ceilings instead of solid
    // cuboids, so walking players can actually occupy the building.
    const terminalZ=d.terminalOffset,interiorFloor=material(0xc9c4b9,.88,.02),interiorDark=material(0x6d787d,.56,.12),interiorWhite=material(0xe5e3da,.72,.02),carpet=material(0x4a6577,.92,.01),seatMat=material(0x3a5e79,.84,.02),counterMat=material(0x7d8586,.68,.12),beltMat=material(0x252b2e,.62,.28),warmLight=material(0xffefc6,.24,.02,{emissive:0xffe5a5,emissiveIntensity:1.5}),displayMat=material(0x122233,.45,.12,{emissive:0x07121c,emissiveIntensity:.65});
    const terminalFloorY=this.terminalFloorHeight;
    const mainHall=localBox(d,20,.09,terminalZ,92,.18,24,interiorFloor,{cast:false});mainHall.name="airport-terminal-main-hall";this.group.add(mainHall);
    const westWing=localBox(d,-36,.09,terminalZ+1,20,.18,22,interiorFloor,{cast:false});westWing.name="airport-terminal-west-wing";this.group.add(westWing);
    const arrivalsAnnex=localBox(d,-58,.09,terminalZ+1,24,.18,22,interiorFloor,{cast:false});arrivalsAnnex.name="airport-terminal-arrivals-annex";this.group.add(arrivalsAnnex);
    const railWing=localBox(d,75,.09,terminalZ+.5,18,.18,25,interiorFloor,{cast:false});railWing.name="airport-terminal-rail-connection-wing";this.group.add(railWing);
    const railVestibule=localBox(d,85,.09,terminalZ+12.5,7,.18,7,interiorFloor,{cast:false});railVestibule.name="airport-terminal-rail-vestibule";this.group.add(railVestibule);
    this.registerWalkSurface({type:"flat",role:"terminal-main-floor",centreX:20,centreZ:terminalZ,halfX:46,halfZ:12,height:terminalFloorY,priority:3});
    this.registerWalkSurface({type:"flat",role:"terminal-west-floor",centreX:-36,centreZ:terminalZ+1,halfX:10,halfZ:11,height:terminalFloorY,priority:3});
    this.registerWalkSurface({type:"flat",role:"terminal-arrivals-annex",centreX:-58,centreZ:terminalZ+1,halfX:12,halfZ:11,height:terminalFloorY,priority:3});
    this.registerWalkSurface({type:"flat",role:"terminal-rail-floor",centreX:75,centreZ:terminalZ+.5,halfX:9,halfZ:12.5,height:terminalFloorY,priority:3});
    this.registerWalkSurface({type:"flat",role:"terminal-rail-vestibule",centreX:85,centreZ:terminalZ+12.5,halfX:3.5,halfZ:3.5,height:terminalFloorY,priority:3});

    const roof=localBox(d,20,13.35,terminalZ,94,.7,25,terminalDark);roof.name="airport-terminal-roof";this.group.add(roof);
    const arrivalsRoof=localBox(d,-58,5.0,terminalZ+1,25,.48,23,terminalDark);arrivalsRoof.name="airport-terminal-arrivals-annex-roof";this.group.add(arrivalsRoof);
    const upperBandA=localBox(d,20,9.0,terminalZ+11.55,94,7.0,.9,terminalMat);upperBandA.name="airport-terminal-upper-landside-band";this.group.add(upperBandA);
    const upperBandB=localBox(d,20,9.0,terminalZ-11.55,94,7.0,.9,terminalMat);upperBandB.name="airport-terminal-upper-airside-band";this.group.add(upperBandB);
    for(const [cx,w] of[[-18,18],[4,18],[30,18],[56,18]]){const raft=localBox(d,cx,6.35,terminalZ+3,w,.12,10.5,interiorWhite,{cast:false});raft.name="airport-terminal-ceiling-raft";this.group.add(raft);}

    const addWallX=(name,x1,x2,z,{height=4.55,y=2.35,mat=glass,block=true,minY=0,maxY=4.7}={})=>{
      if(x2<=x1)return null;const wall=localBox(d,(x1+x2)*.5,y,z,x2-x1,height,.22,mat,{cast:false});wall.name=name;this.group.add(wall);
      if(block)this.registerWalkBlocker({name,centreX:(x1+x2)*.5,centreZ:z,halfX:(x2-x1)*.5,halfZ:.12,minimumHeight:minY,maximumHeight:maxY});return wall;
    };
    const addWallZ=(name,z1,z2,x,{height=4.55,y=2.35,mat=glass,block=true,minY=0,maxY=4.7}={})=>{
      if(z2<=z1)return null;const wall=localBox(d,x,y,(z1+z2)*.5,.22,height,z2-z1,mat,{cast:false});wall.name=name;this.group.add(wall);
      if(block)this.registerWalkBlocker({name,centreX:x,centreZ:(z1+z2)*.5,halfX:.12,halfZ:(z2-z1)*.5,minimumHeight:minY,maximumHeight:maxY});return wall;
    };

    // Airside glazing is split around four genuinely open gate portals.
    let airsideCursor=-46;
    for(const gateX of gateXs){const left=gateX-1.75,right=gateX+1.75;if(left>airsideCursor)addWallX("airport-terminal-airside-glazing",airsideCursor,left,terminalZ-12,{mat:glass});airsideCursor=right;}
    if(airsideCursor<66)addWallX("airport-terminal-airside-glazing",airsideCursor,66,terminalZ-12,{mat:glass});
    addWallX("airport-terminal-rail-airside-glazing",66,84,terminalZ-12,{mat:glass});

    // Landside façade leaves four automatic-door openings and keeps the rail
    // connection open at the east end.
    const landsideOpenings=[[16.6,19.8],[22.6,25.8],[28.6,31.8],[34.6,37.8]],landsideMin=-46,landsideMax=66;let landsideCursor=landsideMin;
    for(const [left,right] of landsideOpenings){if(left>landsideCursor)addWallX("airport-terminal-landside-glazing",landsideCursor,left,terminalZ+12,{mat:glass});landsideCursor=right;}
    if(landsideCursor<landsideMax)addWallX("airport-terminal-landside-glazing",landsideCursor,landsideMax,terminalZ+12,{mat:glass});
    addWallX("airport-terminal-rail-landside-glazing",66,84,terminalZ+13,{mat:glass});
    // The original west wall is split to create a real walk-through connection
    // into the enlarged arrivals wing rather than a decorative exterior annex.
    addWallZ("airport-terminal-west-connector-wall",terminalZ-10,terminalZ-.8,-46,{mat:terminalDark});
    addWallZ("airport-terminal-west-connector-wall",terminalZ+2.8,terminalZ+12,-46,{mat:terminalDark});
    addWallX("airport-terminal-arrivals-airside-glazing",-70,-46,terminalZ-10,{height:4.6,y:2.35,mat:glass});
    addWallX("airport-terminal-arrivals-landside-glazing",-70,-46,terminalZ+12,{height:4.6,y:2.35,mat:glass});
    addWallZ("airport-terminal-arrivals-west-wall",terminalZ-10,terminalZ+12,-70,{height:4.6,y:2.35,mat:terminalDark});
    addWallZ("airport-terminal-east-wall",terminalZ-12,terminalZ+9.3,84,{mat:terminalMat});
    // Rail-link portal: side jambs only, leaving a 4.2 m clear opening aligned to the station tunnel.
    addWallZ("airport-terminal-rail-portal-jamb",terminalZ+9.3,terminalZ+10.4,84,{mat:terminalDark});
    const portalHeader=localBox(d,84,4.35,terminalZ+11.8,.45,1.1,4.4,terminalDark);portalHeader.name="airport-terminal-rail-portal-header";this.group.add(portalHeader);

    const entranceCanopy=localBox(d,28,3.6,terminalZ+16,32,.32,8,terminalDark);entranceCanopy.name="airport-terminal-entrance-canopy";this.group.add(entranceCanopy);
    for(const x of[-8,10,28,46,64]){const column=localBox(d,x,1.8,terminalZ+15.2,.5,3.6,.5,terminalDark);column.name="airport-terminal-canopy-column";this.group.add(column);}
    for(const [x,z,w,dz] of [[-5,terminalZ,8,5],[18,terminalZ,10,6],[42,terminalZ,8,4],[66,terminalZ,6,5]]){const plant=localBox(d,x,14.2,z,w,1.2,dz,terminalDark);plant.name="airport-terminal-rooftop-plant";this.group.add(plant);}
    const terminalSign=localBox(d,20,10.0,terminalZ+12.35,28,1.5,.25,signBlack);terminalSign.name="airport-terminal-eastmere-sign";this.group.add(terminalSign);addFacadeText(this.group,d,"EASTMERE",20,10.0,terminalZ+12.51,1.05,signWhite,"airport-terminal-eastmere-lettering");

    // Check-in, security and baggage areas make the shell read as a functioning terminal.
    for(const [index,x] of[-12,0,12,24,36].entries()){
      const desk=localBox(d,x,1.0,terminalZ+7.2,7.2,1.55,1.35,counterMat);desk.name=`airport-checkin-desk-${index+1}`;this.group.add(desk);this.registerWalkBlocker({name:desk.name,centreX:x,centreZ:terminalZ+7.2,halfX:3.6,halfZ:.68,minimumHeight:0,maximumHeight:1.8});
      const screen=localBox(d,x,2.1,terminalZ+6.48,2.0,1.2,.12,displayMat);screen.name="airport-checkin-screen";this.group.add(screen);
    }
    const departuresSign=localBox(d,14,3.55,terminalZ+4.7,15.5,.88,.16,signBlack);departuresSign.name="airport-interior-departures-sign";this.group.add(departuresSign);addFacadeText(this.group,d,"DEPARTURES",14,3.55,terminalZ+4.58,.48,signWhite,"airport-interior-departures-text");
    const securitySign=localBox(d,20,3.28,terminalZ+.75,10.8,.82,.16,signBlack);securitySign.name="airport-security-sign";this.group.add(securitySign);addFacadeText(this.group,d,"SECURITY",20,3.28,terminalZ+.64,.44,signWhite,"airport-security-text");
    for(const laneX of[2,13,24,35]){
      const archLeft=localBox(d,laneX-1.25,1.15,terminalZ+.1,.18,2.3,.42,interiorDark),archRight=localBox(d,laneX+1.25,1.15,terminalZ+.1,.18,2.3,.42,interiorDark),archTop=localBox(d,laneX,2.24,terminalZ+.1,2.7,.18,.42,interiorDark);archLeft.name="airport-security-portal";this.group.add(archLeft,archRight,archTop);
      const tray=localBox(d,laneX-2.4,.62,terminalZ+1.8,2.2,1.0,.85,counterMat);tray.name="airport-security-tray-table";this.group.add(tray);this.registerWalkBlocker({name:tray.name,centreX:laneX-2.4,centreZ:terminalZ+1.8,halfX:1.1,halfZ:.43,minimumHeight:0,maximumHeight:1.3});
    }
    const baggage=new THREE.Mesh(new THREE.TorusGeometry(4.0,.48,8,28),beltMat);baggage.rotation.x=Math.PI/2;baggage.scale.z=.65;baggage.position.copy(localPoint(d,-36,.70,terminalZ+5));baggage.name="airport-baggage-carousel";this.group.add(baggage);
    const arrivalsPanel=localBox(d,-36,3.2,terminalZ+9.9,13,1.2,.16,signBlack);arrivalsPanel.name="airport-arrivals-sign";this.group.add(arrivalsPanel);addFacadeText(this.group,d,"ARRIVALS",-36,3.2,terminalZ+9.78,.64,signWhite,"airport-arrivals-text");
    for(const z of[terminalZ-5,terminalZ+5])for(const x of[-66,-60,-54,-48]){const seat=localBox(d,x,.47,z,2.5,.48,.78,seatMat,{cast:false});seat.name="airport-arrivals-annex-seat";this.group.add(seat);}

    // Airside lounge: carpet, structured seating, information boards and unobstructed sightlines to the gates/apron.
    const loungeCarpet=localBox(d,18,.185,terminalZ-5.3,83,.035,9.5,carpet,{cast:false});loungeCarpet.name="airport-departure-lounge-carpet";this.group.add(loungeCarpet);
    for(const z of[terminalZ-3.4,terminalZ-6.4])for(let x=-18;x<=56;x+=7){
      const base=localBox(d,x,.47,z,2.35,.48,.75,seatMat,{cast:false});base.name="airport-departure-seat";this.group.add(base);
      const back=localBox(d,x,.88,z+.32,2.35,.74,.16,seatMat,{cast:false});back.name="airport-departure-seat-back";this.group.add(back);
    }
    const fids=localBox(d,52,3.15,terminalZ-1.6,9.6,2.0,.16,displayMat);fids.name="airport-flight-information-display";this.group.add(fids);
    for(let row=0;row<5;row++)addLocalLine(this.group,d,[48.2,3.62-row*.31,terminalZ-1.72],[55.8,3.62-row*.31,terminalZ-1.72],.08,.035,basicMaterial(row===0?0x58b6e8:0xd7e3e8),"airport-fids-row");
    const routeBoard=localBox(d,40,3.12,terminalZ-1.6,12.5,1.55,.16,displayMat);routeBoard.name="airport-merehaven-route-board";this.group.add(routeBoard);addFacadeText(this.group,d,"MEREHAVEN",40,3.13,terminalZ-1.72,.48,signWhite,"airport-merehaven-route-text");
    const gatesPanel=localBox(d,15,3.72,terminalZ-8.2,12.5,.90,.16,signBlack);gatesPanel.name="airport-gates-direction-sign";this.group.add(gatesPanel);addFacadeText(this.group,d,"GATES 1-4",15,3.72,terminalZ-8.31,.48,signWhite,"airport-gates-direction-text");
    const railPanel=localBox(d,75,3.6,terminalZ+8.5,9.0,.90,.16,signBlack);railPanel.name="airport-rail-direction-sign";this.group.add(railPanel);addFacadeText(this.group,d,"RAIL",75,3.6,terminalZ+8.39,.50,signWhite,"airport-rail-direction-text");
    // Human-scale terminal details break up the old empty grey-box appearance.
    for(const x of[-28,-6,16,38,60]){
      const planter=localBox(d,x,.36,terminalZ-1.0,2.6,.70,1.2,material(0x6f756c,.86,.04));planter.name="airport-terminal-planter";this.group.add(planter);
      const plant=new THREE.Mesh(new THREE.SphereGeometry(.62,9,7),material(0x486d48,.94,.01));plant.position.copy(localPoint(d,x,.95,terminalZ-1.0));plant.scale.set(1,.8,1);plant.name="airport-terminal-plant";this.group.add(plant);
    }
    for(const x of[-25,-7,11,29,47,65]){const totem=localBox(d,x,1.35,terminalZ-9.2,.72,2.5,.42,displayMat);totem.name="airport-gate-information-totem";this.group.add(totem);}
    for(const [x,z] of[[66,terminalZ+5.8],[66,terminalZ+2.8],[-28,terminalZ+5.6]]){const vending=localBox(d,x,1.15,z,1.25,2.2,.72,material(0x5e686d,.62,.18));vending.name="airport-terminal-vending";this.group.add(vending);const face=localBox(d,x,1.45,z-.38,.82,1.28,.05,displayMat,{cast:false});face.name="airport-terminal-vending-display";this.group.add(face);}

    // Ceiling luminaires are emissive geometry rather than dozens of real lights.
    for(let x=-38;x<=78;x+=8)for(const z of[terminalZ-7.5,terminalZ,terminalZ+7.5]){const lum=localBox(d,x,5.02,z,3.4,.05,.42,warmLight,{cast:false});lum.name="airport-terminal-ceiling-light";this.group.add(lum);}
    for(const x of[-24,8,40,72]){const skylight=localBox(d,x,13.05,terminalZ,10,.12,4.4,glass,{cast:false});skylight.name="airport-terminal-skylight";this.group.add(skylight);}
    for(const x of[-38,-22,-6,10,26,42,58,74])for(const z of[terminalZ-8.8,terminalZ-2.1,terminalZ+4.8]){const col=localBox(d,x,2.55,z,.45,5.1,.45,terminalMat);col.name="airport-terminal-column";this.group.add(col);}
    for(let x=-42;x<=80;x+=6){const mullion=localBox(d,x,2.55,terminalZ-12,.16,5.1,.16,terminalMat,{cast:false});mullion.name="airport-terminal-airside-mullion";this.group.add(mullion);}
    for(let x=-42;x<=64;x+=6){const mullion=localBox(d,x,2.55,terminalZ+12,.16,5.1,.16,terminalMat,{cast:false});mullion.name="airport-terminal-landside-mullion";this.group.add(mullion);}
    const gateSpine=localBox(d,18,.205,terminalZ-9.35,83,.025,1.3,material(0xd8d1c4,.90,.01),{cast:false});gateSpine.name="airport-gate-concourse-spine";this.group.add(gateSpine);
    for(const x of[-12,0,12,24,36])for(const offset of[-2.0,2.0]){const stanchion=localBox(d,x+offset,.62,terminalZ+5.1,.12,1.15,.12,material(0xc6b270,.52,.32));stanchion.name="airport-queue-stanchion";this.group.add(stanchion);}

    // Passenger boarding bridges: fully enclosed, walkable ramps from the gate
    // portals to the actual forward aircraft door/cabin-floor height.
    const bridgeFloorMat=material(0x8b8d88,.84,.05),bridgeGlass=material(0x7c9aa5,.18,.18,{transparent:true,opacity:.42}),bridgeFrame=material(0x6b767b,.50,.26),bellowsMat=material(0x25292b,.86,.04);
    const addBridgeSegment=(standNo,a,b,width=2.45,wallHeight=2.32)=>{
      const aWorld=localPoint(d,a[0],a[1]-.06,a[2]),bWorld=localPoint(d,b[0],b[1]-.06,b[2]),floor=stripBetween(aWorld,bWorld,width,.12,bridgeFloorMat);floor.name=`airport-jetway-${standNo}-floor`;this.group.add(floor);
      const dx=b[0]-a[0],dz=b[2]-a[2],len=Math.max(.001,Math.hypot(dx,dz)),rx=dz/len,rz=-dx/len,half=width*.5;
      for(const side of[-1,1]){
        const oa=[a[0]+rx*half*side,a[1]+wallHeight*.5,a[2]+rz*half*side],ob=[b[0]+rx*half*side,b[1]+wallHeight*.5,b[2]+rz*half*side],wall=stripBetween(localPoint(d,...oa),localPoint(d,...ob),.10,wallHeight,bridgeGlass);wall.name=`airport-jetway-${standNo}-glass-wall`;this.group.add(wall);
        const rail=stripBetween(localPoint(d,a[0]+rx*(half-.08)*side,a[1]+.48,a[2]+rz*(half-.08)*side),localPoint(d,b[0]+rx*(half-.08)*side,b[1]+.48,b[2]+rz*(half-.08)*side),.06,.08,bridgeFrame);rail.name=`airport-jetway-${standNo}-knee-rail`;this.group.add(rail);
      }
      const roof=stripBetween(localPoint(d,a[0],a[1]+wallHeight,a[2]),localPoint(d,b[0],b[1]+wallHeight,b[2]),width+.08,.10,bridgeFrame);roof.name=`airport-jetway-${standNo}-roof`;this.group.add(roof);
      const centreStrip=stripBetween(localPoint(d,a[0],a[1]+wallHeight-.22,a[2]),localPoint(d,b[0],b[1]+wallHeight-.22,b[2]),.34,.06,warmLight);centreStrip.name=`airport-jetway-${standNo}-light-strip`;this.group.add(centreStrip);
      // Repeated portal frames give the bridge a telescoping, engineered rhythm
      // instead of reading as one long glass box.
      for(const t of[.08,.34,.60,.86]){
        const cx=THREE.MathUtils.lerp(a[0],b[0],t),cy=THREE.MathUtils.lerp(a[1],b[1],t),cz=THREE.MathUtils.lerp(a[2],b[2],t);
        for(const side of[-1,1]){const post=localBox(d,cx+rx*half*side,cy+wallHeight*.5,cz+rz*half*side,.12,wallHeight,.12,bridgeFrame);post.name=`airport-jetway-${standNo}-frame-post`;this.group.add(post);}
        const beam=stripBetween(localPoint(d,cx+rx*half,cy+wallHeight,cz+rz*half),localPoint(d,cx-rx*half,cy+wallHeight,cz-rz*half),.12,.12,bridgeFrame);beam.name=`airport-jetway-${standNo}-frame-beam`;this.group.add(beam);
      }
    };
    for(let i=0;i<gateXs.length;i++){
      const gateX=gateXs[i],standNo=i+1,aircraftDoorZ=standZ+AIRCRAFT_DOOR_LOCAL_Z,cabinFloorY=.18+1.15;
      // The rigid bridge cabin stops just outside the fuselage. A short flexible
      // docking interface then extends to the sill, matching real PBB practice.
      const aircraftDoorX=gateX-AIRCRAFT_DOOR_LOCAL_X,bridgeEndX=aircraftDoorX-.33,dockContactX=aircraftDoorX+.06;
      const points=[[gateX,terminalFloorY,terminalZ-11.70],[gateX,.46,terminalZ-15.10],[gateX-.28,.88,standZ+8.55],[bridgeEndX,cabinFloorY,aircraftDoorZ]];
      // Modern PBBs stop the rigid cab short and use a short sliding floor plus
      // flexible canopy to make the last contact. Keep that final extension
      // within roughly 0.4 m and overlap the sill slightly so no daylight gap
      // appears between bridge and fuselage.
      const dockFrom={x:bridgeEndX,y:cabinFloorY,z:aircraftDoorZ},dockTo={x:dockContactX,y:cabinFloorY,z:aircraftDoorZ};
      const aircraftDoorPoint={x:aircraftDoorX,y:cabinFloorY,z:aircraftDoorZ},cabinEntryPoint={x:gateX,y:cabinFloorY,z:aircraftDoorZ};
      const gateWalkway={gateIndex:i,standNo,halfWidth:1.12,points:points.map(point=>({x:point[0],y:point[1],z:point[2]})),dockFrom,dockTo,aircraftDoorPoint,cabinEntryPoint};this.gateWalkways.push(gateWalkway);
      for(let segment=0;segment<points.length-1;segment++){
        const a=points[segment],b=points[segment+1];addBridgeSegment(standNo,a,b);
        this.registerWalkSurface({type:"ramp",role:`gate-${standNo}-boarding-bridge`,gateIndex:i,from:{x:a[0],y:a[1],z:a[2]},to:{x:b[0],y:b[1],z:b[2]},halfWidth:gateWalkway.halfWidth,priority:5});
      }
      this.registerWalkSurface({type:"ramp",role:`gate-${standNo}-aircraft-dock`,gateIndex:i,requiresParkedAircraft:true,from:dockFrom,to:dockTo,halfWidth:.68,priority:8});
      const portalLeft=localBox(d,gateX-1.18,1.55,terminalZ-12.22,.14,3.0,.18,bridgeFrame);portalLeft.name=`airport-gate-${standNo}-portal-frame`;this.group.add(portalLeft);
      const portalRight=localBox(d,gateX+1.18,1.55,terminalZ-12.22,.14,3.0,.18,bridgeFrame);portalRight.name=`airport-gate-${standNo}-portal-frame`;this.group.add(portalRight);
      const portalTop=localBox(d,gateX,2.98,terminalZ-12.22,2.50,.14,.18,bridgeFrame);portalTop.name=`airport-gate-${standNo}-portal-lintel`;this.group.add(portalTop);
      const root=new THREE.Group();root.name=`airport-jetway-${standNo}-root`;this.group.add(root);
      const rootFloor=localBox(d,gateX,.30,terminalZ-13.65,3.9,.12,2.55,bridgeFloorMat,{cast:false});root.add(rootFloor);
      const rootRoof=localBox(d,gateX,2.58,terminalZ-13.65,3.95,.10,2.65,bridgeFrame);root.add(rootRoof);
      for(const side of[-1,1]){
        const wall=localBox(d,gateX+side*1.18,1.43,terminalZ-13.65,3.9,2.2,.10,bridgeGlass,{cast:false});wall.name=`airport-jetway-${standNo}-root-wall`;root.add(wall);
        const postA=localBox(d,gateX+side*1.18,1.25,terminalZ-12.45,.14,2.5,.14,bridgeFrame);root.add(postA);
        const postB=localBox(d,gateX+side*1.18,1.25,terminalZ-14.85,.14,2.5,.14,bridgeFrame);root.add(postB);
      }
      const cabinGroup=new THREE.Group();cabinGroup.name=`airport-jetway-${standNo}-cabin`;this.group.add(cabinGroup);
      const end=points.at(-1);
      // Flexible aircraft-mating section: the rigid cab remains clear of the
      // fuselage and a soft floor/canopy closes only the final ~0.2 m gap.
      const dockGroup=new THREE.Group();dockGroup.name=`airport-jetway-${standNo}-soft-dock`;this.group.add(dockGroup);gateWalkway.dockGroup=dockGroup;
      const dockFloor=stripBetween(localPoint(d,dockFrom.x,dockFrom.y-.035,dockFrom.z),localPoint(d,dockTo.x,dockTo.y-.035,dockTo.z),1.34,.08,bridgeFloorMat);dockFloor.name=`airport-jetway-${standNo}-sliding-floor`;dockGroup.add(dockFloor);
      for(const side of[-1,1]){
        const sideA=localPoint(d,dockFrom.x,dockFrom.y+.96,dockFrom.z+side*.61),sideB=localPoint(d,dockTo.x,dockTo.y+.96,dockTo.z+side*.61),bellows=stripBetween(sideA,sideB,.10,1.92,bellowsMat);bellows.name=`airport-jetway-${standNo}-soft-canopy-side`;dockGroup.add(bellows);
      }
      const canopyTop=stripBetween(localPoint(d,dockFrom.x,dockFrom.y+1.92,dockFrom.z),localPoint(d,dockTo.x,dockTo.y+1.92,dockTo.z),1.28,.12,bellowsMat);canopyTop.name=`airport-jetway-${standNo}-soft-canopy-top`;dockGroup.add(canopyTop);
      // Accordion ribs make the final section read as a compressible weather seal
      // instead of a solid rectangular tube intersecting the fuselage.
      for(const t of[.18,.38,.58,.78]){const x=THREE.MathUtils.lerp(dockFrom.x,dockTo.x,t);for(const side of[-1,1]){const rib=localBox(d,x,dockFrom.y+.96,dockFrom.z+side*.61,.045,1.94,.055,bridgeFrame,{cast:false});rib.name=`airport-jetway-${standNo}-bellows-rib`;dockGroup.add(rib);}const topRib=localBox(d,x,dockFrom.y+1.92,dockFrom.z,.045,.055,1.30,bridgeFrame,{cast:false});topRib.name=`airport-jetway-${standNo}-bellows-rib`;dockGroup.add(topRib);}
      for(const side of[-1,1]){const seal=localBox(d,dockTo.x,dockTo.y+.96,dockTo.z+side*.61,.10,1.92,.12,bellowsMat);seal.name=`airport-jetway-${standNo}-fuselage-seal`;dockGroup.add(seal);const bumper=localBox(d,dockTo.x+.035,dockTo.y+.72,dockTo.z+side*.57,.10,1.36,.10,material(0x16191a,.94,.01),{cast:false});bumper.name=`airport-jetway-${standNo}-rubber-bumper`;dockGroup.add(bumper);}
      const sealTop=localBox(d,dockTo.x,dockTo.y+1.92,dockTo.z,.10,.12,1.30,bellowsMat);sealTop.name=`airport-jetway-${standNo}-fuselage-seal`;dockGroup.add(sealTop);
      const thresholdPlate=stripBetween(localPoint(d,dockFrom.x-.03,dockFrom.y+.012,dockFrom.z),localPoint(d,dockTo.x+.16,dockTo.y+.012,dockTo.z),.88,.035,material(0xaeb4b5,.42,.42));thresholdPlate.name=`airport-jetway-${standNo}-threshold-plate`;dockGroup.add(thresholdPlate);
      const operatorPanel=localBox(d,dockFrom.x+.02,dockFrom.y+1.00,dockFrom.z+1.02,.28,.72,.34,bridgeFrame);operatorPanel.name=`airport-jetway-${standNo}-operator-panel`;cabinGroup.add(operatorPanel);
      const supportHeight=Math.max(.45,end[1]-.18),support=localBox(d,end[0],supportHeight*.5,end[2]+1.7,.55,supportHeight,.55,bridgeFrame);support.name=`airport-jetway-${standNo}-support`;this.group.add(support);
      const base=localBox(d,end[0],.30,end[2]+1.7,2.2,.40,1.35,bridgeFrame);base.name=`airport-jetway-${standNo}-wheel-base`;this.group.add(base);
      const podium=localBox(d,gateX+2.65,.72,terminalZ-9.7,2.0,1.35,1.0,counterMat);podium.name=`airport-gate-${standNo}-podium`;this.group.add(podium);this.registerWalkBlocker({name:podium.name,centreX:gateX+2.65,centreZ:terminalZ-9.7,halfX:1.0,halfZ:.5,minimumHeight:0,maximumHeight:1.5});
      const gatePanel=localBox(d,gateX,3.95,terminalZ-11.62,2.8,.78,.16,signBlack);gatePanel.name=`airport-gate-${standNo}-sign`;this.group.add(gatePanel);addFacadeText(this.group,d,`G${standNo}`,gateX,3.95,terminalZ-11.73,.48,signWhite,`airport-gate-${standNo}-lettering`);
      const gateHeader=localBox(d,gateX,3.12,terminalZ-12.20,2.65,.18,.34,terminalMat);gateHeader.name=`airport-gate-${standNo}-entrance-header`;this.group.add(gateHeader);
      const gateLight=localBox(d,gateX,2.86,terminalZ-12.30,1.45,.045,.18,warmLight,{cast:false});gateLight.name=`airport-gate-${standNo}-entrance-light`;this.group.add(gateLight);
      const thresholdStrip=localBox(d,gateX,.205,terminalZ-12.03,2.35,.025,.28,material(0xb8b1a2,.72,.10),{cast:false});thresholdStrip.name=`airport-gate-${standNo}-threshold`;this.group.add(thresholdStrip);
      addGroundDigit(this.group,d,String(standNo),gateX,terminalZ-13.3,.72,-1,marking,`airport-gate-${standNo}-number`);
    }
    // Control tower with narrow shaft, wider glazed cab, roof and antenna.
    const towerX=78,towerZ=terminalZ-5,towerShaft=new THREE.Mesh(new THREE.CylinderGeometry(3.3,4.2,21,10),terminalDark);towerShaft.position.copy(localPoint(d,towerX,10.5,towerZ));towerShaft.name="airport-control-tower-shaft";towerShaft.castShadow=true;this.group.add(towerShaft);
    const towerCab=new THREE.Mesh(new THREE.CylinderGeometry(6.4,5.2,4.8,8),glass);towerCab.position.copy(localPoint(d,towerX,23.1,towerZ));towerCab.rotation.y=Math.PI/8;towerCab.name="airport-control-tower-cab";towerCab.castShadow=true;this.group.add(towerCab);
    const towerRoof=new THREE.Mesh(new THREE.CylinderGeometry(6.8,6.8,.6,8),terminalDark);towerRoof.position.copy(localPoint(d,towerX,25.8,towerZ));towerRoof.rotation.y=Math.PI/8;towerRoof.name="airport-control-tower-roof";this.group.add(towerRoof);
    const antenna=new THREE.Mesh(new THREE.CylinderGeometry(.08,.08,5,8),fence);antenna.position.copy(localPoint(d,towerX,28.5,towerZ));antenna.name="airport-control-tower-antenna";this.group.add(antenna);
    const obstacleLight=new THREE.Mesh(new THREE.SphereGeometry(.12,7,5),redLight);obstacleLight.position.copy(localPoint(d,towerX,31.05,towerZ));obstacleLight.name="airport-control-tower-obstacle-light";this.group.add(obstacleLight);

    // Hangars remain in their current area but gain doors, segmented façades, roof ridges and vents.
    for(const [index,x] of[-82,-55].entries()){
      const hangar=localBox(d,x,6,terminalZ-5,24,12,36,terminalDark);hangar.name=`airport-hangar-${index+1}`;this.group.add(hangar);
      const doorMat=material(0x70797b,.70,.22),door=localBox(d,x,5.0,terminalZ-23.05,18,9.5,.22,doorMat);door.name=`airport-hangar-${index+1}-door`;this.group.add(door);
      for(let offset=-7;offset<=7;offset+=3.5)addLocalLine(this.group,d,[x+offset,.25,terminalZ-23.22],[x+offset,9.5,terminalZ-23.22],.11,.08,basicMaterial(0x474f52),`airport-hangar-${index+1}-door-seam`);
      const roofA=localBox(d,x,12.8,terminalZ-13,24,.55,19,terminalMat);roofA.rotation.z=.18;roofA.name=`airport-hangar-${index+1}-roof-a`;this.group.add(roofA);
      const roofB=localBox(d,x,12.8,terminalZ+3,24,.55,19,terminalMat);roofB.rotation.z=-.18;roofB.name=`airport-hangar-${index+1}-roof-b`;this.group.add(roofB);
      for(const ox of[-6,0,6]){const vent=new THREE.Mesh(new THREE.CylinderGeometry(.42,.42,1.1,10),fence);vent.position.copy(localPoint(d,x+ox,13.5,terminalZ-5));vent.name="airport-hangar-roof-vent";this.group.add(vent);}
      const hangarApron=localBox(d,x,.08,terminalZ-29,26,.12,12,concrete);hangarApron.name=`airport-hangar-${index+1}-apron`;this.group.add(hangarApron);
    }

    // Landside car park/access keep their original authored local footprint and road relationship.
    const carPark=localBox(d,18,.06,d.terminalOffset+27,100,.12,38,asphalt);carPark.name="airport-car-park";this.group.add(carPark);
    for(let x=-28;x<=64;x+=8)addLocalLine(this.group,d,[x,.13,d.terminalOffset+9],[x,.13,d.terminalOffset+45],.16,.02,marking,"airport-car-park-bay-line");
    const access=d.accessLocal??{x:-40,z:d.terminalOffset+20},accessA=localPoint(d,access.x,.04,access.z),accessB=localPoint(d,18,.04,d.terminalOffset+27),accessRoad=stripBetween(accessA,accessB,10,.14,asphalt);accessRoad.name="airport-public-access-road";this.group.add(accessRoad);

    // Floodlights, windsock and compact navigation/airside identity details.
    for(const x of[-45,15,72]){
      const mast=localBox(d,x,5.5,d.terminalOffset-6,.22,11,.22,fence);mast.name="airport-apron-floodlight-mast";this.group.add(mast);
      const head=localBox(d,x,11.1,d.terminalOffset-6,2.8,.45,.8,lampHousing);head.name="airport-apron-floodlight-head";this.group.add(head);
    }
    const windX=112,windZ=22,windPole=localBox(d,windX,4.2,windZ,.18,8.4,.18,fence);windPole.name="airport-windsock-pole";this.group.add(windPole);
    const windsock=new THREE.Mesh(new THREE.ConeGeometry(.72,3.0,10,1,true),material(0xf07d32,.62,.04,{side:THREE.DoubleSide}));windsock.rotation.z=-Math.PI/2;windsock.position.copy(localPoint(d,windX+1.5,7.9,windZ));windsock.name="airport-windsock";this.group.add(windsock);
    const localiser=localBox(d,runwayHalf+13,.7,0,1.2,1.2,5.6,terminalDark);localiser.name="airport-navigation-equipment";this.group.add(localiser);

    // Taxiway information/mandatory signs at both runway entries.
    for(const {x,name} of connectorDefs){
      const panel=localBox(d,x-8,1.0,holdZ+4,5.2,1.35,.34,signRed);panel.name=`airport-runway-hold-sign-${name}`;this.group.add(panel);addFacadeText(this.group,d,"09-27",x-8,1.0,holdZ+3.80,.72,signWhite,`airport-runway-hold-sign-${name}-text`);
      const loc=localBox(d,x+8,1.0,holdZ+4,2.6,1.35,.34,signBlack);loc.name=`airport-taxiway-location-sign-${name}`;this.group.add(loc);addFacadeText(this.group,d,name,x+8,1.0,holdZ+3.80,.82,signYellow,`airport-taxiway-location-sign-${name}-text`);
      const yellowCap=localBox(d,x+8,1.65,holdZ+4,2.8,.16,.42,signYellow);yellowCap.name=`airport-taxiway-location-sign-${name}-cap`;this.group.add(yellowCap);
    }

    // Perimeter security fence with a visual access gate; logical restricted-area behaviour is intentionally unchanged.
    const fencePostPositions=[],gateHalf=10;
    for(let x=-d.perimeterHalfW;x<=d.perimeterHalfW;x+=10)for(const z of[-d.perimeterHalfD,d.perimeterHalfD]){
      if(z===d.perimeterHalfD&&Math.abs(x-access.x)<gateHalf)continue;fencePostPositions.push([x,z]);
    }
    for(let z=-d.perimeterHalfD+10;z<=d.perimeterHalfD-10;z+=10)for(const x of[-d.perimeterHalfW,d.perimeterHalfW])fencePostPositions.push([x,z]);
    const posts=new THREE.InstancedMesh(boxGeometry(.13,2.35,.13),fence,fencePostPositions.length);let postIndex=0;for(const [x,z] of fencePostPositions){dummy.position.copy(localPoint(d,x,1.17,z));dummy.updateMatrix();posts.setMatrixAt(postIndex++,dummy.matrix);}posts.instanceMatrix.needsUpdate=true;posts.name="airport-perimeter-fence-posts";this.group.add(posts);
    for(const z of[-d.perimeterHalfD,d.perimeterHalfD]){
      const isGateSide=z===d.perimeterHalfD;if(isGateSide){addLocalLine(this.group,d,[-d.perimeterHalfW,1.2,z],[access.x-gateHalf,1.2,z],.08,.08,fence,"airport-perimeter-fence-rail");addLocalLine(this.group,d,[access.x+gateHalf,1.2,z],[d.perimeterHalfW,1.2,z],.08,.08,fence,"airport-perimeter-fence-rail");}
      else addLocalLine(this.group,d,[-d.perimeterHalfW,1.2,z],[d.perimeterHalfW,1.2,z],.08,.08,fence,"airport-perimeter-fence-rail");
    }
    for(const x of[-d.perimeterHalfW,d.perimeterHalfW])addLocalLine(this.group,d,[x,1.2,-d.perimeterHalfD],[x,1.2,d.perimeterHalfD],.08,.08,fence,"airport-perimeter-fence-rail");
    for(const gx of[access.x-gateHalf,access.x+gateHalf]){const gatePost=localBox(d,gx,1.4,d.perimeterHalfD,.26,2.8,.26,fence);gatePost.name="airport-security-gate-post";this.group.add(gatePost);}
  }

  buildIslandDestination(){
    const d=this.islandDefinition;if(!d)return;const detail=new THREE.Group();detail.name="merehaven-high-detail";this.islandGroup.add(detail);this.islandDetailGroup=detail;
    const landMat=material(0x536c43,.99,0),shoreMat=material(0xb8a77f,.98,0),rockMat=material(0x65645d,.98,.01),fieldMats=[material(0x66804a,.99,0),material(0x798b4f,.99,0),material(0x8a8247,.99,0),material(0x54733f,.99,0)];
    const coastline=[[-680,-80],[-625,-320],[-470,-500],[-210,-575],[70,-560],[330,-500],[570,-350],[690,-105],[650,145],[530,390],[290,545],[20,585],[-250,555],[-500,430],[-645,230]];
    const makeCoastShape=(scale=1)=>{const shape=new THREE.Shape();coastline.forEach(([x,z],i)=>{const p=localPoint(d,x*scale,0,z*scale);if(i)shape.lineTo(p.x,-p.z);else shape.moveTo(p.x,-p.z);});shape.closePath();return shape;};
    const beach=new THREE.Mesh(new THREE.ShapeGeometry(makeCoastShape(1.035)),shoreMat);beach.rotation.x=-Math.PI/2;beach.position.y=-.18;beach.receiveShadow=true;beach.name="merehaven-beach-rim";this.islandGroup.add(beach);
    const island=new THREE.Mesh(new THREE.ShapeGeometry(makeCoastShape(1)),landMat);island.rotation.x=-Math.PI/2;island.position.y=-.085;island.receiveShadow=true;island.name="merehaven-island-land";this.islandGroup.add(island);this.islandLandMeshes=[beach,island];
    // Low-poly rocky western shore and modest central ridge give the island a recognisable silhouette before detail streams in.
    for(const [x,z,w,dep,h] of[[-615,-230,90,28,8],[-646,-60,72,32,11],[-610,150,92,34,7],[120,330,210,120,13],[260,275,155,95,9]]){const rock=localBox(d,x,h*.5-.05,z,w,h,dep,rockMat);rock.name="merehaven-rock-or-ridge";detail.add(rock);}
    // Agricultural patchwork. These deliberately vary in size and offset instead of forming a perfect grid.
    const fields=[[-505,-365,210,115,0],[-270,-410,185,92,1],[80,-410,230,105,2],[385,-355,205,118,3],[-520,-160,175,105,1],[480,-120,210,95,0],[-520,105,200,120,3],[485,145,180,125,2],[-440,345,230,110,2],[-155,420,250,100,0],[390,365,220,120,1],[205,-270,160,86,3]];
    for(const [index,[x,z,w,dep,mi]] of fields.entries()){
      const patch=localBox(d,x,-.045,z,w,.035,dep,fieldMats[mi],{cast:false});patch.name=`merehaven-field-${index+1}`;detail.add(patch);
      const hedgeMat=material(index%3===0?0x355331:0x3f5d37,1,0),halfW=w*.5,halfD=dep*.5;
      addLocalLine(detail,d,[x-halfW,.42,z-halfD],[x+halfW,.42,z-halfD],.48,.65,hedgeMat,"merehaven-field-hedge");
      addLocalLine(detail,d,[x-halfW,.42,z+halfD],[x+halfW,.42,z+halfD],.48,.65,hedgeMat,"merehaven-field-hedge");
      if(index%2===0)addLocalLine(detail,d,[x-halfW,.42,z-halfD],[x-halfW,.42,z+halfD],.48,.65,hedgeMat,"merehaven-field-hedge");
    }
    const trackMat=material(0x8a775a,.98,0);for(const [a,b] of[[[-560,.01,255],[-305,.01,300]],[[310,.01,430],[560,.01,215]],[[-420,.01,-285],[-260,.01,-180]],[[250,.01,-360],[490,.01,-270]]]){const track=stripBetween(localPoint(d,...a),localPoint(d,...b),5.4,.05,trackMat);track.name="merehaven-farm-track";detail.add(track);}
    // Farm clusters, silos, hay bales and machinery.
    const barnMat=material(0x74533c,.9,.04),roofMat=material(0x51595a,.82,.12),metalMat=material(0x6f7b78,.72,.22),hayMat=material(0xb89d57,.96,0);
    for(const [x,z] of[[-410,265],[365,-285]]){
      const barn=localBox(d,x,4.0,z,28,8,16,barnMat);barn.name="merehaven-barn";detail.add(barn);const roof=localBox(d,x,8.45,z,30,.6,18,roofMat);roof.rotation.z=.08;roof.name="merehaven-barn-roof";detail.add(roof);
      const silo=new THREE.Mesh(new THREE.CylinderGeometry(4.2,4.2,11,14),metalMat);silo.position.copy(localPoint(d,x+22,5.5,z+7));silo.name="merehaven-silo";detail.add(silo);
      for(let i=0;i<5;i++){const bale=new THREE.Mesh(new THREE.CylinderGeometry(1.3,1.3,1.4,12),hayMat);bale.rotation.z=Math.PI/2;bale.position.copy(localPoint(d,x-15+i*4,1.3,z+18+(i%2)*3));bale.name="merehaven-hay-bale";detail.add(bale);}
      const tractor=localBox(d,x-8,1.25,z-18,4.8,2.3,2.6,material(0x466c3b,.72,.08));tractor.name="merehaven-tractor";detail.add(tractor);
    }
    // Lightweight sheep/cattle markers, grouped near field edges rather than scattered across the airport.
    const animalMat=material(0xe4dfcf,.96,0),animalDark=material(0x5c4939,.96,0);for(let i=0;i<24;i++){const base=i<14?[-455,55]:[430,250],x=base[0]+((i*37)%115)-55,z=base[1]+((i*53)%75)-35,body=localBox(d,x,.62,z,1.5,.9,.65,i%5===0?animalDark:animalMat);body.name="merehaven-livestock";detail.add(body);}
    this.buildIslandAirport(detail,d);
    this.islandDetailGroup.visible=false;this.updateIslandVisibility();
  }

  buildIslandAirport(group,d){
    const asphalt=material(0x2b3032,.97,.01),shoulder=material(0x424849,.98,.01),taxi=material(0x363c3d,.96,.02),concrete=material(0x85847e,.94,.03),terminalMat=material(0x9caaa8,.72,.09),terminalDark=material(0x5e696b,.68,.16),glass=material(0x668894,.18,.22,{transparent:true,opacity:.62}),marking=basicMaterial(0xf2f0df),yellow=basicMaterial(0xe3c349),fence=material(0x515b5e,.72,.3),red=material(0xb84b43,.84,.04),white=basicMaterial(0xf5f1df),runwayHalf=d.runway.length*.5,standZ=d.terminalOffset-28,holdZ=d.runway.width*.5+12;
    const movement=localBox(d,0,-.03,8,d.runway.length+70,.10,145,material(0x587049,1,0),{cast:false});movement.name="merehaven-airfield-grass";group.add(movement);
    const runwayShoulder=localBox(d,0,.005,0,d.runway.length+5,.10,d.runway.width+5,shoulder,{cast:false});group.add(runwayShoulder);const runway=localBox(d,0,.09,0,d.runway.length,.18,d.runway.width,asphalt);runway.name="merehaven-runway";group.add(runway);
    for(let x=-runwayHalf+38;x<=runwayHalf-38;x+=24){const stripe=localBox(d,x,.205,0,13,.018,.68,marking,{cast:false});stripe.name="merehaven-runway-centreline";group.add(stripe);}for(const z of[-d.runway.width*.5+.42,d.runway.width*.5-.42])addLocalLine(group,d,[-runwayHalf,.205,z],[runwayHalf,.205,z],.58,.018,marking,"merehaven-runway-edge");
    const designators=runwayDesignators(d);for(const side of[-1,1]){for(let i=0;i<7;i++){const z=-10.2+i*3.4,bar=localBox(d,side*(runwayHalf-13),.21,z,9,.02,1.25,marking,{cast:false});bar.name="merehaven-threshold";group.add(bar);}addRunwayDesignation(group,d,side<0?designators[0]:designators[1],side*(runwayHalf-29),-side,marking,"merehaven-runway-designator");}
    const taxiway=localBox(d,0,.105,d.taxiwayOffset,d.runway.length*.78,.15,14,taxi);taxiway.name="merehaven-taxiway";group.add(taxiway);addLocalLine(group,d,[-d.runway.length*.39,.19,d.taxiwayOffset],[d.runway.length*.39,.19,d.taxiwayOffset],.32,.02,yellow,"merehaven-taxi-centreline");
    for(const x of[-d.runway.length*.30,d.runway.length*.28]){const connector=stripBetween(localPoint(d,x,.10,d.taxiwayOffset),localPoint(d,x,.10,8),13,.14,taxi);connector.name="merehaven-runway-connector";group.add(connector);for(const offset of[0,1.0])addLocalLine(group,d,[x-6,.22,holdZ+offset],[x+6,.22,holdZ+offset],.35,.02,yellow,"merehaven-hold-short");}
    const apron=localBox(d,0,.09,d.terminalOffset-34,132,.16,62,concrete);apron.name="merehaven-apron";group.add(apron);
    this.islandStandLocalZ=standZ;this.islandStandXs=[-42,-14,14,42];for(let i=0;i<this.islandStandXs.length;i++){const x=this.islandStandXs[i];addLocalLine(group,d,[x,.20,standZ+18],[x,.20,standZ-8],.30,.02,yellow,"merehaven-stand-centreline");addStandNumber(group,d,i+1,x,standZ+13,white);}
    // Compact ground-level terminal with a distinct landside hall and airside waiting room.
    const terminalZ=d.terminalOffset,terminalFloor=localBox(d,0,.12,terminalZ,128,.18,30,concrete);terminalFloor.name="merehaven-terminal-floor";group.add(terminalFloor);this.registerWalkSurface({airportDef:d,type:"flat",role:"merehaven-terminal",centreX:0,centreZ:terminalZ,halfX:64,halfZ:15,height:.21,priority:3});
    const rear=localBox(d,0,3.2,terminalZ+14.2,128,6.2,1.2,terminalMat);rear.name="merehaven-terminal-rear-wall";group.add(rear);this.registerWalkBlocker({airportDef:d,name:rear.name,centreX:0,centreZ:terminalZ+14.2,halfX:64,halfZ:.6,minimumHeight:0,maximumHeight:6.3});
    // Airside wall is split around two broad passenger doors so the terminal is genuinely traversable.
    for(const [cx,w] of[[-42,38],[0,24],[42,38]]){const wall=localBox(d,cx,3.2,terminalZ-14.2,w,6.2,1.2,terminalMat);wall.name="merehaven-terminal-airside-wall";group.add(wall);this.registerWalkBlocker({airportDef:d,name:wall.name,centreX:cx,centreZ:terminalZ-14.2,halfX:w*.5,halfZ:.6,minimumHeight:0,maximumHeight:6.3});}
    for(const x of[-63,63]){const side=localBox(d,x,3.2,terminalZ,1.2,6.2,30,terminalMat);side.name="merehaven-terminal-side-wall";group.add(side);this.registerWalkBlocker({airportDef:d,name:side.name,centreX:x,centreZ:terminalZ,halfX:.6,halfZ:15,minimumHeight:0,maximumHeight:6.3});}
    const roof=localBox(d,0,6.45,terminalZ,130,.45,32,terminalDark);roof.name="merehaven-terminal-roof";group.add(roof);for(const x of[-52,-26,0,26,52]){const pane=localBox(d,x,3.3,terminalZ+14.82,20,4.1,.10,glass,{cast:false});pane.name="merehaven-terminal-glazing";group.add(pane);}
    addFacadeText(group,d,"MEREHAVEN",0,5.05,terminalZ+15.02,1.05,white,"merehaven-terminal-name");
    // Interior furniture and destination board.
    const seatMat=material(0x425965,.74,.12),counterMat=material(0x75685b,.82,.05),boardMat=basicMaterial(0x142731);for(const z of[terminalZ-5,terminalZ+4])for(const x of[-44,-30,-16,16,30,44]){const seat=localBox(d,x,.64,z,3.1,1.0,1.3,seatMat);seat.name="merehaven-terminal-seat";group.add(seat);}
    const checkin=localBox(d,-38,1.0,terminalZ+8,22,1.8,2.2,counterMat);checkin.name="merehaven-checkin";group.add(checkin);this.registerWalkBlocker({airportDef:d,name:checkin.name,centreX:-38,centreZ:terminalZ+8,halfX:11,halfZ:1.1,minimumHeight:0,maximumHeight:1.9});
    const cafe=localBox(d,38,1.1,terminalZ+8,20,2.0,2.4,counterMat);cafe.name="merehaven-cafe";group.add(cafe);this.registerWalkBlocker({airportDef:d,name:cafe.name,centreX:38,centreZ:terminalZ+8,halfX:10,halfZ:1.2,minimumHeight:0,maximumHeight:2.1});
    const board=localBox(d,0,4.2,terminalZ-13.45,24,1.6,.12,boardMat);board.name="merehaven-departure-board";group.add(board);addFacadeText(group,d,"EASTMERE",0,4.25,terminalZ-13.54,.62,white,"merehaven-departure-text");
    // Operations/watch room, fire station, hangar, fuel/service corner and car park.
    const ops=localBox(d,80,4.0,terminalZ-1,18,8,17,terminalDark);ops.name="merehaven-operations";group.add(ops);const fire=localBox(d,-92,3.2,terminalZ+7,28,6.4,20,red);fire.name="merehaven-fire-station";group.add(fire);const hangar=localBox(d,102,4.2,terminalZ-50,34,8.4,30,terminalDark);hangar.name="merehaven-hangar";group.add(hangar);
    const carPark=localBox(d,0,.045,terminalZ+42,104,.08,38,asphalt);carPark.name="merehaven-car-park";group.add(carPark);for(let x=-45;x<=45;x+=9)addLocalLine(group,d,[x,.10,terminalZ+25],[x,.10,terminalZ+59],.14,.015,marking,"merehaven-parking-bay");
    const access=stripBetween(localPoint(d,-74,.03,terminalZ+42),localPoint(d,-180,.03,terminalZ+95),9,.10,asphalt);access.name="merehaven-access-road";group.add(access);
    // Windsock and two small wind turbines reinforce the exposed island setting.
    const windsockPole=localBox(d,122,4.2,28,.16,8.4,.16,fence);windsockPole.name="merehaven-windsock-pole";group.add(windsockPole);const sock=localBox(d,125.2,7.9,28,6.5,.55,.55,material(0xe28d45,.82,.01));sock.name="merehaven-windsock";group.add(sock);
    for(const [x,z] of[[470,460],[535,405]]){const tower=localBox(d,x,18,z,.75,36,.75,terminalMat);tower.name="merehaven-wind-turbine";group.add(tower);const hub=new THREE.Mesh(new THREE.SphereGeometry(1.2,10,8),terminalDark);hub.position.copy(localPoint(d,x,36,z));group.add(hub);for(const angle of[0,Math.PI*2/3,Math.PI*4/3]){const blade=localBox(d,x+Math.cos(angle)*7,36+Math.sin(angle)*7,z,13,.25,.8,terminalMat);blade.rotation.z=angle;blade.name="merehaven-wind-blade";group.add(blade);}}
    // Perimeter fence, kept outside the movement area and interrupted on the landside road.
    for(const z of[-d.perimeterHalfD,d.perimeterHalfD])addLocalLine(group,d,[-d.perimeterHalfW,1.0,z],[d.perimeterHalfW,1.0,z],.07,.07,fence,"merehaven-perimeter-fence");for(const x of[-d.perimeterHalfW,d.perimeterHalfW])addLocalLine(group,d,[x,1.0,-d.perimeterHalfD],[x,1.0,d.perimeterHalfD],.07,.07,fence,"merehaven-perimeter-fence");
    // Fixed passenger stairs at each apron stand. They become visible only while an aircraft is parked/boarding there.
    for(let stand=0;stand<this.islandStandXs.length;stand++)this.buildIslandStairs(group,d,stand);
  }

  buildIslandStairs(group,d,standIndex){
    const standX=this.islandStandXs[standIndex],parked=localPoint(d,standX,.18,this.islandStandLocalZ),yaw=d.heading+Math.PI/2,worldFromAircraft=(lx,y,lz)=>new THREE.Vector3(parked.x+lx*Math.cos(yaw)+lz*Math.sin(yaw),y,parked.z-lx*Math.sin(yaw)+lz*Math.cos(yaw));
    const top=worldFromAircraft(AIRCRAFT_DOOR_LOCAL_X+.28,.18+(1.15),AIRCRAFT_DOOR_LOCAL_Z),bottom=worldFromAircraft(AIRCRAFT_DOOR_LOCAL_X+5.9,.18,AIRCRAFT_DOOR_LOCAL_Z),stairsGroup=new THREE.Group();stairsGroup.name=`merehaven-stand-${standIndex+1}-stairs`;group.add(stairsGroup);
    const frame=material(0x737b7d,.62,.24),tread=material(0x9a9a91,.88,.06);const ramp=stripBetween(top,bottom,1.35,.14,tread);ramp.name="merehaven-passenger-stair-ramp";stairsGroup.add(ramp);for(let i=0;i<7;i++){const t=i/6,p=top.clone().lerp(bottom,t),step=box(1.45,.10,.72,tread);step.position.copy(p);step.rotation.y=yaw;step.name="merehaven-passenger-stair-step";stairsGroup.add(step);}for(const side of[-1,1]){const a=top.clone().add(new THREE.Vector3(Math.cos(yaw)*0+Math.sin(yaw)*0,0,0)),rail=stripBetween(top.clone().add(new THREE.Vector3(0,.78,0)),bottom.clone().add(new THREE.Vector3(0,.78,0)),.08,.12,frame);const normal=new THREE.Vector3(Math.cos(yaw),0,-Math.sin(yaw)).multiplyScalar(side*.72);rail.position.add(normal);rail.name="merehaven-stair-handrail";stairsGroup.add(rail);}
    const topLocal=this.worldToAirportLocalFor(d,top),bottomLocal=this.worldToAirportLocalFor(d,bottom);this.registerWalkSurface({airportDef:d,type:"ramp",role:`merehaven-stand-${standIndex+1}-stairs`,standIndex,requiresIslandAircraft:true,from:{x:topLocal.x,y:top.y,z:topLocal.z},to:{x:bottomLocal.x,y:bottom.y,z:bottomLocal.z},halfWidth:.69,priority:9});
    this.islandStairs.push({standIndex,group:stairsGroup});stairsGroup.visible=false;
  }

  updateIslandVisibility(){
    if(!this.islandDefinition||!this.islandGroup)return;const focus=this.chunkManager?.focus??this.camera?.position??new THREE.Vector3(this.definition.x,0,this.definition.z),distance=Math.hypot(focus.x-this.islandDefinition.x,focus.z-this.islandDefinition.z),island=this.islandDefinition.island??{};const low=island.lowDetailDistance??7200,detail=island.detailDistance??3200;
    for(const mesh of this.islandLandMeshes??[])mesh.visible=distance<=low;this.islandDetailGroup&&(this.islandDetailGroup.visible=distance<=detail);
  }

  freezeIslandStaticGroup(){this.islandGroup?.traverse(object=>{if(object===this.islandGroup||object===this.islandDetailGroup)return;object.updateMatrix();object.matrixAutoUpdate=false;});}

  registerWalkSurface(surface){if(!surface.airportDef)surface.airportDef=this.definition;this.walkSurfaces.push(surface);return surface;}
  registerWalkBlocker(blocker){if(!blocker.airportDef)blocker.airportDef=this.definition;this.walkBlockers.push(blocker);return blocker;}

  worldToAirportLocalFor(def,position){const dx=position.x-def.x,dz=position.z-def.z,forwardX=Math.sin(def.heading),forwardZ=Math.cos(def.heading),rightX=forwardZ,rightZ=-forwardX;return{x:dx*forwardX+dz*forwardZ,z:dx*rightX+dz*rightZ};}
  worldToAirportLocal(position){return this.worldToAirportLocalFor(this.definition,position);}

  walkBlockerAtLocal(local,currentFeetY=0,bodyHeight=1.72,padding=.20,airportDef=this.definition){
    const bodyTop=currentFeetY+bodyHeight;
    for(const blocker of this.walkBlockers){
      if((blocker.airportDef??this.definition)!==airportDef)continue;
      const minimumHeight=blocker.minimumHeight??0,maximumHeight=blocker.maximumHeight??Infinity;
      if(bodyTop<=minimumHeight+.01||currentFeetY>=maximumHeight-.01)continue;
      if(Math.abs(local.x-blocker.centreX)<=blocker.halfX+padding&&Math.abs(local.z-blocker.centreZ)<=blocker.halfZ+padding)return blocker;
    }
    return null;
  }

  sampleLocalWalkSurface(surface,local){
    if(surface.type==="flat"){
      if(Math.abs(local.x-surface.centreX)>surface.halfX||Math.abs(local.z-surface.centreZ)>surface.halfZ)return null;
      return{surface,height:surface.height,alpha:.5};
    }
    if(surface.type==="ramp"){
      const dx=surface.to.x-surface.from.x,dz=surface.to.z-surface.from.z,lengthSq=dx*dx+dz*dz;if(lengthSq<1e-6)return null;
      const alpha=((local.x-surface.from.x)*dx+(local.z-surface.from.z)*dz)/lengthSq;if(alpha<-.02||alpha>1.02)return null;
      const t=THREE.MathUtils.clamp(alpha,0,1),px=surface.from.x+dx*t,pz=surface.from.z+dz*t,perp=Math.hypot(local.x-px,local.z-pz);
      if(perp>surface.halfWidth)return null;return{surface,height:THREE.MathUtils.lerp(surface.from.y,surface.to.y,t),alpha:t,perp};
    }
    return null;
  }

  sampleRampWall(surface,local,wallBand=.24){
    if(surface.type!=="ramp")return null;const dx=surface.to.x-surface.from.x,dz=surface.to.z-surface.from.z,lengthSq=dx*dx+dz*dz;if(lengthSq<1e-6)return null;
    const alpha=((local.x-surface.from.x)*dx+(local.z-surface.from.z)*dz)/lengthSq;if(alpha<0||alpha>1)return null;
    const px=surface.from.x+dx*alpha,pz=surface.from.z+dz*alpha,perp=Math.hypot(local.x-px,local.z-pz);
    return perp>surface.halfWidth&&perp<=surface.halfWidth+wallBand?{surface,alpha,perp}:null;
  }

  aircraftLocalPosition(aircraft,position){
    const dx=position.x-aircraft.mesh.position.x,dz=position.z-aircraft.mesh.position.z,yaw=aircraft.heading??aircraft.mesh.rotation.y,c=Math.cos(yaw),s=Math.sin(yaw);
    return{x:dx*c-dz*s,z:dx*s+dz*c};
  }

  aircraftWalkSample(aircraft,position,currentFeetY=0){
    if(!SERVICE_STATES.has(aircraft.state))return null;
    const local=this.aircraftLocalPosition(aircraft,position),floor=aircraft.mesh.position.y+(aircraft.mesh.userData.cabinFloorY??1.15),zMin=aircraft.mesh.userData.cabinMinZ??-4.55,zMax=aircraft.mesh.userData.cabinMaxZ??4.55;
    const inEnvelope=Math.abs(local.x)<=1.46&&local.z>=zMin-.35&&local.z<=zMax+.38;if(!inEnvelope)return null;
    const cockpit=local.z>=4.72&&local.z<=5.98&&Math.abs(local.x)<=.78,aisle=local.z>=zMin&&local.z<=Math.min(zMax,4.82)&&Math.abs(local.x)<=.34,vestibule=local.z>=3.35&&local.z<=4.90&&local.x>=-.44&&local.x<=1.40;
    if(aisle||vestibule||cockpit)return{height:floor,blocked:false,active:true,airport:true,role:cockpit?"aircraft-cockpit":"aircraft-cabin",aircraftId:aircraft.id,surface:{role:"aircraft-cabin",aircraftId:aircraft.id}};
    if(currentFeetY<floor+2.0&&currentFeetY+1.72>floor-.55)return{height:currentFeetY,blocked:true,active:true,airport:true,role:"aircraft-cabin-shell",aircraftId:aircraft.id,reason:"aircraft-interior",surface:null};
    return null;
  }

  parkedAircraftAtGate(gateIndex){return this.aircraft.find(aircraft=>aircraft.currentAirportId===this.definition.id&&aircraft.standIndex===gateIndex&&SERVICE_STATES.has(aircraft.state))??null;}
  openAircraftAtGate(gateIndex){const aircraft=this.parkedAircraftAtGate(gateIndex);return aircraft?.doorsOpen?aircraft:null;}
  aircraftAtIslandStand(standIndex){return this.aircraft.find(aircraft=>aircraft.currentAirportId===this.islandDefinition?.id&&aircraft.standIndex===standIndex&&SERVICE_STATES.has(aircraft.state))??null;}
  updateGateDockVisibility(){for(const gate of this.gateWalkways)if(gate.dockGroup)gate.dockGroup.visible=Boolean(this.openAircraftAtGate(gate.gateIndex));for(const stairs of this.islandStairs)stairs.group.visible=Boolean(this.aircraftAtIslandStand(stairs.standIndex));}

  resolveWalkSurface(position,currentFeetY=0,{maxStepUp=.58,maxStepDown=.92,bodyHeight=1.72}={}){
    let globalBest=null,globalPriority=-Infinity,globalDelta=Infinity,nearest=null,nearestDelta=Infinity,wallHit=null;
    for(const airportDef of this.airportDefinitions){
      const local=this.worldToAirportLocalFor(airportDef,position),blocker=this.walkBlockerAtLocal(local,currentFeetY,bodyHeight,.20,airportDef);if(blocker)return{height:currentFeetY,blocked:true,active:true,airport:true,blocker,reason:"airport-structure",surface:null};
      for(const surface of this.walkSurfaces){
        if((surface.airportDef??this.definition)!==airportDef)continue;
        if(surface.requiresParkedAircraft&&!this.openAircraftAtGate(surface.gateIndex))continue;
        if(surface.requiresIslandAircraft&&!this.aircraftAtIslandStand(surface.standIndex))continue;
        const hit=this.sampleLocalWalkSurface(surface,local);
        if(hit){const delta=hit.height-currentFeetY,absoluteDelta=Math.abs(delta);if(absoluteDelta<nearestDelta){nearest=hit;nearestDelta=absoluteDelta;}if(delta<=maxStepUp&&delta>=-maxStepDown){const priority=surface.priority??1;if(!globalBest||priority>globalPriority||(priority===globalPriority&&absoluteDelta<globalDelta)){globalBest=hit;globalPriority=priority;globalDelta=absoluteDelta;}}continue;}
        const wall=this.sampleRampWall(surface,local);if(wall&&!wallHit)wallHit=wall;
      }
      if(airportDef===this.definition){for(const gate of this.gateWalkways){const end=gate.points.at(-1),previous=gate.points.at(-2),dx=end.x-previous.x,dz=end.z-previous.z,len=Math.max(.001,Math.hypot(dx,dz)),fx=dx/len,fz=dz/len,rx=fz,rz=-fx,relX=local.x-end.x,relZ=local.z-end.z,along=relX*fx+relZ*fz,across=Math.abs(relX*rx+relZ*rz);if(!this.openAircraftAtGate(gate.gateIndex)&&along>=-.12&&along<=.35&&across<=gate.halfWidth+.22)return{height:currentFeetY,blocked:true,active:true,airport:true,reason:"closed-gate-end",surface:null};}}
    }
    if(globalBest)return{height:globalBest.height,blocked:false,active:true,airport:true,surface:globalBest.surface,role:globalBest.surface.role};
    for(const aircraft of this.aircraft){const sample=this.aircraftWalkSample(aircraft,position,currentFeetY);if(sample)return sample;}
    if(nearest)return{height:currentFeetY,blocked:true,active:true,airport:true,surface:nearest.surface,reason:"unreachable-height"};if(wallHit)return{height:currentFeetY,blocked:true,active:true,airport:true,reason:"boarding-bridge-wall",surface:wallHit.surface};return null;
  }

  isPlayerInsideAircraft(player,aircraft){
    if(!player||player.inVehicle||player.inTrain||player.inBus||!player.camera)return false;
    const feetY=player.camera.position.y-1.72,floor=aircraft.mesh.position.y+(aircraft.mesh.userData.cabinFloorY??1.15);if(Math.abs(feetY-floor)>.65)return false;
    const local=this.aircraftLocalPosition(aircraft,player.camera.position),zMin=aircraft.mesh.userData.cabinMinZ??-4.55,zMax=aircraft.mesh.userData.cabinMaxZ??4.55;
    return local.z>=zMin&&local.z<=zMax&&(Math.abs(local.x)<=.44||(local.z>=3.35&&local.z<=4.90&&local.x<=1.40&&local.x>=-.44)||(local.z>=4.72&&Math.abs(local.x)<=.80));
  }

  attachPassenger(player,aircraft){
    if(!player||!aircraft||player.inVehicle||player.inTrain||player.inBus||this.passengerState)return false;
    aircraft.mesh.updateWorldMatrix(true,false);const localEye=aircraft.mesh.worldToLocal(this._passengerLocal.copy(player.camera.position)),data=aircraft.mesh.userData,floor=data.cabinFloorY??1.15;
    const localPosition=new THREE.Vector3(THREE.MathUtils.clamp(localEye.x,-.32,.32),floor,THREE.MathUtils.clamp(localEye.z,data.cabinMinZ??-4.55,data.cabinMaxZ??4.62));
    if(localEye.z>=3.25)localPosition.x=THREE.MathUtils.clamp(localEye.x,-.36,1.18);
    this.passengerState={aircraft,localPosition,yaw:(player.walkYaw??aircraft.heading??aircraft.mesh.rotation.y)-(aircraft.heading??aircraft.mesh.rotation.y),pitch:player.walkPitch??0,seated:false,seat:null,pilot:false,cameraIndex:0,rideTime:0};
    player.inAircraft=true;player.inVehicle=false;player.inTrain=false;player.inBus=false;this.toast?.(`On board ${aircraft.id} — press E beside a seat to sit`);return true;
  }

  nearestPassengerSeat(state,maxDistance=.72){
    const seats=state?.aircraft?.mesh?.userData?.seats??[];let best=null,bestDistance=maxDistance;
    for(const seat of seats){const distance=Math.hypot(state.localPosition.x-seat.x,state.localPosition.z-seat.z);if(distance<bestDistance){bestDistance=distance;best=seat;}}
    return best;
  }

  passengerNearDoor(state){return Boolean(state&&SERVICE_STATES.has(state.aircraft.state)&&state.aircraft.doorsOpen&&state.localPosition.z>=3.30&&state.localPosition.x>=.12);}

  detachPassenger(player){
    const state=this.passengerState;if(!state||!player)return false;const aircraft=state.aircraft,data=aircraft.mesh.userData,floor=data.cabinFloorY??1.15;
    const localFeet=new THREE.Vector3(AIRCRAFT_DOOR_LOCAL_X+.22,floor,AIRCRAFT_DOOR_LOCAL_Z);aircraft.mesh.updateWorldMatrix(true,false);const worldFeet=aircraft.mesh.localToWorld(localFeet),yaw=(aircraft.heading??aircraft.mesh.rotation.y)+Math.PI*.5;
    this.passengerState=null;player.inAircraft=false;
    if(player.releaseToWalking)player.releaseToWalking(worldFeet,yaw,{collisionGrace:.42});else{player.camera.position.set(worldFeet.x,worldFeet.y+1.72,worldFeet.z);player.walkYaw=yaw;player.inVehicle=false;player.inTrain=false;player.inBus=false;}
    this.toast?.("Left aircraft");return true;
  }

  handleInteract(player){
    const state=this.passengerState;if(!player?.inAircraft||!state)return false;
    if(state.pilot){if((state.aircraft.speed??0)>1.5||state.aircraft.simPosition.y>.55){this.toast?.("Reduce speed and stop on the ground before leaving the cockpit");return true;}state.pilot=false;state.seated=false;state.localPosition.set(0,state.aircraft.mesh.userData.cabinFloorY??1.15,5.02);state.yaw=Math.PI;state.pitch=0;this.toast?.("Left the pilot seat");return true;}
    if(state.seated){state.seated=false;state.seat=null;state.localPosition.x=0;state.pitch=0;this.toast?.("Stood up");return true;}
    if(state.localPosition.z>4.78){this.beginManualControl(state.aircraft);state.pilot=true;state.seated=true;state.seat=null;state.cameraIndex=0;state.localPosition.set(-.40,state.aircraft.mesh.userData.cabinFloorY??1.15,5.16);state.yaw=0;state.pitch=0;this.toast?.("Pilot: W nose down · S nose up · A/D bank + turn · Tab throttle up · Shift throttle down · Space brake · C camera · mouse look");return true;}
    const seat=this.nearestPassengerSeat(state);if(seat){state.seated=true;state.seat=seat;state.localPosition.set(seat.x,state.aircraft.mesh.userData.cabinFloorY??1.15,seat.z+.03);state.yaw=0;state.pitch=0;this.toast?.(`Seated · row ${seat.row}${seat.side}`);return true;}
    if(this.passengerNearDoor(state))return this.detachPassenger(player);
    this.toast?.("Move beside a seat to sit, forward into the cockpit to fly, or to the open door to leave");return true;
  }

  beginManualControl(aircraft){
    if(aircraft.manualControl)return;this.releaseStand(aircraft);this.releaseRunway(aircraft,aircraft.originAirportId);this.releaseRunway(aircraft,aircraft.destinationAirportId);aircraft.manualControl=true;aircraft.manualThrottle=THREE.MathUtils.clamp((aircraft.speed??0)/88,0,1);aircraft.manualEnginePower=aircraft.manualThrottle;aircraft.manualAirborne=aircraft.simPosition.y>.55;aircraft.manualVerticalSpeed=0;aircraft.manualRollRate=0;aircraft.manualSideslip=0;aircraft.manualElevator=0;aircraft.state="manual";aircraft.stateTime=0;aircraft.doorsOpen=false;aircraft.currentAirportId=null;aircraft.progress=0;aircraft.angleOfAttack=MANUAL_FLIGHT.trimAoADeg*DEG;
  }

  updateManualAircraft(aircraft,dt){
    const state=this.passengerState,hasPilot=Boolean(state?.aircraft===aircraft&&state.pilot),input=this.input,gravity=MANUAL_FLIGHT.gravity;
    if(hasPilot){
      if(input?.isDown?.("Tab"))aircraft.manualThrottle=Math.min(1,(aircraft.manualThrottle??0)+dt*.30);
      if(input?.isDown?.("ShiftLeft")||input?.isDown?.("ShiftRight"))aircraft.manualThrottle=Math.max(0,(aircraft.manualThrottle??0)-dt*.38);
    }
    aircraft.manualEnginePower=moveToward(aircraft.manualEnginePower??aircraft.manualThrottle??0,aircraft.manualThrottle??0,(aircraft.manualThrottle>(aircraft.manualEnginePower??0)?MANUAL_FLIGHT.engineSpoolUp:MANUAL_FLIGHT.engineSpoolDown)*dt);
    const onGround=!aircraft.manualAirborne&&aircraft.simPosition.y<=.55,brake=hasPilot&&input?.isDown?.("Space");
    // One lateral control path only. The aircraft model/heading frame uses the
    // opposite lateral sign to the previous mapping: A must drive the negative
    // turn command and D the positive visual turn, so swap the raw key sign here.
    const turnInput=hasPilot?((input?.isDown?.("KeyA")?1:0)-(input?.isDown?.("KeyD")?1:0)):0;
    // W pushes the nose down; S pulls the nose up. Arrow keys are intentionally
    // ignored for aircraft movement.
    const pitchCommand=hasPilot?((input?.isDown?.("KeyS")?1:0)-(input?.isDown?.("KeyW")?1:0)):0;
    const speed=Math.max(0,aircraft.speed??0),gearDrag=this.gearTargetFor(aircraft)*.16,flapDrag=this.flapTargetFor(aircraft)*.22;
    if(onGround){
      aircraft.manualRollRate=moveToward(aircraft.manualRollRate??0,0,90*DEG*dt);aircraft.bank=moveToward(aircraft.bank??0,0,65*DEG*dt);aircraft.manualVerticalSpeed=0;aircraft.angleOfAttack=moveToward(aircraft.angleOfAttack??0,0,9*DEG*dt);
      const steerInput=turnInput,steerAuthority=THREE.MathUtils.clamp(speed/5,0,1)*(1-THREE.MathUtils.clamp((speed-24)/28,0,.72));aircraft.heading+=(steerInput*24*DEG*steerAuthority)*dt;
      const thrustAccel=(aircraft.manualEnginePower??0)*4.9,rolling=.30+speed*.010,brakeAccel=brake?8.5:0,aeroDrag=.00034*speed*speed;aircraft.speed=THREE.MathUtils.clamp(speed+(thrustAccel-rolling-brakeAccel-aeroDrag)*dt,0,MANUAL_FLIGHT.groundMaxSpeed);
      this._manualForward.set(Math.sin(aircraft.heading),0,Math.cos(aircraft.heading));aircraft.simPosition.addScaledVector(this._manualForward,aircraft.speed*dt);aircraft.simPosition.y=.18;
      const rotateRequested=pitchCommand>.05&&aircraft.speed>=MANUAL_FLIGHT.takeoffSpeed;if(rotateRequested){aircraft.manualAirborne=true;aircraft.manualVerticalSpeed=.6;aircraft.angleOfAttack=5.5*DEG;}
      aircraft.pitch=moveToward(aircraft.pitch??0,rotateRequested?-5.5*DEG:0,16*DEG*dt);
    }else{
      const targetRollRate=-turnInput*MANUAL_FLIGHT.maxRollRateDeg*DEG;aircraft.manualRollRate=moveToward(aircraft.manualRollRate??0,targetRollRate,(turnInput?105:72)*DEG*dt);aircraft.manualRollRate*=Math.exp(-dt*(turnInput?1.4:2.2));aircraft.bank=THREE.MathUtils.clamp((aircraft.bank??0)+aircraft.manualRollRate*dt,-MANUAL_FLIGHT.maxBankDeg*DEG,MANUAL_FLIGHT.maxBankDeg*DEG);
      if(!turnInput&&Math.abs(aircraft.bank)<1.2*DEG)aircraft.bank=moveToward(aircraft.bank,0,4*DEG*dt);
      aircraft.manualElevator=moveToward(aircraft.manualElevator??0,pitchCommand,(pitchCommand?3.0:2.2)*dt);aircraft.manualSideslip=moveToward(aircraft.manualSideslip??0,turnInput*.16,(turnInput?3.2:2.6)*dt);
      const aoaTarget=(MANUAL_FLIGHT.trimAoADeg+(aircraft.manualElevator??0)*MANUAL_FLIGHT.maxElevatorAoADeg)*DEG;aircraft.angleOfAttack=moveToward(aircraft.angleOfAttack??0,aoaTarget,7.5*DEG*dt);
      const aoaDeg=THREE.MathUtils.radToDeg(aircraft.angleOfAttack),absAoA=Math.abs(aoaDeg),stallStart=MANUAL_FLIGHT.stallAoADeg,deepStall=MANUAL_FLIGHT.deepStallAoADeg;let liftCurve=1;if(absAoA>stallStart)liftCurve=THREE.MathUtils.clamp(1-(absAoA-stallStart)/(deepStall-stallStart)*.72,.28,1);
      const cl=Math.max(-.25,.38+.105*aoaDeg)*liftCurve,dynamicFactor=(aircraft.speed/MANUAL_FLIGHT.referenceLiftSpeed)**2,liftAccel=gravity*dynamicFactor*(cl/.695)*Math.cos(aircraft.bank);
      const inducedDrag=.055*Math.max(0,dynamicFactor*(cl/.695))**2,aoaDrag=.0065*Math.abs(aoaDeg),baseDrag=.00030*aircraft.speed*aircraft.speed+.006*aircraft.speed,dragAccel=baseDrag+inducedDrag+aoaDrag+gearDrag+flapDrag,thrustAccel=(aircraft.manualEnginePower??0)*3.55;aircraft.speed=THREE.MathUtils.clamp(aircraft.speed+(thrustAccel-dragAccel)*dt,18,MANUAL_FLIGHT.maxFlightSpeed);
      const verticalAccel=liftAccel-gravity;aircraft.manualVerticalSpeed=THREE.MathUtils.clamp((aircraft.manualVerticalSpeed??0)+verticalAccel*dt,-32,24);aircraft.manualVerticalSpeed*=Math.exp(-dt*.055);
      const bankTurnSign=-Math.sign(aircraft.bank||0),coordinatedTurn=bankTurnSign*gravity*Math.tan(Math.abs(aircraft.bank))/Math.max(aircraft.speed,24),coordinatedYawAssist=(aircraft.manualSideslip??0)*2.2*DEG*THREE.MathUtils.clamp(62/Math.max(aircraft.speed,28),.55,1.25);aircraft.heading+=(coordinatedTurn+coordinatedYawAssist)*dt;
      const flightPathAngle=Math.atan2(aircraft.manualVerticalSpeed,Math.max(aircraft.speed,1)),bodyNoseUp=flightPathAngle+aircraft.angleOfAttack;aircraft.pitch=THREE.MathUtils.clamp(-bodyNoseUp,-20*DEG,13*DEG);
      const horizontalSpeed=Math.sqrt(Math.max(0,aircraft.speed*aircraft.speed-aircraft.manualVerticalSpeed*aircraft.manualVerticalSpeed));this._manualForward.set(Math.sin(aircraft.heading),0,Math.cos(aircraft.heading));aircraft.simPosition.addScaledVector(this._manualForward,horizontalSpeed*dt);aircraft.simPosition.y+=(aircraft.manualVerticalSpeed??0)*dt;
      if(aircraft.simPosition.y<=.18){aircraft.simPosition.y=.18;aircraft.manualAirborne=false;aircraft.manualVerticalSpeed=0;aircraft.pitch=moveToward(aircraft.pitch,0,18*DEG*dt);aircraft.bank=moveToward(aircraft.bank,0,35*DEG*dt);}
    }
    aircraft.targetSpeed=aircraft.speed;aircraft._orientationEuler.set(aircraft.pitch,aircraft.heading,aircraft.bank,"YXZ");aircraft.simQuaternion.setFromEuler(aircraft._orientationEuler);
  }

  updatePassengerRide(dt,player){
    const state=this.passengerState;if(!state||!player?.inAircraft)return;const aircraft=state.aircraft,data=aircraft.mesh.userData,input=this.input??player.input;
    const bufferedDX=Number.isFinite(player.pendingLookDX)?player.pendingLookDX:0,bufferedDY=Number.isFinite(player.pendingLookDY)?player.pendingLookDY:0,lookDX=bufferedDX!==0?bufferedDX:(Number.isFinite(input?.mouseDX)?input.mouseDX:0),lookDY=bufferedDY!==0?bufferedDY:(Number.isFinite(input?.mouseDY)?input.mouseDY:0);player.pendingLookDX=0;player.pendingLookDY=0;
    if(state.pilot&&input?.consume?.("KeyC")){state.cameraIndex=((state.cameraIndex??0)+1)%AIRCRAFT_CAMERA_MODES.length;const mode=AIRCRAFT_CAMERA_MODES[state.cameraIndex];state.yaw=mode==="LEFT WING"?Math.PI*.5:mode==="RIGHT WING"?-Math.PI*.5:0;state.pitch=mode==="CHASE"?-.08:mode.includes("WING")?-.04:0;this.toast?.(`${mode} aircraft camera`);}
    state.yaw-=lookDX*.002;state.pitch=THREE.MathUtils.clamp(state.pitch-lookDY*.0018,-THREE.MathUtils.degToRad(78),THREE.MathUtils.degToRad(78));state.rideTime+=dt;
    if(state.pilot){state.localPosition.set(-.40,data.cabinFloorY??1.15,5.16);this.updatePassengerView(player);return;}
    if(!state.seated){
      const forwardInput=(input?.isDown?.("KeyW")?1:0)-(input?.isDown?.("KeyS")?1:0),leftInput=input?.isDown?.("KeyA")?1:0,rightInput=input?.isDown?.("KeyD")?1:0,move=this._passengerMove.set(Math.sin(state.yaw),Math.cos(state.yaw)).multiplyScalar(forwardInput).add(this._passengerScreenLeft.set(Math.cos(state.yaw),-Math.sin(state.yaw)).multiplyScalar(leftInput-rightInput));
      if(move.lengthSq()>0)move.normalize().multiplyScalar(dt*2.7);const next=this._passengerNext.copy(state.localPosition);next.x+=move.x;next.z+=move.y;next.z=THREE.MathUtils.clamp(next.z,data.cabinMinZ??-4.55,data.cabinMaxZ??4.62);
      const cockpit=next.z>=4.72,vestibule=next.z>=3.28&&!cockpit;next.x=THREE.MathUtils.clamp(next.x,cockpit?-.74:(vestibule?-.36:-.33),cockpit?.74:(vestibule?1.18:.33));state.localPosition.copy(next);
    }else if(state.seat)state.localPosition.set(state.seat.x,data.cabinFloorY??1.15,state.seat.z+.03);
    // Keep authoritative/player state coherent for simulation-side queries and tests.
    // The display-frame render pass overwrites this with the interpolated aircraft transform
    // before WebGL rendering, so the visible cabin/camera remains smooth above 60 Hz.
    this.updatePassengerView(player);
  }

  updatePassengerView(player){
    const state=this.passengerState;if(!state||!player?.inAircraft)return;const aircraft=state.aircraft,data=aircraft.mesh.userData;aircraft.mesh.updateWorldMatrix(true,false);const vibration=Math.min(.018,aircraft.speed*.00045);
    let eyeY=state.seated?(data.seatedEyeY??2.23):(data.standingEyeY??((data.cabinFloorY??1.15)+1.72)),eyeZ=state.localPosition.z,eyeX=state.localPosition.x;
    if(state.pilot){
      const mode=AIRCRAFT_CAMERA_MODES[state.cameraIndex??0]??"PILOT",pilotY=data.pilotEyeY??2.47,pilotZ=data.pilotEyeZ??5.42;
      if(mode==="PILOT"){eyeX=-.40;eyeY=pilotY;eyeZ=pilotZ;}
      else if(mode==="COPILOT"){eyeX=.40;eyeY=pilotY;eyeZ=pilotZ;}
      else if(mode==="CHASE"){eyeX=0;eyeY=4.55;eyeZ=-10.8;}
      else if(mode==="LEFT WING"){eyeX=-6.25;eyeY=2.75;eyeZ=-.55;}
      else if(mode==="RIGHT WING"){eyeX=6.25;eyeY=2.75;eyeZ=-.55;}
    }
    this._passengerEye.set(eyeX+(state.seated&&!state.pilot?0:Math.sin(state.rideTime*8.4)*vibration*.25),eyeY+Math.sin(state.rideTime*12.7)*vibration,eyeZ);const worldEye=this._passengerWorldEye.copy(this._passengerEye);aircraft.mesh.localToWorld(worldEye);player.camera.position.copy(worldEye);
    const horizontal=Math.cos(state.pitch),localLook=this._passengerLook.set(Math.sin(state.yaw)*horizontal,Math.sin(state.pitch),Math.cos(state.yaw)*horizontal),worldLook=this._passengerWorldLook.copy(localLook).transformDirection(aircraft.mesh.matrixWorld);player.camera.lookAt(this._passengerLookTarget.copy(worldEye).add(worldLook));player.walkYaw=(aircraft.heading??aircraft.mesh.rotation.y)+state.yaw;player.walkPitch=state.pitch;player.position.set(worldEye.x,.05,worldEye.z);
  }

  getPlayerFocus(){const state=this.passengerState;return state?{position:state.aircraft.simPosition,heading:state.aircraft.heading??state.aircraft.mesh.rotation.y,speed:state.aircraft.speed}:null;}

  getPlayerState(){
    const state=this.passengerState;if(!state)return null;const aircraft=state.aircraft,origin=this.airportById.get(aircraft.originAirportId),destination=this.airportById.get(aircraft.destinationAirportId);
    return{id:aircraft.id,registration:aircraft.registration,state:aircraft.state,speed:aircraft.speed,origin:origin?.name??aircraft.originAirportId,destination:destination?.name??aircraft.destinationAirportId,originCode:origin?.code??"—",destinationCode:destination?.code??"—",seated:state.seated,pilot:state.pilot,cameraMode:state.pilot?(AIRCRAFT_CAMERA_MODES[state.cameraIndex??0]??"PILOT"):"CABIN",manual:Boolean(aircraft.manualControl),throttle:aircraft.manualThrottle??0,enginePower:aircraft.manualEnginePower??aircraft.manualThrottle??0,altitude:Math.max(0,aircraft.simPosition.y-.18),verticalSpeed:aircraft.manualVerticalSpeed??0,headingDeg:normalizeDegrees(THREE.MathUtils.radToDeg(aircraft.heading??0)),bankDeg:THREE.MathUtils.radToDeg(aircraft.bank??0),aoaDeg:THREE.MathUtils.radToDeg(aircraft.angleOfAttack??0),stallWarning:Boolean(aircraft.manualAirborne&&((THREE.MathUtils.radToDeg(aircraft.angleOfAttack??0)>13.5)||(aircraft.speed??0)<25)),flaps:aircraft.mesh.userData.flapDeployment??0,gear:aircraft.mesh.userData.gearDeployment??1};
  }

  organizeQualityDetailGroups(){
    const pattern=/(runway-seam|touchdown-rubber|terminal-planter|terminal-plant|queue-stanchion|gate-information-totem|terminal-vending-display|jetway-.*frame|window-outer-frame)/;this.minorDetailGroups=[];
    for(const root of[this.group,this.islandGroup]){const detail=new THREE.Group();detail.name=`${root.name}-minor-detail`;for(const child of[...root.children])if(child!==detail&&pattern.test(child.name??"")){root.remove(child);detail.add(child);}root.add(detail);this.minorDetailGroups.push(detail);}
  }
  applyQualityProfile(profile=qualityManager.current){for(const group of this.minorDetailGroups??[])group.visible=profile.airport.minorDetail;}

  freezeStaticGroup(){this.group.traverse(object=>{if(object===this.group)return;object.updateMatrix();object.matrixAutoUpdate=false;});}

  standXFor(airportDef,standIndex){if(airportDef===this.definition)return-34+(standIndex%4)*23;const xs=this.islandStandXs??[-42,-14,14,42];return xs[standIndex%xs.length];}
  standZFor(airportDef){return airportDef===this.definition?this.standLocalZ:(this.islandStandLocalZ??airportDef.terminalOffset-28);}
  parkedPositionFor(airportDef,standIndex){return localPoint(airportDef,this.standXFor(airportDef,standIndex),.18,this.standZFor(airportDef));}
  routeDirection(origin,destination){const dx=destination.x-origin.x,dz=destination.z-origin.z,length=Math.hypot(dx,dz)||1;return new THREE.Vector3(dx/length,0,dz/length);}
  runwayDirectionFor(airportDef,travelDirection){const {forward}=localBasis(airportDef);return travelDirection.dot(forward)>=0?1:-1;}
  worldCurve(points,tension=.35,closed=false){return new THREE.CatmullRomCurve3(points,closed,"centripetal",tension);}

  buildLegPaths(origin,destination,standIndex,destinationStandIndex=0){
    const originStandX=this.standXFor(origin,standIndex??0),originStandZ=this.standZFor(origin),destStandX=this.standXFor(destination,destinationStandIndex??0),destStandZ=this.standZFor(destination),originHalf=origin.runway.length*.5,destHalf=destination.runway.length*.5,travel=this.routeDirection(origin,destination);
    if(origin.id===destination.id){
      const gateX=originStandX,holdX=-origin.runway.length*.35,exitX=origin.runway.length*.28,holdZ=origin.runway.width*.5+13,curve=points=>curveFromLocal(origin,points,.38),cruise=this.aviation.cruiseAltitude??178;
      return{
        taxiOut:curve([[gateX,.18,originStandZ],[gateX,.18,originStandZ-10],[gateX-7,.18,origin.taxiwayOffset+5],[gateX-5,.18,origin.taxiwayOffset],[holdX+10,.18,origin.taxiwayOffset],[holdX,.18,origin.taxiwayOffset-8],[holdX,.18,holdZ]]),
        takeoff:curve([[holdX,.18,holdZ],[holdX,.18,10],[holdX+12,.18,0],[-65,.20,0],[70,1.5,0],[origin.runway.length*.48,24,0],[origin.runway.length*.70,86,-18]]),
        climb:curve([[origin.runway.length*.70,86,-18],[315,125,-125],[300,cruise,-180]]),
        enroute:curve([[300,cruise,-180],[40,cruise,-320],[-310,145,-240],[-360,115,30]]),
        holding:new THREE.CatmullRomCurve3([[-360,115,30],[-430,115,210],[-680,115,230],[-760,115,20],[-590,115,-145]].map(point=>localPoint(origin,...point)),true,"centripetal",.28),
        descent:curve([[-360,115,30],[-320,95,120],[-270,82,180]]),
        approach:curve([[-270,82,180],[-230,62,90],[-origin.runway.length*.55,28,15],[-origin.runway.length*.42,7,4],[-origin.runway.length*.31,.22,0]]),
        landingRoll:curve([[-origin.runway.length*.31,.22,0],[0,.18,0],[exitX,.18,0]]),
        runwayExit:curve([[exitX,.18,0],[exitX,.18,18],[exitX,.18,holdZ],[exitX,.18,origin.taxiwayOffset]]),
        taxiIn:curve([[exitX,.18,origin.taxiwayOffset],[gateX-5,.18,origin.taxiwayOffset],[gateX,.18,originStandZ-9],[gateX,.18,originStandZ]])
      };
    }
    const takeoffDir=this.runwayDirectionFor(origin,travel),landingDir=this.runwayDirectionFor(destination,travel),originHoldX=-takeoffDir*origin.runway.length*.35,originHoldZ=origin.runway.width*.5+13,destExitX=landingDir*destination.runway.length*.28,destHoldZ=destination.runway.width*.5+12;
    const taxiOut=curveFromLocal(origin,[[originStandX,.18,originStandZ],[originStandX,.18,originStandZ-10],[originStandX-takeoffDir*7,.18,origin.taxiwayOffset+5],[originStandX-takeoffDir*5,.18,origin.taxiwayOffset],[originHoldX+takeoffDir*10,.18,origin.taxiwayOffset],[originHoldX,.18,origin.taxiwayOffset-8],[originHoldX,.18,originHoldZ]],.38);
    const takeoff=curveFromLocal(origin,[[originHoldX,.18,originHoldZ],[originHoldX,.18,9],[-takeoffDir*originHalf*.43,.18,0],[-takeoffDir*originHalf*.24,.22,0],[0,1.1,0],[takeoffDir*originHalf*.48,24,0],[takeoffDir*originHalf*.70,70,-takeoffDir*10]],.36);
    const departureEnd=takeoff.getPointAt(1),cruiseAltitude=this.aviation.cruiseAltitude??210,climbEnd=departureEnd.clone().addScaledVector(travel,900);climbEnd.y=cruiseAltitude;
    const perpendicular=new THREE.Vector3(-travel.z,0,travel.x),approachEntry=localPoint(destination,-landingDir*(destHalf+720),92,0),descentStart=localPoint(destination,-landingDir*(destHalf+1500),cruiseAltitude,landingDir*70);
    const climbMid=departureEnd.clone().lerp(climbEnd,.52).addScaledVector(perpendicular,takeoffDir*95);climbMid.y=(departureEnd.y+cruiseAltitude)*.58;
    const climb=this.worldCurve([departureEnd.clone(),climbMid,climbEnd],.34),cruiseDistance=climbEnd.distanceTo(descentStart),enroutePoints=[climbEnd.clone()];
    const cruiseSegments=Math.max(3,Math.ceil(cruiseDistance/2200));for(let i=1;i<cruiseSegments;i++){const t=i/cruiseSegments,p=climbEnd.clone().lerp(descentStart,t);p.y=cruiseAltitude;p.addScaledVector(perpendicular,Math.sin(t*Math.PI*2)*55);enroutePoints.push(p);}enroutePoints.push(descentStart.clone());
    const enroute=this.worldCurve(enroutePoints,.22),holdingPoints=[descentStart.clone(),descentStart.clone().addScaledVector(perpendicular,320),descentStart.clone().addScaledVector(perpendicular,320).addScaledVector(travel,-680),descentStart.clone().addScaledVector(perpendicular,-320).addScaledVector(travel,-680),descentStart.clone().addScaledVector(perpendicular,-320)];for(const point of holdingPoints)point.y=cruiseAltitude;const holding=this.worldCurve(holdingPoints,.28,true),descentMid=descentStart.clone().lerp(approachEntry,.55).addScaledVector(perpendicular,-landingDir*40);descentMid.y=THREE.MathUtils.lerp(cruiseAltitude,92,.62);const descent=this.worldCurve([descentStart,descentMid,approachEntry],.30);
    const approach=this.worldCurve([approachEntry,localPoint(destination,-landingDir*(destHalf+310),42,8*landingDir),localPoint(destination,-landingDir*(destHalf+110),10,2),localPoint(destination,-landingDir*(destHalf-46),.22,0)],.28);
    const touchdown=approach.getPointAt(1),landingRoll=this.worldCurve([touchdown,localPoint(destination,-landingDir*destHalf*.10,.18,0),localPoint(destination,destExitX,.18,0)],.18),runwayExit=curveFromLocal(destination,[[destExitX,.18,0],[destExitX,.18,16],[destExitX,.18,destHoldZ],[destExitX,.18,destination.taxiwayOffset]],.32),taxiIn=curveFromLocal(destination,[[destExitX,.18,destination.taxiwayOffset],[destStandX-landingDir*5,.18,destination.taxiwayOffset],[destStandX,.18,destStandZ-9],[destStandX,.18,destStandZ]],.38);
    return{taxiOut,takeoff,climb,enroute,holding,descent,approach,landingRoll,runwayExit,taxiIn};
  }

  setAircraftPaths(aircraft,paths){aircraft.paths=paths;aircraft.pathLengths={};for(const[state,curve]of Object.entries(paths))aircraft.pathLengths[state]=Math.max(1,curve.getLength());}
  otherAirportId(id){const other=this.airportDefinitions.find(airport=>airport.id!==id);return other?.id??id;}
  occupyStand(aircraft,airportId,standIndex){const stands=this.standOccupancy.get(airportId);if(!stands||standIndex==null||standIndex<0||standIndex>=stands.length)return false;const owner=stands[standIndex];if(owner&&owner!==aircraft.id)return false;stands[standIndex]=aircraft.id;return true;}
  releaseStand(aircraft,airportId=aircraft.currentAirportId,standIndex=aircraft.standIndex){const stands=this.standOccupancy.get(airportId);if(stands&&standIndex!=null&&stands[standIndex]===aircraft.id)stands[standIndex]=null;}
  findFreeStand(airportId){const stands=this.standOccupancy.get(airportId)??[];for(let i=0;i<stands.length;i++)if(!stands[i])return i;return-1;}
  reserveArrivalStand(aircraft){if(aircraft.destinationStandIndex!=null)return true;const stand=this.findFreeStand(aircraft.destinationAirportId);if(stand<0)return false;if(!this.occupyStand(aircraft,aircraft.destinationAirportId,stand))return false;aircraft.destinationStandIndex=stand;const origin=this.airportById.get(aircraft.originAirportId),destination=this.airportById.get(aircraft.destinationAirportId);this.setAircraftPaths(aircraft,this.buildLegPaths(origin,destination,aircraft.departureStandIndex??0,stand));return true;}
  requestRunway(aircraft,airportId){const owner=this.runwayOwners.get(airportId);if(owner&&owner!==aircraft.id)return false;this.runwayOwners.set(airportId,aircraft.id);if(airportId===this.definition.id)this.runwayOwnerId=aircraft.id;return true;}
  releaseRunway(aircraft,airportId){if(this.runwayOwners.get(airportId)===aircraft.id)this.runwayOwners.set(airportId,null);if(airportId===this.definition.id&&this.runwayOwnerId===aircraft.id)this.runwayOwnerId=null;}
  inboundSoon(airportId){return this.aircraft.filter(a=>a.destinationAirportId===airportId&&["holding","goAround","descent","approach","landingRoll","runwayExit","taxiIn"].includes(a.state)).length;}
  serviceCount(airportId){return this.aircraft.filter(a=>a.currentAirportId===airportId&&SERVICE_STATES.has(a.state)).length;}
  canDepartAirport(airportId){if(this.airportDefinitions.length<2)return true;const reserve=this.aviation.minimumAirportReserve??1;return this.serviceCount(airportId)>reserve||this.inboundSoon(airportId)>0;}
  arrivalReadyForRunway(airportId,except=null){return this.aircraft.some(a=>a!==except&&a.destinationAirportId===airportId&&((a.state==="holding"&&a.progress>.78)||(a.state==="enroute"&&a.progress>.96)||(a.state==="descent")||(a.state==="approach")));}
  queueSpeedLimit(aircraft){
    if(!TAXI_CONFLICT_STATES.has(aircraft.state))return Infinity;
    const yaw=aircraft.heading??aircraft.mesh.rotation.y,forwardX=Math.sin(yaw),forwardZ=Math.cos(yaw),speed=Math.max(0,aircraft.speed??0),brakingDistance=speed*speed/(2*3.2),minimumCentre=AIRCRAFT_HALF_LENGTH*2+AIRCRAFT_QUEUE_GAP,safeCentre=minimumCentre+Math.min(18,brakingDistance+4);let limit=Infinity;
    for(const other of this.aircraft){
      if(other===aircraft)continue;
      const otherOnGround=GROUND_QUEUE_STATES.has(other.state)||SERVICE_STATES.has(other.state)||(other.manualControl&&other.simPosition.y<2.0);if(!otherOnGround)continue;
      const dx=other.simPosition.x-aircraft.simPosition.x,dz=other.simPosition.z-aircraft.simPosition.z,ahead=dx*forwardX+dz*forwardZ;if(ahead<=0||ahead>safeCentre+12)continue;
      const lateral=Math.abs(dx*forwardZ-dz*forwardX);if(lateral>AIRCRAFT_QUEUE_LATERAL)continue;
      const otherYaw=other.heading??other.mesh.rotation.y,alignment=Math.cos(otherYaw-yaw);if(alignment<.35)continue;
      const clearDistance=ahead-minimumCentre;if(clearDistance<=0)return 0;
      // Match the leader early, then progressively reduce speed as the physical
      // fuselage envelopes approach the required nose-to-tail stand-off.
      const leaderSpeed=Math.max(0,other.speed??0),closingLimit=Math.sqrt(Math.max(0,2*3.2*Math.max(0,clearDistance-1.5)));limit=Math.min(limit,leaderSpeed+closingLimit*.72);
      if(ahead<safeCentre)limit=Math.min(limit,Math.max(0,(clearDistance/Math.max(1,safeCentre-minimumCentre))*Math.max(1.2,leaderSpeed+2.0)));
    }
    return limit;
  }
  groundConflict(aircraft){return this.queueSpeedLimit(aircraft)<=.08;}

  enforceGroundSeparation(aircraft){
    if(!TAXI_CONFLICT_STATES.has(aircraft.state))return;const yaw=aircraft.heading??aircraft.mesh.rotation.y,forwardX=Math.sin(yaw),forwardZ=Math.cos(yaw),minimumCentre=AIRCRAFT_HALF_LENGTH*2+AIRCRAFT_QUEUE_GAP;
    for(const other of this.aircraft){if(other===aircraft)continue;const dx=other.simPosition.x-aircraft.simPosition.x,dz=other.simPosition.z-aircraft.simPosition.z,ahead=dx*forwardX+dz*forwardZ;if(ahead<=0||ahead>=minimumCentre)continue;const lateral=Math.abs(dx*forwardZ-dz*forwardX);if(lateral>AIRCRAFT_QUEUE_LATERAL)continue;const otherYaw=other.heading??other.mesh.rotation.y;if(Math.cos(otherYaw-yaw)<.35)continue;
      // Last-resort positional guard against numerical overlap. The predictive
      // speed controller should normally prevent this branch from firing.
      const correction=minimumCentre-ahead+.05;aircraft.simPosition.x-=forwardX*correction;aircraft.simPosition.z-=forwardZ*correction;aircraft.speed=Math.min(aircraft.speed,other.speed??0);aircraft.targetSpeed=Math.min(aircraft.targetSpeed,aircraft.speed);
    }
  }

  prepareNextLeg(aircraft){const origin=this.airportById.get(aircraft.currentAirportId),destination=this.airportById.get(this.otherAirportId(aircraft.currentAirportId));aircraft.originAirportId=origin.id;aircraft.destinationAirportId=destination.id;aircraft.departureStandIndex=aircraft.standIndex;aircraft.destinationStandIndex=null;this.setAircraftPaths(aircraft,this.buildLegPaths(origin,destination,aircraft.departureStandIndex,0));aircraft.parkedPosition=this.parkedPositionFor(origin,aircraft.standIndex);}
  arriveAtStand(aircraft){const destination=this.airportById.get(aircraft.destinationAirportId),stand=aircraft.destinationStandIndex??this.findFreeStand(destination.id);if(stand<0){aircraft.state="runwayExit";aircraft.progress=.995;aircraft.speed=0;return false;}this.occupyStand(aircraft,destination.id,stand);aircraft.currentAirportId=destination.id;aircraft.standIndex=stand;aircraft.gateIndex=stand;aircraft.parkedPosition=this.parkedPositionFor(destination,stand);aircraft.simPosition.copy(aircraft.parkedPosition);aircraft.mesh.position.copy(aircraft.parkedPosition);aircraft.cycles++;this.completedCycles++;aircraft.state="turnaround";aircraft.progress=0;aircraft.stateTime=0;aircraft.doorsOpen=true;this.prepareNextLeg(aircraft);return true;}
  beginDeparture(aircraft){this.releaseStand(aircraft);aircraft.departureStandIndex=aircraft.standIndex;aircraft.state="taxiOut";aircraft.progress=0;aircraft.stateTime=0;aircraft.doorsOpen=false;}

  spawnAircraft(count){
    const single=this.airportDefinitions.length<2,registrations=["G-BWRA","G-BWRB","G-BWRC","G-BWRD","G-BWRE","G-BWRF","G-BWRG","G-BWRH","G-BWRI","G-BWRJ"];
    const pattern=single?Array.from({length:count},(_,i)=>({airportId:this.definition.id,stand:i%(this.definition.standCount??4),state:"parked",stateTime:i*3})):[
      {airportId:this.definition.id,stand:0,state:"turnaround",stateTime:2},{airportId:this.definition.id,stand:1,state:"boarding",stateTime:4},
      {airportId:this.islandDefinition.id,stand:0,state:"turnaround",stateTime:1},{airportId:this.islandDefinition.id,stand:1,state:"boarding",stateTime:6},
      {origin:this.definition.id,destination:this.islandDefinition.id,departureStand:2,state:"climb",progress:.46},
      {origin:this.definition.id,destination:this.islandDefinition.id,departureStand:3,state:"enroute",progress:.38},
      {origin:this.definition.id,destination:this.islandDefinition.id,departureStand:2,state:"descent",progress:.28,reserveStand:true},
      {origin:this.islandDefinition.id,destination:this.definition.id,departureStand:2,state:"climb",progress:.52},
      {origin:this.islandDefinition.id,destination:this.definition.id,departureStand:3,state:"enroute",progress:.43},
      {origin:this.islandDefinition.id,destination:this.definition.id,departureStand:2,state:"descent",progress:.32,reserveStand:true}
    ];
    for(let i=0;i<count;i++){
      const descriptor=pattern[i%pattern.length],mesh=createAircraft(i),initialSpeed=ACTIVE_FLIGHT_STATES.has(descriptor.state)?(descriptor.state==="enroute"?(this.aviation.cruiseSpeed??AIRCRAFT_SPEED.enroute):(AIRCRAFT_SPEED[descriptor.state]??60))*CONFIG.aircraftSpeedMultiplier:0;mesh.userData.registration=registrations[i%registrations.length];this.scene.add(mesh);const aircraft={id:`AIR-${String(i+1).padStart(2,"0")}`,registration:registrations[i%registrations.length],mesh,paths:{},pathLengths:{},state:descriptor.state,progress:descriptor.progress??0,stateTime:descriptor.stateTime??0,standIndex:descriptor.stand??null,gateIndex:descriptor.stand??null,departureStandIndex:descriptor.departureStand??descriptor.stand??0,destinationStandIndex:null,currentAirportId:descriptor.airportId??null,originAirportId:descriptor.origin??descriptor.airportId,destinationAirportId:descriptor.destination??(descriptor.airportId?this.otherAirportId(descriptor.airportId):null),speed:initialSpeed,targetSpeed:initialSpeed,doorsOpen:DOOR_OPEN_STATES.has(descriptor.state),cycles:0,_position:new THREE.Vector3(),_tangent:new THREE.Vector3(),_tangent2:new THREE.Vector3(),_orientationEuler:new THREE.Euler(0,0,0,"YXZ"),simPosition:new THREE.Vector3(),previousSimPosition:new THREE.Vector3(),simQuaternion:new THREE.Quaternion(),previousSimQuaternion:new THREE.Quaternion(),heading:null,pitch:0,angleOfAttack:0,bank:0,targetBank:0,lodTier:"full",dynamicLightsActive:false,detailedShadowsActive:false,parkedPosition:null,manualControl:false,manualThrottle:0,manualEnginePower:0,manualAirborne:false,manualVerticalSpeed:0,manualRollRate:0,manualSideslip:0,manualElevator:0};
      this.aircraft.push(aircraft);
      if(descriptor.airportId){this.occupyStand(aircraft,descriptor.airportId,descriptor.stand);aircraft.parkedPosition=this.parkedPositionFor(this.airportById.get(descriptor.airportId),descriptor.stand);this.prepareNextLeg(aircraft);}else{const origin=this.airportById.get(aircraft.originAirportId),destination=this.airportById.get(aircraft.destinationAirportId);this.setAircraftPaths(aircraft,this.buildLegPaths(origin,destination,aircraft.departureStandIndex,0));if(descriptor.reserveStand)this.reserveArrivalStand(aircraft);if(["descent","approach","landingRoll","runwayExit"].includes(descriptor.state))this.requestRunway(aircraft,aircraft.destinationAirportId);else if(descriptor.state==="takeoff")this.requestRunway(aircraft,aircraft.originAirportId);}
      this.placeAircraft(aircraft,{snap:true});
    }
    this.updateGateDockVisibility();
  }

  transition(aircraft,state){
    if(state==="takeoff"&&this.runwayOwners.get(aircraft.originAirportId)!==aircraft.id)this.requestRunway(aircraft,aircraft.originAirportId??this.definition.id);
    aircraft.state=state;aircraft.progress=0;aircraft.stateTime=0;aircraft.doorsOpen=DOOR_OPEN_STATES.has(state);
  }
  stateCurve(aircraft){return aircraft.paths[aircraft.state]??null;}
  targetSpeedFor(aircraft){
    const p=THREE.MathUtils.clamp(aircraft.progress,0,1),cruise=this.aviation.cruiseSpeed??AIRCRAFT_SPEED.enroute;let speed=AIRCRAFT_SPEED[aircraft.state]??8;
    if(aircraft.state==="taxiOut")speed=THREE.MathUtils.lerp(8,.9,smooth01((p-.72)/.28));
    else if(aircraft.state==="takeoff")speed=THREE.MathUtils.lerp(10,AIRCRAFT_SPEED.takeoff,smooth01(p/.46));
    else if(aircraft.state==="enroute")speed=cruise;
    else if(aircraft.state==="holding")speed=Math.min(74,cruise*.84);
    else if(aircraft.state==="goAround")speed=Math.max(70,Math.min(78,cruise*.88));
    else if(aircraft.state==="approach")speed=THREE.MathUtils.lerp(50,34,smooth01((p-.18)/.82));
    else if(aircraft.state==="landingRoll")speed=THREE.MathUtils.lerp(33,6,smooth01(p));
    else if(aircraft.state==="taxiIn")speed=THREE.MathUtils.lerp(7,1.1,smooth01((p-.72)/.28));
    return Math.max(0,speed*CONFIG.aircraftSpeedMultiplier);
  }
  updateAircraftSpeed(aircraft,dt,target){
    const state=aircraft.state,rates=state==="takeoff"?{up:5.2,down:2.2}:state==="goAround"?{up:4.5,down:2.0}:state==="landingRoll"?{up:1.0,down:6.2}:state==="taxiOut"||state==="runwayExit"||state==="taxiIn"?{up:1.8,down:3.2}:state==="approach"||state==="descent"||state==="holding"?{up:2.0,down:2.5}:{up:2.6,down:2.2};
    const rate=target>=aircraft.speed?rates.up:rates.down;aircraft.targetSpeed=target;aircraft.speed=moveToward(aircraft.speed,target,rate*Math.max(0,dt)*CONFIG.aircraftSpeedMultiplier);return aircraft.speed;
  }
  targetAngleOfAttack(aircraft){
    const p=THREE.MathUtils.clamp(aircraft.progress,0,1);
    if(aircraft.state==="takeoff")return THREE.MathUtils.lerp(0,4.2*DEG,smooth01((p-.10)/.35));
    if(aircraft.state==="climb")return 3.0*DEG;if(aircraft.state==="goAround")return 4.0*DEG;if(aircraft.state==="enroute"||aircraft.state==="holding")return 1.0*DEG;if(aircraft.state==="descent")return 1.6*DEG;
    if(aircraft.state==="approach")return THREE.MathUtils.lerp(2.4*DEG,4.8*DEG,smooth01((p-.70)/.30));
    if(aircraft.state==="landingRoll")return THREE.MathUtils.lerp(4.5*DEG,0,smooth01(p/.28));return 0;
  }
  startGoAround(aircraft){
    const currentCurve=this.stateCurve(aircraft),t=THREE.MathUtils.clamp(aircraft.progress,0,.9999),current=currentCurve?currentCurve.getPointAt(t,new THREE.Vector3()):aircraft.simPosition.clone(),tangent=currentCurve?currentCurve.getTangentAt(t,new THREE.Vector3()).normalize():new THREE.Vector3(Math.sin(aircraft.heading??0),0,Math.cos(aircraft.heading??0)),holding=aircraft.paths.holding;
    if(!holding)return false;const merge=holding.getPointAt(0,new THREE.Vector3()),destination=this.airportById.get(aircraft.destinationAirportId),right=destination?localBasis(destination).right:new THREE.Vector3(-tangent.z,0,tangent.x),climb1=current.clone().addScaledVector(tangent,260);climb1.y=Math.max(current.y+55,110);const climb2=current.clone().addScaledVector(tangent,620).addScaledVector(right,260);climb2.y=Math.max(merge.y,climb1.y+35);
    aircraft.paths.goAround=this.worldCurve([current,climb1,climb2,merge.clone()],.30);aircraft.pathLengths.goAround=Math.max(1,aircraft.paths.goAround.getLength());this.releaseRunway(aircraft,aircraft.destinationAirportId);this.transition(aircraft,"goAround");return true;
  }
  sampleAircraftTransform(aircraft,dt=CONFIG.fixedStep,snap=false){
    let desiredYaw=aircraft.heading??0,flightPathPitch=0,targetBank=0;
    if(aircraft.manualControl)return;
    if(SERVICE_STATES.has(aircraft.state)){const airportDef=this.airportById.get(aircraft.currentAirportId)??this.definition;if(aircraft.parkedPosition)aircraft.simPosition.copy(aircraft.parkedPosition);desiredYaw=airportDef.heading+Math.PI/2;}
    else{const curve=this.stateCurve(aircraft);if(!curve)return;const t=THREE.MathUtils.clamp(aircraft.progress,0,.9999),position=curve.getPointAt(t,aircraft._position),tangent=curve.getTangentAt(t,aircraft._tangent).normalize();aircraft.simPosition.copy(position);desiredYaw=Math.atan2(tangent.x,tangent.z);if(aircraft.state==="taxiOut"&&t<.16)desiredYaw+=Math.PI;const length=aircraft.pathLengths[aircraft.state]??curve.getLength(),lookahead=Math.min(.04,Math.max(.002,18/Math.max(1,length))),t2=Math.min(.9999,t+lookahead),tangent2=curve.getTangentAt(t2,aircraft._tangent2).normalize(),yaw2=Math.atan2(tangent2.x,tangent2.z),delta=Math.atan2(Math.sin(yaw2-desiredYaw),Math.cos(yaw2-desiredYaw));flightPathPitch=-Math.asin(THREE.MathUtils.clamp(tangent.y,-1,1));targetBank=["climb","enroute","holding","goAround","descent","approach"].includes(aircraft.state)?THREE.MathUtils.clamp(-delta*2.15,-.30,.30):0;}
    const targetAoA=this.targetAngleOfAttack(aircraft),targetPitch=flightPathPitch-targetAoA,yawRate=(TAXI_CONFLICT_STATES.has(aircraft.state)||aircraft.state==="takeoff"||aircraft.state==="landingRoll"?58:24)*DEG,pitchRate=(aircraft.state==="takeoff"||aircraft.state==="approach"||aircraft.state==="landingRoll"?8:6)*DEG;
    if(snap||aircraft.heading==null){aircraft.heading=desiredYaw;aircraft.pitch=targetPitch;aircraft.angleOfAttack=targetAoA;aircraft.bank=targetBank;}else{aircraft.heading=moveAngleToward(aircraft.heading,desiredYaw,yawRate*Math.max(0,dt));aircraft.angleOfAttack=moveToward(aircraft.angleOfAttack??0,targetAoA,3.2*DEG*Math.max(0,dt));aircraft.pitch=moveToward(aircraft.pitch??0,flightPathPitch-aircraft.angleOfAttack,pitchRate*Math.max(0,dt));aircraft.bank=THREE.MathUtils.lerp(aircraft.bank,targetBank,1-Math.exp(-Math.max(0,dt)*4.2));}
    aircraft.targetBank=targetBank;aircraft._orientationEuler.set(aircraft.pitch,aircraft.heading,aircraft.bank,"YXZ");aircraft.simQuaternion.setFromEuler(aircraft._orientationEuler);
  }
  placeAircraft(aircraft,{snap=false,dt=CONFIG.fixedStep}={}){this.sampleAircraftTransform(aircraft,dt,snap);if(snap){aircraft.previousSimPosition.copy(aircraft.simPosition);aircraft.previousSimQuaternion.copy(aircraft.simQuaternion);}aircraft.mesh.position.copy(aircraft.simPosition);aircraft.mesh.quaternion.copy(aircraft.simQuaternion);}
  rawAircraftTier(distance){const q=qualityManager.current.aircraft;if(distance<=q.fullDistance)return"full";if(distance<=q.mediumDistance)return"medium";if(distance<=q.lowDistance)return"low";if(distance<=q.farDistance)return"far";return"hidden";}
  selectAircraftTier(aircraft,distance,forcedFull=false){if(forcedFull)return"full";const next=this.rawAircraftTier(distance),current=aircraft.lodTier??"full";if(next===current)return current;const order=["full","medium","low","far","hidden"],from=order.indexOf(current),to=order.indexOf(next);if(from<0||to<0)return next;const q=qualityManager.current.aircraft,boundaries=[q.fullDistance,q.mediumDistance,q.lowDistance,q.farDistance],h=q.hysteresis;if(to>from){const boundary=boundaries[Math.min(from,boundaries.length-1)];if(Number.isFinite(boundary)&&distance<boundary*(1+h))return current;}else{const boundary=boundaries[Math.min(to,boundaries.length-1)];if(Number.isFinite(boundary)&&distance>boundary*(1-h))return current;}return next;}
  setAircraftTier(aircraft,tier){if(aircraft.lodTier===tier)return;const groups=aircraft.mesh.userData.lodGroups;for(const [name,group] of Object.entries(groups))group.visible=name===tier;aircraft.lodTier=tier;aircraft.mesh.userData.lodTier=tier;}
  updateAircraftShadows(aircraft,distance){const q=qualityManager.current,full=aircraft.lodTier==="full"&&q.shadow.enabled&&distance<=q.aircraft.detailedShadowDistance,simple=aircraft.lodTier!=="hidden"&&aircraft.lodTier!=="far"&&aircraft.lodTier!=="full"&&q.shadow.enabled&&distance<=q.aircraft.shadowDistance,mode=full?"full":simple?"simple":"off",data=aircraft.mesh.userData;if(data.shadowMode===mode)return;data.shadowMode=mode;for(const mesh of data.fullShadowCasters)mesh.castShadow=full;for(const mesh of data.proxyShadowCasters)mesh.castShadow=simple;aircraft.detailedShadowsActive=full;}
  updateAircraftLights(aircraft,distance,time){const allowed=distance<=qualityManager.current.aircraft.dynamicLightDistance&&aircraft.lodTier!=="hidden",landingLight=["taxiOut","holdShort","taxiIn","runwayExit","takeoff","approach","landingRoll"].includes(aircraft.state),data=aircraft.mesh.userData;data.beacon.intensity=allowed&&Math.sin(time*10)>0?2.1:0;data.noseLight.intensity=allowed&&landingLight?1.9:0;aircraft.dynamicLightsActive=allowed&&(data.beacon.intensity>0||data.noseLight.intensity>0);}
  gearTargetFor(aircraft){const state=aircraft.state;if(state==="manual")return aircraft.manualAirborne&&aircraft.speed>38?0:1;if(SERVICE_STATES.has(state)||["taxiOut","holdShort","approach","landingRoll","runwayExit","taxiIn"].includes(state))return 1;if(state==="takeoff")return aircraft.progress<.55?1:0;if(state==="climb")return aircraft.progress<.12?Math.max(0,1-aircraft.progress/.12):0;if(state==="descent")return smooth01((aircraft.progress-.54)/.28);if(state==="goAround")return Math.max(0,1-smooth01(aircraft.progress/.28));return 0;}
  flapTargetFor(aircraft){const state=aircraft.state;if(state==="manual")return aircraft.manualAirborne?(aircraft.speed<48?.65:.18):(aircraft.speed>20?.42:0);if(state==="takeoff")return .42;if(state==="climb")return .42*(1-smooth01(aircraft.progress/.24));if(state==="descent")return .35*smooth01((aircraft.progress-.35)/.38);if(state==="approach")return .82;if(state==="landingRoll")return 1;if(state==="runwayExit")return .28;if(state==="goAround")return .36*(1-smooth01(aircraft.progress/.45));return 0;}
  updateAircraftConfiguration(aircraft,frameDt){
    const data=aircraft.mesh.userData,k=1-Math.exp(-Math.max(0,frameDt)*3.2),gearTarget=this.gearTargetFor(aircraft),flapTarget=this.flapTargetFor(aircraft);data.gearDeployment=THREE.MathUtils.lerp(data.gearDeployment??1,gearTarget,k);data.flapDeployment=THREE.MathUtils.lerp(data.flapDeployment??0,flapTarget,k);
    if(data.gearGroup){data.gearGroup.visible=data.gearDeployment>.025;data.gearGroup.position.y=(1-data.gearDeployment)*.84;data.gearGroup.rotation.x=(1-data.gearDeployment)*-.34;}
    for(const flap of data.flapMeshes??[])flap.rotation.x=(flap.userData.baseRotationX??0)-data.flapDeployment*18*DEG;for(const slat of data.slatMeshes??[])slat.position.z=(slat.userData.baseZ??slat.position.z)+data.flapDeployment*.13;
  }
  render(alpha,frameDt,player=null){
    const blend=THREE.MathUtils.clamp(alpha,0,1),focus=this.camera?.position??this.chunkManager?.focus,now=performance.now()/1000;this.aircraftLodCounts={full:0,medium:0,low:0,far:0,hidden:0,dynamicLights:0,detailedShadows:0};
    for(const aircraft of this.aircraft){
      aircraft.mesh.position.lerpVectors(aircraft.previousSimPosition,aircraft.simPosition,blend);aircraft.mesh.quaternion.slerpQuaternions(aircraft.previousSimQuaternion,aircraft.simQuaternion,blend);const occupied=this.passengerState?.aircraft===aircraft,distance=focus?aircraft.mesh.position.distanceTo(focus):0,tier=this.selectAircraftTier(aircraft,distance,occupied);this.setAircraftTier(aircraft,tier);this.aircraftLodCounts[tier]=(this.aircraftLodCounts[tier]??0)+1;this.updateAircraftShadows(aircraft,distance);this.updateAircraftLights(aircraft,distance,now);this.updateAircraftConfiguration(aircraft,frameDt);if(aircraft.dynamicLightsActive)this.aircraftLodCounts.dynamicLights++;if(aircraft.detailedShadowsActive)this.aircraftLodCounts.detailedShadows++;
      const door=aircraft.mesh.userData.door,target=aircraft.doorsOpen?1:0;door.userData.amount=THREE.MathUtils.lerp(door.userData.amount??0,target,1-Math.exp(-Math.max(0,frameDt)*4));door.position.x=aircraft.mesh.userData.doorClosedX+door.userData.amount*.16;door.position.z=(aircraft.mesh.userData.doorClosedZ??4.35)-door.userData.amount*.92;
    }this.updatePassengerView(player);
  }

  advancePath(aircraft,dt,speed){const length=aircraft.pathLengths[aircraft.state]??1;aircraft.progress+=speed*dt/length;return aircraft.progress>=1;}
  update(dt,time,player=null){
    this.activeFlights=0;
    if(!this.passengerState&&player&&!player.inAircraft&&!player.inVehicle&&!player.inTrain&&!player.inBus)for(const aircraft of this.aircraft){if(SERVICE_STATES.has(aircraft.state)&&this.isPlayerInsideAircraft(player,aircraft)){this.attachPassenger(player,aircraft);break;}}
    for(const aircraft of this.aircraft){
      aircraft.previousSimPosition.copy(aircraft.simPosition);aircraft.previousSimQuaternion.copy(aircraft.simQuaternion);aircraft.stateTime+=dt;aircraft.doorsOpen=DOOR_OPEN_STATES.has(aircraft.state);
      if(aircraft.manualControl){aircraft.doorsOpen=false;this.updateManualAircraft(aircraft,dt);if(aircraft.manualAirborne)this.activeFlights++;this.enforceGroundSeparation(aircraft);aircraft.mesh.position.copy(aircraft.simPosition);aircraft.mesh.quaternion.copy(aircraft.simQuaternion);continue;}
      if(aircraft.state==="parked"){
        aircraft.speed=0;aircraft.targetSpeed=0;if(aircraft.stateTime>9+(aircraft.standIndex??0)*2.1&&this.canDepartAirport(aircraft.currentAirportId))this.beginDeparture(aircraft);
      }else if(aircraft.state==="turnaround"){
        aircraft.speed=0;aircraft.targetSpeed=0;if(aircraft.stateTime>(this.aviation.turnaroundSeconds??9))this.transition(aircraft,"boarding");
      }else if(aircraft.state==="boarding"){
        aircraft.speed=0;aircraft.targetSpeed=0;if(aircraft.stateTime>(this.aviation.boardingSeconds??10))this.transition(aircraft,"prepare");
      }else if(aircraft.state==="prepare"){
        aircraft.speed=0;aircraft.targetSpeed=0;if(aircraft.stateTime>(this.aviation.prepareSeconds??3)&&this.canDepartAirport(aircraft.currentAirportId))this.beginDeparture(aircraft);
      }else if(aircraft.state==="holdShort"){
        aircraft.speed=0;aircraft.targetSpeed=0;if(!this.arrivalReadyForRunway(aircraft.originAirportId,aircraft)&&this.requestRunway(aircraft,aircraft.originAirportId))this.transition(aircraft,"takeoff");
      }else{
        // A landing clearance is never represented by stopping in the sky. If an
        // arrival somehow loses runway ownership, it immediately follows a
        // continuous go-around path back to the holding pattern.
        if(["descent","approach"].includes(aircraft.state)&&this.runwayOwners.get(aircraft.destinationAirportId)!==aircraft.id&&!this.requestRunway(aircraft,aircraft.destinationAirportId))this.startGoAround(aircraft);
        if(aircraft.state==="enroute"&&aircraft.progress>.72)this.reserveArrivalStand(aircraft);
        if(aircraft.state==="holding"){
          this.reserveArrivalStand(aircraft);
          if(aircraft.destinationStandIndex!=null&&aircraft.progress>.80&&this.runwayOwners.get(aircraft.destinationAirportId)!==aircraft.id)this.requestRunway(aircraft,aircraft.destinationAirportId);
        }
        let target=this.targetSpeedFor(aircraft);const queueLimit=this.queueSpeedLimit(aircraft);if(Number.isFinite(queueLimit))target=Math.min(target,queueLimit);const speed=this.updateAircraftSpeed(aircraft,dt,target);if(ACTIVE_FLIGHT_STATES.has(aircraft.state))this.activeFlights++;
        const finished=speed>0&&this.advancePath(aircraft,dt,speed);
        if(finished){
          if(aircraft.state==="taxiOut")this.transition(aircraft,"holdShort");
          else if(aircraft.state==="takeoff"){this.releaseRunway(aircraft,aircraft.originAirportId);this.transition(aircraft,"climb");aircraft.currentAirportId=null;}
          else if(aircraft.state==="climb")this.transition(aircraft,"enroute");
          else if(aircraft.state==="enroute"){if(this.reserveArrivalStand(aircraft)&&this.requestRunway(aircraft,aircraft.destinationAirportId))this.transition(aircraft,"descent");else this.transition(aircraft,"holding");}
          else if(aircraft.state==="holding"){if(aircraft.destinationStandIndex!=null&&this.runwayOwners.get(aircraft.destinationAirportId)===aircraft.id)this.transition(aircraft,"descent");else aircraft.progress%=1;}
          else if(aircraft.state==="goAround")this.transition(aircraft,"holding");
          else if(aircraft.state==="descent"){if(this.runwayOwners.get(aircraft.destinationAirportId)===aircraft.id)this.transition(aircraft,"approach");else this.startGoAround(aircraft);}
          else if(aircraft.state==="approach"){if(this.runwayOwners.get(aircraft.destinationAirportId)===aircraft.id)this.transition(aircraft,"landingRoll");else this.startGoAround(aircraft);}
          else if(aircraft.state==="landingRoll")this.transition(aircraft,"runwayExit");
          else if(aircraft.state==="runwayExit"){this.releaseRunway(aircraft,aircraft.destinationAirportId);this.transition(aircraft,"taxiIn");}
          else if(aircraft.state==="taxiIn")this.arriveAtStand(aircraft);
        }
      }
      this.placeAircraft(aircraft,{dt});this.enforceGroundSeparation(aircraft);
    }
    this.updateGateDockVisibility();this.updateIslandVisibility();this.updatePassengerRide(dt,player);
  }


  isPassengerAccessiblePosition(position){
    for(const airportDef of this.airportDefinitions){const local=this.worldToAirportLocalFor(airportDef,position);for(const surface of this.walkSurfaces){if((surface.airportDef??this.definition)!==airportDef)continue;if(surface.requiresParkedAircraft&&!this.openAircraftAtGate(surface.gateIndex))continue;if(surface.requiresIslandAircraft&&!this.aircraftAtIslandStand(surface.standIndex))continue;if((surface.role?.includes("boarding-bridge")||surface.role?.includes("stairs"))&&this.sampleLocalWalkSurface(surface,local))return true;}}
    for(const aircraft of this.aircraft){
      if(!SERVICE_STATES.has(aircraft.state))continue;const cabin=this.aircraftLocalPosition(aircraft,position),zMin=aircraft.mesh.userData.cabinMinZ??-4.55,zMax=aircraft.mesh.userData.cabinMaxZ??4.55;
      if(cabin.z>=zMin&&cabin.z<=zMax&&(Math.abs(cabin.x)<=.44||(cabin.z>=3.35&&cabin.x>=-.42&&cabin.x<=1.24)))return true;
    }
    return false;
  }

  isRestrictedPosition(position){
    for(const d of this.airportDefinitions){const local=this.worldToAirportLocalFor(d,position);if(Math.abs(local.x)>=d.perimeterHalfW||Math.abs(local.z)>=d.perimeterHalfD)continue;if(local.z<d.terminalOffset-10)return true;}return false;
  }
  getStats(){const airports={};for(const airport of this.airportDefinitions)airports[airport.id]={name:airport.name,code:airport.code,available:this.serviceCount(airport.id),inboundSoon:this.inboundSoon(airport.id),standOccupancy:[...(this.standOccupancy.get(airport.id)??[])]};return{aircraft:this.aircraft.length,activeFlights:this.activeFlights,completedCycles:this.completedCycles,airports,lod:{...(this.aircraftLodCounts??{})}};}
}
