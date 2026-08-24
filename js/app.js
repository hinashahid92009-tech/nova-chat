const STORAGE_KEY = "nova-chat-state";

const API_URL = "https://text.pollinations.ai/openai";
const API_FALLBACK_URLS = ["https://gen.pollinations.ai/v1/chat/completions"];
const API_RETRIES = 2;
const API_RETRY_DELAY = 1500;
const SEND_COOLDOWN_MS = 2500;
const API_MODEL = "openai";
const SYSTEM_PROMPT =
  "You are Nova, a friendly and helpful AI assistant inside a web app called Nova Chat. Be concise but complete, and use markdown formatting (including fenced code blocks) whenever it improves readability.";

const ICONS = {
  dots: '<svg viewBox="0 0 24 24" width="16" height="16" fill="currentColor"><circle cx="5" cy="12" r="1.8"/><circle cx="12" cy="12" r="1.8"/><circle cx="19" cy="12" r="1.8"/></svg>',
  pencil: '<svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M17 3a2.8 2.8 0 1 1 4 4L7.5 20.5 2 22l1.5-5.5z"/></svg>',
  trash: '<svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M3 6h18M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2m3 0v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6"/></svg>',
  copy: '<svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="9" y="9" width="13" height="13" rx="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/></svg>',
  check: '<svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M20 6 9 17l-5-5"/></svg>',
  refresh: '<svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 12a9 9 0 1 1-2.64-6.36L21 8"/><path d="M21 3v5h-5"/></svg>'
};

const SUGGESTION_REPLIES = [
  "Great question! Here is how I would think about it:\n\nFirst, break the problem into smaller parts. Then tackle each part on its own before combining everything back together.\n\nWould you like me to go deeper on any step?",
  "Here are a few thoughts on that:\n\n- Start with the fundamentals so the basics are solid\n- Practice with small, concrete examples\n- Review and refine once you have feedback\n\nLet me know which direction you want to explore!",
  "Interesting! There are a couple of ways to approach this.\n\nThe simplest path is usually the best one to start with — you can always optimize later once things work.",
  "I can definitely help with that. To give you the most useful answer, it helps to know your goal, your constraints, and any preferences you already have.\n\nShare a bit more detail and I will tailor the response."
];

const els = {
  app: document.querySelector(".app"),
  sidebar: document.getElementById("sidebar"),
  overlay: document.getElementById("overlay"),
  menuBtn: document.getElementById("menu-btn"),
  newChatBtn: document.getElementById("new-chat-btn"),
  topNewChat: document.getElementById("top-new-chat"),
  chatList: document.getElementById("chat-list"),
  themeToggle: document.getElementById("theme-toggle"),
  themeLabel: document.getElementById("theme-label"),
  clearAllBtn: document.getElementById("clear-all-btn"),
  welcome: document.getElementById("welcome"),
  messages: document.getElementById("messages"),
  chatWindow: document.getElementById("chat-window"),
  form: document.getElementById("chat-form"),
  input: document.getElementById("prompt-input"),
  sendBtn: document.getElementById("send-btn")
};

let state = loadState();
let generating = false;
let currentAbort = null;
let lastRequestAt = 0;

function defaultState() {
  return { chats: [], activeChatId: null, theme: "dark" };
}

function loadState() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return defaultState();
    return { ...defaultState(), ...JSON.parse(raw) };
  } catch {
    return defaultState();
  }
}

function saveState() {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
}

function uid() {
  return Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
}

function getActiveChat() {
  return state.chats.find((c) => c.id === state.activeChatId) || null;
}

function escapeHtml(text) {
  const div = document.createElement("div");
  div.textContent = text;
  return div.innerHTML;
}

function formatInline(text) {
  return text
    .replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>")
    .replace(/(^|[^*])\*([^*]+)\*(?!\*)/g, "$1<em>$2</em>")
    .replace(/`([^`]+)`/g, '<code class="inline">$1</code>')
    .replace(/\[([^\]]+)\]\((https?:\/\/[^\s)]+)\)/g, '<a href="$2" target="_blank" rel="noopener">$1</a>');
}

function formatSegment(text) {
  const lines = text.split("\n");
  let html = "";
  let listType = null;

  const closeList = () => {
    if (listType) {
      html += `</${listType}>`;
      listType = null;
    }
  };

  for (const line of lines) {
    const bullet = line.match(/^\s*[-*]\s+(.*)$/);
    const numbered = line.match(/^\s*\d+[.)]\s+(.*)$/);

    if (bullet) {
      if (listType !== "ul") {
        closeList();
        html += "<ul>";
        listType = "ul";
      }
      html += `<li>${formatInline(bullet[1])}</li>`;
    } else if (numbered) {
      if (listType !== "ol") {
        closeList();
        html += "<ol>";
        listType = "ol";
      }
      html += `<li>${formatInline(numbered[1])}</li>`;
    } else {
      closeList();
      if (line.trim() === "") continue;
      html += `<p>${formatInline(line)}</p>`;
    }
  }
  closeList();
  return html;
}

function formatMessage(text) {
  const parts = text.split(/```/);
  let html = "";

  for (let i = 0; i < parts.length; i++) {
    if (i % 2 === 1) {
      const newlineIndex = parts[i].indexOf("\n");
      const lang = newlineIndex > -1 ? parts[i].slice(0, newlineIndex).trim() : "";
      const code = newlineIndex > -1 ? parts[i].slice(newlineIndex + 1) : parts[i];
      html += `
        <div class="code-block">
          <div class="code-block-header">
            <span>${escapeHtml(lang || "code")}</span>
            <button type="button" class="code-block-copy">${ICONS.copy} Copy code</button>
          </div>
          <pre><code>${escapeHtml(code.replace(/\n$/, ""))}</code></pre>
        </div>`;
    } else {
      html += formatSegment(parts[i]);
    }
  }
  return html;
}

function generateReply(prompt) {
  const p = prompt.toLowerCase();

  if (/^(hi|hello|hey|yo|hola)\b/.test(p)) {
    return "Hello! 👋 I am **Nova**, a demo assistant built with plain HTML, CSS and JavaScript.\n\nAsk me anything, or try one of the suggestions on the welcome screen.";
  }
  if (p.includes("how are you")) {
    return "I am doing great, thanks for asking! Running entirely in your browser with zero servers involved. How can I help you today?";
  }
  if (p.includes("your name") || p.includes("who are you")) {
    return "I am **Nova** ✦ — a front-end demo assistant. My interface mimics modern AI chat apps, but my replies come from simple local logic instead of a real model.";
  }
  if (p.includes("joke")) {
    return "Why do programmers prefer dark mode?\n\nBecause *light attracts bugs*. 🐛";
  }
  if (p.includes("fun fact")) {
    return "Here is one: honey never spoils. Archaeologists have tasted 3,000-year-old honey found in Egyptian tombs and reported that it was still perfectly edible. 🍯";
  }
  if (p.includes("quantum")) {
    return "**Quantum computing, simply put:**\n\n- A classical bit is like a coin lying flat: heads or tails\n- A *qubit* is like a coin spinning in the air — a blend of both states at once\n- By carefully orchestrating many spinning coins, quantum computers can explore huge numbers of possibilities in parallel\n\nThey excel at specific problems like simulating molecules or factoring large numbers, not everyday tasks.";
  }
  if (p.includes("debounce") && (p.includes("javascript") || p.includes("code") || p.includes("function"))) {
    return "Sure! Here is a classic debounce implementation:\n\n```javascript\nfunction debounce(fn, delay = 300) {\n  let timer;\n  return function (...args) {\n    clearTimeout(timer);\n    timer = setTimeout(() => fn.apply(this, args), delay);\n  };\n}\n\nconst onType = debounce((e) => {\n  console.log(\"Searching for:\", e.target.value);\n}, 400);\n\ndocument.querySelector(\"#search\").addEventListener(\"input\", onType);\n```\n\nEvery keystroke resets the timer, so `fn` only runs after the user stops typing for `delay` milliseconds.";
  }
  if (p.includes("trip") || p.includes("mountain") || p.includes("travel")) {
    return "A mountain weekend sounds great! Here is a quick plan:\n\n- **Saturday morning** — arrive early, hike a moderate trail before noon\n- **Saturday evening** — campfire dinner and stargazing\n- **Sunday morning** — sunrise viewpoint walk, then brunch in the nearest town\n\nPack layers, plenty of water, and check trail conditions before you go. 🏔️";
  }
  if (p.includes("weather")) {
    return "I cannot check live weather since this demo runs fully offline — but for real forecasts I would point you to your favorite weather service!\n\nIs there something else I can help with?";
  }
  if (p.includes("thank")) {
    return "You're very welcome! 😊 If you have more questions, just ask — I am here for it.";
  }
  return SUGGESTION_REPLIES[Math.floor(Math.random() * SUGGESTION_REPLIES.length)];
}

function applyTheme() {
  document.documentElement.dataset.theme = state.theme;
  els.themeLabel.textContent = state.theme === "dark" ? "Light mode" : "Dark mode";
}

function setGenerating(on) {
  generating = on;
  els.app.classList.toggle("generating", on);
  updateSendButton();
}

function updateSendButton() {
  els.sendBtn.disabled = !generating && els.input.value.trim() === "";
  els.sendBtn.title = generating ? "Stop generating" : "Send";
}

function isNearBottom() {
  return els.chatWindow.scrollHeight - els.chatWindow.scrollTop - els.chatWindow.clientHeight < 140;
}

function scrollToBottom(force = false) {
  if (force || isNearBottom()) {
    els.chatWindow.scrollTop = els.chatWindow.scrollHeight;
  }
}

function renderChatList() {
  els.chatList.innerHTML = "";
  const chats = [...state.chats].sort((a, b) => b.updatedAt - a.updatedAt);

  if (chats.length === 0) {
    const empty = document.createElement("div");
    empty.className = "chat-list-empty";
    empty.textContent = "No conversations yet. Start a new chat and it will appear here.";
    els.chatList.appendChild(empty);
    return;
  }

  const label = document.createElement("div");
  label.className = "chat-list-label";
  label.textContent = "Recent";
  els.chatList.appendChild(label);

  for (const chat of chats) {
    const item = document.createElement("div");
    item.className = "chat-item" + (chat.id === state.activeChatId ? " active" : "");
    item.innerHTML = `
      <span class="chat-item-title"></span>
      <button type="button" class="chat-item-menu-btn" title="Chat options">${ICONS.dots}</button>
      <div class="chat-item-menu">
        <button type="button" data-action="rename">${ICONS.pencil} Rename</button>
        <button type="button" data-action="delete" class="danger">${ICONS.trash} Delete</button>
      </div>`;
    item.querySelector(".chat-item-title").textContent = chat.title;

    item.addEventListener("click", (e) => {
      if (e.target.closest(".chat-item-menu") || e.target.closest(".chat-item-menu-btn")) return;
      state.activeChatId = chat.id;
      saveState();
      renderAll();
      closeSidebarMobile();
    });

    item.querySelector(".chat-item-menu-btn").addEventListener("click", (e) => {
      e.stopPropagation();
      const wasOpen = item.classList.contains("menu-open");
      closeAllMenus();
      if (!wasOpen) item.classList.add("menu-open");
    });

    item.querySelector('[data-action="rename"]').addEventListener("click", () => {
      closeAllMenus();
      const title = prompt("Rename chat:", chat.title);
      if (title && title.trim()) {
        chat.title = title.trim();
        chat.updatedAt = Date.now();
        saveState();
        renderChatList();
      }
    });

    item.querySelector('[data-action="delete"]').addEventListener("click", () => {
      closeAllMenus();
      if (!confirm(`Delete "${chat.title}"? This cannot be undone.`)) return;
      state.chats = state.chats.filter((c) => c.id !== chat.id);
      if (state.activeChatId === chat.id) state.activeChatId = null;
      saveState();
      renderAll();
    });

    els.chatList.appendChild(item);
  }
}

function buildCopyAction(msg) {
  const actions = document.createElement("div");
  actions.className = "msg-actions";
  const btn = document.createElement("button");
  btn.type = "button";
  btn.className = "icon-btn";
  btn.title = "Copy message";
  btn.innerHTML = ICONS.copy;
  btn.addEventListener("click", async () => {
    try {
      await navigator.clipboard.writeText(msg.content);
    } catch {
      const ta = document.createElement("textarea");
      ta.value = msg.content;
      document.body.appendChild(ta);
      ta.select();
      document.execCommand("copy");
      ta.remove();
    }
    btn.innerHTML = ICONS.check;
    const label = document.createElement("span");
    label.className = "copied-label";
    label.textContent = "Copied!";
    actions.appendChild(label);
    setTimeout(() => {
      btn.innerHTML = ICONS.copy;
      label.remove();
    }, 1500);
  });
  actions.appendChild(btn);
  return actions;
}

function buildMessageEl(msg) {
  const wrap = document.createElement("div");
  wrap.className = "msg " + (msg.role === "user" ? "msg-user" : "msg-assistant");

  if (msg.role === "assistant") {
    const avatar = document.createElement("div");
    avatar.className = "msg-avatar";
    avatar.textContent = "✦";

    const body = document.createElement("div");
    body.className = "msg-body";

    const content = document.createElement("div");
    content.className = "msg-content";

    if (msg.streaming && !msg.content) {
      content.innerHTML = typingDotsHtml();
    } else if (msg.formatted) {
      content.innerHTML = formatMessage(msg.content);
    } else {
      content.textContent = msg.content;
    }

    body.appendChild(content);
    if (msg.content && !msg.streaming) body.appendChild(buildCopyAction(msg));
    wrap.append(avatar, body);
  } else {
    const spacer = document.createElement("div");
    spacer.className = "msg-avatar";
    spacer.style.visibility = "hidden";

    const content = document.createElement("div");
    content.className = "msg-content";
    content.textContent = msg.content;

    const body = document.createElement("div");
    body.className = "msg-body";
    body.style.display = "contents";
    body.appendChild(content);
    wrap.append(spacer, body);
  }

  wrap.querySelectorAll(".code-block-copy").forEach((btn) => {
    btn.addEventListener("click", () => {
      const code = btn.closest(".code-block").querySelector("code").innerText;
      navigator.clipboard.writeText(code).then(() => {
        const original = btn.innerHTML;
        btn.innerHTML = `${ICONS.check} Copied`;
        setTimeout(() => (btn.innerHTML = original), 1500);
      });
    });
  });

  return wrap;
}

function typingDotsHtml() {
  return '<div class="typing-dots"><span></span><span></span><span></span></div>';
}

function appendRegenerateBar() {
  const chat = getActiveChat();
  if (!chat || chat.messages.length === 0) return;
  if (chat.messages[chat.messages.length - 1].role !== "assistant") return;

  const row = document.createElement("div");
  row.className = "regenerate-row";
  const btn = document.createElement("button");
  btn.type = "button";
  btn.className = "regenerate-btn";
  btn.innerHTML = `${ICONS.refresh} Regenerate response`;
  btn.addEventListener("click", regenerate);
  row.appendChild(btn);
  els.messages.appendChild(row);
}

function renderMessages() {
  const chat = getActiveChat();
  els.messages.innerHTML = "";

  if (!chat || chat.messages.length === 0) {
    els.welcome.style.display = "";
    return;
  }
  els.welcome.style.display = "none";

  for (const msg of chat.messages) {
    els.messages.appendChild(buildMessageEl(msg));
  }
  appendRegenerateBar();
}

function renderAll() {
  renderChatList();
  renderMessages();
  scrollToBottom(true);
}

function createChat(firstMessage) {
  const chat = {
    id: uid(),
    title: firstMessage.length > 34 ? firstMessage.slice(0, 34).trimEnd() + "…" : firstMessage,
    createdAt: Date.now(),
    updatedAt: Date.now(),
    messages: []
  };
  state.chats.push(chat);
  state.activeChatId = chat.id;
  return chat;
}

async function openStream(messages, signal) {
  const endpoints = [API_URL, ...API_FALLBACK_URLS];
  let lastError = new Error("No endpoint available");

  for (let attempt = 0; attempt < API_RETRIES; attempt++) {
    if (attempt > 0) {
      await new Promise((r) => setTimeout(r, API_RETRY_DELAY));
      if (signal.aborted) throw new DOMException("Aborted", "AbortError");
    }

    for (const url of endpoints) {
      try {
        const res = await fetch(url, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          signal,
          body: JSON.stringify({ model: API_MODEL, stream: true, messages })
        });

        if (res.ok && res.body) return res;
        lastError = new Error("Endpoint " + url + " responded with status " + res.status);
      } catch (err) {
        if (err.name === "AbortError") throw err;
        lastError = err;
      }
    }
  }
  throw lastError;
}

async function respond() {
  const chat = getActiveChat();
  if (!chat || generating) return;

  const sinceLast = Date.now() - lastRequestAt;
  if (sinceLast < SEND_COOLDOWN_MS) {
    await new Promise((r) => setTimeout(r, SEND_COOLDOWN_MS - sinceLast));
    if (generating) return;
  }
  lastRequestAt = Date.now();

  const history = chat.messages.map(({ role, content }) => ({ role, content }));
  const lastUser = [...history].reverse().find((m) => m.role === "user");

  setGenerating(true);

  const placeholderMsg = { role: "assistant", content: "", streaming: true };
  chat.messages.push(placeholderMsg);

  const msgEl = buildMessageEl(placeholderMsg);
  els.messages.appendChild(msgEl);
  scrollToBottom(true);

  const contentEl = msgEl.querySelector(".msg-content");
  currentAbort = new AbortController();

  try {
    const res = await openStream(
      [{ role: "system", content: SYSTEM_PROMPT }, ...history],
      currentAbort.signal
    );

    const reader = res.body.getReader();
    const decoder = new TextDecoder();
    let buffer = "";

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;

      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split("\n");
      buffer = lines.pop();

      for (const line of lines) {
        const trimmedLine = line.trim();
        if (!trimmedLine.startsWith("data:")) continue;
        const payload = trimmedLine.slice(5).trim();
        if (!payload || payload === "[DONE]") continue;

        try {
          const json = JSON.parse(payload);
          const delta = json.choices?.[0]?.delta?.content;
          if (delta) {
            placeholderMsg.content += delta;
            contentEl.textContent = placeholderMsg.content;
            scrollToBottom();
          }
        } catch {}
      }
    }
  } catch (err) {
    if (err.name !== "AbortError") {
      const rateLimited = /status 40[24]|status 5\d\d/i.test(String(err));
      if (!placeholderMsg.content.trim()) {
        placeholderMsg.content =
          "*Couldn't reach the AI service" +
          (rateLimited ? " — the free tier is rate limited, wait a few seconds and try again" : "") +
          ".*\n\n" +
          generateReply(lastUser ? lastUser.content : "");
      } else {
        placeholderMsg.content +=
          "\n\n*(" + (rateLimited ? "rate limited — retry shortly" : "connection lost") + ")*";
      }
    }
  }

  finishStream(chat, placeholderMsg, contentEl);
}

function finishStream(chat, msg, contentEl) {
  currentAbort = null;

  msg.streaming = false;
  msg.formatted = true;
  if (!msg.content.trim()) msg.content = "*Generation stopped.*";

  contentEl.innerHTML = formatMessage(msg.content);
  rebindCodeCopy(contentEl);
  refreshActions(chat, msg, contentEl);

  chat.updatedAt = Date.now();
  setGenerating(false);
  saveState();
  renderChatList();
  scrollToBottom();
}

function rebindCodeCopy(scopeEl) {
  scopeEl.querySelectorAll(".code-block-copy").forEach((btn) => {
    btn.addEventListener("click", () => {
      const code = btn.closest(".code-block").querySelector("code").innerText;
      navigator.clipboard.writeText(code).then(() => {
        const original = btn.innerHTML;
        btn.innerHTML = `${ICONS.check} Copied`;
        setTimeout(() => (btn.innerHTML = original), 1500);
      });
    });
  });
}

function refreshActions(chat, msg, contentEl) {
  const body = contentEl.parentElement;
  const existing = body.querySelector(".msg-actions");
  if (existing) existing.remove();
  body.appendChild(buildCopyAction(msg));
}

function stopGeneration() {
  if (!generating || !currentAbort) return;
  currentAbort.abort();
}

function sendMessage(text) {
  const trimmed = text.trim();
  if (!trimmed || generating) return;

  let chat = getActiveChat();
  if (!chat) chat = createChat(trimmed);

  chat.messages.push({ role: "user", content: trimmed });
  chat.updatedAt = Date.now();
  saveState();
  renderAll();
  respond();
}

function regenerate() {
  if (generating) return;
  const chat = getActiveChat();
  if (!chat) return;

  while (chat.messages.length && chat.messages[chat.messages.length - 1].role === "assistant") {
    chat.messages.pop();
  }
  saveState();
  renderAll();
  respond();
}

function startNewChat() {
  if (generating) stopGeneration();
  state.activeChatId = null;
  saveState();
  renderAll();
  els.input.focus();
  closeSidebarMobile();
}

function clearAllChats() {
  if (state.chats.length === 0) return;
  if (!confirm("Delete ALL conversations? This cannot be undone.")) return;
  if (generating) stopGeneration();
  state.chats = [];
  state.activeChatId = null;
  saveState();
  renderAll();
}

function toggleTheme() {
  state.theme = state.theme === "dark" ? "light" : "dark";
  saveState();
  applyTheme();
}

function closeAllMenus() {
  document.querySelectorAll(".chat-item.menu-open").forEach((el) => el.classList.remove("menu-open"));
}

function closeSidebarMobile() {
  els.app.classList.remove("sidebar-open");
}

document.addEventListener("click", (e) => {
  if (!e.target.closest(".chat-item")) closeAllMenus();
});

els.form.addEventListener("submit", (e) => {
  e.preventDefault();
  if (generating) {
    stopGeneration();
    return;
  }
  const value = els.input.value;
  els.input.value = "";
  autosizeInput();
  updateSendButton();
  sendMessage(value);
});

els.input.addEventListener("input", () => {
  autosizeInput();
  updateSendButton();
});

els.input.addEventListener("keydown", (e) => {
  if (e.key === "Enter" && !e.shiftKey) {
    e.preventDefault();
    els.form.requestSubmit();
  }
});

function autosizeInput() {
  els.input.style.height = "auto";
  els.input.style.height = Math.min(els.input.scrollHeight, 200) + "px";
}

els.newChatBtn.addEventListener("click", startNewChat);
els.topNewChat.addEventListener("click", startNewChat);
els.clearAllBtn.addEventListener("click", clearAllChats);
els.themeToggle.addEventListener("click", toggleTheme);
els.menuBtn.addEventListener("click", () => els.app.classList.toggle("sidebar-open"));
els.overlay.addEventListener("click", closeSidebarMobile);

els.welcome.addEventListener("click", (e) => {
  const card = e.target.closest(".suggestion-card");
  if (card) sendMessage(card.dataset.prompt);
});

applyTheme();
renderAll();
updateSendButton();
