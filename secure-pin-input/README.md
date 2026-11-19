# SecurePinInput · 防窥口令输入组件（Vue 3）

针对网银登录场景的防御性安全输入组件：**随机软键盘 + 一次性端到端加密 + 页面注入检测**，
并附带一个完全透明的**模拟木马测试台**，用可复现的实验证明木马无法还原口令。

> 仅用于授权环境下的安全工程与教学。`public/fake-banker-trojan.js` 是教学用模拟木马，
> 无混淆、不外联、数据只留在内存，不包含任何真实传播或破坏能力。

---

## 1. 快速开始

```bash
npm install
npm run demo          # 同时启动会话服务(:3001) 与前端(:5173)
```

- 正常网银登录页： http://localhost:5173/
- 木马攻防测试台： http://localhost:5173/trojan.html
- 演示口令： `836219`（可用环境变量 `DEMO_PASSWORD` 覆盖）

测试：

```bash
npm run smoke         # 加密协议单元/集成测试（Node，6 项）
npm run e2e           # 真实浏览器端到端攻防测试（Playwright，20 项）
npm run build         # 生产构建（调试钩子会被摇掉）
```

> `npm run e2e` 首次运行需先 `npx playwright install chromium`。

---

## 2. 威胁模型与防御对照

| 攻击向量 | 组件对策 | 测试台如何验证 |
| --- | --- | --- |
| JS 键盘记录器监听物理键盘 | 只用 canvas 软键盘；弹层在**捕获阶段**吞掉所有物理键盘事件 | 断言木马 `keyEvents` 中无任何字符键 |
| 读取密码框 `input.value` | 真实口令不进入任何 DOM/input；页面只放一个蜜罐 input，读取即告警 | 断言木马读到的全是 `BAIT_xxx` |
| 记录点击坐标/顺序还原口令 | 每次点击后 **Fisher–Yates 全量重排 + 每格随机抖动**；坐标→字符映射即时失效 | 实证同一坐标在 12 次重排中出现 8~11 种字符 |
| 截屏 / 录屏 | 按下瞬间 canvas 用密码学随机噪点整板覆盖（含高 DPR 后备缓冲），抬起才重绘 | 断言同步读屏 80%+ 是随机噪点 |
| 网络抓包、中间人 | 每次提交新建**一次性 ECDH P-256 临时密钥**，HKDF 推导 AES-256-GCM 密钥，随机 IV | 断言报文无明文；同口令两次密文完全不同 |
| 重放攻击 | 服务端对客户端临时公钥去重，重放包在会话查找之前就被拒绝 | 重放截获报文 → `409 拒绝重放` |
| 篡改密文 | AES-GCM 认证标签 | 翻转 1 字节 → 解密失败 |
| Hook 原生函数伪装 `[native code]` | 隐藏同源 iframe 跨 realm 调用**另一套** `Function.prototype.toString` 反伪装 | 断言 `failedChecks` 命中被 hook 的 API |
| 注入脚本 / 透明覆盖层 | MutationObserver 增量监控 + 启动时存量扫描 + `elementFromPoint` 覆盖层检测 | 断言 `dom-inject` 告警 ≥ 3 |

---

## 3. 目录结构

```
secure-pin-input/
├── server/session-server.mjs        # 会话密钥服务（纯 Node 内置模块，零依赖）
├── src/
│   ├── components/SecurePinInput.vue# 核心组件：canvas 软键盘/遮罩/闭包存口令
│   ├── lib/
│   │   ├── secure-session.mjs       # 一次性 ECDH + AES-256-GCM 加密（Web Crypto）
│   │   ├── shuffle.mjs              # CSPRNG 随机数 + Fisher–Yates + 位置抖动
│   │   └── integrity-monitor.mjs    # 原生函数完整性/跨 realm 反伪装/DOM 与覆盖层监控/蜜罐
│   ├── App.vue                      # 正常网银登录页
│   ├── TrojanLab.vue                # 木马攻防测试台
│   └── main.js / trojan-main.js
├── public/fake-banker-trojan.js     # 教学用模拟木马（透明、不外联）
├── scripts/
│   ├── smoke-test.mjs               # 协议测试
│   └── e2e-test.mjs                 # Playwright 攻防 E2E
└── index.html / trojan.html
```

---

## 4. 关键设计

### 4.1 软键盘随机化（`src/lib/shuffle.mjs`）

- 随机源全部走 `crypto.getRandomValues`，并用**拒绝采样**消除取模偏置。
- 字符集 `0-9A-Z` 共 36 键，6×6 布局；每次 `pointerup` 后整盘重新洗牌。
- 每个单元格再叠加 ±7px 的随机位移，几何位置本身也不固定。
- 真实口令仅保存在组件 `<script setup>` 的**闭包变量**里，不进入 Vue 响应式系统、
  不写入 DOM、不写入任何 `input`；界面只回显圆点数量。

### 4.2 一次性加密通道（`src/lib/secure-session.mjs` ↔ `server/`）

```
客户端                                         服务端
  │── GET /api/session ───────────────────────▶│ 生成 ECDH P-256 会话密钥对
  │◀── { sessionId, serverPublicKeyJwk } ───────│
  │                                             │
  │ 提交时：生成【一次性】ECDH 临时密钥对         │
  │ ECDH(临时私钥, 服务端公钥) = 共享密钥         │
  │ HKDF-SHA256(shared, salt=shared[:16],       │
  │            info="secure-pin-input/v1")      │
  │            => AES-256-GCM key               │
  │ 随机 12B IV，加密口令                        │
  │── POST /api/login { 临时公钥, iv, 密文, risk }▶│ 同样推导密钥 → GCM 解密
  │                                             │ 临时公钥指纹记入去重集合（防重放）
  │                                             │ 会话即焚
```

- **前向安全**：每次提交独立临时密钥，私钥 `non-extractable`，用后即弃。
- **一次一密**：随机 IV + 临时密钥，相同口令每次密文都不同。
- **防重放**：服务端对临时公钥指纹去重，且该检查先于会话查找，会话即焚后重放仍被 `409` 拒绝。
- **完整性**：GCM 认证标签，任何篡改都会在解密阶段抛错。

### 4.3 注入检测（`src/lib/integrity-monitor.mjs`）

1. **原生函数完整性**：检查 18 个敏感 API（`addEventListener`、`fetch`、`XHR`、
   canvas 读屏 API、`sendBeacon`、`WebSocket` 等）的 `toString()` 是否仍为 `[native code]`。
2. **跨 realm 反伪装**：木马可在主窗口伪造 `toString`，但隐藏 iframe 内有一套独立的原生
   `Function.prototype.toString`，跨 realm 调用即可识破伪造。
3. **DOM 监控**：`MutationObserver` 抓增量注入；`start()` 时再做一次存量扫描，
   覆盖"监控器启动前已注入"的情况。
4. **覆盖层检测**：`elementFromPoint` 扫描键盘四角，发现透明浮层拦截即告警。
5. **蜜罐**：诱饵 `<input name="password">` 的 `value` 被装上访问陷阱，木马一读取就留痕。
6. 风险报告打分（safe / warn / danger），随密文一起上报；danger 时弹确认并由服务端留存。

### 4.4 防截屏遮罩

`pointerdown` 时整板绘制密码学随机噪点（按 canvas **物理像素**分块填充，
规避 `getRandomValues` 单次 65536 字节上限，并强制 alpha=255 完全不透明），
持续到 `pointerup`。切后台（`visibilitychange`）则直接清空画布。

---

## 5. 测试结果

`npm run smoke`（加密协议，6/6）：

- 正常流程服务端可还原口令并校验、响应不含明文
- 错误口令识别、同口令两次密文不同、重放 `409`、篡改 GCM 失败、伪造会话 `404`

`npm run e2e`（真实 Chromium，20/20）：木马 0 按键记录、只读到蜜罐、
坐标无法还原、网络只见密文、同步读屏 80%+ 为噪点、API hook 与注入全部被检测、重放被拒。

生产构建确认：组件内的测试钩子 `window.__SPO_DEBUG_LAYOUT__` 仅在 `import.meta.env.DEV`
下存在，`vite build` 后被摇树移除（生产包中该名称 0 处写入）。

---

## 6. 能力边界（务必知悉）

本组件抬高了浏览器内窃密的门槛，但**没有、也不可能**提供绝对安全：

- **操作系统级木马 / 硬件键盘记录器 / 全屏截屏**不受浏览器 JS 防御约束。
  组件的价值是让浏览器内脚本报、自动化窃密失效，并让 OS 级截屏只能拍到噪点帧。
- 跨 realm 检测依赖同源 iframe 未被更底层手段篡改；对抗高级持续威胁需结合 CSP、
  SRI、子资源隔离、可信执行环境与服务端风控。
- 真实生产中会话服务应支持密钥轮换、会话持久化（Redis）、速率限制与审计，
  本演示为单进程内存实现。
- 风控不能只靠前端报告：`risk` 字段可被高级攻击者伪造，服务端应作为多信号之一。
- 软键盘不能替代服务端哈希存储、传输层 TLS 与常规口令策略；它是纵深防御的一层。
