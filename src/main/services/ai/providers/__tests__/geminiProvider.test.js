// Gemini through the (mocked) SDK: the current model list, tool calls replayed
// with their thought signatures, and Gemini 3 left at its own temperature.
const mockCalls = [];
let mockReply = null;
jest.mock('@google/generative-ai', () => ({
  GoogleGenerativeAI: class {
    getGenerativeModel(config) {
      return {
        generateContent: async (req) => {
          mockCalls.push({ config, req });
          return { response: mockReply };
        },
      };
    }
  },
}));

const GeminiProvider = require('../geminiProvider');

const fnReply = {
  candidates: [{ content: { role: 'model', parts: [{ functionCall: { name: 'compile_sketch', args: {} }, thoughtSignature: 'sig-123' }] } }],
  text: () => { throw new Error('no text'); },
  usageMetadata: { promptTokenCount: 5, candidatesTokenCount: 2 },
};
const textReply = {
  candidates: [{ content: { role: 'model', parts: [{ text: 'Compiled.' }] } }],
  text: () => 'Compiled.',
  usageMetadata: {},
};

beforeEach(() => { mockCalls.length = 0; });

describe('Gemini provider', () => {
  test('offers the current models, newest first, and none that are shut down', () => {
    const models = new GeminiProvider('AIza-test-key-0000000000000000000000').getAvailableModels();
    expect(models[0]).toBe('gemini-3.8-flash');
    expect(GeminiProvider.DEFAULT_MODEL).toBe('gemini-3.8-flash');
    expect(models.some(m => /^gemini-(1\.5|2\.0)/.test(m))).toBe(false);
  });

  test('a tool call goes back with its thought signature', async () => {
    const p = new GeminiProvider('AIza-test-key-0000000000000000000000', 'gemini-3.8-flash');
    mockReply = fnReply;
    const first = await p.chat([{ role: 'system', content: 'sys' }, { role: 'user', content: 'compile it' }], { tools: [{ name: 'compile_sketch', description: 'c', parameters: {} }] });
    expect(first.toolCalls.map(t => t.name)).toEqual(['compile_sketch']);
    expect(first.rawContent.geminiParts[0].thoughtSignature).toBe('sig-123');

    mockReply = textReply;
    const assistant = { role: 'assistant', content: null, rawContent: first.rawContent, tool_calls: [{ id: 't1', function: { name: 'compile_sketch', arguments: '{}' } }] };
    const second = await p.chat([{ role: 'user', content: 'compile it' }, assistant, { role: 'tool', name: 'compile_sketch', content: '{"success":true}' }]);
    expect(second.content).toBe('Compiled.');
    const model = mockCalls[1].req.contents.find(c => c.role === 'model');
    expect(model.parts[0]).toEqual({ functionCall: { name: 'compile_sketch', args: {} }, thoughtSignature: 'sig-123' });
  });

  test('Gemini 3 keeps its default temperature; older models get the configured one', async () => {
    mockReply = textReply;
    await new GeminiProvider('AIza-test-key-0000000000000000000000', 'gemini-3.1-pro-preview').chat([{ role: 'user', content: 'hi' }], { temperature: 0.3 });
    expect(mockCalls[0].config.generationConfig.temperature).toBeUndefined();
    await new GeminiProvider('AIza-test-key-0000000000000000000000', 'gemini-2.5-flash').chat([{ role: 'user', content: 'hi' }], { temperature: 0.3 });
    expect(mockCalls[1].config.generationConfig.temperature).toBe(0.3);
  });

  test('a model the key can\'t use says what to do', async () => {
    const p = new GeminiProvider('AIza-test-key-0000000000000000000000', 'gemini-2.5-pro');
    p.genAI = { getGenerativeModel: () => ({ generateContent: async () => { throw new Error('[404 Not Found] models/gemini-2.5-pro is not found'); } }) };
    await expect(p.chat([{ role: 'user', content: 'hi' }])).rejects.toThrow(/isn't available to this API key.*Choose another Gemini model/);
  });
});
