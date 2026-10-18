const { getSystemPrompt } = require('./prompts/systemPrompt');
const { circuitBlock } = require('./knowledge/circuitFacts');
const ToolExecutor = require('./tools/toolExecutor');
const SimpleMemory = require('./memory/simpleMemory');
const ModelPreferences = require('./config/modelPreferences');
const { getCoreTools, getDebugTools, getPlanTools, getPackTools } = require('./tools/toolSchema');
const ImpulseProvider = require('./providers/impulseProvider');
const OllamaProvider = require('./providers/ollamaProvider');

/** Providers that run locally and need no API key. */
const KEYLESS = new Set(['ollama']);

/**
 * AI Agent
 * Main orchestrator for AI-powered Arduino development assistance
 */
/** Tools that change the sketch: after one of them the sketch must compile before the turn ends. */
const CODE_EDIT_TOOLS = new Set(['set_editor_code', 'edit_code', 'replace_in_code']);

/** What a failed verify compile tells the model: the error, the first diagnostic, known fixes. */
function verifySummary(check) {
  const lines = [check.error || 'Compilation failed'];
  if (check.excerpt) lines.push(check.excerpt);
  for (const d of (check.diagnostics || []).slice(0, 5)) lines.push(`${String(d.file || '').split(/[\\/]/).pop()}:${d.line}: ${d.level}: ${d.message}`);
  if (check.knownFixes?.local?.length || check.knownFixes?.shared?.length) lines.push(`knownFixes: ${JSON.stringify(check.knownFixes).slice(0, 1500)}`);
  return lines.join('\n');
}

function safeJson(text) {
  try { return JSON.parse(text) || {}; } catch { return {}; }
}

class AIAgent {
  constructor(arduinoService, serialMonitor, errorMemory, config = {}) {
    this.arduinoService = arduinoService;
    this.serialMonitor = serialMonitor;
    this.errorMemory = errorMemory;
    
    // Initialize simple JSON-based memory (no SQLite dependency)
    this.memory = new SimpleMemory();

    // Model usage tracking + auto-upgrade preferences
    this.modelPrefs = new ModelPreferences();
    
    // Initialize tool executor
    this.toolExecutor = new ToolExecutor(
      arduinoService,
      serialMonitor,
      errorMemory,
      this.memory
    );
    
    // Provider management
    this.providers = new Map();
    this.currentProvider = null;
    /** Extra constructor options per provider, e.g. { impulse: { version } }. */
    this.providerOptions = {};
    this.config = {
      maxIterations: config.maxIterations || 10,
      temperature: config.temperature || 0.7,
      ...config
    };
    
    // Conversation history with sliding window to prevent unbounded growth
    this.conversationHistory = [];
    this.maxHistoryMessages = 40; // ~20 user + 20 assistant turns
  }

  /**
   * Register a provider
   */
  registerProvider(name, provider) {
    this.providers.set(name, provider);
  }

  /**
   * Set current provider
   */
  setProvider(providerName, apiKey, model = null) {
    if (!this.providers.has(providerName)) {
      throw new Error(`Provider ${providerName} not registered`);
    }

    const ProviderClass = this.providers.get(providerName);
    const provider = new ProviderClass(apiKey, model, this.providerOptions[providerName]);
    
    if (!provider.validateApiKey(apiKey)) {
      throw new Error(`Invalid API key for provider ${providerName}`);
    }

    this.currentProvider = provider;
    return provider;
  }

  /**
   * The two ways the agent runs: Impulse Cloud (the account's credits) and
   * Ollama (free models on this computer).
   */
  initializeProviders() {
    this.providers.set('impulse', ImpulseProvider);
    if (this.localModelsEnabled()) this.providers.set('ollama', OllamaProvider);
  }

  /** Whether models on this computer (Ollama) are offered in this build. */
  localModelsEnabled() {
    return this.config.localModels !== false;
  }

  /** Whether a provider works without an API key (models on this computer). */
  static isKeyless(providerName) {
    return KEYLESS.has(providerName);
  }

  /**
   * Look for local models (Ollama). Quick, and never throws.
   * @returns {Promise<{ running: boolean, models: Array<object>, error?: string }>}
   */
  async refreshLocalModels() {
    if (!this.localModelsEnabled()) return { running: false, models: [] };
    return OllamaProvider.listModels();
  }

  /**
   * Get available providers
   */
  getAvailableProviders() {
    return Array.from(this.providers.keys());
  }

  /**
   * Get available models for a provider
   */
  getAvailableModels(providerName = null) {
    if (providerName && this.providers.has(providerName)) {
      const ProviderClass = this.providers.get(providerName);
      const tempInstance = new ProviderClass('temp-key');
      return tempInstance.getAvailableModels();
    }
    if (!this.currentProvider) {
      return [];
    }
    return this.currentProvider.getAvailableModels();
  }

  /**
   * Model ID to provider name (for API key lookup and setProvider)
   */
  static getProviderFromModel(modelId) {
    if (!modelId || typeof modelId !== 'string') return null;
    const id = modelId.toLowerCase();
    if (OllamaProvider.isModelId(id)) return 'ollama';
    if (ImpulseProvider.isModelId(id)) return 'impulse';
    return null;
  }

  /**
   * Unified list of all models from all providers for the dropdown.
   * Returns { id, displayName, provider }.
   */
  getUnifiedModelList() {
    const list = [];
    for (const providerName of this.providers.keys()) {
      const ProviderClass = this.providers.get(providerName);
      const tempInstance = new ProviderClass('temp-key');
      const models = tempInstance.getAvailableModels();
      // getAvailableModels() returns newest-first, so index 0 is the latest.
      models.forEach((modelId, idx) => {
        list.push({
          id: modelId,
          displayName: providerName === 'ollama' ? OllamaProvider.displayName(modelId) : ImpulseProvider.displayName(modelId),
          provider: providerName,
          latest: idx === 0
        });
      });
    }
    return list;
  }

  /**
   * The newest (latest) model id per provider.
   * @returns {Record<string, string>} e.g. { claude: '...', openai: '...' }
   */
  getLatestByProvider() {
    const map = {};
    for (const providerName of this.providers.keys()) {
      const ProviderClass = this.providers.get(providerName);
      const tempInstance = new ProviderClass('temp-key');
      const models = tempInstance.getAvailableModels();
      if (models.length > 0) map[providerName] = models[0];
    }
    return map;
  }

  /** All valid model ids across every provider. */
  getAllModelIds() {
    const ids = [];
    for (const providerName of this.providers.keys()) {
      const ProviderClass = this.providers.get(providerName);
      const tempInstance = new ProviderClass('temp-key');
      ids.push(...tempInstance.getAvailableModels());
    }
    return ids;
  }

  /** Record real usage of a model (fire-and-forget safe). */
  async recordModelUsage(modelId) {
    try { await this.modelPrefs.recordUsage(modelId); } catch (_) { /* best effort */ }
  }

  /**
   * Decide which model the IDE should use on boot.
   *
   * Rules:
   *  - A pinned model always wins (auto-upgrade never moves away from it).
   *  - Otherwise pick the LATEST model of the user's preferred provider
   *    (falls back to the most-used model's provider, then any provider
   *    that has an API key, then the first registered provider).
   *  - The most-used model is always returned too, so the UI can keep it
   *    surfaced even after an upgrade.
   *
   * @param {string[]} providersWithKeys - providers that have an API key set
   * @returns {Promise<{suggested: string|null, reason: string, pinned: string|null, mostUsed: string|null, autoUpgrade: boolean, preferredProvider: string|null, latestByProvider: Record<string,string>}>}
   */
  async getModelSuggestion(providersWithKeys = []) {
    const latestByProvider = this.getLatestByProvider();
    const validIds = this.getAllModelIds();
    const state = await this.modelPrefs.getState();
    const mostUsed = await this.modelPrefs.getMostUsed(validIds);

    const keyed = Array.isArray(providersWithKeys) ? providersWithKeys.filter(Boolean) : [];
    const hasKey = (p) => keyed.length === 0 || keyed.includes(p);

    // 1. Pinned model wins outright (if it still exists in the catalog).
    if (state.pinnedModel && validIds.includes(state.pinnedModel)) {
      return {
        suggested: state.pinnedModel,
        reason: 'pinned',
        pinned: state.pinnedModel,
        mostUsed,
        autoUpgrade: state.autoUpgrade,
        preferredProvider: state.preferredProvider,
        latestByProvider
      };
    }

    // 2. Choose the target provider.
    const mostUsedProvider = mostUsed ? AIAgent.getProviderFromModel(mostUsed) : null;
    const candidates = [
      state.preferredProvider,
      mostUsedProvider,
      ...keyed,
      ...this.providers.keys()
    ];
    let targetProvider = null;
    for (const p of candidates) {
      if (p && latestByProvider[p] && hasKey(p)) { targetProvider = p; break; }
    }
    // Last resort: first provider that has a latest model at all.
    if (!targetProvider) {
      targetProvider = Object.keys(latestByProvider)[0] || null;
    }

    const suggested = targetProvider ? latestByProvider[targetProvider] : (mostUsed || null);

    return {
      suggested,
      reason: state.autoUpgrade ? 'latest' : 'preferred',
      pinned: null,
      mostUsed,
      autoUpgrade: state.autoUpgrade,
      preferredProvider: state.preferredProvider,
      latestByProvider
    };
  }

  /**
   * Get tools array for the given mode
   * @param {string} mode - 'agent' | 'plan' | 'ask' | 'debug'
   */
  _getToolsForMode(mode) {
    if (mode === 'ask') return [];
    if (mode === 'plan') return getPlanTools();
    if (mode === 'debug') return getDebugTools();
    // Agent mode starts with the standing set; load_tools adds a pack for the rest of the turn.
    return getCoreTools();
  }

  /**
   * Process a user query with optional tool use (mode-dependent)
   * @param {string} userQuery - User message
   * @param {Object} context - IDE context
   * @param {string} mode - 'agent' | 'ask' | 'debug'
   */
  /**
   * @param {{ onStep?: (step: { type: 'thinking' } | { type: 'tool', name: string }) => void, signal?: AbortSignal }} [hooks]
   *   onStep hears each model call and each tool before it runs (the chat shows them).
   *   signal stops the turn (the chat's Stop): the model call in flight is cancelled,
   *   no further tool runs, and the turn is dropped from the history.
   */
  async processQuery(userQuery, context = {}, mode = 'agent', { onStep, signal } = {}) {
    const step = (s) => { try { onStep?.(s); } catch { /* the UI's problem, not the query's */ } };
    if (!this.currentProvider) {
      throw new Error('No provider selected. Please set a provider first.');
    }
    const historyLength = this.conversationHistory.length;
    const stopIfAsked = () => {
      if (!signal?.aborted) return;
      this.conversationHistory.length = Math.min(this.conversationHistory.length, historyLength);
      const stopped = new Error('Stopped');
      stopped.stopped = true;
      throw stopped;
    };
    const ask = async (msgs, opts) => {
      stopIfAsked();
      try {
        return await this.currentProvider.chat(msgs, { ...opts, signal });
      } catch (error) {
        stopIfAsked();
        throw error;
      }
    };

    // Track real usage so the "most-used" model stays surfaced even after
    // auto-upgrades. Fire-and-forget — never block the query on disk I/O.
    if (this.currentProvider.model) {
      this.recordModelUsage(this.currentProvider.model).catch(() => {});
    }

    const toolsForMode = [...this._getToolsForMode(mode)];
    const useTools = Array.isArray(toolsForMode) && toolsForMode.length > 0;
    // One id per user message: every model call of this turn carries it, so the
    // gateway can add up what a task cost.
    const taskId = `t_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;

    // Build user content: prepend IDE context when available
    const ctx = [];
    if (!context.hasFileOpen) {
      ctx.push('NO_FILE_OPEN');
    } else if (context.currentSketchPath) {
      ctx.push(`sketch=${context.currentSketchPath}`);
    }
    if (context.selectedBoard) ctx.push(`board=${context.selectedBoard}`);
    if (context.selectedPort) ctx.push(`port=${context.selectedPort}`);

    // Surface the most recent compilation result so the agent can see and act
    // on compile errors the user hit via the Verify button (not just via tools).
    let compileBlock = '';
    const lcr = context.lastCompileResult;
    if (lcr && typeof lcr === 'object') {
      if (lcr.success === false) {
        const details = (lcr.output && lcr.output.trim())
          || (Array.isArray(lcr.errors) && lcr.errors.join('\n'))
          || lcr.message
          || 'Compilation failed.';
        compileBlock = `\n\n[LAST COMPILE FAILED]\n${String(details).slice(0, 3000)}`;
      } else if (lcr.success === true) {
        ctx.push('lastCompile=success');
      }
    }

    const userContent = (ctx.length > 0
      ? `[IDE: ${ctx.join(', ')}]\n\n${userQuery}`
      : userQuery) + compileBlock;

    this.conversationHistory.push({
      role: 'user',
      content: userContent
    });

    // Trim history to sliding window to prevent unbounded token growth
    this._trimHistory();

    // The selected board's real facts go with every request (not into the
    // history), so even a model that never calls a tool writes for the right pins.
    let boardFacts = await this.boardFacts(context.selectedBoard);
    // Answers earlier in the conversation may be for another board.
    if (context.selectedBoard && this.lastBoard && this.lastBoard !== context.selectedBoard && this.conversationHistory.length > 1) {
      boardFacts = `${boardFacts || ''}\n[BOARD CHANGED] The selected board is now ${context.selectedBoard}; earlier messages in this conversation were about ${this.lastBoard}. Use the facts for the current board, not earlier answers.`.trim();
    }
    if (context.selectedBoard) this.lastBoard = context.selectedBoard;
    // The circuit on the simulator canvas goes with every request too, and a
    // note when it changed since earlier messages.
    const circuitHash = context.circuit?.hash ?? null;
    const circuitChanged = this.lastCircuitHash !== undefined && circuitHash !== this.lastCircuitHash && this.conversationHistory.length > 1;
    const circuitFacts = circuitBlock(context.circuit, { changed: circuitChanged });
    this.lastCircuitHash = circuitHash;
    const standing = [boardFacts, circuitFacts].filter(Boolean).join('\n\n');
    const messages = [
      {
        role: 'system',
        content: standing ? `${getSystemPrompt(mode)}\n\n${standing}` : getSystemPrompt(mode)
      },
      ...this.conversationHistory
    ];

    const chatOptions = {
      temperature: this.config.temperature,
      max_tokens: this.config.max_tokens,
      effort: mode === 'ask' || mode === 'plan' ? 'medium' : 'high',
      tools: toolsForMode,
      taskId,
    };

    // Ask mode: single turn, no tools
    if (!useTools) {
      step({ type: 'thinking' });
      const response = await ask(messages, chatOptions);
      if (response.content) {
        this.conversationHistory.push({
          role: 'assistant',
          content: response.content
        });
      }
      return {
        response: response.content,
        toolResults: [],
        usage: response.usage,
        model: response.model
      };
    }

    let iteration = 0;
    const maxIterations = this.config.maxIterations;
    const toolResults = [];
    // The verify guard: code edited this turn must compile before the answer stands.
    let editedSinceCompile = false;
    let verifyRounds = 0;

    while (iteration < maxIterations) {
      step({ type: 'thinking' });
      const response = await ask(messages, chatOptions);

      if (!response.toolCalls || response.toolCalls.length === 0) {
        // Before the model's "done" stands: an edited sketch that was not compiled since gets compiled now.
        if (mode === 'agent' && editedSinceCompile && verifyRounds < 2 && context.hasFileOpen !== false) {
          verifyRounds++;
          editedSinceCompile = false;
          step({ type: 'tool', name: 'compile_sketch' });
          const check = await this.toolExecutor.execute({ name: 'compile_sketch', arguments: {} });
          toolResults.push({ ...check, tool: 'compile_sketch', verify: true });
          if (check && check.success === false && check.code !== 'BUSY') {
            messages.push({ role: 'assistant', content: response.content || '' });
            messages.push({ role: 'user', content: `[VERIFY] The sketch you edited does not compile:\n${verifySummary(check)}\nFix it (knownFixes, if present, says what fixed this before), then tell the user what you changed.` });
            iteration++;
            continue;
          }
          // It compiles, which says nothing about whether the pins exist on
          // this board: a wrong GPIO compiles happily and fails on the bench.
          const pins = await this.toolExecutor.checkPins?.().catch(() => null);
          const pinErrors = (pins?.issues || []).filter((i) => i.level === 'error');
          if (pinErrors.length) {
            toolResults.push({ success: false, tool: 'check_pins', verify: true, issues: pins.issues });
            messages.push({ role: 'assistant', content: response.content || '' });
            messages.push({ role: 'user', content: `${pins.report}\nChange those pins to ones the board has, then tell the user what you changed and why.` });
            iteration++;
            continue;
          }
          if (pins?.issues?.length) response.content = `${response.content || ''}\n\n${pins.report}`.trim();
          if (check && check.success && Array.isArray(check.summary) && check.summary.length) {
            response.content = `${response.content || ''}\n\n${check.summary[0]}`.trim();
          }
        }
        if (response.content) {
          this.conversationHistory.push({
            role: 'assistant',
            content: response.content
          });
        }
        return {
          response: response.content,
          toolResults: toolResults,
          usage: response.usage,
          model: response.model,
          taskId,
        };
      }

      const assistantMsg = {
        role: 'assistant',
        content: response.content || null,
        rawContent: response.rawContent,
        tool_calls: response.toolCalls.map(tc => ({
          id: tc.id,
          type: 'function',
          function: {
            name: tc.name,
            arguments: typeof tc.arguments === 'string'
              ? tc.arguments
              : JSON.stringify(tc.arguments || {})
          }
        }))
      };
      messages.push(assistantMsg);

      for (const toolCall of response.toolCalls) {
        stopIfAsked();
        step({ type: 'tool', name: String(toolCall.name || '') });
        const startTime = Date.now();
        let result;
        if (toolCall.name === 'load_tools') {
          // A pack joins the request's tools for the rest of the turn.
          const args = typeof toolCall.arguments === 'string' ? safeJson(toolCall.arguments) : (toolCall.arguments || {});
          const pack = String(args.pack || '');
          const extra = getPackTools(pack).filter((t) => !chatOptions.tools.some((x) => x.name === t.name));
          chatOptions.tools = [...chatOptions.tools, ...extra];
          result = extra.length
            ? { success: true, tool: 'load_tools', loaded: extra.map((t) => t.name), note: 'These tools are available now; call them directly.' }
            : { success: false, tool: 'load_tools', error: `Unknown or already loaded pack "${pack}". Packs: boards, memory, project, playground.` };
        } else {
          result = await this.toolExecutor.execute(toolCall);
        }
        const executionTime = Date.now() - startTime;
        if (typeof result === 'object' && result !== null) {
          result.executionTime = executionTime;
        }
        toolResults.push(result);
        if (result && result.success !== false && CODE_EDIT_TOOLS.has(toolCall.name)) editedSinceCompile = true;
        if (toolCall.name === 'compile_sketch' && result && result.success !== false) editedSinceCompile = false;

        messages.push({
          role: 'tool',
          tool_call_id: toolCall.id,
          name: toolCall.name,
          is_error: !!(result && typeof result === 'object' && result.success === false),
          content: typeof result === 'string' ? result : JSON.stringify(result)
        });
      }

      iteration++;
    }

    return {
      response: 'Maximum iterations reached. Please refine your query.',
      toolResults: toolResults,
      warning: 'max_iterations_reached'
    };
  }

  /** [BOARD FACTS] for the selected board, or null (no board, no core, or arduino-cli too slow). */
  async boardFacts(fqbn) {
    const knowledge = this.toolExecutor?.boardKnowledge;
    if (!fqbn || !knowledge) return null;
    try {
      return await Promise.race([knowledge.summary(fqbn), new Promise((resolve) => setTimeout(() => resolve(null), 8000))]);
    } catch {
      return null;
    }
  }

  /**
   * Analyze error with AI assistance
   */
  async analyzeError(errorMessage, context = {}) {
    // First, check memory
    const memoryResults = await this.memory.searchSimilarErrors(errorMessage, 5);
    
    if (memoryResults.match && memoryResults.fixes.length > 0) {
      // Found exact match with fixes
      return {
        source: 'memory',
        error: memoryResults.match,
        fixes: memoryResults.fixes,
        confidence: 1.0
      };
    }

    // If no provider set, return memory results only
    if (!this.currentProvider) {
      return {
        source: 'memory',
        matches: memoryResults.matches || [],
        message: 'No AI provider configured. Showing memory results only.'
      };
    }

    // Use AI to analyze
    let query = `Analyze this Arduino error and suggest fixes: ${errorMessage}\n\nContext: ${JSON.stringify(context, null, 2)}`;
    
    if (memoryResults.matches && memoryResults.matches.length > 0) {
      query += `\n\nSimilar past errors found: ${JSON.stringify(memoryResults.matches, null, 2)}`;
    }

    const result = await this.processQuery(query, context);
    
    return {
      source: 'ai',
      analysis: result.response,
      memoryResults: memoryResults,
      toolResults: result.toolResults
    };
  }

  /**
   * Analyze serial output
   */
  async analyzeSerialOutput(serialOutput, _lines = 50) {
    if (!this.currentProvider) {
      return {
        source: 'local',
        message: 'No AI provider configured. Serial output logged but not analyzed.'
      };
    }

    const query = `Analyze this serial monitor output from an Arduino board:\n\n${serialOutput}\n\nWhat is the board doing? Are there any issues?`;
    
    return await this.processQuery(query, { type: 'serial_analysis' });
  }

  /**
   * Clear conversation history
   */
  clearHistory() {
    this.conversationHistory = [];
    this.lastBoard = null;
  }

  /**
   * Summarise the current conversation with the AI, then replace history with
   * a single seeded system-style user message containing the summary.
   * Returns the summary text so the UI can display a divider card.
   *
   * @returns {Promise<string>} summary text
   */
  async summarizeAndCompact() {
    if (!this.currentProvider) throw new Error('No provider configured');
    if (this.conversationHistory.length === 0) return '';

    // Ask the model to produce a concise summary of what happened so far.
    const summarisePrompt = [
      {
        role: 'system',
        content:
          'You are a technical assistant. Produce a concise but complete summary of the ' +
          'conversation below. Keep all important decisions, code changes, errors encountered, ' +
          'and next steps. Write in the third person. Max 400 words.'
      },
      ...this.conversationHistory,
      {
        role: 'user',
        content:
          'Please summarise the conversation above so it can be used as context going forward.'
      }
    ];

    const response = await this.currentProvider.chat(summarisePrompt, {
      temperature: 0.3,
      max_tokens: 1500,
      effort: 'low',
      tools: [] // no tools during summarisation
    });

    const summary = (response.content || '').trim() || 'Conversation summarised (no content returned).';

    // Replace history with a single seeded context message so the next query
    // has a compact starting point without losing important context.
    this.conversationHistory = [
      {
        role: 'user',
        content: `[CONVERSATION SUMMARY]\n${summary}`
      },
      {
        role: 'assistant',
        content: 'Understood. I have the context from the previous conversation. How can I help?'
      }
    ];

    return summary;
  }

  /**
   * Get conversation history
   */
  getHistory() {
    return this.conversationHistory;
  }

  /**
   * Trim conversation history to stay within the sliding window.
   * Preserves the most recent messages and never cuts in the middle
   * of a tool-call/tool-result pair.
   */
  _trimHistory() {
    if (this.conversationHistory.length <= this.maxHistoryMessages) return;

    // Keep the most recent messages within budget
    const excess = this.conversationHistory.length - this.maxHistoryMessages;
    // Don't cut in the middle of a tool exchange — find safe cut point
    let cutAt = excess;
    while (cutAt < this.conversationHistory.length) {
      const msg = this.conversationHistory[cutAt];
      // Safe to cut before a user message (not a tool result)
      if (msg.role === 'user' && !msg.tool_call_id) break;
      cutAt++;
    }
    if (cutAt > 0 && cutAt < this.conversationHistory.length) {
      this.conversationHistory = this.conversationHistory.slice(cutAt);
    }
  }

  /**
   * Close and cleanup
   */
  close() {
    if (this.memory) {
      this.memory.close();
    }
  }
}

module.exports = AIAgent;

