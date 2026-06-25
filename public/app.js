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
  agent: "cursorChatStudio.agentId",
  files: "cursorChatStudio.files",
  active: "cursorChatStudio.activeFileId",
};

const $ = (id) => document.getElementById(id);
const el = {
  apiKey: $("apiKeyInput"),
  rememberKey: $("rememberKeyInput"),
  connection: $("connectionState"),
  agentId: $("agentIdInput"),
  model: $("modelInput"),
  modelStatus: $("modelStatus"),
  mode: $("modeInput"),
  repoUrl: $("repoUrlInput"),
  startingRef: $("startingRefInput"),
  prUrl: $("prUrlInput"),
  autoPr: $("autoPrInput"),
  currentBranch: $("currentBranchInput"),
  runStatus: $("runStatus"),
  agentMeta: $("agentMeta"),
  runMeta: $("runMeta"),
  agentLink: $("agentLink"),
  messageList: $("messageList"),
  clearChat: $("clearChatButton"),
  newAgent: $("newAgentButton"),
  composer: $("composerForm"),
  prompt: $("promptInput"),
  imageInput: $("imageInput"),
  imagePreviewList: $("imagePreviewList"),
  clearImages: $("clearImagesButton"),
  includeCode: $("includeCodeInput"),
  send: $("sendButton"),
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
  agentId: localStorage.getItem(store.agent) || "",
  runId: "",
  uploadedImages: [],
  files: loadFiles(),
  activeFileId: localStorage.getItem(store.active) || "",
  importedCodeBlocks: new Set(),
  busy: false,
};
let modelLoadTimer;

if (state.files.length && !state.files.some((file) => file.id === state.activeFileId)) {
  state.activeFileId = state.files[0].id;
}

function loadFiles() {
  try {
    const parsed = JSON.parse(localStorage.getItem(store.files) || "[]");
    if (Array.isArray(parsed) && parsed.length) return parsed;
  } catch {
    // Fall through to an empty workspace.
  }
  return [];
}

function saveFiles() {
  localStorage.setItem(store.files, JSON.stringify(state.files));
  if (state.activeFileId) {
    localStorage.setItem(store.active, state.activeFileId);
  } else {
    localStorage.removeItem(store.active);
  }
}

function activeFile() {
  return state.files.find((file) => file.id === state.activeFileId) || null;
}

function pill(node, text, variant = "muted") {
  node.textContent = text;
  node.className = `pill ${variant}`;
}

function statusClass(status) {
  if (status === "FINISHED") return "success";
  if (["ERROR", "CANCELLED", "EXPIRED"].includes(status)) return "error";
  if (["CREATING", "RUNNING", "THINKING"].includes(status)) return "warning";
  return "muted";
}

function updateMeta(url = "") {
  el.agentId.value = state.agentId;
  el.agentMeta.textContent = state.agentId || "-";
  el.runMeta.textContent = state.runId || "-";
  if (state.agentId) {
    localStorage.setItem(store.agent, state.agentId);
    el.agentLink.href = url || `https://cursor.com/agents/${state.agentId}`;
    el.agentLink.classList.remove("hidden");
  } else {
    localStorage.removeItem(store.agent);
    el.agentLink.classList.add("hidden");
  }
}

function setBusy(busy) {
  state.busy = busy;
  el.send.disabled = busy;
  el.prompt.disabled = busy;
  el.imageInput.disabled = busy;
  el.send.textContent = busy ? "Đang gửi..." : "Gửi";
}

function bottom() {
  el.messageList.scrollTop = el.messageList.scrollHeight;
}

function addMessage(role, text, options = {}) {
  const article = document.createElement("article");
  article.className = `message ${role}`;

  const avatar = document.createElement("div");
  avatar.className = "avatar";
  avatar.textContent = role === "user" ? "ME" : "AI";

  const bubble = document.createElement("div");
  bubble.className = "bubble";

  const meta = document.createElement("div");
  meta.className = "message-meta";
  meta.textContent = options.meta || (role === "user" ? "Bạn" : "Cursor Agent");

  const body = document.createElement("div");
  body.className = "message-text";
  body.textContent = text;

  bubble.append(meta, body);

  if (options.images?.length) {
    const wrap = document.createElement("div");
    wrap.className = "message-images";
    for (const image of options.images) {
      const img = document.createElement("img");
      img.src = image.dataUrl;
      img.alt = image.name;
      wrap.append(img);
    }
    bubble.append(wrap);
  }

  const tools = document.createElement("div");
  tools.className = "tool-list hidden";
  bubble.append(tools);
  article.append(avatar, bubble);
  el.messageList.append(article);
  bottom();
  return { body, tools };
}

function notice(text) {
  addMessage("assistant", text, { meta: "Thông báo" });
}

function renderImages() {
  el.imagePreviewList.innerHTML = "";
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

function renderTabs() {
  el.fileTabs.innerHTML = "";
  el.includeCode.disabled = state.files.length === 0;
  if (!state.files.length) {
    el.includeCode.checked = false;
  }

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
    id: crypto.randomUUID(),
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
  return JSON.stringify({
    id: selection.id,
    params: selection.params || [],
  });
}

function decodeModelSelection(value) {
  if (!value) return null;
  try {
    const parsed = JSON.parse(value);
    if (parsed?.id) return parsed;
  } catch {
    return { id: value };
  }
  return null;
}

function renderModelOptions(models, sourceLabel) {
  const previousValue = el.model.value;
  el.model.innerHTML = "";

  const defaultOption = document.createElement("option");
  defaultOption.value = "";
  defaultOption.textContent = "Default của Cursor";
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
      option.textContent = variant.displayName && variant.displayName !== model.displayName
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
    if (selectedModel.params?.length) {
      payload.model.params = selectedModel.params;
    }
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
  const result = await cursorJson("/v1/agents", createPayload(text, images));
  state.agentId = result.agent?.id || "";
  state.runId = result.run?.id || result.agent?.latestRunId || "";
  updateMeta(result.agent?.url);
  return result.run;
}

async function followUp(text, images) {
  const run = await cursorJson(`/v1/agents/${encodeURIComponent(state.agentId)}/runs`, {
    prompt: { text, images },
    mode: el.mode.value,
  });
  state.runId = run.id;
  updateMeta();
  return run;
}

function toolLine(toolWrap, calls, data) {
  toolWrap.classList.remove("hidden");
  const id = data.callId || data.call_id || data.name || crypto.randomUUID();
  let item = calls.get(id);
  if (!item) {
    item = document.createElement("div");
    item.className = "tool-item";
    toolWrap.append(item);
    calls.set(id, item);
  }
  item.textContent = `${data.name || "tool"} · ${data.status || "running"}`;
  bottom();
}

function gitLine(toolWrap, data) {
  if (!data?.git?.branches?.length) return;
  toolWrap.classList.remove("hidden");
  const item = document.createElement("div");
  item.className = "tool-item";
  item.textContent = `Git: ${data.git.branches
    .map((branch) => branch.prUrl || branch.branch || branch.repoUrl)
    .join(" | ")}`;
  toolWrap.append(item);
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

async function streamRun(agentId, runId, message) {
  const response = await fetch(
    `/api/cursor/v1/agents/${encodeURIComponent(agentId)}/runs/${encodeURIComponent(runId)}/stream`,
    { method: "GET", headers: { ...headers(false), Accept: "text/event-stream" } },
  );

  if (!response.ok) {
    if (response.status === 410) {
      const run = await getRun(agentId, runId);
      message.body.textContent = run.result || "Stream đã hết hạn.";
      gitLine(message.tools, run);
      pill(el.runStatus, run.status || "FINISHED", statusClass(run.status));
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
        pill(el.runStatus, data.status || "RUNNING", statusClass(data.status));
      } else if (event.type === "assistant") {
        text += data.text || "";
        message.body.textContent = text || "Đang xử lý...";
        syncCodeBlocksFromAssistant(text);
        bottom();
      } else if (event.type === "tool_call") {
        toolLine(message.tools, calls, data);
      } else if (event.type === "thinking") {
        pill(el.runStatus, "THINKING", "warning");
      } else if (event.type === "result") {
        if (!text && data.text) message.body.textContent = data.text;
        syncCodeBlocksFromAssistant(text || data.text || "");
        gitLine(message.tools, data);
        pill(el.runStatus, data.status || "FINISHED", statusClass(data.status));
      } else if (event.type === "error") {
        message.body.textContent = `Lỗi stream: ${data.message || data.code || "unknown"}`;
        pill(el.runStatus, "ERROR", "error");
      }
    }
  }
}

async function send(event) {
  event.preventDefault();
  if (state.busy) return;

  const rawText = el.prompt.value.trim();
  const file = activeFile();
  const hasCode = el.includeCode.checked && file?.content.trim();
  if (!rawText && !state.uploadedImages.length && !hasCode) return el.prompt.focus();

  state.agentId = el.agentId.value.trim();
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
    pill(el.connection, "Đang gọi API", "warning");
    pill(el.runStatus, "CREATING", "warning");

    const run = state.agentId
      ? await followUp(promptText, promptImages)
      : await createAgent(promptText, promptImages);

    state.runId = run?.id || state.runId;
    updateMeta();
    pill(el.connection, "Đã kết nối", "success");
    await streamRun(state.agentId, state.runId, assistant);
  } catch (error) {
    assistant.body.textContent = `Không gửi được request: ${error.message}`;
    pill(el.connection, "Lỗi", "error");
    pill(el.runStatus, "ERROR", "error");
  } finally {
    setBusy(false);
    bottom();
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
  pill(el.connection, el.apiKey.value ? "Có API key" : "Sẵn sàng");
}

function bind() {
  el.rememberKey.addEventListener("change", rememberKey);
  el.apiKey.addEventListener("input", () => {
    rememberKey();
    pill(el.connection, el.apiKey.value.trim() ? "Có API key" : "Sẵn sàng");
    window.clearTimeout(modelLoadTimer);
    modelLoadTimer = window.setTimeout(loadModels, 350);
  });
  el.agentId.addEventListener("input", () => {
    state.agentId = el.agentId.value.trim();
    updateMeta();
  });
  el.newAgent.addEventListener("click", () => {
    state.agentId = "";
    state.runId = "";
    updateMeta();
    pill(el.runStatus, "idle");
    notice("Phiên mới đã sẵn sàng. Tin nhắn tiếp theo sẽ tạo Cursor Agent mới.");
  });
  el.clearChat.addEventListener("click", () => {
    el.messageList.innerHTML = "";
    addMessage("assistant", "Đã xoá chat khỏi giao diện. Agent trên Cursor không bị xoá.", {
      meta: "Cursor Chat Studio",
    });
  });
  el.composer.addEventListener("submit", send);
  el.imageInput.addEventListener("change", (event) => addImages(event.target.files));
  el.clearImages.addEventListener("click", () => {
    state.uploadedImages = [];
    renderImages();
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
renderTabs();
renderEditor();
updateMeta();
bind();
