import readline from 'node:readline';
import {check,readBounded} from './core.mjs';
const [endpoint]=process.argv.slice(2),u=new URL(endpoint);
check(u.protocol==='http:'&&u.hostname==='127.0.0.1'&&/^\/[a-f0-9]{48}\/job$/.test(u.pathname)&&!u.search&&!u.hash&&!u.username&&!u.password,'LOCAL_ENDPOINT_INVALID');
let count=0,bytes=0;
for await(const line of readline.createInterface({input:process.stdin,crlfDelay:Infinity})){
 bytes+=Buffer.byteLength(line);if(bytes>1048576||++count>10000)break;let q;
 try{
  q=JSON.parse(line);if(q.id===undefined)continue;let result;
  if(q.method==='initialize')result={protocolVersion:q.params?.protocolVersion??'2024-11-05',capabilities:{tools:{}},serverInfo:{name:'research',version:'0.2.0'}};
  else if(q.method==='ping')result={};
  else if(q.method==='tools/list')result={tools:[{name:'research_job',description:'Submit and manage the current research task.',inputSchema:{type:'object',properties:{operation:{type:'string',enum:['submit','status','result','pause','resume','cancel','ack','verification-start','support-complete']},event_id:{type:'string'},receipt:{type:'object'}},required:['operation'],additionalProperties:false}}]};
  else{
   check(q.method==='tools/call'&&q.params?.name==='research_job','TOOL_DENIED');
   const r=await fetch(endpoint,{method:'POST',headers:{'content-type':'application/json'},redirect:'error',body:JSON.stringify(q.params.arguments),signal:AbortSignal.timeout(30000)});
   check(r.ok,'JOB_UNAVAILABLE');result={content:[{type:'text',text:await readBounded(r.body,65536)}],isError:false};
  }
  process.stdout.write(JSON.stringify({jsonrpc:'2.0',id:q.id,result})+'\n');
 }catch{if(q?.id!==undefined)process.stdout.write(JSON.stringify({jsonrpc:'2.0',id:q.id,error:{code:-32602,message:'RESEARCH_JOB_UNAVAILABLE'}})+'\n');}
}
