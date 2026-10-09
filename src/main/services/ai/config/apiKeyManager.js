const Store = require('electron-store');
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const os = require('os');

/**
 * API key storage backed by the OS credential store (macOS Keychain, Windows
 * DPAPI, libsecret on Linux) through Electron's safeStorage. Keys never leave
 * the main process; the renderer only ever sees a masked suffix.
 */
class APIKeyManager {
  /**
   * @param {{ safeStorage?: import('electron').SafeStorage, store?: object, userDataDir?: string }} [deps]
   */
  constructor(deps = {}) {
    const electron = deps.safeStorage && deps.userDataDir ? null : require('electron');
    this.safeStorage = deps.safeStorage || electron.safeStorage;
    this.userDataDir = deps.userDataDir || electron.app.getPath('userData');
    this.store = deps.store || new Store({ name: 'api-keys-v2' });
    this.migrateLegacyStore();
  }

  canEncrypt() {
    try {
      return this.safeStorage.isEncryptionAvailable();
    } catch {
      return false;
    }
  }

  encode(value) {
    if (this.canEncrypt()) {
      return { enc: 'safeStorage', data: this.safeStorage.encryptString(value).toString('base64') };
    }
    // No OS keyring (e.g. headless Linux): store as-is rather than pretend.
    return { enc: 'none', data: value };
  }

  decode(entry) {
    if (!entry || typeof entry !== 'object') return null;
    if (entry.enc === 'none') return entry.data;
    if (entry.enc === 'safeStorage') {
      try {
        return this.safeStorage.decryptString(Buffer.from(entry.data, 'base64'));
      } catch {
        return null;
      }
    }
    return null;
  }

  /**
   * v1 stored keys in electron-store encrypted with a key derived from the
   * hostname, which changes when macOS switches networks. Recover what can
   * still be decrypted, then delete the old file.
   */
  migrateLegacyStore() {
    const legacyFile = path.join(this.userDataDir, 'api-keys.json');
    if (!fs.existsSync(legacyFile)) return;
    try {
      const legacyKey = crypto.createHash('sha256')
        .update(os.hostname() + 'arduino-ide-cursor-secret')
        .digest('hex')
        .substring(0, 32);
      const legacy = new Store({ name: 'api-keys', cwd: this.userDataDir, encryptionKey: legacyKey });
      const keys = legacy.get('keys', {});
      for (const [provider, key] of Object.entries(keys)) {
        if (typeof key === 'string' && key.length >= 10 && !this.hasAPIKey(provider)) {
          this.store.set(`keys.${provider}`, this.encode(key));
        }
      }
    } catch {
      // Unreadable legacy store (hostname already changed): nothing to recover.
    }
    try { fs.rmSync(legacyFile, { force: true }); } catch { /* best effort */ }
  }

  setAPIKey(provider, apiKey) {
    if (!apiKey || typeof apiKey !== 'string' || apiKey.trim().length === 0) {
      throw new Error('API key cannot be empty');
    }
    const trimmedKey = apiKey.trim();
    if (trimmedKey.length < 10) {
      throw new Error('API key appears to be invalid (too short)');
    }
    try {
      this.store.set(`keys.${provider}`, this.encode(trimmedKey));
      return true;
    } catch (error) {
      throw new Error(`Failed to save API key: ${error.message}`);
    }
  }

  getAPIKey(provider) {
    return this.decode(this.store.get(`keys.${provider}`, null));
  }

  hasAPIKey(provider) {
    return this.getAPIKey(provider) !== null;
  }

  removeAPIKey(provider) {
    this.store.delete(`keys.${provider}`);
    return true;
  }

  getAllProviders() {
    const keys = this.store.get('keys', {});
    return Object.keys(keys).filter(p => this.hasAPIKey(p));
  }

  clearAll() {
    this.store.delete('keys');
    return true;
  }

  isEncrypted() {
    return this.canEncrypt();
  }

  getProviderConfig(provider) {
    const key = this.getAPIKey(provider);
    return {
      hasKey: key !== null,
      key: key ? '***' + key.slice(-4) : null
    };
  }
}

module.exports = APIKeyManager;
