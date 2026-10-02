import {readdirSync,readFileSync,statSync} from 'node:fs';
import {join} from 'node:path';
import {spawnSync} from 'node:child_process';
const roots=['src','tests','scripts'],files=[];
function walk(dir){for(const name of readdirSync(dir)){const path=join(dir,name),stat=statSync(path);if(stat.isDirectory())walk(path);else if(path.endsWith('.js')||path.endsWith('.mjs'))files.push(path);}}
for(const root of roots)walk(root);
const failures=[];let cacheTag=null,unsafeDynamicCode=new RegExp('ev'+'al\\s*\\(');
for(const file of files){
  const result=spawnSync(process.execPath,['--check',file],{encoding:'utf8'});if(result.status!==0)failures.push(`${file}: ${result.stderr.trim()}`);
  const text=readFileSync(file,'utf8'),lines=text.split(/\r?\n/);
  lines.forEach((line,index)=>{if(/[ \t]+$/.test(line))failures.push(`${file}:${index+1} trailing whitespace`);if(unsafeDynamicCode.test(line))failures.push(`${file}:${index+1} dynamic code evaluation is forbidden`);});
  for(const match of text.matchAll(/\?v=([A-Za-z0-9-]+)/g)){cacheTag??=match[1];if(match[1]!==cacheTag)failures.push(`${file}: inconsistent module cache tag ${match[1]} (expected ${cacheTag})`);}
}
if(failures.length){console.error(failures.join('\n'));process.exit(1);}console.log(`Lint passed: ${files.length} JavaScript files, syntax valid, no trailing whitespace, no eval, one cache tag (${cacheTag}).`);
