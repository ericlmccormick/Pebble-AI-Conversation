# Changelog

## 0.1.1 — Meta Muse support

- Added **Meta Muse** as a seventh Universal AI provider using Meta Model API's Chat Completions endpoint.
- Defaulted to **Muse Spark 1.3**, with Spark 1.2, Spark 1.1 and Muse Wonder 1.0 available in the model picker.
- Added `api.meta.ai` to the Internet allowlist; each provider retains its own independently stored API key.
- Reused the existing complete-text response, request-ID, conversation history and agent integration behaviors.
- Added clear Standard/Contributor mode guidance in the settings; Contributor models are not presets, and selecting one by custom ID requires confirmation.
- Added automated Meta request/response, authentication, session continuation, permission, and provider isolation regression tests.
- Updated publishing metadata to version **0.1.1**, category `agent`.

Note: Automated API tests use simulated provider responses. A live account test requires a Meta Model API key and enabled billing.

## 0.1.0 — Initial Universal AI release candidate

- Six AI providers: Google Gemini, OpenAI, Anthropic Claude, xAI Grok, OpenRouter, and DeepSeek.
- Standard Pebble agent action and source interface, extended request/reply API, phone-side settings and secure key storage.
- Direct-download PBW plus store icon resources.
