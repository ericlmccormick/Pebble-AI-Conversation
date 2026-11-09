/* Universal AI conversation SDK v1 for PebbleKit JS.
 * MIT-style reusable helper; copy into an app's src/pkjs and require it.
 * No credentials/provider/model are needed in the consuming app.
 * The host's Pebble.invokeAction enforces user grants before requests.
 */
'use strict';
var PLUGIN_UUID='2c5edc42-b096-4f76-b284-1f27907e6501';
var counter=0;
function requestId(){
  counter=(counter+1)%1000000;
  return 'watch_'+Date.now().toString(36)+'_'+counter.toString(36)+'_'+Math.floor(Math.random()*16777216).toString(36);
}
function decode(reply,label){
  if(!reply||reply.ok!==true){
    var err=new Error((reply&&reply.message)||label+' plugin call failed');
    err.code=reply&&reply.code||'PLUGIN_UNAVAILABLE';throw err;
  }
  var data;
  try{data=JSON.parse(reply.text||'{}');}
  catch(e){var parseError=Error(label+' returned invalid JSON');parseError.code='INVALID_RESPONSE';throw parseError;}
  return data;
}
function validMessage(data){
  return !!(data&&data.schema_version===1&&
    /^[a-zA-Z0-9_-]{8,72}$/.test(data.request_id||'')&&
    typeof data.message_id==='string'&&
    typeof data.conversation_id==='string'&&
    typeof data.provider==='string'&&
    typeof data.model==='string'&&
    typeof data.text==='string'&&data.text.length>0&&
    data.response&&data.response.role==='assistant'&&data.response.text===data.text&&
    data.received===true&&
    typeof data.requested_at==='string'&&typeof data.received_at==='string'&&
    !isNaN(Date.parse(data.requested_at))&&!isNaN(Date.parse(data.received_at))&&
    data.validation&&data.validation.provider_http_ok===true&&
    data.validation.reply_text_present===true&&
    (data.status==='completed'||data.status==='incomplete'));
}
function create(Pebble,options){
  options=options||{};
  var uuid=options.pluginId||PLUGIN_UUID;
  function invoke(action,args){
    if(!Pebble||typeof Pebble.invokeAction!=='function')
      return Promise.reject(Error('Install a plugin-capable Pebble phone app.'));
    return Pebble.invokeAction({plugin:uuid,action:action,args:args||{}}).then(function(r){
      return decode(r,action);
    });
  }
  function send(text,opts){
    opts=opts||{};
    var id=opts.request_id||requestId();
    if(typeof text!=='string'||!text.trim())return Promise.reject(Error('Message cannot be blank'));
    var args={text:text,request_id:id};
    if(opts.conversation_id)args.conversation_id=opts.conversation_id;
    if(opts.instructions)args.instructions=opts.instructions;
    return invoke('send_message',args).then(function(data){
      if(!validMessage(data)||data.request_id!==id){
        var error=Error('AI plugin returned invalid or mismatched response metadata');
        error.code='INVALID_RESPONSE';throw error;
      }
      return data;
    });
  }
  function getMessage(id){return invoke('get_message',{request_id:id});}
  function getCapabilities(){return invoke('get_capabilities',{});}
  function clearConversation(id){return invoke('clear_ai_conversation',id?{conversation_id:id}:{all:true});}
  return {send:send,getMessage:getMessage,getCapabilities:getCapabilities,
    clearConversation:clearConversation,requestId:requestId,validate:validMessage,
    pluginId:uuid};
}
module.exports={create:create,requestId:requestId,validate:validMessage,PLUGIN_UUID:PLUGIN_UUID};
