import { writeFileSync } from "node:fs";
import * as THREE from "three";
import { DiagnosticsManager } from "../src/core/DiagnosticsManager.js";

let now=0,exported=null;
const manager=new DiagnosticsManager({
  now:()=>now,
  wallClock:()=>new Date(Date.UTC(2026,6,21,15,12,18)+now),
  downloadHandler:(filename,json)=>{exported={filename,json};}
});
const position=new THREE.Vector3(120.5,7.2,-84.9),signal={id:"city-t0-b12-signal",aspect:"green",clearedFor:"city-stopper-01",position};
const train={id:"city-stopper-01",serviceId:"city-stopper-01",routeId:"city",trackIndex:0,direction:1,progress:.28,speed:21,headPosition:position,signalAspect:"green",movementAuthority:{distance:420,endBlockId:"city-t0-b16"},doorsOpen:false,dwell:0,waitingAtSignal:false,formation:{totalLength:132},service:{delaySeconds:4}};
const objectBoundaries=[
  {id:"bld-0042",category:"building",objectType:"cbd-building",source:"procedural-city",position:{x:104,y:0,z:-68},rotationY:.14,dimensions:{width:18,depth:12,height:31,minimumY:0,maximumY:31},footprintVertices:[{x:95.93,z:-75.2},{x:113.75,z:-72.69},{x:112.07,z:-60.8},{x:94.25,z:-63.31}],collisionProfile:{halfWidth:8.92,halfDepth:5.92,rotation:.14},district:"cbd",chunkKey:"0:-1"},
  {id:"station:industrial-exchange:ticket-desk",category:"structure",objectType:"station-ticket-desk",source:"rail-walk-blocker",position:{x:118.1,y:.04,z:-82.1},rotationY:0,dimensions:{width:2.45,depth:.92,height:1.18,minimumY:.04,maximumY:1.22},footprintVertices:[{x:116.875,z:-82.56},{x:119.325,z:-82.56},{x:119.325,z:-81.64},{x:116.875,z:-81.64}],collisionProfile:{halfWidth:1.21,halfLength:.45,minimumHeight:.04,maximumHeight:1.22},stationId:"industrial-exchange",structureName:"ticket-desk"}
];
const runtime={rail:{trains:[train],network:{blocks:[{id:"city-t0-b12",occupiedBy:new Set([train.id]),reservedBy:train.id}],signals:[signal],platforms:[]},dispatcher:{deadlockRecoveryCount:0},interlocking:{diagnostics:()=>({deniedRequests:0})},stationOperations:{platformForTrain:()=>null}},traffic:{vehicles:[]},pedestrians:{agents:[]},airport:{aircraft:[]},police:{pursuitActive:false,wantedLevel:0,units:[],offences:[]},incidents:{incidents:[]},weather:{mode:"clear",timeOfDay:13.7,clockText:()=>"13:42"},player:{inTrain:true,inBus:false,inVehicle:false,camera:{position}},chunkManager:{chunks:new Map(),currentKey:"0:0"},toast:()=>{}};
manager.startSession({gameVersion:"2026.07.21-diagnostics-boundaries-1",userAgent:"Example Browser",viewport:{width:1920,height:1080,devicePixelRatio:1.25},configuration:{fixedStep:1/60,trains:12,trafficVehicles:64,pedestrians:120,diagnosticExample:true},diagnosticSettings:{objectBoundaries:true},objectBoundaryProvider:()=>objectBoundaries,runtime});
now=120;manager.logEvent("player","entered-train",{trainId:train.id,mode:"passenger",vehicleIndex:2,doorSide:-1,platformSide:-1},{entityId:train.id,position});
now=260;manager.beginFrame(260);manager.beginSystem("railway");now=260.8;manager.endSystem("railway");manager.beginSystem("render");now=265.2;manager.endSystem("render");now=278;manager.endFrame(278,{renderer:{render:{calls:5223,triangles:1864000,lines:2140,points:96},memory:{geometries:2286,textures:72}},visibleObjects:6810});
now=420;manager.recordCollision({pairKey:"player|station:industrial-exchange:wall-east|station-blocker",collisionCategory:"walking-player-to-station-blocker",entityA:{id:"player",type:"walking-player",position:{x:118.4,y:7.2,z:-82.1},speed:6,controlledByPlayer:true},entityB:{id:"station:industrial-exchange:wall-east",type:"station-blocker",position:{x:118.1,y:0,z:-82.1},stationId:"industrial-exchange"},contactPoint:{x:118.35,y:1,z:-82.1},clearanceRadius:.2,penetrationDepth:.04,appliedCorrection:{movementRejected:true},resolved:true,reason:"Walking clearance circle entered fitted station wall blocker",profile:{name:"station-wall-east",dimensions:{halfLength:6.8,halfWidth:.14,minimumHeight:0,maximumHeight:3.1}}});
now=620;manager.beginFrame(620);now=637;manager.endFrame(637,{renderer:{render:{calls:5231,triangles:1869000,lines:2140,points:96},memory:{geometries:2287,textures:72}},visibleObjects:6822});
now=900;manager.logSystemWarning("dispatcher","Train waiting unusually long",{trainId:train.id,signalAspect:"red",waitSeconds:78});
now=1100;manager.logError(new Error("Example handled diagnostics error"),{system:"example",recoverable:true});
now=1600;manager.stopSession({download:true,clearAfterExport:true});
if(!exported)throw new Error("Example export was not generated");
writeFileSync("DIAGNOSTICS_EXAMPLE.json",exported.json);console.log(`Wrote ${exported.filename} as DIAGNOSTICS_EXAMPLE.json`);
