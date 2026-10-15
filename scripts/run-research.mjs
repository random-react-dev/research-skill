#!/usr/bin/env node
import os from 'node:os';
import path from 'node:path';
import fs from 'node:fs/promises';
import {makeTask,MANAGED_PROFILE,publicError,check,readBounded} from '../runtime/core.mjs';
import {runWorker,checkEnvironment} from '../runtime/launcher.mjs';
import {start,status,result,cancel,pause,resume} from '../runtime/jobs.mjs';
const args=process.argv.slice(2),action=args.shift();const root=path.join(os.homedir(),'.local/state/research-skill/jobs');
const control=new AbortController();process.once('SIGINT',()=>control.abort());process.once('SIGTERM',()=>control.abort());
try{
 let value;if(action==='control-tick'){check(args.length>=1&&args.length<=2,'USAGE');const {controlTick}=await import('../runtime/control.mjs');value=await controlTick(root,args[0],args[1]);}
 else if(action==='installation-contact'){
 check(args.length<=1,'USAGE');let accessHome=os.homedir(),worker;
 if(args.length){const {directory,read}=await import('../runtime/jobs.mjs');const dir=await directory(root,args[0]),request=await read(dir,'request.json');accessHome=request.accessHome;worker=request.worker;}
 const {installationReporter}=await import('../runtime/installation.mjs');
 value={accepted:await installationReporter({accessHome,worker,role:'helper'}).contact('idle')};
 }else if(action==='verification-receipt'){
 check(args.length===1,'USAGE');const {directory,read}=await import('../runtime/jobs.mjs');const {serviceAccess,mcpClient}=await import('../runtime/mcp-client.mjs');
 const dir=await directory(root,args[0]),request=await read(dir,'request.json');check(request.managed===true,'JOB_MODE_INVALID');
 const receipt=JSON.parse(await readBounded(process.stdin,4096));const upstream=mcpClient({...((request.fixture&&request.access)||await serviceAccess(request.accessHome)),fixture:request.fixture,managed:true,signal:AbortSignal.timeout(20000)});
 value=await upstream({task:request.task,operation:'verification-receipt',receipt});
 }else if(action==='reconcile'){check(args.length===0,'USAGE');const {reconcileAll}=await import('../runtime/reconcile.mjs');value=await reconcileAll(root);}
 else if(['status','result','cancel','pause','resume'].includes(action)){check(args.length===1,'USAGE');value=await ({status,result,cancel,pause,resume})[action]({root,jobId:args[0]});}
 else{check(['start','run','check'].includes(action)&&args.length===2,'USAGE');const [worker,executable]=args;
  if(action==='check')value=await checkEnvironment(worker,executable);
  else{const input=JSON.parse(await readBounded(process.stdin,8192));if(action==='start'&&!input.profile)input.profile=structuredClone(MANAGED_PROFILE);const task=makeTask(input);value=action==='start'?await start({root,task,worker,executable,managed:true,transport:'direct-mcp-v1'}):await runWorker({task,worker,executable,signal:control.signal});}
 }
 console.log(JSON.stringify(value));if(value.state==='FAILED')process.exitCode=1;
}catch(e){console.log(JSON.stringify({state:'FAILED',error:publicError(e)}));process.exitCode=1;}
