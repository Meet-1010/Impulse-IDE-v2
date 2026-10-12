/**
 * Ollama: models that run on this computer, free and without an API key.
 *
 * Talks to the local Ollama server (http://127.0.0.1:11434, or OLLAMA_HOST)
 * through its native API, which takes tool definitions and a context size per
 * request. The agent speaks OpenAI-style messages; they're converted here.
 * Model ids carry an `ollama:` prefix (`ollama:qwen2.5-coder:7b`) so the rest
 * of the app can tell which provider a model belongs to.
 */
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawn } = require('child_process');
const BaseProvider = require('./baseProvider');
const { getAllTools } = require('../tools/toolSchema');

const PREFIX = 'ollama:';
const DEFAULT_PORT = 11434;
// The system prompt and tool schemas are ~3.5k tokens; Ollama's default
// context (4k) would cut the conversation off almost at once.
const MAX_CONTEXT = 16384;
const NO_TOOLS_NOTE = '\n\n_This model can\'t use Impulse\'s tools, so it answered in text and didn\'t touch your sketch. For the agent, pick a model with tool support, such as qwen3 or llama3.1._';

/** The server's base URL, following OLLAMA_HOST the way the ollama CLI does. */
function ollamaBaseUrl(env = process.env) {
  let host = String(env.OLLAMA_HOST || '').trim();
  if (!host) return `http://127.0.0.1:${DEFAULT_PORT}`;
  if (!/^https?:\/\//i.test(host)) host = `http://${host}`;
  let url;
  try {
    url = new URL(host);
  } catch {
    return `http://127.0.0.1:${DEFAULT_PORT}`;
  }
  // 0.0.0.0 is where the server listens, not an address to connect to.
  if (url.hostname === '0.0.0.0' || url.hostname === '::' || url.hostname === '[::]') url.hostname = '127.0.0.1';
  if (!url.port && url.protocol === 'http:') url.port = String(DEFAULT_PORT);
  return url.origin;
}

/** `qwen2.5-coder:7b` → `Qwen2.5 Coder 7B`; the `latest` tag is left out. */
function displayNameFor(name) {
  const [base, tag] = String(name).split(':');
  const words = base.split(/[-_/]/).filter(Boolean).map((w) => w.charAt(0).toUpperCase() + w.slice(1));
  if (tag && tag !== 'latest') words.push(/^[\d.]+[bmk]$/i.test(tag) ? tag.toUpperCase() : tag);
  return words.join(' ');
}

/** Tool calls in the native API carry no id; the agent pairs results by one. */
let callCounter = 0;
const nextCallId = () => `ollama_call_${Date.now().toString(36)}_${(callCounter++).toString(36)}`;

/** Some models think out loud in <think> tags; the chat shows only the answer. */
const stripThinking = (text) => String(text || '').replace(/<think>[\s\S]*?<\/think>/gi, '').trim();

function parseArguments(args) {
  if (args && typeof args === 'object') return args;
  if (typeof args === 'string' && args.trim()) {
    try {
      return JSON.parse(args);
    } catch {
      return {};
    }
  }
  return {};
}

/** A string argument written with escaped newlines (`\\n`) instead of real ones. */
function unescapeIfFlat(value) {
  if (typeof value !== 'string' || value.includes('\n') || !value.includes('\\n')) return value;
  return value.replace(/\\r\\n|\\n/g, '\n').replace(/\\t/g, '\t').replace(/\\"/g, '"');
}

/** Every balanced top-level {...} in a text, skipping braces inside strings. */
function topLevelObjects(text) {
  const out = [];
  let depth = 0,
    start = -1,
    inString = false,
    escaped = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (inString) {
      if (escaped) escaped = false;
      else if (ch === '\\') escaped = true;
      else if (ch === '"') inString = false;
    } else if (ch === '"' && depth > 0) inString = true;
    else if (ch === '{') {
      if (depth === 0) start = i;
      depth++;
    } else if (ch === '}' && depth > 0) {
      depth--;
      if (depth === 0) out.push(text.slice(start, i + 1));
    }
  }
  return out;
}

/**
 * Small local models often write a tool call as JSON in the answer instead of
 * a structured call: a ```json block, a <tool_call> tag, or the bare object.
 * Recover those that name one of the offered tools, so the agent still acts.
 * @param {string} content
 * @param {Array<{ name: string, parameters?: object }>} tools
 * @returns {{ calls: Array<{ name: string, arguments: object }>, rest: string }}
 */
function textToolCalls(content, tools) {
  const byName = new Map((tools || []).map((t) => [t.name, t]));
  const calls = [];
  let rest = String(content || '');
  const candidates = [];
  const blocks = /```(?:json|tool_call)?\s*([\s\S]*?)```|<tool_call>\s*([\s\S]*?)<\/tool_call>/gi;
  let m;
  while ((m = blocks.exec(rest))) candidates.push({ raw: m[0], json: m[1] ?? m[2] });
  if (!candidates.length) for (const raw of topLevelObjects(rest)) candidates.push({ raw, json: raw });
  for (const { raw, json } of candidates) {
    const before = calls.length;
    let parsed;
    try {
      parsed = JSON.parse(json.trim());
    } catch {
      continue;
    }
    for (const item of Array.isArray(parsed) ? parsed : [parsed]) {
      const name = item?.name ?? item?.function?.name;
      const tool = byName.get(name);
      if (!tool) continue;
      let args = item.arguments ?? item.parameters ?? item.function?.arguments ?? {};
      if (typeof args === 'string') {
        const asJson = parseArguments(args);
        const required = tool.parameters?.required || [];
        // A bare string for a tool with one required argument is that argument.
        args = Object.keys(asJson).length || required.length !== 1 ? asJson : { [required[0]]: args };
      }
      for (const key of Object.keys(args)) args[key] = unescapeIfFlat(args[key]);
      calls.push({ name, arguments: args });
    }
    if (calls.length > before) rest = rest.replace(raw, '');
  }
  return { calls, rest: rest.trim() };
}

class OllamaProvider extends BaseProvider {
  static PREFIX = PREFIX;

  /** The models found by the last listModels(), newest first. */
  static models = [];

  /** The last server check: { running, version?, error? }. */
  static status = { running: false };

  static baseUrl() {
    return ollamaBaseUrl();
  }

  static isModelId(id) {
    return typeof id === 'string' && id.toLowerCase().startsWith(PREFIX);
  }

  static displayName(id) {
    const found = OllamaProvider.models.find((m) => m.id === id);
    if (found) return found.displayName;
    return OllamaProvider.isModelId(id) ? displayNameFor(id.slice(PREFIX.length)) : id;
  }

  /**
   * Ask the local server which models are installed and what each can do.
   * Never throws: when Ollama isn't running the list is empty and status says so.
   * @param {{ timeoutMs?: number, fetchImpl?: typeof fetch }} [opts]
   */
  static async listModels({ timeoutMs = 1500, fetchImpl = fetch } = {}) {
    const base = OllamaProvider.baseUrl();
    try {
      const res = await fetchImpl(`${base}/api/tags`, { signal: AbortSignal.timeout(timeoutMs) });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = await res.json();
      const tags = Array.isArray(data?.models) ? data.models : [];
      tags.sort((a, b) => String(b.modified_at || '').localeCompare(String(a.modified_at || '')));
      const models = await Promise.all(tags.map(async (t) => {
        const name = t.name || t.model;
        const info = { id: PREFIX + name, name, displayName: displayNameFor(name), tools: null, thinking: false, contextLength: null, size: t.size || 0 };
        try {
          const show = await fetchImpl(`${base}/api/show`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ model: name }),
            signal: AbortSignal.timeout(timeoutMs * 2),
          });
          if (show.ok) {
            const detail = await show.json();
            if (Array.isArray(detail.capabilities)) {
              info.tools = detail.capabilities.includes('tools');
              info.thinking = detail.capabilities.includes('thinking');
            }
            const ctxKey = Object.keys(detail.model_info || {}).find((k) => k.endsWith('.context_length'));
            if (ctxKey) info.contextLength = Number(detail.model_info[ctxKey]) || null;
          }
        } catch { /* capabilities stay unknown: tools are tried and dropped if refused */ }
        return info;
      }));
      // Embedding-only models can't chat.
      OllamaProvider.models = models.filter((m) => !/embed/i.test(m.name));
      OllamaProvider.status = { running: true };
    } catch (error) {
      OllamaProvider.models = [];
      OllamaProvider.status = { running: false, error: error?.name === 'TimeoutError' ? 'timeout' : String(error?.message || error) };
    }
    return { ...OllamaProvider.status, models: OllamaProvider.models };
  }

  /**
   * The model to offer when none is installed: Qwen3 calls tools reliably.
   * The 8B needs about 16 GB of memory to run alongside the IDE; else the 4B.
   */
  static recommendedModel(totalMem = os.totalmem()) {
    return totalMem >= 15 * 1024 ** 3
      ? { name: 'qwen3:8b', displayName: 'Qwen3 8B', size: '5.2 GB' }
      : { name: 'qwen3:4b', displayName: 'Qwen3 4B', size: '2.5 GB' };
  }

  /**
   * Download a model with progress: { status, percent | null }.
   * @param {string} model
   * @param {(p: { status: string, percent: number | null }) => void} [onProgress]
   */
  static async pull(model, onProgress = () => {}, { fetchImpl = fetch } = {}) {
    let res;
    try {
      res = await fetchImpl(`${OllamaProvider.baseUrl()}/api/pull`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ model, stream: true }),
      });
    } catch {
      return { success: false, error: 'Ollama isn\'t running.' };
    }
    if (!res.ok || !res.body) return { success: false, error: `Ollama: ${await res.text().catch(() => res.status)}` };
    const decoder = new TextDecoder();
    let buffered = '';
    let failed = null;
    for await (const chunk of res.body) {
      buffered += decoder.decode(chunk, { stream: true });
      let nl;
      while ((nl = buffered.indexOf('\n')) >= 0) {
        const line = buffered.slice(0, nl).trim();
        buffered = buffered.slice(nl + 1);
        if (!line) continue;
        let msg;
        try {
          msg = JSON.parse(line);
        } catch {
          continue;
        }
        if (msg.error) failed = msg.error;
        else onProgress({ status: msg.status || '', percent: msg.total ? Math.floor((100 * (msg.completed || 0)) / msg.total) : null });
      }
    }
    if (failed) return { success: false, error: `Ollama: ${failed}` };
    await OllamaProvider.listModels();
    return { success: true, id: PREFIX + model };
  }

  /** Where the ollama program is, if it's installed. */
  static findInstall({ platform = process.platform, env = process.env, exists = fs.existsSync } = {}) {
    const home = os.homedir();
    if (platform === 'darwin') {
      for (const app of ['/Applications/Ollama.app', path.join(home, 'Applications', 'Ollama.app')]) {
        if (exists(app)) return { app };
      }
    }
    const local = env.LOCALAPPDATA || path.join(home, 'AppData', 'Local');
    const candidates = platform === 'win32'
      ? [path.join(local, 'Programs', 'Ollama', 'ollama.exe')]
      : ['/usr/local/bin/ollama', '/opt/homebrew/bin/ollama', '/usr/bin/ollama', path.join(home, '.local', 'bin', 'ollama')];
    for (const bin of candidates) if (exists(bin)) return { bin };
    return null;
  }

  /**
   * Start the Ollama server (the menu-bar app on macOS) and wait until it answers.
   * @returns {Promise<{ success: boolean, running?: boolean, notInstalled?: boolean, error?: string }>}
   */
  static async start({ waitMs = 20000 } = {}) {
    const ping = async () => {
      try {
        const res = await fetch(`${OllamaProvider.baseUrl()}/api/version`, { signal: AbortSignal.timeout(1000) });
        return res.ok;
      } catch {
        return false;
      }
    };
    if (await ping()) return { success: true, running: true };
    const install = OllamaProvider.findInstall();
    if (!install) return { success: false, notInstalled: true, error: 'Ollama isn\'t installed.' };
    try {
      const child = install.app
        ? spawn('open', ['-a', install.app], { detached: true, stdio: 'ignore' })
        : spawn(install.bin, ['serve'], { detached: true, stdio: 'ignore', windowsHide: true });
      child.on('error', () => {});
      child.unref();
    } catch (error) {
      return { success: false, error: `Couldn't start Ollama: ${error?.message || error}` };
    }
    const deadline = Date.now() + waitMs;
    while (Date.now() < deadline) {
      if (await ping()) return { success: true, running: true };
      await new Promise((r) => setTimeout(r, 500));
    }
    return { success: false, error: 'Ollama didn\'t start in time. Open the Ollama app, then try again.' };
  }

  constructor(apiKey, model = null) {
    super(apiKey || 'local', model || OllamaProvider.models[0]?.id || null);
    this.name = 'ollama';
    this.fetch = fetch;
  }

  getAvailableModels() {
    return OllamaProvider.models.map((m) => m.id);
  }

  /** Local models need no key. */
  validateApiKey() {
    return true;
  }

  formatTools(tools) {
    return tools.map((tool) => ({
      type: 'function',
      function: { name: tool.name, description: tool.description, parameters: tool.parameters },
    }));
  }

  /** The agent's OpenAI-style history in the shape Ollama's /api/chat takes. */
  toOllamaMessages(messages) {
    return messages.map((m) => {
      if (m.role === 'tool') return { role: 'tool', content: String(m.content ?? ''), tool_name: m.name };
      if (m.role === 'assistant' && Array.isArray(m.tool_calls) && m.tool_calls.length) {
        return {
          role: 'assistant',
          content: m.content || '',
          tool_calls: m.tool_calls.map((tc) => ({
            function: { name: tc.function?.name, arguments: parseArguments(tc.function?.arguments) },
          })),
        };
      }
      return { role: m.role, content: typeof m.content === 'string' ? m.content : JSON.stringify(m.content ?? '') };
    });
  }

  parseToolCalls(message) {
    const calls = Array.isArray(message?.tool_calls) ? message.tool_calls : [];
    return calls
      .filter((tc) => tc?.function?.name)
      .map((tc) => ({ id: nextCallId(), name: tc.function.name, arguments: parseArguments(tc.function.arguments) }));
  }

  async chat(messages, options = {}) {
    const id = this.model || OllamaProvider.models[0]?.id;
    if (!id) throw new Error('No Ollama model is installed. Run "ollama pull qwen3" (or another model), then pick it in the model menu.');
    const name = OllamaProvider.isModelId(id) ? id.slice(PREFIX.length) : id;
    const info = OllamaProvider.models.find((m) => m.id === id) || {};
    const tools = options.tools !== undefined ? options.tools : getAllTools();
    const wantTools = Array.isArray(tools) && tools.length > 0;
    let useTools = wantTools && info.tools !== false;

    const send = async (withTools) => {
      const body = {
        model: name,
        messages: this.toOllamaMessages(messages),
        stream: false,
        keep_alive: '15m',
        options: {
          temperature: options.temperature ?? 0.7,
          num_ctx: Math.min(info.contextLength || MAX_CONTEXT, MAX_CONTEXT),
        },
      };
      if (withTools) body.tools = this.formatTools(tools);
      // Thinking models reason at length before answering; on a laptop that
      // costs minutes per step, so the agent asks for the answer directly.
      if (info.thinking) body.think = false;
      let res;
      try {
        res = await this.fetch(`${OllamaProvider.baseUrl()}/api/chat`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(body),
          // A big model on a laptop can take minutes for its first answer.
          signal: AbortSignal.timeout(10 * 60 * 1000),
        });
      } catch (error) {
        if (error?.name === 'TimeoutError') throw new Error('Ollama took longer than 10 minutes to answer. Try a smaller model.');
        throw new Error('Ollama isn\'t running. Open the Ollama app (or run "ollama serve"), then ask again.');
      }
      const text = await res.text();
      let data = {};
      try {
        data = JSON.parse(text);
      } catch { /* not JSON: reported below */ }
      if (!res.ok) {
        const message = data.error || text || `HTTP ${res.status}`;
        const err = new Error(/not found/i.test(message)
          ? `Ollama doesn't have "${name}". Run "ollama pull ${name}" or pick another model.`
          : `Ollama: ${message}`);
        err.toolsRefused = /does not support tools/i.test(message);
        throw err;
      }
      return data;
    };

    let data;
    try {
      data = await send(useTools);
    } catch (error) {
      if (!error.toolsRefused || !useTools) throw error;
      // The model has no tool support: remember it and answer without tools.
      if (OllamaProvider.models.includes(info)) info.tools = false;
      useTools = false;
      data = await send(false);
    }
    const message = data.message || {};
    let content = stripThinking(message.content);
    let toolCalls = useTools ? this.parseToolCalls(message) : [];
    if (useTools && !toolCalls.length) {
      const recovered = textToolCalls(content, tools);
      if (recovered.calls.length) {
        toolCalls = recovered.calls.map((c) => ({ id: nextCallId(), ...c }));
        content = recovered.rest;
      }
    }
    if (wantTools && !useTools && !toolCalls.length) content += NO_TOOLS_NOTE;
    return {
      content,
      toolCalls,
      usage: { prompt_tokens: data.prompt_eval_count || 0, completion_tokens: data.eval_count || 0 },
      model: id,
    };
  }
}

module.exports = OllamaProvider;
module.exports.ollamaBaseUrl = ollamaBaseUrl;
module.exports.displayNameFor = displayNameFor;
module.exports.textToolCalls = textToolCalls;
