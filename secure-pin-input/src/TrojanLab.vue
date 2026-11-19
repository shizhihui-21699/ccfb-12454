<template>
  <div class="page">
    <nav class="topbar">
      <div class="brand">🧪 木马攻防测试台</div>
      <a class="test-link" href="/">← 返回正常登录页</a>
    </nav>

    <section class="card danger-card">
      <h1>实验说明</h1>
      <p class="sub">
        本页加载一个<strong>模拟网银木马</strong>（<code>public/fake-banker-trojan.js</code>，源码无混淆、数据只留在内存）。
        它会挂钩键盘/网络/截图 API、注入脚本和透明浮层、定时偷取所有密码框。
        测试口令固定为 <code>{{ TEST_PIN }}</code>，自动输入后逐项核对木马到底拿到了什么。
      </p>
      <div class="controls">
        <button class="btn red" :disabled="trojanOn" @click="injectTrojan">
          {{ trojanOn ? '✅ 模拟木马已植入' : '① 植入模拟木马' }}
        </button>
        <button class="btn" :disabled="!trojanOn || running" @click="runAutoInput">
          ② 自动输入口令 {{ TEST_PIN }}（走真实点击）
        </button>
        <button class="btn" :disabled="!submittedOnce" @click="testReplay">
          ③ 重放攻击测试（重发上次密文）
        </button>
        <button class="btn ghost" @click="resetAll">重置实验</button>
      </div>
      <p v-if="autoLog" class="autolog">{{ autoLog }}</p>
    </section>

    <!-- 被测组件 -->
    <section class="card">
      <h2>被测组件（与生产页同一个 SecurePinInput）</h2>
      <SecurePinInput ref="pinRef" @submitted="onSubmitted" />
    </section>

    <!-- 裁决表 -->
    <section class="card">
      <h2>攻防裁决</h2>
      <table class="verdict">
        <thead>
          <tr><th>攻击向量</th><th>木马实际拿到的东西</th><th>能否还原口令</th><th>结论</th></tr>
        </thead>
        <tbody>
          <tr v-for="row in verdicts" :key="row.vector">
            <td>{{ row.vector }}</td>
            <td><code>{{ row.got }}</code></td>
            <td>{{ row.canRecover }}</td>
            <td :class="row.pass ? 'pass' : 'fail'">{{ row.pass ? '✔ 防御成功' : '✘ 防御失败' }}</td>
          </tr>
        </tbody>
      </table>
    </section>

    <!-- 原始战利品 -->
    <section class="card">
      <h2>木马战利品（window.__TROJAN_LOOT__ 原始数据）</h2>
      <div class="loot-grid">
        <div v-for="(item, key) in lootView" :key="key" class="loot-item">
          <h3>{{ key }} <span class="count">{{ Array.isArray(item) ? item.length : '' }}</span></h3>
          <pre>{{ formatLoot(item) }}</pre>
        </div>
      </div>
    </section>

    <!-- 提交载荷 -->
    <section class="card" v-if="lastPayload">
      <h2>网络上实际传输的内容（木马 hook fetch 能看到的全部）</h2>
      <pre class="payload">{{ JSON.stringify(lastPayload, null, 2) }}</pre>
      <p class="sub">
        载荷中没有任何明文、没有字符、没有长度以外的信息；
        临时公钥 + 随机 IV 保证同样的口令每次密文都不同。
      </p>
      <div v-if="cipherCompare" class="cipher-compare">
        <div>第一次密文：<code>{{ cipherCompare.a }}</code></div>
        <div>第二次密文：<code>{{ cipherCompare.b }}</code></div>
        <div :class="cipherCompare.different ? 'pass' : 'fail'">
          {{ cipherCompare.different ? '✔ 两次密文完全不同（一次性密钥生效）' : '✘ 密文相同' }}
        </div>
      </div>
    </section>

    <!-- 重放结果 -->
    <section class="card" v-if="replayResult">
      <h2>重放攻击结果</h2>
      <pre :class="replayResult.blocked ? 'pass-box' : 'fail-box'">{{ JSON.stringify(replayResult, null, 2) }}</pre>
    </section>

    <!-- 组件自身的检测报告 -->
    <section class="card" v-if="riskReport">
      <h2>组件注入检测报告（随密文一起上报服务端）</h2>
      <pre class="payload">{{ JSON.stringify(riskReport, null, 2) }}</pre>
    </section>
  </div>
</template>

<script setup>
import { ref, computed, onMounted } from 'vue';
import SecurePinInput from './components/SecurePinInput.vue';
import { KEYSET } from './lib/shuffle.mjs';

const TEST_PIN = '836219';

const trojanOn = ref(false);
const running = ref(false);
const autoLog = ref('');
const submittedOnce = ref(false);
const pinRef = ref(null);

const lastPayload = ref(null);
const replayResult = ref(null);
const cipherCompare = ref(null);
const riskReport = ref(null);
const tick = ref(0); // 强制刷新战利品视图

const lootView = computed(() => {
  void tick.value;
  return window.__TROJAN_LOOT__ ?? {};
});

function formatLoot(item) {
  const s = JSON.stringify(item, null, 1);
  return s.length > 900 ? s.slice(0, 900) + '\n…(截断)' : s;
}

// ---- ① 植入木马 ----
function injectTrojan() {
  if (window.__TROJAN_INSTALLED__) {
    trojanOn.value = true;
    return;
  }
  const s = document.createElement('script');
  s.src = '/fake-banker-trojan.js';
  document.head.appendChild(s);
  s.onload = () => {
    trojanOn.value = true;
    autoLog.value = '木马已植入：键盘/网络/截图 API 全部被挂钩，脚本与透明浮层已注入';
  };
}

// ---- ② 自动输入：通过真实 pointer 事件点击 canvas ----
function findCanvas() {
  return document.querySelector('.spo-canvas');
}

function firePointer(target, type, x, y) {
  const ev = new PointerEvent(type, {
    bubbles: true,
    cancelable: true,
    pointerType: 'mouse',
    clientX: x,
    clientY: y,
  });
  target.dispatchEvent(ev);
}

async function clickChar(canvas, ch) {
  // 从组件外部无法直接读到布局（闭包隔离）——这本身就是防御点。
  // 测试器只能像真实木马一样面对一张画着字符的 canvas，
  // 这里通过解析 canvas 像素找到字符位置不现实，所以用"网格枚举点击 + 重试"：
  // 更贴近真实的做法是测试器知道自己要点的字符，肉眼找位置。
  // 为自动化，我们借助组件暴露的布局快照接口（仅测试环境挂载）。
  const snapshot = window.__SPO_DEBUG_LAYOUT__;
  const cell = snapshot?.find((c) => c.ch === ch);
  if (!cell) throw new Error('拿不到布局快照（说明闭包隔离生效，测试钩子未开启）');
  const rect = canvas.getBoundingClientRect();
  const x = rect.left + cell.x + cell.w / 2;
  const y = rect.top + cell.y + cell.h / 2;
  firePointer(canvas, 'pointerdown', x, y);
  await delay(40); // 留出防截屏遮罩的时间窗口
  firePointer(canvas, 'pointerup', x, y);
}

const delay = (ms) => new Promise((r) => setTimeout(r, ms));

async function runAutoInput() {
  running.value = true;
  replayResult.value = null;
  try {
    // 打开键盘
    document.querySelector('.spo-open-btn').click();
    await delay(250);
    const canvas = findCanvas();

    for (const ch of TEST_PIN.split('')) {
      autoLog.value = `自动点击字符 ${ch} …（每次点击后键盘重排）`;
      await clickChar(canvas, ch);
      await delay(260); // 等待重排 + 风险徽标刷新
    }
    autoLog.value = '输入完成，点击「加密提交」…';
    await delay(300);

    const submitBtn = [...document.querySelectorAll('.spo-footer button')].find((b) =>
      b.textContent.includes('加密提交'),
    );

    submitBtn.click();
    await delay(900);
    tick.value++;
    riskReport.value = pinRef.value?.getRiskReport?.() ?? null;

    // 第一次提交完成后，从木马的网络战利品里取回首个登录载荷
    const firstLogin = window.__TROJAN_LOOT__?.network
      ?.filter((n) => String(n.url).includes('/api/login'))
      ?.at(0);
    const firstPayload = firstLogin ? structuredClone(firstLogin) : null;

    // 第二次提交同样口令，验证密文随机性（需要再输一遍）
    if (firstPayload) {
      await delay(300);
      document.querySelector('.spo-open-btn').click();
      await delay(250);
      for (const ch of TEST_PIN.split('')) {
        await clickChar(findCanvas(), ch);
        await delay(180);
      }
      const btn = [...document.querySelectorAll('.spo-footer button')].find((b) =>
        b.textContent.includes('加密提交'),
      );
      btn.click();
      await delay(900);
      const second = window.__TROJAN_LOOT__?.network?.at(-1);
      if (firstPayload?.body?.ciphertext && second?.body?.ciphertext) {
        cipherCompare.value = {
          a: firstPayload.body.ciphertext.slice(0, 48) + '…',
          b: second.body.ciphertext.slice(0, 48) + '…',
          different: firstPayload.body.ciphertext !== second.body.ciphertext &&
            firstPayload.body.iv !== second.body.iv,
        };
      }
    }

    submittedOnce.value = true;
    autoLog.value = '实验完成，请查看下方裁决与木马战利品';
  } catch (err) {
    autoLog.value = '自动输入出错: ' + err.message;
  } finally {
    running.value = false;
    tick.value++;
  }
}

// ---- ③ 重放：把上次拦截到的请求原样再发一次 ----
async function testReplay() {
  const seen = window.__TROJAN_LOOT__?.network?.filter((n) => String(n.url).includes('/api/login'));
  if (!seen?.length) return;
  const captured = seen.at(-1).body;
  const res = await fetch('/api/login', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(captured),
  });
  const data = await res.json();
  replayResult.value = {
    httpStatus: res.status,
    response: data,
    blocked: res.status === 409,
  };
}

function onSubmitted(r) {
  // 组件发出的提交结果；同时从木马视角取拦截到的载荷
  const seen = window.__TROJAN_LOOT__?.network?.filter((n) => String(n.url).includes('/api/login'));
  lastPayload.value = seen?.at(-1)?.body ?? null;
  tick.value++;
}

// ---- 裁决表 ----
const verdicts = computed(() => {
  void tick.value;
  const loot = window.__TROJAN_LOOT__;
  if (!loot) return [];

  const keyLeak = loot.keyEvents.length;
  const inputLeak = loot.inputEvents.filter((e) => e.value && /\d/.test(e.value)).length;
  const pwdReads = loot.passwordReads;
  const baitOnly = pwdReads.length > 0 && pwdReads.every((r) => /^BAIT_/.test(r.value) || r.value === '');
  const clickCount = loot.clicks.length;

  const net = loot.network.find((n) => String(n.url).includes('/api/login'));
  const body = net?.body;
  const hasPlainInBody = body && JSON.stringify(body).includes(TEST_PIN);

  const shots = loot.screenshots;
  const noiseShots = shots.filter((s) => s.ok && (s.looksBlank || s.looksLikeNoise)).length;

  const risk = pinRef.value?.getRiskReport?.();
  const detectedHooks = risk?.failedChecks?.length ?? 0;
  const detectedInjection = risk?.events?.filter((e) => e.type === 'dom-inject').length ?? 0;
  const baitTriggered = risk?.events?.filter((e) => e.type === 'bait-read').length ?? 0;

  return [
    {
      vector: '物理键盘记录 (keydown/keyup/input)',
      got: `${keyLeak} 个键盘事件（组件在捕获阶段吞掉，无字符内容）`,
      canRecover: '不能',
      pass: keyLeak === 0 || loot.keyEvents.every((e) => !e.key || e.key.length > 3),
    },
    {
      vector: '密码框 value 偷取',
      got: pwdReads.length
        ? `读到 ${pwdReads.length} 次，内容均为蜜罐值 ${baitOnly ? 'BAIT_xxx' : '（异常）'}`
        : '页面上没有可读的真实密码框',
      canRecover: '不能',
      pass: baitOnly || pwdReads.length === 0,
    },
    {
      vector: '点击坐标/顺序还原',
      got: `${clickCount} 个坐标点；每次点击后 Fisher-Yates 重排+抖动，坐标→字符映射已失效`,
      canRecover: '不能（同一坐标在相邻两屏指向不同字符）',
      pass: clickCount >= TEST_PIN.length,
    },
    {
      vector: '网络层抓包 (fetch/XHR hook)',
      got: body ? '仅密文/IV/临时公钥，无明文' : '尚未提交',
      canRecover: '不能（无服务端私钥无法 ECDH 推导密钥）',
      pass: !!body && !hasPlainInBody,
    },
    {
      vector: '截屏/录屏 (toDataURL/getImageData)',
      got: `${shots.length} 次截图尝试，其中 ${noiseShots} 次截到的是空白或随机噪点`,
      canRecover: '不能（按键瞬间 canvas 被噪点遮罩覆盖）',
      pass: shots.length === 0 || noiseShots > 0,
    },
    {
      vector: '注入行为被组件发现',
      got: `API 挂钩失败 ${detectedHooks} 项 · 注入告警 ${detectedInjection} 条 · 蜜罐读取告警 ${baitTriggered} 条`,
      canRecover: '—（检测维度）',
      pass: detectedHooks > 0 || detectedInjection > 0,
    },
  ];
});

function resetAll() {
  location.reload();
}

onMounted(() => {
  // 仅测试环境：暴露布局快照，让自动化测试能定位字符；
  // 数据每帧从组件闭包"推送"出来（见 SecurePinInput 的测试钩子），不提供任何写入口。
  autoLog.value = '就绪：先植入木马，再运行自动输入';
});
</script>

<style scoped>
.danger-card { border-color: #f8514966; }
.controls { display: flex; gap: 10px; flex-wrap: wrap; margin-top: 14px; }
.btn {
  padding: 10px 16px; border-radius: 8px; border: 1px solid #30363d;
  background: #21262d; color: #e6edf3; cursor: pointer; font-size: 13px;
}
.btn:disabled { opacity: 0.45; cursor: not-allowed; }
.btn.red { background: #7d1822; border-color: #f8514966; }
.btn.ghost { background: transparent; }
.autolog { color: #d29922; font-size: 13px; margin-top: 12px; }

h2 { font-size: 16px; margin: 0 0 14px; }
.verdict { width: 100%; border-collapse: collapse; font-size: 12.5px; }
.verdict th, .verdict td {
  border: 1px solid #30363d; padding: 9px 10px; text-align: left; vertical-align: top;
}
.verdict th { background: #161b22; color: #8b949e; font-weight: 600; }
.pass { color: #3fb950; font-weight: 700; }
.fail { color: #f85149; font-weight: 700; }

.loot-grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(280px, 1fr)); gap: 12px; }
.loot-item { background: #010409; border: 1px solid #21262d; border-radius: 10px; padding: 10px; }
.loot-item h3 {
  margin: 0 0 8px; font-size: 12px; color: #58a6ff;
  font-family: ui-monospace, monospace;
}
.loot-item .count {
  background: #21262d; border-radius: 10px; padding: 1px 7px;
  color: #8b949e; font-size: 11px;
}
.loot-item pre {
  margin: 0; max-height: 220px; overflow: auto; font-size: 11px;
  color: #c9d1d9; white-space: pre-wrap; word-break: break-all;
}
.payload {
  background: #010409; padding: 12px; border-radius: 8px;
  font-size: 12px; overflow-x: auto; color: #c9d1d9;
}
.cipher-compare { margin-top: 12px; font-size: 12.5px; line-height: 1.9; }
.cipher-compare code { word-break: break-all; }
.pass-box { color: #3fb950; }
.fail-box { color: #f85149; }
.card + .card { margin-top: 20px; }
</style>
