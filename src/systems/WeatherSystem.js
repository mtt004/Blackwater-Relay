import * as THREE from "three";

export class WeatherSystem {
  constructor(scene,camera,lights,roadMaterials){
    this.scene=scene;this.camera=camera;this.lights=lights;this.roadMaterials=roadMaterials;
    this.mode="clear";this.timeOfDay=8;this.timeScale=.035;this.focus=new THREE.Vector3();
    this.sunTarget=new THREE.Object3D();this.scene.add(this.sunTarget);this.lights.sun.target=this.sunTarget;
    this.rain=this.createRain();this.scene.add(this.rain);this.rain.visible=false;
    this.apply();
  }
  createRain(){
    const count=2500,positions=new Float32Array(count*3);
    for(let i=0;i<count;i++){positions[i*3]=(Math.random()-.5)*180;positions[i*3+1]=Math.random()*90;positions[i*3+2]=(Math.random()-.5)*180;}
    const geo=new THREE.BufferGeometry();geo.setAttribute("position",new THREE.BufferAttribute(positions,3));
    return new THREE.Points(geo,new THREE.PointsMaterial({color:0xbfd9e7,size:.11,transparent:true,opacity:.65}));
  }
  cycle(){
    const modes=["clear","overcast","rain","fog"];
    this.mode=modes[(modes.indexOf(this.mode)+1)%modes.length];this.apply();return this.mode;
  }
  advanceTime(){this.timeOfDay=(this.timeOfDay+4)%24;}
  apply(){
    const rain=this.mode==="rain",fog=this.mode==="fog";
    this.rain.visible=rain;
    this.scene.fog=new THREE.FogExp2(fog?0x929ba0:rain?0x4f5c64:0xa8bdc6,fog?.0085:rain?.0038:.00115);
    for(const m of this.roadMaterials){m.roughness=rain?.28:.84;m.metalness=rain?.22:.05;}
  }
  setFocus(position){this.focus.copy(position);}
  update(dt){
    this.timeOfDay=(this.timeOfDay+dt*this.timeScale)%24;
    const angle=(this.timeOfDay/24)*Math.PI*2-Math.PI/2;
    const daylight=Math.max(.06,Math.sin(angle)*.5+.5);
    this.sunTarget.position.copy(this.focus);
    this.lights.sun.position.set(this.focus.x+Math.cos(angle)*400,Math.max(18,this.focus.y+Math.sin(angle)*420),this.focus.z-220);
    this.lights.sun.intensity=daylight*2.4;
    this.lights.hemi.intensity=.22+daylight*.82;
    const bg=new THREE.Color().setHSL(.57,.28,.08+daylight*.48);
    if(this.mode==="overcast")bg.multiplyScalar(.72);
    if(this.mode==="rain")bg.multiplyScalar(.55);
    this.scene.background=bg;
    if(this.rain.visible){
      this.rain.position.x=this.camera.position.x;this.rain.position.z=this.camera.position.z;
      const pos=this.rain.geometry.attributes.position;
      for(let i=0;i<pos.count;i++){
        let y=pos.getY(i)-dt*(36+(i%13));
        if(y<0)y=85+Math.random()*10;
        pos.setY(i,y);
      }
      pos.needsUpdate=true;
    }
  }
  clockText(){
    const h=Math.floor(this.timeOfDay),m=Math.floor((this.timeOfDay-h)*60);
    return `${String(h).padStart(2,"0")}:${String(m).padStart(2,"0")}`;
  }
}
