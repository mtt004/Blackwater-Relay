export class Input {
  constructor(){
    this.down = new Set();
    this.pressed = new Set();
    this.mouseDX = 0;
    this.mouseDY = 0;
    addEventListener("keydown", e=>{
      if(!this.down.has(e.code)) this.pressed.add(e.code);
      this.down.add(e.code);
      if(["Space","ArrowUp","ArrowDown","ArrowLeft","ArrowRight","F8"].includes(e.code)||(e.code==="Tab"&&document.pointerLockElement)) e.preventDefault();
    });
    addEventListener("keyup", e=>this.down.delete(e.code));
    addEventListener("mousemove", e=>{
      if(document.pointerLockElement){
        this.mouseDX += e.movementX;
        this.mouseDY += e.movementY;
      }
    });
  }
  isDown(code){ return this.down.has(code); }
  consume(code){
    const had=this.pressed.has(code);
    this.pressed.delete(code);
    return had;
  }
  endFrame(){
    this.pressed.clear();
    this.mouseDX=0;
    this.mouseDY=0;
  }
}
