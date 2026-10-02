import { WORLD_DEFINITION,districtAtWorldPosition,worldHeight,worldWidth } from "./world/WorldDefinition.js?v=20261002-flight-sim-terrain";

export const CONFIG = Object.freeze({
  // Backwards-compatible scalar used by a few systems; rectangular consumers
  // should use WORLD_DEFINITION.bounds directly.
  worldSize: Math.max(worldWidth(),worldHeight()),
  laneWidth: 3.35,
  sidewalkWidth: 1.9,
  detailedTrafficTarget: 64,
  pedestrianTarget: 72,
  distantDemandBase: 1850,
  fixedStep: 1 / 60,
  trafficStep: 1 / 36,
  pedestrianStep: 1 / 20,
  environmentStep: 1 / 30,
  maxFrameDelta: 0.08,
  seed: 142857,
  performancePreset: "optimized",
  chunkSize: 220,
  chunkTransitionGrace: 1.15,
  maxCachedDetailedChunks: 18,
  buildingHaloDistance: 58,
  chunkAheadCount: 2,
  chunkBuildsPerFrame: 2,
  chunkBuildBudgetMs: 4.5,
  maxPixelRatio: 1.0,
  minPixelRatio: 0.62,
  adaptiveResolutionDownFps: 43,
  adaptiveResolutionUpFps: 56,
  adaptiveResolutionSampleSeconds: 2.4,
  fullVehicleDistance: 88,
  trainFullDistance: 360,
  trainInteriorDistance: 72,
  trainLowDistance: 1120,
  trainLowUpdateStep: 1 / 12,
  trainOutlineUpdateStep: 1 / 6,
  // Multiplies all railway operating speeds. Acceleration and braking are
  // scaled separately in RailSystem so stopping distances remain safe.
  trainSpeedMultiplier: 2,
  // Multiplies resolved aircraft movement targets without changing parked/hold states.
  aircraftSpeedMultiplier: 1.75,
  railVisibilityStep: 1 / 5,
  stationFullDistance: 250,
  stationLowDistance: 900,
  stationPedestrianDistance: 230,
  buildingOutlineDistance: 1050,
  roadOutlineDistance: 1500,
  hudUpdateStep: 1 / 10,
  shadowMapSize: 512,
  shadowUpdateFrames: 12
});

export const DISTRICTS=WORLD_DEFINITION.districts;

export function districtAt(x,z){return districtAtWorldPosition(x,z);}

export function mulberry32(seed){
  let a=seed>>>0;
  return function(){
    a|=0;a=a+0x6D2B79F5|0;
    let t=Math.imul(a^a>>>15,1|a);
    t=t+Math.imul(t^t>>>7,61|t)^t;
    return ((t^t>>>14)>>>0)/4294967296;
  };
}
