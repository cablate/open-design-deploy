#!/usr/bin/env node
/**
 * Auth Service — session-based login for nginx auth_request
 *
 * Zero dependencies. Uses Node.js built-in http + crypto modules.
 *
 * Endpoints:
 *   GET  /login    — Custom login page
 *   POST /login   — Authenticate, set session cookie
 *   GET  /check   — nginx auth_request: validate session → 200 or 401
 *   GET  /logout  — Clear session
 */
const http = require('http');
const crypto = require('crypto');

// ── Configuration ──────────────────────────────────────────────────────────
const PORT       = parseInt(process.env.OD_AUTH_PORT || '7458', 10);
const USERNAME   = process.env.OD_AUTH_USERNAME    || 'admin';
const PASSWORD   = process.env.OD_AUTH_PASSWORD    || crypto.randomBytes(8).toString('hex');
const SESSION_TTL = parseInt(process.env.OD_AUTH_SESSION_TTL || '86400', 10); // 24 h

// Secrets regenerated on every container start → all sessions invalidated
const HMAC_SECRET = crypto.randomBytes(32).toString('hex');

// ── Session store ──────────────────────────────────────────────────────────
const sessions = new Map();

setInterval(() => {
  const now = Date.now();
  for (const [id, s] of sessions) {
    if (s.expiresAt <= now) sessions.delete(id);
  }
}, 60_000);

// ── Cookie helpers (HMAC-signed) ───────────────────────────────────────────
function sign(value) {
  const h = crypto.createHmac('sha256', HMAC_SECRET).update(value).digest('hex');
  return `${value}.${h}`;
}

function verify(raw) {
  const i = raw.lastIndexOf('.');
  if (i < 1) return null;
  const val = raw.slice(0, i);
  const sig = raw.slice(i + 1);
  const expect = crypto.createHmac('sha256', HMAC_SECRET).update(val).digest('hex');
  if (sig.length !== expect.length) return null;
  return crypto.timingSafeEqual(Buffer.from(sig), Buffer.from(expect))
    ? val : null;
}

function readCookies(header) {
  const map = {};
  if (!header) return map;
  for (const pair of header.split(';')) {
    const m = pair.trim().match(/^([^=]+)=(.*)$/);
    if (m) map[m[1]] = m[2];
  }
  return map;
}

// ── Login page (self-contained HTML, dark theme) ───────────────────────────
const HTML_LOGIN = `<!DOCTYPE html>
<html lang="zh-TW">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>登入 — Open Design</title>
<style>
  *, *::before, *::after { margin:0; padding:0; box-sizing:border-box; }
  html, body { height:100%; }
  body {
    font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "Noto Sans TC", sans-serif;
    background: linear-gradient(135deg, #0f172a 0%, #1e293b 100%);
    color: #e2e8f0;
    display: flex; align-items: center; justify-content: center;
  }
  .card {
    background: #1e293b;
    padding: 2.5rem 2rem;
    border-radius: 16px;
    box-shadow: 0 8px 32px rgba(0,0,0,.4);
    width: 100%; max-width: 400px;
    border: 1px solid #334155;
  }
  .card h1 { font-size: 1.5rem; text-align:center; margin-bottom:.25rem; }
  .card .sub { color:#94a3b8; text-align:center; font-size:.85rem; margin-bottom:1.75rem; }
  .msg {
    display:none; padding:.7rem; border-radius:8px; font-size:.85rem; margin-bottom:1rem;
  }
  .msg.error { display:block; background:#7f1d1d; color:#fca5a5; border:1px solid #991b1b; }
  .msg.logout { display:block; background:#14532d; color:#86efac; border:1px solid #166534; }
  label { display:block; font-size:.8rem; color:#94a3b8; margin-bottom:.3rem; font-weight:500; }
  input[type="text"], input[type="password"] {
    width:100%; padding:.7rem .85rem;
    border:1px solid #334155; border-radius:8px;
    background:#0f172a; color:#e2e8f0; font-size:1rem;
    transition:border-color .15s;
  }
  input:focus { outline:none; border-color:#3b82f6; box-shadow:0 0 0 3px rgba(59,130,246,.15); }
  .field { margin-bottom:1rem; }
  button {
    width:100%; padding:.75rem;
    background:#3b82f6; color:#fff;
    border:none; border-radius:8px;
    font-size:1rem; font-weight:600; cursor:pointer;
    transition:background .15s; margin-top:.5rem;
  }
  button:hover { background:#2563eb; }
  button:active { background:#1d4ed8; }
  .footer { text-align:center; margin-top:1.25rem; font-size:.75rem; color:#64748b; }
</style>
</head>
<body>
<div class="card">
  <h1>Open Design</h1>
  <p class="sub">請登入以繼續</p>
  <div class="msg error" id="msgError">帳號或密碼錯誤</div>
  <div class="msg logout" id="msgLogout">您已成功登出</div>
  <form method="POST" action="/login">
    <div class="field">
      <label for="username">帳號</label>
      <input type="text" id="username" name="username" autocomplete="username" required autofocus>
    </div>
    <div class="field">
      <label for="password">密碼</label>
      <input type="password" id="password" name="password" autocomplete="current-password" required>
    </div>
    <button type="submit">登入</button>
  </form>
  <p class="footer">受保護的服務區域</p>
</div>
<script>
  (function(){
    var s = new URLSearchParams(location.search);
    if (s.get('error')==='1') document.getElementById('msgError').style.display='block';
    if (s.get('logout')==='1') document.getElementById('msgLogout').style.display='block';
  })();
</script>
</body>
</html>`;

// ── HTTP server ────────────────────────────────────────────────────────────
const app = http.createServer((req, res) => {
  const method = req.method;
  const path   = req.url;

  const cookies = readCookies(req.headers.cookie);

  // ── resolve session ────────────────────────────────────────────────────
  let session = null;
  if (cookies.sid) {
    const sid = verify(cookies.sid);
    if (sid) {
      const s = sessions.get(sid);
      if (s && s.expiresAt > Date.now()) session = s;
      else if (s) sessions.delete(sid);
    }
  }

  const json = (code, data) => {
    res.writeHead(code, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify(data));
  };
  const html = (code, body) => {
    res.writeHead(code, { 'Content-Type': 'text/html; charset=utf-8' });
    res.end(body);
  };
  const redirect = (loc, cookie) => {
    const headers = { 'Location': loc };
    if (cookie) headers['Set-Cookie'] = cookie;
    res.writeHead(302, headers);
    res.end();
  };
  const setSessionCookie = (sid) =>
    `sid=${sign(sid)}; HttpOnly; Secure; SameSite=Strict; Path=/; Max-Age=${SESSION_TTL}`;

  // ROUTE: /check — nginx auth_request internal endpoint
  if (path === '/check') {
    res.writeHead(session ? 200 : 401, { 'Content-Type': 'text/plain' });
    res.end(session ? 'ok' : 'unauthorized');
    return;
  }

  // ROUTE: /login — GET show page, POST authenticate
  if (path === '/login') {
    if (method === 'GET') {
      if (session) { redirect('/'); return; }
      html(200, HTML_LOGIN);
      return;
    }

    if (method === 'POST') {
      let body = '';
      req.on('data', c => body += c);
      req.on('end', () => {
        const params = new URLSearchParams(body);
        const u = params.get('username');
        const p = params.get('password');
        if (u === USERNAME && p === PASSWORD) {
          const sid = crypto.randomBytes(32).toString('hex');
          sessions.set(sid, { expiresAt: Date.now() + SESSION_TTL * 1000 });
          redirect('/', setSessionCookie(sid));
        } else {
          redirect('/login?error=1');
        }
      });
      return;
    }
  }

  // ROUTE: /logout
  if (path === '/logout') {
    if (cookies.sid) {
      const sid = verify(cookies.sid);
      if (sid) sessions.delete(sid);
    }
    redirect('/login?logout=1', 'sid=; HttpOnly; Secure; SameSite=Strict; Path=/; Max-Age=0');
    return;
  }

  // 404
  json(404, { error: 'not_found' });
});

// ── Start ──────────────────────────────────────────────────────────────────
app.listen(PORT, '127.0.0.1', () => {
  console.log('');
  console.log('========================================');
  console.log('  Auth Service');
  console.log('  URL:  http://127.0.0.1:' + PORT);
  console.log('  User: ' + USERNAME);
  console.log('  Pass: ' + PASSWORD);
  console.log('========================================');
  console.log('');
});
