<template>
  <div class="spo-wrap">
    <!--
      诱饵蜜罐：故意做成一个"看起来很真"的密码框。
      真实口令从不写入它；木马若读取它的 value，会被 integrity-monitor 记录。
    -->
    <input
      ref="baitRef"
      class="spo-bait"
      type="password"
      name="password"
      autocomplete="current-password"
      tabindex="-1"
      aria-hidden="true"
    />

    <button type="button" class="spo-open-btn" @click="openKeyboard">
      <span class="spo-shield">🛡</span> 点击打开安全口令键盘
    </button>
    <p class="spo-hint">物理键盘输入已屏蔽 · 按键位置每次点击后随机重排 · 口令不明文回显</p>

    <transition name="spo-fade">
      <div v-if="open" class="spo-overlay" @keydown.capture="swallow" @keyup.capture="swallow" @keypress.capture="swallow">
        <div class="spo-panel" ref="panelRef">
          <header class="spo-header">
            <strong>安全口令输入</strong>
            <button type="button" class="spo-x" @click="closeKeyboard" aria-label="关闭">×</button>
          </header>

          <!-- 只回显圆点数量，不回显任何字符 -->
          <div class="spo-dots" :class="{ warn: riskLevel === 'danger' }">
            <span v-for="i in maxLength" :key="i" :class="{ on: i <= pinLength }">●</span>
          </div>

          <div class="spo-risk" :class="riskLevel">
            注入检测：{{ riskText }}
            <small v-if="riskEvents">({{ riskEvents }} 项可疑行为已随密文上报)</small>
          </div>

          <!-- 软键盘本体：canvas 绘制，无任何带字符的 DOM 节点 -->
          <canvas
            ref="canvasRef"
            class="spo-canvas"
            @pointerdown="onPointerDown"
            @pointerup="onPointerUp"
            @pointercancel="cancelFlash"
            @pointerleave="cancelFlash"
          ></canvas>

          <footer class="spo-footer">
            <button type="button" @click="backspace">退格</button>
            <button type="button" @click="reshuffle">重排</button>
            <button type="button" class="danger" @click="clearAll">清空</button>
            <button type="button" class="primary" :disabled="pinLength === 0 || submitting" @click="submit">
              {{ submitting ? '加密提交中…' : '加密提交' }}
            </button>
          </footer>
          <p class="spo-proto">AES-256-GCM 一次性加密 · ECDH P-256 临时密钥 · GCM 防篡改</p>
        </div>
      </div>
    </transition>
  </div>
</template>

<script setup>
import { ref, onMounted, onBeforeUnmount, nextTick } from 'vue';
import { buildLayout, KEYSET } from '../lib/shuffle.mjs';
import { IntegrityMonitor } from '../lib/integrity-monitor.mjs';
import { SecureSession } from '../lib/secure-session.mjs';

const props = defineProps({
  maxLength: { type: Number, default: 8 },
  apiBase: { type: String, default: '' },
});
const emit = defineEmits(['submitted', 'risk']);

// ---- 响应式状态（注意：口令本身不在响应式状态里！）----
const open = ref(false);
const pinLength = ref(0);
const submitting = ref(false);
const riskLevel = ref('safe');
const riskText = ref('未发现异常');
const riskEvents = ref(0);
const canvasRef = ref(null);
const panelRef = ref(null);
const baitRef = ref(null);

// ---- 闭包内的秘密：不进 Vue 响应式系统、不进 DOM、不进任何 input ----
let secret = [];                 // 真实口令，仅存在于这个闭包
let layout = [];                 // 当前布局（含字符），仅闭包
let cellRects = [];              // 渲染时计算的格子矩形，仅闭包
let flashUntil = 0;              // 防截屏遮罩截止时间
let rafId = 0;
let ctx = null;
let monitor = null;
let session = null;

const COLS = 6;
const ROWS = 6;

// ---- 物理键盘：捕获阶段直接吞掉，不让任何监听器拿到按键内容 ----
function swallow(e) {
  e.preventDefault();
  e.stopPropagation();
  e.stopImmediatePropagation?.();
  monitor?.log('physical-key', `物理键盘事件 ${e.type} 已被组件吞掉`);
}

// ---- canvas 尺寸（适配 DPR）----
function resizeCanvas() {
  const canvas = canvasRef.value;
  if (!canvas) return;
  const cssW = Math.min(480, panelRef.value.clientWidth - 32);
  // 为头部/圆点/按钮预留空间，且不超过视口 48vh，避免挡住底部按钮
  const naturalH = (cssW / COLS) * ROWS + 8;
  const cap = Math.max(220, window.innerHeight * 0.48);
  const cssH = Math.min(naturalH, cap);
  const dpr = window.devicePixelRatio || 1;
  canvas.style.width = cssW + 'px';
  canvas.style.height = cssH + 'px';
  canvas.style.maxHeight = cap + 'px';
  canvas.width = Math.round(cssW * dpr);
  canvas.height = Math.round(cssH * dpr);
  ctx = canvas.getContext('2d');
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  draw();
}

// ---- 绘制 ----
function draw() {
  const canvas = canvasRef.value;
  if (!ctx || !canvas) return;
  const w = canvas.clientWidth;
  const h = canvas.clientHeight;

  // 防截屏遮罩期间：整板绘制随机噪点，截屏/录屏只能截到雪花。
  // 注意必须按后备缓冲（物理像素）尺寸填充，高 DPR 屏幕下才能完全覆盖。
  if (performance.now() < flashUntil) {
    const img = ctx.createImageData(canvas.width, canvas.height);
    // getRandomValues 单次上限 65536 字节，分块填充
    const CHUNK = 65536;
    for (let off = 0; off < img.data.length; off += CHUNK) {
      crypto.getRandomValues(img.data.subarray(off, Math.min(off + CHUNK, img.data.length)));
    }
    // 不透明噪点：强制 alpha=255，避免透明区域露出底下的按键
    for (let i = 3; i < img.data.length; i += 4) img.data[i] = 255;
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.putImageData(img, 0, 0);
    ctx.setTransform(window.devicePixelRatio || 1, 0, 0, window.devicePixelRatio || 1, 0, 0);
    return;
  }

  ctx.clearRect(0, 0, w, h);
  ctx.fillStyle = getComputedStyle(document.documentElement).getPropertyValue('--spo-kb-bg') || '#101418';
  ctx.fillRect(0, 0, w, h);

  const pad = 6;
  const cw = (w - pad * (COLS + 1)) / COLS;
  const chh = (h - pad * (ROWS + 1)) / ROWS;
  cellRects = [];

  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  for (const cell of layout) {
    const x = pad + cell.col * (cw + pad) + cell.dx;
    const y = pad + cell.row * (chh + pad) + cell.dy;
    cellRects.push({ x, y, w: cw, h: chh, ch: cell.ch });

    roundRect(ctx, x, y, cw, chh, 8);
    ctx.fillStyle = '#1d2630';
    ctx.fill();
    ctx.strokeStyle = '#33414f';
    ctx.lineWidth = 1;
    ctx.stroke();
    ctx.fillStyle = '#e6edf3';
    ctx.font = '600 17px ui-monospace, SFMono-Regular, Menlo, monospace';
    ctx.fillText(cell.ch, x + cw / 2, y + chh / 2 + 1);
  }

  // 测试钩子：仅 Vite 开发构建存在，生产产物中 import.meta.env.DEV 为 false 会被摇掉。
  // 只暴露"字符->位置"的只读快照供自动化测试定位，不提供任何读口令的入口。
  if (import.meta.env?.DEV) {
    window.__SPO_DEBUG_LAYOUT__ = cellRects.map((r) => ({ ...r }));
  }
}

function roundRect(c, x, y, w, h, r) {
  c.beginPath();
  c.moveTo(x + r, y);
  c.arcTo(x + w, y, x + w, y + h, r);
  c.arcTo(x + w, y + h, x, y + h, r);
  c.arcTo(x, y + h, x, y, r);
  c.arcTo(x, y, x + w, y, r);
  c.closePath();
}

function flashLoop() {
  if (performance.now() < flashUntil) {
    draw();
    rafId = requestAnimationFrame(flashLoop);
  } else {
    draw();
  }
}

function startFlash() {
  flashUntil = performance.now() + 240;
  cancelAnimationFrame(rafId);
  flashLoop();
}
function cancelFlash() {
  flashUntil = 0;
  draw();
}

// ---- 布局重排：每次点击后 Fisher-Yates 重新洗牌 + 随机抖动 ----
function reshuffle() {
  layout = buildLayout(KEYSET.split(''), COLS, 7);
  nextTick(draw);
}

function hitTest(px, py) {
  const rect = canvasRef.value.getBoundingClientRect();
  const x = px - rect.left;
  const y = py - rect.top;
  // 倒序匹配无影响（矩形不重叠）；坐标只在本次函数内参与运算，不落盘、不上报
  for (const r of cellRects) {
    if (x >= r.x && x <= r.x + r.w && y >= r.y && y <= r.y + r.h) return r.ch;
  }
  return null;
}

function onPointerDown(e) {
  e.preventDefault(); // 阻止焦点转移、长按菜单等
  startFlash();        // 按下瞬间整板变噪点，防截屏/录屏
}

function onPointerUp(e) {
  const ch = hitTest(e.clientX, e.clientY);
  if (ch && secret.length < props.maxLength) {
    secret.push(ch);           // 只进闭包
    pinLength.value = secret.length;
    reshuffle();               // 关键：按完立刻重排，坐标与字符的映射立即失效
  }
  cancelFlash();
}

// ---- 控制操作（DOM 按钮只做动作，不携带字符）----
function backspace() {
  secret.pop();
  pinLength.value = secret.length;
  reshuffle();
}
function clearAll() {
  secret = [];
  pinLength.value = 0;
  reshuffle();
}

// ---- 提交：一次性加密后只发送密文 ----
async function submit() {
  if (!secret.length || submitting.value) return;
  const risk = monitor.report();
  refreshRisk(risk);

  if (risk.level === 'danger') {
    const go = window.confirm('安全检测发现页面存在被注入/劫持的迹象，仍要提交吗？');
    if (!go) return;
  }

  submitting.value = true;
  try {
    const plaintext = secret.join('');
    const payload = await session.seal(plaintext, risk);
    const res = await fetch(`${props.apiBase}/api/login`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(payload),
    });
    const data = await res.json();
    emit('submitted', { ok: res.ok, data, payloadSize: JSON.stringify(payload).length });
    if (!res.ok) emit('risk', { error: data.error });
  } catch (err) {
    emit('submitted', { ok: false, data: { error: err.message } });
  } finally {
    // 无论成败：明文清零、会话作废后重新建立（一次性会话）
    secret = [];
    pinLength.value = 0;
    submitting.value = false;
    await resetSession();
    reshuffle();
  }
}

function refreshRisk(risk) {
  riskLevel.value = risk.level;
  riskEvents.value = risk.events.length;
  riskText.value =
    risk.level === 'safe' ? '未发现异常'
    : risk.level === 'warn' ? `发现 ${risk.events.length} 项可疑行为`
    : `高危！${risk.failedChecks.length} 项 API 校验失败`;
}

// ---- 生命周期 ----
async function resetSession() {
  session = new SecureSession();
  await session.init(props.apiBase);
}

async function openKeyboard() {
  open.value = true;
  await nextTick();
  resizeCanvas();
  reshuffle();

  monitor = new IntegrityMonitor();
  await monitor.installProbe();
  monitor.armBait(baitRef.value);
  monitor.start(panelRef.value);
  // 周期性刷新风险徽标
  monitor._badgeTimer = setInterval(() => refreshRisk(monitor.report()), 1200);

  window.addEventListener('resize', resizeCanvas);
  document.addEventListener('visibilitychange', onVisibility);
  window.addEventListener('blur', onBlur);
}

function closeKeyboard() {
  open.value = false;
  secret = [];
  pinLength.value = 0;
  teardownMonitor();
}

function onVisibility() {
  if (document.hidden) {
    // 切后台/系统截屏预览：清空画布，只留空白
    ctx?.clearRect(0, 0, canvasRef.value.width, canvasRef.value.height);
  } else {
    reshuffle();
  }
}
function onBlur() {
  reshuffle();
}

function teardownMonitor() {
  if (monitor?._badgeTimer) clearInterval(monitor._badgeTimer);
  monitor?.stop();
  monitor = null;
  window.removeEventListener('resize', resizeCanvas);
  document.removeEventListener('visibilitychange', onVisibility);
  window.removeEventListener('blur', onBlur);
}

onMounted(resetSession);
onBeforeUnmount(teardownMonitor);

defineExpose({ getRiskReport: () => monitor?.report() ?? null });
</script>

<style scoped>
.spo-wrap { display: flex; flex-direction: column; align-items: center; gap: 10px; }
.spo-bait {
  position: absolute; left: -9999px; top: -9999px;
  width: 1px; height: 1px; opacity: 0;
}
.spo-open-btn {
  padding: 12px 22px; border-radius: 10px; border: 1px solid var(--spo-accent, #4f8cff);
  background: linear-gradient(135deg, #1f6feb, #388bfd); color: #fff;
  font-size: 15px; font-weight: 600; cursor: pointer;
}
.spo-hint { margin: 0; font-size: 12px; color: var(--spo-muted, #8b949e); }

.spo-overlay {
  position: fixed; inset: 0; z-index: 9999;
  background: rgba(0, 0, 0, 0.55);
  display: flex; align-items: center; justify-content: center;
  padding: 16px;
  overflow-y: auto;
}
.spo-panel {
  width: min(540px, 100%);
  max-height: calc(100vh - 32px);
  overflow-y: auto;
  background: var(--spo-panel, #0d1117);
  border: 1px solid #30363d; border-radius: 16px;
  padding: 18px; box-shadow: 0 24px 60px rgba(0, 0, 0, 0.5);
}
.spo-header { display: flex; justify-content: space-between; align-items: center; margin-bottom: 12px; }
.spo-x {
  background: none; border: 0; color: #8b949e; font-size: 22px;
  cursor: pointer; line-height: 1;
}
.spo-dots {
  display: flex; justify-content: center; gap: 10px;
  font-size: 22px; letter-spacing: 6px; color: #30363d;
  padding: 10px 0 6px; user-select: none;
}
.spo-dots .on { color: #58a6ff; }
.spo-dots.warn .on { color: #f85149; }

.spo-risk { font-size: 12px; text-align: center; padding: 4px 0 10px; color: #3fb950; }
.spo-risk.warn { color: #d29922; }
.spo-risk.danger { color: #f85149; font-weight: 700; }
.spo-risk small { color: #8b949e; margin-left: 4px; }

.spo-canvas {
  display: block; margin: 0 auto; border-radius: 10px;
  touch-action: manipulation; user-select: none;
  background: #101418;
  max-height: min(52vh, 480px);
  width: auto;
}
.spo-footer { display: flex; gap: 8px; margin-top: 14px; flex-wrap: wrap; }
.spo-footer button {
  flex: 1 1 auto; min-width: 72px;
  padding: 10px 8px; border-radius: 8px; border: 1px solid #30363d;
  background: #21262d; color: #e6edf3; cursor: pointer; font-size: 13px;
}
.spo-footer button.danger { border-color: #f8514955; color: #ff7b72; }
.spo-footer button.primary {
  background: #238636; border-color: #2ea043; color: #fff; font-weight: 700;
}
.spo-footer button:disabled { opacity: 0.5; cursor: not-allowed; }
.spo-proto { font-size: 11px; color: #6e7681; text-align: center; margin: 10px 0 0; }

.spo-fade-enter-active, .spo-fade-leave-active { transition: opacity 0.15s ease; }
.spo-fade-enter-from, .spo-fade-leave-to { opacity: 0; }
</style>
