import { after, before, describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { setup } from './helpers.js';
import { DEFAULTS as HOURLY_DEFAULTS } from '../src/settings.js';
import { MC, addMonths, charge, getAccount, setPlan, periodEnd, describe as describeAccount } from '../src/credits.js';
import { costMicros, relativeCost, toMillicredits } from '../src/pricing.js';

describe('pricing', () => {
  test('cache reads, 5-minute and 1-hour writes are priced from the input rate', () => {
    // Sonnet 5.5: $2 in, $10 out, $0.20 cached.
    const usage = {
      input_tokens: 1000, output_tokens: 100, cache_read_input_tokens: 10_000, cache_creation_input_tokens: 3000,
      cache_creation: { ephemeral_5m_input_tokens: 2000, ephemeral_1h_input_tokens: 1000 },
    };
    // 1000x2 + 10000x0.2 + 2000x2.5 + 1000x4 + 100x10
    assert.equal(costMicros('claude-sonnet-5-5', null, usage), 2000 + 2000 + 5000 + 4000 + 1000);
  });

  test('Haiku 5.5 prompts over 100K tokens use the higher rate card', () => {
    assert.equal(costMicros('claude-haiku-5-5', null, { input_tokens: 100_000, output_tokens: 0 }), 10_000);
    assert.equal(costMicros('claude-haiku-5-5', null, { input_tokens: 100_001, output_tokens: 0 }), Math.ceil(100_001 * 0.5));
  });

  test('credits round up so no call is free, and follow the exchange rate and markup', () => {
    assert.equal(toMillicredits(1, { creditsPerUsd: 100, markup: 1 }), 1);
    assert.equal(toMillicredits(10_000, { creditsPerUsd: 100, markup: 1 }), 1000);
    assert.equal(toMillicredits(10_000, { creditsPerUsd: 100, markup: 1.5 }), 1500);
    assert.equal(toMillicredits(0, { creditsPerUsd: 100, markup: 1 }), 0);
  });

  test('menu cost is relative to the default model', () => {
    assert.equal(relativeCost('claude-opus-5-5', 'claude-opus-5-5'), 1);
    assert.ok(relativeCost('claude-sonnet-5-5', 'claude-opus-5-5') < 1);
    assert.ok(relativeCost('claude-fable-5-1', 'claude-opus-5-5') > 2);
  });

  test('month arithmetic clamps to the end of short months', () => {
    assert.equal(addMonths(new Date('2026-01-31T10:00:00Z'), 1).toISOString(), '2026-02-28T10:00:00.000Z');
    assert.equal(addMonths(new Date('2026-03-15T00:00:00Z'), 1).toISOString(), '2026-04-15T00:00:00.000Z');
  });
});

describe('credit accounts', () => {
  let t;
  let userId;
  before(async () => {
    t = await setup();
    // Inserted directly (not through sign-up) so the test decides when the account opens.
    userId = 'ledger-user';
    await t.pool.query(
      `insert into "user" (id, name, email, "emailVerified", "createdAt", "updatedAt") values ($1, 'Ledger', 'ledger@impulse.test', true, now(), now())`,
      [userId],
    );
  });
  after(async () => { await t.close(); });

  const start = new Date('2026-01-31T12:00:00Z');
  // These tests are about month arithmetic: a Free plan that refills monthly.
  const DEFAULTS = { ...HOURLY_DEFAULTS, plans: { ...HOURLY_DEFAULTS.plans, free: { ...HOURLY_DEFAULTS.plans.free, monthlyCredits: 100, periodHours: null } } };

  test('a new account gets the Free allowance and the welcome bonus', async () => {
    const acct = await getAccount(t.pool, userId, DEFAULTS, start);
    assert.equal(acct.plan_credits, 100 * MC);
    assert.equal(acct.bonus_credits, 200 * MC);
    assert.equal(new Date(acct.period_end).toISOString(), '2026-02-28T12:00:00.000Z');
  });

  test('spending takes plan credits first, then bonus, then runs a small debt', async () => {
    await charge(t.pool, userId, 99_000);
    let acct = await getAccount(t.pool, userId, DEFAULTS, start);
    assert.equal(acct.plan_credits, 1000);
    assert.equal(acct.bonus_credits, 200 * MC);
    await charge(t.pool, userId, 201_500);
    acct = await getAccount(t.pool, userId, DEFAULTS, start);
    assert.equal(acct.bonus_credits, 0);
    assert.equal(acct.plan_credits, -500);
  });

  test('the monthly refill resets plan credits and repays the debt', async () => {
    const later = new Date('2026-04-02T00:00:00Z');
    const acct = await getAccount(t.pool, userId, DEFAULTS, later);
    assert.equal(acct.plan_credits, 100 * MC - 500);
    // Two months passed; the period keeps the original anchor day.
    assert.equal(new Date(acct.period_start).toISOString(), '2026-03-28T12:00:00.000Z');
    assert.equal(new Date(acct.period_end).toISOString(), '2026-04-28T12:00:00.000Z');
  });

  test('changing plan starts a new period with the full new allowance', async () => {
    const now = new Date('2026-04-10T00:00:00Z');
    const acct = await setPlan(t.pool, userId, 'pro', DEFAULTS, { now });
    assert.equal(acct.plan, 'pro');
    // The refill already repaid the debt, so the full allowance applies.
    assert.equal(acct.plan_credits, 1500 * MC);
    assert.equal(new Date(acct.period_end).toISOString(), '2026-05-10T00:00:00.000Z');
  });

  test('every change is in the ledger with the balances after it', async () => {
    const { rows } = await t.pool.query('select kind, delta, plan_after, bonus_after from credit_ledger where user_id = $1 order by id', [userId]);
    assert.deepEqual(rows.map((r) => r.kind), ['monthly_grant', 'signup_bonus', 'usage', 'usage', 'monthly_grant', 'plan_change']);
    const last = rows.at(-1);
    assert.equal(last.plan_after, 1500 * MC);
    assert.equal(rows.reduce((sum, r) => sum + r.delta, 0), last.plan_after + last.bonus_after, 'deltas add up to the balance');
  });
});

describe('hourly refills (the Free plan)', () => {
  let t;
  const userId = 'hourly-user';
  before(async () => {
    t = await setup();
    await t.pool.query(
      `insert into "user" (id, name, email, "emailVerified", "createdAt", "updatedAt") values ($1, 'Hourly', 'hourly@impulse.test', true, now(), now())`,
      [userId],
    );
  });
  after(async () => { await t.close(); });

  const start = new Date('2026-06-01T09:00:00Z');

  test('the default Free plan refills a small allowance every few hours', async () => {
    assert.equal(HOURLY_DEFAULTS.plans.free.periodHours, 5);
    const acct = await getAccount(t.pool, userId, HOURLY_DEFAULTS, start);
    assert.equal(acct.plan_credits, 25 * MC);
    assert.equal(acct.bonus_credits, 200 * MC);
    assert.equal(new Date(acct.period_end).toISOString(), '2026-06-01T14:00:00.000Z');
    assert.equal(periodEnd(start, HOURLY_DEFAULTS.plans.free).toISOString(), '2026-06-01T14:00:00.000Z');
    assert.equal(periodEnd(start, HOURLY_DEFAULTS.plans.pro).toISOString(), '2026-07-01T09:00:00.000Z');
  });

  test('nothing refills before the period ends; afterwards the clock restarts from the next request', async () => {
    await charge(t.pool, userId, 25 * MC);
    let acct = await getAccount(t.pool, userId, HOURLY_DEFAULTS, new Date('2026-06-01T13:59:00Z'));
    assert.equal(acct.plan_credits, 0);
    const later = new Date('2026-06-01T16:30:00Z');
    acct = await getAccount(t.pool, userId, HOURLY_DEFAULTS, later);
    assert.equal(acct.plan_credits, 25 * MC);
    assert.equal(new Date(acct.period_start).toISOString(), later.toISOString());
    assert.equal(new Date(acct.period_end).toISOString(), '2026-06-01T21:30:00.000Z');
    const d = describeAccount(acct, HOURLY_DEFAULTS);
    assert.equal(d.periodHours, 5);
    assert.equal(d.refillCredits, 25);
    assert.equal(d.monthly, 25);
    const { rows } = await t.pool.query('select note from credit_ledger where user_id = $1 order by id desc limit 1', [userId]);
    assert.equal(rows[0].note, 'Free plan, new period');
  });

  test('moving to a monthly plan starts a month-long period', async () => {
    const now = new Date('2026-06-02T00:00:00Z');
    const acct = await setPlan(t.pool, userId, 'pro', HOURLY_DEFAULTS, { now });
    assert.equal(new Date(acct.period_end).toISOString(), '2026-07-02T00:00:00.000Z');
    assert.equal(describeAccount(acct, HOURLY_DEFAULTS).periodHours, null);
  });
});
