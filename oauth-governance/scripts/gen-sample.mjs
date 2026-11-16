// 样本数据生成器（确定性，固定种子可重复生成）
// 运行：node scripts/gen-sample.mjs
// 产物：
//   server/seed.json                     模拟管理接口启动种子
//   public/sample/oauth-grants.json      可下载/导入的 JSON 样本
//   public/sample/oauth-grants.csv       可下载/导入的 CSV 样本
import { writeFileSync, mkdirSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = dirname(fileURLToPath(import.meta.url))
const root = resolve(__dirname, '..')

// ---------- 确定性随机 ----------
function mulberry32(seed) {
  let a = seed >>> 0
  return function () {
    a |= 0
    a = (a + 0x6d2b79f5) | 0
    let t = Math.imul(a ^ (a >>> 15), 1 | a)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}
const rand = mulberry32(20261117)
const pick = (arr) => arr[Math.floor(rand() * arr.length)]
const intBetween = (min, max) => min + Math.floor(rand() * (max - min + 1))

// ---------- 120 名虚构员工 ----------
const surnames = [
  ['张', 'zhang'], ['王', 'wang'], ['李', 'li'], ['赵', 'zhao'], ['刘', 'liu'],
  ['陈', 'chen'], ['杨', 'yang'], ['黄', 'huang'], ['周', 'zhou'], ['吴', 'wu'],
  ['徐', 'xu'], ['孙', 'sun'], ['马', 'ma'], ['朱', 'zhu'], ['胡', 'hu'],
  ['郭', 'guo'], ['何', 'he'], ['林', 'lin'], ['罗', 'luo'], ['郑', 'zheng']
]
const givenNames = [
  ['伟', 'wei'], ['芳', 'fang'], ['娜', 'na'], ['敏', 'min'], ['静', 'jing'],
  ['磊', 'lei'], ['强', 'qiang'], ['洋', 'yang'], ['艳', 'yan'], ['杰', 'jie'],
  ['涛', 'tao'], ['明', 'ming'], ['超', 'chao'], ['秀英', 'xiuying'], ['霞', 'xia'],
  ['平', 'ping'], ['刚', 'gang'], ['桂英', 'guiying'], ['文', 'wen'], ['华', 'hua'],
  ['建华', 'jianhua'], ['晓峰', 'xiaofeng'], ['雪', 'xue'], ['雨桐', 'yutong'], ['子轩', 'zixuan'],
  ['思远', 'siyuan'], ['嘉怡', 'jiayi'], ['浩然', 'haoran'], ['欣怡', 'xinyi'], ['宇航', 'yuhang']
]
const departments = [
  '研发部', '产品部', '市场部', '销售部', '人力资源部',
  '财务部', '行政部', '法务部', '客户成功部', '信息技术部'
]

const users = []
const usedEmails = new Set()
for (let i = 1; i <= 120; i++) {
  const [surCn, surPy] = pick(surnames)
  const [givCn, givPy] = pick(givenNames)
  const userName = surCn + givCn
  let email = `${givPy}.${surPy}@acme-demo.com`
  let n = 2
  while (usedEmails.has(email)) email = `${givPy}.${surPy}${n++}@acme-demo.com`
  usedEmails.add(email)
  users.push({
    userId: `u${String(i).padStart(4, '0')}`,
    userName,
    department: departments[i % departments.length],
    email
  })
}

// ---------- 20 个虚构第三方应用模板 ----------
// scopes 中 optional 的条目在生成授权时有概率不被该用户授予
const appTemplates = [
  {
    appId: 'app_mailtrack', appName: '迅捷邮件追踪', publisher: 'MailTrack Inc.',
    verified: false, weight: 85,
    scopes: ['mail.read', 'mail.metadata', 'offline_access', 'email']
  },
  {
    appId: 'app_drivesync', appName: '云盘万能同步', publisher: 'DriveSync Hub Ltd.',
    verified: true, weight: 40,
    scopes: ['drive.full', 'drive.readwrite', 'offline_access', 'profile']
  },
  {
    appId: 'app_salesboost', appName: 'CRM 客户管家', publisher: 'SalesBoost Technology',
    verified: false, weight: 30,
    scopes: ['contacts.read', 'mail.read', 'mail.send', 'offline_access', 'openid']
  },
  {
    appId: 'app_calendarmate', appName: '日程巧管家', publisher: 'CalendarMate Software',
    verified: true, weight: 55,
    scopes: ['calendar.readwrite', 'calendar.read', 'openid', 'profile']
  },
  {
    appId: 'app_chatarchive', appName: '团队聊天归档', publisher: 'Archie Labs',
    verified: false, weight: 25,
    scopes: ['im.chat.read', 'im.chat.send', 'offline_access', 'profile']
  },
  {
    appId: 'app_loginpass', appName: '身份直通登录', publisher: 'LoginPass SSO Corp.',
    verified: true, weight: 120,
    scopes: ['openid', 'profile', 'email']
  },
  {
    appId: 'app_sheetinsight', appName: '表格智能分析', publisher: 'SheetInsight BI',
    verified: true, weight: 45,
    scopes: ['drive.read', 'drive.metadata', 'offline_access', 'user.read']
  },
  {
    appId: 'app_hireradar', appName: '招聘人才雷达', publisher: 'HireRadar Analytics',
    verified: false, weight: 6,
    scopes: ['contacts.full', 'admin.users.read', 'mail.read', 'offline_access']
  },
  {
    appId: 'app_signflow', appName: '文档电子签', publisher: 'SignFlow Legal Tech',
    verified: true, weight: 35,
    scopes: ['drive.file', 'drive.readwrite', 'profile', 'email']
  },
  {
    appId: 'app_mailblast', appName: '邮件群发营销', publisher: 'BlastMail Global',
    verified: false, weight: 18,
    scopes: ['mail.send', 'mail.read', 'contacts.read', 'offline_access']
  },
  {
    appId: 'app_backupguard', appName: '网盘备份卫士', publisher: 'BackupGuard Security',
    verified: true, weight: 28,
    scopes: ['drive.readwrite', 'drive.read', 'offline_access', 'profile']
  },
  {
    appId: 'app_contactcleaner', appName: '通讯录清洗工具', publisher: 'CleanData Studio',
    verified: false, weight: 12,
    scopes: ['contacts.readwrite', 'contacts.read', 'offline_access']
  },
  {
    appId: 'app_meetnotes', appName: '会议纪要机器人', publisher: 'MeetNotes AI',
    verified: true, weight: 22,
    scopes: ['calendar.read', 'im.chat.read', 'drive.file', 'openid']
  },
  {
    appId: 'app_devtest', appName: '外包开发测试应用', publisher: '个人开发者 (未上架)',
    verified: false, weight: 3,
    scopes: ['admin.tenant.full', 'admin.users.read', 'mail.full', 'offline_access']
  },
  {
    appId: 'app_invoiceocr', appName: '报销发票识别', publisher: 'InvoiceOCR Tech',
    verified: true, weight: 33,
    scopes: ['drive.file', 'mail.read', 'openid', 'profile']
  },
  {
    appId: 'app_helpdesk', appName: '客户支持工单台', publisher: 'HelpDesk One Inc.',
    verified: false, weight: 20,
    scopes: ['mail.readwrite', 'im.chat.readwrite', 'contacts.read', 'offline_access']
  },
  {
    appId: 'app_taskboard', appName: '项目进度看板', publisher: 'TaskBoard Works',
    verified: true, weight: 60,
    scopes: ['openid', 'profile', 'calendar.read', 'email']
  },
  {
    appId: 'app_translatex', appName: '外贸翻译插件', publisher: 'TranslateX Browser',
    verified: false, weight: 15,
    scopes: ['mail.read', 'drive.read', 'profile']
  },
  {
    appId: 'app_linkmanager', appName: '网盘外链管家', publisher: 'LinkMaster Cloud',
    verified: true, weight: 14,
    scopes: ['drive.metadata', 'drive.read', 'user.read']
  },
  {
    appId: 'app_flowapproval', appName: '智能审批流', publisher: 'FlowApproval Solutions',
    verified: false, weight: 9,
    // 两个字典外 scope，用于演示未识别权限的兜底分级
    scopes: ['approval.workflow.readwrite', 'widget.dashboard', 'openid', 'profile']
  }
]

// ---------- 生成授权明细 ----------
const DAY = 24 * 60 * 60 * 1000
const now = Date.UTC(2026, 10, 17, 6, 0, 0) // 固定基准时间，保证可重复
function isoDaysAgo(days, jitterHours = 12) {
  const t = now - days * DAY - Math.floor(rand() * jitterHours * 3600 * 1000)
  return new Date(t).toISOString()
}

const grants = []
let grantSeq = 1
for (const tpl of appTemplates) {
  const count = Math.min(users.length, tpl.weight)
  // 洗牌取前 count 人
  const pool = [...users]
  for (let i = pool.length - 1; i > 0; i--) {
    const j = Math.floor(rand() * (i + 1))
    ;[pool[i], pool[j]] = [pool[j], pool[i]]
  }
  const chosen = pool.slice(0, count)

  for (const u of chosen) {
    // 个别用户只授予了部分 scope
    const scopes = tpl.scopes.filter((_, idx) => {
      if (idx < 2) return true // 前两个核心 scope 必有
      return rand() > 0.25
    })
    const grantedAt = isoDaysAgo(intBetween(5, 540))
    const lastUsedAt = rand() > 0.3 ? isoDaysAgo(intBetween(0, 120)) : null
    grants.push({
      id: `g${String(grantSeq++).padStart(5, '0')}`,
      userId: u.userId,
      userName: u.userName,
      department: u.department,
      email: u.email,
      appId: tpl.appId,
      appName: tpl.appName,
      publisher: tpl.publisher,
      publisherVerified: tpl.verified,
      scopes,
      grantedAt,
      lastUsedAt
    })
  }
}

// ---------- 初始治理状态：部分已批准 / 禁用，其余待评估 ----------
const initialStatus = {
  app_loginpass: 'approved',
  app_taskboard: 'approved',
  app_calendarmate: 'approved',
  app_signflow: 'approved',
  app_meetnotes: 'approved',
  app_devtest: 'disabled',
  app_hireradar: 'disabled'
}

const seed = {
  generatedAt: new Date(now).toISOString(),
  initialStatus,
  grants
}

// ---------- 写文件 ----------
mkdirSync(resolve(root, 'server'), { recursive: true })
mkdirSync(resolve(root, 'public/sample'), { recursive: true })
writeFileSync(resolve(root, 'server/seed.json'), JSON.stringify(seed, null, 2))
writeFileSync(resolve(root, 'public/sample/oauth-grants.json'), JSON.stringify(grants, null, 2))

function csvCell(v) {
  const s = String(v)
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s
}
const header = ['id', 'userId', 'userName', 'department', 'email', 'appId', 'appName', 'publisher', 'publisherVerified', 'scopes', 'grantedAt', 'lastUsedAt']
const lines = [header.join(',')]
for (const g of grants) {
  lines.push([
    g.id, g.userId, g.userName, g.department, g.email,
    g.appId, g.appName, g.publisher, String(g.publisherVerified),
    g.scopes.join(';'), g.grantedAt, g.lastUsedAt ?? ''
  ].map(csvCell).join(','))
}
writeFileSync(resolve(root, 'public/sample/oauth-grants.csv'), lines.join('\n'))

console.log(`生成完成：${grants.length} 条授权，${appTemplates.length} 个应用，${users.length} 名员工`)
