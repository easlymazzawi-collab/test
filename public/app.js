const MAX_IMAGES = 5;
const MAX_IMAGE_BYTES = 15 * 1024 * 1024;
const MAX_TEXT_BYTES = 600 * 1024;
const IMAGE_TYPES = new Set(["image/png", "image/jpeg", "image/gif", "image/webp"]);
const TEXT_EXTENSIONS = new Set([
  "txt", "md", "markdown", "js", "jsx", "ts", "tsx", "mjs", "cjs", "py", "rb",
  "go", "rs", "java", "kt", "swift", "dart", "c", "h", "cpp", "cc", "hpp", "cs",
  "php", "sh", "bash", "zsh", "json", "jsonc", "yaml", "yml", "toml", "ini",
  "env", "xml", "html", "htm", "css", "scss", "less", "sql", "vue", "svelte",
  "csv", "log", "gradle", "makefile", "dockerfile", "gitignore", "conf",
]);
const APP_VERSION = "studio-2026-06-25";

const FALLBACK_MODELS = [
  { id: "gpt-5.5-high", displayName: "GPT-5.5 High" },
  { id: "gpt-5.5-high-fast", displayName: "GPT-5.5 High Fast" },
  { id: "gpt-5.4-high", displayName: "GPT-5.4 High" },
  { id: "gpt-5.4-high-fast", displayName: "GPT-5.4 High Fast" },
  { id: "gpt-5.3-codex-high", displayName: "Codex 5.3 High" },
  { id: "gpt-5.3-codex-high-fast", displayName: "Codex 5.3 High Fast" },
  { id: "claude-opus-4-8-thinking-high", displayName: "Opus 4.8 High" },
  { id: "claude-opus-4-8-thinking-high-fast", displayName: "Opus 4.8 High Fast" },
  { id: "claude-opus-4-7-thinking-high", displayName: "Opus 4.7 High" },
  { id: "claude-4.6-sonnet-high-thinking", displayName: "Sonnet 4.6 High" },
  { id: "composer-2.5", displayName: "Composer 2.5" },
];

const SUGGESTIONS = [
  { title: "Giải thích đoạn code", body: "Dán code rồi nhờ agent giải thích logic." },
  { title: "Tạo component", body: "Mô tả UI bạn muốn, agent dựng component." },
  { title: "Sửa bug", body: "Thêm repo URL để agent sửa và mở PR." },
  { title: "Đọc ảnh UI", body: "Upload ảnh thiết kế và hỏi cách dựng lại." },
];

const store = {
  version: "cursorChatStudio.version",
  key: "cursorChatStudio.apiKey",
  remember: "cursorChatStudio.rememberKey",
  conversations: "cursorChatStudio.conversations",
  activeConversation: "cursorChatStudio.activeConversationId",
  files: "cursorChatStudio.files",
  activeFile: "cursorChatStudio.activeFileId",
};

const $ = (id) => document.getElementById(id);
const el = {
  appShell: $("appShell"),
  apiKey: $("apiKeyInput"),
  rememberKey: $("rememberKeyInput"),
  connection: $("connectionState"),
  conversationList: $("conversationList"),
  newChat: $("newChatButton"),
  clearAllChats: $("clearAllChatsButton"),
  chatTitle: $("chatTitle"),
  modelBadge: $("modelBadge"),
  clearChat: $("clearChatButton"),
  agentId: $("agentIdInput"),
  mode: $("modeInput"),
  repoUrl: $("repoUrlInput"),
  startingRef: $("startingRefInput"),
  prUrl: $("prUrlInput"),
  autoPr: $("autoPrInput"),
  currentBranch: $("currentBranchInput"),
  runStatus: $("runStatus"),
  agentLink: $("agentLink"),
  messageList: $("messageList"),
  composer: $("composerForm"),
  prompt: $("promptInput"),
  imageInput: $("imageInput"),
  imagePreviewList: $("imagePreviewList"),
  clearImages: $("clearImagesButton"),
  includeCode: $("includeCodeInput"),
  model: $("modelInput"),
  modelStatus: $("modelStatus"),
  send: $("sendButton"),
  toggleCode: $("toggleCodeButton"),
  closeCode: $("closeCodeButton"),
  codeScrim: $("codeScrim"),
  dropOverlay: $("dropOverlay"),
  fileTabs: $("fileTabs"),
  codeEmpty: $("codeEmptyState"),
  editorShell: $("editorShell"),
  newFile: $("newFileButton"),
  fileName: $("fileNameInput"),
  language: $("languageInput"),
  codeEditor: $("codeEditor"),
  copyCode: $("copyCodeButton"),
  insertPrompt: $("insertPromptButton"),
};

migrateLocalState();

const state = {
  conversations: loadConversations(),
  activeConversationId: localStorage.getItem(store.activeConversation) || "",
  uploadedImages: [],
  files: loadFiles(),
  activeFileId: localStorage.getItem(store.activeFile) || "",
  codeOpen: false,
  busy: false,
};

let modelLoadTimer;

if (!state.conversations.length) createConversation({ save: false });
if (!state.conversations.some((c) => c.id === state.activeConversationId)) {
  state.activeConversationId = state.conversations[0].id;
}
if (state.files.length && !state.files.some((f) => f.id === state.activeFileId)) {
  state.activeFileId = state.files[0].id;
}

/* ---------- storage helpers ---------- */
function uid(prefix) {
  return `${prefix}-${crypto.randomUUID()}`;
}

function isStarterFile(file) {
  return file?.name === "example.ts" && String(file.content || "").includes("buildPrompt");
}

function migrateLocalState() {
  if (localStorage.getItem(store.version) === APP_VERSION) return;
  try {
    const files = JSON.parse(localStorage.getItem(store.files) || "[]");
    if (Array.isArray(files)) {
      const cleaned = files.filter((f) => !isStarterFile(f));
      localStorage.setItem(store.files, JSON.stringify(cleaned));
    }
  } catch {
    localStorage.removeItem(store.files);
    localStorage.removeItem(store.activeFile);
  }
  localStorage.removeItem("cursorChatStudio.codeOpen");
  localStorage.setItem(store.version, APP_VERSION);
}

function loadConversations() {
  try {
    const items = JSON.parse(localStorage.getItem(store.conversations) || "[]");
    return Array.isArray(items) ? items : [];
  } catch {
    return [];
  }
}

function saveConversations() {
  localStorage.setItem(store.conversations, JSON.stringify(state.conversations));
  localStorage.setItem(store.activeConversation, state.activeConversationId);
}

function loadFiles() {
  try {
    const files = JSON.parse(localStorage.getItem(store.files) || "[]");
    return Array.isArray(files) ? files.filter((f) => !isStarterFile(f)) : [];
  } catch {
    return [];
  }
}

function saveFiles() {
  localStorage.setItem(store.files, JSON.stringify(state.files));
  if (state.activeFileId) localStorage.setItem(store.activeFile, state.activeFileId);
  else localStorage.removeItem(store.activeFile);
}

function activeConversation() {
  return state.conversations.find((c) => c.id === state.activeConversationId);
}

function activeFile() {
  return state.files.find((f) => f.id === state.activeFileId) || null;
}

function createConversation({ save = true } = {}) {
  const now = new Date().toISOString();
  const conversation = {
    id: uid("chat"),
    title: "Đoạn chat mới",
    agentId: "",
    runId: "",
    agentUrl: "",
    messages: [],
    createdAt: now,
    updatedAt: now,
  };
  state.conversations.unshift(conversation);
  state.activeConversationId = conversation.id;
  if (save) saveConversations();
  return conversation;
}

/* ---------- markdown ---------- */
function escapeHtml(text) {
  return String(text)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function renderInline(text) {
  const spans = [];
  let html = escapeHtml(text);
  html = html.replace(/`([^`]+)`/g, (_, code) => {
    spans.push(code);
    return `\u0000${spans.length - 1}\u0000`;
  });
  html = html
    .replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>")
    .replace(/(^|[^*])\*([^*\n]+)\*/g, "$1<em>$2</em>")
    .replace(/\[([^\]]+)\]\(([^)\s]+)\)/g, (_, label, url) => {
      const safe = /^https?:\/\//.test(url) ? url : "#";
      return `<a href="${safe}" target="_blank" rel="noreferrer">${label}</a>`;
    });
  html = html.replace(/\u0000(\d+)\u0000/g, (_, i) => `<code class="inline-code">${spans[+i]}</code>`);
  return html;
}

function renderTextBlock(text) {
  const lines = text.split("\n");
  const out = [];
  let i = 0;

  while (i < lines.length) {
    const line = lines[i];
    if (!line.trim()) {
      i += 1;
      continue;
    }

    const heading = line.match(/^(#{1,6})\s+(.*)$/);
    if (heading) {
      const level = Math.min(heading[1].length, 4);
      out.push(`<h${level}>${renderInline(heading[2])}</h${level}>`);
      i += 1;
      continue;
    }

    if (/^\s*([-*_])(\s*\1){2,}\s*$/.test(line)) {
      out.push("<hr />");
      i += 1;
      continue;
    }

    if (/^>\s?/.test(line)) {
      const buf = [];
      while (i < lines.length && /^>\s?/.test(lines[i])) {
        buf.push(lines[i].replace(/^>\s?/, ""));
        i += 1;
      }
      out.push(`<blockquote>${renderInline(buf.join("\n")).replace(/\n/g, "<br/>")}</blockquote>`);
      continue;
    }

    if (/^\s*[-*+]\s+/.test(line)) {
      const items = [];
      while (i < lines.length && /^\s*[-*+]\s+/.test(lines[i])) {
        items.push(lines[i].replace(/^\s*[-*+]\s+/, ""));
        i += 1;
      }
      out.push(`<ul>${items.map((it) => `<li>${renderInline(it)}</li>`).join("")}</ul>`);
      continue;
    }

    if (/^\s*\d+[.)]\s+/.test(line)) {
      const items = [];
      while (i < lines.length && /^\s*\d+[.)]\s+/.test(lines[i])) {
        items.push(lines[i].replace(/^\s*\d+[.)]\s+/, ""));
        i += 1;
      }
      out.push(`<ol>${items.map((it) => `<li>${renderInline(it)}</li>`).join("")}</ol>`);
      continue;
    }

    const buf = [];
    while (
      i < lines.length &&
      lines[i].trim() &&
      !/^(#{1,6}\s|>|\s*[-*+]\s|\s*\d+[.)]\s)/.test(lines[i]) &&
      !/^\s*([-*_])(\s*\1){2,}\s*$/.test(lines[i])
    ) {
      buf.push(lines[i]);
      i += 1;
    }
    out.push(`<p>${renderInline(buf.join("\n")).replace(/\n/g, "<br/>")}</p>`);
  }

  return out.join("");
}

function renderCodeBlock(lang, code) {
  const label = (lang || "code").toLowerCase();
  return `
    <div class="code-block" data-lang="${escapeHtml(label)}">
      <div class="code-block-head">
        <span class="code-lang">${escapeHtml(label)}</span>
        <div class="code-actions">
          <button class="code-action code-open" type="button">Sửa</button>
          <button class="code-action code-copy" type="button">Copy</button>
        </div>
      </div>
      <pre class="code-body"><code>${escapeHtml(code)}</code></pre>
    </div>`;
}

function renderMarkdown(text) {
  const fence = /```([^\n`]*)\n?([\s\S]*?)```/g;
  let html = "";
  let last = 0;
  let match;
  while ((match = fence.exec(text)) !== null) {
    if (match.index > last) html += renderTextBlock(text.slice(last, match.index));
    html += renderCodeBlock(match[1].trim(), match[2].replace(/\n$/, ""));
    last = fence.lastIndex;
  }
  if (last < text.length) html += renderTextBlock(text.slice(last));
  return html || renderTextBlock(text);
}

/* ---------- rendering ---------- */
function setStatus(node, text, variant = "") {
  node.textContent = text;
  node.className = variant ? `badge ${variant}` : "badge";
}

function setRunStatus(status) {
  el.runStatus.textContent = status || "idle";
}

function setMessageBody(bodyEl, message) {
  if (message.role === "assistant") {
    bodyEl.innerHTML = message.text
      ? renderMarkdown(message.text)
      : `<span class="typing"><span></span><span></span><span></span></span>`;
  } else {
    bodyEl.innerHTML = escapeHtml(message.text).replace(/\n/g, "<br/>");
  }
}

function renderMessage(message) {
  const article = document.createElement("article");
  article.className = `message ${message.role}`;
  article.dataset.messageId = message.id;

  const avatar = document.createElement("div");
  avatar.className = "avatar";
  avatar.textContent = message.role === "user" ? "ME" : "AI";

  const bubble = document.createElement("div");
  bubble.className = "bubble";

  if (message.role === "assistant") {
    const meta = document.createElement("div");
    meta.className = "message-meta";
    meta.textContent = message.meta || "Cursor Agent";
    bubble.append(meta);
  }

  const body = document.createElement("div");
  body.className = "prose";
  setMessageBody(body, message);
  bubble.append(body);

  if (message.images?.length) {
    const wrap = document.createElement("div");
    wrap.className = "message-images";
    for (const image of message.images) {
      const img = document.createElement("img");
      img.src = image.dataUrl;
      img.alt = image.name;
      wrap.append(img);
    }
    bubble.append(wrap);
  }

  const tools = document.createElement("div");
  tools.className = `tool-list${message.tools?.length ? "" : " hidden"}`;
  for (const tool of message.tools || []) {
    const item = document.createElement("div");
    item.className = "tool-item";
    item.textContent = tool;
    tools.append(item);
  }
  bubble.append(tools);

  article.append(avatar, bubble);
  el.messageList.append(article);
  return article;
}

function renderWelcome() {
  const welcome = document.createElement("div");
  welcome.className = "welcome";

  const hero = document.createElement("div");
  hero.className = "welcome-hero";
  hero.innerHTML = `
    <h3>Bắt đầu với Cursor Agent</h3>
    <p>Chọn model dưới ô nhập, upload ảnh, hoặc bấm "Viết code". Code block agent trả về sẽ có nút Copy và Sửa. Mọi đoạn chat được lưu trên trình duyệt này.</p>
  `;

  const grid = document.createElement("div");
  grid.className = "suggestions";
  for (const item of SUGGESTIONS) {
    const button = document.createElement("button");
    button.type = "button";
    button.className = "suggestion";
    button.innerHTML = `<strong>${escapeHtml(item.title)}</strong><span>${escapeHtml(item.body)}</span>`;
    button.addEventListener("click", () => {
      el.prompt.value = `${item.title}: `;
      autoGrow();
      el.prompt.focus();
    });
    grid.append(button);
  }

  welcome.append(hero, grid);
  el.messageList.append(welcome);
}

function renderMessages() {
  el.messageList.innerHTML = "";
  const conversation = activeConversation();
  if (!conversation?.messages.length) {
    renderWelcome();
    return;
  }
  for (const message of conversation.messages) renderMessage(message);
  scrollBottom();
}

function previewText(conversation) {
  const last = [...conversation.messages].reverse().find((m) => m.text);
  return (last?.text || "Chưa có tin nhắn").replace(/[`*#>]/g, "").replace(/\s+/g, " ").trim();
}

function renderConversationList() {
  el.conversationList.innerHTML = "";
  for (const conversation of state.conversations) {
    const item = document.createElement("button");
    item.type = "button";
    item.className = `conversation-item${conversation.id === state.activeConversationId ? " active" : ""}`;

    const text = document.createElement("div");
    text.className = "ci-text";
    const title = document.createElement("strong");
    title.textContent = conversation.title || "Đoạn chat mới";
    const preview = document.createElement("span");
    preview.textContent = previewText(conversation).slice(0, 80);
    text.append(title, preview);

    const del = document.createElement("span");
    del.className = "ci-delete";
    del.textContent = "✕";
    del.title = "Xoá đoạn chat";
    del.addEventListener("click", (event) => {
      event.stopPropagation();
      deleteConversation(conversation.id);
    });

    item.append(text, del);
    item.addEventListener("click", () => {
      state.activeConversationId = conversation.id;
      saveConversations();
      renderApp();
    });
    el.conversationList.append(item);
  }
}

function updateMeta() {
  const conversation = activeConversation();
  el.chatTitle.textContent = conversation?.title || "Đoạn chat mới";
  el.agentId.value = conversation?.agentId || "";
  setRunStatus(conversation?.runId ? "ready" : "idle");

  if (conversation?.agentId) {
    el.agentLink.href = conversation.agentUrl || `https://cursor.com/agents/${conversation.agentId}`;
    el.agentLink.classList.remove("hidden");
  } else {
    el.agentLink.classList.add("hidden");
  }
}

function renderApp() {
  renderConversationList();
  renderMessages();
  renderTabs();
  renderEditor();
  updateMeta();
}

function scrollBottom() {
  el.messageList.scrollTop = el.messageList.scrollHeight;
}

function addMessage(role, text, options = {}) {
  const conversation = activeConversation();
  const message = {
    id: uid("msg"),
    role,
    text,
    meta: options.meta || "",
    images: options.images || [],
    tools: [],
    createdAt: new Date().toISOString(),
  };
  conversation.messages.push(message);
  conversation.updatedAt = message.createdAt;

  if (role === "user" && conversation.title === "Đoạn chat mới" && text.trim()) {
    conversation.title = text.trim().replace(/\s+/g, " ").slice(0, 48);
  }

  saveConversations();
  renderConversationList();
  el.messageList.querySelector(".welcome")?.remove();
  const article = renderMessage(message);
  scrollBottom();
  return { message, article };
}

function updateMessage(message, text) {
  message.text = text;
  saveConversations();
  const body = el.messageList.querySelector(`[data-message-id="${message.id}"] .prose`);
  if (body) setMessageBody(body, message);
}

function addTool(message, text) {
  if (message.tools.includes(text)) return;
  message.tools.push(text);
  saveConversations();
  const article = el.messageList.querySelector(`[data-message-id="${message.id}"]`);
  const tools = article?.querySelector(".tool-list");
  if (!tools) return;
  tools.classList.remove("hidden");
  const item = document.createElement("div");
  item.className = "tool-item";
  item.textContent = text;
  tools.append(item);
}

function notice(text) {
  addMessage("assistant", text, { meta: "Thông báo" });
}

function deleteConversation(id) {
  state.conversations = state.conversations.filter((c) => c.id !== id);
  if (!state.conversations.length) createConversation({ save: false });
  if (!state.conversations.some((c) => c.id === state.activeConversationId)) {
    state.activeConversationId = state.conversations[0].id;
  }
  saveConversations();
  renderApp();
}

/* ---------- images ---------- */
function renderImages() {
  el.imagePreviewList.innerHTML = "";
  el.clearImages.classList.toggle("hidden", state.uploadedImages.length === 0);
  state.uploadedImages.forEach((image, index) => {
    const card = document.createElement("div");
    card.className = "image-card";
    const img = document.createElement("img");
    img.src = image.dataUrl;
    img.alt = image.name;
    const remove = document.createElement("button");
    remove.type = "button";
    remove.textContent = "✕";
    remove.addEventListener("click", () => {
      state.uploadedImages.splice(index, 1);
      renderImages();
    });
    card.append(img, remove);
    el.imagePreviewList.append(card);
  });
}

function readImage(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      const dataUrl = String(reader.result || "");
      resolve({
        name: file.name,
        mimeType: file.type,
        dataUrl,
        data: dataUrl.slice(dataUrl.indexOf(",") + 1),
      });
    };
    reader.onerror = () => reject(reader.error);
    reader.readAsDataURL(file);
  });
}

async function addImages(files) {
  const list = Array.from(files || []);
  const slots = MAX_IMAGES - state.uploadedImages.length;
  if (slots <= 0) return notice(`Cursor hỗ trợ tối đa ${MAX_IMAGES} ảnh mỗi prompt.`);
  for (const file of list.slice(0, slots)) {
    if (!IMAGE_TYPES.has(file.type)) {
      notice(`Bỏ qua ${file.name}: định dạng ảnh chưa hỗ trợ.`);
      continue;
    }
    if (file.size > MAX_IMAGE_BYTES) {
      notice(`Bỏ qua ${file.name}: ảnh lớn hơn 15 MB.`);
      continue;
    }
    state.uploadedImages.push(await readImage(file));
  }
  if (list.length > slots) notice(`Chỉ lấy ${slots} ảnh đầu tiên.`);
  renderImages();
  el.imageInput.value = "";
}

function fileExtension(name) {
  const base = name.toLowerCase();
  if (base.includes(".")) return base.split(".").pop();
  return base;
}

function extensionToLanguage(name) {
  const map = {
    js: "javascript",
    mjs: "javascript",
    cjs: "javascript",
    jsx: "jsx",
    ts: "typescript",
    tsx: "tsx",
    py: "python",
    md: "markdown",
    markdown: "markdown",
    json: "json",
    jsonc: "json",
    html: "html",
    htm: "html",
    css: "css",
    scss: "css",
    less: "css",
    sh: "bash",
    bash: "bash",
    zsh: "bash",
    yml: "text",
    yaml: "text",
  };
  return map[fileExtension(name)] || "text";
}

function isTextFile(file) {
  if (file.type.startsWith("text/")) return true;
  if (file.type === "application/json") return true;
  return TEXT_EXTENSIONS.has(fileExtension(file.name));
}

function readTextFile(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result || ""));
    reader.onerror = () => reject(reader.error);
    reader.readAsText(file);
  });
}

async function addFiles(fileList) {
  const list = Array.from(fileList || []);
  if (!list.length) return;

  const images = list.filter((f) => IMAGE_TYPES.has(f.type));
  const texts = list.filter((f) => !IMAGE_TYPES.has(f.type) && isTextFile(f));
  const others = list.filter((f) => !IMAGE_TYPES.has(f.type) && !isTextFile(f));

  if (images.length) await addImages(images);

  for (const file of texts) {
    if (file.size > MAX_TEXT_BYTES) {
      notice(`Bỏ qua ${file.name}: file text lớn hơn 600 KB.`);
      continue;
    }
    const content = await readTextFile(file);
    newFile(file.name, extensionToLanguage(file.name), content);
    notice(`Đã thêm \`${file.name}\` vào code workspace và bật "Gửi code".`);
  }

  for (const file of others) {
    notice(`Bỏ qua ${file.name}: chỉ hỗ trợ ảnh hoặc file text/code.`);
  }
}

/* ---------- code workspace ---------- */
function setCodeOpen(open) {
  state.codeOpen = open;
  el.appShell.classList.toggle("code-open", open);
}

function normalizeLanguage(language) {
  const map = { js: "javascript", ts: "typescript", py: "python", md: "markdown", sh: "bash" };
  const lower = (language || "text").toLowerCase();
  return map[lower] || lower;
}

function languageToExtension(language) {
  const map = {
    javascript: "js",
    typescript: "ts",
    jsx: "jsx",
    tsx: "tsx",
    python: "py",
    html: "html",
    css: "css",
    json: "json",
    markdown: "md",
    bash: "sh",
  };
  return map[normalizeLanguage(language)] || "txt";
}

function renderTabs() {
  el.fileTabs.innerHTML = "";
  el.includeCode.disabled = state.files.length === 0;
  if (!state.files.length) el.includeCode.checked = false;

  for (const file of state.files) {
    const tab = document.createElement("div");
    tab.className = `file-tab${file.id === state.activeFileId ? " active" : ""}`;

    const name = document.createElement("button");
    name.type = "button";
    name.className = "ft-name";
    name.textContent = file.name || "untitled";
    name.addEventListener("click", () => {
      state.activeFileId = file.id;
      saveFiles();
      renderTabs();
      renderEditor();
      setCodeOpen(true);
    });

    const close = document.createElement("button");
    close.type = "button";
    close.className = "ft-close";
    close.textContent = "✕";
    close.addEventListener("click", (event) => {
      event.stopPropagation();
      state.files = state.files.filter((f) => f.id !== file.id);
      if (state.activeFileId === file.id) state.activeFileId = state.files[0]?.id || "";
      saveFiles();
      renderTabs();
      renderEditor();
    });

    tab.append(name, close);
    el.fileTabs.append(tab);
  }
}

function renderEditor() {
  const file = activeFile();
  if (!file) {
    el.codeEmpty.classList.remove("hidden");
    el.editorShell.classList.add("hidden");
    el.fileName.value = "";
    el.codeEditor.value = "";
    return;
  }
  el.codeEmpty.classList.add("hidden");
  el.editorShell.classList.remove("hidden");
  el.fileName.value = file.name;
  el.language.value = state.files.find((f) => f.id === file.id) ? file.language : "text";
  el.language.value = file.language;
  el.codeEditor.value = file.content;
}

function updateFile(patch) {
  const file = activeFile();
  if (!file) return;
  Object.assign(file, patch);
  saveFiles();
  renderTabs();
}

function newFile(name, language = "typescript", content = "") {
  const file = {
    id: uid("file"),
    name: name || `scratch-${state.files.length + 1}.ts`,
    language: normalizeLanguage(language),
    content,
  };
  state.files.push(file);
  state.activeFileId = file.id;
  el.includeCode.checked = true;
  saveFiles();
  renderTabs();
  renderEditor();
  setCodeOpen(true);
  return file;
}

function insertCode() {
  const file = activeFile();
  if (!file) return notice("Chưa có tab code để chèn vào chat.");
  el.prompt.value += [
    "",
    `File: ${file.name}`,
    "```" + file.language,
    file.content,
    "```",
    "",
  ].join("\n");
  autoGrow();
  el.prompt.focus();
}

function promptWithCode(text) {
  const file = activeFile();
  if (!file || !el.includeCode.checked || !file.content.trim()) return text;
  return [
    text,
    "",
    "---",
    "Code context (side editor):",
    `File: ${file.name}`,
    "```" + file.language,
    file.content,
    "```",
  ].join("\n");
}

/* ---------- API ---------- */
function headers(json = true) {
  const out = {};
  if (json) out["Content-Type"] = "application/json";
  const key = el.apiKey.value.trim();
  if (key) out["x-cursor-api-key"] = key;
  return out;
}

async function errorText(response) {
  const type = response.headers.get("content-type") || "";
  if (type.includes("application/json")) {
    const data = await response.json();
    return data.message || data.error || JSON.stringify(data);
  }
  return response.text();
}

async function cursorJson(path, payload, method = "POST") {
  const response = await fetch(`/api/cursor${path}`, {
    method,
    headers: headers(),
    body: payload === undefined ? undefined : JSON.stringify(payload),
  });
  if (!response.ok) throw new Error(await errorText(response));
  return response.json();
}

function encodeModel(selection) {
  return JSON.stringify({ id: selection.id, params: selection.params || [] });
}

function decodeModel(value) {
  if (!value) return null;
  try {
    const parsed = JSON.parse(value);
    if (parsed?.id) return parsed;
  } catch {
    return { id: value, params: [] };
  }
  return null;
}

function syncModelBadge() {
  const selected = el.model.options[el.model.selectedIndex];
  el.modelBadge.textContent = selected && selected.value ? selected.textContent : "Default";
}

function renderModelOptions(models, source) {
  const previous = el.model.value;
  el.model.innerHTML = "";

  const def = document.createElement("option");
  def.value = "";
  def.textContent = "Default";
  el.model.append(def);

  for (const model of models) {
    const variants =
      Array.isArray(model.variants) && model.variants.length
        ? model.variants
        : [{ displayName: model.displayName, params: model.params || [] }];
    for (const variant of variants) {
      const option = document.createElement("option");
      option.value = encodeModel({ id: variant.id || model.id, params: variant.params || [] });
      option.textContent =
        variant.displayName && variant.displayName !== model.displayName
          ? `${model.displayName} · ${variant.displayName}`
          : model.displayName;
      el.model.append(option);
    }
  }

  if ([...el.model.options].some((o) => o.value === previous)) el.model.value = previous;
  el.modelStatus.textContent = source;
  syncModelBadge();
}

async function loadModels() {
  renderModelOptions(FALLBACK_MODELS, "fallback");
  try {
    const response = await cursorJson("/v1/models", undefined, "GET");
    if (Array.isArray(response.items) && response.items.length) {
      renderModelOptions(response.items, "live");
    }
  } catch {
    el.modelStatus.textContent = "fallback";
  }
}

function imagePayload(images) {
  return images.map((image) => ({ data: image.data, mimeType: image.mimeType }));
}

function createPayload(text, images) {
  const payload = { prompt: { text, images }, mode: el.mode.value };
  const model = decodeModel(el.model.value);
  if (model) {
    payload.model = { id: model.id };
    if (model.params?.length) payload.model.params = model.params;
  }
  const repoUrl = el.repoUrl.value.trim();
  if (repoUrl) {
    const repo = { url: repoUrl };
    if (el.startingRef.value.trim()) repo.startingRef = el.startingRef.value.trim();
    if (el.prUrl.value.trim()) repo.prUrl = el.prUrl.value.trim();
    payload.repos = [repo];
    payload.autoCreatePR = el.autoPr.checked;
    payload.workOnCurrentBranch = el.currentBranch.checked;
  }
  return payload;
}

async function createAgent(text, images) {
  const conversation = activeConversation();
  const result = await cursorJson("/v1/agents", createPayload(text, images));
  conversation.agentId = result.agent?.id || "";
  conversation.runId = result.run?.id || result.agent?.latestRunId || "";
  conversation.agentUrl = result.agent?.url || "";
  saveConversations();
  updateMeta();
  return result.run;
}

async function followUp(text, images) {
  const conversation = activeConversation();
  const run = await cursorJson(`/v1/agents/${encodeURIComponent(conversation.agentId)}/runs`, {
    prompt: { text, images },
    mode: el.mode.value,
  });
  conversation.runId = run.id;
  saveConversations();
  updateMeta();
  return run;
}

/* ---------- streaming ---------- */
function parseSse(block) {
  const event = { type: "message", data: "" };
  const data = [];
  for (const raw of block.split(/\r?\n/)) {
    const line = raw.trimEnd();
    if (!line || line.startsWith(":")) continue;
    if (line.startsWith("event:")) event.type = line.slice(6).trim();
    if (line.startsWith("data:")) data.push(line.slice(5).trimStart());
  }
  event.data = data.join("\n");
  return event;
}

function gitSummary(message, data) {
  if (!data?.git?.branches?.length) return;
  addTool(
    message,
    `Git: ${data.git.branches.map((b) => b.prUrl || b.branch || b.repoUrl).join(" | ")}`,
  );
}

async function getRun(agentId, runId) {
  return cursorJson(
    `/v1/agents/${encodeURIComponent(agentId)}/runs/${encodeURIComponent(runId)}`,
    undefined,
    "GET",
  );
}

async function streamRun(agentId, runId, message) {
  const response = await fetch(
    `/api/cursor/v1/agents/${encodeURIComponent(agentId)}/runs/${encodeURIComponent(runId)}/stream`,
    { method: "GET", headers: { ...headers(false), Accept: "text/event-stream" } },
  );

  if (!response.ok) {
    if (response.status === 410) {
      const run = await getRun(agentId, runId);
      updateMessage(message, run.result || "Stream đã hết hạn.");
      gitSummary(message, run);
      setRunStatus(run.status || "FINISHED");
      return;
    }
    throw new Error(await errorText(response));
  }

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  const calls = new Map();
  let buffer = "";
  let text = "";

  while (true) {
    const { value, done } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    const blocks = buffer.split(/\n\n/);
    buffer = blocks.pop() || "";

    for (const block of blocks) {
      const event = parseSse(block);
      if (!event.data) continue;
      let data;
      try {
        data = JSON.parse(event.data);
      } catch {
        data = { text: event.data };
      }

      if (event.type === "status") {
        setRunStatus(data.status || "RUNNING");
      } else if (event.type === "assistant") {
        text += data.text || "";
        updateMessage(message, text);
        scrollBottom();
      } else if (event.type === "tool_call") {
        const key = data.callId || data.call_id || data.name || uid("tool");
        const line = `${data.name || "tool"} · ${data.status || "running"}`;
        if (calls.get(key) !== line) {
          calls.set(key, line);
          addTool(message, line);
        }
      } else if (event.type === "thinking") {
        setRunStatus("THINKING");
      } else if (event.type === "result") {
        if (!text && data.text) updateMessage(message, data.text);
        gitSummary(message, data);
        setRunStatus(data.status || "FINISHED");
      } else if (event.type === "error") {
        updateMessage(message, `Lỗi stream: ${data.message || data.code || "unknown"}`);
        setRunStatus("ERROR");
      }
    }
  }
}

/* ---------- send ---------- */
function setBusy(busy) {
  state.busy = busy;
  el.send.disabled = busy;
  el.prompt.disabled = busy;
  el.imageInput.disabled = busy;
}

async function send(event) {
  event.preventDefault();
  if (state.busy) return;

  const rawText = el.prompt.value.trim();
  const file = activeFile();
  const hasCode = el.includeCode.checked && file?.content.trim();
  if (!rawText && !state.uploadedImages.length && !hasCode) return el.prompt.focus();

  const conversation = activeConversation();
  conversation.agentId = el.agentId.value.trim();

  const images = [...state.uploadedImages];
  const promptText = promptWithCode(rawText || "Xem ảnh/context code và đề xuất bước tiếp theo.");
  const promptImages = imagePayload(images);

  addMessage("user", rawText || "(gửi ảnh hoặc code context)", { images });
  el.prompt.value = "";
  autoGrow();
  state.uploadedImages = [];
  renderImages();

  const assistant = addMessage("assistant", "");
  try {
    setBusy(true);
    setStatus(el.connection, "calling", "warn");
    setRunStatus("CREATING");

    const run = conversation.agentId
      ? await followUp(promptText, promptImages)
      : await createAgent(promptText, promptImages);

    conversation.runId = run?.id || conversation.runId;
    saveConversations();
    updateMeta();
    setStatus(el.connection, "connected", "good");
    await streamRun(conversation.agentId, conversation.runId, assistant.message);
  } catch (error) {
    updateMessage(assistant.message, `Không gửi được request: ${error.message}`);
    setStatus(el.connection, "error", "bad");
    setRunStatus("ERROR");
  } finally {
    setBusy(false);
    renderConversationList();
    scrollBottom();
  }
}

/* ---------- misc ---------- */
function autoGrow() {
  el.prompt.style.height = "auto";
  el.prompt.style.height = `${Math.min(el.prompt.scrollHeight, 220)}px`;
}

function rememberKey() {
  localStorage.setItem(store.remember, String(el.rememberKey.checked));
  if (el.rememberKey.checked) localStorage.setItem(store.key, el.apiKey.value.trim());
  else localStorage.removeItem(store.key);
}

function initKey() {
  el.rememberKey.checked = localStorage.getItem(store.remember) === "true";
  if (el.rememberKey.checked) el.apiKey.value = localStorage.getItem(store.key) || "";
  setStatus(el.connection, el.apiKey.value ? "key saved" : "ready", el.apiKey.value ? "good" : "");
}

function clearActiveChat() {
  const conversation = activeConversation();
  if (!conversation) return;
  conversation.messages = [];
  conversation.agentId = "";
  conversation.runId = "";
  conversation.agentUrl = "";
  conversation.title = "Đoạn chat mới";
  saveConversations();
  renderApp();
}

function isFileDrag(event) {
  return Array.from(event.dataTransfer?.types || []).includes("Files");
}

function bindDropAndPaste() {
  let depth = 0;

  document.addEventListener("dragenter", (event) => {
    if (!isFileDrag(event)) return;
    event.preventDefault();
    depth += 1;
    el.appShell.classList.add("drag-active");
  });

  document.addEventListener("dragover", (event) => {
    if (isFileDrag(event)) event.preventDefault();
  });

  document.addEventListener("dragleave", (event) => {
    if (!isFileDrag(event)) return;
    depth = Math.max(0, depth - 1);
    if (depth === 0) el.appShell.classList.remove("drag-active");
  });

  document.addEventListener("drop", (event) => {
    if (!isFileDrag(event)) return;
    event.preventDefault();
    depth = 0;
    el.appShell.classList.remove("drag-active");
    addFiles(event.dataTransfer.files);
  });

  el.prompt.addEventListener("paste", (event) => {
    const files = Array.from(event.clipboardData?.files || []);
    if (files.length) {
      event.preventDefault();
      addFiles(files);
    }
  });
}

function handleCodeBlockClick(event) {
  const block = event.target.closest(".code-block");
  if (!block) return;
  const code = block.querySelector("code")?.textContent || "";
  const lang = block.dataset.lang || "text";

  if (event.target.closest(".code-copy")) {
    navigator.clipboard.writeText(code);
    const button = event.target.closest(".code-copy");
    const original = button.textContent;
    button.textContent = "Đã copy";
    setTimeout(() => {
      button.textContent = original;
    }, 1200);
    return;
  }

  if (event.target.closest(".code-open")) {
    const ext = languageToExtension(lang);
    newFile(`agent-code-${state.files.length + 1}.${ext}`, lang, code);
  }
}

function bind() {
  el.rememberKey.addEventListener("change", rememberKey);
  el.apiKey.addEventListener("input", () => {
    rememberKey();
    setStatus(el.connection, el.apiKey.value.trim() ? "key saved" : "ready", el.apiKey.value.trim() ? "good" : "");
    window.clearTimeout(modelLoadTimer);
    modelLoadTimer = window.setTimeout(loadModels, 350);
  });
  el.agentId.addEventListener("input", () => {
    const conversation = activeConversation();
    if (!conversation) return;
    conversation.agentId = el.agentId.value.trim();
    saveConversations();
  });

  el.newChat.addEventListener("click", () => {
    createConversation();
    renderApp();
    el.prompt.focus();
  });
  el.clearAllChats.addEventListener("click", () => {
    if (!window.confirm("Xoá toàn bộ đoạn chat đã lưu?")) return;
    state.conversations = [];
    createConversation({ save: false });
    saveConversations();
    renderApp();
  });
  el.clearChat.addEventListener("click", clearActiveChat);

  el.composer.addEventListener("submit", send);
  el.prompt.addEventListener("input", autoGrow);
  el.prompt.addEventListener("keydown", (event) => {
    if (event.key === "Enter" && !event.shiftKey) {
      event.preventDefault();
      el.composer.requestSubmit();
    }
  });

  el.imageInput.addEventListener("change", (event) => addFiles(event.target.files));
  el.clearImages.addEventListener("click", () => {
    state.uploadedImages = [];
    renderImages();
  });

  el.model.addEventListener("change", syncModelBadge);

  el.toggleCode.addEventListener("click", () => setCodeOpen(!state.codeOpen));
  el.closeCode.addEventListener("click", () => setCodeOpen(false));
  el.codeScrim.addEventListener("click", () => setCodeOpen(false));
  el.newFile.addEventListener("click", () => {
    newFile();
    el.fileName.focus();
  });
  el.fileName.addEventListener("input", () => updateFile({ name: el.fileName.value }));
  el.language.addEventListener("change", () => updateFile({ language: el.language.value }));
  el.codeEditor.addEventListener("input", () => updateFile({ content: el.codeEditor.value }));
  el.copyCode.addEventListener("click", async () => {
    const file = activeFile();
    if (!file) return notice("Chưa có tab code để copy.");
    await navigator.clipboard.writeText(file.content);
  });
  el.insertPrompt.addEventListener("click", insertCode);

  el.messageList.addEventListener("click", handleCodeBlockClick);

  document.addEventListener("keydown", (event) => {
    if (event.key === "Escape" && state.codeOpen) setCodeOpen(false);
  });
}

initKey();
loadModels();
renderApp();
renderImages();
autoGrow();
bind();
bindDropAndPaste();
