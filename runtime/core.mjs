import fs from 'node:fs/promises';
import crypto from 'node:crypto';
export const PROTOCOL='research-worker-v1', TOOL='research_evidence', MODEL='research-task-worker';
export const ENDPOINT='https://research-gateway.r95426882.workers.dev/mcp';
export const MAX_REQUEST=49152, MAX_RESPONSE=16*1024*1024;
export class ResearchError extends Error {constructor(code){super(code);this.code=code;}}
export const check=(value,code)=>{if(!value)throw new ResearchError(code);};
export const canonical=v=>JSON.stringify(v,(_,x)=>x&&typeof x==='object'&&!Array.isArray(x)?Object.fromEntries(Object.entries(x).sort(([a],[b])=>a.localeCompare(b))):x);
export const uuid=id=>typeof id==='string'&&/^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/.test(id);
export const keys=(v,expected)=>v&&typeof v==='object'&&!Array.isArray(v)&&Object.keys(v).sort().join(',')===[...expected].sort().join(',');
export const DEFAULT_PROFILE=Object.freeze({execution_seconds:300,model_requests:3,prompt_bytes:32768,report_bytes:32768,estimated_cost_microusd:20000,
 collection:{execution_seconds:180,resume_seconds:900,records:40,article_urls:1,bytes:1048576,request_seconds:90,retries:0,output_bytes:65536,
 requests:{web:2,article:1,x:1,video:1},pages:{web:2,article:1,x:1,video:1}}});
export const MANAGED_PROFILE=Object.freeze({...structuredClone(DEFAULT_PROFILE),execution_seconds:86400,model_requests:20,prompt_bytes:1048576,estimated_cost_microusd:400000,report_bytes:65536,evidence_rounds:6,output_tokens:3072,evidence_sources:32,excerpt_chars:1500,collection:{...structuredClone(DEFAULT_PROFILE.collection),requests:{...DEFAULT_PROFILE.collection.requests,x:30},pages:{...DEFAULT_PROFILE.collection.pages,x:4}}});
export function validateTask(task){
 check(keys(task,['protocol_version','task_id','question','profile'])&&task.protocol_version===PROTOCOL&&uuid(task.task_id),'TASK_INVALID');
 check(typeof task.question==='string'&&task.question.trim()&&Buffer.byteLength(task.question)<=2048,'QUESTION_INVALID');
 const optional=['evidence_rounds','output_tokens','evidence_sources','excerpt_chars'];
 check(task.profile&&Object.keys(task.profile).every(k=>k in DEFAULT_PROFILE||optional.includes(k)),'PROFILE_INVALID');
 const recurse=(p,c)=>{check(p&&typeof p==='object'&&!Array.isArray(p)&&Object.keys(c).every(k=>k in p),'PROFILE_INVALID');for(const [k,max] of Object.entries(c)){
  if(typeof max==='object'){check(keys(p[k],Object.keys(max)),'PROFILE_INVALID');recurse(p[k],max);}else check(Number.isSafeInteger(p[k])&&p[k]>=(k==='retries'?0:1),'PROFILE_INVALID');}};
 recurse(task.profile,DEFAULT_PROFILE);for(const k of optional)if(k in task.profile)check(Number.isSafeInteger(task.profile[k])&&task.profile[k]>=1,'PROFILE_INVALID');
 check(task.profile.execution_seconds<=Math.floor(2147483647/1000)-60,'DEADLINE_INVALID');
 check(task.profile.report_bytes>=4096&&task.profile.prompt_bytes>=2048&&task.profile.report_bytes<=MAX_RESPONSE/2,'PROFILE_INVALID');return task;
}
export function makeTask(input){check(keys(input,['question'])||keys(input,['question','profile']),'TASK_INVALID');return validateTask({protocol_version:PROTOCOL,task_id:crypto.randomUUID(),question:input.question,profile:structuredClone(input.profile??DEFAULT_PROFILE)});}
export const evidenceSchema={type:'object',properties:{kind:{type:'string',enum:['web','article','x_search','x_replies','video']},query:{type:'string',maxLength:2048,description:'At most 2048 UTF-8 bytes before trimming shared Unicode whitespace; must be nonempty after trimming.'},source_id:{type:'string'},url:{type:'string'},mode:{type:'string',enum:['static','auto','crawl','playwright']},post_id:{type:'string'},recency_days:{type:'integer',minimum:1},child_job_id:{type:'string'}},required:['kind'],additionalProperties:false};
export function validateEvidenceArgs(a){
 check(a&&evidenceSchema.properties.kind.enum.includes(a.kind),'TOOL_INVALID');
 if(a.child_job_id!==undefined){check(keys(a,['kind','child_job_id'])&&/^[a-f0-9]{32}$/.test(a.child_job_id),'TOOL_INVALID');return a;}
 let required=['kind'],allowed=['kind'];
 if(['web','x_search','video'].includes(a.kind)){required.push('query');allowed.push('query');normalizeWorkerQuery(a.query);if(a.kind==='web'){allowed.push('recency_days');if(a.recency_days!==undefined)check(Number.isSafeInteger(a.recency_days)&&a.recency_days>0,'TOOL_INVALID');}}
 if(a.kind==='article'){allowed.push('source_id','url','mode');check((a.source_id!==undefined)!==(a.url!==undefined),'TOOL_INVALID');if(a.source_id!==undefined)check(/^S[1-9]\d*$/.test(a.source_id),'TOOL_INVALID');else publicURL(a.url);if(a.mode!==undefined)check(evidenceSchema.properties.mode.enum.includes(a.mode),'TOOL_INVALID');}
 if(a.kind==='x_replies'){required.push('post_id');allowed.push('post_id');check(typeof a.post_id==='string'&&/^\d{1,24}$/.test(a.post_id),'TOOL_INVALID');}
 check(required.every(k=>k in a)&&Object.keys(a).every(k=>allowed.includes(k)),'TOOL_INVALID');return a;
}

export async function readBounded(stream,max=MAX_RESPONSE){let size=0;const parts=[];for await(const part of stream){const b=Buffer.from(part);size+=b.length;check(size<=max,'BODY_LIMIT');parts.push(b);}return Buffer.concat(parts).toString('utf8');}
export async function readPrivate(file,max=MAX_RESPONSE){let h;try{h=await fs.open(file,fs.constants.O_RDONLY|fs.constants.O_NOFOLLOW|fs.constants.O_NONBLOCK);const s=await h.stat();check(s.isFile()&&s.nlink<=1&&s.uid===process.getuid()&&!(s.mode&0o077)&&s.size<=max,'PRIVATE_FILE_UNSAFE');const b=Buffer.alloc(max+1),r=await h.read(b,0,b.length,0);check(r.bytesRead<=max,'BODY_LIMIT');return b.subarray(0,r.bytesRead).toString();}finally{await h?.close();}}
export async function readCLIOutput(file,max){let h;try{h=await fs.open(file,fs.constants.O_RDONLY|fs.constants.O_NOFOLLOW|fs.constants.O_NONBLOCK);const s=await h.stat();check(s.isFile()&&s.nlink===1&&s.uid===process.getuid()&&s.size<=max,'CLI_OUTPUT_UNSAFE');const b=Buffer.alloc(max+1),r=await h.read(b,0,b.length,0);check(r.bytesRead<=max,'BODY_LIMIT');return b.subarray(0,r.bytesRead).toString();}finally{await h?.close();}}
export const taskRequest=(task,operation,extra={})=>({task,operation,...extra});
export function publicURL(value){try{const u=new URL(value);check(['https:','http:'].includes(u.protocol)&&!u.username&&!u.password&&(!u.port||['80','443'].includes(u.port)),'SOURCE_INVALID');check(!/^(localhost|127\.|0\.|10\.|192\.168\.|169\.254\.|172\.(1[6-9]|2\d|3[01])\.|\[)/i.test(u.hostname)&&!u.hostname.endsWith('.local')&&!u.hostname.endsWith('.internal'),'SOURCE_INVALID');return value;}catch{throw new ResearchError('SOURCE_INVALID');}}
export function validateResult(v,task){
 check(v&&v.report_id===task.task_id.replaceAll('-','')&&['COMPLETED','PARTIAL','FAILED','CANCELLED_LOCAL','CANCEL_PENDING','INTERRUPTED_UNKNOWN','PAUSED'].includes(v.state),'RESULT_INVALID');
 check(Number.isInteger(v.model_attempts)&&v.model_attempts>=0&&v.model_attempts<=task.profile.model_requests&&typeof v.usage_unknown==='boolean','RESULT_INVALID');
 check(v.usage&&v.usage.billing_known===false&&typeof v.usage.cost_unknown==='boolean'&&Array.isArray(v.usage.attempts)&&v.usage.attempts.length===v.model_attempts,'RESULT_INVALID');
 check(v.usage.estimated_cost_gate_microusd===task.profile.estimated_cost_microusd&&Number.isSafeInteger(v.usage.estimated_known_cost_microusd)&&v.usage.estimated_known_cost_microusd>=0,'RESULT_INVALID');
 for(const a of v.usage.attempts){check(['ok','unknown','rejected'].includes(a.outcome),'RESULT_INVALID');if(a.usage!==null){check(a.model==='deepseek-flash'&&['prompt_tokens','completion_tokens','total_tokens'].every(k=>Number.isSafeInteger(a.usage[k])&&a.usage[k]>=0)&&a.usage.total_tokens===a.usage.prompt_tokens+a.usage.completion_tokens,'RESULT_INVALID');}}
 check(Buffer.byteLength(JSON.stringify(v))<=task.profile.report_bytes,'RESULT_LIMIT');
 if(v.report?.sources){check(Array.isArray(v.report.sources)&&v.report.sources.length<=(task.profile.evidence_sources??16),'RESULT_INVALID');for(const s of v.report.sources){check(/^S[1-9]\d*$/.test(s.id),'SOURCE_INVALID');publicURL(s.url);}if(v.report.claims){const ids=new Set(v.report.sources.map(s=>s.id));for(const c of v.report.claims)check(Array.isArray(c.evidence_ids)&&c.evidence_ids.length&&c.evidence_ids.every(id=>ids.has(id)),'CITATION_INVALID');}}
 return v;
}
export function turnReply(v,task){
 check(keys(v,['protocol_version','task_id','response','report'])&&v.protocol_version===PROTOCOL&&v.task_id===task.task_id&&v.report===null,'REPLY_INVALID');
 check(keys(v.response,['id','output'])&&/^resp_[a-f0-9-]{36}$/.test(v.response.id)&&v.response.output.length===1,'REPLY_INVALID');
 const item=v.response.output[0];check(item&&item.status==='completed','REPLY_INVALID');
 if(item.type==='function_call'){
  check(keys(item,['type','id','call_id','name','arguments','status'])&&item.name===TOOL&&/^call_[a-f0-9-]{36}$/.test(item.call_id)&&/^fc_[a-f0-9-]{36}$/.test(item.id),'TOOL_INVALID');
  validateEvidenceArgs(JSON.parse(item.arguments));
 }else{check(keys(item,['type','role','id','status','content'])&&item.type==='message'&&item.role==='assistant'&&/^msg_[a-f0-9-]{36}$/.test(item.id)&&item.content.length===1&&item.content[0].type==='output_text'&&Array.isArray(item.content[0].annotations)&&!item.content[0].annotations.length,'REPLY_INVALID');validateResult(JSON.parse(item.content[0].text),task);}
 return v;
}
export function evidenceReply(v,task,call){check(keys(v,['protocol_version','task_id','call_id','output'])&&v.protocol_version===PROTOCOL&&v.task_id===task.task_id&&v.call_id===call.call_id&&v.output&&Object.keys(v.output).every(k=>['sources','coverage','complete_source_coverage','children'].includes(k))&&v.output.complete_source_coverage===false&&Array.isArray(v.output.coverage)&&Array.isArray(v.output.sources)&&v.output.sources.length<=(task.profile.evidence_sources??16),'EVIDENCE_INVALID');for(const s of v.output.sources){publicURL(s.url);check(/^S[1-9]\d*$/.test(s.id)&&typeof s.text==='string'&&s.text.length<=(task.profile.excerpt_chars??1500)&&s.trust==='untrusted','EVIDENCE_INVALID');}if(v.output.children!==undefined){check(Array.isArray(v.output.children),'EVIDENCE_INVALID');for(const c of v.output.children)check(/^[a-f0-9]{32}$/.test(c.job_id)&&typeof c.state==='string'&&typeof c.continuation_available==='boolean','EVIDENCE_INVALID');}return v;}
export const publicError=e=>({code:e instanceof ResearchError?e.code:'WORKER_FAILED'});

export function resumeSnapshot(state,task){
 check(state&&state.state==='RUNNING'&&Number.isSafeInteger(state.next_turn)&&state.next_turn>=0&&state.next_turn<task.profile.model_requests,'RESUME_INVALID');
 check(state.next_turn===0?state.response_id===null:/^resp_[a-f0-9-]{36}$/.test(state.response_id),'RESUME_INVALID');
 let pending=null,evidence=null;
 if(state.pending!==null&&state.pending!==undefined){const p=state.pending;check(keys(p,['call_id','arguments','evidence'])&&/^call_[a-f0-9-]{36}$/.test(p.call_id),'RESUME_INVALID');
 const args=typeof p.arguments==='string'?JSON.parse(p.arguments):p.arguments;validateEvidenceArgs(args);
 pending={type:'function_call',id:'fc_'+crypto.randomUUID(),call_id:p.call_id,name:TOOL,status:'completed',arguments:JSON.stringify(args)};
 if(p.evidence!==null&&p.evidence!==undefined)evidence=evidenceReply({protocol_version:PROTOCOL,task_id:task.task_id,call_id:p.call_id,output:p.evidence},task,pending);
 }
 return {turn:state.next_turn,previous:state.response_id,pending,evidence};
}

export function normalizeWorkerQuery(query){check(typeof query==='string'&&Buffer.byteLength(query)<=2048,'TOOL_INVALID');const normalized=query.replace(/^[\s\u001c-\u001f\u0085]+|[\s\u001c-\u001f\u0085]+$/gu,'');check(normalized,'TOOL_INVALID');return normalized;}
export const MAX_EVIDENCE_RECEIPT=512;
export function evidenceReceipt(evidence,task,call){
 evidenceReply(evidence,task,call);
 const receipt={protocol_version:PROTOCOL,task_id:task.task_id,call_id:call.call_id,evidence_sha256:crypto.createHash('sha256').update(canonical(evidence)).digest('hex')};
 check(Buffer.byteLength(canonical(receipt))<=MAX_EVIDENCE_RECEIPT,'RECEIPT_LIMIT');return receipt;
}
export function validateEvidenceReceipt(value){check(keys(value,['protocol_version','task_id','call_id','evidence_sha256'])&&value.protocol_version===PROTOCOL&&uuid(value.task_id)&&/^call_[a-f0-9-]{36}$/.test(value.call_id)&&/^[a-f0-9]{64}$/.test(value.evidence_sha256)&&Buffer.byteLength(canonical(value))<=MAX_EVIDENCE_RECEIPT,'RECEIPT_INVALID');return value;}
export function compareEvidenceReceipt(value,evidence,task,call){validateEvidenceReceipt(value);check(canonical(value)===canonical(evidenceReceipt(evidence,task,call)),'TOOL_OUTPUT_CHANGED');return value;}
