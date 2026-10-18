/**
 * AI agent IPC handlers.
 * @module main/ipc/aiHandlers
 */

const AIAgent = require('../services/ai/agent');
const { generateCircuit } = require('../services/ai/circuitGenerator');
const { verifyExecution } = require('../services/ai/agentVerify');
const { parseOrDefault, schemas } = require('./schemas');
const { withDebugLog } = require('../utils/logger');

const defaultFail = { success: false, error: 'Invalid input' };

/**
 * Register AI agent IPC handlers.
 * @param {import('electron').IpcMain} ipcMain
 * @param {{ aiAgent: import('../services/ai/agent'), cloudAccount: import('../services/cloud/account').CloudAccount, uiState: Record<string, unknown> }} ctx
 */
function register(ipcMain, ctx) {
  const { aiAgent, cloudAccount, uiState } = ctx;

  /** What a provider runs with: the Impulse session, or nothing for local models. */
  const credentialFor = (providerName) => (AIAgent.isKeyless(providerName) ? 'local' : cloudAccount.sessionToken());

  // Signing in, out or into another account swaps the token under the cloud model.
  cloudAccount.on('change', () => {
    const current = aiAgent.currentProvider;
    if (current?.name !== 'impulse') return;
    const token = cloudAccount.sessionToken();
    if (!token) {
      aiAgent.currentProvider = null;
      return;
    }
    // Cheap (no network): always pick up the newest session.
    aiAgent.setProvider('impulse', token, current.appModel);
  });

  ipcMain.handle('ai:generate-circuit', withDebugLog('ai:generate-circuit', async (event, sketchCode, options) => {
    const parsed = parseOrDefault(schemas.aiGenerateCircuit, {
      code: typeof sketchCode === 'string' ? sketchCode : '',
      board: options?.board,
      catalog: options?.catalog,
    }, { success: false, error: 'Invalid sketch code' });
    if (!parsed.ok) return parsed.defaultResult;
    try {
      return await generateCircuit(aiAgent, parsed.data.code, { board: parsed.data.board, catalog: parsed.data.catalog });
    } catch (error) {
      return { success: false, error: error?.message ?? 'Circuit generation failed' };
    }
  }));

  ipcMain.handle('ai:verify-execution', withDebugLog('ai:verify-execution', async (event, obs) => {
    if (!obs || typeof obs !== 'object' || typeof obs.code !== 'string' || obs.code.length > 200000) {
      return { success: false, error: 'Invalid observation payload' };
    }
    try {
      return await verifyExecution(aiAgent, obs);
    } catch (error) {
      return { success: false, error: error?.message ?? 'Verify failed' };
    }
  }));

  // The turn in progress, so the chat's Stop can cancel it.
  let running = null;

  ipcMain.handle('ai:process-query', withDebugLog('ai:process-query', async (event, query, context, mode) => {
    const parsed = parseOrDefault(schemas.aiProcessQuery, { query: query ?? '', context: context ?? {}, mode: mode ?? 'agent' }, defaultFail);
    if (!parsed.ok) return parsed.defaultResult;
    const turn = new AbortController();
    running?.abort();
    running = turn;
    try {
      const ctx = parsed.data.context || {};
      const enrichedContext = {
        ...parsed.data.context,
        currentBaudRate: uiState.currentBaudRate,
        currentSketchPath: uiState.currentSketchPath,
        selectedBoard: uiState.selectedBoard ?? ctx.board ?? null,
        selectedPort: uiState.selectedPort ?? ctx.port ?? null,
        hasFileOpen: ctx.hasFileOpen ?? false,
        lastCompileResult: uiState.lastCompileResult ?? null
      };
      const effectiveMode = ['plan', 'ask', 'debug'].includes(parsed.data.mode) ? parsed.data.mode : 'agent';
      // Each step goes to the chat as it happens (the orb's label).
      const onStep = (step) => { if (!event.sender.isDestroyed()) event.sender.send('ai:step', step); };
      const result = await aiAgent.processQuery(parsed.data.query, enrichedContext, effectiveMode, { onStep, signal: turn.signal });
      return { success: true, data: result };
    } catch (error) {
      if (error?.stopped) return { success: false, stopped: true, error: 'Stopped' };
      if (!aiAgent.currentProvider) return { success: false, code: 'signed_out', error: 'Sign in to Impulse to use AI, or pick a model on this computer.' };
      return { success: false, code: error?.code, error: error?.message ?? 'Process query failed' };
    } finally {
      if (running === turn) running = null;
    }
  }));

  ipcMain.handle('ai:cancel', withDebugLog('ai:cancel', async () => {
    const wasRunning = !!running;
    running?.abort();
    running = null;
    return { success: true, cancelled: wasRunning };
  }));

  ipcMain.handle('ai:analyze-error', withDebugLog('ai:analyze-error', async (event, errorMessage, context) => {
    const parsed = parseOrDefault(schemas.aiAnalyzeError, { errorMessage: errorMessage ?? '', context }, defaultFail);
    if (!parsed.ok) return parsed.defaultResult;
    try {
      const result = await aiAgent.analyzeError(parsed.data.errorMessage, parsed.data.context);
      return { success: true, data: result };
    } catch (error) {
      return { success: false, error: error?.message ?? 'Analyze failed' };
    }
  }));

  ipcMain.handle('ai:analyze-serial', withDebugLog('ai:analyze-serial', async (event, serialOutput, lines) => {
    const parsed = parseOrDefault(schemas.aiAnalyzeSerial, { serialOutput: serialOutput ?? '', lines: lines ?? [] }, defaultFail);
    if (!parsed.ok) return parsed.defaultResult;
    try {
      const result = await aiAgent.analyzeSerialOutput(parsed.data.serialOutput, parsed.data.lines);
      return { success: true, data: result };
    } catch (error) {
      return { success: false, error: error?.message ?? 'Analyze failed' };
    }
  }));

  ipcMain.handle('ai:get-providers', withDebugLog('ai:get-providers', async () => {
    try {
      const providers = aiAgent.getAvailableProviders();
      return { success: true, data: providers ?? [] };
    } catch (error) {
      return { success: false, error: error?.message ?? 'Get providers failed' };
    }
  }));

  ipcMain.handle('ai:get-models', withDebugLog('ai:get-models', async (event, provider) => {
    const parsed = parseOrDefault(schemas.aiGetModels, { provider: provider ?? null }, defaultFail);
    if (!parsed.ok) return parsed.defaultResult;
    try {
      const models = aiAgent.getAvailableModels(parsed.data.provider ?? undefined);
      return { success: true, data: models ?? [] };
    } catch (error) {
      return { success: false, error: error?.message ?? 'Get models failed' };
    }
  }));

  ipcMain.handle('ai:get-unified-models', withDebugLog('ai:get-unified-models', async () => {
    try {
      // Local models first, so Ollama's list is current when the menu is built.
      const local = await aiAgent.refreshLocalModels();
      const list = aiAgent.getUnifiedModelList();
      const OllamaProvider = require('../services/ai/providers/ollamaProvider');
      // Recommended downloads that aren't installed yet, best first.
      const enabled = aiAgent.localModelsEnabled();
      const installed = new Set(local.models.map((m) => m.name));
      const downloads = enabled ? OllamaProvider.recommendedModels().filter((m) => !installed.has(m.name)) : [];
      return { success: true, data: list ?? [], local: { enabled, running: local.running, count: local.models.length, downloads } };
    } catch (error) {
      return { success: false, error: error?.message ?? 'Get models failed' };
    }
  }));

  ipcMain.handle('ai:set-model', withDebugLog('ai:set-model', async (event, modelId, manual) => {
    const parsed = parseOrDefault(schemas.aiSetModel, { modelId: modelId ?? '', manual: manual ?? undefined }, defaultFail);
    if (!parsed.ok) return parsed.defaultResult;
    try {
      const providerName = AIAgent.getProviderFromModel(parsed.data.modelId);
      if (!providerName) return { success: false, error: 'Unknown model' };
      const credential = credentialFor(providerName);
      if (!credential) return { success: false, error: 'Sign in to use Impulse AI', needsSignIn: true, provider: providerName };
      aiAgent.setProvider(providerName, credential, parsed.data.modelId);
      if (parsed.data.manual) {
        aiAgent.modelPrefs.setPreferredProvider(providerName).catch(() => {});
      }
      return { success: true, provider: providerName, model: parsed.data.modelId };
    } catch (error) {
      return { success: false, error: error?.message ?? 'Set model failed' };
    }
  }));

  ipcMain.handle('ai:get-model-suggestion', withDebugLog('ai:get-model-suggestion', async () => {
    try {
      const usable = cloudAccount.sessionToken() ? ['impulse'] : [];
      // Installed local models count as a provider you can use right away.
      const local = await aiAgent.refreshLocalModels();
      if (local.models.length) usable.push('ollama');
      const suggestion = await aiAgent.getModelSuggestion(usable);
      return { success: true, data: suggestion };
    } catch (error) {
      return { success: false, error: error?.message ?? 'Get suggestion failed' };
    }
  }));

  ipcMain.handle('ai:summarize-history', withDebugLog('ai:summarize-history', async () => {
    try {
      const summary = await aiAgent.summarizeAndCompact();
      return { success: true, summary };
    } catch (error) {
      return { success: false, error: error?.message ?? 'Summarise failed' };
    }
  }));

  ipcMain.handle('ai:clear-history', withDebugLog('ai:clear-history', async () => {
    try {
      aiAgent.clearHistory();
      return { success: true };
    } catch (error) {
      return { success: false, error: error?.message ?? 'Clear failed' };
    }
  }));

  ipcMain.handle('ai:get-memory-stats', withDebugLog('ai:get-memory-stats', async () => {
    try {
      const stats = await aiAgent.memory.getStats();
      return { success: true, data: stats ?? {} };
    } catch (error) {
      return { success: false, error: error?.message ?? 'Get stats failed' };
    }
  }));

  ipcMain.handle('ai:start-local', withDebugLog('ai:start-local', async () => {
    if (!aiAgent.localModelsEnabled()) return { success: false, error: 'This build of Impulse runs its AI through Impulse Cloud only.' };
    try {
      const OllamaProvider = require('../services/ai/providers/ollamaProvider');
      const started = await OllamaProvider.start();
      if (!started.success) return started;
      const local = await aiAgent.refreshLocalModels();
      return { success: true, running: local.running, count: local.models.length };
    } catch (error) {
      return { success: false, error: error?.message ?? 'Could not start Ollama' };
    }
  }));

  ipcMain.handle('ai:pull-local-model', withDebugLog('ai:pull-local-model', async (event, model) => {
    if (!aiAgent.localModelsEnabled()) return { success: false, error: 'This build of Impulse runs its AI through Impulse Cloud only.' };
    const OllamaProvider = require('../services/ai/providers/ollamaProvider');
    const name = typeof model === 'string' && /^[\w.:/-]{1,100}$/.test(model) ? model : OllamaProvider.recommendedModel().name;
    try {
      return await OllamaProvider.pull(name, (p) => {
        if (!event.sender.isDestroyed()) event.sender.send('ai:local-progress', p);
      });
    } catch (error) {
      return { success: false, error: error?.message ?? 'Download failed' };
    }
  }));

  ipcMain.handle('ai:execute-tool', withDebugLog('ai:execute-tool', async (event, toolName, args) => {
    const parsed = parseOrDefault(schemas.aiExecuteTool, { toolName: toolName ?? '', args: args ?? {} }, defaultFail);
    if (!parsed.ok) return parsed.defaultResult;
    try {
      if (!aiAgent.toolExecutor) return { success: false, error: 'Tool executor not initialized' };
      const result = await aiAgent.toolExecutor.execute({
        name: parsed.data.toolName,
        arguments: parsed.data.args
      });
      return { success: true, data: result };
    } catch (error) {
      return { success: false, error: error?.message ?? 'Execute tool failed' };
    }
  }));
}

module.exports = { register };
