'use strict';
const assert=require('node:assert/strict'),lib=require('../sdk/ai_conversation');
let last=null;
const Pebble={invokeAction:async opts=>{
 last=opts;
 if(opts.action==='get_capabilities')return{ok:true,text:JSON.stringify({schema_version:1,provider:'openai',model:'gpt-5-mini',configured:true})};
 if(opts.action==='send_message')return{ok:true,text:JSON.stringify({
   schema_version:1,request_id:opts.args.request_id,message_id:'m0123456',
   conversation_id:'s0123456',status:'completed',received:true,
   provider:'openai',model:'gpt-5-mini',text:'Hello back',
   response:{role:'assistant',text:'Hello back'},
   requested_at:'2026-11-08T14:00:00Z',received_at:'2026-11-08T14:00:01Z',
   validation:{provider_http_ok:true,reply_text_present:true}
 })};
 return{ok:true,text:'{}'};
}};
const api=lib.create(Pebble);
(async()=>{
 const config=await api.getCapabilities();assert.equal(config.provider,'openai');
 const reply=await api.send('Hello',{request_id:'watch_request001',instructions:'Be concise'});
 assert.equal(reply.text,'Hello back');
 assert.equal(reply.status,'completed');
 assert.equal(last.action,'send_message');
 assert.equal(last.args.request_id,'watch_request001');
  await api.clearConversation(reply.conversation_id);
  assert.equal(last.action,'clear_ai_conversation');
 assert.equal('provider' in last.args,false);
 assert.equal('model' in last.args,false);
 assert.equal('api_key' in last.args,false);
 assert.ok(api.validate(reply));
 assert.equal(api.validate({...reply,received:false}),false);
 assert.equal(api.validate({...reply,response:{role:'assistant',text:'Different'}}),false);
 const bad=lib.create({invokeAction:async o=>({ok:true,text:JSON.stringify({...reply,request_id:'wrong_request001'})})});
 await assert.rejects(bad.send('Hi',{request_id:'watch_request001'}),/mismatched/);
 console.log('PASS: reusable SDK validates end-to-end normalized messages and keeps provider selection private');
})().catch(e=>{console.error(e);process.exitCode=1;});
