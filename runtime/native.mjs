import {check,MODEL,TOOL} from './core.mjs';
export function nativeRequest(body,worker){
 check(body&&body.model===MODEL&&typeof body.stream==='boolean','NATIVE_REQUEST_INVALID');
 const namespace=body.tools?.find(t=>t.type==='namespace'&&t.name==='mcp__research');
 const advertised=worker==='codex'?(namespace?.tools?.find(t=>t.name===TOOL)??body.tools?.find(t=>t.name===TOOL||t.name==='mcp__research__'+TOOL)):
  body.tools?.find(t=>t.name===TOOL||t.name==='mcp__research__'+TOOL);
 check(advertised,'EVIDENCE_TOOL_MISSING');
 const schema=advertised.parameters??advertised.input_schema;
 check(schema?.type==='object'&&schema.properties?.kind&&schema.additionalProperties===false,'EVIDENCE_TOOL_SCHEMA');
 const outputs=worker==='codex'?(body.input??[]).filter(x=>x.type==='function_call_output'):
  (body.messages??[]).filter(m=>m.role==='user'&&Array.isArray(m.content)).flatMap(m=>m.content).filter(c=>c.type==='tool_result').map(c=>{check(!c.is_error,'TOOL_EXECUTION_FAILED');return {call_id:c.tool_use_id,output:c.content};});
 return {outputs,name:advertised.name,namespace:worker==='codex'&&namespace?namespace.name:undefined};
}
export function decodeTool(value){
 for(let depth=0;depth<5;depth++){
  if(typeof value==='string'){value=value.replace(/^Wall time: [0-9]+(?:\.[0-9]+)? seconds(?:\n|\\n)Output:(?:\n|\\n)/,'');value=JSON.parse(value);continue;}
  if(value?.structuredContent){value=value.structuredContent;continue;}
  if(Array.isArray(value)){check(value.length===1&&value[0].type==='text','TOOL_OUTPUT_INVALID');value=value[0].text;continue;}
  if(Array.isArray(value?.content)){value=value.content;continue;}
  return value;
 }
 throw new Error('TOOL_OUTPUT_INVALID');
}
export function respond(res,response,worker,native,stream){
 let item=response.output[0];const tool=item.type==='function_call';
 if(worker==='claude-code'){
  const block=tool?{type:'tool_use',id:item.call_id,name:native.name,input:JSON.parse(item.arguments)}:{type:'text',text:item.content[0].text};
  // Required wire counters are transport placeholders, never research billing receipts.
  const message={id:response.id,type:'message',role:'assistant',model:MODEL,content:[block],stop_reason:tool?'tool_use':'end_turn',stop_sequence:null,usage:{input_tokens:0,output_tokens:0}};
  if(!stream){res.writeHead(200,{'content-type':'application/json'});res.end(JSON.stringify(message));return;}
  res.writeHead(200,{'content-type':'text/event-stream','cache-control':'no-store'});
  const event=(type,fields)=>res.write(`event: ${type}\ndata: ${JSON.stringify({type,...fields})}\n\n`);
  event('message_start',{message:{...message,content:[],stop_reason:null}});
  event('content_block_start',{index:0,content_block:tool?{...block,input:{}}:{type:'text',text:''}});
  event('content_block_delta',{index:0,delta:tool?{type:'input_json_delta',partial_json:JSON.stringify(block.input)}:{type:'text_delta',text:block.text}});
  event('content_block_stop',{index:0});event('message_delta',{delta:{stop_reason:message.stop_reason,stop_sequence:null},usage:{output_tokens:0}});event('message_stop',{});res.end();return;
 }
 if(tool)item={...item,name:native.name,...(native.namespace?{namespace:native.namespace}:{})};
 const complete={id:response.id,object:'response',created_at:Math.floor(Date.now()/1000),status:'completed',model:MODEL,output:[item],error:null,incomplete_details:null,usage:null};
 if(!stream){res.writeHead(200,{'content-type':'application/json'});res.end(JSON.stringify(complete));return;}
 res.writeHead(200,{'content-type':'text/event-stream','cache-control':'no-store'});let sequence_number=0;
 const event=(type,fields)=>res.write(`event: ${type}\ndata: ${JSON.stringify({type,sequence_number:sequence_number++,...fields})}\n\n`);
 event('response.created',{response:{...complete,status:'in_progress',output:[]}});
 event('response.output_item.added',{output_index:0,item:tool?{...item,status:'in_progress',arguments:''}:{...item,status:'in_progress',content:[]}});
 if(tool){event('response.function_call_arguments.delta',{item_id:item.id,output_index:0,delta:item.arguments});event('response.function_call_arguments.done',{item_id:item.id,output_index:0,arguments:item.arguments});}
 else{
  event('response.content_part.added',{item_id:item.id,output_index:0,content_index:0,part:{type:'output_text',text:'',annotations:[]}});
  event('response.output_text.delta',{item_id:item.id,output_index:0,content_index:0,delta:item.content[0].text});
  event('response.output_text.done',{item_id:item.id,output_index:0,content_index:0,text:item.content[0].text});
  event('response.content_part.done',{item_id:item.id,output_index:0,content_index:0,part:item.content[0]});
 }
 event('response.output_item.done',{output_index:0,item});event('response.completed',{response:complete});res.end();
}
