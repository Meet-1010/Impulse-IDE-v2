const os = require('os');
const fs = require('fs');
const path = require('path');
const APIKeyManager = require('../apiKeyManager');

function memoryStore() {
  const data = {};
  const walk = (key, create) => {
    const parts = key.split('.');
    let node = data;
    for (const p of parts.slice(0, -1)) {
      if (node[p] === undefined) { if (!create) return [null, null]; node[p] = {}; }
      node = node[p];
    }
    return [node, parts[parts.length - 1]];
  };
  return {
    get(key, fallback) { const [n, k] = walk(key, false); return n && n[k] !== undefined ? n[k] : fallback; },
    set(key, value) { const [n, k] = walk(key, true); n[k] = value; },
    delete(key) { const [n, k] = walk(key, false); if (n) delete n[k]; },
    raw: data,
  };
}

function fakeSafeStorage(available = true) {
  return {
    isEncryptionAvailable: () => available,
    encryptString: (s) => Buffer.from('ENC:' + s),
    decryptString: (b) => {
      const s = b.toString();
      if (!s.startsWith('ENC:')) throw new Error('bad ciphertext');
      return s.slice(4);
    },
  };
}

function makeManager(opts = {}) {
  const userDataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'impulse-keys-'));
  const store = memoryStore();
  const manager = new APIKeyManager({ safeStorage: fakeSafeStorage(opts.encryption !== false), store, userDataDir });
  return { manager, store };
}

describe('APIKeyManager', () => {
  it('stores keys encrypted and reads them back', () => {
    const { manager, store } = makeManager();
    manager.setAPIKey('claude', '  sk-ant-abcdefghijkl  ');
    expect(manager.getAPIKey('claude')).toBe('sk-ant-abcdefghijkl');
    expect(store.raw.keys.claude.enc).toBe('safeStorage');
    expect(JSON.stringify(store.raw)).not.toContain('sk-ant-abcdefghijkl');
  });

  it('only exposes a masked key in provider config', () => {
    const { manager } = makeManager();
    manager.setAPIKey('openai', 'sk-proj-1234567890WXYZ');
    expect(manager.getProviderConfig('openai')).toEqual({ hasKey: true, key: '***WXYZ' });
    expect(manager.getProviderConfig('gemini')).toEqual({ hasKey: false, key: null });
  });

  it('rejects empty and too-short keys', () => {
    const { manager } = makeManager();
    expect(() => manager.setAPIKey('claude', '   ')).toThrow('cannot be empty');
    expect(() => manager.setAPIKey('claude', 'short')).toThrow('too short');
  });

  it('removes keys and lists only readable providers', () => {
    const { manager, store } = makeManager();
    manager.setAPIKey('claude', 'sk-ant-abcdefghijkl');
    manager.setAPIKey('openai', 'sk-proj-abcdefghijkl');
    store.raw.keys.gemini = { enc: 'safeStorage', data: Buffer.from('garbage').toString('base64') };
    expect(manager.getAllProviders().sort()).toEqual(['claude', 'openai']);
    manager.removeAPIKey('claude');
    expect(manager.hasAPIKey('claude')).toBe(false);
  });

  it('falls back to unencrypted storage when no OS keyring exists', () => {
    const { manager, store } = makeManager({ encryption: false });
    manager.setAPIKey('claude', 'sk-ant-abcdefghijkl');
    expect(store.raw.keys.claude.enc).toBe('none');
    expect(manager.getAPIKey('claude')).toBe('sk-ant-abcdefghijkl');
    expect(manager.isEncrypted()).toBe(false);
  });
});
