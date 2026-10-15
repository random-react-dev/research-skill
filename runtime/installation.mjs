import crypto from 'node:crypto';
import {serviceAccess,mcpClient} from './mcp-client.mjs';
export const runtimeFacts=(worker)=>({platform:process.platform,arch:process.arch,node:process.versions.node,runtime:'direct-mcp-0.4.1',...(worker?{worker}:{})});
export function installationReporter({accessHome,worker,role='worker',access,fixture=false,send,intervalMs=30000}){
 const run_id=crypto.randomUUID();let seq=0,busy=false,stopped=false,timer,inflight;
 async function contact(state='active'){
  if(busy)return false;busy=true;
  try{
   const signal=AbortSignal.timeout(8000);
   const upstream=send??mcpClient({...access??await serviceAccess(accessHome,{signal}),fixture,managed:true,signal});
   const result=await upstream({scope:'installation',version:1,operation:'contact',role,run_id,seq:seq++,state,facts:runtimeFacts(worker)});
   return result.accepted===true;
  }catch{return false;}finally{busy=false;}
 }
 function start(){inflight=contact();timer=setInterval(()=>{if(!stopped&&!busy)inflight=contact();},intervalMs);timer.unref();return inflight;}
 async function stop(){stopped=true;clearInterval(timer);await inflight;return contact('stopped');}
 return {contact,start,stop};
}
