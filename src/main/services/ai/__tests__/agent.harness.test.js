/**
 * The harness around the model: tool packs loaded on demand, and the verify
 * guard that compiles an edited sketch before the model's "done" stands.
 */
const AIAgent = require('../agent');

function scripted(turns) {
  // Each call to chat() pops the next scripted response; records what it was asked with.
  const calls = [];
  return {
    calls,
    provider: {
      name: 'mock', model: 'mock-model',
      validateApiKey: () => true,
      getAvailableModels: () => ['mock-model'],
      async chat(messages, options) {
        calls.push({ messages, tools: (options.tools || []).map((t) => t.name), taskId: options.taskId });
        const next = turns.shift();
        return next || { content: 'done', toolCalls: [] };
      },
    },
  };
}

function agentWith(turns, executorResults = {}) {
  const agent = new AIAgent({}, {}, {});
  const { provider, calls } = scripted(turns);
  agent.providers.set('mock', function Mock() { return provider; });
  agent.setProvider('mock', 'key');
  agent.currentProvider = provider;
  const executed = [];
  agent.toolExecutor = {
    boardKnowledge: null,
    async execute(call) {
      executed.push(call.name);
      const r = executorResults[call.name];
      return typeof r === 'function' ? r(call) : (r || { success: true, tool: call.name });
    },
  };
  return { agent, calls, executed };
}

describe('tool packs', () => {
  it('starts agent mode with the standing set and adds a pack when the model loads it', async () => {
    const { agent, calls, executed } = agentWith([
      { content: null, toolCalls: [{ id: '1', name: 'load_tools', arguments: { pack: 'boards' } }] },
      { content: null, toolCalls: [{ id: '2', name: 'list_ports', arguments: {} }] },
      { content: 'Here are the ports.', toolCalls: [] },
    ]);
    const result = await agent.processQuery('which ports?', { hasFileOpen: true }, 'agent');
    expect(calls[0].tools).toEqual(expect.arrayContaining(['compile_sketch', 'serial', 'get_circuit', 'load_tools']));
    expect(calls[0].tools).not.toContain('list_ports');
    expect(calls[0].tools).not.toContain('connect_serial');
    expect(calls[1].tools).toEqual(expect.arrayContaining(['list_ports', 'list_boards', 'search_boards', 'get_mcu_guide']));
    expect(executed).toEqual(['list_ports']); // load_tools never reaches the executor
    expect(result.toolResults[0]).toMatchObject({ success: true, tool: 'load_tools', loaded: expect.arrayContaining(['list_ports']) });
    expect(result.response).toBe('Here are the ports.');
    expect(result.taskId).toMatch(/^t_/);
    expect(new Set(calls.map((c) => c.taskId)).size).toBe(1);
  });

  it('refuses an unknown pack without calling anything', async () => {
    const { agent, executed } = agentWith([
      { content: null, toolCalls: [{ id: '1', name: 'load_tools', arguments: '{"pack":"kitchen"}' }] },
      { content: 'ok', toolCalls: [] },
    ]);
    const result = await agent.processQuery('x', { hasFileOpen: true }, 'agent');
    expect(result.toolResults[0]).toMatchObject({ success: false, tool: 'load_tools' });
    expect(executed).toEqual([]);
  });

  it('debug mode can read, edit, compile and watch serial', () => {
    const names = new AIAgent({}, {}, {})._getToolsForMode('debug').map((t) => t.name);
    expect(names).toEqual(expect.arrayContaining(['get_editor_code', 'edit_code', 'compile_sketch', 'serial', 'analyze_error', 'search_memory', 'record_fix']));
  });
});

describe('the verify guard', () => {
  it('compiles an edited sketch before the answer stands, and reports the size', async () => {
    const { agent, executed } = agentWith([
      { content: null, toolCalls: [{ id: '1', name: 'set_editor_code', arguments: { code: 'void setup(){} void loop(){}' } }] },
      { content: 'Written.', toolCalls: [] },
    ], { compile_sketch: { success: true, tool: 'compile_sketch', summary: ['Sketch uses 444 bytes (1%) of program storage space. Maximum is 32,256 bytes.'] } });
    const result = await agent.processQuery('write blink', { hasFileOpen: true }, 'agent');
    expect(executed).toEqual(['set_editor_code', 'compile_sketch']);
    expect(result.response).toBe('Written.\n\nSketch uses 444 bytes (1%) of program storage space. Maximum is 32,256 bytes.');
    expect(result.toolResults.at(-1)).toMatchObject({ tool: 'compile_sketch', verify: true });
  });

  it('sends a failing verify back to the model, which fixes it, and compiles once more', async () => {
    let compiles = 0;
    const { agent, calls, executed } = agentWith([
      { content: null, toolCalls: [{ id: '1', name: 'edit_code', arguments: { operation: 'replace', startLine: 1, newCode: 'x' } }] },
      { content: 'Changed line 1.', toolCalls: [] },
      { content: null, toolCalls: [{ id: '2', name: 'edit_code', arguments: { operation: 'replace', startLine: 1, newCode: 'y' } }] },
      { content: 'Fixed the typo.', toolCalls: [] },
    ], {
      compile_sketch: () => (++compiles === 1
        ? { success: false, tool: 'compile_sketch', code: 'CODE_ERROR', error: 'The sketch has a compile error', excerpt: "x.ino:1:1: error: 'x' does not name a type", diagnostics: [{ file: '/s/x.ino', line: 1, level: 'error', message: "'x' does not name a type" }] }
        : { success: true, tool: 'compile_sketch', summary: ['Sketch uses 1,000 bytes (3%) of program storage space.'] }),
    });
    const result = await agent.processQuery('fix it', { hasFileOpen: true }, 'agent');
    expect(executed).toEqual(['edit_code', 'compile_sketch', 'edit_code', 'compile_sketch']);
    const verifyMessage = calls[2].messages.find((m) => m.role === 'user' && /\[VERIFY\]/.test(m.content));
    expect(verifyMessage.content).toMatch(/does not compile:\nThe sketch has a compile error\nx\.ino:1:1: error/);
    expect(result.response).toMatch(/^Fixed the typo\./);
    expect(result.response).toMatch(/Sketch uses 1,000 bytes/);
  });

  it('does not compile when nothing was edited, when the model compiled already, or outside agent mode', async () => {
    const a = agentWith([{ content: 'just talk', toolCalls: [] }]);
    await a.agent.processQuery('hi', { hasFileOpen: true }, 'agent');
    expect(a.executed).toEqual([]);
    const b = agentWith([
      { content: null, toolCalls: [{ id: '1', name: 'set_editor_code', arguments: { code: '' } }, { id: '2', name: 'compile_sketch', arguments: {} }] },
      { content: 'done', toolCalls: [] },
    ]);
    await b.agent.processQuery('go', { hasFileOpen: true }, 'agent');
    expect(b.executed).toEqual(['set_editor_code', 'compile_sketch']);
    const c = agentWith([
      { content: null, toolCalls: [{ id: '1', name: 'edit_code', arguments: { operation: 'delete', startLine: 1 } }] },
      { content: 'done', toolCalls: [] },
    ]);
    await c.agent.processQuery('go', { hasFileOpen: true }, 'debug');
    expect(c.executed).toEqual(['edit_code']);
  });
});
