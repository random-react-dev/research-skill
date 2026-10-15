import fs from 'node:fs/promises';
import path from 'node:path';
import {spawn} from 'node:child_process';
import {check,uuid,validateTask,validateResult} from './core.mjs';
import {directory,read,write,launch} from './jobs.mjs';
import {serviceAccess,mcpClient} from './mcp-client.mjs';

// A kernel lock held on this descriptor is released on process exit/reboot.
// The persistent file is never unlinked, so contenders always lock one inode.
export async function claimRunner(dir){
 check(process.platform==='darwin','PLATFORM_UNQUALIFIED');
 const lock=path.join(dir,'runner.lock');
 const handle=await fs.open(lock,fs.constants.O_CREAT|fs.constants.O_RDWR|fs.constants.O_NOFOLLOW,0o600);
 try{
  const s=await handle.stat();check(s.isFile()&&s.nlink===1&&s.uid===process.getuid()&&!(s.mode&0o077),'RUNNER_LOCK_INVALID');
  const child=spawn('/usr/bin/lockf',['-s','-t','0','3'],{stdio:['ignore','ignore','ignore',handle.fd]});
  const code=await new Promise((resolve,reject)=>{child.once('error',reject);child.once('close',resolve);});
  if(code===75){await handle.close();return null;}
  check(code===0,'RUNNER_LOCK_FAILED');
  return ()=>handle.close();
 }catch(e){await handle.close();throw e;}
}

export async function reconcileJob({root,jobId,upstream:injected,force=false,resume=false,wake=false,launchWorker=launch}){
 const dir=await directory(root,jobId),release=await claimRunner(dir);if(!release)return {job_id:jobId,busy:true};
 let shouldWake=false;
 try{
  const request=await read(dir,'request.json');check(request.managed===true,'JOB_MODE_INVALID');validateTask(request.task);
  let state=await read(dir,'state.json');
  if(state.error?.code==='STARTUP_CONSENT_REQUIRED'||state.state==='FAILED'&&state.server_admitted===false)return state;
  if(state.retrieved&&!force)return state;
  if(!force&&state.next_check_ms>Date.now())return state;
  try{
   const upstream=injected??mcpClient({...((request.fixture&&request.access)||await serviceAccess(request.accessHome)),fixture:request.fixture,managed:true,signal:AbortSignal.timeout(20000)});
   const exists=async name=>{try{await fs.lstat(path.join(dir,name));return true;}catch(e){if(e.code==='ENOENT')return false;throw e;}};
   check(!resume||!await exists('cancel'),'JOB_CANCELLED');
   const operation=await exists('cancel')?'cancel':resume?'resume':await exists('pause')?'pause':'status';
   const remote=await upstream({task:request.task,operation});
   check(remote.report_id===request.task.task_id.replaceAll('-',''),'JOB_ID_CHANGED');
   if(resume&&remote.state==='RUNNING'){await fs.rm(path.join(dir,'pause'),{force:true});state.retrieved=false;}
   const terminal=['COMPLETED','PARTIAL','FAILED','CANCELLED_LOCAL','INTERRUPTED_UNKNOWN'];
   state={...state,state:remote.state==='RUNNING'?(remote.setup_required?'WAITING_SETUP':'WAITING_SERVER'):remote.state,enrollment_pending:!!remote.setup_required,message:remote.setup_required?'I’m getting approval from the server to start research. Please wait 30 seconds.':undefined,server:remote,updated_at_ms:Date.now(),next_check_ms:Date.now()+60000,failures:0,connection:'ONLINE'};
   if([...terminal,'PAUSED','CANCEL_PENDING'].includes(remote.state)){
    const result=validateResult(await upstream({task:request.task,operation:'result'}),request.task);
    await write(dir,'result.json',{completed_at_ms:Date.now(),result:{state:result.state,task_id:request.task.task_id,result}});
    state.retrieved=terminal.includes(remote.state);state.delivery=state.retrieved?'AVAILABLE':'PENDING';
   }
   if(wake&&operation==='status'&&remote.state==='RUNNING'&&(!remote.submitted||remote.worker_event)){
    let checkpoint;try{checkpoint=await read(path.join(dir,'profile'),'session.json',16384);}catch(e){if(e.code!=='ENOENT')throw e;}
    const {workerStillRunning}=await import('./coordinator.mjs');
    if(checkpoint&&await workerStillRunning(checkpoint)){state.local_error='LOCAL_WORKER_STILL_RUNNING';}
    else if(checkpoint?.pending_calls?.length){state.local_error='LOCAL_ACTION_OUTCOME_UNKNOWN';}
    else if(!await exists('pause')&&!await exists('cancel')){shouldWake=true;state.local_error=null;state.wake_requested=true;}
   }
   await write(dir,'state.json',state);return state;
  }catch(error){
   const failures=Math.min(5,(state.failures??0)+1);
   state={...state,failures,next_check_ms:Date.now()+Math.min(300000,30000*2**failures)*(0.8+Math.random()*0.4),connection:permanent(error)?'ACTION_REQUIRED':'OFFLINE',error:{code:permanent(error)?(error.code??'LOCAL_STATE_INVALID'):'CONNECTION_UNAVAILABLE'},updated_at_ms:Date.now()};
   await write(dir,'state.json',state);return state;
  }
 }finally{await release();if(shouldWake)await launchWorker(root,jobId,dir);}
}

export async function reconcileAll(root,{budgetMs=18000,wake=true}={}){
 try{await directory(root);}catch(e){if(e.code==='ENOENT')return [];throw e;}
 const results=[],started=Date.now();let cursor='';
 try{cursor=(await read(root,'cursor.json',4096)).after??'';}catch(e){if(e.code!=='ENOENT')throw e;}
 const entries=(await fs.readdir(root,{withFileTypes:true})).filter(e=>e.isDirectory()&&uuid(e.name)).sort((a,b)=>a.name.localeCompare(b.name));
 const ordered=[...entries.filter(e=>e.name>cursor),...entries.filter(e=>e.name<=cursor)];
 for(const entry of ordered){
  if(Date.now()-started>=budgetMs)break;
  if(!entry.isDirectory()||!uuid(entry.name))continue;
  try{
   const dir=await directory(root,entry.name),request=await read(dir,'request.json');
   if(request.managed!==true)continue;
   const state=await read(dir,'state.json');if(state.retrieved)continue;
   results.push(await reconcileJob({root,jobId:entry.name,wake}));}catch(e){results.push({job_id:entry.name,connection:'ACTION_REQUIRED',error:{code:e.code??'LOCAL_STATE_INVALID'}});}
  await write(root,'cursor.json',{after:entry.name});
 }
 return results;
}

function permanent(error){return Boolean(error?.code&&/INVALID|UNSAFE|DENIED|CHANGED|UNQUALIFIED|NOT_ACTIVATED|OUTCOME_UNKNOWN/.test(error.code))||error instanceof SyntaxError;}
