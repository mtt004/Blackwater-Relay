import * as THREE from "three";

const wrap=value=>((value%1)+1)%1;

/**
 * Immutable, cache-friendly samples for a closed railway curve.
 * Runtime consumers interpolate these typed arrays instead of repeatedly
 * invoking Curve.getPointAt/getTangentAt and allocating temporary vectors.
 */
export class RailCurveLookup{
  constructor(curve,length,{spacing=.75}={}){
    this.length=Math.max(.001,length||curve.getLength());
    this.sampleCount=Math.max(256,Math.ceil(this.length/spacing));
    this.spacing=this.length/this.sampleCount;
    const values=this.sampleCount+1;
    this.positions=new Float32Array(values*3);
    this.tangents=new Float32Array(values*3);
    this.normals=new Float32Array(values*2);
    this.gradients=new Float32Array(values);
    this.curvatures=new Float32Array(values);
    const point=new THREE.Vector3(),tangent=new THREE.Vector3();
    for(let index=0;index<=this.sampleCount;index++){
      const t=index===this.sampleCount?0:index/this.sampleCount;
      curve.getPointAt(t,point);curve.getTangentAt(t,tangent).normalize();
      const base=index*3,normalBase=index*2,horizontalLength=Math.hypot(tangent.x,tangent.z)||1;
      this.positions[base]=point.x;this.positions[base+1]=point.y;this.positions[base+2]=point.z;
      this.tangents[base]=tangent.x;this.tangents[base+1]=tangent.y;this.tangents[base+2]=tangent.z;
      this.normals[normalBase]=-tangent.z/horizontalLength;this.normals[normalBase+1]=tangent.x/horizontalLength;
      this.gradients[index]=tangent.y;
    }
    // The turn angle per metre is sufficient for speed/visual queries and is
    // calculated once because the geometry is immutable after RailPlan.
    for(let index=0;index<this.sampleCount;index++){
      const next=index+1,a=index*3,b=next*3;
      const dot=THREE.MathUtils.clamp(this.tangents[a]*this.tangents[b]+this.tangents[a+1]*this.tangents[b+1]+this.tangents[a+2]*this.tangents[b+2],-1,1);
      this.curvatures[index]=Math.acos(dot)/this.spacing;
    }
    this.curvatures[this.sampleCount]=this.curvatures[0];
  }

  samplePosition(progress,target=new THREE.Vector3()){
    const scaled=wrap(progress)*this.sampleCount,index=Math.floor(scaled),next=index+1,alpha=scaled-index,a=index*3,b=next*3;
    return target.set(
      THREE.MathUtils.lerp(this.positions[a],this.positions[b],alpha),
      THREE.MathUtils.lerp(this.positions[a+1],this.positions[b+1],alpha),
      THREE.MathUtils.lerp(this.positions[a+2],this.positions[b+2],alpha)
    );
  }

  sampleTangent(progress,target=new THREE.Vector3()){
    const scaled=wrap(progress)*this.sampleCount,index=Math.floor(scaled),next=index+1,alpha=scaled-index,a=index*3,b=next*3;
    return target.set(
      THREE.MathUtils.lerp(this.tangents[a],this.tangents[b],alpha),
      THREE.MathUtils.lerp(this.tangents[a+1],this.tangents[b+1],alpha),
      THREE.MathUtils.lerp(this.tangents[a+2],this.tangents[b+2],alpha)
    ).normalize();
  }

  sampleOffsetPosition(progress,offset,target=new THREE.Vector3()){
    const scaled=wrap(progress)*this.sampleCount,index=Math.floor(scaled),next=index+1,alpha=scaled-index,a=index*3,b=next*3,na=index*2,nb=next*2;
    const nx=THREE.MathUtils.lerp(this.normals[na],this.normals[nb],alpha),nz=THREE.MathUtils.lerp(this.normals[na+1],this.normals[nb+1],alpha),normalLength=Math.hypot(nx,nz)||1;
    return target.set(
      THREE.MathUtils.lerp(this.positions[a],this.positions[b],alpha)+nx/normalLength*offset,
      THREE.MathUtils.lerp(this.positions[a+1],this.positions[b+1],alpha),
      THREE.MathUtils.lerp(this.positions[a+2],this.positions[b+2],alpha)+nz/normalLength*offset
    );
  }

  sampleGradient(progress){const scaled=wrap(progress)*this.sampleCount,index=Math.floor(scaled),alpha=scaled-index;return THREE.MathUtils.lerp(this.gradients[index],this.gradients[index+1],alpha);}
  sampleCurvature(progress){const scaled=wrap(progress)*this.sampleCount,index=Math.floor(scaled),alpha=scaled-index;return THREE.MathUtils.lerp(this.curvatures[index],this.curvatures[index+1],alpha);}
}
