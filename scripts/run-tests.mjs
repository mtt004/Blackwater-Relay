const result={innerHTML:''};
globalThis.__TEST_FILTER=process.env.TEST_FILTER??'';
const rangeText=process.env.TEST_RANGE??'';globalThis.__TEST_RANGE=rangeText?rangeText.split(':').map(Number):undefined;
globalThis.document={getElementById:id=>id==='results'?result:null,pointerLockElement:null};
globalThis.window={};globalThis.localStorage={getItem:()=>null,setItem:()=>{}};globalThis.addEventListener=()=>{};
await import(`../tests/tests.js?node-run=${Date.now()}`);
const passes=(result.innerHTML.match(/class="pass"/g)||[]).length,failures=(result.innerHTML.match(/<p class="fail">[^<]*<\/p>/g)||[]);
if(failures.length){console.error(failures.join('\n').replace(/<[^>]+>/g,''));process.exit(1);}if(!passes){console.error(`No tests matched filter: ${globalThis.__TEST_FILTER||'(none)'}`);process.exit(1);}console.log(`Tests passed: ${passes}${globalThis.__TEST_FILTER?` (filter: ${globalThis.__TEST_FILTER})`:''}`);process.exit(0);
