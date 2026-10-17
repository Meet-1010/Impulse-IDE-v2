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

module.exports = { cloudURL };
