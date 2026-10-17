const { Anthropic } = require('@anthropic-ai/sdk');
const ClaudeProvider = require('./claudeProvider');
const { cloudURL } = require('../../cloud/config');

/**
 * Claude through Impulse Cloud: the same requests as ClaudeProvider, sent to
 * the Impulse AI gateway with the account's session token. The gateway adds
 * Impulse's API key and charges the account's credits. Model ids carry an
 * "impulse:" prefix so they never mix with local (ollama:) models.
 */

const PREFIX = 'impulse:';

/** Shown until the server's catalog arrives (GET /v1/models). */
const CATALOG = [
  { id: 'claude-opus-5-5', name: 'Opus 5.5', tagline: 'Best for building', cost: 1 },
  { id: 'claude-sonnet-5-5', name: 'Sonnet 5.5', tagline: 'Fast and capable', cost: 0.5 },
  { id: 'claude-haiku-5-5', name: 'Haiku 5.5', tagline: 'Quickest, lowest cost', cost: 0.03 },
  { id: 'claude-fable-5-1', name: 'Fable 5.1', tagline: 'Most capable', cost: 2.4 },
];

class ImpulseProvider extends ClaudeProvider {
  static PREFIX = PREFIX;
  static DEFAULT_MODEL = `${PREFIX}claude-opus-5-5`;

  static isModelId(id) {
    return typeof id === 'string' && id.startsWith(PREFIX);
  }

  static catalog() {
    return CATALOG;
  }

  static displayName(id) {
    const plain = String(id).replace(PREFIX, '');
    return CATALOG.find((m) => m.id === plain)?.name || plain;
  }

  /**
   * @param {string} token the account's session token
   * @param {string} [model] an impulse: model id
   */
  constructor(token, model = null, { version = '0.0.0', baseURL = cloudURL() } = {}) {
    const id = ImpulseProvider.isModelId(model) ? model : ImpulseProvider.DEFAULT_MODEL;
    super(token, id.slice(PREFIX.length));
    this.name = 'impulse';
    this.appModel = id;
    // apiKey: null so an ANTHROPIC_API_KEY in the environment is never sent to the gateway.
    this.client = new Anthropic({
      apiKey: null,
      authToken: token,
      baseURL: `${baseURL || 'http://impulse-cloud.invalid'}/ai`,
      maxRetries: 2,
      defaultHeaders: { 'x-impulse-client': `Impulse IDE/${version}` },
    });
  }

  getAvailableModels() {
    return CATALOG.map((m) => `${PREFIX}${m.id}`);
  }

  async chat(messages, options = {}) {
    try {
      return await super.chat(messages, options);
    } catch (error) {
      throw ImpulseProvider.toFriendly(error);
    }
  }

  /** ClaudeProvider already turned SDK errors into text; recover the status from the cause. */
  static toFriendly(error) {
    const cause = error?.cause;
    const status = cause?.status;
    const serverMessage = cause?.error?.error?.message;
    const make = (message, code) => Object.assign(new Error(message), { code });
    if (cause instanceof Anthropic.APIConnectionError) return make('Can\'t reach Impulse. Check your internet connection.', 'offline');
    if (status === 401) return make('Your Impulse session ended. Sign in again to keep building.', 'signed_out');
    if (status === 402) return make(serverMessage || 'You\'re out of credits. Upgrade for more, or wait for your monthly refill.', 'insufficient_credits');
    if (status === 403) return make(serverMessage || 'Your account can\'t use this right now.', 'forbidden');
    if (status === 413) return make(serverMessage || 'This conversation is too long. Start a new chat.', 'too_long');
    if (status === 429) return make(serverMessage || 'Too many requests at once. Wait a moment and try again.', 'rate_limited');
    if (status === 503 || status === 529) return make(serverMessage || 'Impulse AI is busy right now. Try again soon.', 'unavailable');
    if (status) return make(serverMessage || error.message, 'server');
    return error;
  }

  validateApiKey(token) {
    return typeof token === 'string' && token.length >= 16;
  }
}

module.exports = ImpulseProvider;
