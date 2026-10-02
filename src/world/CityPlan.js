import { RoadGraph } from "../road/RoadGraph.js?v=20261002-flight-sim-terrain";
import { WORLD_DEFINITION } from "./WorldDefinition.js?v=20261002-flight-sim-terrain";

export function buildRoadGraph(definition=WORLD_DEFINITION){
  const graph=new RoadGraph({trafficSide:definition.trafficSide});
  for(const node of definition.roads.nodes){
    graph.addNode(node.id,node.x,node.z,{
      control:node.control,
      district:node.district,
      roundaboutRadius:node.roundaboutRadius??null
    });
  }
  for(const road of definition.roads.links){
    graph.addBidirectionalRoad({
      id:road.id,
      from:road.from,
      to:road.to,
      via:road.via.map(point=>[...point]),
      lanesEachWay:road.lanesEachWay,
      speedLimit:road.speedLimit,
      category:road.category,
      ...definition.roads.styles[road.style]
    });
  }
  graph.finalizeJunctions();
  return graph;
}
