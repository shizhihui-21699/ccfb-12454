/**
 * 页面注入 / 监听行为检测
 *
 * 检测手段（多层，任何一层报警都会写进风险报告，随密文一起上报服务端）：
 *
 * A. 原生函数完整性
 *    正常的原生函数 toString() 形如 "function addEventListener() { [native code] }"。
 *    木马 hook 后通常会替换函数并伪造 toString；单纯比对字符串会被骗过，
 *    所以再用一个隐藏 iframe 里的【另一套原生 Function.prototype.toString】
 *    跨 realm 调用主窗口函数 —— 伪造的 toString 只在主窗口生效，跨 realm 一调就现原形。
 *
 * B. DOM 变动监控（MutationObserver）
 *    键盘打开期间插入 <script>、带 inline 事件属性(on*=)的元素、可疑 iframe/覆盖层。
 *
 * C. 覆盖层检测
 *    用 elementFromPoint 扫描键盘区域，确保没有透明浮层盖在上面拦截点击。
 *
 * D. 蜜罐陷阱
 *    组件放一个 name="password" 的诱饵 <input>，并在其 value 上装访问陷阱，
 *    木马读取 .value 时即被记录（真实口令从不进入任何 input）。
 */

const NATIVE_RE = /\{\s*\[native code\]\s*\}/;

const WATCH_TARGETS = [
  ['EventTarget.prototype.addEventListener', () => EventTarget.prototype.addEventListener],
  ['EventTarget.prototype.removeEventListener', () => EventTarget.prototype.removeEventListener],
  ['EventTarget.prototype.dispatchEvent', () => EventTarget.prototype.dispatchEvent],
  ['document.addEventListener', () => document.addEventListener],
  ['window.addEventListener', () => window.addEventListener],
  ['Element.prototype.attachShadow', () => Element.prototype.attachShadow],
  ['HTMLInputElement.prototype.value', () => Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.get],
  ['document.getElementById', () => document.getElementById],
  ['document.querySelector', () => document.querySelector],
  ['document.createElement', () => document.createElement],
  ['fetch', () => window.fetch],
  ['XMLHttpRequest.prototype.open', () => XMLHttpRequest.prototype.open],
  ['XMLHttpRequest.prototype.send', () => XMLHttpRequest.prototype.send],
  ['CanvasRenderingContext2D.prototype.getImageData', () => CanvasRenderingContext2D.prototype.getImageData],
  ['HTMLCanvasElement.prototype.toDataURL', () => HTMLCanvasElement.prototype.toDataURL],
  ['HTMLCanvasElement.prototype.toBlob', () => HTMLCanvasElement.prototype.toBlob],
  ['navigator.sendBeacon', () => navigator.sendBeacon],
  ['WebSocket', () => window.WebSocket],
];

export class IntegrityMonitor {
  constructor() {
    this.events = [];
    this.checks = [];
    this.observer = null;
    this.probeFrame = null;
    this.timer = null;
    this.rootEl = null;
  }

  log(type, detail) {
    this.events.push({ t: Date.now(), type, detail });
  }

  /** 建立跨 realm 探针（隐藏同源 iframe） */
  installProbe() {
    const frame = document.createElement('iframe');
    frame.setAttribute('aria-hidden', 'true');
    frame.style.cssText =
      'position:fixed;width:1px;height:1px;border:0;opacity:0;pointer-events:none;left:-9999px;top:-9999px;';
    frame.srcdoc = '<!doctype html><title>probe</title>';
    document.documentElement.appendChild(frame);
    this.probeFrame = frame;
    return new Promise((resolve) => {
      frame.addEventListener('load', () => resolve(frame), { once: true });
    });
  }

  /** 用探针 realm 的原生 toString 检验主窗口的函数 */
  crossRealmString(fn) {
    if (!this.probeFrame?.contentWindow) return null;
    try {
      const foreignToString = this.probeFrame.contentWindow.Function.prototype.toString;
      return foreignToString.call(fn);
    } catch {
      return null;
    }
  }

  runNativeChecks() {
    for (const [name, get] of WATCH_TARGETS) {
      const fn = get();
      if (!fn) {
        this.checks.push({ name, passed: false, detail: '目标 API 缺失（可能被删除/劫持）' });
        continue;
      }
      const ownStr = Function.prototype.toString.call(fn);
      const crossStr = this.crossRealmString(fn);
      const okOwn = NATIVE_RE.test(ownStr);
      const okCross = crossStr === null || NATIVE_RE.test(crossStr);
      const okSame = crossStr === null || crossStr === ownStr;
      const passed = okOwn && okCross && okSame;
      if (!passed) {
        this.checks.push({
          name,
          passed: false,
          detail: `函数疑似被 hook（本域=${okOwn} 跨域=${okCross} 一致=${okSame}）`,
          own: ownStr.slice(0, 120),
          cross: crossStr ? crossStr.slice(0, 120) : null,
        });
        this.log('native-hook', name);
      } else {
        this.checks.push({ name, passed: true });
      }
    }
  }

  /** DOM 变动监控：注入脚本 / inline 事件 / 外来 iframe */
  startDomWatch() {
    this.observer = new MutationObserver((muts) => {
      for (const m of muts) {
        for (const node of m.addedNodes) {
          if (!(node instanceof Element)) continue;
          const tag = node.tagName.toLowerCase();
          if (tag === 'script') {
            this.log('dom-inject', `检测到注入的 <script>: ${node.src || 'inline'}`);
          }
          if (tag === 'iframe' && node !== this.probeFrame) {
            this.log('dom-inject', `检测到外来 <iframe>: ${node.src || 'about:blank'}`);
          }
          const onAttrs = [...node.attributes].filter((a) => /^on/i.test(a.name));
          if (onAttrs.length) {
            this.log('dom-inject', `元素 ${tag} 带 inline 事件属性: ${onAttrs.map((a) => a.name).join(',')}`);
          }
          if (node.querySelector?.('script,iframe')) {
            this.log('dom-inject', `注入子树含 script/iframe: <${tag}>`);
          }
        }
      }
    });
    this.observer.observe(document.documentElement, { childList: true, subtree: true });
  }

  /** 覆盖层检测：键盘区域上方是否有外来元素挡着 */
  checkOverlays(rootEl) {
    if (!rootEl) return;
    const rect = rootEl.getBoundingClientRect();
    const pts = [
      [rect.left + rect.width * 0.25, rect.top + rect.height * 0.25],
      [rect.left + rect.width * 0.75, rect.top + rect.height * 0.25],
      [rect.left + rect.width * 0.25, rect.top + rect.height * 0.75],
      [rect.left + rect.width * 0.75, rect.top + rect.height * 0.75],
    ];
    for (const [x, y] of pts) {
      const hit = document.elementFromPoint(x, y);
      if (hit && !rootEl.contains(hit) && hit !== this.probeFrame) {
        this.log('overlay', `键盘区域被外来元素覆盖: <${hit.tagName.toLowerCase()} class="${hit.className}">`);
      }
    }
  }

  /** 蜜罐 input 的 value 访问陷阱：木马一读就被抓 */
  armBait(inputEl) {
    let bait = 'BAIT_' + Math.random().toString(36).slice(2);
    try {
      Object.defineProperty(inputEl, 'value', {
        configurable: true,
        get: () => {
          this.log('bait-read', '有脚本读取诱饵密码框 input.value（真实口令不在任何 input 中）');
          return bait;
        },
        set: (v) => {
          bait = String(v);
        },
      });
    } catch (e) {
      this.log('bait-error', e.message);
    }
  }

  /** 启动时存量扫描：抓出在监控器启动之前就已注入的脚本/浮层/外来 iframe */
  sweepExistingNodes() {
    const suspiciousScript = [...document.scripts].filter(
      (s) => s.dataset.trojan || /__TROJAN|inline_ran/i.test(s.textContent || ''),
    );
    for (const s of suspiciousScript) {
      this.log('dom-inject', `存量扫描发现可疑 <script>: ${s.src || 'inline'}`);
    }

    const foreignFrames = [...document.querySelectorAll('iframe')].filter(
      (f) => f !== this.probeFrame && !f.srcdoc,
    );
    for (const f of foreignFrames) {
      this.log('dom-inject', `存量扫描发现外来 <iframe>: ${f.src || 'about:blank'}`);
    }

    // 带 data-trojan 标记或极端透明但可接收事件的固定定位浮层
    const all = [...document.querySelectorAll('body *')];
    for (const el of all) {
      if (el === this.probeFrame) continue;
      const st = getComputedStyle(el);
      if (st.position !== 'fixed' && st.position !== 'absolute') continue;
      const opacity = Number(st.opacity || '1');
      const marked = 'trojan' in el.dataset;
      const stealthy = opacity <= 0.05 && st.pointerEvents !== 'none' && st.zIndex !== 'auto';
      if (marked || stealthy) {
        this.log(
          'dom-inject',
          `存量扫描发现可疑覆盖层 <${el.tagName.toLowerCase()}>: ` +
            `opacity=${st.opacity} z-index=${st.zIndex}${marked ? ' [data-trojan]' : ''}`,
        );
      }
    }
  }

  start(rootEl, { intervalMs = 1500 } = {}) {
    this.rootEl = rootEl;
    this.runNativeChecks();
    this.startDomWatch();
    this.sweepExistingNodes();
    this.checkOverlays(rootEl);
    this.timer = setInterval(() => {
      this.runNativeChecks();
      this.checkOverlays(this.rootEl);
    }, intervalMs);
  }

  report() {
    const failed = this.checks.filter((c) => !c.passed);
    const score = Math.min(
      100,
      failed.length * 20 + this.events.filter((e) => e.type !== 'bait-read').length * 15 +
        this.events.filter((e) => e.type === 'bait-read').length * 25,
    );
    return {
      score,
      level: score === 0 ? 'safe' : score < 50 ? 'warn' : 'danger',
      failedChecks: failed,
      events: this.events,
      userAgent: navigator.userAgent,
      at: new Date().toISOString(),
    };
  }

  stop() {
    this.observer?.disconnect();
    if (this.timer) clearInterval(this.timer);
    this.probeFrame?.remove();
    this.timer = null;
    this.observer = null;
  }
}
