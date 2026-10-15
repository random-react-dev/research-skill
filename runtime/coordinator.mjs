import fs from 'node:fs/promises';
import path from 'node:path';
import http from 'node:http';
import crypto from 'node:crypto';
import {spawn,execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {fileURLToPath} from 'node:url';
import {check,MODEL,canonical,readBounded,readPrivate,validateTask} from './core.mjs';
import {childEnvironment} from './launcher.mjs';
import {write,read} from './jobs.mjs';
import {mcpClient} from './mcp-client.mjs';
import {respondNative} from './native.mjs';

export function coordinatorLaunch({worker,executable,home,base,capability,mcpFile,session,newSession}){
 const env=childEnvironment(home,executable);
 if(worker==='codex')return {env,args:['exec',...(session?['resume',session,'-c','sandbox_mode="danger-full-access"','-c','approval_policy="never"']:['--sandbox','danger-full-access']),'--skip-git-repo-check','--json','-']};
 check(worker==='claude-code','WORKER_INVALID');
 Object.assign(env,{ANTHROPIC_API_KEY:capability,ANTHROPIC_BASE_URL:base.replace(/\/v1$/,''),ANTHROPIC_MODEL:MODEL,ANTHROPIC_DEFAULT_HAIKU_MODEL:MODEL,ANTHROPIC_DEFAULT_SONNET_MODEL:MODEL,ANTHROPIC_DEFAULT_OPUS_MODEL:MODEL,CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC:'1',DISABLE_AUTOUPDATER:'1',DISABLE_TELEMETRY:'1',DISABLE_ERROR_REPORTING:'1',ENABLE_TOOL_SEARCH:'false',MAX_THINKING_TOKENS:'0'});
 return {env,args:['--print','--bare','--output-format','json','--model',MODEL,'--permission-mode','bypassPermissions','--setting-sources','','--settings','{"disableAllHooks":true,"disableClaudeAiConnectors":true}','--strict-mcp-config','--mcp-config',mcpFile,'--disable-slash-commands','--no-chrome',...(session?['--resume',session]:newSession?['--session-id',newSession]:[])]};
}

export async function runCoordinator({task,worker,executable,home,upstream,signal,onEvent=()=>{},pauseRequested=()=>false,accessHome,userHome,transport,access,fixture=false}){
 check(process.platform==='darwin','RUNTIME_UNQUALIFIED');
 validateTask(task);check(path.isAbsolute(home)&&path.isAbsolute(executable),'WORKER_INVALID');
 await fs.mkdir(home,{recursive:true,mode:0o700});
 const stat=await fs.lstat(home);check(!stat.isSymbolicLink()&&stat.uid===process.getuid()&&!(stat.mode&0o077),'PROFILE_UNSAFE');
 for(const name of ['codex','claude','tmp','work'])await fs.mkdir(path.join(home,name),{recursive:true,mode:0o700});
 let session,checkpoint={task_id:task.task_id,worker,pending_calls:[]};let saving=Promise.resolve();
 const save=()=>{const snapshot=structuredClone(checkpoint);saving=saving.then(()=>write(home,'session.json',snapshot));return saving;};
 try{const saved=await read(home,'session.json',16384);check(saved.task_id===task.task_id&&saved.worker===worker,'SESSION_TASK_MISMATCH');check(!saved.pending_calls?.length,'LOCAL_ACTION_OUTCOME_UNKNOWN');check(!await workerStillRunning(saved),'LOCAL_WORKER_STILL_RUNNING');checkpoint=saved;session=saved.session;}catch(e){if(e.code!=='ENOENT')throw e;}
 // Durable admission happens before a CLI can spend or execute model-directed work.
 const direct=transport==='direct-mcp-v1';
 check(!transport||direct,'TRANSPORT_UNSUPPORTED');
 if(direct){check(access?.endpoint&&access?.token,'MCP_ACCESS_MISSING');if(access.resolveAccess)access=await access.resolveAccess(signal);await mcpClient({...access,fixture,signal,managed:true,requiredTool:'research_task'}).discover();onEvent({event:'MCP_DISCOVERED',transport});}
 const rawUpstream=upstream,coordinator_id=crypto.randomUUID();
 const admission=await rawUpstream({task,operation:'admit'});
 upstream=q=>rawUpstream({...q,coordinator_id});
 await upstream({task,operation:'acquire',...(direct?{transport}:{})});
 const capability=crypto.randomBytes(24).toString('hex');let child,exit,submitted,stopping=false,requests=0,busy=false;
 submitted=admission.submitted?admission:undefined;
 const relay=http.createServer(async(req,res)=>{
  try{
   check(req.headers.host===`127.0.0.1:${relay.address().port}`&&!req.headers.origin,'LOCAL_HOST_DENIED');
   const route=req.url?.replace(/\?beta=true$/,'');
   check(req.method==='POST'&&[...(!direct?[`/${capability}/job`]:[]),`/${capability}/v1/${worker==='codex'?'responses':'messages'}`].includes(route),'LOCAL_ROUTE_DENIED');
   check(++requests<=task.profile.model_requests*8+32,'LOCAL_REQUEST_LIMIT');
   const body=JSON.parse(await readBounded(req,262144));
   if(route.endsWith('/job')){
    check(['submit','status','result','pause','resume','cancel','ack','verification-start','support-complete'].includes(body.operation)&&Object.keys(body).every(k=>['operation','event_id','receipt'].includes(k)),'JOB_OPERATION_DENIED');
    check(!pauseRequested()&&!signal?.aborted,'COORDINATOR_STOPPED');
    const reply=await upstream({task,...body});
    res.writeHead(200,{'content-type':'application/json'});res.end(JSON.stringify(reply));
    if(body.operation==='support-complete'&&reply.support_complete)submitted=reply;
    if(body.operation==='submit'&&reply.submitted){submitted=reply;}
    return;
   }
   if(worker==='claude-code')check(req.headers['x-api-key']===capability,'LOCAL_AUTH_DENIED');
   check(body.model===MODEL&&typeof body.stream==='boolean'&&!busy,'NATIVE_REQUEST_INVALID');
   busy=true;
   try{
    check(!pauseRequested()&&!signal?.aborted,'COORDINATOR_STOPPED');
    if(direct){check(hasResearchTask(body.tools),'MCP_TOOL_MISSING');const remote=await upstream({task,operation:'status'});if(remote.submitted||remote.support_complete)submitted=remote;}
    checkpoint.pending_calls=(checkpoint.pending_calls??[]).filter(id=>!hasToolResult(body,id));await save();
    const request_id=crypto.createHash('sha256').update(canonical({worker,body})).digest('hex');
    const reply=(submitted?.support_complete||(direct&&submitted?.submitted&&!checkpoint.pending_calls?.length))?{worker,response:worker==='codex'?{model:MODEL,id:'support_complete',object:'response',status:'completed',output:[{id:'support_final',status:'completed',type:'message',role:'assistant',content:[{type:'output_text',text:submitted?.support_complete?'Support result recorded.':'Research submitted. The server continues independently; retrieve the saved job for results.',annotations:[]}]}],usage:{input_tokens:0,output_tokens:0}}:{model:MODEL,id:'support_complete',type:'message',role:'assistant',content:[{type:'text',text:submitted?.support_complete?'Support result recorded.':'Research submitted. The server continues independently; retrieve the saved job for results.'}],stop_reason:'end_turn',usage:{input_tokens:0,output_tokens:0}}}:await upstream({task,operation:'native-turn',worker,body,request_id});
    check(reply.worker===worker,'NATIVE_RESPONSE_INVALID');
    const items=reply.response.output??reply.response.content??[];
    checkpoint.pending_calls=[...new Set([...(checkpoint.pending_calls??[]),...items.filter(i=>['function_call','custom_tool_call','tool_use'].includes(i.type)).map(i=>i.call_id??i.id)])];await save();
    if(!res.destroyed)respondNative(res,reply.response,worker,body.stream);
   }finally{busy=false;}
  }catch(e){onEvent({event:'RELAY_FAILED',code:e.code??'COORDINATOR_REQUEST_FAILED'});if(!req.url?.endsWith('/job'))stop();if(!res.headersSent)res.writeHead(502,{'content-type':'application/json'});if(!res.destroyed)res.end('{"error":{"code":"COORDINATOR_REQUEST_FAILED"}}');}
 });
 const stop=()=>{if(stopping||!child?.pid||child.exitCode!==null||child.signalCode!==null)return;stopping=true;try{process.kill(-child.pid,'SIGTERM');}catch{}forceTimer=setTimeout(()=>{try{process.kill(-child.pid,'SIGKILL');}catch{}},1000);};
 let timer,forceTimer;
 try{
  await new Promise((r,j)=>{relay.once('error',j);relay.listen(0,'127.0.0.1',r);});
  const base=`http://127.0.0.1:${relay.address().port}/${capability}/v1`;
  const mcpFile=path.join(home,'mcp.json');
  let mcpConfig,serverConfig;
  if(direct){({mcpConfig,serverConfig}=directMcpConfig(access,task.task_id,coordinator_id));}
  else{
   const toolArgs=[fileURLToPath(new URL('./job-mcp.mjs',import.meta.url)),base.replace(/\/v1$/,'/job')];
   mcpConfig={mcpServers:{research:{command:process.execPath,args:toolArgs}}};
   serverConfig=`command = ${JSON.stringify(process.execPath)}\nargs = ${JSON.stringify(toolArgs)}\n`;
  }
  await fs.writeFile(mcpFile,JSON.stringify(mcpConfig),{mode:0o600});
  const config=`model = "${MODEL}"\nmodel_provider = "research"\napproval_policy = "never"\nsandbox_mode = "danger-full-access"\nweb_search = "disabled"\n[model_providers.research]\nname = "Research"\nbase_url = ${JSON.stringify(base)}\nwire_api = "responses"\nrequires_openai_auth = false\nrequest_max_retries = 0\nstream_max_retries = 0\n[mcp_servers.research]\n${serverConfig}required = true\nstartup_timeout_sec = 30\ntool_timeout_sec = 200\n`;
  await fs.writeFile(path.join(home,'codex/config.toml'),config,{mode:0o600});
  check(!signal?.aborted,'COORDINATOR_STOPPED');
  const newSession=worker==='claude-code'&&!session?crypto.randomUUID():undefined;
  if(newSession){session=newSession;checkpoint.session=session;}checkpoint.clean_exit=false;await save();
  const launch=coordinatorLaunch({worker,executable,home,base,capability,mcpFile,session:newSession?undefined:session,newSession});
  if(direct)launch.env.RESEARCH_GATEWAY_TOKEN=access.token;
  child=spawn(executable,launch.args,{env:launch.env,cwd:path.join(home,'work'),detached:true,stdio:['pipe','pipe','pipe']});
  let stdout='',stderr='',lineBuffer='',size=0;
  const consume=line=>{try{const v=JSON.parse(line);if(worker==='codex'&&v.type==='thread.started'&&typeof v.thread_id==='string'){session=v.thread_id;checkpoint.session=session;save();}}catch{}};
  exit=new Promise(r=>{child.once('error',()=>r(-1));child.once('close',r);});
  for(const stream of [child.stdout,child.stderr])stream.on('data',b=>{size+=b.length;if(size>1048576)stop();else if(stream===child.stdout){stdout+=b;lineBuffer+=b;const lines=lineBuffer.split('\n');lineBuffer=lines.pop();for(const line of lines)consume(line);}else stderr=(stderr+b.toString()).slice(-8000);});
  checkpoint.worker_pid=child.pid;checkpoint.worker_started=await processIdentity(child.pid);await save();
  signal?.addEventListener('abort',stop,{once:true});
  timer=setTimeout(stop,Math.min(300000,task.profile.execution_seconds*1000));
  onEvent({event:'CLI_STARTED'});child.stdin.on('error',()=>{});child.stdin.end(JSON.stringify({task,runtime:{node:process.execPath,cli:fileURLToPath(new URL('../scripts/run-research.mjs',import.meta.url)),jobs_root:path.dirname(path.dirname(home)),job_id:path.basename(path.dirname(home)),user_home:userHome??accessHome??home}}));
  const exitCode=await exit;
  if(direct&&!signal?.aborted){try{const remote=await upstream({task,operation:'status'});if(remote.submitted||remote.support_complete)submitted=remote;}catch(e){onEvent({event:'STATUS_UNCONFIRMED',code:e.code??'MCP_CONNECTION_FAILED'});}}
  onEvent({event:'CLI_EXIT',exit_code:exitCode,output:stdout.slice(-8000),stderr});
  for(const line of stdout.trim().split('\n')){try{const v=JSON.parse(line);const id=worker==='codex'&&v.type==='thread.started'?v.thread_id:worker==='claude-code'?v.session_id:null;if(typeof id==='string'&&/^[a-f0-9-]{36}$/.test(id))session=id;}catch{}}
  if(submitted&&newSession)session=newSession;
  checkpoint.worker_pid=null;checkpoint.worker_started=null;if(session)checkpoint.session=session;checkpoint.clean_exit=exitCode===0&&!checkpoint.pending_calls?.length&&!signal?.aborted;await save();
  if(checkpoint.clean_exit)await upstream({task,operation:'release'});
  return {state:checkpoint.clean_exit&&submitted?(submitted.support_complete?'PARTIAL':'WAITING_SERVER'):'INTERRUPTED_UNKNOWN',task_id:task.task_id,worker,...(submitted?{server:submitted}:{error:{code:'COORDINATOR_HANDOFF_UNCONFIRMED'}})};
 }finally{
  await saving.catch(()=>{});clearTimeout(timer);signal?.removeEventListener('abort',stop);stop();
  if(exit)await exit;clearTimeout(forceTimer);
  if(direct)await fs.rm(path.join(home,'mcp.json'),{force:true});
  relay.closeAllConnections();await new Promise(r=>relay.close(r));
 }
}

function hasToolResult(value,id){if(!value||typeof value!=='object')return false;if(['function_call_output','custom_tool_call_output','tool_result'].includes(value.type)&&(value.call_id===id||value.tool_use_id===id))return true;return Object.values(value).some(v=>Array.isArray(v)?v.some(x=>hasToolResult(x,id)):hasToolResult(v,id));}

export async function processIdentity(pid){if(!Number.isSafeInteger(pid)||pid<1)return null;try{return (await promisify(execFile)('/bin/ps',['-p',String(pid),'-o','lstart='],{timeout:3000,maxBuffer:1024})).stdout.trim()||null;}catch(e){if(e.code===1)return null;throw Error('PROCESS_IDENTITY_UNAVAILABLE');}}
export async function workerStillRunning(saved){if(!saved.worker_pid)return false;const identity=await processIdentity(saved.worker_pid);return Boolean(identity&&(!saved.worker_started||identity===saved.worker_started));}

export function hasResearchTask(tools){return Array.isArray(tools)&&tools.some(t=>t.name==='research_task'||t.name?.endsWith('__research_task')||hasResearchTask(t.tools));}
export function directMcpConfig(access,taskId,coordinatorId){
 const headers={'X-Research-Task':taskId,'X-Research-Coordinator':coordinatorId};
 return {mcpConfig:{mcpServers:{research:{type:'http',url:access.endpoint,headers:{...headers,Authorization:'Bearer '+access.token}}}},
  serverConfig:`url = ${JSON.stringify(access.endpoint)}\nbearer_token_env_var = "RESEARCH_GATEWAY_TOKEN"\nenabled_tools = ["research_task"]\nhttp_headers = { "X-Research-Task" = ${JSON.stringify(taskId)}, "X-Research-Coordinator" = ${JSON.stringify(coordinatorId)} }\n`};
}
