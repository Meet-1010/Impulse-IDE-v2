import { after, before, beforeEach, describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { readAll, setup, startFakeAnthropic } from './helpers.js';

const MESSAGE = { model: 'claude-opus-5-5', max_tokens: 32000, messages: [{ role: 'user', content: 'Blink an LED' }] };

describe('AI gateway', () => {
  let t;
  let fake;
  let token;
  let userId;

  before(async () => {
    fake = await startFakeAnthropic();
    t = await setup({ fake });
    ({ token, user: { id: userId } } = await t.signUp('maker@impulse.test'));
  });
  after(async () => {
    await t.close();
    await fake.close();
  });
  beforeEach(async () => {
    fake.reply = null;
    fake.calls.length = 0;
    await t.pool.query(`delete from app_setting`);
    t.settings.invalidate();
    await t.pool.query(`update credit_account set plan = 'free', plan_credits = 100000, bonus_credits = 200000 where user_id = $1`, [userId]);
    await t.pool.query(`update "user" set banned = false where id = $1`, [userId]);
    await t.pool.query(`delete from rate_bucket`);
  });

  const send = (body = MESSAGE, headers = {}) => t.request('/ai/v1/messages?beta=true', {
    method: 'POST',
    headers: { 'content-type': 'application/json', ...t.bearer(token), ...headers },
    body: JSON.stringify(body),
  });
  const balance = async () => (await t.pool.query('select plan_credits, bonus_credits from credit_account where user_id = $1', [userId])).rows[0];
  const lastUsage = async () => (await t.pool.query('select * from usage_event where user_id = $1 order by id desc limit 1', [userId])).rows[0];

  test('streams the answer through unchanged and charges what it cost', async () => {
    const res = await send({ ...MESSAGE, stream: true }, { 'x-impulse-task': 't_abc123_xyz' });
    assert.equal(res.status, 200);
    assert.match(res.headers.get('content-type'), /text\/event-stream/);
    const text = await readAll(res);
    assert.match(text, /event: message_start/);
    assert.match(text, /from the fake API\./);
    assert.match(text, /event: message_stop/);

    // 1200 in x $4 + 8000 cached x $0.20 + 500 written x $5 + 300 out x $20 = $0.0149 = 1.49 credits.
    const usage = await lastUsage();
    assert.equal(usage.status, 'ok');
    assert.equal(usage.cost_micros, 14900);
    assert.equal(usage.credits_charged, 1490);
    assert.equal(usage.output_tokens, 300);
    assert.equal(usage.request_id, 'req_test');
    assert.equal(usage.task_id, 't_abc123_xyz', 'the app\'s task id is kept so cost per task is one query');
    const b = await balance();
    assert.equal(b.plan_credits, 100000 - 1490, 'plan credits are spent first');
    assert.equal(b.bonus_credits, 200000);
  });

  test('a non-streaming request is charged too', async () => {
    const res = await send(MESSAGE);
    assert.equal(res.status, 200);
    assert.equal((await res.json()).content[0].text, 'Hello from the fake API.');
    assert.equal((await lastUsage()).credits_charged, 1490);
  });

  test('forwards only safe fields, with our key, an opaque user id and a capped max_tokens', async () => {
    await send({ ...MESSAGE, max_tokens: 500000, speed: 'fast', container: 'x', metadata: { user_id: 'spoofed' }, stream: true }, {
      'anthropic-beta': 'server-side-fallback-2026-07-01, fast-mode-2026-02-01',
    }).then(readAll);
    const call = fake.calls.at(-1);
    assert.equal(call.headers['x-api-key'], 'test-anthropic-key');
    assert.equal(call.headers['anthropic-beta'], 'server-side-fallback-2026-07-01');
    assert.equal(call.url, '/v1/messages?beta=true');
    assert.equal(call.body.max_tokens, 32000);
    assert.equal(call.body.speed, undefined);
    assert.equal(call.body.container, undefined);
    assert.match(call.body.metadata.user_id, /^[0-9a-f]{32}$/);
    assert.notEqual(call.body.metadata.user_id, userId);
  });

  test('server-side tools are refused', async () => {
    const res = await send({ ...MESSAGE, tools: [{ type: 'web_search_20260209', name: 'web_search' }] });
    assert.equal(res.status, 400);
    assert.match((await res.json()).error.message, /isn't available/);
    assert.equal(fake.calls.length, 0);
  });

  test('models must be enabled and on the plan', async () => {
    const unknown = await send({ ...MESSAGE, model: 'gpt-5' });
    assert.equal(unknown.status, 400);
    const fable = await send({ ...MESSAGE, model: 'claude-fable-5-1' });
    assert.equal(fable.status, 403);
    assert.match((await fable.json()).error.message, /Pro plan/);
    assert.equal(fake.calls.length, 0);
  });

  test('out of credits answers 402 and does not call upstream', async () => {
    await t.pool.query('update credit_account set plan_credits = 0, bonus_credits = 500 where user_id = $1', [userId]);
    const res = await send();
    assert.equal(res.status, 402);
    assert.equal(res.headers.get('x-should-retry'), 'false');
    assert.equal((await res.json()).error.type, 'insufficient_credits');
    assert.equal(fake.calls.length, 0);
  });

  test('a request that costs more than is left runs the plan into debt, repaid next month', async () => {
    await t.pool.query('update credit_account set plan_credits = 1000, bonus_credits = 200 where user_id = $1', [userId]);
    await readAll(await send({ ...MESSAGE, stream: true }));
    const b = await balance();
    assert.equal(b.bonus_credits, 0);
    assert.equal(b.plan_credits, 1000 + 200 - 1490);
  });

  test('suspended accounts are refused', async () => {
    await t.pool.query('update "user" set banned = true where id = $1', [userId]);
    const res = await send();
    assert.equal(res.status, 403);
  });

  test('the per-minute rate limit applies', async () => {
    await t.settings.update({ rateLimitPerMinute: 2 }, null);
    assert.equal((await send()).status, 200);
    assert.equal((await send()).status, 200);
    const third = await send();
    assert.equal(third.status, 429);
    assert.equal(third.headers.get('retry-after'), '20');
  });

  test('maintenance mode stops AI without calling upstream', async () => {
    await t.settings.update({ maintenance: true }, null);
    const res = await send();
    assert.equal(res.status, 503);
    assert.equal(fake.calls.length, 0);
  });

  test('our key being rejected upstream is not reported as the user\'s fault', async () => {
    fake.reply = () => ({ status: 401, json: { type: 'error', error: { type: 'authentication_error', message: 'invalid x-api-key' } } });
    const res = await send();
    assert.equal(res.status, 503);
    assert.equal(res.headers.get('x-should-retry'), 'false');
    assert.doesNotMatch((await res.json()).error.message, /key/i);
    const usage = await lastUsage();
    assert.equal(usage.status, 'error');
    assert.equal(usage.credits_charged, 0);
  });

  test('a stopped stream is charged for what it used, not left pending', async () => {
    fake.reply = () => ({
      events: [
        { type: 'message_start', message: { id: 'm', type: 'message', role: 'assistant', model: 'claude-opus-5-5', content: [], usage: { input_tokens: 1000, output_tokens: 1 } } },
        { type: 'content_block_start', index: 0, content_block: { type: 'text', text: '' } },
        { type: 'content_block_delta', index: 0, delta: { type: 'text_delta', text: 'x'.repeat(400) } },
        'hang',
      ],
    });
    const res = await send({ ...MESSAGE, stream: true });
    const reader = res.body.getReader();
    let seen = '';
    while (!seen.includes('content_block_delta')) {
      const { done, value } = await reader.read();
      assert.ok(!done, `the stream ended early: ${seen}`);
      seen += new TextDecoder().decode(value);
    }
    await reader.cancel();
    await t.settleBackground();
    const usage = await lastUsage();
    assert.equal(usage.status, 'aborted');
    // 1000 in x $4 + an estimated 100 out (400 characters / 4) x $20 = 6000 micro-USD.
    assert.equal(usage.cost_micros, 6000);
    assert.equal(usage.credits_charged, 600);
  });

  test('refusal fallbacks are billed per attempt at each model\'s rates', async () => {
    fake.reply = () => ({
      events: [
        { type: 'message_start', message: { id: 'm', type: 'message', role: 'assistant', model: 'claude-opus-5-5', content: [], usage: { input_tokens: 1000, output_tokens: 1 } } },
        { type: 'content_block_start', index: 0, content_block: { type: 'fallback', from: { model: 'claude-opus-5-5' }, to: { model: 'claude-opus-5' } } },
        { type: 'content_block_stop', index: 0 },
        {
          type: 'message_delta', delta: { stop_reason: 'end_turn' }, usage: {
            output_tokens: 200,
            iterations: [
              { type: 'message', model: 'claude-opus-5-5', input_tokens: 1000, output_tokens: 50 },
              { type: 'fallback_message', model: 'claude-opus-5', input_tokens: 1000, output_tokens: 200 },
            ],
          },
        },
        { type: 'message_stop' },
      ],
    });
    await readAll(await send({ ...MESSAGE, stream: true }));
    const usage = await lastUsage();
    // Opus 5.5: 1000 x 4 + 50 x 20 = 5000; Opus 5: 1000 x 5 + 200 x 25 = 10000.
    assert.equal(usage.cost_micros, 15000);
    assert.equal(usage.served_model, 'claude-opus-5');
    assert.equal(usage.input_tokens, 2000);
  });

  test('the daily budget stops AI once reached', async () => {
    await t.settings.update({ dailyBudgetUsd: 0.000001 }, null);
    // The budget reads a cached total; the earlier tests already spent more than this.
    const res = await send();
    assert.equal(res.status, 503);
    assert.match((await res.json()).error.message, /capacity/);
  });

  test('without a session the gateway answers 401 in Anthropic\'s error shape', async () => {
    const res = await t.request('/ai/v1/messages', { method: 'POST', body: JSON.stringify(MESSAGE), headers: { 'content-type': 'application/json' } });
    assert.equal(res.status, 401);
    const body = await res.json();
    assert.equal(body.type, 'error');
    assert.equal(body.error.type, 'authentication_error');
  });
});
