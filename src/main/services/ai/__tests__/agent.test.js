/**
 * Tests for AIAgent
 * Focuses on: provider management, conversation history, error handling
 */

jest.mock('../prompts/systemPrompt', () => ({
  getSystemPrompt: jest.fn(() => 'You are a helpful assistant.')
}));

const AIAgent = require('../agent');

// Minimal mock classes
class MockProvider {
  constructor() { this.name = 'mock'; }
  validateApiKey() { return true; }
  getAvailableModels() { return ['mock-model']; }
  async chat() {
    return {
      content: 'Mock response',
      toolCalls: [],
      usage: { promptTokens: 10, completionTokens: 20 },
      model: 'mock-model'
    };
  }
}

function createAgent() {
  const agent = new AIAgent({}, {}, {});
  return agent;
}

describe('AIAgent', () => {
  describe('provider management', () => {
    it('should register and list providers', () => {
      const agent = createAgent();
      agent.registerProvider('mock', MockProvider);
      expect(agent.getAvailableProviders()).toContain('mock');
    });

    it('should set current provider with valid API key', () => {
      const agent = createAgent();
      agent.registerProvider('mock', MockProvider);
      const provider = agent.setProvider('mock', 'valid-key');
      expect(provider).toBeDefined();
      expect(agent.currentProvider).toBe(provider);
    });

    it('should throw when setting unregistered provider', () => {
      const agent = createAgent();
      expect(() => agent.setProvider('nonexistent', 'key')).toThrow('not registered');
    });
  });

  describe('getProviderFromModel (static)', () => {
    it('should detect Claude models', () => {
      expect(AIAgent.getProviderFromModel('claude-3-5-sonnet-20241022')).toBe('claude');
    });

    it('should detect OpenAI models', () => {
      expect(AIAgent.getProviderFromModel('gpt-4o')).toBe('openai');
    });

    it('should detect Gemini models', () => {
      expect(AIAgent.getProviderFromModel('gemini-3.8-flash')).toBe('gemini');
    });

    it('should return null for unknown models', () => {
      expect(AIAgent.getProviderFromModel('unknown-model')).toBeNull();
      expect(AIAgent.getProviderFromModel(null)).toBeNull();
      expect(AIAgent.getProviderFromModel('')).toBeNull();
    });
  });

  describe('conversation history', () => {
    it('should start with empty history', () => {
      const agent = createAgent();
      expect(agent.getHistory()).toEqual([]);
    });

    it('should clear history', () => {
      const agent = createAgent();
      agent.conversationHistory = [{ role: 'user', content: 'hello' }];
      agent.clearHistory();
      expect(agent.getHistory()).toEqual([]);
    });

    it('should trim history when exceeding max', () => {
      const agent = createAgent();
      agent.maxHistoryMessages = 4;

      // Add 6 messages
      for (let i = 0; i < 6; i++) {
        agent.conversationHistory.push({ role: 'user', content: `msg ${i}` });
      }

      agent._trimHistory();
      expect(agent.conversationHistory.length).toBeLessThanOrEqual(4);
    });

    it('should not trim when within limit', () => {
      const agent = createAgent();
      agent.maxHistoryMessages = 40;
      agent.conversationHistory = [
        { role: 'user', content: 'hello' },
        { role: 'assistant', content: 'hi' }
      ];

      agent._trimHistory();
      expect(agent.conversationHistory.length).toBe(2);
    });
  });

  describe('processQuery', () => {
    it('should throw when no provider is set', async () => {
      const agent = createAgent();
      await expect(agent.processQuery('hello')).rejects.toThrow('No provider selected');
    });

    it('should return response from provider', async () => {
      const agent = createAgent();
      agent.registerProvider('mock', MockProvider);
      agent.setProvider('mock', 'key');

      const result = await agent.processQuery('hello', {}, 'ask');
      expect(result.response).toBe('Mock response');
      expect(result.toolResults).toEqual([]);
    });

    it('should add context to user messages', async () => {
      const agent = createAgent();
      agent.registerProvider('mock', MockProvider);
      agent.setProvider('mock', 'key');

      await agent.processQuery('test', {
        selectedBoard: 'arduino:avr:uno',
        selectedPort: 'COM3'
      }, 'ask');

      const lastUserMsg = agent.conversationHistory.find(m => m.role === 'user');
      expect(lastUserMsg.content).toContain('board=arduino:avr:uno');
      expect(lastUserMsg.content).toContain('port=COM3');
    });
  });

  describe('steps reported while a query runs', () => {
    it('reports each model call and each tool before it runs', async () => {
      const agent = createAgent();
      agent.registerProvider('mock', MockProvider);
      agent.setProvider('mock', 'key');
      let call = 0;
      agent.currentProvider.chat = async () => (++call === 1
        ? { content: null, toolCalls: [{ id: 't1', name: 'compile_sketch', arguments: {} }] }
        : { content: 'Compiled.', toolCalls: [] });
      agent.toolExecutor = { execute: async () => ({ success: true, tool: 'compile_sketch' }) };
      const steps = [];
      const result = await agent.processQuery('compile it', {}, 'agent', { onStep: (s) => steps.push(s) });
      expect(result.response).toBe('Compiled.');
      expect(steps).toEqual([{ type: 'thinking' }, { type: 'tool', name: 'compile_sketch' }, { type: 'thinking' }]);
    });

    it('a listener that throws does not break the query', async () => {
      const agent = createAgent();
      agent.registerProvider('mock', MockProvider);
      agent.setProvider('mock', 'key');
      const result = await agent.processQuery('hi', {}, 'ask', { onStep: () => { throw new Error('ui gone'); } });
      expect(result.response).toBe('Mock response');
    });
  });

  describe('stopping a turn (the chat\'s Stop)', () => {
    it('cancels the model call in flight and drops the turn from the history', async () => {
      const agent = createAgent();
      agent.registerProvider('mock', MockProvider);
      agent.setProvider('mock', 'key');
      agent.conversationHistory = [{ role: 'user', content: 'earlier' }, { role: 'assistant', content: 'ok' }];
      const turn = new AbortController();
      let seen = null;
      agent.currentProvider.chat = (msgs, opts) => new Promise((resolve, reject) => {
        seen = opts.signal;
        opts.signal.addEventListener('abort', () => reject(new Error('Request was aborted.')));
      });
      const pending = agent.processQuery('count to a million', {}, 'agent', { signal: turn.signal });
      await new Promise((r) => setTimeout(r, 10));
      turn.abort();
      await expect(pending).rejects.toMatchObject({ stopped: true, message: 'Stopped' });
      expect(seen).toBe(turn.signal);
      expect(agent.conversationHistory).toEqual([{ role: 'user', content: 'earlier' }, { role: 'assistant', content: 'ok' }]);
    });

    it('runs no more tools once stopped', async () => {
      const agent = createAgent();
      agent.registerProvider('mock', MockProvider);
      agent.setProvider('mock', 'key');
      const turn = new AbortController();
      agent.currentProvider.chat = async () => ({ content: null, toolCalls: [{ id: 'a', name: 'compile_sketch', arguments: {} }, { id: 'b', name: 'upload_sketch', arguments: {} }] });
      const ran = [];
      agent.toolExecutor = { execute: async (call) => { ran.push(call.name); turn.abort(); return { success: true }; } };
      await expect(agent.processQuery('compile then upload', {}, 'agent', { signal: turn.signal })).rejects.toMatchObject({ stopped: true });
      expect(ran).toEqual(['compile_sketch']);
    });
  });

  describe('_getToolsForMode', () => {
    it('should return empty array for ask mode', () => {
      const agent = createAgent();
      expect(agent._getToolsForMode('ask')).toEqual([]);
    });

    it('should return tools for agent mode', () => {
      const agent = createAgent();
      const tools = agent._getToolsForMode('agent');
      expect(Array.isArray(tools)).toBe(true);
      expect(tools.length).toBeGreaterThan(0);
    });

    it('should return debug tools for debug mode', () => {
      const agent = createAgent();
      const tools = agent._getToolsForMode('debug');
      expect(Array.isArray(tools)).toBe(true);
    });
  });

  describe('analyzeError', () => {
    it('should return memory results when no provider is set', async () => {
      const agent = createAgent();
      // SimpleMemory returns empty results
      const result = await agent.analyzeError('test error');
      expect(result.source).toBe('memory');
    });
  });
});
