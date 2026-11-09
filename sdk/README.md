# Universal AI — consuming-app SDK

This is the reusable phone-side SDK for **Universal AI v0.1.0**. The plugin's UUID is `2c5edc42-b096-4f76-b284-1f27907e6501`. This library does **not** contain provider credentials or models.

## Installation

Copy [ai_conversation.js](ai_conversation.js) to `src/pkjs/ai_conversation.js` in your watch app. Install and configure the Universal AI plugin separately on the paired phone.

Merge the permissions below into the app's `pebble.usesPermissions` in `package.json`, preserving unrelated permissions:

```json
[
  {"name":"AIConverse","plugin":"2c5edc42-b096-4f76-b284-1f27907e6501"},
  {"name":"AIRead","plugin":"2c5edc42-b096-4f76-b284-1f27907e6501"},
  {"name":"InvokeAction","plugin":"2c5edc42-b096-4f76-b284-1f27907e6501"}
]
```

## Usage

```javascript
var ai = require('./ai_conversation').create(Pebble);

ai.getCapabilities().then(function(info) {
  console.log('Configured: ' + info.configured);
});

ai.send('What is the weather like?', {
  instructions: 'Reply concisely.'
}).then(function(reply) {
  // Only display actual validated assistant text.
  if (reply.status === 'completed' || reply.status === 'incomplete') {
    console.log(reply.text);
    // Preserve reply.conversation_id for later turns.
  }
}).catch(function(error) {
  console.log('AI request failed: ' + error.message);
});
```

The returned client methods are `send(text, options)`, `getMessage(requestId)`, `getCapabilities()`, `clearConversation(conversationId?)`, `requestId()`, and `validate(data)`. `send` creates a request ID unless one was supplied; successful replies are checked for the expected request ID, conversation metadata, assistant text and validation flags.

Continue an existing conversation with `ai.send(text, {conversation_id: prior.conversation_id})`. Never interpret a send receipt, pending status or provider network error as the assistant's reply. Avoid automatic resend after an uncertain network failure; use `getMessage(requestId)` to inspect known requests. Reply-cache state is not a durable delivery guarantee.

## Boundaries

The Universal AI plugin calls the configured text provider. It does not speak or stream audio. For speech, use the independent [Universal TTS SDK](https://github.com/ericlmccormick/Pebble-Universal-TTS/tree/main/sdk) and compatible watch speaker hardware. The app must handle watch-to-phone AppMessage requests and display/voice UI itself. Plugin permissions are enforced by the Pebble host.

## Verification and support

SDK-specific tests: [tests/sdk.test.cjs](../tests/sdk.test.cjs). For bugs include plugin version, app version, action name, redacted error and anonymized result metadata. Do not post API keys, private prompts or conversation history.

https://ko-fi.com/ericmccormick
