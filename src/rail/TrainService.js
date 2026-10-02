import { CONFIG } from "../config.js?v=20261002-flight-sim-terrain";
function orderedStationIds(route,step=1){return route.stations.filter((_,index)=>index%step===0).map(station=>station.id);}

export class TrainService{
  constructor(definition){Object.assign(this,definition);this.delaySeconds=0;this.completedStops=0;this.lastDepartureTime=0;}
  stopsForRoute(routeId){return this.stoppingPatterns?.[routeId]??[];}
  callsAt(routeId,station){const ids=this.stopsForRoute(routeId),physical=station.sharedPhysicalStationId??station.id;return ids.includes(station.id)||ids.includes(physical);}
  destinationForRoute(routeId,route){const stops=this.stopsForRoute(routeId);if(!stops.length)return route.name;const station=route.stations.find(item=>item.id===stops.at(-1)||item.sharedPhysicalStationId===stops.at(-1));return station?.name??route.name;}
}

export function createDefaultTrainServices(plan,count=12){
  const city=plan.routeById?.city??plan.routes.find(route=>route.id==="city"),airport=plan.routeById?.airport??plan.routes.find(route=>route.id==="airport");if(!city)return[];
  const cityAll=orderedStationIds(city),cityLimited=orderedStationIds(city,2),airportAll=airport?orderedStationIds(airport):[],airportExpress=airport?[airport.stations[0]?.id,airport.stations.find(station=>station.airport)?.id].filter(Boolean):[];
  const templates=[
    {prefix:"CL-CW",displayName:"City Loop Clockwise",serviceType:"Stopping",initialRouteId:"city",direction:1,trackPreferences:[0,2],priorityClass:4,patterns:{city:cityAll}},
    {prefix:"CL-AC",displayName:"City Loop Anticlockwise",serviceType:"Stopping",initialRouteId:"city",direction:-1,trackPreferences:[3,1],priorityClass:4,patterns:{city:[...cityAll].reverse()}},
    {prefix:"CL-LM",displayName:"City Limited",serviceType:"Limited stop",initialRouteId:"city",direction:1,trackPreferences:[2,0],priorityClass:3,patterns:{city:cityLimited}},
    {prefix:"CL-LN",displayName:"City Limited",serviceType:"Limited stop",initialRouteId:"city",direction:-1,trackPreferences:[1,3],priorityClass:3,patterns:{city:[...cityLimited].reverse()}},
    {prefix:"AE-CW",displayName:"Airport Express",serviceType:"Express",initialRouteId:"airport",direction:1,trackPreferences:[2,0],priorityClass:2,airportService:true,throughService:true,patterns:{airport:airportExpress,city:cityLimited}},
    {prefix:"AE-AC",displayName:"Airport Express",serviceType:"Express",initialRouteId:"airport",direction:-1,trackPreferences:[1,3],priorityClass:2,airportService:true,throughService:true,patterns:{airport:[...airportExpress].reverse(),city:[...cityLimited].reverse()}},
    {prefix:"AS-CW",displayName:"Airport Stopping",serviceType:"Stopping",initialRouteId:"airport",direction:1,trackPreferences:[0,2],priorityClass:3,airportService:true,throughService:true,patterns:{airport:airportAll,city:cityAll}},
    {prefix:"AS-AC",displayName:"Airport Stopping",serviceType:"Stopping",initialRouteId:"airport",direction:-1,trackPreferences:[3,1],priorityClass:3,airportService:true,throughService:true,patterns:{airport:[...airportAll].reverse(),city:[...cityAll].reverse()}}
  ];
  const allocation=[0,0,1,1,2,3,4,4,5,5,6,7],services=[];
  for(let index=0;index<count;index++){
    const template=templates[allocation[index%allocation.length]],route=template.initialRouteId==="airport"&&airport?airport:city,trackIndex=template.trackPreferences[index%template.trackPreferences.length],occurrence=services.filter(service=>service.initialRouteId===route.id&&service.initialTrackIndex===trackIndex).length,startProgress=((occurrence+.17*trackIndex+.043*index)/Math.max(1,Math.ceil(count/4)))%1;
    services.push(new TrainService({serviceId:`${template.prefix}-${String(index+1).padStart(2,"0")}`,displayName:template.displayName,serviceType:template.serviceType,initialRouteId:route.id,routeSequence:template.throughService?["city","airport"]:[route.id],direction:template.direction,stoppingPatterns:template.patterns,trackPreferences:template.trackPreferences,initialTrackIndex:trackIndex,platformPreferences:trackIndex===0?[1,2]:trackIndex===1?[2,3]:trackIndex===2?[4,3]:[5,4],scheduledOffset:index*75,headwaySeconds:300,dwellSeconds:template.serviceType==="Express"?9:13,maximumSpeed:(template.serviceType==="Express"?Math.min(route.designSpeedMps,52):route.urbanLineSpeedMps)*CONFIG.trainSpeedMultiplier,priorityClass:template.priorityClass,airportService:Boolean(template.airportService),throughService:Boolean(template.throughService),startProgress}));
  }
  return services;
}
