import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import {spawn} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import {check,uuid,readPrivate,validateTask,validateResult} from './core.mjs';
import {serviceAccess,mcpClient} from './mcp-client.mjs';
import {childEnvironment} from './launcher.mjs';
const terminal=new Set(['COMPLETED','PARTIAL','FAILED','CANCELLED_LOCAL','CANCEL_PENDING','INTERRUPTED_UNKNOWN','PAUSED']);
export async function directory(root,id){check(path.isAbsolute(root)&&root===path.resolve(root)&&(!id||uuid(id)),'JOB_PATH_INVALID');for(const p of [root,...(id?[path.join(root,id)]:[])]){const s=await fs.lstat(p);check(s.isDirectory()&&!s.isSymbolicLink()&&s.uid===process.getuid()&&!(s.mode&0o077)&&await fs.realpath(p)===p,'JOB_DIRECTORY_UNSAFE');}return id?path.join(root,id):root;}
export async function write(dir,name,value){const body=JSON.stringify(value);check(Buffer.byteLength(body)<=16*1024*1024,'JOB_STATE_LIMIT');const tmp=path.join(dir,'.'+crypto.randomUUID());try{const h=await fs.open(tmp,'wx',0o600);try{await h.writeFile(body);await h.sync();}finally{await h.close();}await fs.rename(tmp,path.join(dir,name));}finally{await fs.rm(tmp,{force:true});}}
export const read=async(dir,name,max=16*1024*1024)=>JSON.parse(await readPrivate(path.join(dir,name),max));
export async function status({root,jobId}){const dir=await directory(root,jobId),s=await read(dir,'state.json',4096);check(s.job_id===jobId&&['STARTING','RUNNING',...terminal].includes(s.state),'JOB_STATE_INVALID');if(!terminal.has(s.state)&&(Date.now()-s.updated_at_ms>5000||Date.now()-s.created_at_ms>s.timeout_ms+15000))return {...s,state:'STALE',error:{code:'JOB_OUTCOME_UNKNOWN'}};return s;}
export async function result(options){const s=await status(options);if(!terminal.has(s.state))return {...s,result:null};const dir=await directory(options.root,options.jobId),v=await read(dir,'result.json');check(v.result.state===s.state,'JOB_RESULT_INVALID');const request=await read(dir,'request.json');validateTask(request.task);if(v.result.result)validateResult(v.result.result,request.task);return {...s,...v};}
export async function cancel(options){const s=await status(options);if(s.state==='PAUSED')return cancelPaused(options);if(terminal.has(s.state)||s.state==='STALE')return s;const dir=await directory(options.root,options.jobId);try{const h=await fs.open(path.join(dir,'cancel'),'wx',0o600);await h.close();}catch(e){if(e.code!=='EEXIST')throw e;}return {...s,cancellation_requested:true};}
export async function start({root,task,worker,executable,accessHome=os.homedir(),timeoutMs=(task.profile.execution_seconds+60)*1000,fixture=false,access}){
 validateTask(task);check(Number.isInteger(timeoutMs)&&timeoutMs>=100&&timeoutMs<=2147483647,'DEADLINE_INVALID');check(path.isAbsolute(executable)&&['codex','claude-code'].includes(worker),'WORKER_INVALID');check(!access||fixture,'FIXTURE_ACCESS_DENIED');
 try{await fs.mkdir(root,{recursive:true,mode:0o700});}catch(e){if(e.code!=='EEXIST')throw e;}await directory(root);
 const jobId=crypto.randomUUID(),dir=path.join(root,jobId);await fs.mkdir(dir,{mode:0o700});await fs.mkdir(path.join(dir,'tmp'),{mode:0o700});
 const s={job_id:jobId,task_id:task.task_id,state:'STARTING',created_at_ms:Date.now(),updated_at_ms:Date.now(),timeout_ms:timeoutMs};
 await write(dir,'state.json',s);await write(dir,'request.json',{task,worker,executable,accessHome,timeoutMs,fixture,...(access?{access}:{})});
 return launch(root,jobId,dir);
}
async function launch(root,jobId,dir){
 const child=spawn(process.execPath,[fileURLToPath(new URL('./job-runner.mjs',import.meta.url)),root,jobId],{detached:true,cwd:dir,env:childEnvironment(dir,process.execPath),stdio:['ignore','ignore','ignore','ipc']});
 const ready=await new Promise(resolve=>{const timer=setTimeout(()=>resolve(false),3000);child.once('error',()=>{clearTimeout(timer);resolve(false);});child.once('exit',()=>{clearTimeout(timer);resolve(false);});child.once('message',v=>{clearTimeout(timer);resolve(v?.ready===jobId);});});
 if(child.connected)child.disconnect();child.unref();return {...await status({root,jobId}),...(ready?{}:{start_unconfirmed:true})};
}

export async function pause(options){const s=await status(options);if(terminal.has(s.state)||s.state==='STALE')return s;const dir=await directory(options.root,options.jobId);try{const h=await fs.open(path.join(dir,'pause'),'wx',0o600);await h.close();}catch(e){if(e.code!=='EEXIST')throw e;}return {...s,pause_requested:true};}
export async function resume(options){
 const dir=await directory(options.root,options.jobId);let lock;
 try{lock=await fs.open(path.join(dir,'resume.lock'),'wx',0o600);const s=await status(options);check(s.state==='PAUSED','JOB_NOT_PAUSED');
  const request=await read(dir,'request.json');validateTask(request.task);await fs.rm(path.join(dir,'pause'),{force:true});
  await write(dir,'request.json',{...request,resume:true});await write(dir,'state.json',{...s,state:'STARTING',created_at_ms:Date.now(),updated_at_ms:Date.now()});
  return await launch(options.root,options.jobId,dir);
 }finally{if(lock){await lock.close();await fs.rm(path.join(dir,'resume.lock'),{force:true});}}
}

async function cancelPaused(options){
 const dir=await directory(options.root,options.jobId);let lock;
 try{lock=await fs.open(path.join(dir,'resume.lock'),'wx',0o600);const s=await status(options);check(s.state==='PAUSED','JOB_NOT_PAUSED');const request=await read(dir,'request.json');validateTask(request.task);
 const access=request.access??await serviceAccess(request.accessHome),upstream=mcpClient({...access,fixture:request.fixture,signal:AbortSignal.timeout(10000)});
 let output;try{const receipt=await upstream({task:request.task,operation:'cancel'});const result=validateResult(await upstream({task:request.task,operation:'result'}),request.task);output={state:result.state,task_id:request.task.task_id,result,server_cancellation:receipt,provider_billing_known:false};}
 catch{output={state:'INTERRUPTED_UNKNOWN',task_id:request.task.task_id,error:{code:'CANCEL_UNCONFIRMED'},provider_billing_known:false};}
 const completed_at_ms=Date.now();await write(dir,'result.json',{completed_at_ms,result:output});await write(dir,'state.json',{...s,state:output.state,updated_at_ms:completed_at_ms});return status(options);
 }finally{if(lock){await lock.close();await fs.rm(path.join(dir,'resume.lock'),{force:true});}}
}
