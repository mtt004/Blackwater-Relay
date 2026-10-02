const SCHEMA_VERSION=2;
const DEFAULT_SAMPLE_INTERVAL_MS=125;
const STATUS_INTERVAL_MS=250;
const CONTACT_END_DELAY_MS=160;
const MAX_SERIALISE_DEPTH=7;
const MAX_SERIALISE_ARRAY=256;
const MAX_SERIALISE_STRING=16000;

export const DIAGNOSTIC_LIMITS=Object.freeze({
  maxEvents:50000,
  maxCollisions:10000,
  maxWarnings:5000,
  maxErrors:2000,
  maxPerformanceSamples:18000,
  maxLongFrames:5000,
  maxObjectBoundaries:15000
});

const SYSTEM_NAMES=Object.freeze([
  "simulation","render","railway","dispatcher","traffic","pedestrians","collisions",
  "police","airport","player","streaming","chunkGeneration","hud","minimap"
]);
const SYSTEM_INDEX=new Map(SYSTEM_NAMES.map((name,index)=>[name,index]));
const PERFORMANCE_FIELDS=Object.freeze([
  "timeMs","frameMs","simulationMs","renderMs","railwayMs","dispatcherMs","trafficMs",
  "pedestriansMs","collisionsMs","policeMs","airportMs","playerMs","streamingMs",
  "chunkGenerationMs","hudMs","minimapMs","drawCalls","triangles","lines","points",
  "geometries","textures","visibleObjects","heapBytes"
]);

const finite=value=>Number.isFinite(value)?value:0;
const timestampFilename=date=>date.toISOString().replace(/[:.]/g,"-");
const copyPosition=value=>value&&Number.isFinite(value.x)&&Number.isFinite(value.z)?{x:finite(value.x),y:finite(value.y),z:finite(value.z)}:undefined;

function safePropertyEntries(value){
  try{
    const descriptors=Object.getOwnPropertyDescriptors(value),entries=[];
    for(const key of Object.keys(descriptors)){
      const descriptor=descriptors[key];
      if(!("value" in descriptor))continue;
      entries.push([key,descriptor.value]);
    }
    return entries;
  }catch{return[];}
}

export function serialiseDiagnosticValue(value,{maxDepth=MAX_SERIALISE_DEPTH,maxArrayLength=MAX_SERIALISE_ARRAY,maxStringLength=MAX_SERIALISE_STRING}={}){
  const seen=new WeakSet();
  const visit=(input,depth)=>{
    if(input===undefined)return null;
    if(input===null||typeof input==="boolean")return input;
    if(typeof input==="number")return Number.isFinite(input)?input:String(input);
    if(typeof input==="bigint")return input.toString();
    if(typeof input==="string")return input.length>maxStringLength?`${input.slice(0,maxStringLength)}…[truncated]`:input;
    if(typeof input==="symbol"||typeof input==="function")return `[${typeof input}]`;
    if(input instanceof Error)return{name:input.name||"Error",message:String(input.message??input),stack:typeof input.stack==="string"?input.stack.slice(0,maxStringLength):null};
    if(depth>=maxDepth)return"[MaxDepth]";
    if(typeof Node!=="undefined"&&input instanceof Node)return`[DOM:${input.nodeName??"node"}]`;
    if(input?.isTexture||input?.isMaterial||input?.isBufferGeometry||input?.isWebGLRenderTarget)return`[GPU:${input.type??input.constructor?.name??"resource"}]`;
    if(input?.isVector2)return{x:finite(input.x),y:finite(input.y)};
    if(input?.isVector3)return{x:finite(input.x),y:finite(input.y),z:finite(input.z)};
    if(input?.isVector4||input?.isQuaternion)return{x:finite(input.x),y:finite(input.y),z:finite(input.z),w:finite(input.w)};
    if(input?.isEuler)return{x:finite(input.x),y:finite(input.y),z:finite(input.z),order:String(input.order??"XYZ")};
    if(input?.isMatrix3||input?.isMatrix4)return{elements:Array.from(input.elements??[]).slice(0,16).map(finite)};
    if(ArrayBuffer.isView(input))return{type:input.constructor?.name??"TypedArray",values:Array.from(input.subarray?.(0,maxArrayLength)??[]).map(item=>typeof item==="number"?(Number.isFinite(item)?item:String(item)):item),truncated:input.length>maxArrayLength};
    if(input instanceof ArrayBuffer)return{type:"ArrayBuffer",byteLength:input.byteLength};
    if(typeof input!=="object")return String(input);
    if(seen.has(input))return"[Circular]";seen.add(input);
    if(Array.isArray(input)){
      const length=Math.min(input.length,maxArrayLength),output=new Array(length);
      for(let index=0;index<length;index++)output[index]=visit(input[index],depth+1);
      if(input.length>length)output.push(`[${input.length-length} more items]`);
      return output;
    }
    if(input instanceof Map){const output=[];let count=0;for(const[key,item]of input){if(count++>=maxArrayLength){output.push(["[truncated]",input.size-maxArrayLength]);break;}output.push([visit(key,depth+1),visit(item,depth+1)]);}return{type:"Map",entries:output};}
    if(input instanceof Set){const output=[];let count=0;for(const item of input){if(count++>=maxArrayLength){output.push(`[${input.size-maxArrayLength} more items]`);break;}output.push(visit(item,depth+1));}return{type:"Set",values:output};}
    const output={};
    for(const[key,item]of safePropertyEntries(input)){
      if(key==="parent"||key==="children"||key==="geometry"||key==="material"||key==="texture"||key==="renderer"||key==="scene")continue;
      output[key]=visit(item,depth+1);
    }
    return output;
  };
  try{return visit(value,0);}catch(error){return{serialisationError:String(error?.message??error)};}
}

class PerformanceBuffer{
  constructor(capacity){
    this.capacity=capacity;this.count=0;this.cursor=0;this.totalWritten=0;this.dropped=0;
    this.columns=PERFORMANCE_FIELDS.map(()=>new Float64Array(capacity));
  }
  clear(){this.count=0;this.cursor=0;this.totalWritten=0;this.dropped=0;}
  push(values){
    const index=this.cursor;for(let column=0;column<this.columns.length;column++)this.columns[column][index]=finite(values[column]);
    this.cursor=(index+1)%this.capacity;if(this.count<this.capacity)this.count++;else this.dropped++;this.totalWritten++;
  }
  rows(){
    const rows=new Array(this.count),start=this.count===this.capacity?this.cursor:0;
    for(let row=0;row<this.count;row++){const source=(start+row)%this.capacity,values=new Array(this.columns.length);for(let column=0;column<this.columns.length;column++)values[column]=this.columns[column][source];rows[row]=values;}
    return rows;
  }
  valuesFor(field){const column=PERFORMANCE_FIELDS.indexOf(field);if(column<0)return[];const output=new Array(this.count),start=this.count===this.capacity?this.cursor:0;for(let index=0;index<this.count;index++)output[index]=this.columns[column][(start+index)%this.capacity];return output;}
}

function percentile(values,fraction){if(!values.length)return 0;values.sort((a,b)=>a-b);return values[Math.min(values.length-1,Math.max(0,Math.ceil(values.length*fraction)-1))];}
function mean(values){if(!values.length)return 0;let sum=0;for(const value of values)sum+=value;return sum/values.length;}
function max(values){let result=0;for(const value of values)if(value>result)result=value;return result;}

export class DiagnosticsManager{
  constructor({limits=DIAGNOSTIC_LIMITS,now=()=>globalThis.performance?.now?.()??Date.now(),wallClock=()=>new Date(),downloadHandler=null}={}){
    this.limits={...DIAGNOSTIC_LIMITS,...limits};this.now=now;this.wallClock=wallClock;this.downloadHandler=downloadHandler;
    this.enabled=false;this.session=null;this.pendingExport=null;this.lastExportSummary=null;this.runtime=null;this.simulationTime=0;
    this.settings={objectBoundaries:false};this.objectBoundaryProvider=null;this.objectBoundaries=[];this.objectBoundaryIds=new Set();
    this.events=[];this.collisions=[];this.warnings=[];this.errors=[];this.counters=Object.create(null);this.dropped={events:0,collisions:0,warnings:0,errors:0,performanceSamples:0,longFrames:0,objectBoundaries:0};
    this.performanceBuffer=new PerformanceBuffer(this.limits.maxPerformanceSamples);this.longFrames=[];this.detailedFrames=[];
    this.systemStarts=new Float64Array(SYSTEM_NAMES.length);this.systemFrameTotals=new Float64Array(SYSTEM_NAMES.length);this.systemTotals=new Float64Array(SYSTEM_NAMES.length);this.systemCounts=new Uint32Array(SYSTEM_NAMES.length);this.systemMaximums=new Float64Array(SYSTEM_NAMES.length);
    this.frameStart=0;this.frameNumber=0;this.forceDetailedFrame=false;this.forceDetailedReason=null;this.totalFrames=0;this.longFrameCount=0;this.severeFrameCount=0;this.maximumFrameMs=0;this.collisionStartCount=0;this.nextPerformanceSampleAt=0;this.visibleObjectCount=0;this.nextVisibleCountAt=0;
    this.activeContacts=new Map();this.observerState={};this.nextObserveAt=0;this.nextTrafficObserveAt=0;this.nextPedestrianObserveAt=0;this.nextStatusAt=0;
    this.statusElement=null;this.statusFields=null;this.boundError=null;this.boundRejection=null;
  }

  isEnabled(){return this.enabled;}
  setSimulationTime(value){if(this.enabled)this.simulationTime=finite(value);}
  startSession(context={}){
    if(this.pendingExport&&!this.enabled){this.showToast("Diagnostics export is pending; retry it before starting another session");return{ok:false,error:this.pendingExport.error??new Error("Pending diagnostics export")};}
    if(this.enabled)this.stopSession({reasonEnded:"restarted",download:false,clearAfterExport:true});
    this.clearSession();this.runtime=context.runtime??context;this.objectBoundaryProvider=typeof context.objectBoundaryProvider==="function"?context.objectBoundaryProvider:null;this.settings.objectBoundaries=Boolean(context.diagnosticSettings?.objectBoundaries??this.settings.objectBoundaries);const startedDate=this.wallClock(),startedMs=this.now(),id=globalThis.crypto?.randomUUID?.()??`diag-${Date.now().toString(36)}-${Math.random().toString(36).slice(2,10)}`;
    const viewport=context.viewport??{width:globalThis.innerWidth??0,height:globalThis.innerHeight??0,devicePixelRatio:globalThis.devicePixelRatio??1};
    this.session={id,startedAt:startedDate.toISOString(),startedWallTime:startedDate,startedMs,gameVersion:String(context.gameVersion??"unknown"),userAgent:String(context.userAgent??globalThis.navigator?.userAgent??"unknown"),viewport:{width:finite(viewport.width),height:finite(viewport.height),devicePixelRatio:finite(viewport.devicePixelRatio)},configuration:serialiseDiagnosticValue(context.configuration??{})};
    this.enabled=true;this.nextPerformanceSampleAt=startedMs;this.nextVisibleCountAt=startedMs;this.nextObserveAt=startedMs;this.nextStatusAt=startedMs;
    this.installErrorListeners();this.createStatusIndicator();this.logEvent("session","diagnostics-enabled",{configurationCaptured:true,diagnosticSettings:{...this.settings}});if(this.settings.objectBoundaries)this.captureObjectBoundaries({source:"session-start"});this.captureInitialRuntimeState();this.updateStatus(true);
    context.toast?.("Diagnostics recording started");return{id,startedAt:this.session.startedAt};
  }

  stopSession({reasonEnded="manual-toggle",download=true,clearAfterExport=true}={}){
    if(!this.enabled){if(this.pendingExport&&download)return this.retryPendingExport();return null;}
    this.logEvent("session","diagnostics-disabled",{reasonEnded});this.closeAllContacts("session-ended");
    const endedDate=this.wallClock(),durationMs=Math.max(0,this.now()-this.session.startedMs);this.enabled=false;this.removeErrorListeners();this.removeStatusIndicator();
    const exportData=this.buildExportData({endedDate,durationMs,reasonEnded}),filename=`city-sim-diagnostics-${timestampFilename(endedDate)}.json`;
    let json;try{json=JSON.stringify(exportData,null,2);}catch(error){this.enabled=false;this.pendingExport={filename,json:null,data:exportData,error};this.showToast(`Diagnostics export failed: ${error?.message??error}`);return{ok:false,error};}
    const result={ok:true,filename,json,data:exportData,durationSeconds:durationMs/1000};
    if(download){
      try{this.initiateDownload(filename,json);this.showToast(`Diagnostics saved: ${filename} · ${(durationMs/1000).toFixed(1)}s`);this.lastExportSummary={filename,durationSeconds:durationMs/1000,summary:exportData.summary};this.pendingExport=null;if(clearAfterExport)this.clearSession();}
      catch(error){this.pendingExport={filename,json,data:exportData,error};this.showToast(`Diagnostics export failed; use cityDiagnostics.exportCurrentSession()`);return{...result,ok:false,error};}
    }else if(clearAfterExport){this.lastExportSummary={filename,durationSeconds:durationMs/1000,summary:exportData.summary};this.clearSession();}
    return result;
  }

  exportCurrentSession(){
    if(this.pendingExport)return this.retryPendingExport();
    if(!this.enabled)return null;
    const nowDate=this.wallClock(),durationMs=Math.max(0,this.now()-this.session.startedMs),data=this.buildExportData({endedDate:nowDate,durationMs,reasonEnded:"manual-export-active-session",incomplete:true}),filename=`city-sim-diagnostics-${timestampFilename(nowDate)}-active.json`,json=JSON.stringify(data,null,2);this.initiateDownload(filename,json);this.showToast(`Diagnostics snapshot saved: ${filename}`);return{ok:true,filename,json,data,durationSeconds:durationMs/1000};
  }
  retryPendingExport(){if(!this.pendingExport)return null;const{filename,data}=this.pendingExport;let json=this.pendingExport.json;if(!filename||!data)return{ok:false,error:this.pendingExport.error};try{if(!json){json=JSON.stringify(data,null,2);this.pendingExport.json=json;}this.initiateDownload(filename,json);this.lastExportSummary={filename,durationSeconds:data.session.durationSeconds,summary:data.summary};this.pendingExport=null;this.showToast(`Diagnostics saved: ${filename} · ${Number(data.session.durationSeconds).toFixed(1)}s`);this.clearSession();return{ok:true,filename,json,data};}catch(error){this.pendingExport.error=error;return{ok:false,error};}}

  initiateDownload(filename,json){
    if(this.downloadHandler){this.downloadHandler(filename,json);return;}
    if(typeof document==="undefined"||typeof Blob==="undefined"||typeof URL==="undefined"||typeof URL.createObjectURL!=="function")throw new Error("Browser download APIs are unavailable");
    const blob=new Blob([json],{type:"application/json"}),url=URL.createObjectURL(blob),anchor=document.createElement("a");anchor.href=url;anchor.download=filename;anchor.style.display="none";document.body?.appendChild(anchor);anchor.click();anchor.remove?.();setTimeout(()=>URL.revokeObjectURL(url),0);
  }

  clearSession(){
    this.enabled=false;this.session=null;this.runtime=null;this.objectBoundaryProvider=null;this.simulationTime=0;this.events.length=0;this.collisions.length=0;this.warnings.length=0;this.errors.length=0;this.objectBoundaries.length=0;this.objectBoundaryIds.clear();this.longFrames.length=0;this.detailedFrames.length=0;this.activeContacts.clear();this.counters=Object.create(null);this.dropped={events:0,collisions:0,warnings:0,errors:0,performanceSamples:0,longFrames:0,objectBoundaries:0};this.performanceBuffer.clear();this.systemStarts.fill(0);this.systemFrameTotals.fill(0);this.systemTotals.fill(0);this.systemCounts.fill(0);this.systemMaximums.fill(0);this.frameNumber=0;this.totalFrames=0;this.longFrameCount=0;this.severeFrameCount=0;this.maximumFrameMs=0;this.collisionStartCount=0;this.forceDetailedFrame=false;this.forceDetailedReason=null;this.observerState={};this.pendingExport=null;this.removeErrorListeners();this.removeStatusIndicator();
  }

  getSummary(){if(this.enabled)return this.buildSummary();return this.pendingExport?.data?.summary??this.lastExportSummary?.summary??null;}
  getDiagnosticSettings(){return{...this.settings};}
  getCurrentSessionForTests(){return this.session?{events:this.events,collisions:this.collisions,warnings:this.warnings,errors:this.errors,objectBoundaries:this.objectBoundaries,settings:{...this.settings},dropped:this.dropped}:null;}

  setObjectBoundarySetting(enabled,{source="api",provider=null}={}){
    const next=Boolean(enabled),changed=this.settings.objectBoundaries!==next;this.settings.objectBoundaries=next;if(typeof provider==="function")this.objectBoundaryProvider=provider;
    if(this.enabled&&changed)this.logEvent("diagnostics","object-boundary-setting-changed",{enabled:next,source});
    if(this.enabled&&next)this.captureObjectBoundaries({source});
    this.updateStatus(true);return next;
  }

  captureObjectBoundaries({source="manual"}={}){
    if(!this.enabled||!this.settings.objectBoundaries||typeof this.objectBoundaryProvider!=="function")return 0;
    let records;try{records=this.objectBoundaryProvider();}catch(error){this.logSystemWarning("diagnostics","Object boundary provider failed",{source,error});return 0;}
    if(!Array.isArray(records))return 0;let added=0;
    for(let index=0;index<records.length;index++){
      const record=records[index],id=String(record?.id??`boundary-${index}`);if(this.objectBoundaryIds.has(id))continue;
      if(this.objectBoundaries.length>=this.limits.maxObjectBoundaries){this.dropped.objectBoundaries++;continue;}
      this.objectBoundaryIds.add(id);this.objectBoundaries.push(serialiseDiagnosticValue({...record,id}));added++;
    }
    if(added||source==="session-start")this.logEvent("diagnostics","object-boundary-catalogue-captured",{source,added,total:this.objectBoundaries.length,providerRecords:records.length,dropped:this.dropped.objectBoundaries});
    return added;
  }

  pushLimited(collection,limitKey,droppedKey,record,{preserveFirst=false}={}){
    const limit=this.limits[limitKey];if(collection.length<limit){collection.push(record);return true;}
    this.dropped[droppedKey]++;
    if(preserveFirst&&collection.length>1){collection.splice(1,1);collection.push(record);}
    else if(!preserveFirst&&collection.length){collection.shift();collection.push(record);}
    return false;
  }
  baseRecord(category,type){return{timeMs:Math.max(0,this.now()-(this.session?.startedMs??this.now())),simulationTime:this.simulationTime,category,type};}
  logEvent(category,type,data={},metadata={}){if(!this.enabled)return false;const categoryName=String(category),typeName=String(type),record={...this.baseRecord(categoryName,typeName),...this.normaliseMetadata(metadata),data:serialiseDiagnosticValue(data)},stored=this.pushLimited(this.events,"maxEvents","events",record);if(categoryName==="player"||categoryName==="incident"||categoryName==="session"||typeName.includes("route-transfer")||typeName.includes("interlocking"))this.markDetailedFrame(`${categoryName}:${typeName}`);return stored;}
  logSystemWarning(system,message,data={}){if(!this.enabled)return false;const record={...this.baseRecord(String(system),"warning"),system:String(system),message:String(message),data:serialiseDiagnosticValue(data)};this.markDetailedFrame(`warning:${system}`);return this.pushLimited(this.warnings,"maxWarnings","warnings",record);}
  logError(error,context={}){if(!this.enabled)return false;const serialised=serialiseDiagnosticValue(error),record={...this.baseRecord("error","application-error"),error:serialised,context:serialiseDiagnosticValue(context)};this.markDetailedFrame("application-error");return this.pushLimited(this.errors,"maxErrors","errors",record,{preserveFirst:true});}
  markDetailedFrame(reason="event"){if(!this.enabled)return;this.forceDetailedFrame=true;this.forceDetailedReason=String(reason);}
  incrementCounter(name,amount=1){if(!this.enabled)return;this.counters[name]=(this.counters[name]??0)+amount;}
  normaliseMetadata(metadata){const output={};if(metadata.entityId!==undefined)output.entityId=String(metadata.entityId);if(metadata.entityType!==undefined)output.entityType=String(metadata.entityType);const position=copyPosition(metadata.position);if(position)output.position=position;return output;}

  recordCollision(data){if(!this.enabled)return false;const pairKey=String(data.pairKey??`${data.entityA?.id??"A"}|${data.entityB?.id??"B"}|${data.collisionCategory??"collision"}`),now=this.now();let contact=this.activeContacts.get(pairKey);
    if(!contact){contact={pairKey,startedAtMs:now,lastSeenAtMs:now,category:String(data.collisionCategory??"other"),entityAId:String(data.entityA?.id??"unknown"),entityBId:String(data.entityB?.id??"unknown")};this.activeContacts.set(pairKey,contact);const record={...this.baseRecord("collision","collision-start"),pairKey,collisionCategory:contact.category,...serialiseDiagnosticValue(data)};this.pushLimited(this.collisions,"maxCollisions","collisions",record);this.collisionStartCount++;this.markDetailedFrame(`collision:${contact.category}`);this.incrementCounter(`collision:${contact.category}`);}
    else contact.lastSeenAtMs=now;return true;
  }
  closeExpiredContacts(now=this.now()){if(!this.enabled)return;for(const[pairKey,contact]of this.activeContacts)if(now-contact.lastSeenAtMs>CONTACT_END_DELAY_MS)this.closeContact(pairKey,"separated");}
  closeContact(pairKey,reason="separated"){const contact=this.activeContacts.get(pairKey);if(!contact)return;const record={...this.baseRecord("collision","collision-end"),pairKey,collisionCategory:contact.category,entityAId:contact.entityAId,entityBId:contact.entityBId,durationMs:Math.max(0,this.now()-contact.startedAtMs),reason};this.pushLimited(this.collisions,"maxCollisions","collisions",record);this.activeContacts.delete(pairKey);}
  closeAllContacts(reason="session-ended"){for(const key of[...this.activeContacts.keys()])this.closeContact(key,reason);}

  beginFrame(timestamp=this.now()){if(!this.enabled)return;this.frameStart=timestamp;this.frameNumber++;this.systemFrameTotals.fill(0);}
  beginSystem(name){if(!this.enabled)return;const index=SYSTEM_INDEX.get(name);if(index!==undefined)this.systemStarts[index]=this.now();}
  endSystem(name){if(!this.enabled)return 0;const index=SYSTEM_INDEX.get(name);if(index===undefined)return 0;const duration=Math.max(0,this.now()-this.systemStarts[index]);this.systemFrameTotals[index]+=duration;this.systemTotals[index]+=duration;this.systemCounts[index]++;if(duration>this.systemMaximums[index])this.systemMaximums[index]=duration;return duration;}
  addSystemTiming(name,durationMs){if(!this.enabled)return;const index=SYSTEM_INDEX.get(name);if(index===undefined)return;const duration=Math.max(0,finite(durationMs));if(duration<=0)return;this.systemFrameTotals[index]+=duration;this.systemTotals[index]+=duration;this.systemCounts[index]++;if(duration>this.systemMaximums[index])this.systemMaximums[index]=duration;}
  recordSystemTiming(name,durationMs){this.addSystemTiming(name,durationMs);}

  endFrame(timestamp=this.now(),frameData={}){
    if(!this.enabled)return;const frameMs=Math.max(0,timestamp-this.frameStart);this.totalFrames++;if(frameMs>this.maximumFrameMs)this.maximumFrameMs=frameMs;if(frameMs>16.7)this.longFrameCount++;if(frameMs>33.3)this.severeFrameCount++;
    const force=frameMs>16.7||Boolean(frameData.forceDetailed)||this.systemFrameTotals[SYSTEM_INDEX.get("chunkGeneration")]>0||this.forceDetailedFrame,now=timestamp;
    if(now>=this.nextVisibleCountAt){this.visibleObjectCount=this.countVisibleObjects();this.nextVisibleCountAt=now+1000;}
    if(force||now>=this.nextPerformanceSampleAt){this.writePerformanceSample(frameMs,frameData);this.nextPerformanceSampleAt=now+DEFAULT_SAMPLE_INTERVAL_MS;}
    if(force){const reasons=[];if(frameMs>33.3)reasons.push("severe-frame");else if(frameMs>16.7)reasons.push("long-frame");if(frameData.forceDetailed)reasons.push("forced");if(this.systemFrameTotals[SYSTEM_INDEX.get("chunkGeneration")]>0)reasons.push("chunk-generation");if(this.forceDetailedReason)reasons.push(this.forceDetailedReason);const record={timeMs:Math.max(0,now-this.session.startedMs),simulationTime:this.simulationTime,frameMs,systems:Object.fromEntries(SYSTEM_NAMES.map((name,index)=>[name,this.systemFrameTotals[index]])),reasons};if(this.detailedFrames.length<this.limits.maxLongFrames)this.detailedFrames.push(record);else this.dropped.longFrames++;if(frameMs>16.7&&this.longFrames.length<this.limits.maxLongFrames)this.longFrames.push(record);}
    this.forceDetailedFrame=false;this.forceDetailedReason=null;this.closeExpiredContacts(now);this.observeRuntime(now);if(now>=this.nextStatusAt){this.updateStatus();this.nextStatusAt=now+STATUS_INTERVAL_MS;}
  }

  writePerformanceSample(frameMs,frameData){
    const renderer=frameData.renderer??this.runtime?.renderer?.info,render=renderer?.render??renderer,memory=renderer?.memory??{},heap=globalThis.performance?.memory?.usedJSHeapSize??0;
    const values=[Math.max(0,this.now()-this.session.startedMs),frameMs];for(const name of SYSTEM_NAMES)values.push(this.systemFrameTotals[SYSTEM_INDEX.get(name)]??0);
    values.push(render?.calls??0,render?.triangles??0,render?.lines??0,render?.points??0,memory?.geometries??0,memory?.textures??0,frameData.visibleObjects??this.visibleObjectCount,heap);
    this.performanceBuffer.push(values);if(this.performanceBuffer.dropped>this.dropped.performanceSamples)this.dropped.performanceSamples=this.performanceBuffer.dropped;
  }
  countVisibleObjects(){const scene=this.runtime?.scene;if(!scene?.traverseVisible)return 0;let count=0;scene.traverseVisible(()=>count++);return count;}

  captureInitialRuntimeState(){if(!this.enabled)return;this.logEvent("configuration","runtime-initialised",this.runtimeSummary());this.observeRuntime(this.now(),true);}
  runtimeSummary(){const runtime=this.runtime??{},rail=runtime.rail,traffic=runtime.traffic,pedestrians=runtime.pedestrians,airport=runtime.airport,chunkManager=runtime.chunkManager;return{trains:rail?.trains?.length??0,railBlocks:rail?.network?.blocks?.length??0,signals:rail?.network?.signals?.length??0,platforms:rail?.network?.platforms?.length??0,trafficVehicles:traffic?.vehicles?.length??0,pedestrians:pedestrians?.agents?.length??0,aircraft:airport?.aircraft?.length??0,chunks:chunkManager?.chunks?.size??0};}
  observeRuntime(now=this.now(),force=false){if(!this.enabled||(!force&&now<this.nextObserveAt))return;this.nextObserveAt=now+125;this.observePlayer();this.observeWeather();this.observeIncidents();this.observeChunks();this.observeRailway();this.observeTraffic(now,force);this.observePedestrians(now,force);this.observeAirport();this.observePolice();}

  observePlayer(){const{player,rail,transit}=this.runtime??{};if(!player)return;const mode=player.inTrain?(rail?.playerTrainMode==="passenger"?"train-passenger":"train-cab"):player.inBus?"bus":player.inVehicle?"car":"walking",previous=this.observerState.playerMode;
    if(previous&&previous!==mode){const position=player.inTrain?rail?.playerTrain?.headPosition:player.inBus?transit?.playerBus?.mesh?.position:player.inVehicle?player.position:player.camera?.position;this.logEvent("player",`mode-${previous}-to-${mode}`,{previousMode:previous,mode,trainId:rail?.playerTrain?.id??null,busId:transit?.playerBus?.id??null},{entityId:rail?.playerTrain?.id??transit?.playerBus?.id??"player",position});}
    this.observerState.playerMode=mode;
  }
  observeWeather(){const weather=this.runtime?.weather;if(!weather)return;const previousMode=this.observerState.weatherMode;if(previousMode!==undefined&&previousMode!==weather.mode)this.logEvent("weather","weather-changed",{from:previousMode,to:weather.mode});this.observerState.weatherMode=weather.mode;const hour=Math.floor((weather.timeOfDay??0)*4)/4,previousHour=this.observerState.timeOfDay;if(previousHour!==undefined&&previousHour!==hour)this.logEvent("environment","time-of-day-changed",{from:previousHour,to:hour,clock:weather.clockText?.()});this.observerState.timeOfDay=hour;}
  observeIncidents(){const incidents=this.runtime?.incidents?.incidents??[],current=new Map(incidents.map(item=>[item.id,item]));const previous=this.observerState.incidents??new Map();for(const[id,item]of current)if(!previous.has(id))this.logEvent("incident","incident-created",{id,type:item.type,laneId:item.laneId,roadId:item.roadId,status:item.status},{entityId:id,position:item.marker?.position});else if(previous.get(id)!==item.status)this.logEvent("incident","incident-status-changed",{id,from:previous.get(id),to:item.status},{entityId:id,position:item.marker?.position});for(const[id,status]of previous)if(!current.has(id))this.logEvent("incident","incident-resolved",{id,previousStatus:status},{entityId:id});this.observerState.incidents=new Map([...current].map(([id,item])=>[id,item.status]));}
  observeChunks(){const manager=this.runtime?.chunkManager;if(!manager)return;const previous=this.observerState.chunkStates??new Map(),current=new Map();for(const[key,chunk]of manager.chunks??[]){current.set(key,chunk.state);const old=previous.get(key);if(old===undefined&&chunk.state!=="unloaded")this.logEvent("chunk","chunk-created",{key,state:chunk.state});else if(old!==undefined&&old!==chunk.state)this.logEvent("chunk",`chunk-${chunk.state}`,{key,from:old,to:chunk.state});}for(const[key,old]of previous)if(!current.has(key))this.logEvent("chunk","chunk-removed",{key,previousState:old});const currentKey=manager.currentKey;if(this.observerState.currentChunk!==undefined&&this.observerState.currentChunk!==currentKey)this.logEvent("chunk","active-chunk-changed",{from:this.observerState.currentChunk,to:currentKey});this.observerState.currentChunk=currentKey;this.observerState.chunkStates=current;}

  observeRailway(){const rail=this.runtime?.rail;if(!rail?.trains)return;const state=this.observerState.rail??{trains:new Map(),blocks:new Map(),signals:new Map(),platforms:new Map()};
    for(const train of rail.trains){const previous=state.trains.get(train.id),allocation=rail.stationOperations?.allocation?.(train.id),authoritySignature=(train.movementAuthority?.blocks??[]).map(block=>block.id).join(","),current={routeId:train.routeId,trackIndex:train.trackIndex,currentStation:train.currentStation?.id??null,lastStationId:train.lastStationId??null,doorsOpen:Boolean(train.doorsOpen),dwell:train.dwell>0,manual:Boolean(train.manual),authoritySignature,signalAspect:train.signalAspect,platformId:allocation?.platformId??null,transferCount:train.completedRouteTransfers??0,waiting:Boolean(train.waitingAtSignal)};
      if(!previous)this.logEvent("railway","service-initialised",{trainId:train.id,serviceId:train.service?.serviceId??train.serviceId??train.id,routeId:train.routeId,trackIndex:train.trackIndex,direction:train.direction},{entityId:train.id,position:train.headPosition});else{
        if(previous.authoritySignature!==current.authoritySignature)this.logEvent("railway","movement-authority-changed",{trainId:train.id,from:previous.authoritySignature,to:current.authoritySignature,distance:train.movementAuthority?.distance??0},{entityId:train.id,position:train.headPosition});
        if(previous.signalAspect!==current.signalAspect)this.logEvent("railway","train-signal-aspect-changed",{trainId:train.id,from:previous.signalAspect,to:current.signalAspect},{entityId:train.id,position:train.headPosition});
        if(!previous.currentStation&&current.currentStation)this.logEvent("railway","train-arrived",{trainId:train.id,stationId:current.currentStation,platformId:current.platformId},{entityId:train.id,position:train.headPosition});
        if(previous.currentStation&&!current.currentStation)this.logEvent("railway","train-departed",{trainId:train.id,stationId:previous.currentStation},{entityId:train.id,position:train.headPosition});
        if(!previous.dwell&&current.dwell)this.logEvent("railway","dwell-started",{trainId:train.id,stationId:current.currentStation},{entityId:train.id});if(previous.dwell&&!current.dwell)this.logEvent("railway","dwell-ended",{trainId:train.id},{entityId:train.id});
        if(previous.doorsOpen!==current.doorsOpen)this.logEvent("railway",current.doorsOpen?"doors-opened":"doors-closed",{trainId:train.id,platformSide:train.platformSide,platformId:current.platformId,stationId:current.currentStation},{entityId:train.id,position:train.headPosition});
        if(previous.platformId!==current.platformId)this.logEvent("railway",current.platformId?"platform-allocated":"platform-released",{trainId:train.id,from:previous.platformId,to:current.platformId},{entityId:train.id});
        if(previous.transferCount!==current.transferCount)this.logEvent("railway","route-transfer-completed",{trainId:train.id,fromRouteId:previous.routeId,toRouteId:current.routeId,completedTransfers:current.transferCount},{entityId:train.id,position:train.headPosition});
        if(!previous.waiting&&current.waiting)this.logEvent("railway","train-stopped-at-restrictive-authority",{trainId:train.id,signalAspect:current.signalAspect,distanceToSignal:train.nextSignal?.distance??null},{entityId:train.id,position:train.headPosition});
      }state.trains.set(train.id,current);
    }
    for(const block of rail.network?.blocks??[]){const occupied=[...block.occupiedBy].sort().join(","),reserved=block.reservedBy??null,current=`${occupied}|${reserved}`,previous=state.blocks.get(block.id);if(previous!==undefined&&previous!==current){const[oldOccupied,oldReserved]=previous.split("|");if(oldOccupied!==occupied)this.logEvent("railway",occupied?"block-entered":"block-cleared",{blockId:block.id,previousOccupiedBy:oldOccupied?oldOccupied.split(","):[],occupiedBy:occupied?occupied.split(","):[]},{entityId:block.id});if(oldReserved!==(reserved??""))this.logEvent("railway",reserved?"block-reserved":"block-reservation-released",{blockId:block.id,from:oldReserved||null,to:reserved},{entityId:block.id});}state.blocks.set(block.id,current);}
    for(const signal of rail.network?.signals??[]){const current=`${signal.aspect}|${signal.clearedFor??""}`,previous=state.signals.get(signal.id);if(previous!==undefined&&previous!==current){const[oldAspect,oldCleared]=previous.split("|");this.logEvent("railway","signal-aspect-changed",{signalId:signal.id,from:oldAspect,to:signal.aspect,previousClearedFor:oldCleared||null,clearedFor:signal.clearedFor??null},{entityId:signal.id,position:signal.position});}state.signals.set(signal.id,current);}
    for(const platform of rail.network?.platforms??[]){const current=`${platform.reservedBy??""}|${platform.occupiedBy??""}|${platform.status??""}`,previous=state.platforms.get(platform.id);if(previous!==undefined&&previous!==current){const[oldReserved,oldOccupied,oldStatus]=previous.split("|");if(oldReserved!==(platform.reservedBy??""))this.logEvent("railway",platform.reservedBy?"platform-requested-or-reserved":"platform-released",{platformId:platform.id,from:oldReserved||null,to:platform.reservedBy??null},{entityId:platform.id});if(oldOccupied!==(platform.occupiedBy??""))this.logEvent("railway",platform.occupiedBy?"platform-occupied":"platform-cleared",{platformId:platform.id,from:oldOccupied||null,to:platform.occupiedBy??null},{entityId:platform.id});if(oldStatus!==String(platform.status??""))this.logEvent("railway","platform-status-changed",{platformId:platform.id,from:oldStatus,to:platform.status},{entityId:platform.id});}state.platforms.set(platform.id,current);}
    const conflicts=rail.blockSystem?.conflicts??[];if(conflicts.length)this.logSystemWarning("railway","Overlapping railway block occupancy detected",{conflicts});const recovery=rail.dispatcher?.deadlockRecoveryCount??0;if((state.deadlockRecoveryCount??0)!==recovery&&recovery>0)this.logSystemWarning("dispatcher","Stale reservations released for a long-waiting train",{count:recovery});state.deadlockRecoveryCount=recovery;this.observerState.rail=state;
  }

  observeTraffic(now,force){if(!force&&now<this.nextTrafficObserveAt)return;this.nextTrafficObserveAt=now+250;const traffic=this.runtime?.traffic;if(!traffic)return;const previous=this.observerState.traffic??new Map(),current=new Map();for(const vehicle of traffic.vehicles??[]){const routeSignature=(vehicle.route??[]).join(">"),laneChange=vehicle.laneChange?`${vehicle.laneChange.fromLaneId}>${vehicle.laneChange.toLaneId}`:null,currentState={kind:vehicle.kind,laneId:vehicle.laneId,routeSignature,laneChange,stuck:vehicle.stuckTime>8,dwellReason:vehicle.dwellReason??null,renderTier:vehicle.renderTier};const old=previous.get(vehicle.id);if(!old)this.logEvent("traffic","vehicle-spawned",{id:vehicle.id,kind:vehicle.kind,laneId:vehicle.laneId,route:vehicle.route},{entityId:vehicle.id,position:vehicle.mesh?.position});else{if(old.routeSignature!==routeSignature)this.logEvent("traffic","vehicle-rerouted",{id:vehicle.id,from:old.routeSignature,to:routeSignature},{entityId:vehicle.id,position:vehicle.mesh?.position});if(!old.laneChange&&laneChange)this.logEvent("traffic","lane-change-started",{id:vehicle.id,change:laneChange},{entityId:vehicle.id,position:vehicle.mesh?.position});if(old.laneChange&&!laneChange)this.logEvent("traffic","lane-change-completed",{id:vehicle.id,change:old.laneChange,laneId:vehicle.laneId},{entityId:vehicle.id,position:vehicle.mesh?.position});if(!old.stuck&&currentState.stuck)this.logSystemWarning("traffic","Vehicle blocked unusually long",{id:vehicle.id,laneId:vehicle.laneId,stuckSeconds:vehicle.stuckTime});if(old.dwellReason!==currentState.dwellReason&&currentState.dwellReason==="bus-stop")this.logEvent("bus","bus-stop-arrival",{id:vehicle.id,line:vehicle.line,lastStop:vehicle.lastStop},{entityId:vehicle.id,position:vehicle.mesh?.position});}current.set(vehicle.id,currentState);}for(const[id,old]of previous)if(!current.has(id))this.logEvent("traffic","vehicle-despawned",{id,kind:old.kind},{entityId:id});this.observerState.traffic=current;}
  observePedestrians(now,force){if(!force&&now<this.nextPedestrianObserveAt)return;this.nextPedestrianObserveAt=now+500;const pedestrians=this.runtime?.pedestrians;if(!pedestrians)return;const previous=this.observerState.pedestrians??new Map(),current=new Map();for(const agent of pedestrians.agents??[]){const routeSignature=(agent.route??[]).join(">"),state={activity:agent.activity,routeSignature,index:agent.index,accessingTarget:Boolean(agent.accessingTarget),wait:agent.wait??0};const old=previous.get(agent.id);if(!old)this.logEvent("pedestrian","pedestrian-spawned",{id:agent.id,route:agent.route},{entityId:agent.id,position:agent.mesh?.position});else{if(old.routeSignature!==routeSignature)this.logEvent("pedestrian","route-assigned",{id:agent.id,route:agent.route},{entityId:agent.id});if(old.activity!==state.activity)this.logEvent("pedestrian","activity-changed",{id:agent.id,from:old.activity,to:state.activity},{entityId:agent.id,position:agent.mesh?.position});if(!old.accessingTarget&&state.accessingTarget)this.logEvent("pedestrian","station-path-entered",{id:agent.id},{entityId:agent.id,position:agent.mesh?.position});if((old.wait??0)<8&&state.wait>=8)this.logSystemWarning("pedestrian","Pedestrian blocked unusually long",{id:agent.id,waitSeconds:state.wait});}current.set(agent.id,state);}for(const[id]of previous)if(!current.has(id))this.logEvent("pedestrian","pedestrian-removed",{id},{entityId:id});this.observerState.pedestrians=current;}
  observeAirport(){const airport=this.runtime?.airport;if(!airport)return;const previous=this.observerState.aircraft??new Map(),current=new Map();for(const aircraft of airport.aircraft??[]){current.set(aircraft.id,aircraft.state);const old=previous.get(aircraft.id);if(old===undefined)this.logEvent("airport","aircraft-spawned",{id:aircraft.id,state:aircraft.state,gateIndex:aircraft.gateIndex},{entityId:aircraft.id,position:aircraft.mesh?.position});else if(old!==aircraft.state)this.logEvent("airport",`aircraft-${aircraft.state}`,{id:aircraft.id,from:old,to:aircraft.state,cycles:aircraft.cycles},{entityId:aircraft.id,position:aircraft.mesh?.position});}this.observerState.aircraft=current;}
  observePolice(){const police=this.runtime?.police;if(!police)return;const active=Boolean(police.pursuitActive);if(this.observerState.pursuitActive!==undefined&&this.observerState.pursuitActive!==active)this.logEvent("police",active?"police-pursuit-started":"police-pursuit-ended",{wantedLevel:police.wantedLevel,units:police.units?.length??0,offences:police.offences?.length??0});this.observerState.pursuitActive=active;const offenceCount=police.offences?.length??0;if(this.observerState.offenceCount!==undefined&&offenceCount>this.observerState.offenceCount){for(const offence of police.offences.slice(this.observerState.offenceCount))this.logEvent("police","offence-recorded",offence);}this.observerState.offenceCount=offenceCount;}

  installErrorListeners(){if(typeof window==="undefined"||!window.addEventListener)return;this.boundError=event=>this.logError(event?.error??new Error(event?.message??"Window error"),{source:event?.filename,line:event?.lineno,column:event?.colno});this.boundRejection=event=>this.logError(event?.reason instanceof Error?event.reason:new Error(String(event?.reason??"Unhandled rejection")),{type:"unhandledrejection"});window.addEventListener("error",this.boundError);window.addEventListener("unhandledrejection",this.boundRejection);}
  removeErrorListeners(){if(typeof window!=="undefined"&&window.removeEventListener){if(this.boundError)window.removeEventListener("error",this.boundError);if(this.boundRejection)window.removeEventListener("unhandledrejection",this.boundRejection);}this.boundError=null;this.boundRejection=null;}
  createStatusIndicator(){if(typeof document==="undefined"||this.statusElement)return;const panel=document.createElement("div");panel.id="diagnostics-status";panel.style.cssText="position:fixed;left:12px;bottom:12px;z-index:10020;padding:8px 10px;min-width:190px;border:1px solid rgba(255,88,88,.7);background:rgba(24,7,9,.88);color:#ffe5e5;font:11px/1.38 ui-monospace,SFMono-Regular,Consolas,monospace;pointer-events:none;border-radius:6px";const title=document.createElement("div"),time=document.createElement("div"),counts=document.createElement("div"),drop=document.createElement("div");title.textContent="● DIAGNOSTICS RECORDING";title.style.fontWeight="700";title.style.color="#ff8d8d";drop.style.color="#ffd36a";panel.append(title,time,counts,drop);document.body?.appendChild(panel);this.statusElement=panel;this.statusFields={time,counts,drop};}
  updateStatus(force=false){if(!this.enabled||!this.statusFields)return;const seconds=Math.max(0,(this.now()-this.session.startedMs)/1000),minutes=Math.floor(seconds/60),remaining=Math.floor(seconds%60),dropped=Object.values(this.dropped).reduce((sum,value)=>sum+value,0),boundaryText=this.settings.objectBoundaries?`  Boundaries: ${this.objectBoundaries.length.toLocaleString()}`:"";this.statusFields.time.textContent=`${String(minutes).padStart(2,"0")}:${String(remaining).padStart(2,"0")}`;this.statusFields.counts.textContent=`Events: ${this.events.length.toLocaleString()}  Collisions: ${this.collisionStartCount.toLocaleString()}  Warnings: ${this.warnings.length.toLocaleString()}${boundaryText}`;this.statusFields.drop.textContent=dropped?`Dropped records: ${dropped.toLocaleString()}`:"";}
  removeStatusIndicator(){this.statusElement?.remove?.();this.statusElement=null;this.statusFields=null;}
  showToast(message){this.runtime?.toast?.(message);}

  buildSummary(){
    const frameTimes=this.performanceBuffer.valuesFor("frameMs"),summarySystems={};for(let index=0;index<SYSTEM_NAMES.length;index++){const count=this.systemCounts[index];summarySystems[SYSTEM_NAMES[index]]={meanMs:count?this.systemTotals[index]/count:0,maxMs:this.systemMaximums[index],samples:count};}
    const collisionCounts={};for(const collision of this.collisions)if(collision.type==="collision-start")collisionCounts[collision.collisionCategory]=(collisionCounts[collision.collisionCategory]??0)+1;const warningCounts={};for(const warning of this.warnings)warningCounts[warning.system]=(warningCounts[warning.system]??0)+1;
    const boundaryCounts={};for(const boundary of this.objectBoundaries)boundaryCounts[boundary.category]=(boundaryCounts[boundary.category]??0)+1;
    return{totalFrames:this.totalFrames,performanceSamples:this.performanceBuffer.count,medianFrameMs:percentile([...frameTimes],.5),p95FrameMs:percentile([...frameTimes],.95),p99FrameMs:percentile([...frameTimes],.99),maximumFrameMs:this.maximumFrameMs||max(frameTimes),longFrameCount:this.longFrameCount,severeFrameCount:this.severeFrameCount,systems:summarySystems,collisionCountByCategory:collisionCounts,warningCountBySystem:warningCounts,errorCount:this.errors.length,eventCount:this.events.length,objectBoundaryCaptureEnabled:this.settings.objectBoundaries,objectBoundaryCount:this.objectBoundaries.length,objectBoundaryCountByCategory:boundaryCounts,chunkGenerationCount:this.counters.chunkGeneration??0,maximumChunkGenerationMs:summarySystems.chunkGeneration.maxMs,counters:serialiseDiagnosticValue(this.counters),droppedRecords:{...this.dropped},activeContactsAtExport:this.activeContacts.size};
  }
  buildExportData({endedDate,durationMs,reasonEnded,incomplete=false}){const performanceRows=this.performanceBuffer.rows();return{schemaVersion:SCHEMA_VERSION,diagnostics:{limits:{...this.limits},sampleIntervalMs:DEFAULT_SAMPLE_INTERVAL_MS,contactEndDelayMs:CONTACT_END_DELAY_MS,settings:{...this.settings}},session:{id:this.session.id,startedAt:this.session.startedAt,endedAt:endedDate.toISOString(),durationSeconds:durationMs/1000,reasonEnded,complete:!incomplete,gameVersion:this.session.gameVersion,userAgent:this.session.userAgent,viewport:this.session.viewport},configuration:this.session.configuration,summary:this.buildSummary(),objectBoundaries:{captureEnabled:this.settings.objectBoundaries,count:this.objectBoundaries.length,records:serialiseDiagnosticValue(this.objectBoundaries,{maxArrayLength:this.limits.maxObjectBoundaries})},performance:{sampleIntervalMs:DEFAULT_SAMPLE_INTERVAL_MS,fields:PERFORMANCE_FIELDS,samples:performanceRows,detailedFrames:serialiseDiagnosticValue(this.detailedFrames),longFrames:serialiseDiagnosticValue(this.longFrames),systemNames:SYSTEM_NAMES},events:serialiseDiagnosticValue(this.events,{maxArrayLength:this.limits.maxEvents}),collisions:serialiseDiagnosticValue(this.collisions,{maxArrayLength:this.limits.maxCollisions}),warnings:serialiseDiagnosticValue(this.warnings,{maxArrayLength:this.limits.maxWarnings}),errors:serialiseDiagnosticValue(this.errors,{maxArrayLength:this.limits.maxErrors})};}
}

export const diagnostics=new DiagnosticsManager();
