/**
 * Authoritative spatial definition for the complete simulation world.
 *
 * Rendering, chunk streaming, roads, rail, transit and the minimap must derive
 * their coordinates and extents from this module. Keep this file data-only so
 * it can be validated before Three.js scene construction begins.
 */

const BOUNDS=Object.freeze({minX:-650,maxX:12350,minZ:-1200,maxZ:2050});

const DISTRICTS=Object.freeze([
  Object.freeze({id:"cbd",name:"Central Business District",minX:-190,maxX:190,minZ:-190,maxZ:190,height:[35,125],density:.72}),
  Object.freeze({id:"old",name:"Historic Old Town",minX:-520,maxX:-220,minZ:-190,maxZ:190,height:[8,25],density:.65}),
  Object.freeze({id:"res",name:"Residential Suburbs",minX:-520,maxX:-120,minZ:220,maxZ:520,height:[5,16],density:.45}),
  Object.freeze({id:"ind",name:"Industrial District",minX:160,maxX:530,minZ:210,maxZ:520,height:[7,22],density:.48}),
  Object.freeze({id:"water",name:"Waterfront",minX:210,maxX:560,minZ:-520,maxZ:-210,height:[10,45],density:.38}),
  Object.freeze({id:"commercial",name:"Commercial District",minX:220,maxX:530,minZ:-170,maxZ:180,height:[12,42],density:.56}),
  Object.freeze({id:"hub",name:"Transport Hub",minX:-170,maxX:170,minZ:-520,maxZ:-230,height:[15,55],density:.42}),
  Object.freeze({id:"airport",name:"Eastmere Airport",minX:430,maxX:900,minZ:560,maxZ:880,height:[5,18],density:.08}),
  Object.freeze({id:"merehaven",name:"Merehaven Island",minX:10800,maxX:12150,minZ:50,maxZ:1450,height:[4,12],density:0})
]);

const ROAD_NODES=Object.freeze([
  Object.freeze({id:"WEST",x:-560,z:0,control:"priority",district:"old"}),
  Object.freeze({id:"OLDN",x:-360,z:-170,control:"priority",district:"old"}),
  Object.freeze({id:"OLDS",x:-360,z:170,control:"priority",district:"old"}),
  Object.freeze({id:"CBDW",x:-190,z:0,control:"signal",district:"cbd"}),
  Object.freeze({id:"CBD",x:0,z:0,control:"signal",district:"cbd"}),
  Object.freeze({id:"CBDE",x:190,z:0,control:"signal",district:"cbd"}),
  Object.freeze({id:"EAST",x:560,z:0,control:"priority",district:"commercial"}),
  Object.freeze({id:"NORTH",x:0,z:-570,control:"priority",district:"hub"}),
  Object.freeze({id:"HUB",x:0,z:-360,control:"signal",district:"hub"}),
  Object.freeze({id:"SOUTH",x:0,z:360,control:"roundabout",district:"res",roundaboutRadius:23}),
  Object.freeze({id:"MWS",x:0,z:560,control:"priority",district:"outskirts"}),
  Object.freeze({id:"NW",x:-390,z:-360,control:"priority",district:"outskirts"}),
  // The north-east ring, dock approach, eastern ring and waterfront road used
  // to converge here at almost parallel angles. That produced overlapping
  // road strips and a hairpin-shaped Waterfront Connector. A proper four-arm
  // roundabout now separates the approaches and gives every arm a distinct
  // entry direction.
  Object.freeze({id:"NE",x:390,z:-390,control:"roundabout",district:"water",roundaboutRadius:24}),
  Object.freeze({id:"SW",x:-390,z:360,control:"priority",district:"res"}),
  Object.freeze({id:"SE",x:390,z:360,control:"roundabout",district:"ind",roundaboutRadius:21}),
  Object.freeze({id:"M6E",x:430,z:550,control:"roundabout",district:"outskirts",roundaboutRadius:28}),
  Object.freeze({id:"COMM",x:380,z:-80,control:"priority",district:"commercial"}),
  // Keep the secondary waterfront bend far enough from the NE roundabout that
  // the two junction surfaces cannot overlap.
  Object.freeze({id:"WATER",x:500,z:-250,control:"priority",district:"water"}),
  Object.freeze({id:"INDW",x:210,z:310,control:"roundabout",district:"ind",roundaboutRadius:16}),
  Object.freeze({id:"INDE",x:520,z:390,control:"priority",district:"ind"}),
  Object.freeze({id:"RESW",x:-520,z:390,control:"priority",district:"res"}),
  Object.freeze({id:"RINGW",x:-560,z:-280,control:"priority",district:"outskirts"}),
  Object.freeze({id:"RINGE",x:560,z:-280,control:"priority",district:"outskirts"}),
  Object.freeze({id:"AIRPORT",x:640,z:610,control:"roundabout",district:"airport",roundaboutRadius:19}),
  Object.freeze({id:"AIRPORT_RAIL",x:900,z:595,control:"priority",district:"airport"})
]);

const ROAD_STYLES=Object.freeze({
  urban:Object.freeze({laneWidth:3.35,sidewalkWidth:1.95}),
  boulevard:Object.freeze({laneWidth:3.45,sidewalkWidth:2.15}),
  oldTown:Object.freeze({laneWidth:3.02,sidewalkWidth:1.55}),
  residential:Object.freeze({laneWidth:3.12,sidewalkWidth:1.8}),
  industrial:Object.freeze({laneWidth:3.4,sidewalkWidth:1.65}),
  ring:Object.freeze({laneWidth:3.5,sidewalkWidth:1.2}),
  motorway:Object.freeze({laneWidth:3.58,sidewalkWidth:0,medianWidth:2.4}),
  slip:Object.freeze({laneWidth:3.4,sidewalkWidth:.55,medianWidth:.8})
});

const road=(id,from,to,via,lanesEachWay,speedLimit,category,style)=>Object.freeze({
  id,from,to,via:Object.freeze(via.map(point=>Object.freeze([...point]))),lanesEachWay,speedLimit,category,style
});

const ROADS=Object.freeze([
  road("A1-West Avenue","WEST","CBDW",[[-430,-25],[-290,18]],2,50,"urban","boulevard"),
  road("A1-Central West","CBDW","CBD",[],2,40,"urban","boulevard"),
  road("A1-Central East","CBD","CBDE",[],2,40,"urban","boulevard"),
  road("A1-East Avenue","CBDE","EAST",[[300,18],[455,-18]],2,50,"urban","boulevard"),
  road("B2-North Boulevard","NORTH","HUB",[[15,-470]],2,60,"urban","boulevard"),
  road("B2-Station Approach","HUB","CBD",[[-20,-210]],2,40,"urban","boulevard"),
  road("B2-South Boulevard","CBD","SOUTH",[[18,180]],2,50,"urban","boulevard"),
  road("B2-Motorway Link","SOUTH","MWS",[[0,455]],2,70,"urban","ring"),
  road("Old Town North","WEST","OLDN",[[-475,-85]],1,30,"urban","oldTown"),
  road("Old Town Spine","OLDN","CBDW",[[-285,-120]],1,30,"urban","oldTown"),
  road("Old Town South","WEST","OLDS",[[-470,105]],1,30,"urban","oldTown"),
  road("Market Street","OLDS","CBDW",[[-280,95]],1,30,"urban","oldTown"),
  road("Northwest Ring","RINGW","NW",[[-520,-390],[-455,-425]],2,70,"urban","ring"),
  road("Northern Ring","NW","NORTH",[[-275,-500],[-130,-530]],2,70,"urban","ring"),
  road("Northeast Ring","NORTH","NE",[[150,-520],[305,-455]],2,70,"urban","ring"),
  road("Waterfront Connector","NE","WATER",[[430,-355],[470,-315],[500,-280]],1,40,"urban","urban"),
  road("Harbour Road","WATER","COMM",[[500,-190],[465,-130]],1,40,"urban","urban"),
  road("Commercial Link","COMM","CBDE",[[300,-35]],2,40,"urban","boulevard"),
  road("Eastern Ring","RINGE","EAST",[[575,-150]],2,70,"urban","ring"),
  road("Ring East Link","NE","RINGE",[[470,-430],[535,-390],[555,-345]],2,70,"urban","ring"),
  road("Residential Arc","SW","RESW",[[-455,410]],1,40,"urban","residential"),
  road("Suburban Link","RESW","OLDS",[[-470,290]],1,30,"urban","residential"),
  road("Southwest Link","SW","SOUTH",[[-235,410],[-105,390]],2,50,"urban","urban"),
  road("Industrial Link","SOUTH","INDW",[[100,330]],2,50,"urban","industrial"),
  road("Factory Road","INDW","INDE",[[365,340]],1,40,"urban","industrial"),
  road("Industrial Arc","INDE","SE",[[470,350]],1,40,"urban","industrial"),
  road("Southeast Link","SE","SOUTH",[[245,405],[120,390]],2,50,"urban","industrial"),
  road("M6-South Motorway","SW","M6E",[[-250,550],[0,575],[250,555]],3,100,"motorway","motorway"),
  road("M6-West Slip","SW","MWS",[[-210,465],[-95,530]],1,70,"slip","slip"),
  road("M6-East Slip","MWS","M6E",[[120,590],[255,600],[360,580]],1,70,"slip","slip"),
  road("Industrial Motorway Access","SE","M6E",[[400,445]],1,50,"urban","industrial"),
  road("Civic Diagonal","OLDN","HUB",[[-235,-260],[-95,-330]],1,40,"urban","urban"),
  road("Dock Diagonal","HUB","NE",[[135,-335],[275,-320]],1,50,"urban","urban"),
  road("Inner Southeast","CBDE","INDW",[[205,140]],1,40,"urban","industrial"),
  road("Airport Station Approach","AIRPORT","AIRPORT_RAIL",[[760,590],[840,590]],1,30,"urban","urban"),
  road("Airport Parkway","M6E","AIRPORT",[[515,565],[575,585]],2,60,"urban","ring")
]);

const RAIL_STATIONS=Object.freeze([
  // Desired loop progress is authoritative for spacing. Coordinates remain as
  // readable planning hints, while RailPlan searches locally for road access,
  // level track and full platform clearance.
  Object.freeze({id:"north-gate",name:"North Gate",x:-337,z:-444,t:.07,platformLength:116}),
  Object.freeze({id:"old-town",name:"Old Town",x:-480,z:-117,t:.18,platformLength:108}),
  Object.freeze({id:"west-suburbs",name:"West Suburbs",x:-434,z:278,t:.30,platformLength:108}),
  Object.freeze({id:"south-parkway",name:"South Parkway",x:-137,z:524,t:.42,platformLength:122}),
  Object.freeze({id:"industrial",name:"Industrial Exchange",x:366,z:414,t:.58,platformLength:112}),
  Object.freeze({id:"commercial",name:"Commercial Central",x:524,z:91,t:.69,platformLength:116}),
  Object.freeze({id:"waterfront",name:"Waterfront",x:461,z:-269,t:.80,platformLength:116}),
  Object.freeze({id:"city-central",name:"City Central",x:112,z:-493,t:.93,platformLength:128})
]);

const RAIL_CONTROL_POINTS=Object.freeze([
  Object.freeze([-120,-520]),Object.freeze([-300,-470]),Object.freeze([-430,-330]),Object.freeze([-480,-120]),Object.freeze([-470,150]),
  Object.freeze([-390,360]),Object.freeze([-210,500]),Object.freeze([20,540]),Object.freeze([260,490]),Object.freeze([430,340]),
  Object.freeze([520,120]),Object.freeze([505,-120]),Object.freeze([420,-340]),Object.freeze([250,-460]),Object.freeze([60,-500])
]);


const AIRPORT_RAIL_STATIONS=Object.freeze([
  Object.freeze({id:"airport-junction",name:"Industrial Exchange",x:332.3669,z:443.3411,platformLength:112,routeId:"airport",interchangeWith:"industrial",sharedPhysicalStationId:"industrial"}),
  Object.freeze({id:"eastmere-airport-station",name:"Eastmere Airport",x:940,z:610,platformLength:132,routeId:"airport",airport:true,terminalX:764,terminalZ:617.2,minimumElevation:7.2})
]);

const AIRPORT_RAIL_BEZIER_LOOP=Object.freeze({
  handleScale:.40,
  maximumHandleLength:100,
  points:Object.freeze([
    // Exact samples from the City Loop through Industrial Exchange create a
    // shared 160-metre junction throat. A full HST therefore changes routes
    // without a visible lateral step while its coaches pass through points.
    Object.freeze({x:332.366889,z:443.341095,tx:.782655172,tz:-.622455527}),
    Object.freeze({x:347.758813,z:430.564227,tx:.756076780,tz:-.654482928}),
    Object.freeze({x:362.614430,z:417.170978,tx:.729198157,tz:-.684302600}),
    Object.freeze({x:376.929255,z:403.199169,tx:.701881926,tz:-.712293312}),
    Object.freeze({x:390.693298,z:388.681299,tx:.673941941,tz:-.738784313}),
    Object.freeze({x:540,z:320,tx:1,tz:0}),
    Object.freeze({x:875,z:320,tx:.8,tz:.6}),
    Object.freeze({x:940,z:540,tx:0,tz:1}),
    Object.freeze({x:940,z:820,tx:0,tz:1}),
    Object.freeze({x:830,z:960,tx:-1,tz:0}),
    Object.freeze({x:470,z:960,tx:-1,tz:0}),
    Object.freeze({x:270,z:850,tx:-.65,tz:-.76}),
    Object.freeze({x:150,z:650,tx:0,tz:-1}),
    Object.freeze({x:265.570293,z:487.150873,tx:.886378151,tz:-.462961957}),
    Object.freeze({x:283.039010,z:477.430722,tx:.860990914,tz:-.508620336}),
    Object.freeze({x:300.000477,z:466.837884,tx:.835142768,tz:-.550033233}),
    Object.freeze({x:316.445394,z:455.451845,tx:.809007341,tz:-.587798539})
  ])
});

const TRANSIT_ROUTES=Object.freeze([
  Object.freeze({id:"B1",nodes:Object.freeze(["WEST","OLDN","CBDW","CBD","CBDE","COMM","EAST"]),frequency:8}),
  Object.freeze({id:"B2",nodes:Object.freeze(["HUB","CBD","SOUTH","INDW","INDE"]),frequency:10})
]);


const EASTMERE_AIRPORT=Object.freeze({
  id:"eastmere-airport",code:"EAS",name:"Eastmere Airport",x:680,z:735,heading:Math.PI/2,kind:"hub",
  runway:Object.freeze({length:420,width:34}),taxiwayOffset:58,terminalOffset:105,
  accessNode:"AIRPORT",accessLocal:Object.freeze({x:-40,z:125}),perimeterHalfW:235,perimeterHalfD:155,standCount:4
});

const MEREHAVEN_AIRPORT=Object.freeze({
  id:"merehaven-airport",code:"MHA",name:"Merehaven Island Airport",x:11450,z:760,heading:Math.PI/2,kind:"island",
  runway:Object.freeze({length:520,width:30}),taxiwayOffset:52,terminalOffset:96,
  accessNode:null,accessLocal:Object.freeze({x:-82,z:132}),perimeterHalfW:300,perimeterHalfD:185,standCount:4,
  island:Object.freeze({name:"Merehaven Island",radiusX:690,radiusZ:590,detailDistance:3200,lowDetailDistance:7200})
});

const AIRPORTS=Object.freeze([EASTMERE_AIRPORT,MEREHAVEN_AIRPORT]);

const RESERVED_ZONES=Object.freeze([
  Object.freeze({id:"station",x:-105,z:-420,halfW:76,halfD:31}),
  Object.freeze({id:"tower",x:78,z:72,halfW:24,halfD:24}),
  Object.freeze({id:"water",x:605,z:-420,halfW:86,halfD:186}),
  Object.freeze({id:"civic-square",x:-52,z:-92,halfW:35,halfD:35}),
  Object.freeze({id:"airport",x:680,z:735,halfW:235,halfD:155})
]);

export const WORLD_DEFINITION=Object.freeze({
  id:"urban-systems-city",
  trafficSide:"left",
  name:"Urban Systems City",
  bounds:BOUNDS,
  cities:Object.freeze([Object.freeze({id:"urban-systems-city",name:"Urban Systems City",x:0,z:0})]),
  districts:DISTRICTS,
  roads:Object.freeze({nodes:ROAD_NODES,styles:ROAD_STYLES,links:ROADS}),
  rail:Object.freeze({
    stations:RAIL_STATIONS,
    controlPoints:RAIL_CONTROL_POINTS,
    routes:Object.freeze([
      Object.freeze({id:"city",name:"City Loop",stations:RAIL_STATIONS,controlPoints:RAIL_CONTROL_POINTS,designSpeedMps:55.88,lineSpeedMps:44.44}),
      Object.freeze({id:"airport",name:"Eastmere Airport Loop",stations:AIRPORT_RAIL_STATIONS,bezierLoop:AIRPORT_RAIL_BEZIER_LOOP,designSpeedMps:33.33,lineSpeedMps:27.78,minimumDesignRadius:85,airportLoop:true,connectsAtStationId:"industrial"})
    ]),
    trackOffset:2.65,
    gauge:1.435,
    ballastWidth:3.45,
    designSpeedMps:55.88,
    urbanLineSpeedMps:44.44,
    formationCoachCount:5,
    minimumDesignRadius:180,
    gradeSeparation:Object.freeze({
      type:"rail-over-road",
      railElevation:7.2,
      minimumRoadClearance:5.35,
      deckDepth:.72,
      maximumGradient:.035,
      crossingMergeDistance:52,
      platformCrossingBuffer:24
    }),
    stationAccess:Object.freeze({
      maximumRoadDistance:118,
      minimumRoadDistance:16,
      minimumPlatformRoadClearance:8,
      maximumPlatformGradient:.003,
      platformWidth:4.0,
      platformInnerClearance:2.15,
      groundStationMaximumElevation:.55,
      elevatedStationMinimumElevation:6.25,
      parkingSpaces:18,
      busStop:true,
      minimumStationSpacing:260,
      minimumPlatformGap:110,
      minimumBuildingPlatformSetback:5.4,
      minimumBuildingTrackClearance:9.5
    })
  }),
  transit:Object.freeze({routes:TRANSIT_ROUTES}),
  airport:EASTMERE_AIRPORT,
  airports:AIRPORTS,
  aviation:Object.freeze({aircraftCount:10,cruiseAltitude:210,cruiseSpeed:88,turnaroundSeconds:9,boardingSeconds:10,prepareSeconds:3,minimumAirportReserve:1}),
  mapRegions:Object.freeze({
    city:Object.freeze({minX:-650,maxX:1050,minZ:-700,maxZ:1050}),
    island:Object.freeze({minX:10650,maxX:12250,minZ:-50,maxZ:1580}),
    route:BOUNDS
  }),
  reservedZones:RESERVED_ZONES
});

export function worldWidth(definition=WORLD_DEFINITION){return definition.bounds.maxX-definition.bounds.minX;}
export function worldHeight(definition=WORLD_DEFINITION){return definition.bounds.maxZ-definition.bounds.minZ;}
export function worldCentre(definition=WORLD_DEFINITION){return{x:(definition.bounds.minX+definition.bounds.maxX)*.5,z:(definition.bounds.minZ+definition.bounds.maxZ)*.5};}
export function pointInWorldBounds(x,z,bounds=WORLD_DEFINITION.bounds,padding=0){
  return x>=bounds.minX-padding&&x<=bounds.maxX+padding&&z>=bounds.minZ-padding&&z<=bounds.maxZ+padding;
}

export function districtAtWorldPosition(x,z,definition=WORLD_DEFINITION){
  return definition.districts.find(d=>x>=d.minX&&x<=d.maxX&&z>=d.minZ&&z<=d.maxZ)??{id:"outskirts",name:"Outskirts"};
}

export function validateWorldDefinition(definition=WORLD_DEFINITION,{graph=null,railPlan=null}={}){
  const errors=[],seen=(items,label)=>{
    const ids=new Set();
    for(const item of items){
      if(!item?.id){errors.push(`${label} contains an item without an id`);continue;}
      if(ids.has(item.id))errors.push(`${label} contains duplicate id ${item.id}`);ids.add(item.id);
    }
  };
  const checkPoint=(label,x,z,padding=0)=>{if(!pointInWorldBounds(x,z,definition.bounds,padding))errors.push(`${label} (${x}, ${z}) lies outside world bounds`);};

  const {bounds}=definition;
  if(definition.trafficSide!=="left")errors.push("the city must use UK left-hand traffic");
  if(!(bounds.minX<bounds.maxX&&bounds.minZ<bounds.maxZ))errors.push("world bounds are invalid");
  seen(definition.cities,"cities");seen(definition.districts,"districts");seen(definition.roads.nodes,"road nodes");seen(definition.roads.links,"roads");seen(definition.rail.stations,"rail stations");for(const route of definition.rail.routes??[])seen(route.stations??[],`rail route ${route.id} stations`);seen(definition.transit.routes,"transit routes");

  const nodeIds=new Set(definition.roads.nodes.map(node=>node.id));
  for(const city of definition.cities)checkPoint(`city ${city.id}`,city.x,city.z);
  for(const node of definition.roads.nodes)checkPoint(`road node ${node.id}`,node.x,node.z);
  for(const roadDef of definition.roads.links){
    if(!nodeIds.has(roadDef.from))errors.push(`road ${roadDef.id} has unknown start node ${roadDef.from}`);
    if(!nodeIds.has(roadDef.to))errors.push(`road ${roadDef.id} has unknown end node ${roadDef.to}`);
    if(!definition.roads.styles[roadDef.style])errors.push(`road ${roadDef.id} has unknown style ${roadDef.style}`);
    roadDef.via.forEach(([x,z],index)=>checkPoint(`road ${roadDef.id} control point ${index}`,x,z));
  }
  for(const route of definition.rail.routes??[{id:"city",stations:definition.rail.stations,controlPoints:definition.rail.controlPoints}]){
    for(const station of route.stations??[])checkPoint(`rail station ${route.id}/${station.id}`,station.x,station.z);
    for(const [index,[x,z]] of (route.controlPoints??[]).entries())checkPoint(`rail route ${route.id} control point ${index}`,x,z);
    if(route.ellipse){
      const {centreX,centreZ,radiusX,radiusZ}=route.ellipse;checkPoint(`rail route ${route.id} ellipse centre`,centreX,centreZ,Math.max(radiusX,radiusZ));
      if(!(radiusX>100&&radiusZ>100))errors.push(`rail route ${route.id} ellipse is too tight`);
    }
    if(route.bezierLoop){
      if((route.bezierLoop.points??[]).length<6)errors.push(`rail route ${route.id} Bézier loop has too few control points`);
      for(const [index,point] of (route.bezierLoop.points??[]).entries()){
        checkPoint(`rail route ${route.id} Bézier point ${index}`,point.x,point.z);
        if(Math.hypot(point.tx??0,point.tz??0)<.5)errors.push(`rail route ${route.id} Bézier point ${index} has no usable tangent`);
      }
    }
  }
  const airports=definition.airports??(definition.airport?[definition.airport]:[]);
  seen(airports,"airports");
  for(const airport of airports){
    checkPoint(`airport ${airport.id}`,airport.x,airport.z);
    if(airport.accessNode&&!nodeIds.has(airport.accessNode))errors.push(`airport access node ${airport.accessNode} is missing`);
    if(airport.runway.length<250||airport.runway.width<24)errors.push(`airport ${airport.id} runway is too small`);
    if((airport.standCount??1)<1)errors.push(`airport ${airport.id} has no stands`);
  }
  if(airports.length>1&&(definition.aviation?.aircraftCount??0)<2)errors.push("multi-airport aviation requires an operational fleet");
  const grade=definition.rail.gradeSeparation;
  if(!grade||grade.type!=="rail-over-road")errors.push("rail grade-separation policy is missing");
  else{
    if(grade.railElevation-grade.deckDepth<grade.minimumRoadClearance)errors.push("rail bridge clearance is insufficient");
    if(!(grade.maximumGradient>0&&grade.maximumGradient<=.04))errors.push("rail maximum gradient is unrealistic");
  }

  for(const route of definition.transit.routes){
    for(const nodeId of route.nodes)if(!nodeIds.has(nodeId))errors.push(`transit route ${route.id} references unknown node ${nodeId}`);
    if(graph){
      for(let i=0;i<route.nodes.length-1;i++)if(!graph.route(route.nodes[i],route.nodes[i+1]).length)errors.push(`transit route ${route.id} cannot reach ${route.nodes[i+1]} from ${route.nodes[i]}`);
    }
  }
  if(railPlan){
    if(railPlan.schemaVersion!==5)errors.push("resolved rail plan is from an incompatible cached build; reload the updated simulation");
    if((railPlan.routes??[]).length<2)errors.push("resolved rail plan is missing the airport loop");
    for(const station of railPlan.stations){
      checkPoint(`resolved rail station ${station.id}`,station.x,station.z);
      if(!station.roadAccess)errors.push(`resolved rail station ${station.id} has no road access`);
    }
    for(const separation of railPlan.gradeSeparations??[]){
      checkPoint(`grade separation ${separation.id}`,separation.position.x,separation.position.z);
      if(separation.clearance<definition.rail.gradeSeparation.minimumRoadClearance)errors.push(`grade separation ${separation.id} has insufficient clearance`);
    }
  }
  return errors;
}
