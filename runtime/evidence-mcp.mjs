import readline from 'node:readline';
import {check,readBounded,TOOL,evidenceSchema,MAX_EVIDENCE_RECEIPT,validateEvidenceReceipt} from './core.mjs';
const [endpoint]=process.argv.slice(2);const u=new URL(endpoint);
check(u.protocol==='http:'&&u.hostname==='127.0.0.1'&&/^\/[a-f0-9]{48}\/evidence$/.test(u.pathname)&&!u.search&&!u.hash&&!u.username&&!u.password,'LOCAL_ENDPOINT_INVALID');
const schema=evidenceSchema;
let bytes=0,count=0;const lines=readline.createInterface({input:process.stdin,crlfDelay:Infinity});
for await(const line of lines){bytes+=Buffer.byteLength(line);if(bytes>16*1024*1024||++count>100000)break;let q;
 try{q=JSON.parse(line);if(q.id===undefined)continue;let result;
  if(q.method==='initialize')result={protocolVersion:q.params?.protocolVersion??'2024-11-05',capabilities:{tools:{}},serverInfo:{name:'research',version:'0.1.0'}};
  else if(q.method==='ping')result={};
  else if(q.method==='tools/list')result={tools:[{name:TOOL,description:'Collect the current task model-requested public evidence and return its compact identity receipt; authoritative evidence stays on the research server.',inputSchema:schema,annotations:{readOnlyHint:true,destructiveHint:false,idempotentHint:true,openWorldHint:false}}]};
  else{check(q.method==='tools/call'&&q.params?.name===TOOL,'TOOL_DENIED');const r=await fetch(endpoint,{method:'POST',redirect:'error',headers:{'content-type':'application/json'},body:JSON.stringify(q.params.arguments),signal:AbortSignal.timeout(200000)});check(r.ok,'EVIDENCE_UNAVAILABLE');const text=await readBounded(r.body,MAX_EVIDENCE_RECEIPT);validateEvidenceReceipt(JSON.parse(text));result={content:[{type:'text',text}],isError:false};}
  process.stdout.write(JSON.stringify({jsonrpc:'2.0',id:q.id,result})+'\n');
 }catch{if(q?.id!==undefined)process.stdout.write(JSON.stringify({jsonrpc:'2.0',id:q.id,error:{code:-32602,message:'RESEARCH_TOOL_DENIED'}})+'\n');}
}
