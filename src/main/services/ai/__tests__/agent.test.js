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
      expect(AIAgent.getProviderFromModel('gemini-1.5-flash')).toBe('gemini');
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
