const aspectRank={red:0,yellow:1,"double-yellow":2,green:3};
const nowMs=()=>typeof performance!=="undefined"?performance.now():Date.now();

export class RailBlockSystem{
  constructor(network){
    this.network=network;this.states=new Map(network.blocks.map(block=>[block.id,block]));this.conflicts=[];this.lastOccupationUpdateMs=0;
    this.occupiedByTrain=new Map();this.reservedByTrain=new Map();this.conflictByBlock=new Map();this.changedBlocks=new Set();
  }

  block(id){return this.states.get(id)??null;}
  clearOccupancy(){
    for(const [trainId,blocks] of this.occupiedByTrain)for(const block of blocks)block.occupiedBy.delete(trainId);
    this.occupiedByTrain.clear();this.changedBlocks.clear();this.conflictByBlock.clear();this.conflicts.length=0;
  }
  updateOccupancy(trains){
    const start=nowMs(),activeTrainIds=new Set();this.changedBlocks.clear();
    for(const train of trains){
      activeTrainIds.add(train.id);
      const route=this.network.route(train.routeId);if(!route)continue;
      const previous=this.occupiedByTrain.get(train.id)??new Set(),next=train._nextOccupiedBlocks??new Set();next.clear();
      const sampleStep=18,total=Math.max(1,train.formation?.totalLength??120),samples=Math.ceil(total/sampleStep);
      for(let index=0;index<=samples;index++){
        const behind=Math.min(total,index*sampleStep),t=((train.progress-train.direction*behind/route.length)%1+1)%1,block=this.network.blockForProgress(train.routeId,train.trackIndex,t);if(block)next.add(block);
      }
      for(const block of previous)if(!next.has(block)){block.occupiedBy.delete(train.id);this.changedBlocks.add(block);}
      for(const block of next)if(!previous.has(block)){block.occupiedBy.add(train.id);this.changedBlocks.add(block);}
      train._nextOccupiedBlocks=previous;this.occupiedByTrain.set(train.id,next);
    }
    for(const [trainId,blocks] of this.occupiedByTrain){
      if(activeTrainIds.has(trainId))continue;
      for(const block of blocks){block.occupiedBy.delete(trainId);this.changedBlocks.add(block);}this.occupiedByTrain.delete(trainId);
    }
    for(const block of this.changedBlocks){
      if(block.occupiedBy.size>1)this.conflictByBlock.set(block.id,{blockId:block.id,trains:[...block.occupiedBy]});
      else this.conflictByBlock.delete(block.id);
    }
    this.conflicts.length=0;for(const conflict of this.conflictByBlock.values())this.conflicts.push(conflict);
    this.lastOccupationUpdateMs=nowMs()-start;
  }

  releaseReservations(trainId){
    const owned=this.reservedByTrain.get(trainId);if(!owned)return;
    for(const block of owned)if(block.reservedBy===trainId){block.reservedBy=null;block.reservationDirection=null;}
    owned.clear();
  }
  reserveBlocks(train,blocks){
    for(const block of blocks){let occupiedByOther=false;for(const id of block.occupiedBy)if(id!==train.id){occupiedByOther=true;break;}if(occupiedByOther||(block.reservedBy&&block.reservedBy!==train.id))return false;}
    let owned=this.reservedByTrain.get(train.id);if(!owned){owned=new Set();this.reservedByTrain.set(train.id,owned);}
    for(const block of blocks){block.reservedBy=train.id;block.reservationDirection=train.direction;owned.add(block);}return true;
  }
  canEnter(train,block){if(!block)return false;for(const id of block.occupiedBy)if(id!==train.id)return false;return!block.reservedBy||block.reservedBy===train.id;}

  authorityForTrain(train,maxBlocks=5){
    const sequence=this.network.blocksAhead(train.routeId,train.trackIndex,train.progress,train.direction,maxBlocks),reserved=[];let speedLimit=Infinity;
    for(const block of sequence){if(block.occupiedBy.has(train.id)||block.reservedBy===train.id){reserved.push(block);speedLimit=Math.min(speedLimit,block.speedLimit);}else break;}
    const current=sequence[0]??null,last=reserved.at(-1)??current;if(!current||!last)return{blocks:[],distance:0,endProgress:train.progress,speedLimit:0};
    const boundary=train.direction>0?last.endT:last.startT,distance=this.network.forwardDistance(train.routeId,train.progress,boundary,train.direction);
    return{blocks:reserved,distance,endProgress:boundary,speedLimit:Number.isFinite(speedLimit)?speedLimit:train.routeLimit};
  }

  aspectForSignal(signal){
    const protectedBlock=this.block(signal.protectsBlockId);if(!protectedBlock)return{aspect:"red",clearedFor:null};
    if(protectedBlock.occupiedBy.size)return{aspect:"red",clearedFor:null};
    const owner=protectedBlock.reservedBy;if(!owner)return{aspect:"red",clearedFor:null};
    const next=this.network.nextBlock(protectedBlock,signal.direction,1),next2=this.network.nextBlock(protectedBlock,signal.direction,2);
    if(next&&(next.occupiedBy.size||(next.reservedBy&&next.reservedBy!==owner)))return{aspect:"yellow",clearedFor:owner};
    if(next2&&(next2.occupiedBy.size||(next2.reservedBy&&next2.reservedBy!==owner)))return{aspect:"double-yellow",clearedFor:owner};
    return{aspect:"green",clearedFor:owner};
  }
  updateSignalAspects(){for(const signal of this.network.signals){const state=this.aspectForSignal(signal);signal.aspect=state.aspect;signal.clearedFor=state.clearedFor;}}
  signalAhead(train){
    const block=this.network.blockForProgress(train.routeId,train.trackIndex,train.progress);if(!block)return null;const signal=this.network.signalById.get(block.exitSignalId);if(!signal)return null;const aspect=signal.clearedFor===train.id?signal.aspect:"red";return{signal,aspect,distance:this.network.forwardDistance(train.routeId,train.progress,signal.progress,train.direction)};
  }
  diagnostics(){let occupied=0,reserved=0;for(const block of this.states.values()){if(block.occupiedBy.size)occupied++;if(block.reservedBy)reserved++;}return{occupiedBlocks:occupied,reservedBlocks:reserved,conflicts:this.conflicts.length,occupationUpdateMs:this.lastOccupationUpdateMs};}
  static mostRestrictive(a,b){return aspectRank[a]<=aspectRank[b]?a:b;}
}
