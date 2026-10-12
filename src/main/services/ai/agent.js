const { getSystemPrompt } = require('./prompts/systemPrompt');
const ToolExecutor = require('./tools/toolExecutor');
const SimpleMemory = require('./memory/simpleMemory');
const ModelPreferences = require('./config/modelPreferences');
const { getAllTools, getDebugTools } = require('./tools/toolSchema');
const OpenAIProvider = require('./providers/openaiProvider');
const GeminiProvider = require('./providers/geminiProvider');
const ClaudeProvider = require('./providers/claudeProvider');

/**
 * AI Agent
 * Main orchestrator for AI-powered Arduino development assistance
 */
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
    const provider = new ProviderClass(apiKey, model);
    
    if (!provider.validateApiKey(apiKey)) {
      throw new Error(`Invalid API key for provider ${providerName}`);
    }

    this.currentProvider = provider;
    return provider;
  }

  /**
   * Initialize default providers (without API keys)
   */
  initializeProviders() {
    this.providers.set('openai', OpenAIProvider);
    this.providers.set('gemini', GeminiProvider);
    this.providers.set('claude', ClaudeProvider);
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
    if (id.startsWith('claude-')) return 'claude';
    if (id.startsWith('gpt-') || /^o\d/.test(id)) return 'openai';
    if (id.startsWith('gemini-')) return 'gemini';
    return null;
  }

  /**
   * Unified list of all models from all providers for the dropdown.
   * Returns { id, displayName, provider }.
   */
  getUnifiedModelList() {
    const list = [];
    const displayNames = {
      'claude-opus-5-5': 'Claude Opus 5.5',
      'claude-sonnet-5-5': 'Claude Sonnet 5.5',
      'claude-fable-5-1': 'Claude Fable 5.1',
      'claude-haiku-4-5': 'Claude Haiku 4.5',
      // OpenAI GPT-4.1
      'gpt-4.1': 'GPT-4.1',
      'gpt-4.1-mini': 'GPT-4.1 Mini',
      'gpt-4.1-nano': 'GPT-4.1 Nano',
      // OpenAI reasoning
      'o4-mini': 'o4-mini',
      'o3-mini': 'o3-mini',
      // OpenAI GPT-4o
      'gpt-4o': 'GPT-4o',
      'gpt-4o-mini': 'GPT-4o Mini',
      // OpenAI legacy
      'gpt-4-turbo': 'GPT-4 Turbo',
      'gpt-4': 'GPT-4',
      'gpt-3.5-turbo': 'GPT-3.5 Turbo',
      // Gemini 2.5
      'gemini-2.5-pro': 'Gemini 2.5 Pro',
      'gemini-2.5-flash': 'Gemini 2.5 Flash',
      'gemini-2.5-flash-lite': 'Gemini 2.5 Flash Lite',
      // Gemini 2.0
      'gemini-2.0-flash': 'Gemini 2.0 Flash',
      'gemini-2.0-flash-lite': 'Gemini 2.0 Flash Lite',
      // Gemini 1.5
      'gemini-1.5-pro': 'Gemini 1.5 Pro',
      'gemini-1.5-flash': 'Gemini 1.5 Flash'
    };
    for (const providerName of this.providers.keys()) {
      const ProviderClass = this.providers.get(providerName);
      const tempInstance = new ProviderClass('temp-key');
      const models = tempInstance.getAvailableModels();
      // getAvailableModels() returns newest-first, so index 0 is the latest.
      models.forEach((modelId, idx) => {
        list.push({
          id: modelId,
          displayName: displayNames[modelId] || modelId,
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
   * @param {string} mode - 'agent' | 'ask' | 'debug'
   */
  _getToolsForMode(mode) {
    if (mode === 'ask') return [];
    if (mode === 'debug') return getDebugTools();
    return getAllTools();
  }

  /**
   * Process a user query with optional tool use (mode-dependent)
   * @param {string} userQuery - User message
   * @param {Object} context - IDE context
   * @param {string} mode - 'agent' | 'ask' | 'debug'
   */
  /**
   * @param {{ onStep?: (step: { type: 'thinking' } | { type: 'tool', name: string }) => void }} [hooks]
   *   onStep hears each model call and each tool before it runs (the chat shows them).
   */
  async processQuery(userQuery, context = {}, mode = 'agent', { onStep } = {}) {
    const step = (s) => { try { onStep?.(s); } catch { /* the UI's problem, not the query's */ } };
    if (!this.currentProvider) {
      throw new Error('No provider selected. Please set a provider first.');
    }

    // Track real usage so the "most-used" model stays surfaced even after
    // auto-upgrades. Fire-and-forget — never block the query on disk I/O.
    if (this.currentProvider.model) {
      this.recordModelUsage(this.currentProvider.model).catch(() => {});
    }

    const toolsForMode = this._getToolsForMode(mode);
    const useTools = Array.isArray(toolsForMode) && toolsForMode.length > 0;

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

    const messages = [
      {
        role: 'system',
        content: getSystemPrompt(mode)
      },
      ...this.conversationHistory
    ];

    const chatOptions = {
      temperature: this.config.temperature,
      max_tokens: this.config.max_tokens,
      effort: mode === 'ask' ? 'medium' : 'high',
      tools: toolsForMode
    };

    // Ask mode: single turn, no tools
    if (!useTools) {
      step({ type: 'thinking' });
      const response = await this.currentProvider.chat(messages, chatOptions);
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

    while (iteration < maxIterations) {
      step({ type: 'thinking' });
      const response = await this.currentProvider.chat(messages, chatOptions);

      if (!response.toolCalls || response.toolCalls.length === 0) {
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
          model: response.model
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
        step({ type: 'tool', name: String(toolCall.name || '') });
        const startTime = Date.now();
        const result = await this.toolExecutor.execute(toolCall);
        const executionTime = Date.now() - startTime;
        if (typeof result === 'object' && result !== null) {
          result.executionTime = executionTime;
        }
        toolResults.push(result);

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

