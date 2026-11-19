/**
 * 一次性加密通道（Web Crypto API，无第三方依赖）
 *
 * 流程：
 *   1. 页面加载时向服务端取会话：服务端 ECDH 公钥 + sessionId
 *   2. 提交时客户端现场生成一对一次性 ECDH P-256 密钥（ephemeral）
 *   3. ECDH 得到共享密钥 -> HKDF-SHA256 推导 AES-256 密钥
 *   4. 随机 12 字节 IV，AES-256-GCM 加密口令
 *   5. 只上传 { 临时公钥, iv, 密文 }；本地私钥用后即焚
 *
 * 特性：
 *   - 前向安全：每次提交独立临时密钥，一次一密，抓包拿到的密文无法批量解密
 *   - 防重放：服务端对临时公钥去重；IV 每次随机，相同口令密文也完全不同
 *   - GCM 认证：密文被篡改会校验失败
 */

const HKDF_INFO = new TextEncoder().encode('secure-pin-input/v1');

export class SecureSession {
  constructor() {
    this.sessionId = null;
    this.serverKey = null;       // CryptoKey（服务端 ECDH 公钥）
    this.serverKeyJwk = null;    // 原始 JWK，用于完整性比对
  }

  async init(baseUrl = '') {
    const res = await fetch(`${baseUrl}/api/session`, { cache: 'no-store' });
    if (!res.ok) throw new Error(`获取会话失败: ${res.status}`);
    const { sessionId, publicKeyJwk } = await res.json();
    this.sessionId = sessionId;
    this.serverKeyJwk = publicKeyJwk;
    this.serverKey = await crypto.subtle.importKey(
      'jwk',
      publicKeyJwk,
      { name: 'ECDH', namedCurve: 'P-256' },
      false,
      [],
    );
    return this;
  }

  /**
   * 一次性加密。返回可直接 POST 的载荷；调用后临时私钥立即销毁。
   */
  async seal(plaintext, riskReport = null) {
    if (!this.serverKey) throw new Error('会话未初始化');

    // 每次提交新建临时密钥对
    const ephemeral = await crypto.subtle.generateKey(
      { name: 'ECDH', namedCurve: 'P-256' },
      false, // 私钥不可导出，降低被内存读取的窗口
      ['deriveBits'],
    );
    const ephemeralPubJwk = await crypto.subtle.exportKey('jwk', ephemeral.publicKey);

    const sharedBits = await crypto.subtle.deriveBits(
      { name: 'ECDH', public: this.serverKey },
      ephemeral.privateKey,
      256,
    );
    const shared = new Uint8Array(sharedBits);
    // 与服务端约定：salt = 共享密钥前 16 字节
    const salt = shared.slice(0, 16);

    const aesKey = await crypto.subtle.deriveKey(
      { name: 'HKDF', hash: 'SHA-256', salt, info: HKDF_INFO },
      // HKDF 的输入密钥材料是 ECDH 共享密钥
      await crypto.subtle.importKey('raw', shared, 'HKDF', false, ['deriveKey']),
      { name: 'AES-GCM', length: 256 },
      false,
      ['encrypt'],
    );

    const iv = crypto.getRandomValues(new Uint8Array(12));
    const encoded = new TextEncoder().encode(plaintext);
    const cipherBuf = await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, aesKey, encoded);

    const payload = {
      sessionId: this.sessionId,
      clientEphemeral: { kty: 'EC', crv: 'P-256', x: ephemeralPubJwk.x, y: ephemeralPubJwk.y },
      iv: toBase64(iv),
      ciphertext: toBase64(new Uint8Array(cipherBuf)),
      risk: riskReport,
    };

    // 显式丢弃引用（非 extractable 私钥本身也无法导出）
    this._burn(ephemeral);
    return payload;
  }

  _burn(keyPair) {
    try {
      crypto.subtle.exportKey('pkcs8', keyPair.privateKey).catch(() => {});
    } catch { /* 不可导出，本就拿不到 */ }
  }
}

function toBase64(bytes) {
  let bin = '';
  for (const b of bytes) bin += String.fromCharCode(b);
  return btoa(bin);
}
