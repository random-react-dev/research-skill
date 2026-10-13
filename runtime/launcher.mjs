import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import http from 'node:http';
import crypto from 'node:crypto';
import {spawn} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import {check,canonical,MODEL,TOOL,MAX_REQUEST,readBounded,readCLIOutput,taskRequest,turnReply,evidenceReply,validateResult,validateTask,publicError,ResearchError,resumeSnapshot,evidenceReceipt,compareEvidenceReceipt} from './core.mjs';
import {serviceAccess,mcpClient} from './mcp-client.mjs';
import {nativeRequest,decodeTool,respond} from './native.mjs';

export function childEnvironment(home,executable){return {HOME:home,USERPROFILE:home,CODEX_HOME:path.join(home,'codex'),CLAUDE_CONFIG_DIR:path.join(home,'claude'),TMPDIR:path.join(home,'tmp'),TMP:path.join(home,'tmp'),TEMP:path.join(home,'tmp'),PATH:[path.dirname(executable),path.dirname(process.execPath),'/usr/bin','/bin'].join(path.delimiter),LANG:'C.UTF-8'};}
export function codexConfig(base,toolFile,evidence,profile={}){return `model = "${MODEL}"\nmodel_provider = "research"\napproval_policy = "never"\nsandbox_mode = "read-only"\nweb_search = "disabled"\ntool_output_token_limit = 32768\n[model_providers.research]\nname = "Research task transport"\nbase_url = ${JSON.stringify(base)}\nwire_api = "responses"\nrequires_openai_auth = false\nrequest_max_retries = 0\nstream_max_retries = 0\nstream_idle_timeout_ms = 60000\n[mcp_servers.research]\ncommand = ${JSON.stringify(process.execPath)}\nargs = ${JSON.stringify([toolFile,evidence])}\nstartup_timeout_sec = 10\ntool_timeout_sec = 200\nrequired = true\nenabled_tools = ["${TOOL}"]\n`;}
export async function checkEnvironment(worker,executable){
 check(process.platform==='darwin'&&Number(process.versions.node.split('.')[0])===26,'RUNTIME_UNQUALIFIED');
 check(['codex','claude-code'].includes(worker)&&path.isAbsolute(executable),'WORKER_INVALID');await fs.access(executable,fs.constants.X_OK);
 let home;try{home=await fs.mkdtemp(path.join(os.tmpdir(),'research-help-'));const child=spawn(executable,worker==='codex'?['exec','--help']:['--help'],{env:childEnvironment(home,executable),stdio:['ignore','pipe','pipe']});let text='',bytes=0;
  const timer=setTimeout(()=>child.kill('SIGKILL'),5000);for(const stream of [child.stdout,child.stderr])stream.on('data',b=>{bytes+=b.length;if(bytes>65536)child.kill('SIGKILL');else text+=b;});
  const code=await new Promise(r=>{child.once('error',()=>r(-1));child.once('close',r);});clearTimeout(timer);check(code===0&&bytes<=65536,'CLI_HELP_FAILED');
  const flags=worker==='codex'?['--sandbox','--ephemeral','--json','--output-last-message','--skip-git-repo-check','--cd']:['--print','--bare','--tools','--strict-mcp-config','--setting-sources','--no-session-persistence'];check(flags.every(f=>text.includes(f)),'CLI_FLAGS_MISSING');return {node:process.version,worker,flags:'PRESENT',real_execution:'NOT_RUN'};
 }finally{if(home)await fs.rm(home,{recursive:true,force:true});}
}
export async function runWorker({task,worker,executable,signal,onEvent=()=>{},timeoutMs=(task.profile.execution_seconds+60)*1000,resume=false,pauseRequested=()=>false,access,accessHome=os.homedir(),fixture=false}){
 let home,relay,child,closed,killTimer,deadline,upstream,startedTurn=false,result,fault,evidence,evidencePromise,pending,previous=null,turn=0,requests=0,credential,nativeFinal,childOutput=[];
 const control=new AbortController();const abort=()=>control.abort(new ResearchError('CANCEL_REQUESTED'));
 const emit=(event,fields={})=>onEvent({event,...fields});const live=new WeakSet();
 const kill=signal=>{if(!child?.pid||!live.has(child))return;try{process.kill(-child.pid,signal);}catch{child.kill(signal);}};
 try{
  task=structuredClone(validateTask(task));check(Number.isInteger(timeoutMs)&&timeoutMs>=100&&timeoutMs<=2147483647,'DEADLINE_INVALID');
  if(signal?.aborted)throw new ResearchError('CANCEL_REQUESTED');signal?.addEventListener('abort',abort,{once:true});
  deadline=setTimeout(()=>control.abort(new ResearchError('TASK_DEADLINE')),timeoutMs);
  if(!fixture)await checkEnvironment(worker,executable);else{check(path.isAbsolute(executable),'WORKER_INVALID');await fs.access(executable,fs.constants.X_OK);}if(control.signal.aborted)throw control.signal.reason;
  credential=access??await serviceAccess(accessHome,{signal:control.signal});upstream=mcpClient({...credential,fixture,signal:control.signal,onEvent:e=>emit(e.event,e)});
  let replayPending=false;
  if(resume){let state;try{state=resumeSnapshot(await upstream(taskRequest(task,'resume')),task);}catch{throw new ResearchError('RESUME_UNCONFIRMED');}({turn,previous,pending,evidence}=state);replayPending=!!pending;startedTurn=true;}
  home=await fs.mkdtemp(path.join(os.tmpdir(),'research-task-'));await fs.chmod(home,0o700);for(const n of ['codex','claude','tmp','work'])await fs.mkdir(path.join(home,n),{mode:0o700});
  const capability=crypto.randomBytes(24).toString('hex'),cache=new Map();let busy=false;
  relay=http.createServer(async(req,res)=>{
   const disconnected=()=>{if(!res.writableFinished)control.abort(new ResearchError('CLI_CONNECTION_LOST'));};
   req.once('aborted',disconnected);res.once('close',disconnected);
   try{
    check(req.headers.host===`127.0.0.1:${relay.address().port}`&&!req.headers.origin,'LOCAL_HOST_DENIED');
    const route=req.url?.replace(/\?beta=true$/,'');check(req.method==='POST'&&[`/${capability}/evidence`,`/${capability}/v1/${worker==='codex'?'responses':'messages'}`].includes(route),'LOCAL_ROUTE_DENIED');
    check(++requests<=task.profile.model_requests*8+16,'LOCAL_REQUEST_LIMIT');const body=JSON.parse(await readBounded(req,Math.max(131072,task.profile.prompt_bytes*4)));
    if(pauseRequested()&&!busy&&startedTurn){try{const receipt=await upstream(taskRequest(task,'pause'));check(receipt.state==='PAUSED','PAUSE_UNCONFIRMED');}catch{throw new ResearchError('PAUSE_UNCONFIRMED');}throw new ResearchError('TASK_PAUSED');}
    if(route.endsWith('/evidence')){
     check(pending&&canonical(body)===canonical(JSON.parse(pending.arguments)),'LOCAL_TOOL_DENIED');
     evidencePromise??=evidence?Promise.resolve(evidence):upstream(taskRequest(task,'read-evidence',{call_id:pending.call_id})).then(v=>evidenceReply(v,task,pending));
     evidence=await evidencePromise;
     emit('CLI_EVIDENCE_EXECUTED',{turn});res.writeHead(200,{'content-type':'application/json'});res.end(JSON.stringify(evidenceReceipt(evidence,task,pending)));return;
    }
    if(worker==='claude-code')check(req.headers['x-api-key']===capability,'LOCAL_AUTH_DENIED');
    const native=nativeRequest(body,worker),key=crypto.createHash('sha256').update(canonical(body)).digest('hex');
    if(cache.has(key)){respond(res,cache.get(key),worker,native,body.stream);return;}
    check(!busy&&turn<task.profile.model_requests&&!result,'CONTINUATION_LIMIT');busy=true;
    try{
     if(replayPending){check(native.outputs.length===0,'UNEXPECTED_TOOL_OUTPUT');replayPending=false;const response={id:previous,output:[pending]};cache.set(key,response);respond(res,response,worker,native,body.stream);return;}
     const matching=native.outputs.filter(o=>o.call_id===pending?.call_id);let tool_outputs=[];
     if(pending){check(matching.length===1&&evidence,'TOOL_CONTINUATION_MISSING');if(fixture)emit('FIXTURE_TOOL_OUTPUT',{output:matching[0].output});const decoded=decodeTool(matching[0].output);compareEvidenceReceipt(decoded,evidence,task,pending);tool_outputs=[{call_id:pending.call_id,output:{evidence_ref:pending.call_id}}];}
     else check(native.outputs.length===0,'UNEXPECTED_TOOL_OUTPUT');
     startedTurn=true;emit('CLI_INFERENCE_REQUEST',{turn});
     const value=turnReply(await upstream(taskRequest(task,'turn',{turn,previous_response_id:previous,tool_outputs})),task);
     previous=value.response.id;turn++;const item=value.response.output[0];
     if(item.type==='function_call'){check(turn<task.profile.model_requests,'TOOL_TURN_LIMIT');pending=item;evidence=null;evidencePromise=null;}
     else{result=validateResult(JSON.parse(item.content[0].text),task);pending=null;nativeFinal=item.content[0].text;}
     cache.set(key,value.response);respond(res,value.response,worker,native,body.stream);
    }finally{busy=false;}
   }catch(e){fault??=e instanceof ResearchError?e:new ResearchError('NATIVE_PROTOCOL_FAILED');if(!res.headersSent)res.writeHead(502,{'content-type':'application/json'});if(!res.destroyed)res.end(JSON.stringify({error:{code:fault.code}}));control.abort(fault);}
   finally{req.removeListener('aborted',disconnected);res.removeListener('close',disconnected);}
  });
  relay.requestTimeout=200000;relay.headersTimeout=10000;await new Promise((r,j)=>{relay.once('error',j);relay.listen(0,'127.0.0.1',r);});
  const base=`http://127.0.0.1:${relay.address().port}/${capability}/v1`,localEvidence=base.replace(/\/v1$/,'/evidence'),toolFile=fileURLToPath(new URL('./evidence-mcp.mjs',import.meta.url));
  await fs.writeFile(path.join(home,'codex/config.toml'),codexConfig(base,toolFile,localEvidence,task.profile),{mode:0o600});
  const mcpFile=path.join(home,'mcp.json'),output=path.join(home,'result.json');await fs.writeFile(mcpFile,JSON.stringify({mcpServers:{research:{command:process.execPath,args:[toolFile,localEvidence]}}}),{mode:0o600});
  const args=worker==='codex'?['exec','--sandbox','read-only','--ephemeral','--skip-git-repo-check','--json','--output-last-message',output,'--cd',path.join(home,'work'),'-']:
   ['--print','--bare','--output-format','json','--model',MODEL,'--max-turns',String(task.profile.model_requests+1),'--tools','','--allowedTools','mcp__research__'+TOOL,'--permission-mode','dontAsk','--setting-sources','','--settings','{"disableAllHooks":true,"disableClaudeAiConnectors":true}','--strict-mcp-config','--mcp-config',mcpFile,'--disable-slash-commands','--no-chrome','--no-session-persistence'];
  const env={...childEnvironment(home,executable),...(worker==='claude-code'?{ANTHROPIC_API_KEY:capability,ANTHROPIC_BASE_URL:base.replace(/\/v1$/,''),ANTHROPIC_MODEL:MODEL,ANTHROPIC_DEFAULT_HAIKU_MODEL:MODEL,ANTHROPIC_DEFAULT_SONNET_MODEL:MODEL,ANTHROPIC_DEFAULT_OPUS_MODEL:MODEL,CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC:'1',DISABLE_TELEMETRY:'1',DISABLE_ERROR_REPORTING:'1',DISABLE_AUTOUPDATER:'1',ENABLE_TOOL_SEARCH:'false',API_TIMEOUT_MS:'200000',CLAUDE_CODE_MAX_OUTPUT_TOKENS:String(task.profile.output_tokens??3072),MAX_THINKING_TOKENS:'0'}:{})};
  check(!control.signal.aborted,'CANCEL_REQUESTED');child=spawn(executable,args,{cwd:path.join(home,'work'),env,detached:true,stdio:['pipe','pipe','pipe']});live.add(child);
  closed=new Promise(r=>{child.once('error',()=>r({code:-1}));child.once('close',code=>{live.delete(child);r({code});});});
  await new Promise((resolve,reject)=>{child.once('spawn',resolve);child.once('error',()=>reject(new ResearchError('CLI_START_FAILED')));});
  let outputBytes=0;for(const stream of [child.stdout,child.stderr])stream.on('data',b=>{outputBytes+=b.length;if(outputBytes>Math.max(1048576,task.profile.report_bytes*4))control.abort(new ResearchError('CLI_OUTPUT_LIMIT'));else if(worker==='claude-code'&&stream===child.stdout)childOutput.push(b);});
  const stop=()=>{kill('SIGTERM');killTimer=setTimeout(()=>kill('SIGKILL'),1000);};control.signal.addEventListener('abort',stop,{once:true});
  child.stdin.on('error',()=>control.abort(new ResearchError('CLI_STDIN_FAILED')));
  emit('CLI_STARTED');child.stdin.end(JSON.stringify(task));const finished=await closed;
  if(control.signal.aborted)throw control.signal.reason;check(finished.code===0,'CLI_EXIT_FAILED');check(result&&nativeFinal,'SERVER_INFERENCE_NOT_USED');
  let text;if(worker==='codex')text=await readCLIOutput(output,task.profile.report_bytes);else{const outer=JSON.parse(Buffer.concat(childOutput).toString());check(outer.type==='result'&&outer.subtype==='success'&&outer.is_error===false,'CLAUDE_RESULT_INVALID');text=outer.result;}
  check(canonical(JSON.parse(text))===canonical(result),'CLI_RESULT_CHANGED');
  emit('CLI_COMPLETED',{turns:turn});return {state:result.state,task_id:task.task_id,worker,result,compatibility:'LOCAL_FIXTURE_ONLY_UNLESS_SEPARATELY_QUALIFIED',native_transport_usage:'UNAVAILABLE_NOT_PROVIDER_BILLING'};
 }catch(e){
  if(['PAUSE_UNCONFIRMED','RESUME_UNCONFIRMED'].includes((control.signal.reason??e)?.code))return {state:'INTERRUPTED_UNKNOWN',task_id:task.task_id,worker,error:publicError(control.signal.reason??e),provider_billing_known:false};
  if((control.signal.reason??e)?.code==='TASK_PAUSED')return {state:'PAUSED',task_id:task.task_id,worker,provider_billing_known:false};
  let cancellation,reconciled=result,reconciliation;
  if(startedTurn&&upstream&&!reconciled){
   const cleanupSignal=AbortSignal.timeout(10000);let cleanup;
   try{const cred=credential;check(cred,'SERVICE_ACCESS_UNAVAILABLE');cleanup=mcpClient({...cred,fixture,signal:cleanupSignal});}catch{reconciliation={state:'UNKNOWN'};}
   if(cleanup){
    try{cancellation=await cleanup(taskRequest(task,'cancel'));}catch{cancellation={state:'UNKNOWN'};}
    try{reconciled=validateResult(await cleanup(taskRequest(task,'result')),task);reconciliation={state:'READ_CONFIRMED'};}catch{reconciliation={state:'UNKNOWN'};}
   }
  }
  return {state:control.signal.reason?.code==='CANCEL_REQUESTED'?'CANCELLED_LOCAL':'FAILED',task_id:task?.task_id,worker,error:publicError(control.signal.aborted?control.signal.reason:e),...(reconciled?{result:reconciled}:{}),...(cancellation?{server_cancellation:cancellation}:{}),...(reconciliation?{server_reconciliation:reconciliation}:{}),provider_billing_known:false};
 }finally{
  clearTimeout(deadline);signal?.removeEventListener('abort',abort);kill('SIGKILL');if(closed)await closed;clearTimeout(killTimer);
  if(relay){relay.closeAllConnections();await new Promise(r=>relay.close(r));}if(home)await fs.rm(home,{recursive:true,force:true});
 }
}
