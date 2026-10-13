#!/usr/bin/env node
import os from 'node:os';
import path from 'node:path';
import fs from 'node:fs/promises';
import {makeTask,publicError,check,readBounded} from '../runtime/core.mjs';
import {runWorker,checkEnvironment} from '../runtime/launcher.mjs';
import {start,status,result,cancel,pause,resume} from '../runtime/jobs.mjs';
const args=process.argv.slice(2),action=args.shift();const root=path.join(os.homedir(),'.local/state/research-skill/jobs');
const control=new AbortController();process.once('SIGINT',()=>control.abort());process.once('SIGTERM',()=>control.abort());
try{
 let value;if(['status','result','cancel','pause','resume'].includes(action)){check(args.length===1,'USAGE');value=await ({status,result,cancel,pause,resume})[action]({root,jobId:args[0]});}
 else{check(['start','run','check'].includes(action)&&args.length===2,'USAGE');const [worker,executable]=args;
  if(action==='check')value=await checkEnvironment(worker,executable);
  else{const task=makeTask(JSON.parse(await readBounded(process.stdin,8192)));value=action==='start'?await start({root,task,worker,executable}):await runWorker({task,worker,executable,signal:control.signal});}
 }
 console.log(JSON.stringify(value));if(value.state==='FAILED')process.exitCode=1;
}catch(e){console.log(JSON.stringify({state:'FAILED',error:publicError(e)}));process.exitCode=1;}
