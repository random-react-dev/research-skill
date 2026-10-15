import fs from 'node:fs/promises';
import path from 'node:path';
import crypto from 'node:crypto';
import {directory,read,write,launch} from './jobs.mjs';
import {makeTask,DEFAULT_PROFILE,check,readPrivate} from './core.mjs';
import {serviceAccess,mcpClient} from './mcp-client.mjs';

const folder=home=>path.join(home,'.local/state/research-skill/control-events');
function redact(v){return JSON.parse(JSON.stringify(v,(_,x)=>typeof x==='string'?x.replace(/http:\/\/127\.0\.0\.1:\d+\/[a-f0-9]{48}/g,'http://127.0.0.1/[private-relay]').replace(/(bearer\s+|(?:api[_-]?key|password|secret|token)\s*[=:]\s*["']?)[^\s"'&,}]+/gi,'$1[redacted]').slice(0,8000):x));}
export async function recordEvent(home,kind,payload={},job=null){
 const dir=folder(home);await fs.mkdir(dir,{recursive:true,mode:0o700});await directory(dir);
 const files=(await fs.readdir(dir)).filter(n=>n.endsWith('.json'));
 if(files.length>=1000){await write(dir,'overflow.json',{dropped:true});return;}
 const id=crypto.randomUUID();await write(dir,id+'.json',{id,kind,at:Date.now()/1000,job,payload:redact(payload)});
}
export async function flushEvents(home,upstream){
 const dir=folder(home);try{await directory(dir);}catch(e){if(e.code==='ENOENT')return;throw e;}
 const names=(await fs.readdir(dir)).filter(n=>/^[a-f0-9-]{36}\.json$/.test(n)).sort().slice(0,20),events=[];
 for(const n of names)try{events.push(await read(dir,n,32768));}catch{}
 if(!events.length)return;
 const r=await upstream({scope:'control',operation:'events',events});
 for(const id of r.accepted??[])if(events.some(e=>e.id===id))await fs.rm(path.join(dir,id+'.json'),{force:true});
 try{await fs.lstat(path.join(dir,'overflow.json'));await fs.rm(path.join(dir,'overflow.json'));await recordEvent(home,'history.gap',{reason:'local_outbox_full',limit:1000});}catch{}
}

export async function controlTick(root,templateJob,helperLog){
 const dir=await directory(root,templateJob),template=await read(dir,'request.json'),home=template.accessHome;
 const upstream=mcpClient({...await serviceAccess(home),managed:true,signal:AbortSignal.timeout(18000)});
 await flushEvents(home,upstream).catch(()=>{});
 if(helperLog)try{
  const rows=(await readPrivate(helperLog,524288)).trim().split('\n').slice(-20),events=[];
  for(const line of rows){const r=JSON.parse(line),h=crypto.createHash('sha256').update(line).digest('hex').slice(0,32),id=[h.slice(0,8),h.slice(8,12),h.slice(12,16),h.slice(16,20),h.slice(20)].join('-');events.push({id,kind:'helper.'+r.event,at:Date.parse(r.at)/1000,job:null,payload:redact(r)});}
  if(events.length)await upstream({scope:'control',operation:'events',events});
 }catch{}

 // Stable local identity survives a helper restart; pending actions are never reclaimed by a different runner.
 const identity={id:templateJob};
 const {action}=await upstream({scope:'control',operation:'poll',claim:identity.id});
 if(!action)return {pending:false};
 check(/^[a-f0-9-]{36}$/.test(action.id),'ACTION_INVALID');
 const jobDir=path.join(root,action.id);
 // The helper uses the same kernel locking primitive as research jobs.
 const {claimRunner}=await import('./reconcile.mjs');const release=await claimRunner(dir);if(!release)return {busy:true};
 try{
  try{await fs.mkdir(jobDir,{mode:0o700});}catch(e){if(e.code!=='EEXIST')throw e;}
  await directory(root,action.id);
  try{await read(jobDir,'request.json');}catch(e){
   if(e.code!=='ENOENT')throw e;
   const task=makeTask({question:'Owner-requested diagnostic and repair action '+action.id,profile:{...structuredClone(DEFAULT_PROFILE),model_requests:8,prompt_bytes:131072,estimated_cost_microusd:60000,evidence_rounds:1,output_tokens:3072,evidence_sources:16,excerpt_chars:1500}});task.task_id=action.id;
   await fs.mkdir(path.join(jobDir,'tmp'),{recursive:true,mode:0o700});
   await write(jobDir,'state.json',{job_id:action.id,task_id:action.id,state:'STARTING',created_at_ms:Date.now(),updated_at_ms:Date.now(),timeout_ms:360000});
   await write(jobDir,'request.json',{...template,task,managed:true,timeoutMs:360000,support:true});
   await recordEvent(home,'support.prepared',{action_id:action.id},action.id);
  }
  const state=await read(jobDir,'state.json');
  if(state.state==='STARTING')await launch(root,action.id,jobDir);
  else if(!['PARTIAL','COMPLETED','FAILED','INTERRUPTED_UNKNOWN','CANCELLED_LOCAL'].includes(state.state)){
   const {reconcileJob}=await import('./reconcile.mjs');await reconcileJob({root,jobId:action.id,wake:true});
  }
  return {pending:true,action_id:action.id};
 }finally{await release();}
}
