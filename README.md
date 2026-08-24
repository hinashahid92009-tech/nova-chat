# ✦ Nova Chat

A ChatGPT-style web interface built with **plain HTML, CSS, and JavaScript** — no frameworks, no build step, no dependencies. Powered by the **free [Pollinations.ai](https://pollinations.ai) API** (OpenAI-compatible, no API key required), with an offline fallback mode.

## Features

- 🤖 **Real AI chat** — free LLM API via Pollinations.ai, no signup or key needed
- ⚡ **True streaming** — server-sent events rendered token by token
- 🗂️ **Chat management** — create, rename, delete, and auto-titled conversations
- 🌓 **Dark & light themes** — toggleable, persisted across sessions
- 💾 **Persistence** — all chats saved to `localStorage`
- ✍️ **Markdown rendering** — bold, italic, inline code, lists, links, and fenced code blocks with language labels
- 📋 **Copy anywhere** — copy full messages or individual code blocks
- 🔁 **Regenerate** — re-roll the last assistant response
- ⏹️ **Stop generation** — cancel a reply mid-stream
- 📱 **Responsive** — off-canvas sidebar layout on mobile

## Project Structure

```
nova-chat/
├── index.html      # App layout: sidebar, topbar, chat window, composer
├── css/
│   └── style.css   # Themes (CSS variables), layout, animations, responsiveness
└── js/
    └── app.js      # State, chat CRUD, markdown parser, streaming engine
```

## Getting Started

No install required — it's static files.

**Option 1:** Open `index.html` directly in your browser.

**Option 2:** Serve locally:

```bash
python3 -m http.server 8000
# then visit http://localhost:8000
```

## How It Works

- **LLM API** — chat requests go to `https://text.pollinations.ai/openai` (OpenAI-compatible) with `stream: true`. The whole conversation history is sent so the model has context. No API key needed.
- **Streaming** — the SSE response is read chunk by chunk via `fetch` + `ReadableStream`; only `delta.content` tokens are rendered.
- **Offline fallback** — if the request fails, `generateReply()` in `js/app.js` produces a local canned reply so the UI still works without internet.
- **State** lives in a single object persisted to `localStorage` (`nova-chat-state`).
- **Theming** uses CSS custom properties switched via a `data-theme` attribute on `<html>`.

> Note: the free Pollinations tier is rate-limited (~1 request every few seconds). If you hit a limit, wait a moment and retry.

## Customizing

| What | Where |
|------|-------|
| Bot name / branding | `index.html` (`.brand`, `.model-chip`) |
| Model / endpoint / system prompt | `API_URL`, `API_MODEL`, `SYSTEM_PROMPT` in `js/app.js` |
| Colors / themes | `:root[data-theme=...]` variables in `css/style.css` |
| Suggestion cards | `#suggestions` block in `index.html` |

## Tech

- HTML5 · CSS3 · Vanilla ES2020 JavaScript
- Zero dependencies, zero build tools

## License

MIT
