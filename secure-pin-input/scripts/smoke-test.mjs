/**
 * 端到端冒烟测试（Node 内置 test runner + Web Crypto，无需浏览器）
 *
 * 覆盖：
 *   1. 正常加密登录流程，服务端能还原出口令并正确校验
 *   2. 相同口令两次提交密文不同（一次性密钥 + 随机 IV）
 *   3. 重放同一载荷被服务端拒绝（409）
 *   4. 篡改密文导致 GCM 认证失败
 *   5. 过期/伪造 sessionId 被拒绝
 */
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { once } from 'node:events';

const PORT = 3199;
const BASE = `http://localhost:${PORT}`;
const HKDF_INFO = new TextEncoder().encode('secure-pin-input/v1');
const PIN = '836219';

let serverProc;

before(async () => {
  serverProc = spawn(process.execPath, ['server/session-server.mjs'], {
    env: { ...process.env, PORT: String(PORT), DEMO_PASSWORD: PIN },
    stdio: ['ignore', 'pipe', 'inherit'],
  });
  await once(serverProc.stdout, 'data'); // 等待监听输出
});

after(() => serverProc.kill());

async function getSession() {
  const res = await fetch(`${BASE}/api/session`);
  assert.equal(res.status, 200);
  return res.json();
}

async function buildPayload(plaintext, session) {
  const ephemeral = await crypto.subtle.generateKey(
    { name: 'ECDH', namedCurve: 'P-256' },
    false,
    ['deriveBits'],
  );
  const serverKey = await crypto.subtle.importKey(
    'jwk',
    session.publicKeyJwk,
    { name: 'ECDH', namedCurve: 'P-256' },
    false,
    [],
  );
  const shared = new Uint8Array(
    await crypto.subtle.deriveBits({ name: 'ECDH', public: serverKey }, ephemeral.privateKey, 256),
  );
  const aesKey = await crypto.subtle.deriveKey(
    { name: 'HKDF', hash: 'SHA-256', salt: shared.slice(0, 16), info: HKDF_INFO },
    await crypto.subtle.importKey('raw', shared, 'HKDF', false, ['deriveKey']),
    { name: 'AES-GCM', length: 256 },
    false,
    ['encrypt'],
  );
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const ciphertext = new Uint8Array(
    await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, aesKey, new TextEncoder().encode(plaintext)),
  );
  const pubJwk = await crypto.subtle.exportKey('jwk', ephemeral.publicKey);
  return {
    sessionId: session.sessionId,
    clientEphemeral: { kty: 'EC', crv: 'P-256', x: pubJwk.x, y: pubJwk.y },
    iv: Buffer.from(iv).toString('base64'),
    ciphertext: Buffer.from(ciphertext).toString('base64'),
    risk: { level: 'safe', score: 0, events: [], failedChecks: [] },
  };
}

test('正常流程：服务端用会话密钥还原口令并校验通过', async () => {
  const session = await getSession();
  const payload = await buildPayload(PIN, session);
  const res = await fetch(`${BASE}/api/login`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(payload),
  });
  const data = await res.json();
  assert.equal(res.status, 200);
  assert.equal(data.ok, true);
  assert.equal(data.matched, true);
  assert.equal(data.receivedLength, PIN.length);
  assert.equal(data.masked, '•'.repeat(PIN.length));
  // 响应中绝不回显明文
  assert.ok(!JSON.stringify(data).includes(PIN));
});

test('错误口令能被还原但校验不通过', async () => {
  const session = await getSession();
  const payload = await buildPayload('000000', session);
  const res = await fetch(`${BASE}/api/login`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(payload),
  });
  const data = await res.json();
  assert.equal(data.matched, false);
});

test('一次性加密：相同口令两次提交的 IV 与密文完全不同', async () => {
  const s1 = await getSession();
  const s2 = await getSession();
  const p1 = await buildPayload(PIN, s1);
  const p2 = await buildPayload(PIN, s2);
  assert.notEqual(p1.iv, p2.iv);
  assert.notEqual(p1.ciphertext, p2.ciphertext);
  assert.notEqual(p1.clientEphemeral.x, p2.clientEphemeral.x);
});

test('防重放：同一载荷提交第二次返回 409', async () => {
  const session = await getSession();
  const payload = await buildPayload(PIN, session);
  const first = await fetch(`${BASE}/api/login`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(payload),
  });
  assert.equal(first.status, 200);
  const second = await fetch(`${BASE}/api/login`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(payload),
  });
  assert.equal(second.status, 409);
  const data = await second.json();
  assert.match(data.error, /重放|已使用/);
});

test('GCM 认证：篡改密文后解密失败', async () => {
  const session = await getSession();
  const payload = await buildPayload(PIN, session);
  const raw = Buffer.from(payload.ciphertext, 'base64');
  raw[10] ^= 0xff; // 翻转一个密文字节
  payload.ciphertext = raw.toString('base64');
  const res = await fetch(`${BASE}/api/login`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(payload),
  });
  assert.equal(res.status, 400);
});

test('伪造 / 过期 sessionId 被拒绝', async () => {
  const session = await getSession();
  const payload = await buildPayload(PIN, session);
  payload.sessionId = 'deadbeef'.repeat(4);
  const res = await fetch(`${BASE}/api/login`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(payload),
  });
  assert.equal(res.status, 404);
});
