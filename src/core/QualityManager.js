export const QUALITY_STORAGE_KEY="blackwater-relay-quality";
export const DEFAULT_GRAPHICS_QUALITY="medium";

const preset=(name,label,description,values)=>Object.freeze({name,label,description,...values});

export const GRAPHICS_QUALITY_PRESETS=Object.freeze({
  low:preset("low","Low","Maximum performance",{
    renderScale:Object.freeze({min:.50,max:.70,start:.65}),
    shadow:Object.freeze({enabled:false,mapSize:256,updateFrames:24}),
    aircraft:Object.freeze({fullDistance:180,mediumDistance:650,lowDistance:1700,farDistance:4200,hysteresis:.12,dynamicLightDistance:110,shadowDistance:180,detailedShadowDistance:90}),
    world:Object.freeze({buildingHaloDistance:38,chunkAheadCount:1,maxCachedDetailedChunks:12,fullVehicleDistance:64,buildingOutlineDistance:820,roadOutlineDistance:1200,transitionGrace:.9}),
    rail:Object.freeze({trainFullDistance:260,trainInteriorDistance:64,trainLowDistance:900,trainLowUpdateStep:1/8,trainOutlineUpdateStep:1/4,railVisibilityStep:1/4,stationFullDistance:190,stationLowDistance:680,stationPedestrianDistance:165}),
    traffic:Object.freeze({shadowDistance:92}),
    pedestrians:Object.freeze({animationStride:2}),
    airport:Object.freeze({minorDetail:false})
  }),
  medium:preset("medium","Medium","Balanced / recommended",{
    renderScale:Object.freeze({min:.62,max:1.0,start:1.0}),
    shadow:Object.freeze({enabled:true,mapSize:512,updateFrames:12}),
    aircraft:Object.freeze({fullDistance:320,mediumDistance:1000,lowDistance:2500,farDistance:6500,hysteresis:.10,dynamicLightDistance:320,shadowDistance:520,detailedShadowDistance:260}),
    world:Object.freeze({buildingHaloDistance:58,chunkAheadCount:2,maxCachedDetailedChunks:18,fullVehicleDistance:88,buildingOutlineDistance:1050,roadOutlineDistance:1500,transitionGrace:1.15}),
    rail:Object.freeze({trainFullDistance:360,trainInteriorDistance:72,trainLowDistance:1120,trainLowUpdateStep:1/12,trainOutlineUpdateStep:1/6,railVisibilityStep:1/5,stationFullDistance:250,stationLowDistance:900,stationPedestrianDistance:230}),
    traffic:Object.freeze({shadowDistance:140}),
    pedestrians:Object.freeze({animationStride:1}),
    airport:Object.freeze({minorDetail:true})
  }),
  high:preset("high","High","Increased detail",{
    renderScale:Object.freeze({min:.75,max:1.25,start:1.0}),
    shadow:Object.freeze({enabled:true,mapSize:1024,updateFrames:8}),
    aircraft:Object.freeze({fullDistance:520,mediumDistance:1500,lowDistance:3600,farDistance:8200,hysteresis:.09,dynamicLightDistance:520,shadowDistance:820,detailedShadowDistance:420}),
    world:Object.freeze({buildingHaloDistance:76,chunkAheadCount:2,maxCachedDetailedChunks:22,fullVehicleDistance:116,buildingOutlineDistance:1250,roadOutlineDistance:1700,transitionGrace:1.3}),
    rail:Object.freeze({trainFullDistance:460,trainInteriorDistance:92,trainLowDistance:1380,trainLowUpdateStep:1/15,trainOutlineUpdateStep:1/8,railVisibilityStep:1/6,stationFullDistance:330,stationLowDistance:1080,stationPedestrianDistance:300}),
    traffic:Object.freeze({shadowDistance:185}),
    pedestrians:Object.freeze({animationStride:1}),
    airport:Object.freeze({minorDetail:true})
  }),
  ultra:preset("ultra","Ultra","Maximum visual detail",{
    renderScale:Object.freeze({min:1.0,max:1.5,start:1.15}),
    shadow:Object.freeze({enabled:true,mapSize:2048,updateFrames:4}),
    aircraft:Object.freeze({fullDistance:760,mediumDistance:2200,lowDistance:4800,farDistance:9800,hysteresis:.08,dynamicLightDistance:760,shadowDistance:1200,detailedShadowDistance:650}),
    world:Object.freeze({buildingHaloDistance:92,chunkAheadCount:3,maxCachedDetailedChunks:26,fullVehicleDistance:145,buildingOutlineDistance:1450,roadOutlineDistance:1850,transitionGrace:1.45}),
    rail:Object.freeze({trainFullDistance:620,trainInteriorDistance:120,trainLowDistance:1680,trainLowUpdateStep:1/18,trainOutlineUpdateStep:1/10,railVisibilityStep:1/8,stationFullDistance:430,stationLowDistance:1320,stationPedestrianDistance:390}),
    traffic:Object.freeze({shadowDistance:235}),
    pedestrians:Object.freeze({animationStride:1}),
    airport:Object.freeze({minorDetail:true})
  })
});

export function normalizeGraphicsQuality(value){
  const normalized=String(value??"").trim().toLowerCase();
  return Object.hasOwn(GRAPHICS_QUALITY_PRESETS,normalized)?normalized:DEFAULT_GRAPHICS_QUALITY;
}

export function readPersistedGraphicsQuality(storage=globalThis?.localStorage){
  try{return normalizeGraphicsQuality(storage?.getItem?.(QUALITY_STORAGE_KEY));}catch{return DEFAULT_GRAPHICS_QUALITY;}
}

export class GraphicsQualityManager{
  constructor({storage=globalThis?.localStorage,initialQuality}={}){
    this.storage=storage;this.listeners=new Set();
    this.name=initialQuality===undefined?readPersistedGraphicsQuality(storage):normalizeGraphicsQuality(initialQuality);
  }
  get current(){return GRAPHICS_QUALITY_PRESETS[this.name];}
  getPreset(name){return GRAPHICS_QUALITY_PRESETS[normalizeGraphicsQuality(name)];}
  subscribe(listener){if(typeof listener!=="function")return()=>{};this.listeners.add(listener);return()=>this.listeners.delete(listener);}
  setQuality(value,{persist=true,source="api"}={}){
    const next=normalizeGraphicsQuality(value),changed=next!==this.name;this.name=next;
    if(persist){try{this.storage?.setItem?.(QUALITY_STORAGE_KEY,next);}catch{}}
    if(changed)for(const listener of this.listeners)listener(this.current,{name:this.name,source});
    return this.current;
  }
}

export const qualityManager=new GraphicsQualityManager();
