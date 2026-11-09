/* Universal AI provider-neutral bridge for Pebble plugin API v2.
 * One plugin action per invocation: store conversation context in localStorage.
 * API key lives only in Pebble.secureStorage. No credentials returned.
 */
'use strict';
var KEY='gemini_conversation_api_key_v1';
var MODEL='gemini_conversation_model_v1';
var LIST='gemini_conversation_sessions_v1';
var DEFAULT_MODEL='gemini-3.8-flash';
var CATALOG_KEY='gemini_conversation_model_catalog_v1';
var CATALOG_TTL_MS=6*60*60*1000;
var MODEL_EXCLUDE=/(?:-image(?:-|$)|-tts(?:-|$)|-live(?:-|$)|-native-audio|-transcribe|embedding|robotics|-computer-use|-omni|-video|deep-research)/i;
function callableTextModel(item){
  if(!item||typeof item.name!=='string')return null;
  var id=item.name.replace(/^models\//,'');
  var methods=item.supportedGenerationMethods||item.supported_generation_methods||[];
  if(!modelName(id)||MODEL_EXCLUDE.test(id)||methods.indexOf('generateContent')<0)return null;
  return {id:id,name:String(item.displayName||id).slice(0,90),description:String(item.description||'').slice(0,180)};
}
function modelCache(){
  try{
    var c=JSON.parse(localStorage.getItem(CATALOG_KEY)||'null');
    return c&&Array.isArray(c.models)?c:null;
  }catch(e){return null;}
}
async function listModels(keyInput){
  var token=(typeof keyInput==='string'&&keyInput.trim())||await Pebble.secureStorage.getItem(KEY);
  if(!token)return fail('AUTH_REQUIRED','Enter and save a Gemini API key to list available models.');
  var byId={},page='',pages=0;
  try{
    do{
      var url='https://generativelanguage.googleapis.com/v1beta/models?pageSize=1000';
      if(page)url+='&pageToken='+encodeURIComponent(page);
      var res=await fetch(url,{headers:{'x-goog-api-key':token}});
      if(!res.ok)return apiStatus(res.status);
      var data=await res.json();
      (Array.isArray(data.models)?data.models:[]).forEach(function(item){
        var model=callableTextModel(item);
        if(model)byId[model.id]=model;
      });
      page=typeof data.nextPageToken==='string'?data.nextPageToken:'';
      pages++;
    }while(page&&pages<4);
    var models=Object.keys(byId).sort().map(function(id){return byId[id];});
    if(!models.length)return fail('PLUGIN_UNAVAILABLE','No text-generation models returned for this key.');
    // Cache only catalog metadata, never keys or Google API responses with credentials.
    localStorage.setItem(CATALOG_KEY,JSON.stringify({checkedAt:Date.now(),models:models}));
    return {ok:true,data:{models:models,checkedAt:Date.now(),hasMore:!!page}};
  }catch(e){
    var cached=modelCache();
    if(cached&&Date.now()-cached.checkedAt<CATALOG_TTL_MS)
      return {ok:true,data:{models:cached.models,checkedAt:cached.checkedAt,fromCache:true}};
    return fail('PLUGIN_UNAVAILABLE','Could not retrieve Gemini models. Check connection and API permissions.');
  }
}
var MAX_PAIRS=3, MAX_CONTEXT=8000, MAX_SESSIONS=12;
function fail(code,message){return {ok:false,code:code,message:message};}
function modelName(v){return typeof v==='string'&&/^gemini-[A-Za-z0-9._-]{1,70}$/.test(v)?v:null;}
function settings(){return {model:modelName(localStorage.getItem(MODEL))||DEFAULT_MODEL};}
function validId(v){return typeof v==='string'&&/^g[a-z0-9]{6,40}$/.test(v);}
function sessionKey(id){return 'gemini_conversation_history_v1_'+id;}
function allIds(){try{var v=JSON.parse(localStorage.getItem(LIST)||'[]');return Array.isArray(v)?v.filter(validId):[];}catch(e){return [];}}
function loadHistory(id){
  if(!validId(id))return [];
  try{var v=JSON.parse(localStorage.getItem(sessionKey(id))||'[]');
    return trimHistory(v);
  }catch(e){return [];}
}
function trimHistory(items){
  if(!Array.isArray(items))return [];
  var pairs=[],output=[],count=0;
  for(var i=0;i+1<items.length;i++){
    var a=items[i],b=items[i+1];
    if(a&&b&&a.role==='user'&&b.role==='model'&&
      Array.isArray(a.parts)&&Array.isArray(b.parts)&&
      a.parts[0]&&b.parts[0]&&
      typeof a.parts[0].text==='string'&&typeof b.parts[0].text==='string'){
      pairs.push([a,b]);i++;
    }
  }
  for(var j=pairs.length-1;j>=0&&output.length<MAX_PAIRS*2;j--){
    var n=JSON.stringify(pairs[j]).length;
    if(count+n>MAX_CONTEXT)break;
    output.unshift(pairs[j][0],pairs[j][1]);count+=n;
  }
  return output;
}
function clearSession(id){
  if(!validId(id))return;
  localStorage.removeItem(sessionKey(id));
  localStorage.setItem(LIST,JSON.stringify(allIds().filter(function(x){return x!==id;})));
}
function clearAll(){
  allIds().forEach(function(id){localStorage.removeItem(sessionKey(id));});
  localStorage.removeItem(LIST);
}
function saveHistory(id,history){
  var ids=allIds().filter(function(x){return x!==id;});
  while(ids.length>=MAX_SESSIONS)localStorage.removeItem(sessionKey(ids.shift()));
  ids.push(id);
  localStorage.setItem(sessionKey(id),JSON.stringify(trimHistory(history)));
  localStorage.setItem(LIST,JSON.stringify(ids));
}
function newId(){
  return 'g'+Date.now().toString(36)+Math.floor(Math.random()*0x1000000).toString(36);
}
function apiStatus(status){
  if(status===401||status===403)return fail('AUTH_REQUIRED','Gemini API key or permission rejected. Open plugin settings.');
  if(status===429)return fail('RATE_LIMITED','Gemini rate or quota limit reached.');
  if(status===400)return fail('INVALID_ARGS','Gemini rejected the request or model; review plugin settings.');
  return fail('PLUGIN_UNAVAILABLE','Gemini HTTP '+status);
}
async function conversation(args){
  if(typeof args.text!=='string'||!args.text.trim()||args.text.length>4000)
    return fail('INVALID_ARGS','Text must contain 1–4000 characters.');
  if(args.instructions!==undefined&&(typeof args.instructions!=='string'||args.instructions.length>1000))
    return fail('INVALID_ARGS','Instructions must be under 1000 characters.');
  var id=args.conversation_id;
  if(id!==undefined&&id!==''&&!validId(id))return fail('INVALID_ARGS','Invalid conversation_id.');
  id=id||newId();
  var model=args.model===undefined?settings().model:modelName(args.model);
  if(!model)return fail('INVALID_ARGS','Invalid Gemini model name.');
  var token=await Pebble.secureStorage.getItem(KEY);
  if(!token)return fail('AUTH_REQUIRED','Configure your Gemini API key in the plugin settings.');
  var old=loadHistory(id);
  var contents=old.concat([{role:'user',parts:[{text:args.text}]}]);
  var system='You are a helpful assistant responding on a smartwatch. Keep answers concise, spoken naturally, and avoid Markdown.';
  if(args.instructions)system+='\n'+args.instructions;
  try{
    var res=await fetch('https://generativelanguage.googleapis.com/v1beta/models/'+encodeURIComponent(model)+':generateContent',{
      method:'POST',
      headers:{'Content-Type':'application/json','x-goog-api-key':token},
      body:JSON.stringify({system_instruction:{parts:[{text:system}]},contents:contents,
        generationConfig:{maxOutputTokens:650}})
    });
    if(!res.ok)return apiStatus(res.status);
    var data=await res.json();
    var candidate=data&&data.candidates&&data.candidates[0];
    var parts=candidate&&candidate.content&&candidate.content.parts||[];
    var answer=parts.map(function(p){return p.text||'';}).join(' ').trim();
    if(!answer)return fail('PLUGIN_UNAVAILABLE','Gemini returned no readable answer.');
    answer=answer.slice(0,4000);
    saveHistory(id,contents.concat([{role:'model',parts:[{text:answer}]}]));
    return {ok:true,data:{text:answer,conversation_id:id,model:model}};
  }catch(e){return fail('PLUGIN_UNAVAILABLE','Gemini connection failed or timed out.');}
}

// === Universal AI conversation protocol v1 ===
// Provider and model are selected ONLY in this plugin's settings. Consuming
// apps send text and optional request/conversation IDs, never API credentials.
var PROVIDER_KEY='ai_conversation_provider_v1';
var MODELS_KEY='ai_conversation_models_v1';
var REQUEST_PREFIX='ai_conversation_request_v1_';
var SESSION_PREFIX='ai_conversation_session_v1_';
var REQUEST_INDEX='ai_conversation_request_index_v1';
var SESSION_INDEX='ai_conversation_session_index_v1';
var MAX_REQUESTS=30;
var MAX_UNIVERSAL_SESSIONS=12;
var PROVIDERS={
  gemini:{label:'Google Gemini',defaultModel:DEFAULT_MODEL,domain:'generativelanguage.googleapis.com'},
  openai:{label:'OpenAI',defaultModel:'gpt-5-mini',domain:'api.openai.com'},
  anthropic:{label:'Anthropic Claude',defaultModel:'claude-sonnet-4-5',domain:'api.anthropic.com'},
  xai:{label:'xAI Grok',defaultModel:'grok-4-fast',domain:'api.x.ai'},
  openrouter:{label:'OpenRouter',defaultModel:'openai/gpt-5-mini',domain:'openrouter.ai'},
  deepseek:{label:'DeepSeek',defaultModel:'deepseek-chat',domain:'api.deepseek.com'}
};
function currentProvider(){
  var p=localStorage.getItem(PROVIDER_KEY)||'gemini';
  return PROVIDERS[p]?p:'gemini';
}
function configuredModels(){
  try{var o=JSON.parse(localStorage.getItem(MODELS_KEY)||'{}');return o&&typeof o==='object'?o:{};}catch(e){return {};}
}
function selectedModel(provider){
  if(provider==='gemini')return settings().model;
  var m=configuredModels()[provider];
  return validGenericModel(m)?m:PROVIDERS[provider].defaultModel;
}
function validGenericModel(model){
  return typeof model==='string'&&model.length>0&&model.length<120&&
    /^[a-zA-Z0-9][a-zA-Z0-9._:/-]*$/.test(model);
}
function keyId(provider){return provider==='gemini'?KEY:'ai_conversation_api_key_v1_'+provider;}
async function providerReady(provider){return !!(await Pebble.secureStorage.getItem(keyId(provider)));}
async function publicConfig(){
  var provider=currentProvider(),keys={},models=configuredModels();
  var names=Object.keys(PROVIDERS);
  for(var i=0;i<names.length;i++)keys[names[i]]=await providerReady(names[i]);
  models.gemini=settings().model;
  return {schema_version:1,provider:provider,provider_name:PROVIDERS[provider].label,
    model:selectedModel(provider),configured:keys[provider],
    configured_providers:keys,models:models,
    returns_full_reply:true,tts:false,providers:names.map(function(p){
      return {id:p,name:PROVIDERS[p].label,default_model:PROVIDERS[p].defaultModel};
    })};
}
function isoNow(){return new Date().toISOString();}
function freshMessageId(){return 'm'+Date.now().toString(36)+Math.floor(Math.random()*0x10000000).toString(36);}
function validRequestId(v){return typeof v==='string'&&/^[A-Za-z0-9_-]{8,72}$/.test(v);}
function universalSessionId(){return 's'+Date.now().toString(36)+Math.floor(Math.random()*0x10000000).toString(36);}
function validUniversalSession(v){return typeof v==='string'&&/^s[a-z0-9]{6,40}$/.test(v);}
function jsonGet(key,otherwise){
  try{var v=JSON.parse(localStorage.getItem(key)||'null');return v===null?otherwise:v;}catch(e){return otherwise;}
}
function indexedSave(indexKey,key,max,value){
  var ids=jsonGet(indexKey,[]);
  if(!Array.isArray(ids))ids=[];
  ids=ids.filter(function(s){return s!==key;});
  ids.push(key);
  while(ids.length>max){var removed=ids.shift();localStorage.removeItem(removed);}
  localStorage.setItem(key,JSON.stringify(value));
  localStorage.setItem(indexKey,JSON.stringify(ids));
}
function saveRequest(id,record){
  var prior=requestRecord(id);
  if(prior){
    if(record.requested_conversation_id===undefined)
      record.requested_conversation_id=prior.requested_conversation_id||null;
    if(record.instructions===undefined)record.instructions=prior.instructions||'';
  }
  indexedSave(REQUEST_INDEX,REQUEST_PREFIX+id,MAX_REQUESTS,record);
}
function requestRecord(id){return validRequestId(id)?jsonGet(REQUEST_PREFIX+id,null):null;}
function saveUniversalSession(id,value){indexedSave(SESSION_INDEX,SESSION_PREFIX+id,MAX_UNIVERSAL_SESSIONS,value);}
function universalSession(id){return validUniversalSession(id)?jsonGet(SESSION_PREFIX+id,null):null;}
function clearRequestRecords(conversationId,provider){
  var ids=jsonGet(REQUEST_INDEX,[]);
  if(!Array.isArray(ids))ids=[];
  var kept=[];
  ids.forEach(function(key){
    var r=jsonGet(key,null);
    if((!conversationId||(r&&r.conversation_id===conversationId))&&
       (!provider||(r&&r.provider===provider)))localStorage.removeItem(key);
    else kept.push(key);
  });
  localStorage.setItem(REQUEST_INDEX,JSON.stringify(kept));
}
function clearProviderHistory(provider){
  var ids=jsonGet(SESSION_INDEX,[]);
  if(!Array.isArray(ids))ids=[];
  var kept=[];
  ids.forEach(function(key){
    var r=jsonGet(key,null);
    if(r&&r.provider===provider)localStorage.removeItem(key);
    else kept.push(key);
  });
  localStorage.setItem(SESSION_INDEX,JSON.stringify(kept));
  clearRequestRecords(null,provider);
}
function clearUniversalHistory(id){
  if(id){
    localStorage.removeItem(SESSION_PREFIX+id);
    localStorage.setItem(SESSION_INDEX,JSON.stringify(jsonGet(SESSION_INDEX,[]).filter(function(k){return k!==SESSION_PREFIX+id;})));
    return;
  }
  jsonGet(SESSION_INDEX,[]).forEach(function(k){localStorage.removeItem(k);});
  localStorage.removeItem(SESSION_INDEX);
}
function sanitizeUsage(usage){
  if(!usage||typeof usage!=='object')return null;
  function safe(n){return typeof n==='number'&&isFinite(n)&&n>=0?Math.floor(n):null;}
  var input=safe(usage.input_tokens!==undefined?usage.input_tokens:usage.prompt_tokens);
  var output=safe(usage.output_tokens!==undefined?usage.output_tokens:usage.completion_tokens);
  var total=safe(usage.total_tokens);
  if(input===null&&output===null&&total===null)return null;
  return {input_tokens:input,output_tokens:output,total_tokens:total};
}
function extractTextBlocks(content){
  if(typeof content==='string')return content;
  if(!Array.isArray(content))return '';
  return content.filter(function(p){return p&&
    (p.type==='text'||p.type==='output_text'||!p.type)&&typeof p.text==='string';
  }).map(function(p){return p.text;}).join('\n');
}
function resultFromResponse(provider,data){
  if(provider==='gemini'){
    var candidate=data&&data.candidates&&data.candidates[0]||{};
    return {text:extractTextBlocks(candidate.content&&candidate.content.parts),
      model:data.modelVersion||null,provider_id:data.responseId||null,
      finish_reason:candidate.finishReason||null,
      usage:sanitizeUsage(data.usageMetadata&&{input_tokens:data.usageMetadata.promptTokenCount,
        output_tokens:data.usageMetadata.candidatesTokenCount,total_tokens:data.usageMetadata.totalTokenCount})};
  }
  if(provider==='openai'){
    var texts=[];
    if(typeof data.output_text==='string')texts.push(data.output_text);
    if(!texts.length&&(data.output||[]).length){
      (data.output||[]).forEach(function(item){if(item&&item.type==='message')texts.push(extractTextBlocks(item.content));});
    }
    return {text:texts.join('\n').trim(),model:data.model||null,provider_id:data.id||null,
      finish_reason:data.status||null,usage:sanitizeUsage(data.usage)};
  }
  if(provider==='anthropic'){
    return {text:extractTextBlocks(data.content),model:data.model||null,provider_id:data.id||null,
      finish_reason:data.stop_reason||null,usage:sanitizeUsage(data.usage)};
  }
  var choice=data&&data.choices&&data.choices[0]||{};
  return {text:extractTextBlocks(choice.message&&choice.message.content),model:data.model||null,
    provider_id:data.id||null,finish_reason:choice.finish_reason||null,usage:sanitizeUsage(data.usage)};
}
function trimUniversalTurns(turns){
  if(!Array.isArray(turns))return [];
  var out=turns.filter(function(t){return t&&(t.role==='user'||t.role==='assistant')&&
    typeof t.content==='string'&&t.content.length<=4000;}).slice(-6);
  while(JSON.stringify(out).length>8500)out.shift();
  return out;
}
function requestFor(provider,model,system,turns){
  var headers={'Content-Type':'application/json'},url,body;
  if(provider==='gemini'){
    url='https://generativelanguage.googleapis.com/v1beta/models/'+encodeURIComponent(model)+':generateContent';
    var contents=turns.map(function(t){return {role:t.role==='assistant'?'model':'user',parts:[{text:t.content}]};});
    body={system_instruction:{parts:[{text:system}]},contents:contents,generationConfig:{maxOutputTokens:650}};
  }else if(provider==='openai'){
    url='https://api.openai.com/v1/responses';
    body={model:model,store:false,max_output_tokens:800,
      instructions:system,input:turns.map(function(t){return {role:t.role,content:t.content};})};
  }else if(provider==='anthropic'){
    url='https://api.anthropic.com/v1/messages';
    body={model:model,max_tokens:800,system:system,messages:turns};
    headers['anthropic-version']='2023-06-01';
    headers['anthropic-dangerous-direct-browser-access']='true';
  }else{
    url=provider==='xai'?'https://api.x.ai/v1/chat/completions':
      provider==='openrouter'?'https://openrouter.ai/api/v1/chat/completions':
      'https://api.deepseek.com/chat/completions';
    body={model:model,max_tokens:800,messages:[{role:'system',content:system}].concat(turns)};
  }
  return {url:url,body:body,headers:headers};
}
function statusCode(code){
  if(code===401||code===403)return 'AUTH_REQUIRED';
  if(code===429)return 'RATE_LIMITED';
  if(code===400||code===404||code===422)return 'INVALID_ARGS';
  return 'PLUGIN_UNAVAILABLE';
}
function sameRequest(r,args,p,model){
  return r.text===args.text&&r.provider===p&&r.model===model&&
    (r.requested_conversation_id||null)===(args.conversation_id||null)&&
    (r.instructions||'')===(args.instructions||'');
}
async function sendUniversal(args){
  args=args||{};
  var p=currentProvider(),model=selectedModel(p);
  if(typeof args.text!=='string'||!args.text.trim()||args.text.length>16000)
    return fail('INVALID_ARGS','Provide 1-16000 characters of text.');
  if(args.instructions!==undefined&&(typeof args.instructions!=='string'||args.instructions.length>1000))
    return fail('INVALID_ARGS','Instructions must be at most 1000 characters.');
  var id=args.request_id||freshMessageId();
  if(!validRequestId(id))return fail('INVALID_ARGS','Invalid request_id.');
  var old=requestRecord(id);
  if(old){
    if(!sameRequest(old,args,p,model))
      return fail('INVALID_ARGS','request_id already used for another message or provider.');
    if(old.result)return {ok:true,data:old.result};
    return fail('DELIVERY_UNCERTAIN','Request already submitted; check get_message. No automatic retry.');
  }
  var conversationId=args.conversation_id||universalSessionId();
  if(!validUniversalSession(conversationId))return fail('INVALID_ARGS','Invalid conversation_id for universal protocol.');
  var session=universalSession(conversationId);
  if(session&&(session.provider!==p||session.model!==model))
    return fail('INVALID_ARGS','Conversation belongs to another provider/model; start a new conversation.');
  var token=await Pebble.secureStorage.getItem(keyId(p));
  if(!token)return fail('AUTH_REQUIRED','Configure the selected AI provider in plugin settings.');
  // A second check closes the race during the asynchronous key lookup.
  var concurrent=requestRecord(id);
  if(concurrent){
    if(!sameRequest(concurrent,args,p,model))
      return fail('INVALID_ARGS','request_id already used for different message, session or instructions.');
    if(concurrent.result)return {ok:true,data:concurrent.result};
    return fail('DELIVERY_UNCERTAIN','Request already submitted; check get_message. No automatic retry.');
  }
  var started=Date.now(),requestedAt=isoNow();
  var system='You are a helpful smartwatch assistant. Reply concisely in plain text without markdown.';
  if(args.instructions)system+='\n'+args.instructions;
  var turns=trimUniversalTurns(session&&session.turns||[]).concat([{role:'user',content:args.text}]);
  saveRequest(id,{text:args.text,provider:p,model:model,conversation_id:conversationId,
    requested_conversation_id:args.conversation_id||null,instructions:args.instructions||'',
    requested_at:requestedAt,status:'pending'});
  var outbound=requestFor(p,model,system,turns);
  if(p==='gemini')outbound.headers['x-goog-api-key']=token;
  else if(p==='anthropic')outbound.headers['x-api-key']=token;
  else outbound.headers.Authorization='Bearer '+token;
  try{
    var response=await fetch(outbound.url,{method:'POST',headers:outbound.headers,body:JSON.stringify(outbound.body)});
    if(!response.ok){
      var code=statusCode(response.status);
      var rejected={text:args.text,provider:p,model:model,status:'failed',conversation_id:conversationId,
        requested_at:requestedAt,http_status:response.status,error_code:code};
      saveRequest(id,rejected);
      return fail(code,PROVIDERS[p].label+' API HTTP '+response.status);
    }
    var data=await response.json();
    var parsed=resultFromResponse(p,data);
    if(!parsed.text||!parsed.text.trim()){
      saveRequest(id,{text:args.text,provider:p,model:model,status:'failed',conversation_id:conversationId,requested_at:requestedAt,error_code:'EMPTY_RESPONSE'});
      return fail('PLUGIN_UNAVAILABLE','The selected AI API returned no readable text.');
    }
    var originalText=parsed.text.trim(),answer=originalText.slice(0,4000),finished=isoNow();
    var full=String(parsed.finish_reason||'').toLowerCase();
    var isIncomplete=originalText.length>4000||full==='length'||full==='max_tokens'||
      full==='incomplete'||full==='max_output_tokens';
    var result={schema_version:1,request_id:id,message_id:freshMessageId(),conversation_id:conversationId,
      status:isIncomplete?'incomplete':'completed',received:true,
      provider:p,provider_name:PROVIDERS[p].label,model:parsed.model||model,
      text:answer,response:{role:'assistant',text:answer},requested_at:requestedAt,
      received_at:finished,completed_at:finished,latency_ms:Math.max(0,Date.now()-started),
      provider_response_id:parsed.provider_id,finish_reason:parsed.finish_reason,
      usage:parsed.usage,validation:{provider_http_ok:true,reply_text_present:true,
        request_id_unique:true,output_complete:!isIncomplete}};
    saveRequest(id,{text:args.text,provider:p,model:model,status:result.status,result:result});
    saveUniversalSession(conversationId,{provider:p,model:model,
      turns:trimUniversalTurns(turns.concat([{role:'assistant',content:answer}]))});
    return {ok:true,data:result};
  }catch(e){
    saveRequest(id,{text:args.text,provider:p,model:model,status:'uncertain',conversation_id:conversationId,
      requested_at:requestedAt,error_code:'DELIVERY_UNCERTAIN'});
    return fail('DELIVERY_UNCERTAIN','Provider request interrupted. Do not retry automatically with a new request ID.');
  }
}
function getMessage(args){
  if(!validRequestId(args.request_id))return fail('INVALID_ARGS','Provide a valid request_id.');
  var r=requestRecord(args.request_id);
  if(!r)return fail('INVALID_ARGS','Unknown request_id.');
  if(r.result)return {ok:true,data:r.result};
  // Pebble plugin calls have a bounded action lifetime. A stale pending
  // request is NOT proof of an in-flight job; its delivery is uncertain.
  if(r.status==='pending'&&r.requested_at&&Date.now()-Date.parse(r.requested_at)>22000){
    r.status='uncertain';r.error_code='DELIVERY_UNCERTAIN';
    saveRequest(args.request_id,r);
  }
  return {ok:true,data:{schema_version:1,request_id:args.request_id,
    status:r.status,provider:r.provider,model:r.model,requested_at:r.requested_at,
    conversation_id:r.conversation_id||null,error_code:r.error_code||null,received:false}};
}
// Core Devices agent action compatibility:
// send_to_agent({message,chat_id?}) => native Pebble respond.ok({text,...}).
// The destination app must still be permitted to invoke THIS plugin UUID.
var DEFAULT_AGENT_SESSION_KEY='ai_agent_default_session_v1_';
function defaultSessionKey(provider,model){return DEFAULT_AGENT_SESSION_KEY+provider+'_'+model;}
function resolveAgentSession(args){
  var provider=currentProvider(),model=selectedModel(provider);
  var chat=args.chat_id;
  if(chat!==undefined&&chat!==null&&typeof chat!=='string')
    return fail('INVALID_ARGS','chat_id must be a string or null.');
  if(chat==='new'||chat==='new-chat')return {ok:true,id:universalSessionId()};
  if(chat&&chat!=='default'){
    if(!validUniversalSession(chat))return fail('INVALID_ARGS','Unknown chat_id. Use a listed agent/chats instanceId, default or new.');
    if(!universalSession(chat))return fail('INVALID_ARGS','Unknown or expired chat_id. Use the default conversation or new.');
    return {ok:true,id:chat};
  }
  var key=defaultSessionKey(provider,model),id=localStorage.getItem(key);
  if(!validUniversalSession(id)||!universalSession(id)){
    id=universalSessionId();
    localStorage.setItem(key,id);
  }
  return {ok:true,id:id};
}
async function sendToAgent(args){
  if(typeof args.message!=='string'||!args.message.trim()||args.message.length>16000)
    return fail('INVALID_ARGS','message must contain 1-16000 characters.');
  var session=resolveAgentSession(args);
  if(!session.ok)return session;
  var result=await sendUniversal({text:args.message,conversation_id:session.id});
  if(!result.ok)return result;
  var full=result.data;
  // Native response shape matches Core Devices agents' {text} payload.
  // Additional fields identify an actual model answer, not merely a receipt.
  return {ok:true,data:{text:full.text,chat_id:full.conversation_id,
    conversation_id:full.conversation_id,message_id:full.message_id,
    request_id:full.request_id,provider:full.provider,model:full.model,
    status:full.status,received:full.received,
    requested_at:full.requested_at,received_at:full.received_at,
    provider_response_id:full.provider_response_id,
    validation:full.validation,reply_type:'assistant'}};
}
function agentChats(){
  var provider=currentProvider(),model=selectedModel(provider);
  var key=defaultSessionKey(provider,model),id=localStorage.getItem(key);
  var rows=[{instanceId:'default',properties:{
    name:{shortText:{text:'Default conversation'}},
    title:{shortText:{text:PROVIDERS[provider].label+' · '+model}}
  }}];
  var seen={};
  if(validUniversalSession(id)&&universalSession(id))seen[id]=true;
  var ids=jsonGet(SESSION_INDEX,[]);
  if(!Array.isArray(ids))ids=[];
  ids.slice().reverse().forEach(function(key){
    var sid=key.slice(SESSION_PREFIX.length),record=universalSession(sid);
    if(!record||record.provider!==provider||record.model!==model||seen[sid])return;
    seen[sid]=true;
    rows.push({instanceId:sid,properties:{name:{shortText:{text:'Conversation '+sid.slice(-6)}},
      title:{shortText:{text:PROVIDERS[provider].label+' · '+model}}}});
  });
  return rows;
}

Pebble.registerSourceHandler(async function(request,respond){
  if(request.category&&request.category!=='agent'){respond.error('INVALID_REQUEST','Unsupported agent category');return;}
  if(request.item==='chats'){
    respond.data({validUntilMs:Date.now()+60000,instances:agentChats()});return;
  }
  if(request.item!=='configured'){respond.error('INVALID_REQUEST','Unknown agent source');return;}
  var publicSettings=await publicConfig();
  respond.data({validUntilMs:Date.now()+120000,instances:[{
    instanceId:'ai-conversation',properties:{
      name:{shortText:{text:publicSettings.provider_name+' Conversation'}},
      configured:{boolean:{value:publicSettings.configured},shortText:{text:publicSettings.configured?'Connected':'Configure API key'}}
    }
  }]});
});
Pebble.registerActionHandler(async function(request,respond){
  var args=request.args||{},r;
  switch(request.action){
    case 'get_config':
      r={ok:true,data:await publicConfig()};
      break;
    case 'list_models':r=await listModels();break;
    case 'conversation':r=await conversation(args);break; // Legacy Gemini contract.
    case 'send_to_agent':r=await sendToAgent(args);break;
    case 'send_message':r=await sendUniversal(args);break;
    case 'get_message':r=getMessage(args);break;
    case 'get_capabilities':r={ok:true,data:await publicConfig()};break;
    case 'clear_conversation':
    case 'clear_ai_conversation':
      if(args.all===true){clearAll();clearUniversalHistory();clearRequestRecords();r={ok:true,data:{cleared:'all'}};}
      else if(validId(args.conversation_id)){clearSession(args.conversation_id);r={ok:true,data:{cleared:args.conversation_id}};}
      else if(validUniversalSession(args.conversation_id)){clearUniversalHistory(args.conversation_id);clearRequestRecords(args.conversation_id);r={ok:true,data:{cleared:args.conversation_id}};}
      else r=fail('INVALID_ARGS','Provide conversation_id or all=true.');
      break;
    default:respond.error('INVALID_REQUEST','Unknown action');return;
  }
  if(!r.ok){respond.error(r.code,r.message);return;}
  if(request.action==='send_to_agent'){respond.ok(r.data);return;}
  respond.ok({text:JSON.stringify(r.data).slice(0,18000)});
});
Pebble.registerConfigHandler(async function(message,respond){
  var m=message||{};
  if(m.type==='status'){
    respond(Object.assign({ok:true},await publicConfig()));return;
  }
  if(m.type==='models'){
    var listed=await listModels(m.api_key);
    if(!listed.ok){respond({ok:false,error:listed.message});return;}
    respond({ok:true,models:listed.data.models,checkedAt:listed.data.checkedAt,
      fromCache:listed.data.fromCache===true,hasMore:listed.data.hasMore===true});return;
  }
  if(m.type==='save'&&m.provider&&m.provider!=='gemini'){
    if(!PROVIDERS[m.provider]){respond({ok:false,error:'Unknown provider.'});return;}
    if(!validGenericModel(m.model)){respond({ok:false,error:'Enter a valid model ID.'});return;}
    var chosenKey=keyId(m.provider),newKey=typeof m.api_key==='string'?m.api_key.trim():'';
    if(newKey)await Pebble.secureStorage.setItem(chosenKey,newKey);
    if(!(await Pebble.secureStorage.getItem(chosenKey))){respond({ok:false,error:'Provide an API key for '+m.provider});return;}
    var models=configuredModels();models[m.provider]=m.model;
    localStorage.setItem(MODELS_KEY,JSON.stringify(models));
    localStorage.setItem(PROVIDER_KEY,m.provider);
    Pebble.refreshSources(['agent/configured']);
    respond(Object.assign({ok:true},await publicConfig()));return;
  }
  if(m.type==='save'){
    var model=modelName(m.model);
    if(!model){respond({ok:false,error:'Invalid Gemini model name.'});return;}
    var key=typeof m.api_key==='string'?m.api_key.trim():'';
    if(key)await Pebble.secureStorage.setItem(KEY,key);
    if(!(await Pebble.secureStorage.getItem(KEY))){
      respond({ok:false,error:'Enter a Gemini API key.'});return;
    }
    // The model is selected by the plugin settings page, not by the calling watch app.
    localStorage.setItem(MODEL,model);
    localStorage.setItem(PROVIDER_KEY,'gemini');
    Pebble.refreshSources(['agent/configured']);
    respond(Object.assign({ok:true},await publicConfig()));return;
  }
  if(m.type==='forget'&&m.provider&&m.provider!=='gemini'){
    if(!PROVIDERS[m.provider]){respond({ok:false,error:'Unknown provider.'});return;}
    await Pebble.secureStorage.removeItem(keyId(m.provider));
    clearProviderHistory(m.provider);
    Pebble.refreshSources(['agent/configured','agent/chats']);
    respond({ok:true,provider:m.provider});return;
  }
  if(m.type==='forget'){
    await Pebble.secureStorage.removeItem(KEY);
    localStorage.removeItem(MODEL);
    localStorage.removeItem(CATALOG_KEY);
    clearAll();clearProviderHistory('gemini');
    Pebble.refreshSources(['agent/configured','agent/chats']);
    respond({ok:true});return;
  }
  if(m.type==='clear_history'){clearAll();clearUniversalHistory();clearRequestRecords();Pebble.refreshSources(['agent/chats']);respond({ok:true});return;}
  respond({ok:false,error:'Unknown configuration request.'});
});
