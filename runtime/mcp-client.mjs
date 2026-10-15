import fs from 'node:fs/promises';
import path from 'node:path';
import crypto from 'node:crypto';
import {check,ENDPOINT,MAX_REQUEST,readBounded,readPrivate,ResearchError,keys} from './core.mjs';
export async function developmentAccess(home){
 // Explicit existing research mechanism only. No agent auth stores or enrollment.
 const file=path.join(home,'.config/research-gateway/cloud.token');
 let token;try{token=(await readPrivate(file,512)).trim();}catch{throw new ResearchError('DEV_ACCESS_UNAVAILABLE');}
 check(/^[A-Za-z0-9_-]{32,256}$/.test(token),'DEV_ACCESS_UNAVAILABLE');return {endpoint:ENDPOINT,token};
}
// The capability is published as a complete nonempty directory by atomic rename.
// A racing creator cannot replace the winner's nonempty directory or refresh identity.
async function accessDirectory(dir,privateMode=false){const st=await fs.lstat(dir);check(st.isDirectory()&&!st.isSymbolicLink()&&st.uid===process.getuid()&&!(st.mode&(privateMode?0o077:0o022))&&await fs.realpath(dir)===dir,'ACCESS_DIRECTORY_UNSAFE');}
async function syncDirectory(dir){const h=await fs.open(dir,'r');try{await h.sync();}finally{await h.close();}}
async function installCapability(home,expectedToken){
 if(expectedToken!==undefined){check(path.isAbsolute(home)&&path.resolve(home)===home,'ACCESS_DIRECTORY_UNSAFE');let dir=home;await accessDirectory(dir);for(const name of ['.config','research-gateway','public-install']){dir=path.join(dir,name);await accessDirectory(dir,name==='public-install');}const token=(await readPrivate(path.join(dir,'capability'),128)).trim();check(token===expectedToken,'INSTALL_ACCESS_CHANGED');return {token,dir};}

 check(path.isAbsolute(home)&&path.resolve(home)===home,'ACCESS_DIRECTORY_UNSAFE');await accessDirectory(home);
 let parent=home;for(const name of ['.config','research-gateway']){parent=path.join(parent,name);try{await fs.mkdir(parent,{mode:0o700});}catch(e){if(e.code!=='EEXIST')throw e;}await accessDirectory(parent);}
 const dir=path.join(parent,'public-install'),file=path.join(dir,'capability');
 try{await fs.lstat(dir);}catch(e){if(e.code!=='ENOENT')throw e;const temp=await fs.mkdtemp(path.join(parent,'.install-'));try{
  await fs.chmod(temp,0o700);const h=await fs.open(path.join(temp,'capability'),'wx',0o600);try{await h.writeFile(crypto.randomBytes(32).toString('base64url'));await h.sync();}finally{await h.close();}
  await syncDirectory(temp);try{await fs.rename(temp,dir);}catch(e){if(!['EEXIST','ENOTEMPTY'].includes(e.code))throw e;}
 }finally{await fs.rm(temp,{recursive:true,force:true});}}
 await syncDirectory(parent);await accessDirectory(dir,true);const token=(await readPrivate(file,128)).trim();check(/^[A-Za-z0-9_-]{43}$/.test(token),'INSTALL_ACCESS_INVALID');return {token,dir};
}
function validGrant(grant){return typeof grant.owner==='string'&&grant.owner.length>0&&grant.owner.length<=128&&Number.isFinite(grant.expires_at)&&grant.expires_at>0&&grant.scope==='public-worker';}
export async function serviceAccess(home,options={}){return resolveServiceAccess(home,options);}
function publicAccess(home,endpoint,token,owner,fixture){return {endpoint,token,resolveAccess:signal=>resolveServiceAccess(home,{endpoint,fixture,signal,expectedToken:token,expectedOwner:owner})};}
async function resolveServiceAccess(home,{endpoint=ENDPOINT,fixture=false,signal,expectedToken,expectedOwner}={}){
 const u=new URL(endpoint);check(endpoint===ENDPOINT||(fixture&&u.protocol==='http:'&&u.hostname==='127.0.0.1'&&u.pathname==='/mcp'&&!u.search&&!u.hash&&!u.username&&!u.password),'ENDPOINT_DENIED');
 const legacy=path.join(home,'.config/research-gateway/cloud.token');let missing=false;try{await fs.lstat(legacy);}catch(e){if(e.code!=='ENOENT')throw new ResearchError('DEV_ACCESS_UNAVAILABLE');missing=true;}
 if(!missing){const access=await developmentAccess(home);check(expectedToken===undefined||access.token===expectedToken,'INSTALL_ACCESS_CHANGED');return {...access,endpoint};}
 const {token,dir}=await installCapability(home,expectedToken),receiptFile=path.join(dir,'grant.json'),tokenHash=crypto.createHash('sha256').update(token).digest('hex');
 let saved;try{saved=JSON.parse(await readPrivate(receiptFile,4096));}catch(e){if(e.code!=='ENOENT')throw new ResearchError('INSTALL_ACCESS_INVALID');}
 if(saved){check(keys(saved,['endpoint','token_sha256','owner','expires_at','scope'])&&saved.endpoint===endpoint&&saved.token_sha256===tokenHash&&validGrant(saved)&&(!expectedOwner||saved.owner===expectedOwner),'INSTALL_ACCESS_INVALID');if(saved.expires_at>Date.now()/1000)return publicAccess(home,endpoint,token,saved.owner,fixture);}
 let response;
 try{response=await fetch(new URL('/bootstrap',u),{method:'POST',redirect:'error',headers:{'content-type':'application/json','accept':'application/json'},body:JSON.stringify({token}),signal:signal?AbortSignal.any([signal,AbortSignal.timeout(15000)]):AbortSignal.timeout(15000)});}catch{throw new ResearchError('SERVICE_ACCESS_UNAVAILABLE');}
 if(!response.ok){let code;try{code=JSON.parse(await readBounded(response.body,4096)).error_code;}catch{}throw new ResearchError(code==='public_access_disabled'?'SERVICE_NOT_ACTIVATED':['public_access_unavailable','bootstrap_request_denied'].includes(code)||response.status===403?'SERVICE_ACCESS_DENIED':'SERVICE_ACCESS_UNAVAILABLE');}
 let grant;try{grant=JSON.parse(await readBounded(response.body,4096));}catch{throw new ResearchError('SERVICE_ACCESS_REPLY_INVALID');}
 check(keys(grant,['owner','expires_at','scope'])&&validGrant(grant)&&grant.expires_at>Date.now()/1000&&(!saved||saved.owner===grant.owner)&&(!expectedOwner||expectedOwner===grant.owner),'SERVICE_ACCESS_REPLY_INVALID');
 const temp=path.join(dir,'.grant-'+crypto.randomUUID());try{const h=await fs.open(temp,'wx',0o600);try{await h.writeFile(JSON.stringify({endpoint,token_sha256:tokenHash,...grant}));await h.sync();}finally{await h.close();}await fs.rename(temp,receiptFile);await syncDirectory(dir);}finally{await fs.rm(temp,{force:true});}
 return publicAccess(home,endpoint,token,grant.owner,fixture);
}
export function mcpClient({endpoint,token,resolveAccess,signal,fixture=false,onEvent=()=>{},managed=false,requiredTool}){
 const u=new URL(endpoint);check(endpoint===ENDPOINT||(fixture&&u.protocol==='http:'&&u.hostname==='127.0.0.1'&&u.pathname==='/mcp'),'ENDPOINT_DENIED');
 const tool=managed?'research_managed_request':'research_worker_request',limit=managed?270336:MAX_REQUEST;
 let id=0,session,version,initialized;
 async function rpc(method,params,notify=false){
  const body={jsonrpc:'2.0',...(!notify?{id:++id}:{}),method,...(params?{params}:{})},wire=JSON.stringify(body);check(Buffer.byteLength(wire)<=limit+1024,'REQUEST_LIMIT');
  if(resolveAccess!==undefined){check(typeof resolveAccess==='function','ACCESS_RESOLVER_INVALID');const current=await resolveAccess(signal);check(current.endpoint===endpoint&&current.token===token,'INSTALL_ACCESS_CHANGED');}
  const headers={'content-type':'application/json','accept':'application/json, text/event-stream','authorization':'Bearer '+token,...(session?{'mcp-session-id':session}:{}),...(version?{'mcp-protocol-version':version}:{})};
  const response=await fetch(endpoint,{method:'POST',redirect:'error',headers,body:wire,signal:AbortSignal.any([signal,AbortSignal.timeout(method==='tools/call'?200000:15000)])});
  check(response.ok,'MCP_HTTP_DENIED');if(notify){check(response.status===202,'MCP_NOTIFICATION_INVALID');await response.body?.cancel();return;}
  session=response.headers.get('mcp-session-id')??session;
  const text=await readBounded(response.body);let value;
  if(response.headers.get('content-type')?.startsWith('text/event-stream')){
   const messages=text.split(/\r?\n\r?\n/).map(event=>event.split(/\r?\n/).filter(l=>l.startsWith('data:')).map(l=>l.slice(5).trimStart()).join('\n')).filter(Boolean).map(s=>JSON.parse(s));
   value=messages.find(v=>v.id===body.id);check(messages.every(v=>v.id===body.id||(!v.id&&v.method?.startsWith('notifications/'))),'MCP_UNSUPPORTED_MESSAGE');
  }else value=JSON.parse(text);
  check(value&&value.jsonrpc==='2.0'&&value.id===body.id&&!value.error,'MCP_REPLY_INVALID');return value.result;
 }
 async function init(){
  const v=await rpc('initialize',{protocolVersion:'2025-11-25',capabilities:{},clientInfo:{name:'research-task-client',version:'0.1.0'}});
  check(['2025-11-25','2025-06-18','2025-03-26','2024-11-05'].includes(v.protocolVersion)&&v.capabilities?.tools,'MCP_PROTOCOL_UNSUPPORTED');version=v.protocolVersion;
  await rpc('notifications/initialized',undefined,true);const list=await rpc('tools/list');check(list.tools?.some(t=>t.name===(requiredTool??tool)),'WORKER_CONTRACT_UNAVAILABLE');
 }
 const call=async request=>{
  initialized??=init();await initialized;check(Buffer.byteLength(JSON.stringify(request))<=limit,'REQUEST_LIMIT');
  onEvent({event:'SERVER_OPERATION',operation:request.operation,turn:request.turn});
  const v=await rpc('tools/call',{name:tool,arguments:{request}});
  check(!v.isError&&v.structuredContent&&typeof v.structuredContent==='object','MCP_TOOL_INVALID');
  if(v.structuredContent.error_code!==undefined)throw new ResearchError(['worker_admission_disabled','coordinator_expired','coordinator_stale','startup_consent_required','helper_setup_required','enrollment_expired','installation_revoked','setup_budget_exhausted','enrollment_busy'].includes(v.structuredContent.error_code)?v.structuredContent.error_code.toUpperCase():'SERVER_REQUEST_DENIED');
  check(!v.structuredContent.operation_pending,'SERVER_OPERATION_PENDING');
  return v.structuredContent;
 };
 call.discover=async()=>{initialized??=init();await initialized;};
 return call;
}
