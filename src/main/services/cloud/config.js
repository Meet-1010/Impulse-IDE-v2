/**
 * Where Impulse Cloud (accounts, credits, AI) lives: package.json
 * "impulse.cloudUrl", or IMPULSE_CLOUD_URL for development and tests.
 * @module main/services/cloud/config
 */

const pkg = require('../../../../package.json');

/** @returns {string | null} the base URL without a trailing slash, or null when this build has none */
function cloudURL(env = process.env) {
  const value = env.IMPULSE_CLOUD_URL || pkg.impulse?.cloudUrl || '';
  if (!/^https?:\/\//.test(value)) return null;
  // Plain http is only for a server on this machine.
  const url = new URL(value);
  if (url.protocol === 'http:' && !['localhost', '127.0.0.1', '[::1]'].includes(url.hostname)) return null;
  return value.replace(/\/+$/, '');
}

/**
 * Whether this build offers models that run on this computer (Ollama).
 * IMPULSE_LOCAL_MODELS=1/0 decides for development and tests; otherwise
 * package.json "impulse.localModels" when set; otherwise local models exist
 * only in a build without a cloud address. A release with a cloud address is
 * credits-only.
 */
function localModelsEnabled(env = process.env) {
  const flag = env.IMPULSE_LOCAL_MODELS;
  if (flag !== undefined && flag !== '') return !['0', 'false', 'no', 'off'].includes(String(flag).toLowerCase());
  if (typeof pkg.impulse?.localModels === 'boolean') return pkg.impulse.localModels;
  return cloudURL(env) === null;
}

module.exports = { cloudURL, localModelsEnabled };
