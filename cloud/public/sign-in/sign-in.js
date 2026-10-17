// Sign-in page: Google, GitHub, email + password with a 6-digit email code,
// and password reset. Opened by the desktop app with ?desktop=1&port&state&
// challenge(&provider=google|github); after sign-in it hands over through
// /desktop/complete. Opened with ?next=/admin/ it returns there.

const $ = (sel) => document.querySelector(sel);
const params = new URLSearchParams(location.search);

const desktop = params.get('desktop') === '1'
  && /^\d{4,5}$/.test(params.get('port') || '')
  && /^[A-Za-z0-9_-]{16,128}$/.test(params.get('state') || '')
  && /^[A-Za-z0-9_-]{43}$/.test(params.get('challenge') || '');
const desktopTarget = desktop
  ? `/desktop/complete?${new URLSearchParams({ port: params.get('port'), state: params.get('state'), challenge: params.get('challenge') })}`
  : null;
// Only same-site paths: never an open redirect.
const next = /^\/(?!\/)[\w\-./?=&%]*$/.test(params.get('next') || '') ? params.get('next') : null;
const afterSignIn = desktopTarget || next;

let pendingEmail = '';

async function api(path, body) {
  const res = await fetch(`/api/auth${path}`, {
    method: body === undefined ? 'GET' : 'POST',
    headers: body === undefined ? {} : { 'content-type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
    credentials: 'same-origin',
  });
  let data = null;
  try {
    data = await res.json();
  } catch { /* empty body */ }
  return { ok: res.ok, status: res.status, data };
}

function show(step) {
  for (const el of document.querySelectorAll('.step')) el.hidden = el.dataset.step !== step;
  setError('');
  const first = document.querySelector(`.step[data-step="${step}"] input`);
  if (first && !first.value) requestAnimationFrame(() => first.focus());
}

function setError(message) {
  const el = $('#error');
  el.textContent = message || '';
  el.hidden = !message;
}

function busy(text) {
  $('#busyText').textContent = text;
  show('busy');
}

function friendly(result, fallback) {
  const code = result.data?.code || '';
  const message = result.data?.message || '';
  if (result.status === 429) return 'Too many tries. Wait a minute and try again.';
  if (code === 'INVALID_EMAIL_OR_PASSWORD') return 'That email and password don\'t match.';
  if (code.startsWith('USER_ALREADY_EXISTS')) return 'An account with this email already exists. Sign in instead.';
  if (code === 'PASSWORD_TOO_SHORT') return 'Use at least 8 characters for the password.';
  if (code === 'INVALID_OTP' || code === 'OTP_EXPIRED' || code === 'TOO_MANY_ATTEMPTS') {
    return code === 'OTP_EXPIRED' ? 'That code expired. Send a new one.' : code === 'TOO_MANY_ATTEMPTS' ? 'Too many wrong codes. Send a new one.' : 'That code isn\'t right.';
  }
  return message || fallback;
}

function finish(user) {
  if (afterSignIn) {
    busy(desktop ? 'Opening Impulse…' : 'Signing you in…');
    location.replace(afterSignIn);
    return;
  }
  $('#whoEmail').textContent = user?.email || '';
  $('#adminLink').hidden = user?.role !== 'admin';
  show('signed-in');
}

function formValues(form) {
  return Object.fromEntries(new FormData(form).entries());
}

async function startProvider(provider) {
  busy(`Opening ${provider === 'github' ? 'GitHub' : 'Google'}…`);
  const back = new URLSearchParams(params);
  back.set('error', 'oauth');
  back.delete('provider');
  const result = await api('/sign-in/social', {
    provider,
    callbackURL: afterSignIn || '/sign-in/',
    errorCallbackURL: `/sign-in/?${back}`,
  });
  if (result.ok && result.data?.url) {
    location.assign(result.data.url);
    return;
  }
  show('choose');
  setError(friendly(result, 'That sign-in method isn\'t available right now.'));
}

async function sendCode(email) {
  return api('/email-otp/send-verification-otp', { email, type: 'email-verification' });
}

function toVerify(email) {
  pendingEmail = email;
  $('#verifyEmail').textContent = email;
  $('#verifyForm').reset();
  show('verify');
}

function wire() {
  document.addEventListener('click', (e) => {
    const go = e.target.closest('[data-go]');
    if (go) {
      e.preventDefault();
      show(go.dataset.go);
    }
    const provider = e.target.closest('[data-provider]');
    if (provider) startProvider(provider.dataset.provider);
  });

  $('#signInForm').addEventListener('submit', async (e) => {
    e.preventDefault();
    const { email, password } = formValues(e.target);
    if (!email || !password) return setError('Enter your email and password.');
    const button = e.target.querySelector('button');
    button.disabled = true;
    const result = await api('/sign-in/email', { email: email.trim(), password });
    button.disabled = false;
    if (result.ok) return finish(result.data?.user);
    if (result.status === 403 && result.data?.code === 'EMAIL_NOT_VERIFIED') {
      await sendCode(email.trim());
      return toVerify(email.trim());
    }
    setError(friendly(result, 'Could not sign in. Try again.'));
  });

  $('#signUpForm').addEventListener('submit', async (e) => {
    e.preventDefault();
    const { name, email, password } = formValues(e.target);
    if (!name?.trim() || !email?.trim()) return setError('Enter your name and email.');
    if (!password || password.length < 8) return setError('Use at least 8 characters for the password.');
    const button = e.target.querySelector('button');
    button.disabled = true;
    const result = await api('/sign-up/email', { name: name.trim(), email: email.trim(), password });
    button.disabled = false;
    if (!result.ok) return setError(friendly(result, 'Could not create the account. Try again.'));
    toVerify(email.trim());
  });

  $('#verifyForm').addEventListener('submit', async (e) => {
    e.preventDefault();
    const otp = formValues(e.target).otp?.trim();
    if (!/^\d{6}$/.test(otp || '')) return setError('Enter the 6-digit code from the email.');
    const result = await api('/email-otp/verify-email', { email: pendingEmail, otp });
    if (result.ok) return finish(result.data?.user);
    setError(friendly(result, 'Could not verify the code.'));
  });
  $('#verifyForm input').addEventListener('input', (e) => {
    e.target.value = e.target.value.replace(/\D/g, '').slice(0, 6);
    if (e.target.value.length === 6) e.target.form.requestSubmit();
  });

  let resendTimer = null;
  $('#resend').addEventListener('click', async (e) => {
    e.preventDefault();
    if (resendTimer) return;
    const link = e.currentTarget;
    const result = await sendCode(pendingEmail);
    if (!result.ok) return setError(friendly(result, 'Could not send a new code.'));
    setError('');
    let left = 30;
    link.setAttribute('aria-disabled', 'true');
    link.textContent = `New code sent · ${left}s`;
    resendTimer = setInterval(() => {
      left -= 1;
      link.textContent = left > 0 ? `New code sent · ${left}s` : 'Send a new code';
      if (left <= 0) {
        clearInterval(resendTimer);
        resendTimer = null;
        link.removeAttribute('aria-disabled');
      }
    }, 1000);
  });

  $('#forgotForm').addEventListener('submit', async (e) => {
    e.preventDefault();
    const email = formValues(e.target).email?.trim();
    if (!email) return setError('Enter your email.');
    const result = await api('/email-otp/request-password-reset', { email });
    if (!result.ok) return setError(friendly(result, 'Could not send the code.'));
    pendingEmail = email;
    $('#resetEmail').textContent = email;
    show('reset');
  });

  $('#resetForm').addEventListener('submit', async (e) => {
    e.preventDefault();
    const { otp, password } = formValues(e.target);
    if (!/^\d{6}$/.test(otp?.trim() || '')) return setError('Enter the 6-digit code from the email.');
    if (!password || password.length < 8) return setError('Use at least 8 characters for the password.');
    const result = await api('/email-otp/reset-password', { email: pendingEmail, otp: otp.trim(), password });
    if (!result.ok) return setError(friendly(result, 'Could not reset the password.'));
    const signIn = await api('/sign-in/email', { email: pendingEmail, password });
    if (signIn.ok) return finish(signIn.data?.user);
    show('choose');
  });

  $('#signOut').addEventListener('click', async () => {
    await api('/sign-out', {});
    show('choose');
  });
}

async function init() {
  wire();
  let config = { auth: { google: false, github: false, email: false } };
  try {
    config = await (await fetch('/v1/config')).json();
  } catch { /* offline: show what we can */ }
  const { google, github, email } = config.auth;
  document.querySelector('[data-provider="google"]').hidden = !google;
  document.querySelector('[data-provider="github"]').hidden = !github;
  $('#orRule').hidden = !(email && (google || github));
  $('#signInForm').hidden = !email;
  for (const link of document.querySelectorAll('[data-go="signup"], [data-go="forgot"]')) link.hidden = !email;
  if (config.welcomeCredits) {
    $('#signupSub').textContent = `${config.welcomeCredits} free credits to start, then ${config.freeMonthlyCredits} every month. No card needed.`;
  }
  $('#getApp').href = config.website || '/';
  $('#desktopNote').hidden = !desktop;

  if (params.get('error')) {
    show('choose');
    setError(params.get('error') === 'not_signed_in'
      ? 'Sign in to finish connecting Impulse.'
      : 'That sign-in didn\'t finish. If you already have an Impulse account with this email, sign in with your password first.');
    return;
  }

  const provider = params.get('provider');
  if (desktop && (provider === 'google' || provider === 'github') && config.auth[provider]) {
    startProvider(provider);
    return;
  }

  if (!google && !github && !email) {
    show('choose');
    setError('Sign-in isn\'t set up on this server yet.');
    return;
  }
  // Already signed in on the web: say so (the desktop flow always signs in afresh).
  const session = desktop ? null : await api('/get-session');
  if (session?.ok && session.data?.user) {
    finish(session.data.user);
    return;
  }
  show('choose');
}

init();
