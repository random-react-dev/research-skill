import fs from 'node:fs/promises';
import path from 'node:path';
import {directory,read,write} from './jobs.mjs';
import {runWorker} from './launcher.mjs';
const [root,jobId]=process.argv.slice(2);let managed=false,release,dir,state,poll,heartbeat,writing=Promise.resolve(),checking=false,events=[],pauseRequested=false;
let audit=Promise.resolve(),reporter,logHome,logJob,logUpstream;
const diagnostic=async(event,payload)=>{if(logHome){const {recordEvent}=await import('./control.mjs');await recordEvent(logHome,event,payload,logJob);}};
const log=(event,fields={})=>{audit=audit.then(async()=>{let history=[];try{history=await read(dir,'lifecycle.json');}catch(e){if(e.code!=='ENOENT')throw e;}history.push({at:new Date().toISOString(),event,pid:process.pid,...fields});await write(dir,'lifecycle.json',history.slice(-256));await diagnostic(event,fields);});audit.catch(()=>{});};
const control=new AbortController();process.on('SIGTERM',()=>control.abort());process.on('SIGINT',()=>control.abort());
try{
 dir=await directory(root,jobId);state={...await read(dir,'state.json'),server_admitted:false};const request=await read(dir,'request.json');managed=!!request.managed;logHome=request.accessHome;logJob=request.task.task_id;log('RUNNER_STARTED',{managed});
 if(managed){const {claimRunner}=await import('./reconcile.mjs');release=await claimRunner(dir);if(!release)throw Error('RUNNER_BUSY');}
 poll=setInterval(async()=>{try{await fs.lstat(path.join(dir,'pause'));pauseRequested=true;if(managed)control.abort();}catch{};if(checking)return;checking=true;try{await fs.lstat(path.join(dir,'cancel'));control.abort();}catch(e){if(e.code!=='ENOENT')control.abort();}finally{checking=false;}},100);
 heartbeat=setInterval(()=>{writing=writing.then(()=>write(dir,'state.json',{...state,updated_at_ms:Date.now()}));writing.catch(()=>control.abort());},500);
 let run=runWorker,extra={};
 if(request.managed){
  const {runCoordinator}=await import('./coordinator.mjs');const {serviceAccess,mcpClient}=await import('./mcp-client.mjs');
  const access=request.access??await serviceAccess(request.accessHome);
  const {installationReporter}=await import('./installation.mjs');reporter=installationReporter({accessHome:request.accessHome,worker:request.worker,access,fixture:request.fixture});reporter.start();
  logUpstream=mcpClient({...access,managed:true,fixture:request.fixture,signal:AbortSignal.timeout(10000)});
  run=runCoordinator;extra={access,home:path.join(dir,'profile'),upstream:mcpClient({...access,managed:true,fixture:request.fixture,signal:control.signal})};
 }
 const output=await run({...request,...extra,signal:control.signal,pauseRequested:()=>pauseRequested,onEvent:event=>{
  if(event.event==='SERVER_ADMITTED')state={...state,server_admitted:true};
  if(event.event==='ENROLLMENT_PENDING'){state={...state,enrollment_pending:true,message:event.message};writing=writing.then(()=>write(dir,'state.json',state));}
  events.push({...event,observed_at_ms:Date.now()});log(event.event,event);if(event.event==='CLI_STARTED')log('NATIVE_WORKER_STARTED',{worker:request.worker});
  if(event.event==='CLI_STARTED'){state={...state,state:'RUNNING',cli_started:true};writing=writing.then(async()=>{await write(dir,'state.json',{...state,updated_at_ms:Date.now()});if(process.connected)process.send({ready:jobId});});}
 }});
 log('RUNNER_FINISHED',{state:output.state});clearInterval(poll);clearInterval(heartbeat);await writing;const completed_at_ms=Date.now();
 await write(dir,'result.json',{completed_at_ms,result:output,events});await write(dir,'state.json',{...state,state:output.state,enrollment_pending:false,message:undefined,updated_at_ms:completed_at_ms});
}catch(error){
 const code=/^[A-Za-z_]{1,80}$/.test(error.code??error.message??'')?(error.code??error.message):'JOB_SUPERVISOR_FAILED';
 if(dir)log('RUNNER_FAILED',{code});clearInterval(poll);clearInterval(heartbeat);control.abort();await writing.catch(()=>{});
 if(dir&&state&&(!managed||release)){const completed_at_ms=Date.now();await write(dir,'result.json',{completed_at_ms,result:{state:'FAILED',error:{code}},events}).catch(()=>{});await write(dir,'state.json',{...state,state:'FAILED',error:{code},updated_at_ms:completed_at_ms}).catch(()=>{});}
}finally{
 if(reporter)await reporter.stop();
 await audit.catch(()=>{});if(logUpstream){const {flushEvents}=await import('./control.mjs');await flushEvents(logHome,logUpstream).catch(()=>{});}const owned=Boolean(release);if(release)await release();clearInterval(poll);clearInterval(heartbeat);if(process.connected)process.disconnect();
 if(managed&&owned){let intent=false;for(const name of ['cancel','pause'])try{await fs.lstat(path.join(dir,name));intent=true;}catch{}
  if(intent){const {reconcileJob}=await import('./reconcile.mjs');await reconcileJob({root,jobId,force:true}).catch(()=>{});}
 }
}
