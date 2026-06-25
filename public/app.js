const MAX_IMAGES = 5;
const MAX_IMAGE_BYTES = 15 * 1024 * 1024;
const IMAGE_TYPES = new Set(["image/png", "image/jpeg", "image/gif", "image/webp"]);
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
  { id: "claude-opus-4-7-thinking-high-fast", displayName: "Opus 4.7 High Fast" },
  { id: "claude-4.6-sonnet-high-thinking", displayName: "Sonnet 4.6 High" },
  { id: "composer-2.5", displayName: "Composer 2.5" },
];

const store = {
  key: "cursorChatStudio.apiKey",
  remember: "cursorChatStudio.rememberKey",
  conversations: "cursorChatStudio.conversations",
  activeConversation: "cursorChatStudio.activeConversationId",
  files: "cursorChatStudio.files",
  activeFile: "cursorChatStudio.activeFileId",
  codeOpen: "cursorChatStudio.codeOpen",
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

const state = {
  conversations: loadConversations(),
  activeConversationId: localStorage.getItem(store.activeConversation) || "",
  uploadedImages: [],
  files: loadFiles(),
  activeFileId: localStorage.getItem(store.activeFile) || "",
  importedCodeBlocks: new Set(),
  busy: false,
  codeOpen: localStorage.getItem(store.codeOpen) === "true",
};

let modelLoadTimer;

if (!state.conversations.length) {
  createConversation({ activate: true, save: false });
}
if (!state.conversations.some((item) => item.id === state.activeConversationId)) {
  state.activeConversationId = state.conversations[0].id;
}
if (state.files.length && !state.files.some((file) => file.id === state.activeFileId)) {
  state.activeFileId = state.files[0].id;
}

function uid(prefix) {
  return `${prefix}-${crypto.randomUUID()}`;
}

function starterFile(file) {
  return file?.name === "example.ts" && String(file.content || "").includes("buildPrompt");
}

function loadFiles() {
  try {
    const files = JSON.parse(localStorage.getItem(store.files) || "[]");
    if (!Array.isArray(files)) return [];
    if (files.length === 1 && starterFile(files[0])) return [];
    return files;
  } catch {
    return [];
  }
}

function saveFiles() {
  localStorage.setItem(store.files, JSON.stringify(state.files));
  if (state.activeFileId) {
    localStorage.setItem(store.activeFile, state.activeFileId);
  } else {
    localStorage.removeItem(store.activeFile);
  }
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

function activeConversation() {
  return state.conversations.find((item) => item.id === state.activeConversationId);
}

function activeFile() {
  return state.files.find((file) => file.id === state.activeFileId) || null;
}

function createConversation({ activate = true, save = true } = {}) {
  const now = new Date().toISOString();
  const conversation = {
    id: uid("chat"),
    title: "Chat mới",
    agentId: "",
    runId: "",
    agentUrl: "",
    messages: [],
    createdAt: now,
    updatedAt: now,
  };
  state.conversations.unshift(conversation);
  if (activate) state.activeConversationId = conversation.id;
  if (save) saveConversations();
  return conversation;
}

function setStatus(node, text, variant = "") {
  node.textContent = text;
  node.className = variant ? `status-dot ${variant}` : "status-dot";
}

function runVariant(status) {
  if (status === "FINISHED") return "good";
  if (["ERROR", "CANCELLED", "EXPIRED"].includes(status)) return "bad";
  if (["CREATING", "RUNNING", "THINKING"].includes(status)) return "warn";
  return "";
}

function setRunStatus(status) {
  el.runStatus.textContent = status || "idle";
}

function updateConversationFromForm() {
  const conversation = activeConversation();
  if (!conversation) return;
  conversation.agentId = el.agentId.value.trim();
  conversation.updatedAt = new Date().toISOString();
  saveConversations();
  renderConversationList();
}

function updateMeta() {
  const conversation = activeConversation();
  el.chatTitle.textContent = conversation?.title || "Chat mới";
  el.agentId.value = conversation?.agentId || "";
  setRunStatus(conversation?.runId ? "ready" : "idle");

  if (conversation?.agentId) {
    el.agentLink.href = conversation.agentUrl || `https://cursor.com/agents/${conversation.agentId}`;
    el.agentLink.classList.remove("hidden");
  } else {
    el.agentLink.classList.add("hidden");
  }
}

function previewText(conversation) {
  const last = [...conversation.messages].reverse().find((message) => message.text);
  return last?.text || "Chưa có tin nhắn";
}

function renderConversationList() {
  el.conversationList.innerHTML = "";
  for (const conversation of state.conversations) {
    const button = document.createElement("button");
    button.type = "button";
    button.className = `conversation-item${conversation.id === state.activeConversationId ? " active" : ""}`;

    const title = document.createElement("strong");
    title.textContent = conversation.title || "Chat mới";

    const preview = document.createElement("span");
    preview.textContent = previewText(conversation).replace(/\s+/g, " ").slice(0, 74);

    button.append(title, preview);
    button.addEventListener("click", () => {
      state.activeConversationId = conversation.id;
      saveConversations();
      renderApp();
    });
    el.conversationList.append(button);
  }
}

function renderWelcome() {
  const welcome = document.createElement("div");
  welcome.className = "welcome";
  welcome.innerHTML = `
    <p class="eyebrow">Cursor Chat Studio</p>
    <h3>Bắt đầu chat với Cursor Agent</h3>
    <p>Chọn model ngay dưới ô nhập, upload ảnh nếu cần, hoặc bấm "Viết code" để mở workspace. Toàn bộ đoạn chat được lưu trên trình duyệt này.</p>
  `;
  el.messageList.append(welcome);
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

  const meta = document.createElement("div");
  meta.className = "message-meta";
  meta.textContent = message.meta || (message.role === "user" ? "Bạn" : "Cursor Agent");

  const body = document.createElement("div");
  body.className = "message-text";
  body.textContent = message.text || "";

  bubble.append(meta, body);

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
  return { article, body, tools };
}

function renderMessages() {
  el.messageList.innerHTML = "";
  const conversation = activeConversation();
  if (!conversation?.messages.length) {
    renderWelcome();
    return;
  }
  for (const message of conversation.messages) {
    renderMessage(message);
  }
  scrollBottom();
}

function renderApp() {
  renderConversationList();
  renderMessages();
  renderTabs();
  renderEditor();
  updateMeta();
  applyCodeOpen();
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

  if (role === "user" && conversation.title === "Chat mới" && text.trim()) {
    conversation.title = text.trim().replace(/\s+/g, " ").slice(0, 48);
  }

  saveConversations();
  renderConversationList();
  const rendered = renderMessage(message);
  scrollBottom();
  return { message, ...rendered };
}

function updateMessage(message, text) {
  message.text = text;
  message.updatedAt = new Date().toISOString();
  saveConversations();
  const node = el.messageList.querySelector(`[data-message-id="${message.id}"] .message-text`);
  if (node) node.textContent = text;
}

function addTool(message, text) {
  if (!message.tools.includes(text)) {
    message.tools.push(text);
    saveConversations();
  }
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

function renderImages() {
  el.imagePreviewList.innerHTML = "";
  el.clearImages.classList.toggle("hidden", state.uploadedImages.length === 0);

  for (const image of state.uploadedImages) {
    const card = document.createElement("div");
    card.className = "image-card";
    const img = document.createElement("img");
    img.src = image.dataUrl;
    img.alt = image.name;
    const label = document.createElement("span");
    label.textContent = image.name;
    card.append(img, label);
    el.imagePreviewList.append(card);
  }
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

function applyCodeOpen() {
  el.appShell.classList.toggle("code-open", state.codeOpen);
  localStorage.setItem(store.codeOpen, String(state.codeOpen));
}

function openCodePanel() {
  state.codeOpen = true;
  applyCodeOpen();
}

function renderTabs() {
  el.fileTabs.innerHTML = "";
  el.includeCode.disabled = state.files.length === 0;
  if (!state.files.length) el.includeCode.checked = false;

  for (const file of state.files) {
    const button = document.createElement("button");
    button.type = "button";
    button.className = `file-tab${file.id === state.activeFileId ? " active" : ""}`;
    button.textContent = file.name || "untitled";
    button.addEventListener("click", () => {
      state.activeFileId = file.id;
      saveFiles();
      renderTabs();
      renderEditor();
      openCodePanel();
    });
    el.fileTabs.append(button);
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
    language,
    content,
  };
  state.files.push(file);
  state.activeFileId = file.id;
  el.includeCode.checked = true;
  saveFiles();
  renderTabs();
  renderEditor();
  openCodePanel();
  return file;
}

function insertCode() {
  const file = activeFile();
  if (!file) return notice("Chưa có tab code để chèn vào chat.");
  el.prompt.value += [
    "",
    `File: ${file.name}`,
    `\`\`\`${file.language}`,
    file.content,
    "```",
    "",
  ].join("\n");
  el.prompt.focus();
}

function promptWithCode(text) {
  const file = activeFile();
  if (!file || !el.includeCode.checked || !file.content.trim()) return text;
  return [
    text,
    "",
    "---",
    "Code context from the side editor:",
    `File: ${file.name}`,
    `Language: ${file.language}`,
    `\`\`\`${file.language}`,
    file.content,
    "```",
  ].join("\n");
}

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

function encodeModelSelection(selection) {
  return JSON.stringify({ id: selection.id, params: selection.params || [] });
}

function decodeModelSelection(value) {
  if (!value) return null;
  try {
    const parsed = JSON.parse(value);
    if (parsed?.id) return parsed;
  } catch {
    return { id: value, params: [] };
  }
  return null;
}

function renderModelOptions(models, sourceLabel) {
  const previousValue = el.model.value;
  el.model.innerHTML = "";

  const defaultOption = document.createElement("option");
  defaultOption.value = "";
  defaultOption.textContent = "Default";
  el.model.append(defaultOption);

  for (const model of models) {
    const variants = Array.isArray(model.variants) && model.variants.length
      ? model.variants
      : [{ displayName: model.displayName, params: model.params || [] }];

    for (const variant of variants) {
      const option = document.createElement("option");
      option.value = encodeModelSelection({
        id: variant.id || model.id,
        params: variant.params || [],
      });
      option.textContent =
        variant.displayName && variant.displayName !== model.displayName
          ? `${model.displayName} - ${variant.displayName}`
          : model.displayName;
      el.model.append(option);
    }
  }

  if ([...el.model.options].some((option) => option.value === previousValue)) {
    el.model.value = previousValue;
  }
  el.modelStatus.textContent = sourceLabel;
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
  const payload = {
    prompt: { text, images },
    mode: el.mode.value,
  };

  const selectedModel = decodeModelSelection(el.model.value);
  if (selectedModel) {
    payload.model = { id: selectedModel.id };
    if (selectedModel.params?.length) payload.model.params = selectedModel.params;
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
  conversation.updatedAt = new Date().toISOString();
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
  conversation.updatedAt = new Date().toISOString();
  saveConversations();
  updateMeta();
  return run;
}

function languageToExtension(language) {
  const normalized = (language || "text").toLowerCase();
  const map = {
    js: "js",
    javascript: "js",
    ts: "ts",
    typescript: "ts",
    jsx: "jsx",
    tsx: "tsx",
    py: "py",
    python: "py",
    html: "html",
    css: "css",
    json: "json",
    md: "md",
    markdown: "md",
    sh: "sh",
    bash: "sh",
  };
  return map[normalized] || "txt";
}

function normalizeLanguage(language) {
  const normalized = (language || "text").toLowerCase();
  if (normalized === "js") return "javascript";
  if (normalized === "ts") return "typescript";
  if (normalized === "py") return "python";
  if (normalized === "md") return "markdown";
  return normalized;
}

function codeHash(language, content) {
  let hash = 0;
  const input = `${language}\n${content}`;
  for (let index = 0; index < input.length; index += 1) {
    hash = (hash * 31 + input.charCodeAt(index)) >>> 0;
  }
  return hash.toString(36);
}

function syncCodeBlocksFromAssistant(text) {
  const matches = text.matchAll(/```([^\n`]*)\n([\s\S]*?)```/g);
  for (const match of matches) {
    const rawLanguage = match[1].trim().split(/\s+/)[0] || "text";
    const content = match[2].trim();
    if (!content) continue;

    const hash = codeHash(rawLanguage, content);
    if (state.importedCodeBlocks.has(hash)) continue;
    state.importedCodeBlocks.add(hash);

    const language = normalizeLanguage(rawLanguage);
    const extension = languageToExtension(language);
    newFile(`agent-code-${state.files.length + 1}.${extension}`, language, content);
  }
}

function addOrUpdateTool(message, calls, data) {
  const id = data.callId || data.call_id || data.name || uid("tool");
  const text = `${data.name || "tool"} · ${data.status || "running"}`;
  if (calls.get(id) === text) return;
  calls.set(id, text);
  addTool(message, text);
}

function addGitSummary(message, data) {
  if (!data?.git?.branches?.length) return;
  addTool(
    message,
    `Git: ${data.git.branches.map((branch) => branch.prUrl || branch.branch || branch.repoUrl).join(" | ")}`,
  );
}

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

async function getRun(agentId, runId) {
  return cursorJson(
    `/v1/agents/${encodeURIComponent(agentId)}/runs/${encodeURIComponent(runId)}`,
    undefined,
    "GET",
  );
}

async function streamRun(agentId, runId, assistantMessage) {
  const response = await fetch(
    `/api/cursor/v1/agents/${encodeURIComponent(agentId)}/runs/${encodeURIComponent(runId)}/stream`,
    { method: "GET", headers: { ...headers(false), Accept: "text/event-stream" } },
  );

  if (!response.ok) {
    if (response.status === 410) {
      const run = await getRun(agentId, runId);
      updateMessage(assistantMessage, run.result || "Stream đã hết hạn.");
      addGitSummary(assistantMessage, run);
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
        updateMessage(assistantMessage, text || "Đang xử lý...");
        syncCodeBlocksFromAssistant(text);
        scrollBottom();
      } else if (event.type === "tool_call") {
        addOrUpdateTool(assistantMessage, calls, data);
      } else if (event.type === "thinking") {
        setRunStatus("THINKING");
      } else if (event.type === "result") {
        if (!text && data.text) updateMessage(assistantMessage, data.text);
        syncCodeBlocksFromAssistant(text || data.text || "");
        addGitSummary(assistantMessage, data);
        setRunStatus(data.status || "FINISHED");
      } else if (event.type === "error") {
        updateMessage(assistantMessage, `Lỗi stream: ${data.message || data.code || "unknown"}`);
        setRunStatus("ERROR");
      }
    }
  }
}

function setBusy(busy) {
  state.busy = busy;
  el.send.disabled = busy;
  el.prompt.disabled = busy;
  el.imageInput.disabled = busy;
  el.send.textContent = busy ? "..." : "Gửi";
}

async function send(event) {
  event.preventDefault();
  if (state.busy) return;

  const rawText = el.prompt.value.trim();
  const file = activeFile();
  const hasCode = el.includeCode.checked && file?.content.trim();
  if (!rawText && !state.uploadedImages.length && !hasCode) return el.prompt.focus();

  updateConversationFromForm();
  const conversation = activeConversation();
  const images = [...state.uploadedImages];
  const promptText = promptWithCode(rawText || "Hãy xem ảnh/context code và đề xuất bước tiếp theo.");
  const promptImages = imagePayload(images);

  addMessage("user", rawText || "(gửi ảnh hoặc code context)", { images });
  el.prompt.value = "";
  state.uploadedImages = [];
  renderImages();

  const assistant = addMessage("assistant", "Đang tạo run...");
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

function rememberKey() {
  localStorage.setItem(store.remember, String(el.rememberKey.checked));
  if (el.rememberKey.checked) {
    localStorage.setItem(store.key, el.apiKey.value.trim());
  } else {
    localStorage.removeItem(store.key);
  }
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
  conversation.title = "Chat mới";
  conversation.updatedAt = new Date().toISOString();
  saveConversations();
  renderApp();
}

function bind() {
  el.rememberKey.addEventListener("change", rememberKey);
  el.apiKey.addEventListener("input", () => {
    rememberKey();
    setStatus(el.connection, el.apiKey.value.trim() ? "key saved" : "ready", el.apiKey.value.trim() ? "good" : "");
    window.clearTimeout(modelLoadTimer);
    modelLoadTimer = window.setTimeout(loadModels, 350);
  });

  el.agentId.addEventListener("input", updateConversationFromForm);
  el.newChat.addEventListener("click", () => {
    createConversation();
    renderApp();
    el.prompt.focus();
  });
  el.clearAllChats.addEventListener("click", () => {
    if (!window.confirm("Xoá toàn bộ đoạn chat đã lưu trên trình duyệt này?")) return;
    state.conversations = [];
    createConversation({ activate: true, save: false });
    saveConversations();
    renderApp();
  });
  el.clearChat.addEventListener("click", clearActiveChat);
  el.composer.addEventListener("submit", send);
  el.prompt.addEventListener("input", () => {
    el.prompt.style.height = "auto";
    el.prompt.style.height = `${Math.min(el.prompt.scrollHeight, 210)}px`;
  });
  el.imageInput.addEventListener("change", (event) => addImages(event.target.files));
  el.clearImages.addEventListener("click", () => {
    state.uploadedImages = [];
    renderImages();
  });
  el.toggleCode.addEventListener("click", () => {
    state.codeOpen = !state.codeOpen;
    applyCodeOpen();
  });
  el.closeCode.addEventListener("click", () => {
    state.codeOpen = false;
    applyCodeOpen();
  });
  el.newFile.addEventListener("click", () => newFile());
  el.fileName.addEventListener("input", () => updateFile({ name: el.fileName.value }));
  el.language.addEventListener("change", () => updateFile({ language: el.language.value }));
  el.codeEditor.addEventListener("input", () => updateFile({ content: el.codeEditor.value }));
  el.copyCode.addEventListener("click", async () => {
    const file = activeFile();
    if (!file) return notice("Chưa có tab code để copy.");
    await navigator.clipboard.writeText(file.content);
    notice("Đã copy code trong tab đang mở.");
  });
  el.insertPrompt.addEventListener("click", insertCode);
}

initKey();
loadModels();
renderApp();
renderImages();
bind();
