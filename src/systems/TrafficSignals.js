import * as THREE from "three";

function phaseGroupForLane(lane){
  const tangent=lane.curve.getTangentAt(1).setY(0).normalize();
  return Math.abs(tangent.x)>=Math.abs(tangent.z)?0:1;
}

function createSignalAssembly(lane,{secondary=false}={}){
  const group=new THREE.Group(),poleMat=new THREE.MeshStandardMaterial({color:0x24292c,roughness:.72});
  const poleHeight=secondary?4.1:5.1;
  const pole=new THREE.Mesh(new THREE.CylinderGeometry(.10,.14,poleHeight,8),poleMat);pole.position.y=poleHeight*.5;
  const head=new THREE.Mesh(new THREE.BoxGeometry(.66,1.72,.52),poleMat);head.position.y=poleHeight-.52;
  const makeLamp=(y,dark)=>{const mesh=new THREE.Mesh(new THREE.SphereGeometry(.17,10,8),new THREE.MeshStandardMaterial({color:dark,emissive:0x000000,roughness:.38}));mesh.position.set(0,y,.29);return mesh;};
  const red=makeLamp(poleHeight+.01,0x2d0807),amber=makeLamp(poleHeight-.52,0x30210a),green=makeLamp(poleHeight-1.05,0x092d13);
  group.add(pole,head,red,amber,green);group.userData={laneId:lane.id,red,amber,green};return group;
}

export class TrafficSignals{
  constructor(scene,graph){
    this.scene=scene;this.graph=graph;this.time=0;this.visuals=new Map();this.priority=new Map();this.chunkManager=null;this.buildVisuals();
  }

  buildVisuals(){
    for(const node of this.graph.nodes.values()){
      if(node.control!=="signal")continue;
      const byRoad=new Map();
      for(const lane of this.graph.lanes.values()){
        if(lane.to!==node.id)continue;
        if(!byRoad.has(lane.roadId))byRoad.set(lane.roadId,[]);byRoad.get(lane.roadId).push(lane);
      }
      const nodeVisuals=[];
      for(const lanes of byRoad.values()){
        lanes.sort((a,b)=>a.index-b.index);const outer=lanes.at(-1),inner=lanes[0],road=this.graph.roads.get(outer.roadId);
        const tangent=outer.curve.getTangentAt(1).setY(0).normalize(),left=new THREE.Vector3(-tangent.z,0,tangent.x);
        const primary=createSignalAssembly(outer),primaryPos=outer.curve.getPointAt(1).addScaledVector(left,road.laneWidth*.72).addScaledVector(tangent,-.55);
        primary.position.copy(primaryPos);primary.rotation.y=Math.atan2(-tangent.x,-tangent.z);this.scene.add(primary);
        nodeVisuals.push({lane:outer,group:primary,...primary.userData});
        if(road.lanesEachWay>1){
          const secondary=createSignalAssembly(inner,{secondary:true}),right=new THREE.Vector3(tangent.z,0,-tangent.x),secondaryPos=inner.curve.getPointAt(1).addScaledVector(right,road.laneWidth*.72).addScaledVector(tangent,1.2);
          secondary.position.copy(secondaryPos);secondary.rotation.y=Math.atan2(-tangent.x,-tangent.z);this.scene.add(secondary);
          nodeVisuals.push({lane:inner,group:secondary,...secondary.userData});
        }
      }
      this.visuals.set(node.id,nodeVisuals);
    }
  }

  setChunkManager(manager){this.chunkManager=manager;}
  requestPriority(nodeId,laneId,duration=5){const lane=this.graph.lanes.get(laneId);this.priority.set(nodeId,{laneId,roadId:lane?.roadId,until:this.time+duration});}

  phaseState(group){
    const t=this.time%30;
    if(group===0){if(t<10)return"green";if(t<12)return"amber";return"red";}
    if(t>=13&&t<23)return"green";if(t>=23&&t<25)return"amber";return"red";
  }

  stateForLane(lane){
    const node=this.graph.nodes.get(lane.to);if(node?.control!=="signal")return"green";
    const priority=this.priority.get(node.id);if(priority&&priority.until>this.time&&(priority.laneId===lane.id||priority.roadId===lane.roadId))return"green";
    return this.phaseState(phaseGroupForLane(lane));
  }

  pedestrianCanCross(nodeId){
    const node=this.graph.nodes.get(nodeId);if(node?.control!=="signal")return true;
    const t=this.time%30;return t>=26;
  }

  setLamp(lamp,on,color,emissive){lamp.material.color.setHex(on?color:color===0xff2a1f?0x2d0807:color===0xffa32c?0x30210a:0x092d13);lamp.material.emissive.setHex(on?emissive:0x000000);}

  update(dt){
    this.time+=dt;
    for(const visuals of this.visuals.values())for(const visual of visuals){
      visual.group.visible=this.chunkManager?this.chunkManager.isDetailedPosition(visual.group.position):true;
      const state=this.stateForLane(visual.lane);
      this.setLamp(visual.red,state==="red",0xff2a1f,0x7f0800);this.setLamp(visual.amber,state==="amber",0xffa32c,0x7a3a00);this.setLamp(visual.green,state==="green",0x3df06c,0x0e7a2c);
    }
  }
}
