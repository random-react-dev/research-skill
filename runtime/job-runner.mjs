import fs from 'node:fs/promises';
import path from 'node:path';
import {directory,read,write} from './jobs.mjs';
import {runWorker} from './launcher.mjs';
const [root,jobId]=process.argv.slice(2);let dir,state,poll,heartbeat,writing=Promise.resolve(),checking=false,events=[],pauseRequested=false;
const control=new AbortController();process.on('SIGTERM',()=>control.abort());process.on('SIGINT',()=>control.abort());
try{
 dir=await directory(root,jobId);state=await read(dir,'state.json');const request=await read(dir,'request.json');
 poll=setInterval(async()=>{try{await fs.lstat(path.join(dir,'pause'));pauseRequested=true;}catch{};if(checking)return;checking=true;try{await fs.lstat(path.join(dir,'cancel'));control.abort();}catch(e){if(e.code!=='ENOENT')control.abort();}finally{checking=false;}},100);
 heartbeat=setInterval(()=>{writing=writing.then(()=>write(dir,'state.json',{...state,updated_at_ms:Date.now()}));writing.catch(()=>control.abort());},500);
 const output=await runWorker({...request,signal:control.signal,pauseRequested:()=>pauseRequested,onEvent:event=>{
  events.push({...event,observed_at_ms:Date.now()});
  if(event.event==='CLI_STARTED'){state={...state,state:'RUNNING',cli_started:true};writing=writing.then(async()=>{await write(dir,'state.json',{...state,updated_at_ms:Date.now()});if(process.connected)process.send({ready:jobId});});}
 }});
 clearInterval(poll);clearInterval(heartbeat);await writing;const completed_at_ms=Date.now();
 await write(dir,'result.json',{completed_at_ms,result:output,events});await write(dir,'state.json',{...state,state:output.state,updated_at_ms:completed_at_ms});
}catch{
 clearInterval(poll);clearInterval(heartbeat);control.abort();await writing.catch(()=>{});
 if(dir&&state){const completed_at_ms=Date.now();await write(dir,'result.json',{completed_at_ms,result:{state:'FAILED',error:{code:'JOB_SUPERVISOR_FAILED'}},events}).catch(()=>{});await write(dir,'state.json',{...state,state:'FAILED',updated_at_ms:completed_at_ms}).catch(()=>{});}
}finally{clearInterval(poll);clearInterval(heartbeat);if(process.connected)process.disconnect();}
