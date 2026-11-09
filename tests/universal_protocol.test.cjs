'use strict';
const assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm');
const store=new Map(),secure=new Map(),calls=[],handlers={};
const localStorage={getItem:k=>store.has(k)?store.get(k):null,
 setItem:(k,v)=>store.set(k,String(v)),removeItem:k=>store.delete(k)};
const Pebble={
 secureStorage:{getItem:async k=>secure.get(k)||null,setItem:async(k,v)=>secure.set(k,String(v)),
   removeItem:async k=>secure.delete(k)},
 registerActionHandler:f=>handlers.action=f,registerConfigHandler:f=>handlers.config=f,
 registerSourceHandler:f=>handlers.source=f,refreshSources:()=>{}
};
let forcedStatus=0,forceThrow=false,forceIncomplete=false,forceEmpty=false;
async function fetch(url,params){
 calls.push({url,params});
 if(forceThrow){forceThrow=false;throw Error('Connection reset');}
 if(forcedStatus){const s=forcedStatus;forcedStatus=0;return {ok:false,status:s};}
 const model=JSON.parse(params.body).model;
 if(url.includes('generativelanguage.googleapis.com')){
   return {ok:true,json:async()=>({modelVersion:'gemini-3.8-flash',responseId:'google-123',
     candidates:[{content:{parts:[{text:'Gemini response'}]},finishReason:'STOP'}],
     usageMetadata:{promptTokenCount:18,candidatesTokenCount:7,totalTokenCount:25}})};
 }
 if(url.includes('api.openai.com')){
   return {ok:true,json:async()=>({id:'resp_123',model:model||'gpt-5-mini',
     status:'completed',output:[{type:'message',content:[{type:'output_text',text:forceEmpty?'':'OpenAI response'}]}],
     usage:{input_tokens:23,output_tokens:10,total_tokens:33}})};
 }
 if(url.includes('api.anthropic.com')){
   return {ok:true,json:async()=>({id:'msg_123',model:model||'claude-sonnet-4-5',
     stop_reason:'end_turn',content:[{type:'text',text:'Claude response'}],
     usage:{input_tokens:20,output_tokens:8}})};
 }
 return {ok:true,json:async()=>({id:'chatcmpl_123',model:model||'unknown',
   choices:[{finish_reason:forceIncomplete?'length':'stop',
     message:{content:'Compatible completion'}}],usage:{prompt_tokens:11,completion_tokens:5,total_tokens:16}})};
}
vm.runInNewContext(fs.readFileSync(__dirname+'/../src/plugin/index.js','utf8'),
 {Pebble,localStorage,fetch,Date,Math,JSON,Promise,console,Uint8Array,isFinite});
function action(name,args){
 return new Promise(resolve=>handlers.action({action:name,args:args||{}},{
  ok:x=>{try{resolve({ok:true,data:JSON.parse(x.text)})}catch(e){resolve({ok:false,error:e.message})}},
  error:(code,message)=>resolve({ok:false,code,message})
 }));
}
function config(obj){return new Promise(resolve=>handlers.config(obj,resolve));}
function nativeAction(name,args){return new Promise(resolve=>handlers.action({action:name,args:args||{}},{
  ok:data=>resolve({ok:true,data:data}),error:(code,message)=>resolve({ok:false,code,message})
}));}
function source(item){return new Promise(resolve=>handlers.source({category:'agent',item:item},{
  data:data=>resolve({ok:true,data:data}),error:(code,message)=>resolve({ok:false,code,message})
}));}
(async()=>{
 let caps=await action('get_capabilities');
 assert.equal(caps.ok,true);
 assert.equal(caps.data.schema_version,1);
 assert.equal(caps.data.provider,'gemini');
 assert.equal(caps.data.configured,false);
 assert.equal(caps.data.providers.length,6);
 assert.equal(JSON.stringify(caps).includes('test-secret'),false);
 let result=await action('send_message',{text:'Hello',request_id:'req_gemini001'});
 assert.equal(result.code,'AUTH_REQUIRED');
 await config({type:'save',model:'gemini-3.8-flash',api_key:'gemini-key'});
 result=await action('send_message',{text:'Hello',request_id:'req_gemini001'});
 assert.equal(result.ok,true);
 assert.equal(result.data.schema_version,1);
 assert.equal(result.data.provider,'gemini');
 assert.equal(result.data.model,'gemini-3.8-flash');
 assert.equal(result.data.status,'completed');
 assert.equal(result.data.received,true);
 assert.equal(result.data.validation.provider_http_ok,true);
 assert.equal(result.data.validation.output_complete,true);
 assert.equal(result.data.usage.total_tokens,25);
 assert.match(result.data.requested_at,/^\d{4}-\d{2}-\d{2}T/);
 assert.match(result.data.received_at,/^\d{4}-\d{2}-\d{2}T/);
 assert.equal(result.data.request_id,'req_gemini001');
 assert.ok(result.data.message_id);
 assert.ok(result.data.conversation_id);
 // Concurrent calls with the same request ID must send only once.
 const beforeParallel=calls.length;
 const parallel=await Promise.all([
   action('send_message',{text:'Parallel request',request_id:'parallel_gemini001'}),
   action('send_message',{text:'Parallel request',request_id:'parallel_gemini001'})
 ]);
 assert.equal(calls.length,beforeParallel+1);
 assert.equal(parallel.filter(r=>r.ok).length,1);
 assert.equal(parallel.filter(r=>r.code==='DELIVERY_UNCERTAIN').length,1);
 const legacy=await action('conversation',{text:'Legacy Gemini test'});
 assert.equal(legacy.ok,true);
 assert.ok(legacy.data.conversation_id.startsWith('g'));
 const n=calls.length;
 let retry=await action('send_message',{text:'Hello',request_id:'req_gemini001'});
 assert.equal(retry.data.message_id,result.data.message_id);
 assert.equal(calls.length,n,'same request_id must not resend');
 retry=await action('send_message',{text:'Different',request_id:'req_gemini001'});
 assert.equal(retry.code,'INVALID_ARGS');
 retry=await action('send_message',{text:'Hello',request_id:'req_gemini001',conversation_id:'s123456789'});
 assert.equal(retry.code,'INVALID_ARGS','cannot reuse request ID for another session');
 retry=await action('send_message',{text:'Hello',request_id:'req_gemini001',instructions:'Different'});
 assert.equal(retry.code,'INVALID_ARGS','cannot reuse request ID for other instructions');
 assert.equal(calls.length,n,'collisions cannot send duplicate requests');
 let reading=await action('get_message',{request_id:'req_gemini001'});
 assert.equal(reading.data.message_id,result.data.message_id);

 const cases=[
  ['openai','gpt-5-mini','api.openai.com','Authorization','Bearer openai-key','OpenAI response'],
  ['anthropic','claude-sonnet-4-5','api.anthropic.com','x-api-key','anthropic-key','Claude response'],
  ['xai','grok-4-fast','api.x.ai','Authorization','Bearer xai-key','Compatible completion'],
  ['openrouter','openai/gpt-5-mini','openrouter.ai','Authorization','Bearer openrouter-key','Compatible completion'],
  ['deepseek','deepseek-chat','api.deepseek.com','Authorization','Bearer deepseek-key','Compatible completion']
 ];
 for(const [provider,model,host,authKey,authValue,answer] of cases){
  const cfg=await config({type:'save',provider,model,api_key:provider+'-key'});
  assert.equal(cfg.ok,true);
  assert.equal(cfg.provider,provider);
  assert.equal(cfg.model,model);
  let response=await action('send_message',{text:'Question',request_id:'request_'+provider+'001'});
  assert.equal(response.ok,true,provider+': '+JSON.stringify(response));
  assert.equal(response.data.provider,provider);
  assert.equal(response.data.text,answer);
  assert.equal(response.data.received,true);
  assert.equal(response.data.response.role,'assistant');
  assert.equal(response.data.validation.reply_text_present,true);
  const last=calls[calls.length-1];
  assert.ok(last.url.includes(host));
  assert.equal(last.params.headers[authKey],authValue);
  assert.equal(JSON.stringify(response.data).includes(provider+'-key'),false);
  assert.equal((await action('get_message',{request_id:'request_'+provider+'001'})).data.text,answer);
  const continuation=await action('send_message',{text:'Follow up',conversation_id:response.data.conversation_id,
    request_id:'follow_'+provider+'001'});
  assert.equal(continuation.ok,true);
  assert.equal(continuation.data.conversation_id,response.data.conversation_id);
 }
 await config({type:'save',provider:'openai',model:'gpt-5-mini'});
 // Native Core Devices contract: assistant text in result.text, not JSON text.
 const standard=await nativeAction('send_to_agent',{message:'What is the answer?'});
 assert.equal(standard.ok,true);
 assert.equal(standard.data.text,'OpenAI response');
 assert.equal(standard.data.reply_type,'assistant');
 assert.equal(standard.data.provider,'openai');
 assert.equal(standard.data.received,true);
 assert.equal(standard.data.validation.reply_text_present,true);
 assert.equal(standard.data.status,'completed');
 const other=await nativeAction('send_to_agent',{message:'Another chat',chat_id:'new'});
 assert.equal(other.ok,true);
 assert.notEqual(other.data.chat_id,standard.data.chat_id);
 const defaultReply=await nativeAction('send_to_agent',{message:'Follow up'});
 assert.equal(defaultReply.data.chat_id,standard.data.chat_id);
 const chats=await source('chats');
 assert.equal(chats.ok,true);
 assert.equal(chats.data.instances[0].instanceId,'default');
 assert.ok(chats.data.instances.some(x=>x.instanceId===other.data.chat_id));
 const configured=await source('configured');
 assert.equal(configured.ok,true);
 assert.equal(configured.data.instances[0].properties.configured.boolean.value,true);
 const invalid=await nativeAction('send_to_agent',{message:'Hi',chat_id:'not-real'});
 assert.equal(invalid.code,'INVALID_ARGS');
 const {pebble}=JSON.parse(fs.readFileSync(__dirname+'/../package.json','utf8'));
 const standardManifest=pebble.plugin.actions.find(x=>x.name==='send_to_agent');
 assert.deepEqual(standardManifest.parameters.required,['message']);
 assert.equal(standardManifest.parameters.properties.message.maxLength,16000);
 assert.equal(standardManifest.callerPermissions.length,0);
 assert.ok(pebble.plugin.sources.some(x=>x.items.includes('chats')));
 assert.ok(pebble.plugin.sources.some(x=>x.items.includes('configured')));
 const legacyAction=pebble.plugin.actions.find(x=>x.name==='conversation');
 assert.deepEqual(legacyAction.callerPermissions,['GeminiConverse']);
 assert.ok(pebble.plugin.actions.some(x=>x.name==='clear_ai_conversation'&&x.callerPermissions.includes('AIConverse')));
  const capsAfter=await action('get_capabilities');
 assert.equal(capsAfter.data.configured,true);
 assert.equal(capsAfter.data.configured_providers.gemini,true);
 assert.equal(capsAfter.data.configured_providers.anthropic,true);
 assert.equal(capsAfter.data.models.anthropic,'claude-sonnet-4-5');
 assert.equal(JSON.stringify(capsAfter).includes('anthropic-key'),false);
 // Never allow session histories from one provider or model to cross over.
 const existing=await action('get_message',{request_id:'req_gemini001'});
 const switched=await action('send_message',{text:'Wrong provider',conversation_id:existing.data.conversation_id,
   request_id:'cross_provider001'});
 assert.equal(switched.code,'INVALID_ARGS');
 forcedStatus=429;
 const limit=await action('send_message',{text:'Quota',request_id:'limit_openai001'});
 assert.equal(limit.code,'RATE_LIMITED');
 assert.equal((await action('get_message',{request_id:'limit_openai001'})).data.status,'failed');
 forceThrow=true;
 const uncertain=await action('send_message',{text:'Was this delivered?',request_id:'lost_openai001'});
 assert.equal(uncertain.code,'DELIVERY_UNCERTAIN');
 assert.equal((await action('get_message',{request_id:'lost_openai001'})).data.status,'uncertain');
 const pre=calls.length;
 const noRetry=await action('send_message',{text:'Was this delivered?',request_id:'lost_openai001'});
 assert.equal(noRetry.code,'DELIVERY_UNCERTAIN');
 assert.equal(calls.length,pre);
 forceEmpty=true;
 const empty=await action('send_message',{text:'Empty',request_id:'empty_openai001'});
 assert.equal(empty.code,'PLUGIN_UNAVAILABLE');
 forceEmpty=false;
 await config({type:'save',provider:'xai',model:'grok-4-fast'});
 forceIncomplete=true;
 const incomplete=await action('send_message',{text:'Long',request_id:'limit_xai001'});
 assert.equal(incomplete.ok,true);
 assert.equal(incomplete.data.status,'incomplete');
 assert.equal(incomplete.data.validation.output_complete,false);
 forceIncomplete=false;
 const beforeForget=await action('get_message',{request_id:'request_anthropic001'});
 assert.equal(beforeForget.ok,true);
 const forgetGemini=await config({type:'forget',provider:'gemini'});
 assert.equal(forgetGemini.ok,true);
 assert.equal((await action('get_message',{request_id:'req_gemini001'})).code,'INVALID_ARGS');
 assert.equal((await action('get_message',{request_id:'request_anthropic001'})).ok,true);
 // Stale pending requests are uncertain; the host may have been interrupted.
 store.set('ai_conversation_request_v1_stale_req_001',JSON.stringify({
   text:'A previous request',provider:'gemini',model:'gemini-3.8-flash',
   status:'pending',conversation_id:'s12345678',
   requested_at:'2026-01-01T00:00:00.000Z'
 }));
 const stale=await action('get_message',{request_id:'stale_req_001'});
 assert.equal(stale.ok,true);
 assert.equal(stale.data.status,'uncertain');
 assert.equal(stale.data.error_code,'DELIVERY_UNCERTAIN');
 const status=await config({type:'status'});
 assert.equal(status.provider,'xai');
 assert.equal(status.returns_full_reply,true);
 const clear=await action('clear_ai_conversation',{all:true});
 assert.equal(clear.ok,true);
 assert.equal((await action('get_message',{request_id:'request_anthropic001'})).code,'INVALID_ARGS');
 const manifest=JSON.parse(fs.readFileSync(__dirname+'/../package.json','utf8'));
 assert.equal(manifest.pebble.uuid,'2c5edc42-b096-4f76-b284-1f27907e6501');
 const actions=manifest.pebble.plugin.actions;
 assert.equal(actions.some(a=>a.name==='send_message'),true);
 assert.equal(actions.some(a=>a.name==='get_message'),true);
 assert.equal(actions.some(a=>a.name==='get_capabilities'),true);
 assert.equal(manifest.pebble.usesPermissions[0].parameters.domains.length,6);
 assert.equal(manifest.version,manifest.pebble.version,'package and Pebble versions must match');
 assert.equal(manifest.pebble.displayName,'Universal AI');
 assert.equal(manifest.name,'pebble-universal-ai-plugin');
 assert.ok(manifest.pebble.plugin.sources.length>0);
 assert.ok(manifest.pebble.plugin.sources.every(x=>x.category==='agent'),
   'all plugin source categories must be agent');
 console.log('PASS: multi-provider requests, credentials, IDs, timestamps, duplicate protection, errors, validation, legacy API');
})().catch(e=>{console.error(e);process.exitCode=1;});
