import { performance } from "node:perf_hooks";
import { writeFileSync,mkdirSync } from "node:fs";
import { DiagnosticsManager } from "../src/core/DiagnosticsManager.js";

function median(values){const sorted=[...values].sort((a,b)=>a-b);return sorted[Math.floor(sorted.length/2)];}
function benchmark(fn,iterations,repeats=7){
  const values=[];for(let repeat=0;repeat<repeats;repeat++){fn(Math.min(2000,iterations));const start=performance.now();fn(iterations);values.push(performance.now()-start);}return{medianMs:median(values),runsMs:values};
}
function mockRuntime(){
  const position={x:0,y:0,z:0};
  const blocks=Array.from({length:304},(_,index)=>({id:`block-${index}`,occupiedBy:new Set(),reservedBy:null}));
  const signals=Array.from({length:304},(_,index)=>({id:`signal-${index}`,aspect:"green",clearedFor:null,position}));
  const platforms=Array.from({length:45},(_,index)=>({id:`platform-${index}`,reservedBy:null,occupiedBy:null,status:"AVAILABLE"}));
  const trains=Array.from({length:12},(_,index)=>({id:`train-${index}`,serviceId:`service-${index}`,routeId:index%3?"city":"airport",trackIndex:index%4,direction:index%2?1:-1,progress:index/12,speed:25,headPosition:position,signalAspect:"green",movementAuthority:{distance:500,endBlockId:`block-${index}`},doorsOpen:false,dwell:0,waitingAtSignal:false,formation:{totalLength:132},service:{delaySeconds:0}}));
  const vehicles=Array.from({length:64},(_,index)=>({id:`vehicle-${index}`,kind:index%10===0?"bus":"car",laneId:`lane-${index%36}`,route:[`node-${index%20}`,`node-${(index+3)%20}`],routeIndex:0,laneChange:null,stuckTime:0,dwellReason:null,renderTier:index<20?"full":"low",mesh:{position}}));
  const agents=Array.from({length:120},(_,index)=>({id:`ped-${index}`,route:[`p-${index%20}`,`p-${(index+2)%20}`],index:0,activity:"walking",accessingTarget:false,wait:0,mesh:{position}}));
  const aircraft=Array.from({length:3},(_,index)=>({id:`aircraft-${index}`,state:"parked",gateIndex:index,cycles:0,mesh:{position}}));
  return{rail:{trains,network:{blocks,signals,platforms},dispatcher:{deadlockRecoveryCount:0},interlocking:{diagnostics:()=>({deniedRequests:0})},stationOperations:{platformForTrain:()=>null}},traffic:{vehicles},pedestrians:{agents},airport:{aircraft},police:{pursuitActive:false,wantedLevel:0,units:[],offences:[]},incidents:{incidents:[]},weather:{mode:"clear",timeOfDay:12,clockText:()=>"12:00"},player:{inTrain:false,inBus:false,inVehicle:true,position,camera:{position}},chunkManager:{chunks:new Map(),currentKey:"0:0"},scene:null,toast:()=>{}};
}

const disabledIterations=400000,enabledIterations=12000;
let syntheticNow=0;
const manager=new DiagnosticsManager({now:()=>syntheticNow,wallClock:()=>new Date(Date.UTC(2026,6,21,13,0,0)+syntheticNow),downloadHandler:()=>{}});
const baseline=benchmark(iterations=>{let sink=0;for(let index=0;index<iterations;index++)sink+=index&1;return sink;},disabledIterations);
const disabled=benchmark(iterations=>{for(let index=0;index<iterations;index++){manager.beginFrame(index);manager.setSimulationTime(index/60);manager.beginSystem("player");manager.endSystem("player");manager.beginSystem("railway");manager.endSystem("railway");manager.beginSystem("traffic");manager.endSystem("traffic");manager.addSystemTiming("dispatcher",0);manager.endFrame(index+16.67,{renderer:null});}},disabledIterations);

const runtime=mockRuntime();
const enabledRuns=[];
for(let repeat=0;repeat<7;repeat++){
  syntheticNow=0;manager.startSession({gameVersion:"benchmark",configuration:{scenario:"representative-mock"},runtime});
  const start=performance.now();
  for(let index=0;index<enabledIterations;index++){
    syntheticNow=index*16.67;manager.beginFrame(syntheticNow);manager.setSimulationTime(index/60);manager.beginSystem("player");manager.endSystem("player");manager.beginSystem("railway");manager.endSystem("railway");manager.beginSystem("traffic");manager.endSystem("traffic");manager.addSystemTiming("dispatcher",.05);manager.endFrame(syntheticNow+16,{renderer:{render:{calls:5200,triangles:1800000,lines:2200,points:120},memory:{geometries:2300,textures:80}}});
  }
  enabledRuns.push(performance.now()-start);manager.stopSession({download:false,clearAfterExport:true});
}
const enabled={medianMs:median(enabledRuns),runsMs:enabledRuns};
const baselinePerCallUs=baseline.medianMs/disabledIterations*1000,disabledPerFrameUs=disabled.medianMs/disabledIterations*1000,disabledNetUs=Math.max(0,disabledPerFrameUs-baselinePerCallUs),enabledPerFrameUs=enabled.medianMs/enabledIterations*1000;
const result={
  measuredAt:new Date().toISOString(),runtime:`Node ${process.version}`,
  methodology:{disabledIterations,enabledIterations,repeats:7,enabledRuntimeShape:{trains:12,blocks:304,signals:304,platforms:45,trafficVehicles:64,pedestrians:120,aircraft:3},note:"Synthetic API microbenchmark; not a browser FPS benchmark."},
  disabled:{medianTotalMs:disabled.medianMs,baselineLoopMedianMs:baseline.medianMs,estimatedNetMicrosecondsPerFrame:disabledNetUs,rawMicrosecondsPerFrame:disabledPerFrameUs,runsMs:disabled.runsMs},
  enabled:{medianTotalMs:enabled.medianMs,microsecondsPerFrame:enabledPerFrameUs,runsMs:enabled.runsMs}
};
mkdirSync("benchmarks",{recursive:true});writeFileSync("benchmarks/diagnostics-overhead.json",JSON.stringify(result,null,2));console.log(JSON.stringify(result,null,2));
