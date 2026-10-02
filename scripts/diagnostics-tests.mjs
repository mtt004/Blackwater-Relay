import assert from "node:assert/strict";
import * as THREE from "three";
import { DiagnosticsManager,serialiseDiagnosticValue } from "../src/core/DiagnosticsManager.js";
import { StructureBoundaryOverlay } from "../src/core/StructureBoundaryOverlay.js";

let passed=0;
function test(name,fn){
  try{fn();passed++;console.log(`PASS ${name}`);}
  catch(error){console.error(`FAIL ${name}`);throw error;}
}

function environment(){
  let now=0;
  const listeners=new Map(),downloads=[];
  const previousWindow=globalThis.window;
  globalThis.window={
    addEventListener(type,listener){if(!listeners.has(type))listeners.set(type,new Set());listeners.get(type).add(listener);},
    removeEventListener(type,listener){listeners.get(type)?.delete(listener);}
  };
  const manager=new DiagnosticsManager({
    now:()=>now,
    wallClock:()=>new Date(Date.UTC(2026,6,21,13,0,0)+now),
    downloadHandler:(filename,json)=>downloads.push({filename,json})
  });
  const setNow=value=>{now=value;};
  const restore=()=>{if(previousWindow===undefined)delete globalThis.window;else globalThis.window=previousWindow;};
  return{manager,listeners,downloads,setNow,restore};
}

function start(manager,runtime={}){
  return manager.startSession({gameVersion:"test",userAgent:"diagnostics-test",viewport:{width:1280,height:720,devicePixelRatio:1},configuration:{seed:42},runtime});
}

test("disabled mode creates no records",()=>{
  const env=environment();
  try{
    assert.equal(env.manager.logEvent("test","ignored",{value:1}),false);
    assert.equal(env.manager.recordCollision({pairKey:"a|b|x"}),false);
    env.manager.beginFrame(0);env.manager.beginSystem("traffic");env.manager.endSystem("traffic");env.manager.endFrame(20);
    assert.equal(env.manager.getCurrentSessionForTests(),null);
  }finally{env.restore();}
});

test("starting creates a clean session and restart does not retain records",()=>{
  const env=environment();
  try{
    start(env.manager);env.manager.logEvent("test","first-session-marker",{});
    env.manager.stopSession({download:false,clearAfterExport:true});
    env.setNow(1000);start(env.manager);
    assert.equal(env.manager.getCurrentSessionForTests().events.some(event=>event.type==="first-session-marker"),false);
  }finally{env.manager.clearSession();env.restore();}
});

test("events record only while enabled",()=>{
  const env=environment();
  try{
    start(env.manager);env.manager.logEvent("player","entered-car",{id:"player-car"});
    assert.equal(env.manager.getCurrentSessionForTests().events.some(event=>event.type==="entered-car"),true);
    env.manager.stopSession({download:false,clearAfterExport:false});
    const count=env.manager.getCurrentSessionForTests().events.length;
    env.manager.logEvent("player","must-not-record",{});
    assert.equal(env.manager.getCurrentSessionForTests().events.length,count);
  }finally{env.manager.clearSession();env.restore();}
});

test("collision contacts deduplicate and emit start/end",()=>{
  const env=environment();
  try{
    start(env.manager);const collision={pairKey:"car-1|car-2|vehicle",collisionCategory:"vehicle-to-vehicle",entityA:{id:"car-1"},entityB:{id:"car-2"},penetrationDepth:.2};
    env.manager.recordCollision(collision);env.setNow(50);env.manager.recordCollision(collision);
    assert.equal(env.manager.getCurrentSessionForTests().collisions.filter(item=>item.type==="collision-start").length,1);
    env.setNow(250);env.manager.beginFrame(250);env.manager.endFrame(251);
    assert.equal(env.manager.getCurrentSessionForTests().collisions.filter(item=>item.type==="collision-end").length,1);
  }finally{env.manager.clearSession();env.restore();}
});

test("railway state changes log only when values change",()=>{
  const env=environment();
  const signal={id:"sig-1",aspect:"green",clearedFor:"train-1",position:new THREE.Vector3(1,2,3)};
  const runtime={rail:{trains:[],network:{blocks:[],signals:[signal],platforms:[]},dispatcher:{recoveryCount:0},interlocking:{diagnostics:()=>({deniedRequests:0})}},toast:()=>{}};
  try{
    start(env.manager,runtime);signal.aspect="yellow";env.setNow(200);env.manager.observeRuntime(200,true);
    const count=env.manager.getCurrentSessionForTests().events.filter(event=>event.type==="signal-aspect-changed").length;
    env.setNow(400);env.manager.observeRuntime(400,true);
    assert.equal(count,1);assert.equal(env.manager.getCurrentSessionForTests().events.filter(event=>event.type==="signal-aspect-changed").length,1);
  }finally{env.manager.clearSession();env.restore();}
});

test("performance sampling respects frequency and retains long frames",()=>{
  const env=environment();
  try{
    start(env.manager);
    env.setNow(0);env.manager.beginFrame(0);env.setNow(10);env.manager.endFrame(10);
    env.setNow(20);env.manager.beginFrame(20);env.setNow(30);env.manager.endFrame(30);
    env.setNow(140);env.manager.beginFrame(140);env.setNow(150);env.manager.endFrame(150);
    let summary=env.manager.getSummary();assert.equal(summary.performanceSamples,2);
    env.setNow(200);env.manager.beginFrame(200);env.setNow(240);env.manager.endFrame(240);summary=env.manager.getSummary();assert.equal(summary.severeFrameCount,1);assert.equal(summary.performanceSamples,3);
  }finally{env.manager.clearSession();env.restore();}
});

test("collision starts force a detailed frame record",()=>{
  const env=environment();
  try{start(env.manager);env.manager.beginFrame(0);env.manager.recordCollision({pairKey:"a|b|detail",collisionCategory:"vehicle-to-vehicle",entityA:{id:"a"},entityB:{id:"b"}});env.setNow(8);env.manager.endFrame(8);const result=env.manager.stopSession({download:false,clearAfterExport:false});assert.equal(result.data.performance.detailedFrames.length,1);assert.ok(result.data.performance.detailedFrames[0].reasons.some(reason=>reason.startsWith("collision:")));}
  finally{env.manager.clearSession();env.restore();}
});

test("record limits cap buffers and count dropped records",()=>{
  const env=environment();env.manager.limits.maxEvents=5;
  try{
    start(env.manager);for(let index=0;index<20;index++)env.manager.logEvent("limit",`event-${index}`,{index});
    const state=env.manager.getCurrentSessionForTests();assert.equal(state.events.length,5);assert.ok(state.dropped.events>0);
  }finally{env.manager.clearSession();env.restore();}
});

test("safe serialiser handles circular values without invoking getters",()=>{
  const value={name:"root"};value.self=value;Object.defineProperty(value,"danger",{enumerable:true,get(){throw new Error("getter invoked");}});
  const output=serialiseDiagnosticValue(value);assert.equal(output.self,"[Circular]");assert.equal("danger" in output,false);
});

test("safe serialiser preserves errors and Three.js vectors",()=>{
  const error=serialiseDiagnosticValue(new Error("diagnostic failure"));assert.equal(error.message,"diagnostic failure");assert.equal(typeof error.stack,"string");
  assert.deepEqual(serialiseDiagnosticValue(new THREE.Vector3(4,5,6)),{x:4,y:5,z:6});
});

test("stopping exports valid schema and empty sessions",()=>{
  const env=environment();
  try{
    start(env.manager);env.setNow(2500);const result=env.manager.stopSession({download:true,clearAfterExport:true});
    assert.equal(result.ok,true);assert.equal(env.downloads.length,1);const data=JSON.parse(env.downloads[0].json);assert.equal(data.schemaVersion,2);assert.equal(data.session.durationSeconds,2.5);assert.ok(Array.isArray(data.events));assert.ok(Array.isArray(data.collisions));assert.ok(env.downloads[0].filename.endsWith(".json"));
  }finally{env.restore();}
});

test("object boundaries are captured only during an enabled session",()=>{
  const env=environment(),records=[{id:"bld-1",category:"building",position:{x:1,y:0,z:2},dimensions:{width:4,depth:6,height:8},footprintVertices:[{x:-1,z:-1},{x:1,z:-1},{x:1,z:1},{x:-1,z:1}]}];
  try{
    env.manager.setObjectBoundarySetting(true,{provider:()=>records});assert.equal(env.manager.getCurrentSessionForTests(),null);
    env.manager.startSession({gameVersion:"test",userAgent:"diagnostics-test",viewport:{width:1280,height:720,devicePixelRatio:1},configuration:{seed:42},diagnosticSettings:{objectBoundaries:true},objectBoundaryProvider:()=>records,runtime:{}});
    const state=env.manager.getCurrentSessionForTests();assert.equal(state.objectBoundaries.length,1);assert.equal(state.objectBoundaries[0].id,"bld-1");assert.equal(state.events.filter(event=>event.type==="object-boundary-catalogue-captured").length,1);
  }finally{env.manager.clearSession();env.restore();}
});

test("object boundary capture deduplicates and respects limits",()=>{
  const env=environment();env.manager.limits.maxObjectBoundaries=2;const records=[{id:"a",category:"building"},{id:"b",category:"structure"},{id:"c",category:"structure"}];
  try{
    env.manager.startSession({gameVersion:"test",diagnosticSettings:{objectBoundaries:true},objectBoundaryProvider:()=>records,runtime:{}});env.manager.captureObjectBoundaries({source:"repeat"});
    const state=env.manager.getCurrentSessionForTests();assert.equal(state.objectBoundaries.length,2);assert.equal(state.dropped.objectBoundaries,2);
    const result=env.manager.stopSession({download:false,clearAfterExport:false});assert.equal(result.data.objectBoundaries.count,2);assert.equal(result.data.summary.objectBoundaryCountByCategory.building,1);assert.equal(result.data.summary.objectBoundaryCountByCategory.structure,1);
  }finally{env.manager.clearSession();env.restore();}
});

test("structure boundary overlay uses visual bounds and remains lazy",()=>{
  const scene=new THREE.Scene(),collider={id:"bld-1",x:10,z:20,w:8,d:6,visualHalfW:4,visualHalfD:3,visualHeight:12,collisionHalfW:3.92,collisionHalfD:2.92,collisionRotation:0,boundaryCategory:"building"};
  const railSystem={walkBlockers:[{name:"ticket-desk",stationId:"central",centre:new THREE.Vector3(2,0,3),forward:new THREE.Vector3(0,0,1),right:new THREE.Vector3(1,0,0),halfLength:.45,halfWidth:1.21,visualHalfLength:.46,visualHalfWidth:1.225,minimumHeight:.04,maximumHeight:1.22,visualMinimumHeight:.04,visualMaximumHeight:1.22}]};
  const overlay=new StructureBoundaryOverlay(scene,{colliders:[collider],railSystem});assert.equal(overlay.group,null);assert.equal(overlay.getBoundaryRecords().length,2);assert.equal(overlay.getBoundaryRecords()[0].dimensions.width,8);assert.equal(overlay.getBoundaryRecords()[0].collisionProfile.halfWidth,3.92);
  overlay.setEnabled(true);assert.ok(overlay.group);assert.equal(overlay.group.visible,true);overlay.setEnabled(false);assert.equal(overlay.group.visible,false);overlay.dispose();
});

test("temporary listeners are removed and console methods unchanged",()=>{
  const env=environment(),original={log:console.log,warn:console.warn,error:console.error};
  try{
    start(env.manager);assert.equal(env.listeners.get("error")?.size,1);assert.equal(env.listeners.get("unhandledrejection")?.size,1);
    env.manager.stopSession({download:true,clearAfterExport:true});assert.equal(env.listeners.get("error")?.size,0);assert.equal(env.listeners.get("unhandledrejection")?.size,0);assert.equal(console.log,original.log);assert.equal(console.warn,original.warn);assert.equal(console.error,original.error);
  }finally{env.restore();}
});

test("successful export clears completed session memory",()=>{
  const env=environment();
  try{start(env.manager);env.manager.logEvent("test","temporary",{large:"x".repeat(100)});env.manager.stopSession({download:true,clearAfterExport:true});assert.equal(env.manager.getCurrentSessionForTests(),null);assert.equal(env.manager.isEnabled(),false);assert.ok(env.manager.getSummary());}
  finally{env.restore();}
});

test("failed download keeps data and supports retry",()=>{
  let now=0,attempts=0;const manager=new DiagnosticsManager({now:()=>now,wallClock:()=>new Date(Date.UTC(2026,6,21,13,0,0)+now),downloadHandler:()=>{attempts++;if(attempts===1)throw new Error("blocked download");}});
  start(manager);manager.logEvent("test","retain-on-failure",{value:7});now=500;const first=manager.stopSession({download:true,clearAfterExport:true});assert.equal(first.ok,false);assert.ok(manager.pendingExport);assert.ok(manager.getCurrentSessionForTests());const retry=manager.retryPendingExport();assert.equal(retry.ok,true);assert.equal(attempts,2);assert.equal(manager.getCurrentSessionForTests(),null);
});

console.log(`Diagnostics tests passed: ${passed}`);
