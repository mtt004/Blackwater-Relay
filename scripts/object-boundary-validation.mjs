import { mkdirSync,writeFileSync } from "node:fs";
import * as THREE from "three";
import { buildRoadGraph } from "../src/world/CityPlan.js";
import { WORLD_DEFINITION,validateWorldDefinition } from "../src/world/WorldDefinition.js";
import { CityBuilder } from "../src/world/CityBuilder.js";
import { RailSystem } from "../src/rail/RailSystem.js";
import { StructureBoundaryOverlay } from "../src/core/StructureBoundaryOverlay.js";
import { DiagnosticsManager } from "../src/core/DiagnosticsManager.js";

const interactionPrompt={hidden:true,dataset:{},querySelector:()=>({textContent:""})};
const canvasContext={measureText:()=>({width:0}),fillRect(){},clearRect(){},fillText(){},beginPath(){},moveTo(){},lineTo(){},stroke(){},createLinearGradient:()=>({addColorStop(){}})};
const makeElement=tag=>({tagName:String(tag).toUpperCase(),style:{},dataset:{},children:[],textContent:"",append(...children){this.children.push(...children);},appendChild(child){this.children.push(child);return child;},remove(){},click(){},setAttribute(){},querySelector:()=>null});
globalThis.document={
  getElementById:id=>id==="interaction-prompt"?interactionPrompt:null,
  createElement:tag=>tag==="canvas"?{width:0,height:0,getContext:()=>canvasContext}:makeElement(tag),
  body:makeElement("body"),
  pointerLockElement:null
};
globalThis.window={addEventListener(){},removeEventListener(){}};
globalThis.localStorage={getItem:()=>null,setItem:()=>{}};
globalThis.addEventListener=()=>{};

const fail=message=>{throw new Error(message);};
const input={down:new Set(),mouseDX:0,isDown(key){return this.down.has(key);},consume(){return false;}};
const scene=new THREE.Scene(),camera=new THREE.PerspectiveCamera(),graph=buildRoadGraph(WORLD_DEFINITION);
const definitionErrors=validateWorldDefinition(WORLD_DEFINITION,{graph});if(definitionErrors.length)fail(definitionErrors.join("; "));
const city=new CityBuilder(scene,graph,WORLD_DEFINITION),built=city.build();
const rail=new RailSystem(scene,camera,input,graph,built.chunkManager,built.railPlan,()=>{},built.colliders);
const overlay=new StructureBoundaryOverlay(scene,{colliders:built.colliders,railSystem:rail});

if(overlay.group!==null)fail("boundary overlay allocated render geometry before being enabled");
const records=overlay.getBoundaryRecords(),stats=overlay.getStats();
if(records.length!==stats.total)fail("boundary record count does not match overlay statistics");
if(records.length!==built.colliders.length+rail.walkBlockers.length)fail("not every registered building/structure collider produced one boundary record");
if(!stats.buildings||!stats.structures)fail("whole-world catalogue did not contain both buildings and structures");
const ids=new Set();let visualCollisionSeparation=0;
for(const record of records){
  if(!record.id||ids.has(record.id))fail(`duplicate or missing boundary id: ${record.id}`);ids.add(record.id);
  if(record.footprintVertices?.length!==4)fail(`boundary ${record.id} did not contain a four-corner footprint`);
  if(!(record.dimensions?.width>0&&record.dimensions?.depth>0&&record.dimensions?.height>0))fail(`boundary ${record.id} had invalid visual dimensions`);
  const collision=record.collisionProfile??{};
  if(record.category==="building"&&Number.isFinite(collision.halfWidth)&&record.dimensions.width>collision.halfWidth*2)visualCollisionSeparation++;
}
if(!visualCollisionSeparation)fail("visual object boundaries were not distinct from inset collision bounds");
overlay.setEnabled(true);
if(!overlay.group?.visible||overlay.group.children.length<1)fail("boundary overlay did not create visible line batches");
const drawBatches=overlay.group.children.length;

let now=0,download=null;
const manager=new DiagnosticsManager({now:()=>now,wallClock:()=>new Date(Date.UTC(2026,6,21,15,0,0)+now),downloadHandler:(filename,json)=>{download={filename,json};}});
manager.setObjectBoundarySetting(true,{provider:()=>overlay.getBoundaryRecords()});
manager.startSession({gameVersion:"boundary-validation",diagnosticSettings:{objectBoundaries:true},objectBoundaryProvider:()=>overlay.getBoundaryRecords(),configuration:{validation:true},runtime:{}});
now=250;const result=manager.stopSession({download:true,clearAfterExport:true});
if(!result.ok||!download)fail("diagnostics boundary export was not generated");
const exported=JSON.parse(download.json);
if(exported.schemaVersion!==2)fail(`unexpected schema version ${exported.schemaVersion}`);
if(exported.objectBoundaries.count!==records.length)fail("exported boundary count did not match the whole-world catalogue");
if(exported.summary.objectBoundaryCount!==records.length)fail("summary boundary count did not match the export");
if(!exported.diagnostics.settings.objectBoundaries)fail("export did not preserve the enabled boundary setting");
if(manager.isEnabled()||manager.getCurrentSessionForTests()!==null)fail("successful export did not clear session memory");

overlay.dispose();
const validationResult={
  measuredAt:new Date().toISOString(),
  passed:true,
  totalBoundaries:records.length,
  buildings:stats.buildings,
  structures:stats.structures,
  drawBatches,
  visualCollisionSeparation,
  exportedJsonBytes:Buffer.byteLength(download.json),
  filename:download.filename
};
mkdirSync("benchmarks",{recursive:true});writeFileSync("benchmarks/object-boundary-validation.json",JSON.stringify(validationResult,null,2));
console.log(JSON.stringify(validationResult,null,2));
process.exit(0);
