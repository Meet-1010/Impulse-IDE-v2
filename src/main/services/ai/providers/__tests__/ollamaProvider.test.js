// Ollama: local models without a key. The server is mocked; the converted
// requests are checked against Ollama's /api/chat format.
const OllamaProvider = require('../ollamaProvider');
const { ollamaBaseUrl, displayNameFor, textToolCalls } = OllamaProvider;
const AIAgent = require('../../agent');

const json = (body, status = 200) => ({ ok: status < 400, status, json: async () => body, text: async () => JSON.stringify(body) });

afterEach(() => {
  OllamaProvider.models = [];
  OllamaProvider.status = { running: false };
});

describe('where the server is', () => {
  test('follows OLLAMA_HOST like the ollama CLI', () => {
    expect(ollamaBaseUrl({})).toBe('http://127.0.0.1:11434');
    expect(ollamaBaseUrl({ OLLAMA_HOST: '0.0.0.0' })).toBe('http://127.0.0.1:11434');
    expect(ollamaBaseUrl({ OLLAMA_HOST: '127.0.0.1:11435' })).toBe('http://127.0.0.1:11435');
    expect(ollamaBaseUrl({ OLLAMA_HOST: 'http://gpu-box.local' })).toBe('http://gpu-box.local:11434');
    expect(ollamaBaseUrl({ OLLAMA_HOST: 'https://ollama.example.com' })).toBe('https://ollama.example.com');
  });

  test('model names read like product names', () => {
    expect(displayNameFor('qwen2.5-coder:7b')).toBe('Qwen2.5 Coder 7B');
    expect(displayNameFor('llama3.1:latest')).toBe('Llama3.1');
    expect(displayNameFor('gpt-oss:20b')).toBe('Gpt Oss 20B');
  });
});

describe('listing local models', () => {
  test('newest first, with tool support and context size, embedding models left out', async () => {
    const fetchImpl = jest.fn(async (url, init) => {
      if (url.endsWith('/api/tags')) {
        return json({ models: [
          { name: 'llama3.1:8b', modified_at: '2026-09-01T10:00:00Z', size: 4 },
          { name: 'nomic-embed-text:latest', modified_at: '2026-10-01T10:00:00Z', size: 1 },
          { name: 'qwen2.5-coder:7b', modified_at: '2026-10-10T10:00:00Z', size: 5 },
        ] });
      }
      const { model } = JSON.parse(init.body);
      return json(model.startsWith('qwen')
        ? { capabilities: ['completion', 'tools', 'insert'], model_info: { 'qwen2.context_length': 32768 } }
        : { capabilities: ['completion'], model_info: { 'llama.context_length': 131072 } });
    });
    const result = await OllamaProvider.listModels({ fetchImpl });
    expect(result.running).toBe(true);
    expect(result.models.map((m) => m.id)).toEqual(['ollama:qwen2.5-coder:7b', 'ollama:llama3.1:8b']);
    expect(result.models[0]).toMatchObject({ tools: true, contextLength: 32768, displayName: 'Qwen2.5 Coder 7B' });
    expect(result.models[1].tools).toBe(false);
    expect(new OllamaProvider().getAvailableModels()).toEqual(['ollama:qwen2.5-coder:7b', 'ollama:llama3.1:8b']);
  });

  test('a stopped server is an empty list, not an error', async () => {
    const result = await OllamaProvider.listModels({ fetchImpl: async () => { throw new TypeError('fetch failed'); } });
    expect(result).toMatchObject({ running: false, models: [] });
  });
});

describe('chatting', () => {
  const tools = [{ name: 'compile_sketch', description: 'Compile', parameters: { type: 'object', properties: {} } }];

  test('sends the agent history in Ollama\'s format and returns tool calls with ids', async () => {
    OllamaProvider.models = [{ id: 'ollama:qwen2.5-coder:7b', name: 'qwen2.5-coder:7b', tools: true, contextLength: 32768 }];
    const provider = new OllamaProvider(null, 'ollama:qwen2.5-coder:7b');
    let sent;
    provider.fetch = jest.fn(async (url, init) => {
      sent = JSON.parse(init.body);
      return json({ message: { role: 'assistant', content: '<think>plan</think>Compiling now.', tool_calls: [{ function: { name: 'compile_sketch', arguments: { verbose: true } } }] }, prompt_eval_count: 900, eval_count: 40 });
    });
    const out = await provider.chat([
      { role: 'system', content: 'sys' },
      { role: 'user', content: 'blink' },
      { role: 'assistant', content: null, tool_calls: [{ id: 'a', type: 'function', function: { name: 'get_editor_code', arguments: '{"x":1}' } }] },
      { role: 'tool', tool_call_id: 'a', name: 'get_editor_code', content: '{"code":""}' },
    ], { tools, temperature: 0.2 });

    expect(provider.fetch.mock.calls[0][0]).toBe('http://127.0.0.1:11434/api/chat');
    expect(sent.model).toBe('qwen2.5-coder:7b');
    expect(sent.stream).toBe(false);
    expect(sent.options).toEqual({ temperature: 0.2, num_ctx: 16384 });
    expect(sent.tools[0]).toEqual({ type: 'function', function: tools[0] });
    expect(sent.messages[2]).toEqual({ role: 'assistant', content: '', tool_calls: [{ function: { name: 'get_editor_code', arguments: { x: 1 } } }] });
    expect(sent.messages[3]).toEqual({ role: 'tool', content: '{"code":""}', tool_name: 'get_editor_code' });

    expect(out.content).toBe('Compiling now.');
    expect(out.toolCalls).toHaveLength(1);
    expect(out.toolCalls[0]).toMatchObject({ name: 'compile_sketch', arguments: { verbose: true } });
    expect(out.toolCalls[0].id).toMatch(/^ollama_call_/);
    expect(out.usage).toEqual({ prompt_tokens: 900, completion_tokens: 40 });
  });

  test('a model without tool support answers in text, and says why', async () => {
    const info = { id: 'ollama:gemma:2b', name: 'gemma:2b', tools: null };
    OllamaProvider.models = [info];
    const provider = new OllamaProvider(null, 'ollama:gemma:2b');
    provider.fetch = jest.fn()
      .mockResolvedValueOnce(json({ error: 'registry.ollama.ai/library/gemma:2b does not support tools' }, 400))
      .mockResolvedValueOnce(json({ message: { content: 'Use digitalWrite(13, HIGH).' } }));
    const out = await provider.chat([{ role: 'user', content: 'blink' }], { tools });
    expect(provider.fetch).toHaveBeenCalledTimes(2);
    expect(JSON.parse(provider.fetch.mock.calls[1][1].body).tools).toBeUndefined();
    expect(out.toolCalls).toEqual([]);
    expect(out.content).toMatch(/^Use digitalWrite\(13, HIGH\)\./);
    expect(out.content).toMatch(/can't use Impulse's tools/);
    expect(info.tools).toBe(false);
  });

  test('Ask mode sends no tools and adds no note', async () => {
    OllamaProvider.models = [{ id: 'ollama:llama3.1:8b', name: 'llama3.1:8b', tools: true }];
    const provider = new OllamaProvider(null, 'ollama:llama3.1:8b');
    provider.fetch = jest.fn(async () => json({ message: { content: 'Hi.' } }));
    const out = await provider.chat([{ role: 'user', content: 'hi' }], { tools: [] });
    expect(JSON.parse(provider.fetch.mock.calls[0][1].body).tools).toBeUndefined();
    expect(out.content).toBe('Hi.');
  });

  test('clear messages when Ollama is stopped or the model is missing', async () => {
    const provider = new OllamaProvider(null, 'ollama:qwen3:8b');
    provider.fetch = async () => { throw new TypeError('fetch failed'); };
    await expect(provider.chat([{ role: 'user', content: 'x' }], { tools: [] })).rejects.toThrow(/Ollama isn't running/);
    provider.fetch = async () => json({ error: 'model "qwen3:8b" not found, try pulling it first' }, 404);
    await expect(provider.chat([{ role: 'user', content: 'x' }], { tools: [] })).rejects.toThrow(/ollama pull qwen3:8b/);
  });

  test('needs no key, and with nothing installed says how to get a model', async () => {
    const provider = new OllamaProvider();
    expect(provider.validateApiKey(undefined)).toBe(true);
    await expect(provider.chat([{ role: 'user', content: 'x' }])).rejects.toThrow(/ollama pull/);
  });
});

describe('tool calls written as text', () => {
  const tools = [
    { name: 'set_editor_code', parameters: { type: 'object', properties: { code: { type: 'string' } }, required: ['code'] } },
    { name: 'compile_sketch', parameters: { type: 'object', properties: {} } },
  ];

  test('a ```json block naming a tool becomes a call (qwen2.5-coder writes these)', () => {
    const content = 'Here it is.\n```json\n{"name": "set_editor_code", "arguments": "void setup() {\\\\n  pinMode(13, OUTPUT);\\\\n}"}\n```';
    const { calls, rest } = textToolCalls(content, tools);
    expect(calls).toEqual([{ name: 'set_editor_code', arguments: { code: 'void setup() {\n  pinMode(13, OUTPUT);\n}' } }]);
    expect(rest).toBe('Here it is.');
  });

  test('<tool_call> tags, bare objects and arrays work too', () => {
    expect(textToolCalls('<tool_call>{"name":"compile_sketch","arguments":{}}</tool_call>', tools).calls).toEqual([{ name: 'compile_sketch', arguments: {} }]);
    expect(textToolCalls('{"name":"compile_sketch","parameters":{}}', tools).calls).toHaveLength(1);
    const twoLines = '{"name": "set_editor_code", "arguments": "void loop() { delay(500); }"}\n{"name": "compile_sketch", "arguments": {}}';
    expect(textToolCalls(twoLines, tools)).toEqual({
      calls: [{ name: 'set_editor_code', arguments: { code: 'void loop() { delay(500); }' } }, { name: 'compile_sketch', arguments: {} }],
      rest: '',
    });
    expect(textToolCalls('```json\n[{"name":"compile_sketch","arguments":{}},{"name":"set_editor_code","arguments":{"code":"x"}}]\n```', tools).calls).toHaveLength(2);
  });

  test('code blocks and JSON that name no tool are left alone', () => {
    const answer = '```cpp\nvoid loop() {}\n```\n```json\n{"name": "Uno", "fqbn": "arduino:avr:uno"}\n```';
    expect(textToolCalls(answer, tools)).toEqual({ calls: [], rest: answer });
  });

  test('the provider runs a recovered call instead of claiming it did', async () => {
    OllamaProvider.models = [{ id: 'ollama:qwen2.5-coder:7b', name: 'qwen2.5-coder:7b', tools: true }];
    const provider = new OllamaProvider(null, 'ollama:qwen2.5-coder:7b');
    provider.fetch = async () => json({ message: { content: '```json\n{"name": "compile_sketch", "arguments": {}}\n```' } });
    const out = await provider.chat([{ role: 'user', content: 'compile' }], { tools });
    expect(out.toolCalls).toHaveLength(1);
    expect(out.toolCalls[0]).toMatchObject({ name: 'compile_sketch', arguments: {} });
    expect(out.content).toBe('');
  });
});

describe('getting a model', () => {
  test('offers models that call tools and fit the computer, best first', () => {
    const names = (gb) => OllamaProvider.recommendedModels(gb * 1024 ** 3).map((m) => m.name);
    expect(names(64)).toEqual(['qwen3-coder:30b', 'devstral-small-2:24b', 'qwen3:14b', 'qwen3:8b', 'rnj-1:8b', 'qwen3:4b']);
    expect(names(16)).toEqual(['qwen3:8b', 'rnj-1:8b', 'qwen3:4b']);
    expect(names(8)).toEqual(['qwen3:4b']);
    expect(OllamaProvider.recommendedModel(16 * 1024 ** 3)).toMatchObject({ name: 'qwen3:8b', size: '5.2 GB' });
    for (const m of OllamaProvider.recommendedModels(128 * 1024 ** 3)) expect(m.note).toBeTruthy();
  });

  test('downloads with progress from Ollama\'s streamed status lines', async () => {
    const enc = new TextEncoder();
    const lines = [
      { status: 'pulling manifest' },
      { status: 'pulling 3e7f', total: 1000, completed: 250 },
      { status: 'pulling 3e7f', total: 1000, completed: 1000 },
      { status: 'success' },
    ].map((l) => JSON.stringify(l) + '\n').join('');
    // Split mid-line, as a network stream does.
    const chunks = [lines.slice(0, 30), lines.slice(30, 95), lines.slice(95)].map((c) => enc.encode(c));
    const fetchImpl = jest.fn(async (url) => {
      if (url.endsWith('/api/pull')) return { ok: true, body: (async function* () { yield* chunks; })() };
      return json({ models: [{ name: 'qwen3:4b', modified_at: '2026-10-12T00:00:00Z' }] });
    });
    const progress = [];
    const realFetch = global.fetch;
    global.fetch = fetchImpl;
    try {
      const out = await OllamaProvider.pull('qwen3:4b', (p) => progress.push(p), { fetchImpl });
      expect(out).toEqual({ success: true, id: 'ollama:qwen3:4b' });
    } finally {
      global.fetch = realFetch;
    }
    expect(JSON.parse(fetchImpl.mock.calls[0][1].body)).toEqual({ model: 'qwen3:4b', stream: true });
    expect(progress.map((p) => p.percent)).toEqual([null, 25, 100, null]);
  });

  test('a thinking model is asked to answer directly', async () => {
    OllamaProvider.models = [{ id: 'ollama:qwen3:8b', name: 'qwen3:8b', tools: true, thinking: true }];
    const provider = new OllamaProvider(null, 'ollama:qwen3:8b');
    provider.fetch = jest.fn(async () => json({ message: { content: 'ok' } }));
    await provider.chat([{ role: 'user', content: 'x' }], { tools: [] });
    expect(JSON.parse(provider.fetch.mock.calls[0][1].body).think).toBe(false);
  });
});

describe('the agent', () => {
  test('routes ollama: models to Ollama, which needs no key', () => {
    expect(AIAgent.getProviderFromModel('ollama:qwen2.5-coder:7b')).toBe('ollama');
    expect(AIAgent.isKeyless('ollama')).toBe(true);
    expect(AIAgent.isKeyless('claude')).toBe(false);
  });

  test('lists the installed local models with the cloud ones', () => {
    OllamaProvider.models = [{ id: 'ollama:qwen2.5-coder:7b', name: 'qwen2.5-coder:7b', displayName: 'Qwen2.5 Coder 7B', tools: true }];
    const agent = new AIAgent(null, null, null);
    agent.initializeProviders();
    const local = agent.getUnifiedModelList().filter((m) => m.provider === 'ollama');
    expect(local).toEqual([{ id: 'ollama:qwen2.5-coder:7b', displayName: 'Qwen2.5 Coder 7B', provider: 'ollama', latest: true }]);
    const provider = agent.setProvider('ollama', 'local', 'ollama:qwen2.5-coder:7b');
    expect(provider.name).toBe('ollama');
  });
});
