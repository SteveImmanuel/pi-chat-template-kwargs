# pi-chat-template-kwargs

A [pi](https://github.com/earendil-works/pi) extension to override the `chat_template_kwargs` request-body field on the fly, mid-session, without editing model config or restarting. 

Useful for self-hosted inference servers such as llama.cpp, vLLM, SGLang, to override chat-template variables like `reasoning_strength`, `enable_thinking`, etc.

> [!NOTE]
> Only applies to models using the `openai-completions` (includes `llama.cpp`) API. Other providers are left untouched.

## Install

```bash
pi install git:github.com/SteveImmanuel/pi-chat-template-kwargs
```

## Usage

Run `/ctk` to open a selector listing your saved overrides along with three actions.

- `off` stops overriding
- `create a new one` prompts for kwargs as JSON (validated), asks for confirmation, then saves
- `delete an existing one` lets you pick a saved override and remove it


The selected override is merged into `chat_template_kwargs` of every subsequent LLM request for the session. The active override is shown in the footer and marked `(selected)` in the picker.

## How it works

The extension intercepts pi's `before_provider_request` hook, which fires right before each request is sent to the provider, and modifies the payload there. The active override is applied last and merged key by key into whatever `chat_template_kwargs` the payload already carries, so it updates matching keys and adds new ones rather than fully replacing the object.

Overrides are stored in `~/.pi/agent/chat-template-kwargs.json` as a JSON array of kwargs objects.

```json
[
	{ "reasoning_strength": "low" },
	{ "enable_thinking": false }
]
```

## License

MIT
