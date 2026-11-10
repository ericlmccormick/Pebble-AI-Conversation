# Universal AI — Pebble Plugin

**Universal AI v0.1.1** is a provider-neutral AI agent plugin for Pebble phone apps, providing a unified text-in / full-reply-out interface across seven AI providers. Store category: **agent**. Plugin UUID: `2c5edc42-b096-4f76-b284-1f27907e6501`.

## Supported providers
- Google Gemini: native `generateContent`.
- OpenAI: official Responses API, with `store:false`.
- Anthropic Claude: official Messages API.
- xAI Grok: Chat Completions-compatible API.
- OpenRouter: Chat Completions-compatible API for many routed models.
- DeepSeek: Chat Completions-compatible API.
- **Meta Muse**: official Meta Model API Chat Completions, defaulting to Muse Spark 1.3; also offers Spark 1.2, Spark 1.1, and Muse Wonder 1.0.

Each provider has its **own secure API key and model selection** in plugin settings. App developers never need to know or configure the selected provider, model, endpoint or credential.

These are official API endpoints; consumer ChatGPT Plus, Google AI Pro, Claude subscriptions and other accounts do not automatically include API usage. This plugin is not a wrapper around the existing send-only ChatGPT/Muse/Claude Pebble plugins. **Meta Muse here means direct access to Meta's Model API**, not the separate Pebble Muse agent/plugin; their notification and conversation histories are not shared.

Meta Muse uses `https://api.meta.ai/v1/chat/completions` with its own Model API key in Pebble secure storage. The default `muse-spark-1.3` uses **Standard mode**, which Meta says does not use submitted prompts or responses for model training. Contributor model variants are not in the preset list: they may allow training, and entering one manually triggers an explicit confirmation in the settings page. See [Meta's authentication guide](https://dev.meta.ai/docs/authentication), [Muse models](https://dev.meta.ai/docs/muse-spark), and [pricing and data-use terms](https://dev.meta.ai/docs/pricing-rate-limits).

## Research and common design findings

| Pebble repository | Implementation detail adopted |
|---|---|
| [huntboom/PebbleAI](https://github.com/huntboom/PebbleAI) | Provider-specific request adapters and configurable model/key; implement once in the plugin instead of every app |
| [deusaw/Pebble-Wrist-AI](https://github.com/deusaw/Pebble-Wrist-AI) | OpenRouter, multiple conversation histories, and flexible model selection |
| [breitburg/claude-for-pebble](https://github.com/breitburg/claude-for-pebble) | Conversation role history, response text extraction, and finish/error handling |
| [shiorixbot/pebble-agent](https://github.com/shiorixbot/pebble-agent) | OpenAI Responses-style request/response patterns, including OpenResponses-compatible gateways |
| [javierorp/pebble-aimigo](https://github.com/javierorp/pebble-aimigo) | OpenAI-compatible chat API patterns and independent TTS |
| [coredevices/pebble-apps](https://github.com/coredevices/pebble-apps) | Plugin action permission manifest, phone-side settings, and discoverable `agent/configured` source |

We did **not** copy third-party code. Contracts are adapted for Pebble plugin action calls and a strict phone-side session boundary. Streaming audio is deliberately left to the independent [Universal TTS plugin](https://github.com/ericlmccormick/Pebble-Universal-TTS).

**Developer SDK:** [Integration guide and reusable JavaScript client](sdk/README.md).

## Recommended contract v1

Add these permissions to the consuming Pebble app:

```json
[
  {"name":"AIConverse","plugin":"2c5edc42-b096-4f76-b284-1f27907e6501"},
  {"name":"AIRead","plugin":"2c5edc42-b096-4f76-b284-1f27907e6501"},
  {"name":"InvokeAction","plugin":"2c5edc42-b096-4f76-b284-1f27907e6501"}
]
```

### 1. Discover configuration

Call `get_capabilities({})`. The response is JSON in `result.text`:

```json
{
  "schema_version": 1,
  "provider": "openai",
  "provider_name": "OpenAI",
  "model": "gpt-5-mini",
  "configured": true,
  "returns_full_reply": true,
  "tts": false
}
```

The full response also includes `providers`, `models`, and `configured_providers` (boolean status only, never API keys). Apps should treat `provider` and `model` as **informational**. The plugin selects them and dispatches to the corresponding endpoint.

### 2. Send a message

```javascript
var result = await Pebble.invokeAction({
  plugin: '2c5edc42-b096-4f76-b284-1f27907e6501',
  action: 'send_message',
  args: {
    text: 'Tell me about tomorrow.',
    request_id: 'watch_1730000000_001',
    // conversation_id: optional, from previous response
    instructions: 'Give a short spoken answer.'
  }
});
if (!result.ok) throw Error(result.message);
var data = JSON.parse(result.text);
if (data.schema_version === 1 && data.received &&
    (data.status === 'completed' || data.status === 'incomplete') &&
    data.validation.reply_text_present) {
  // Display or speak data.text; do NOT speak a receipt or provider error.
}
```

Example response:

```json
{
  "schema_version": 1,
  "request_id": "watch_1730000000_001",
  "message_id": "mabc123",
  "conversation_id": "sabc123",
  "status": "completed",
  "received": true,
  "provider": "openai",
  "provider_name": "OpenAI",
  "model": "gpt-5-mini",
  "text": "Here is the answer.",
  "response": {"role": "assistant", "text": "Here is the answer."},
  "requested_at": "2026-11-08T14:00:00.000Z",
  "received_at": "2026-11-08T14:00:01.000Z",
  "completed_at": "2026-11-08T14:00:01.000Z",
  "latency_ms": 1000,
  "provider_response_id": "resp_123",
  "finish_reason": "completed",
  "usage": {"input_tokens": 25, "output_tokens": 8, "total_tokens": 33},
  "validation": {
    "provider_http_ok": true,
    "reply_text_present": true,
    "request_id_unique": true,
    "output_complete": true
  }
}
```

Request ID, message ID and timestamps are generated/validated locally. **The provider does not echo or attest to the local request ID.** `provider_http_ok` says an HTTP response succeeded, **not** that downstream playback or user receipt was confirmed. `provider_response_id` can be null when the provider does not supply one. Finish reason may differ by provider.

- `status=completed`: nonempty answer received, provider did not report truncation.
- `status=incomplete`: readable answer received but provider reported length/output limit.
- `status=pending`: request started; do not assume the upstream provider got it.
- `status=uncertain`: network request failed without verifying whether the provider processed it. **Do not automatically retry.**
- `status=failed`: provider returned an explicit HTTP error or no readable answer.

### 3. Check a request without resending

`get_message({request_id})` returns the cached full reply, if completed, or just its state if not. Only `send_message` sends to a provider. Request IDs are retained on the phone in a bounded cache; they are **not durable delivery guarantees** across uninstall, device loss, cache eviction or interrupted storage.

### 4. Continue a conversation

Pass back the `conversation_id` on the next `send_message`. The plugin keeps at most three user/assistant turns per session and 12 sessions, and rejects attempts to continue a session with a different provider or model. Avoid putting tokens, secrets or personal identifiers into a request ID.

## Standard Core Devices agent integration

Apps built for Core Devices' Grok Bot, Claude, Muse, and ChatGPT agent plugins use the public action `send_to_agent({message,chat_id?})` and discover conversations through `agent/chats`, plus setup status through `agent/configured`. Universal AI exposes the **same action name, argument names, and native Pebble action response shape**. Its `respond.ok({text,...})` gives the **full assistant text** rather than a receipt, with additional `reply_type:'assistant'`, status, IDs, timestamps, and validation metadata. Existing send-only plugins may return only `{text:'Message submitted...'}`; consumers must not assume every agent returns a full answer.

`chat_id` omitted or `'default'` uses a persistent default conversation for the selected provider/model, `'new'`/`'new-chat'` starts a fresh conversation, and `agent/chats` lists current session IDs. Provider or model changes cannot accidentally reuse another provider's history.

**Important limitation:** Pebble `InvokeAction` permissions and target UUIDs are still enforced by the host. An app hard-coded to Grok's UUID cannot magically invoke this plugin without its UUID being selectable and permitted. Apps already using installed-agent discovery can swap to this plugin without changing their send payload/parser. Apps pinned to one UUID must add this plugin permission and/or dynamic selection. This is host-level security, not an API incompatibility.

For new integrations, use `send_to_agent` or `send_message`. The original Gemini-specific `conversation` interface is also available for direct Gemini experiments; it isn't required by the universal API. The SDK uses `clear_ai_conversation` with `AIConverse`. Clearing history also clears stored replies, and forgetting one provider only clears that provider's data.

## Security / deployment
Credentials are stored in `Pebble.secureStorage` separately per provider; `get_capabilities` reveals only booleans and model names. Provider domains are restricted in the plugin manifest. Session history and recent request records are stored only on the paired phone. There is no retry after uncertain delivery. Provider-specific usage billing applies.

API protocol details were researched against vendor documentation. Access to a provider/model may depend on account permissions and API changes. Automated tests mock provider API responses, verify Muse routing, key isolation, model selection, reply parsing and session continuity; an **authenticated live Meta API call still requires a developer-provided Model API key**. Hardware and live account tests are recommended.

## Reusable PebbleKit JS SDK
Copy [sdk/ai_conversation.js](sdk/ai_conversation.js) into the consuming app's `src/pkjs`. Its `create(Pebble).send(text,{conversation_id?,request_id?,instructions?})` calls `send_message`, checks that the request ID matches, verifies the schema/receipt timestamps and returns the normalized response. The helper never exposes provider credentials, constructs a model name, or decides which API endpoint to use. The provider-specific decisions live entirely inside the plugin. A lightweight test is in `tests/sdk.test.cjs`.

## Publishing assets

The plugin-only PBW is installable on the **phone**, not a watchapp with a watch launcher.
Its category is `agent` (derived from both manifest `plugin.sources`).
Version is `0.1.1`; its UUID is unchanged.

The release workflow renders icon artwork from `store-assets/universal-ai-icon.svg`
and the binary 25-pixel mask in `store-assets/universal-ai-menu-25.svg`.
Pebble App Store listing icons are uploaded **separately** from the plugin PBW:

- [Universal AI v0.1.1 PBW](https://raw.githubusercontent.com/ericlmccormick/Pebble-Universal-AI/builds/previews/Universal_AI_plugin.pbw)
- [144×144 store icon](https://raw.githubusercontent.com/ericlmccormick/Pebble-Universal-AI/builds/previews/Universal_AI_144x144.png)
- [80×80 store icon](https://raw.githubusercontent.com/ericlmccormick/Pebble-Universal-AI/builds/previews/Universal_AI_80x80.png)
- [25×25 transparent monochrome menu icon](https://raw.githubusercontent.com/ericlmccormick/Pebble-Universal-AI/builds/previews/Universal_AI_25x25_menu.png) (for future watchapp consumers; a plugin-only project has no watch launcher).

All generated icons are validated for their exact dimensions in GitHub Actions.
