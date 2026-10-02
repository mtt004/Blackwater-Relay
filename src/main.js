import * as THREE from "three";
import { CONFIG } from "./config.js?v=20261002-flight-sim-terrain";
import { Input } from "./core/Input.js?v=20261002-flight-sim-terrain";
import { PerformanceMonitor,performanceInstrumentationRequested } from "./core/PerformanceMonitor.js?v=20261002-flight-sim-terrain";
import { qualityManager } from "./core/QualityManager.js?v=20261002-flight-sim-terrain";
import { diagnostics } from "./core/DiagnosticsManager.js?v=20261002-flight-sim-terrain";
import { StructureBoundaryOverlay } from "./core/StructureBoundaryOverlay.js?v=20261002-flight-sim-terrain";
import { buildRoadGraph } from "./world/CityPlan.js?v=20261002-flight-sim-terrain";
import { analyseRoadNetwork } from "./road/RoadQuality.js?v=20261002-flight-sim-terrain";
import { WORLD_DEFINITION,validateWorldDefinition } from "./world/WorldDefinition.js?v=20261002-flight-sim-terrain";
import { CityBuilder } from "./world/CityBuilder.js?v=20261002-flight-sim-terrain";
import { TrafficSignals } from "./systems/TrafficSignals.js?v=20261002-flight-sim-terrain";
import { TrafficSystem } from "./systems/TrafficSystem.js?v=20261002-flight-sim-terrain";
import { PedestrianSystem } from "./systems/PedestrianSystem.js?v=20261002-flight-sim-terrain";
import { TransitSystem } from "./systems/TransitSystem.js?v=20261002-flight-sim-terrain";
import { VehicleCollisionSystem } from "./systems/VehicleCollisionSystem.js?v=20261002-flight-sim-terrain";
import { IncidentSystem } from "./systems/IncidentSystem.js?v=20261002-flight-sim-terrain";
import { WeatherSystem } from "./systems/WeatherSystem.js?v=20261002-flight-sim-terrain";
import { PoliceSystem } from "./systems/PoliceSystem.js?v=20261002-flight-sim-terrain";
import { AirportSystem } from "./systems/AirportSystem.js?v=20261002-flight-sim-terrain";
import { PlayerController } from "./player/PlayerController.js?v=20261002-flight-sim-terrain";
import { RailSystem } from "./rail/RailSystem.js?v=20261002-flight-sim-terrain";
import { analyseRoadRailLayout } from "./rail/RailPlan.js?v=20261002-flight-sim-terrain";
import { HUD,makeToast } from "./ui/HUD.js?v=20261002-flight-sim-terrain";

const canvas=document.getElementById("scene");
const loading=document.getElementById("loading");
const loadingCard=loading?.querySelector(".loading-card");
const loadingStatus=document.getElementById("loading-status");
const loadingDetail=document.getElementById("loading-detail");
const loadingProgress=document.getElementById("loading-progress");
const loadingRetry=document.getElementById("loading-retry");
const objectBoundaryToggle=document.getElementById("diagnostics-object-boundaries");
const objectBoundaryStatus=document.getElementById("diagnostics-object-boundary-status");

const nextPaint=()=>new Promise(resolve=>requestAnimationFrame(()=>resolve()));
const idle=(callback)=>window.requestIdleCallback?requestIdleCallback(callback,{timeout:120}):setTimeout(callback,18);
function setLoading(status,progress,detail=""){
  if(loadingStatus)loadingStatus.textContent=status;
  if(loadingProgress)loadingProgress.style.width=`${THREE.MathUtils.clamp(progress,0,100)}%`;
  if(loadingDetail)loadingDetail.textContent=detail;
}
function showStartupError(error){
  console.error("Urban Systems startup failed",error);
  if(diagnostics.isEnabled())diagnostics.logError(error,{system:"startup",phase:"initialisation"});
  loadingCard?.classList.add("error");
  setLoading("The simulation could not start",100,error?.stack||error?.message||String(error));
  if(loadingRetry){loadingRetry.hidden=false;loadingRetry.onclick=()=>location.reload();}
}
function dismissLoading(){
  if(!loading)return;loading.style.opacity="0";setTimeout(()=>loading.remove(),650);
}

let renderer,scene,camera,hemi,ambient,sun,input,toast,graph,city,built,chunkManager,player,signals,traffic,pedestrians,transit,rail,vehicleCollisions,incidents,weather,police,airport,hud,performanceMonitor,structureBoundaryOverlay;
let running=false,last=0,acc=0,simTime=0,shadowFrame=0,trafficAcc=0,pedestrianAcc=0,environmentAcc=0,hudAcc=0;
let renderScale=qualityManager.current.renderScale.start,resolutionElapsed=0,resolutionFrames=0,qualityUnsubscribe=null;

function diagnosticsContext(){
  return{
    gameVersion:"2026.10.01-aircraft-quality-1",
    userAgent:navigator.userAgent,
    viewport:{width:innerWidth,height:innerHeight,devicePixelRatio},
    configuration:{
      fixedStep:CONFIG.fixedStep,trafficStep:CONFIG.trafficStep,pedestrianStep:CONFIG.pedestrianStep,environmentStep:CONFIG.environmentStep,trainSpeedMultiplier:CONFIG.trainSpeedMultiplier,aircraftSpeedMultiplier:CONFIG.aircraftSpeedMultiplier,graphicsQuality:qualityManager.name,
      seed:CONFIG.seed,worldBounds:built?.worldDefinition?.bounds??WORLD_DEFINITION.bounds,
      roads:graph?.roads?.size??0,lanes:graph?.lanes?.size??0,trains:rail?.trains?.length??0,
      railwayBlocks:rail?.network?.blocks?.length??0,signals:rail?.network?.signals?.length??0,platforms:rail?.network?.platforms?.length??0,
      trafficVehicles:traffic?.vehicles?.length??0,pedestrians:pedestrians?.agents?.length??0,aircraft:airport?.aircraft?.length??0,
      render:{pixelRatio:renderer?.getPixelRatio?.()??1,shadowMapSize:qualityManager.current.shadow.mapSize,shadowsEnabled:qualityManager.current.shadow.enabled,antialias:true}
    },
    diagnosticSettings:{objectBoundaries:structureBoundaryOverlay?.isEnabled?.()??false},
    objectBoundaryProvider:()=>structureBoundaryOverlay?.getBoundaryRecords?.()??[],
    toast,
    runtime:{renderer,scene,camera,player,rail,traffic,pedestrians,transit,vehicleCollisions,incidents,weather,police,airport,chunkManager,structureBoundaryOverlay,toast}
  };
}

function updateObjectBoundaryStatus(){
  if(!objectBoundaryStatus)return;const stats=structureBoundaryOverlay?.getStats?.()??{buildings:0,structures:0,total:0,visible:false};
  objectBoundaryStatus.textContent=stats.visible?`Visible · ${stats.buildings} buildings · ${stats.structures} structures`:`Hidden · ${stats.total} available`;
}
function setObjectBoundarySetting(enabled,{source="api",notify=true}={}){
  const next=structureBoundaryOverlay?.setEnabled?.(enabled)??Boolean(enabled);if(objectBoundaryToggle)objectBoundaryToggle.checked=next;diagnostics.setObjectBoundarySetting(next,{source,provider:()=>structureBoundaryOverlay?.getBoundaryRecords?.()??[]});updateObjectBoundaryStatus();if(notify)toast?.(`Building and structure boundaries ${next?"shown and armed for diagnostics":"hidden"}`);return next;
}
function bindDiagnosticsSettings(){
  if(!objectBoundaryToggle)return;objectBoundaryToggle.addEventListener("change",()=>setObjectBoundarySetting(objectBoundaryToggle.checked,{source:"diagnostics-panel"}));setObjectBoundarySetting(objectBoundaryToggle.checked,{source:"initial-setting",notify:false});
}
function startDiagnostics(){return diagnostics.isEnabled()?null:diagnostics.startSession(diagnosticsContext());}
function stopDiagnostics(){return diagnostics.stopSession({reasonEnded:"manual-toggle",download:true});}
function toggleDiagnostics(){return diagnostics.isEnabled()?stopDiagnostics():startDiagnostics();}
function exposeDiagnosticsHelpers(){
  globalThis.cityDiagnostics=Object.freeze({
    start:startDiagnostics,
    stop:stopDiagnostics,
    exportCurrentSession:()=>diagnostics.exportCurrentSession(),
    retryExport:()=>diagnostics.retryPendingExport(),
    getSummary:()=>diagnostics.getSummary(),
    getSettings:()=>diagnostics.getDiagnosticSettings(),
    setObjectBoundaries:enabled=>setObjectBoundarySetting(enabled,{source:"cityDiagnostics-api"}),
    isEnabled:()=>diagnostics.isEnabled()
  });
}

function configureRenderer(){
  renderer=new THREE.WebGLRenderer({canvas,antialias:true,powerPreference:"high-performance",stencil:false,depth:true});
  renderer.setPixelRatio(Math.min(devicePixelRatio,renderScale));renderer.setSize(innerWidth,innerHeight);
  renderer.shadowMap.enabled=qualityManager.current.shadow.enabled;renderer.shadowMap.type=THREE.PCFShadowMap;renderer.shadowMap.autoUpdate=false;
  renderer.outputColorSpace=THREE.SRGBColorSpace;renderer.toneMapping=THREE.ACESFilmicToneMapping;renderer.toneMappingExposure=1.08;
}

function configureScene(){
  scene=new THREE.Scene();camera=new THREE.PerspectiveCamera(62,innerWidth/innerHeight,.06,1800);camera.position.set(-340,9,18);
  hemi=new THREE.HemisphereLight(0xd4e4eb,0x596354,1.12);scene.add(hemi);
  ambient=new THREE.AmbientLight(0x91a2aa,.26);scene.add(ambient);
  sun=new THREE.DirectionalLight(0xfff3df,2.2);sun.position.set(240,420,-180);sun.castShadow=qualityManager.current.shadow.enabled;
  sun.shadow.mapSize.set(qualityManager.current.shadow.mapSize,qualityManager.current.shadow.mapSize);sun.shadow.camera.left=-145;sun.shadow.camera.right=145;sun.shadow.camera.top=145;sun.shadow.camera.bottom=-145;sun.shadow.camera.near=10;sun.shadow.camera.far=620;sun.shadow.bias=-.00018;sun.shadow.normalBias=.035;sun.shadow.camera.updateProjectionMatrix();scene.add(sun);
}

function applyRenderScale(nextScale,{force=false}={}){
  const range=qualityManager.current.renderScale,clamped=THREE.MathUtils.clamp(nextScale,range.min,range.max);
  if(!force&&Math.abs(clamped-renderScale)<.025)return;renderScale=clamped;renderer.setPixelRatio(Math.min(devicePixelRatio,renderScale));renderer.setSize(innerWidth,innerHeight,false);
}

function applyShadowQuality(profile){
  if(!renderer||!sun)return;renderer.shadowMap.enabled=profile.shadow.enabled;sun.castShadow=profile.shadow.enabled;const size=profile.shadow.mapSize;if(sun.shadow.mapSize.x!==size||sun.shadow.mapSize.y!==size){sun.shadow.map?.dispose?.();sun.shadow.map=null;sun.shadow.mapSize.set(size,size);}if(profile.shadow.enabled)renderer.shadowMap.needsUpdate=true;
}

function syncQualityButtons(){for(const button of document.querySelectorAll("[data-quality]")){const selected=button.dataset.quality===qualityManager.name;button.classList.toggle("active",selected);button.setAttribute("aria-pressed",selected?"true":"false");}const status=document.getElementById("graphics-quality-status");if(status)status.textContent=`${qualityManager.current.label} · ${qualityManager.current.description}`;}
function applyGraphicsQuality(profile,{notify=false,resetScale=true}={}){if(renderer){if(resetScale)renderScale=profile.renderScale.start;applyRenderScale(renderScale,{force:true});applyShadowQuality(profile);}resolutionElapsed=0;resolutionFrames=0;shadowFrame=0;performanceMonitor?.setQuality?.(profile.name);syncQualityButtons();if(notify)toast?.(`Graphics quality: ${profile.label}`);}
function bindGraphicsQualityControls(){syncQualityButtons();for(const button of document.querySelectorAll("[data-quality]"))button.addEventListener("click",()=>qualityManager.setQuality(button.dataset.quality,{source:"settings-panel"}));qualityUnsubscribe?.();qualityUnsubscribe=qualityManager.subscribe((profile,meta)=>applyGraphicsQuality(profile,{notify:meta.source==="settings-panel",resetScale:true}));}

function updateAdaptiveResolution(dt){
  resolutionElapsed+=dt;resolutionFrames++;
  if(resolutionElapsed<CONFIG.adaptiveResolutionSampleSeconds)return;
  const fps=resolutionFrames/Math.max(.001,resolutionElapsed);resolutionElapsed=0;resolutionFrames=0;
  const summary=performanceMonitor?.lastSummary,renderMs=summary?.sections?.render??0,simulationMs=summary?.sections?.simulation??0,renderLimited=!summary||renderMs>=simulationMs*.45;
  if(fps<CONFIG.adaptiveResolutionDownFps&&renderLimited)applyRenderScale(renderScale-.10);
  else if(fps>CONFIG.adaptiveResolutionUpFps)applyRenderScale(renderScale+.05);
}

function populateInBackground(){
  const step=()=>{
    if(!running)return;
    const trafficTarget=Math.min(CONFIG.detailedTrafficTarget,traffic.vehicles.length+8);
    const pedestrianTarget=Math.min(CONFIG.pedestrianTarget,pedestrians.agents.length+10);
    traffic.populate(trafficTarget);pedestrians.populate(pedestrianTarget);
    if(traffic.vehicles.length<CONFIG.detailedTrafficTarget||pedestrians.agents.length<CONFIG.pedestrianTarget)idle(step);
  };
  idle(step);
}

async function boot(){
  try{
    setLoading("Starting the renderer…",4,"Checking WebGL and graphics settings");await nextPaint();
    configureRenderer();configureScene();performanceMonitor=new PerformanceMonitor({enabled:performanceInstrumentationRequested(),renderer,scene});performanceMonitor.setQuality?.(qualityManager.name);globalThis.cityPerformance=performanceMonitor;exposeDiagnosticsHelpers();

    setLoading("Building the road network…",14,"Creating roads, trimmed lane mouths and junction connectors");await nextPaint();
    input=new Input();toast=makeToast();bindGraphicsQualityControls();graph=buildRoadGraph(WORLD_DEFINITION);
    const graphDefinitionErrors=validateWorldDefinition(WORLD_DEFINITION,{graph}),roadQuality=analyseRoadNetwork(graph);
    if(graphDefinitionErrors.length)throw new Error(`World definition validation failed:\n${graphDefinitionErrors.join("\n")}`);
    if(roadQuality.errors.length)throw new Error(`Road-network validation failed:\n${roadQuality.errors.join("\n")}`);

    setLoading("Planning the city…",28,"Generating districts, buildings and chunk metadata");await nextPaint();
    city=new CityBuilder(scene,graph,WORLD_DEFINITION);built=city.build();chunkManager=built.chunkManager;
    const resolvedDefinitionErrors=validateWorldDefinition(WORLD_DEFINITION,{graph,railPlan:built.railPlan}),roadRailErrors=analyseRoadRailLayout(built.railPlan,graph,WORLD_DEFINITION);
    if(resolvedDefinitionErrors.length)throw new Error(`Resolved world validation failed:\n${resolvedDefinitionErrors.join("\n")}`);
    if(roadRailErrors.length)throw new Error(`Road/rail validation failed:\n${roadRailErrors.join("\n")}`);
    player=new PlayerController(scene,camera,input,graph,built.colliders,toast);

    setLoading("Loading the nearby city…",40,"Preparing the player chunk and its four neighbours");await nextPaint();
    await city.initializeStreamingAsync(player.position,player.heading,player.speed,(done,total,key)=>{
      const progress=40+(done/Math.max(1,total))*26;setLoading("Loading the nearby city…",progress,`Prepared chunk ${key} (${done}/${total})`);
    });

    setLoading("Building the railway…",68,"Laying double track, grade-separated bridges, accessible stations, two closed loops and six Class 43 HST services");await nextPaint();
    rail=new RailSystem(scene,camera,input,graph,chunkManager,built.railPlan,toast,built.colliders);player.setRailSystem(rail);
    structureBoundaryOverlay=new StructureBoundaryOverlay(scene,{colliders:built.colliders,railSystem:rail});bindDiagnosticsSettings();

    setLoading("Starting traffic systems…",76,"Connecting road traffic, airport access and strategic signals");await nextPaint();
    airport=new AirportSystem(scene,built.worldDefinition,chunkManager,camera,input,toast);player.setAirportSystem(airport);
    signals=new TrafficSignals(scene,graph);signals.setChunkManager(chunkManager);
    traffic=new TrafficSystem(scene,graph,signals,player);traffic.setChunkManager(chunkManager);traffic.setRailSystem(rail);traffic.populate(Math.min(28,CONFIG.detailedTrafficTarget));

    setLoading("Starting pedestrians and buses…",84,"Creating the first visible agents and scheduled services");await nextPaint();
    pedestrians=new PedestrianSystem(scene,graph,signals);pedestrians.setChunkManager(chunkManager);pedestrians.setTrafficSystem(traffic);pedestrians.setRailSystem(rail);
    transit=new TransitSystem(scene,graph,traffic,camera,input,player,toast,rail);
    vehicleCollisions=new VehicleCollisionSystem(scene,player,traffic,toast);
    incidents=new IncidentSystem(scene,graph,traffic,player,toast);incidents.setChunkManager(chunkManager);traffic.setIncidentSystem(incidents);pedestrians.setIncidentSystem(incidents);
    police=new PoliceSystem(scene,graph,traffic,signals,player,toast);police.setCollisionSystem(vehicleCollisions);police.setAirportSystem(airport);pedestrians.setPoliceSystem(police);
    pedestrians.populate(Math.min(36,CONFIG.pedestrianTarget));

    setLoading("Finalising the simulation…",94,"Connecting weather, rail driving, diagnostics and collision systems");await nextPaint();
    weather=new WeatherSystem(scene,camera,{sun,hemi},built.roadMaterials);weather.setFocus(player.position);
    hud=new HUD(graph,player,traffic,pedestrians,transit,incidents,weather,chunkManager,vehicleCollisions,rail,built.worldDefinition,police,airport);

    canvas.addEventListener("click",()=>{
      police?.enableAudio?.();rail?.enableAudio?.();
      const passengerLook=rail?.wantsPointerLock?.()??false;
      if(!player.inVehicle&&!player.inBus&&(!player.inTrain||passengerLook))canvas.requestPointerLock?.();
    });
    addEventListener("resize",()=>{camera.aspect=innerWidth/innerHeight;camera.updateProjectionMatrix();renderer.setPixelRatio(Math.min(devicePixelRatio,renderScale));renderer.setSize(innerWidth,innerHeight);});
    document.addEventListener("visibilitychange",()=>{if(!document.hidden){last=performance.now()/1000;acc=0;resolutionElapsed=0;resolutionFrames=0;}});
    setInterval(()=>player.save(),5000);

    last=performance.now()/1000;running=true;frame();
    renderer.render(scene,camera);
    setLoading("Ready",100,"The local neighbourhood is loaded");await nextPaint();dismissLoading();
    populateInBackground();

    idle(()=>{
      const violations=city.validateRoadBuildingClearance?.()??[];
      if(violations.length)console.error("Road/building clearance violations",violations);
      else console.info(`City master plan validated: ${city.lots.length} building footprints clear of road corridors.`);
      console.info("Chunk streaming active",chunkManager.getStats());
    });
  }catch(error){showStartupError(error);}
}

function frame(){
  if(!running)return;requestAnimationFrame(frame);
  const frameStart=performance.now();if(input.consume("F8"))toggleDiagnostics();performanceMonitor?.beginFrame(frameStart);diagnostics.beginFrame(frameStart);
  const now=frameStart/1000,dt=Math.min(CONFIG.maxFrameDelta,now-last);last=now;acc+=dt;diagnostics.setSimulationTime(simTime);
  performanceMonitor?.begin("simulation");diagnostics.beginSystem("simulation");
  const trainFocus=rail.getPlayerFocus(),busFocus=transit.getPlayerFocus(),aircraftFocus=airport?.getPlayerFocus?.()??null;
  const transportFocus=trainFocus??busFocus??aircraftFocus;
  const streamPosition=transportFocus?.position??(player.inVehicle?player.position:camera.position),streamHeading=transportFocus?.heading??(player.inVehicle?player.heading:player.walkYaw),streamSpeed=transportFocus?.speed??(player.inVehicle?player.speed:3);
  performanceMonitor?.begin("streaming");diagnostics.beginSystem("streaming");city.updateStreaming(streamPosition,streamHeading,streamSpeed,now);performanceMonitor?.end("streaming");diagnostics.endSystem("streaming");performanceMonitor?.add("chunkGeneration",chunkManager?.lastBuildMs??0);if(diagnostics.isEnabled()&&(chunkManager?.lastBuiltCount??0)>0)diagnostics.logEvent("chunk","chunk-generation-batch-completed",{builtCount:chunkManager.lastBuiltCount,totalBuildMs:chunkManager.lastBuildMs,maximumBuildMs:chunkManager.maximumBuildMs,queued:chunkManager.queue?.length??0});
  if(input.consume("KeyE")){
    if(!airport.handleInteract(player)&&!rail.handleInteract(player)&&!transit.handleInteract(player))player.toggleMode();
    const passengerLook=rail?.wantsPointerLock?.()??false;
    if(player.inBus||(player.inTrain&&!passengerLook)){
      if(document.pointerLockElement)document.exitPointerLock?.();
    }else if(!player.inVehicle&&!player.inBus&&(!player.inTrain||passengerLook)&&!document.pointerLockElement){
      // Boarding/alighting is initiated by a keyboard user gesture, so request
      // pointer lock immediately. A normal scene click remains the fallback.
      canvas.requestPointerLock?.();
    }
  }
  if(input.consume("KeyT")){const from=weather.mode,to=weather.cycle();toast(`Weather: ${to}`);if(diagnostics.isEnabled())diagnostics.logEvent("weather","weather-changed",{from,to,source:"keyboard"});}
  if(input.consume("KeyN")){const from=weather.timeOfDay;weather.advanceTime();toast(`Time advanced to ${weather.clockText()}`);if(diagnostics.isEnabled())diagnostics.logEvent("environment","time-of-day-advanced",{from,to:weather.timeOfDay,clock:weather.clockText(),source:"keyboard"});}
  if(input.consume("KeyI")){const before=incidents.incidents.length;incidents.create();if(diagnostics.isEnabled())diagnostics.logEvent("incident","incident-create-requested",{created:incidents.incidents.length>before,activeIncidents:incidents.incidents.length});}
  if(input.consume("KeyG"))toast(`Chunk graph ${chunkManager.toggleDebug()?"shown":"hidden"}`);
  if(input.consume("KeyB")){
    const visible=vehicleCollisions.toggleDebug();
    player.setCollisionDebugVisible?.(visible);
    rail.setCollisionDebugVisible?.(visible);
    toast(`Collision hitboxes ${visible?"shown":"hidden"}`);
  }
  if(input.consume("KeyP")){performanceMonitor?.setEnabled(!performanceMonitor.enabled);toast(`Performance instrumentation ${performanceMonitor.enabled?"enabled":"disabled"}`);}
  while(acc>=CONFIG.fixedStep){
    signals.update(CONFIG.fixedStep);
    if(!player.inTrain&&!player.inBus&&!player.inAircraft){performanceMonitor?.begin("player");diagnostics.beginSystem("player");player.update(CONFIG.fixedStep,simTime,weather.mode);performanceMonitor?.end("player");diagnostics.endSystem("player");}
    performanceMonitor?.begin("railway");diagnostics.beginSystem("railway");rail.update(CONFIG.fixedStep,simTime,player,weather.mode);performanceMonitor?.end("railway");diagnostics.endSystem("railway");performanceMonitor?.add("dispatcher",rail.lastDispatcherUpdateMsThisFrame??0);diagnostics.addSystemTiming("dispatcher",rail.lastDispatcherUpdateMsThisFrame??0);
    transit.updatePassengerRide(CONFIG.fixedStep,player);
    trafficAcc+=CONFIG.fixedStep;pedestrianAcc+=CONFIG.fixedStep;environmentAcc+=CONFIG.fixedStep;
    if(trafficAcc>=CONFIG.trafficStep){traffic.weatherFactor=weather.mode==="rain"?.80:weather.mode==="fog"?.86:1;traffic.setNight(weather.timeOfDay<6.5||weather.timeOfDay>18.5);performanceMonitor?.begin("traffic");diagnostics.beginSystem("traffic");traffic.update(trafficAcc,simTime);transit.update(trafficAcc,simTime);performanceMonitor?.end("traffic");diagnostics.endSystem("traffic");trafficAcc=0;}
    performanceMonitor?.begin("collisions");diagnostics.beginSystem("collisions");vehicleCollisions.update(CONFIG.fixedStep,simTime);performanceMonitor?.end("collisions");diagnostics.endSystem("collisions");
    performanceMonitor?.begin("police");diagnostics.beginSystem("police");police.update(CONFIG.fixedStep,simTime);performanceMonitor?.end("police");diagnostics.endSystem("police");
    performanceMonitor?.begin("airport");diagnostics.beginSystem("airport");airport.update(CONFIG.fixedStep,simTime,player);performanceMonitor?.end("airport");diagnostics.endSystem("airport");
    if(pedestrianAcc>=CONFIG.pedestrianStep){performanceMonitor?.begin("pedestrians");diagnostics.beginSystem("pedestrians");pedestrians.update(pedestrianAcc,simTime,weather.mode);performanceMonitor?.end("pedestrians");diagnostics.endSystem("pedestrians");pedestrianAcc=0;}
    if(environmentAcc>=CONFIG.environmentStep){incidents.update(environmentAcc);weather.setFocus(streamPosition);weather.update(environmentAcc);city.update(simTime,weather.mode,weather.timeOfDay);environmentAcc=0;}
    simTime+=CONFIG.fixedStep;acc-=CONFIG.fixedStep;
  }
  performanceMonitor?.end("simulation");diagnostics.endSystem("simulation");
  const renderAlpha=acc/CONFIG.fixedStep;airport?.render?.(renderAlpha,dt,player);const shadowQuality=qualityManager.current.shadow;if(shadowQuality.enabled&&++shadowFrame%shadowQuality.updateFrames===0)renderer.shadowMap.needsUpdate=true;
  performanceMonitor?.begin("render");diagnostics.beginSystem("render");renderer.render(scene,camera);performanceMonitor?.end("render");diagnostics.endSystem("render");updateAdaptiveResolution(dt);
  hudAcc+=dt;if(hudAcc>=CONFIG.hudUpdateStep){performanceMonitor?.begin("hud");diagnostics.beginSystem("hud");hud.update(hudAcc,performanceMonitor?.sectionFrameTotals?.[performanceMonitor.sectionIndex.get("simulation")]??0);performanceMonitor?.end("hud");diagnostics.endSystem("hud");performanceMonitor?.add("minimap",hud.lastMinimapMs??0);diagnostics.addSystemTiming("minimap",hud.lastMinimapMs??0);hudAcc=0;}input.endFrame();
  const frameEnd=performance.now();performanceMonitor?.endFrame(frameEnd);if(diagnostics.isEnabled())diagnostics.endFrame(frameEnd,{renderer:renderer.info,forceDetailed:(chunkManager?.lastBuiltCount??0)>0});
}

boot();
