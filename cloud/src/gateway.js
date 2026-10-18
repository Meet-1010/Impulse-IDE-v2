// The AI gateway: an Anthropic-compatible POST /ai/v1/messages. The desktop
// app points the Anthropic SDK here with its session token. Each request is
// checked (signed in, verified, not banned, model on the plan, credits left,
// rate and daily budget), forwarded with Impulse's own API key, streamed back
// unchanged, and charged from the usage Anthropic reports.

import { createHmac } from 'node:crypto';
import { MODELS, costMicros, toMillicredits, totalTokens } from './pricing.js';
import { MIN_TO_START, charge, getAccount, spendable } from './credits.js';
import { allowRequest } from './limits.js';

const ANTHROPIC_VERSION = '2023-06-01';
const MAX_BODY_BYTES = 6 * 1024 * 1024;

/** Request fields passed through; anything else (server tools, fast mode, containers…) is dropped. */
const FIELDS = new Set([
  'model', 'messages', 'system', 'max_tokens', 'tools', 'tool_choice', 'thinking', 'output_config',
  'stop_sequences', 'stream', 'cache_control', 'fallbacks', 'temperature', 'top_p', 'top_k',
  'context_management',
]);

const BETAS = new Set([
  'server-side-fallback-2026-07-01',
  'server-side-fallback-2026-06-01',
  'thinking-display-updates-2026-08-18',
  'mid-conversation-output-config-2026-07-01',
  'context-management-2025-06-27',
  'compact-2026-01-12',
]);

export function apiError(status, type, message, headers = {}) {
  return new Response(JSON.stringify({ type: 'error', error: { type, message } }), {
    status,
    headers: { 'content-type': 'application/json', ...headers },
  });
}

/** Errors the SDK must not retry (it honours x-should-retry). */
const final = (status, type, message) => apiError(status, type, message, { 'x-should-retry': 'false' });

async function readLimited(request, limit) {
  const declared = Number(request.headers.get('content-length') || 0);
  if (declared > limit) return null;
  if (!request.body) return '';
  const reader = request.body.getReader();
  const chunks = [];
  let size = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    size += value.byteLength;
    if (size > limit) {
      await reader.cancel().catch(() => {});
      return null;
    }
    chunks.push(value);
  }
  return Buffer.concat(chunks).toString('utf8');
}

export function cheapestPlanWith(settings, model) {
  return ['free', 'pro', 'max'].find((id) => settings.plans[id]?.models.includes(model)) || null;
}

/** @returns {{ body: object } | { error: Response }} */
export function sanitize(body, settings, userKey) {
  if (!body || typeof body !== 'object' || Array.isArray(body)) {
    return { error: apiError(400, 'invalid_request_error', 'The request body must be a JSON object.') };
  }
  const out = {};
  for (const [key, value] of Object.entries(body)) if (FIELDS.has(key)) out[key] = value;
  if (!Array.isArray(out.messages) || out.messages.length === 0) {
    return { error: apiError(400, 'invalid_request_error', 'messages must be a non-empty array.') };
  }
  if (out.tools !== undefined) {
    if (!Array.isArray(out.tools)) return { error: apiError(400, 'invalid_request_error', 'tools must be an array.') };
    const server = out.tools.find((t) => t && typeof t === 'object' && t.type && t.type !== 'custom');
    if (server) return { error: apiError(400, 'invalid_request_error', `The ${server.type} tool isn't available through Impulse.`) };
  }
  const asked = Number(out.max_tokens);
  out.max_tokens = Math.min(Number.isFinite(asked) && asked >= 1 ? Math.floor(asked) : 4096, settings.maxOutputTokens);
  out.metadata = { user_id: userKey };
  return { body: out };
}

function filterBetas(header) {
  if (!header) return '';
  return header.split(',').map((b) => b.trim()).filter((b) => BETAS.has(b)).join(',');
}

/** Map an upstream failure to what the app should see. Our own key problems never leak as "your key". */
function upstreamFailure(status, text, headers, log) {
  let message = '';
  try {
    message = JSON.parse(text)?.error?.message || '';
  } catch { /* not JSON */ }
  if (status === 401 || status === 403) {
    log(`[gateway] Anthropic rejected the server's API key (${status}): ${message}`);
    return final(503, 'api_error', 'Impulse AI is temporarily unavailable. Try again later.');
  }
  if (status === 429) {
    const retry = headers.get('retry-after');
    return apiError(429, 'rate_limit_error', 'The AI service is busy right now. Trying again in a moment.', retry ? { 'retry-after': retry } : {});
  }
  if (status === 529) return apiError(529, 'overloaded_error', 'The AI service is overloaded. Trying again in a moment.');
  if (status >= 500) return apiError(502, 'api_error', 'The AI service had a problem. Try again.');
  return apiError(status, 'invalid_request_error', message || 'The AI service rejected the request.');
}

/** Reads usage out of the event stream as it passes through. */
export class UsageMeter {
  constructor() {
    this.decoder = new TextDecoder();
    this.buffer = '';
    this.model = null;
    this.served = null;
    this.usage = {};
    this.stopReason = null;
    this.streamedChars = 0;
    this.sawDelta = false;
  }

  feed(chunk) {
    this.buffer += this.decoder.decode(chunk, { stream: true });
    let nl;
    while ((nl = this.buffer.indexOf('\n')) !== -1) {
      const line = this.buffer.slice(0, nl).replace(/\r$/, '');
      this.buffer = this.buffer.slice(nl + 1);
      if (line.startsWith('data:')) this.line(line.slice(5).trim());
    }
    // A single line this long isn't usage; stop holding it.
    if (this.buffer.length > 2_000_000) this.buffer = '';
  }

  line(data) {
    if (!data.startsWith('{')) return;
    let event;
    try {
      event = JSON.parse(data);
    } catch {
      return;
    }
    if (event.type === 'message_start') {
      this.model = event.message?.model || this.model;
      Object.assign(this.usage, event.message?.usage || {});
    } else if (event.type === 'message_delta') {
      // message_delta usage is cumulative: later values replace earlier ones.
      if (event.usage) Object.assign(this.usage, event.usage);
      if (event.delta?.stop_reason) this.stopReason = event.delta.stop_reason;
      this.sawDelta = true;
    } else if (event.type === 'content_block_start' && event.content_block?.type === 'fallback') {
      this.served = event.content_block.to?.model || this.served;
    } else if (event.type === 'content_block_delta') {
      const d = event.delta || {};
      this.streamedChars += (d.text || d.partial_json || d.thinking || '').length;
    }
  }

  /** Usage to bill. Cut short before the final count: estimate output from what streamed. */
  final() {
    if (this.sawDelta) return this.usage;
    return { ...this.usage, output_tokens: Math.max(this.usage.output_tokens || 0, Math.ceil(this.streamedChars / 4)) };
  }
}

/**
 * @param {{ pool, auth, settings, budget, config, background: (p: Promise<unknown>) => void, log?: Function, fetch?: typeof fetch }} deps
 */
export function createGateway(deps) {
  const { pool, auth, settings, budget, config } = deps;
  const log = deps.log || ((m) => console.error(m));
  const upstreamFetch = deps.fetch || fetch;
  const userKey = (id) => createHmac('sha256', config.secret).update(`anthropic-user:${id}`).digest('hex').slice(0, 32);

  async function insertPending(userId, model, client, taskId = null) {
    const { rows } = await pool.query(
      `insert into usage_event (user_id, model, status, client, task_id) values ($1, $2, 'pending', $3, $4) returning id`,
      [userId, model, client, taskId],
    );
    return rows[0].id;
  }

  async function settle({ usageId, userId, model, served, usage, status, httpStatus, started, requestId }) {
    try {
      const s = await settings.get();
      const micros = usage ? costMicros(model, served, usage) : 0;
      budget.add(micros);
      const mc = toMillicredits(micros, s);
      const t = totalTokens(usage || {});
      await pool.query(
        `update usage_event set status = $2, served_model = $3, input_tokens = $4, output_tokens = $5,
           cache_read_tokens = $6, cache_write_tokens = $7, cost_micros = $8, credits_charged = $9,
           http_status = $10, duration_ms = $11, request_id = $12
         where id = $1`,
        [usageId, status, served || null, t.input, t.output, t.cacheRead, t.cacheWrite, micros, mc, httpStatus,
          Date.now() - started, requestId || null],
      );
      if (mc > 0) await charge(pool, userId, mc, { usageId, note: MODELS[model]?.name || model });
    } catch (error) {
      log(`[gateway] could not record usage ${usageId}: ${error?.message || error}`);
    }
  }

  /** @param {Request} request */
  return async function messages(request) {
    const started = Date.now();
    const session = await auth.api.getSession({ headers: request.headers }).catch(() => null);
    if (!session?.user) return final(401, 'authentication_error', 'Sign in to Impulse to use AI.');
    const user = session.user;
    if (user.banned) return final(403, 'permission_error', 'This account is suspended. Contact Impulse support if you think this is a mistake.');
    if (!user.emailVerified) return final(403, 'permission_error', 'Verify your email address to start using your credits.');

    const s = await settings.get();
    if (s.maintenance) return final(503, 'overloaded_error', 'Impulse AI is down for maintenance. Try again soon.');
    if (!config.anthropic.apiKey) return final(503, 'api_error', 'Impulse AI is not set up on this server yet.');

    const raw = await readLimited(request, MAX_BODY_BYTES);
    if (raw === null) return final(413, 'request_too_large', 'This conversation is too long to send. Start a new chat.');
    let body;
    try {
      body = JSON.parse(raw);
    } catch {
      return final(400, 'invalid_request_error', 'The request body is not valid JSON.');
    }
    const model = body?.model;
    if (!MODELS[model] || !s.enabledModels.includes(model)) {
      return final(400, 'invalid_request_error', 'That model is not available on Impulse. Pick another in the model menu.');
    }

    const account = await getAccount(pool, user.id, s);
    const plan = s.plans[account.plan] || s.plans.free;
    if (!plan.models.includes(model)) {
      const needed = cheapestPlanWith(s, model);
      return final(403, 'permission_error', `${MODELS[model].name} is part of the ${s.plans[needed]?.name || 'Pro'} plan. Upgrade, or pick another model.`);
    }
    if (spendable(account) < MIN_TO_START) {
      return final(402, 'insufficient_credits', 'You are out of credits for this month. Upgrade for more, or wait for your monthly refill.');
    }
    if (!(await allowRequest(pool, user.id, s.rateLimitPerMinute))) {
      return apiError(429, 'rate_limit_error', 'Too many requests at once. Trying again in a moment.', { 'retry-after': '20' });
    }
    if (await budget.exceeded(s.dailyBudgetUsd)) {
      log('[gateway] daily budget reached; refusing AI requests until tomorrow (UTC)');
      return final(503, 'overloaded_error', 'Impulse AI is at capacity for today. Try again tomorrow.');
    }

    const clean = sanitize(body, s, userKey(user.id));
    if (clean.error) return clean.error;
    const out = clean.body;
    const beta = new URL(request.url).searchParams.get('beta') === 'true';
    const betas = filterBetas(request.headers.get('anthropic-beta'));
    const taskId = (request.headers.get('x-impulse-task') || '').slice(0, 64) || null;
    const usageId = await insertPending(user.id, model, (request.headers.get('x-impulse-client') || '').slice(0, 80) || null, /^[\w.-]+$/.test(taskId || '') ? taskId : null);

    const abort = new AbortController();
    let upstream;
    try {
      upstream = await upstreamFetch(`${config.anthropic.baseURL}/v1/messages${beta ? '?beta=true' : ''}`, {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          'x-api-key': config.anthropic.apiKey,
          'anthropic-version': ANTHROPIC_VERSION,
          ...(betas ? { 'anthropic-beta': betas } : {}),
        },
        body: JSON.stringify(out),
        signal: abort.signal,
      });
    } catch (error) {
      log(`[gateway] could not reach Anthropic: ${error?.message || error}`);
      await settle({ usageId, userId: user.id, model, status: 'error', httpStatus: 502, started });
      return apiError(502, 'api_error', 'Could not reach the AI service. Try again.');
    }
    const requestId = upstream.headers.get('request-id');

    if (!upstream.ok) {
      const text = await upstream.text().catch(() => '');
      await settle({ usageId, userId: user.id, model, status: 'error', httpStatus: upstream.status, started, requestId });
      return upstreamFailure(upstream.status, text, upstream.headers, log);
    }

    if (!out.stream) {
      const json = await upstream.json();
      await settle({
        usageId, userId: user.id, model, served: json.model, usage: json.usage,
        status: json.stop_reason === 'refusal' ? 'refused' : 'ok', httpStatus: 200, started, requestId,
      });
      return Response.json(json, { headers: requestId ? { 'request-id': requestId } : {} });
    }

    const meter = new UsageMeter();
    const reader = upstream.body.getReader();
    let settled = null;
    const settleOnce = (status) => {
      settled ??= settle({
        usageId, userId: user.id, model, served: meter.served || meter.model, usage: meter.final(),
        status: status === 'ok' && meter.stopReason === 'refusal' ? 'refused' : status,
        httpStatus: 200, started, requestId,
      });
      return settled;
    };

    const stream = new ReadableStream({
      async pull(controller) {
        let chunk;
        try {
          chunk = await reader.read();
        } catch (error) {
          await settleOnce('error');
          controller.error(error);
          return;
        }
        if (chunk.done) {
          // Charge before the last byte, so serverless hosts don't freeze us mid-write.
          await settleOnce('ok');
          controller.close();
          return;
        }
        meter.feed(chunk.value);
        controller.enqueue(chunk.value);
      },
      cancel() {
        // The app stopped (Stop button, closed window): stop paying for output.
        abort.abort();
        reader.cancel().catch(() => {});
        deps.background(settleOnce('aborted'));
      },
    });

    return new Response(stream, {
      status: 200,
      headers: {
        'content-type': 'text/event-stream; charset=utf-8',
        'cache-control': 'no-cache',
        ...(requestId ? { 'request-id': requestId } : {}),
      },
    });
  };
}
