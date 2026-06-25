const MAX_IMAGES = 5;
const MAX_IMAGE_BYTES = 15 * 1024 * 1024;
const IMAGE_TYPES = new Set(["image/png", "image/jpeg", "image/gif", "image/webp"]);
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
  busy: false,
};

if (!state.files.some((file) => file.id === state.activeFileId)) {
  state.activeFileId = state.files[0].id;
}

function loadFiles() {
  try {
    const parsed = JSON.parse(localStorage.getItem(store.files) || "[]");
    if (Array.isArray(parsed) && parsed.length) return parsed;
  } catch {
    // Fall through to starter file.
  }
  return [
    {
      id: crypto.randomUUID(),
      name: "example.ts",
      language: "typescript",
      content:
        "type Message = {\n" +
        "  role: 'user' | 'assistant';\n" +
        "  content: string;\n" +
        "};\n\n" +
        "export function buildPrompt(message: Message) {\n" +
        "  return `${message.role}: ${message.content}`;\n" +
        "}\n",
    },
  ];
}

function saveFiles() {
  localStorage.setItem(store.files, JSON.stringify(state.files));
  localStorage.setItem(store.active, state.activeFileId);
}

function activeFile() {
  return state.files.find((file) => file.id === state.activeFileId) || state.files[0];
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
  el.fileName.value = file.name;
  el.language.value = file.language;
  el.codeEditor.value = file.content;
}

function updateFile(patch) {
  Object.assign(activeFile(), patch);
  saveFiles();
  renderTabs();
}

function newFile() {
  const file = {
    id: crypto.randomUUID(),
    name: `scratch-${state.files.length + 1}.ts`,
    language: "typescript",
    content: "",
  };
  state.files.push(file);
  state.activeFileId = file.id;
  saveFiles();
  renderTabs();
  renderEditor();
}

function insertCode() {
  const file = activeFile();
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
  if (!el.includeCode.checked || !file.content.trim()) return text;
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

function imagePayload(images) {
  return images.map((image) => ({ data: image.data, mimeType: image.mimeType }));
}

function createPayload(text, images) {
  const payload = {
    prompt: { text, images },
    mode: el.mode.value,
  };
  if (el.model.value) payload.model = { id: el.model.value };

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
        bottom();
      } else if (event.type === "tool_call") {
        toolLine(message.tools, calls, data);
      } else if (event.type === "thinking") {
        pill(el.runStatus, "THINKING", "warning");
      } else if (event.type === "result") {
        if (!text && data.text) message.body.textContent = data.text;
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
  const hasCode = el.includeCode.checked && activeFile().content.trim();
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
  el.newFile.addEventListener("click", newFile);
  el.fileName.addEventListener("input", () => updateFile({ name: el.fileName.value }));
  el.language.addEventListener("change", () => updateFile({ language: el.language.value }));
  el.codeEditor.addEventListener("input", () => updateFile({ content: el.codeEditor.value }));
  el.copyCode.addEventListener("click", async () => {
    await navigator.clipboard.writeText(activeFile().content);
    notice("Đã copy code trong tab đang mở.");
  });
  el.insertPrompt.addEventListener("click", insertCode);
}

initKey();
renderTabs();
renderEditor();
updateMeta();
bind();
