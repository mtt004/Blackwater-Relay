const DEFAULT_SECTIONS=[
  "simulation","render","railway","dispatcher","traffic","pedestrians","collisions","police","airport","player","streaming","chunkGeneration","hud","minimap"
];

const nowMs=()=>performance.now();

function percentile(sorted,count,fraction){
  if(!count)return 0;
  const index=Math.min(count-1,Math.max(0,Math.ceil(count*fraction)-1));
  return sorted[index];
}

function formatNumber(value,digits=2){return Number.isFinite(value)?value.toFixed(digits):"0.00";}

export class PerformanceMonitor{
  constructor({enabled=false,renderer=null,scene=null,sampleCapacity=900,summaryIntervalMs=3000}={}){
    this.enabled=Boolean(enabled);this.renderer=renderer;this.scene=scene;this.sampleCapacity=sampleCapacity;this.summaryIntervalMs=summaryIntervalMs;
    this.frameTimes=new Float32Array(sampleCapacity);this.sortScratch=new Float32Array(sampleCapacity);this.frameCursor=0;this.frameCount=0;
    this.sectionNames=[...DEFAULT_SECTIONS];this.sectionIndex=new Map();this.sectionStarts=new Float64Array(this.sectionNames.length);this.sectionFrameTotals=new Float64Array(this.sectionNames.length);this.sectionWindowTotals=new Float64Array(this.sectionNames.length);this.sectionWindowCounts=new Uint32Array(this.sectionNames.length);
    for(let index=0;index<this.sectionNames.length;index++)this.sectionIndex.set(this.sectionNames[index],index);
    this.frameStart=0;this.lastSummaryAt=nowMs();this.qualityName="medium";this.longFrames=0;this.severeFrames=0;this.totalFrames=0;this.visibleObjects=0;this.lastSummary=null;this.scenario="unlabelled";this.scenarioStart=0;this.scenarioFrames=0;
    this.overlay=null;this.overlayText=null;if(this.enabled)this.createOverlay();
  }
  createOverlay(){
    if(typeof document==="undefined"||this.overlay)return;
    const panel=document.createElement("pre");panel.id="performance-overlay";panel.style.cssText="position:fixed;right:10px;bottom:10px;z-index:10000;max-width:460px;max-height:45vh;overflow:auto;margin:0;padding:10px 12px;background:rgba(4,9,14,.88);color:#cfe9f2;border:1px solid rgba(123,190,215,.45);font:11px/1.35 ui-monospace,SFMono-Regular,Consolas,monospace;pointer-events:none;white-space:pre-wrap";document.body.appendChild(panel);this.overlay=panel;this.overlayText=panel;
  }
  setEnabled(enabled){this.enabled=Boolean(enabled);if(this.enabled)this.createOverlay();else if(this.overlay){this.overlay.remove();this.overlay=null;this.overlayText=null;}}
  setQuality(name){this.qualityName=String(name||"medium");}
  beginFrame(timestamp=nowMs()){if(!this.enabled)return;this.frameStart=timestamp;this.sectionFrameTotals.fill(0);}
  begin(name){if(!this.enabled)return;const index=this.sectionIndex.get(name);if(index!==undefined)this.sectionStarts[index]=nowMs();}
  end(name){if(!this.enabled)return 0;const index=this.sectionIndex.get(name);if(index===undefined)return 0;const elapsed=nowMs()-this.sectionStarts[index];this.sectionFrameTotals[index]+=elapsed;return elapsed;}
  add(name,elapsed){if(!this.enabled)return;const index=this.sectionIndex.get(name);if(index!==undefined)this.sectionFrameTotals[index]+=elapsed;}
  endFrame(timestamp=nowMs()){
    if(!this.enabled)return;
    const frameTime=Math.max(0,timestamp-this.frameStart);this.frameTimes[this.frameCursor]=frameTime;this.frameCursor=(this.frameCursor+1)%this.sampleCapacity;this.frameCount=Math.min(this.sampleCapacity,this.frameCount+1);this.totalFrames++;this.scenarioFrames++;
    if(frameTime>16.7)this.longFrames++;if(frameTime>33.3)this.severeFrames++;
    for(let index=0;index<this.sectionNames.length;index++){const value=this.sectionFrameTotals[index];if(value>0){this.sectionWindowTotals[index]+=value;this.sectionWindowCounts[index]++;}}
    if(timestamp-this.lastSummaryAt>=this.summaryIntervalMs)this.publishSummary(timestamp);
  }
  markScenario(name){if(!this.enabled)return;this.publishSummary(nowMs());this.scenario=String(name||"unlabelled");this.scenarioStart=nowMs();this.scenarioFrames=0;this.longFrames=0;this.severeFrames=0;this.frameCursor=0;this.frameCount=0;this.sectionWindowTotals.fill(0);this.sectionWindowCounts.fill(0);console.info(`[performance] scenario: ${this.scenario}`);}
  countVisibleObjects(){
    if(!this.scene)return 0;let count=0;this.scene.traverseVisible(()=>{count++;});return count;
  }
  publishSummary(timestamp=nowMs()){
    if(!this.enabled||!this.frameCount)return null;
    for(let index=0;index<this.frameCount;index++)this.sortScratch[index]=this.frameTimes[index];
    const sorted=this.sortScratch.subarray(0,this.frameCount);sorted.sort();
    const median=percentile(sorted,this.frameCount,.5),p95=percentile(sorted,this.frameCount,.95),p99=percentile(sorted,this.frameCount,.99),rendererInfo=this.renderer?.info;
    this.visibleObjects=this.countVisibleObjects();
    const sections={};for(let index=0;index<this.sectionNames.length;index++){const count=this.sectionWindowCounts[index];sections[this.sectionNames[index]]=count?this.sectionWindowTotals[index]/count:0;}
    const heap=typeof performance!=="undefined"&&performance.memory?performance.memory.usedJSHeapSize:0;
    const summary={scenario:this.scenario,graphicsQuality:this.qualityName,frames:this.scenarioFrames,medianFrameMs:median,p95FrameMs:p95,p99FrameMs:p99,medianFps:median>0?1000/median:0,onePercentLowFps:p99>0?1000/p99:0,longFrames:this.longFrames,severeFrames:this.severeFrames,sections,renderer:{calls:rendererInfo?.render?.calls??0,triangles:rendererInfo?.render?.triangles??0,lines:rendererInfo?.render?.lines??0,points:rendererInfo?.render?.points??0,geometries:rendererInfo?.memory?.geometries??0,textures:rendererInfo?.memory?.textures??0,visibleObjects:this.visibleObjects},heapBytes:heap,renderScale:this.renderer?.getPixelRatio?.()??1,timestamp};
    this.lastSummary=summary;this.lastSummaryAt=timestamp;this.sectionWindowTotals.fill(0);this.sectionWindowCounts.fill(0);
    const lines=[`PERFORMANCE · ${summary.scenario} · ${summary.graphicsQuality.toUpperCase()}`,`median ${formatNumber(median)} ms (${formatNumber(summary.medianFps,1)} FPS) · p95 ${formatNumber(p95)} ms · p99 ${formatNumber(p99)} ms`,`1% low ${formatNumber(summary.onePercentLowFps,1)} FPS · >16.7 ${summary.longFrames} · >33.3 ${summary.severeFrames}`,`render ${formatNumber(sections.render)} ms · simulation ${formatNumber(sections.simulation)} ms · rail ${formatNumber(sections.railway)} ms · traffic ${formatNumber(sections.traffic)} ms · ped ${formatNumber(sections.pedestrians)} ms`,`calls ${summary.renderer.calls} · tris ${summary.renderer.triangles} · visible ${summary.renderer.visibleObjects} · geometries ${summary.renderer.geometries} · textures ${summary.renderer.textures}`,`heap ${summary.heapBytes?formatNumber(summary.heapBytes/1048576,1)+" MiB":"n/a"} · pixel ratio ${formatNumber(summary.renderScale,2)}`];
    if(this.overlayText)this.overlayText.textContent=lines.join("\n");console.info("[performance]",summary);return summary;
  }
  exportSummary(){return this.lastSummary?JSON.parse(JSON.stringify(this.lastSummary)):null;}
}

export function performanceInstrumentationRequested(){
  if(typeof location==="undefined")return false;
  const params=new URLSearchParams(location.search);if(params.get("perf")==="1"||params.get("benchmark")==="1")return true;
  try{return localStorage.getItem("city-performance-instrumentation")==="1";}catch{return false;}
}
