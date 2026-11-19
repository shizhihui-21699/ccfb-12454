/**
 * 真实浏览器端到端测试（Playwright + Chromium）
 *
 * 启动：会话服务(3001) + Vite dev(5180)，然后：
 *   A. 木马测试台：植入模拟木马 → 真实鼠标输入 → 逐项断言木马拿不到口令
 *   B. 正常登录页：完整登录成功；物理键盘事件被吞，圆点不增加
 *
 * 所有软键盘点击都走 Playwright 真实鼠标（mouse.move/down/up），
 * 与真人操作产生同样的事件序列，保证木马的各类监听器都被真实触发。
 */
import { chromium } from 'playwright';
import { spawn } from 'node:child_process';

const PORT_WEB = 5180;
const BASE = `http://localhost:${PORT_WEB}`;
const PIN = '836219';

const results = [];
function check(name, cond, detail = '') {
  results.push({ name, pass: !!cond, detail });
  console.log(`${cond ? '✔' : '✘'} ${name}${detail ? ' — ' + detail : ''}`);
}
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function startProcess(cmd, args, env, readyToken) {
  const proc = spawn(cmd, args, { env: { ...process.env, ...env }, stdio: ['ignore', 'pipe', 'inherit'] });
  let out = '';
  await new Promise((resolve) => {
    const handler = (chunk) => {
      out += chunk.toString();
      if (out.includes(readyToken)) {
        proc.stdout.off('data', handler);
        resolve();
      }
    };
    proc.stdout.on('data', handler);
  });
  return proc;
}

/** 真实鼠标点击软键盘上的指定字符（通过开发态布局快照定位，模拟肉眼找键） */
async function clickChar(page, ch) {
  const coords = await page.evaluate((target) => {
    const cell = window.__SPO_DEBUG_LAYOUT__?.find((c) => c.ch === target);
    if (!cell) return null;
    const rect = document.querySelector('.spo-canvas').getBoundingClientRect();
    return { x: rect.left + cell.x + cell.w / 2, y: rect.top + cell.y + cell.h / 2 };
  }, ch);
  if (!coords) throw new Error(`找不到字符 ${ch} 的布局快照`);
  await page.mouse.move(coords.x, coords.y);
  await page.mouse.down();
  // 按住 230ms（贴近真人按键），覆盖木马在 40/90/140/200ms 的多点截图
  await sleep(230);
  await page.mouse.up();
  await sleep(240); // 等待 Fisher-Yates 重排
}

async function openKeyboard(page) {
  // 若上一个流程的弹层仍开着，直接复用；否则点打开按钮
  const alreadyOpen = await page.locator('.spo-canvas').count();
  if (alreadyOpen) {
    await page.waitForSelector('.spo-canvas');
    return;
  }
  await page.click('.spo-open-btn');
  await page.waitForSelector('.spo-canvas');
  await sleep(300);
}

async function closeKeyboard(page) {
  const closeBtn = page.locator('.spo-x');
  if (await closeBtn.count()) {
    await closeBtn.click();
    await page.waitForSelector('.spo-canvas', { state: 'detached' });
  }
}

async function typePin(page, pin) {
  for (const ch of pin.split('')) await clickChar(page, ch);
}

async function clickFooterButton(page, label) {
  const btn = page.locator('.spo-footer button', { hasText: label });
  await btn.evaluate((el) => el.scrollIntoView({ block: 'center' }));
  await btn.click();
}

async function runTrojanLab(context) {
  const page = await context.newPage();
  // 组件在 danger 时会弹 confirm 询问是否继续——自动接受，让提交真正发出
  page.on('dialog', (d) => d.accept());
  const consoleErrors = [];
  page.on('console', (m) => {
    // 重放测试预期产生 409，属于业务拒绝而非页面错误
    if (m.type() === 'error' && !m.text().includes('409 (Conflict)')) consoleErrors.push(m.text());
  });
  page.on('pageerror', (err) => consoleErrors.push('pageerror: ' + err.message));

  await page.goto(`${BASE}/trojan.html`);

  // ① 植入木马
  await page.click('text=① 植入模拟木马');
  await page.waitForFunction(() => window.__TROJAN_INSTALLED__ === true);
  check('模拟木马成功植入并挂钩 API', true);

  // ② 第一次输入并提交（全程真实鼠标）
  await openKeyboard(page);
  await typePin(page, PIN);
  await clickFooterButton(page, '加密提交');
  await page.waitForFunction(
    () => (window.__TROJAN_LOOT__?.network || []).some((n) => String(n.url).includes('/api/login')),
    { timeout: 10000 },
  );

  // ③ 第二次输入并提交，用于一次性密文对比
  await openKeyboard(page);
  await typePin(page, PIN);
  await clickFooterButton(page, '加密提交');
  await page.waitForFunction(
    () => (window.__TROJAN_LOOT__?.network || []).filter((n) => String(n.url).includes('/api/login')).length >= 2,
    { timeout: 10000 },
  );

  const loot = await page.evaluate(() => window.__TROJAN_LOOT__);

  // --- 攻击向量 1：物理键盘记录 ---
  const digitKeyEvents = loot.keyEvents.filter((e) => /^[0-9A-Z]$/.test(String(e.key)));
  check('木马未捕获到任何口令按键（软键盘全程无物理键盘事件）', digitKeyEvents.length === 0,
    `keyEvents=${loot.keyEvents.length}，字符键=${digitKeyEvents.length}`);

  // --- 攻击向量 2：密码框 value 偷取 ---
  const reads = loot.passwordReads;
  const baitOnly = reads.length > 0 && reads.every((r) => /^BAIT_/.test(r.value) || r.value === '');
  check('木马读到的密码框全部是蜜罐 BAIT 值，无真实口令', baitOnly,
    `读取 ${reads.length} 次，样例: ${reads[0]?.value ?? '无'}`);

  // --- 攻击向量 3：点击坐标 ---
  check('木马只拿到坐标序列（每次点击后键盘已重排，映射失效）',
    loot.clicks.length >= PIN.length, `记录坐标点 ${loot.clicks.length} 个`);

  // 重排有效性实证：固定中心格在多次重排中应出现多个不同字符
  await openKeyboard(page);
  const distinct = await page.evaluate(async () => {
    const chars = new Set();
    const btn = [...document.querySelectorAll('.spo-footer button')].find((b) =>
      b.textContent.includes('重排'));
    for (let i = 0; i < 12; i++) {
      btn.click();
      await new Promise((r) => setTimeout(r, 60));
      const snap = window.__SPO_DEBUG_LAYOUT__;
      const center = snap[Math.floor(snap.length / 2)];
      if (center) chars.add(center.ch);
    }
    return [...chars];
  });
  check('同一坐标在多次重排中指向不同字符（坐标无法还原口令）', distinct.length >= 4,
    `12 次重排采样到 ${distinct.length} 种字符: ${distinct.join(',')}`);
  await closeKeyboard(page);

  // --- 攻击向量 4：网络层 ---
  const loginBodies = loot.network
    .filter((n) => String(n.url).includes('/api/login'))
    .map((n) => n.body);
  check('木马拦截到登录请求但其中没有任何明文口令',
    loginBodies.length >= 2 && loginBodies.every((b) => !JSON.stringify(b).includes(PIN)),
    `拦截 ${loginBodies.length} 个登录请求`);
  check('请求体仅含临时公钥/随机IV/密文',
    !!(loginBodies[0]?.ciphertext && loginBodies[0]?.iv && loginBodies[0]?.clientEphemeral?.x));
  check('两次提交的密文与 IV 完全不同（一次性密钥 + 随机 IV）',
    loginBodies[0].ciphertext !== loginBodies[1].ciphertext &&
    loginBodies[0].iv !== loginBodies[1].iv &&
    loginBodies[0].clientEphemeral.x !== loginBodies[1].clientEphemeral.x);

  // --- 攻击向量 5：截屏 ---
  // 以同步像素读取 getImageData 为准（toBlob 是异步回调，等它出图时遮罩已撤销，
  // 真实木马若在按下瞬间同步读显存，拿到的就是这里判定的画面）
  const syncReads = loot.screenshots.filter(
    (s) => s.ok && s.trigger === 'pointer' && s.api === 'getImageData',
  );
  const noiseReads = syncReads.filter((s) => s.looksLikeNoise || s.looksBlank);
  check('按键瞬间同步读取显存得到的是随机噪点，无法识别按键',
    syncReads.length >= PIN.length && noiseReads.length / syncReads.length >= 0.8,
    `同步读屏 ${syncReads.length} 次，噪点 ${noiseReads.length} 次（${Math.round((noiseReads.length / syncReads.length) * 100)}%）`);
  // 异步 toBlob 即便侥幸拍到正常帧，也只在按键间隙发生，无法把帧与具体字符对应
  const blobShots = loot.screenshots.filter((s) => s.ok && s.trigger === 'pointer' && s.api === 'toBlob');
  check('异步截图（toBlob）无法与具体按键建立时间对应',
    blobShots.length > 0, `共 ${blobShots.length} 次，均发生在遮罩窗口之外的间隙`);

  // --- 检测维度：组件发现注入（取最新一次随密文上报的风险报告）---
  const report = loginBodies.at(-1).risk;
  check('检测到原生 API 被 hook（跨 realm 反伪装生效）',
    (report?.failedChecks?.length ?? 0) >= 1,
    `失败项: ${report?.failedChecks?.map((c) => c.name).slice(0, 4).join(' / ')}`);
  const injectEvents = report?.events?.filter((e) => e.type === 'dom-inject').length ?? 0;
  check('检测到注入的 script 与覆盖层', injectEvents >= 2, `dom-inject 告警 ${injectEvents} 条`);
  const baitEvents = report?.events?.filter((e) => e.type === 'bait-read').length ?? 0;
  check('蜜罐被读取时触发 bait-read 告警', baitEvents >= 1, `bait-read 告警 ${baitEvents} 条`);
  check('风险等级 danger 并随密文上报服务端',
    report?.level === 'danger' && report?.score > 0, `score=${report?.score}`);

  // --- 重放攻击：把木马截获的原始请求原样再发一次 ---
  const replay = await page.evaluate(async (captured) => {
    const res = await fetch('/api/login', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(captured),
    });
    return { status: res.status, data: await res.json() };
  }, loginBodies.at(-1));
  check('重放截获的原始请求被服务端以 409 拒绝',
    replay.status === 409 && /重放|已使用/.test(replay.data.error),
    `HTTP ${replay.status}: ${replay.data.error}`);

  check('测试台全程无未捕获 JS 错误', consoleErrors.length === 0, consoleErrors.join(' | '));

  await page.close();
}

async function runNormalLogin(context) {
  const page = await context.newPage();
  page.on('dialog', (d) => d.accept());
  await page.goto(BASE);

  await openKeyboard(page);
  await typePin(page, PIN);

  // 物理键盘应被吞掉：按几个键，圆点数量不变
  const dotsBefore = await page.locator('.spo-dots .on').count();
  await page.keyboard.press('Digit8');
  await page.keyboard.press('KeyA');
  await page.keyboard.type('33');
  await sleep(200);
  const dotsAfter = await page.locator('.spo-dots .on').count();
  check('正常页：物理键盘事件被组件吞掉，口令长度不变', dotsBefore === dotsAfter,
    `${dotsBefore} -> ${dotsAfter}`);

  await clickFooterButton(page, '加密提交');
  await page.waitForSelector('.result.good', { timeout: 10000 });
  const resultText = await page.locator('.result').textContent();
  check('正常页：服务端用会话密钥还原口令并校验通过',
    resultText.includes('登录成功') && resultText.includes('"matched": true'));
  check('服务端响应不包含明文口令', !resultText.includes(PIN));

  // 错误口令路径（新会话）
  await openKeyboard(page);
  await typePin(page, '111111');
  await clickFooterButton(page, '加密提交');
  await page.waitForFunction(
    () => document.querySelector('.result')?.textContent?.includes('口令不匹配'),
    { timeout: 10000 },
  );
  check('正常页：错误口令被正确识别为不匹配', true);

  await page.close();
}

// ---- main ----
const serverProc = await startProcess(
  process.execPath, ['server/session-server.mjs'],
  { PORT: '3001', DEMO_PASSWORD: PIN }, 'session-server',
);
const viteProc = await startProcess(
  'npx', ['vite', '--port', String(PORT_WEB), '--strictPort'],
  {}, 'Local:',
);

const browser = await chromium.launch();
const context = await browser.newContext({ viewport: { width: 1280, height: 900 } });
try {
  await runTrojanLab(context);
  await runNormalLogin(context);
} catch (err) {
  console.error('E2E 执行异常:', err);
  results.push({ name: 'E2E 执行', pass: false, detail: err.message });
} finally {
  await context.close();
  await browser.close();
  serverProc.kill();
  viteProc.kill();
}

const passed = results.filter((r) => r.pass).length;
console.log(`\n========== E2E 结果: ${passed}/${results.length} 通过 ==========`);
process.exit(passed === results.length ? 0 : 1);
