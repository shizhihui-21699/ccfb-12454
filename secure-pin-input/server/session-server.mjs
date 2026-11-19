/**
 * 会话密钥服务（演示用，仅依赖 Node 内置模块）
 *
 * 协议（与前端 src/lib/secure-session.mjs 对应）：
 *   1. GET  /api/session
 *        -> { sessionId, publicKeyJwk }            服务端临时 ECDH P-256 公钥（导出为裸椭圆曲线点）
 *   2. POST /api/login
 *        body: {
 *          sessionId,
 *          clientEphemeral:  客户端一次性 ECDH 公钥(JWK, 裸点)
 *          iv:               base64，每次 12 字节随机 IV
 *          ciphertext:       base64，AES-256-GCM 密文(含 tag)
 *          risk:             注入检测报告
 *        }
 *
 * 密钥推导：ECDH 共享密钥 -> HKDF-SHA256(salt=nonce, info="secure-pin-input/v1") -> 256 bit AES key
 * 一次性保证：每个 clientEphemeral 只接受一次（重放/同密钥二次提交直接拒绝）
 */
import http from 'node:http';
import crypto from 'node:crypto';

const PORT = Number(process.env.PORT || 3001);
const DEMO_PASSWORD = process.env.DEMO_PASSWORD || '836219';
const SESSION_TTL_MS = 5 * 60 * 1000;
const MAX_BODY = 128 * 1024;

const HKDF_INFO = Buffer.from('secure-pin-input/v1');
const EC_JWK = { kty: 'EC', crv: 'P-256' };

/** sessionId -> { publicKey, privateKey(non-extractable KeyObject), createdAt } */
const sessions = new Map();
/** 已消费过的客户端临时公钥指纹，防重放 */
const usedEphemerals = new Set();

function b64urlToBuf(s) {
  return Buffer.from(s.replace(/-/g, '+').replace(/_/g, '/'), 'base64');
}
function bufToB64(buf) {
  return Buffer.from(buf).toString('base64');
}
function fingerprintEphemeral(jwk) {
  return crypto.createHash('sha256').update(jwk.x + '.' + jwk.y).digest('hex');
}
function json(res, code, obj) {
  const body = JSON.stringify(obj);
  res.writeHead(code, {
    'content-type': 'application/json; charset=utf-8',
    'cache-control': 'no-store',
  });
  res.end(body);
}

// ---- 会话管理 -------------------------------------------------------------

function createSession() {
  const sessionId = crypto.randomBytes(16).toString('hex');
  const { publicKey, privateKey } = crypto.generateKeyPairSync('ec', { namedCurve: 'prime256v1' });
  sessions.set(sessionId, { publicKey, privateKey, createdAt: Date.now() });
  const jwk = publicKey.export({ format: 'jwk' });
  return {
    sessionId,
    publicKeyJwk: { ...EC_JWK, x: jwk.x, y: jwk.y },
  };
}

function reapSessions() {
  const now = Date.now();
  for (const [id, s] of sessions) {
    if (now - s.createdAt > SESSION_TTL_MS) sessions.delete(id);
  }
}

// ---- 解密 -----------------------------------------------------------------

async function decryptPayload(session, body) {
  const ephemeralJwk = body.clientEphemeral;
  if (!ephemeralJwk || ephemeralJwk.kty !== 'EC' || ephemeralJwk.crv !== 'P-256' ||
      !ephemeralJwk.x || !ephemeralJwk.y) {
    throw Object.assign(new Error('客户端临时公钥格式错误'), { httpCode: 400 });
  }

  // 重放检查由调用方（HTTP handler）在会话查找之前完成
  const clientKey = crypto.createPublicKey({ key: ephemeralJwk, format: 'jwk' });
  const shared = crypto.diffieHellman({
    privateKey: session.privateKey,
    publicKey: clientKey,
  });

  // 与前端一致：salt 取共享密钥自身的前 16 字节（nonce 作用），保证双方推导一致
  const salt = shared.subarray(0, 16);
  const aesKey = crypto.hkdfSync('sha256', shared, salt, HKDF_INFO, 32);
  const iv = b64urlToBuf(String(body.iv || ''));
  const cipherBuf = b64urlToBuf(String(body.ciphertext || ''));
  if (iv.length !== 12 || cipherBuf.length < 16) {
    throw Object.assign(new Error('IV 或密文长度非法'), { httpCode: 400 });
  }

  const tag = cipherBuf.subarray(cipherBuf.length - 16);
  const data = cipherBuf.subarray(0, cipherBuf.length - 16);
  const decipher = crypto.createDecipheriv('aes-256-gcm', Buffer.from(aesKey), iv, { authTagLength: 16 });
  decipher.setAuthTag(tag);
  const plain = Buffer.concat([decipher.update(data), decipher.final()]); // tag 不通过会抛错

  return plain.toString('utf8');
}

// ---- HTTP 服务 ------------------------------------------------------------

const server = http.createServer(async (req, res) => {
  try {
    const url = new URL(req.url, `http://${req.headers.host}`);

    if (req.method === 'GET' && url.pathname === '/api/session') {
      reapSessions();
      return json(res, 200, createSession());
    }

    if (req.method === 'POST' && url.pathname === '/api/login') {
      const chunks = [];
      let size = 0;
      for await (const chunk of req) {
        size += chunk.length;
        if (size > MAX_BODY) return json(res, 413, { ok: false, error: '请求体过大' });
        chunks.push(chunk);
      }
      let body;
      try {
        body = JSON.parse(Buffer.concat(chunks).toString('utf8') || '{}');
      } catch {
        return json(res, 400, { ok: false, error: 'JSON 解析失败' });
      }

      // 重放检查优先于会话查找：即使原会话已即焚，重放包仍应被识别并拒绝
      const ephemeralJwk = body.clientEphemeral;
      if (ephemeralJwk?.kty === 'EC' && ephemeralJwk.crv === 'P-256' &&
          ephemeralJwk.x && ephemeralJwk.y) {
        const fp = fingerprintEphemeral(ephemeralJwk);
        if (usedEphemerals.has(fp)) {
          return json(res, 409, { ok: false, error: '该临时密钥已使用过，拒绝重放' });
        }
      }

      const session = sessions.get(body.sessionId);
      if (!session) return json(res, 404, { ok: false, error: '会话不存在或已过期，请刷新页面' });

      let password;
      try {
        password = await decryptPayload(session, body);
      } catch (err) {
        return json(res, err.httpCode || 400, { ok: false, error: err.message });
      }
      // 解密成功才登记该临时公钥（认证失败的包不占用去重集合）
      usedEphemerals.add(fingerprintEphemeral(body.clientEphemeral));
      sessions.delete(body.sessionId); // 会话一次性，登录后即焚

      const matched = password === DEMO_PASSWORD;
      return json(res, 200, {
        ok: true,
        matched,
        // 演示环境只回显掩码，绝不回显明文
        receivedLength: password.length,
        masked: '•'.repeat(password.length),
        hint: matched ? '口令校验通过' : '口令错误（演示口令见 README，默认 836219）',
        serverReceivedRisk: body.risk || null,
        serverNote: '服务端仅在内存中短暂持有明文用于比对，比对结束即释放，不写日志',
      });
    }

    json(res, 404, { ok: false, error: 'not found' });
  } catch (err) {
    json(res, 500, { ok: false, error: '服务器内部错误: ' + err.message });
  }
});

server.listen(PORT, () => {
  console.log(`[session-server] 监听 http://localhost:${PORT}（演示口令: ${DEMO_PASSWORD}）`);
});
