import type {
  AppScopeStat,
  AppStatus,
  AppSummary,
  GrantRecord,
  RiskLevel,
  ScopeDomain,
  ScopeMeta,
  ScopeSeverity
} from './types'

/**
 * 风险分级口径（治理团队自定义，可在前端"分级口径"页面查看完整说明）
 *
 * 一、权限（scope）级别
 *   critical 严重：*.full 完全委托、租户管理类 scope
 *   high     高危：邮件 / 网盘 / 通讯录 的读取、写入、代发信
 *   medium   中危：日历、IM、离线访问（refresh token）、审计读取
 *   low      低危：openid / profile / email 等基础身份
 *   unknown  未识别：字典外 scope，关键字兜底，默认按低风险计分并提示人工确认
 *
 * 二、应用级别（按去重后的 scope 计分，不因授权人数重复累计）
 *   critical=40 分，high=20 分，medium=8 分，low/unknown=1 分
 *   发布方未验证额外 +10 分
 *   >=40 高危应用；15~39 中危应用；<15 低危应用
 */

export const SEVERITY_SCORE: Record<ScopeSeverity, number> = {
  critical: 40,
  high: 20,
  medium: 8,
  low: 1,
  unknown: 1
}

export const SEVERITY_LABEL: Record<ScopeSeverity, string> = {
  critical: '严重',
  high: '高危',
  medium: '中危',
  low: '低危',
  unknown: '未识别'
}

export const SEVERITY_TAG_TYPE: Record<ScopeSeverity, 'danger' | 'warning' | 'info' | 'success'> = {
  critical: 'danger',
  high: 'danger',
  medium: 'warning',
  low: 'info',
  unknown: 'info'
}

export const DOMAIN_LABEL: Record<ScopeDomain, string> = {
  mail: '邮件',
  drive: '网盘文件',
  contact: '通讯录',
  calendar: '日历',
  im: '即时消息',
  admin: '租户管理',
  account: '基础身份',
  offline: '离线访问',
  other: '其他'
}

export const STATUS_LABEL: Record<AppStatus, string> = {
  approved: '已批准',
  pending: '待评估',
  disabled: '已禁用'
}

export const STATUS_TAG_TYPE: Record<AppStatus, 'success' | 'warning' | 'info'> = {
  approved: 'success',
  pending: 'warning',
  disabled: 'info'
}

export const RISK_LABEL: Record<RiskLevel, string> = {
  high: '高危',
  medium: '中危',
  low: '低危'
}

export const RISK_TAG_TYPE: Record<RiskLevel, 'danger' | 'warning' | 'success'> = {
  high: 'danger',
  medium: 'warning',
  low: 'success'
}

/** 已知 scope 字典（覆盖办公套件常见 OAuth 权限） */
const SCOPE_DICTIONARY: Record<string, Omit<ScopeMeta, 'scope'>> = {
  // ---- 邮件 ----
  'mail.full': {
    name: '邮箱完全访问',
    domain: 'mail',
    severity: 'critical',
    description: '完全访问邮箱，包括邮件收发、删除、规则与委托设置（等同于账号密码）'
  },
  'mail.readwrite': {
    name: '邮件读写',
    domain: 'mail',
    severity: 'high',
    description: '读取全部邮件内容，并可新建、修改、删除邮件'
  },
  'mail.read': {
    name: '邮件读取',
    domain: 'mail',
    severity: 'high',
    description: '读取邮箱内全部邮件内容，可能泄露敏感往来信息'
  },
  'mail.send': {
    name: '邮件代发',
    domain: 'mail',
    severity: 'high',
    description: '以用户身份发送邮件，可被用于钓鱼与内部欺诈'
  },
  'mail.metadata': {
    name: '邮件元数据',
    domain: 'mail',
    severity: 'medium',
    description: '读取邮件主题、发件人、时间等元数据，不读取正文'
  },
  'mail.labels': {
    name: '邮件标签管理',
    domain: 'mail',
    severity: 'low',
    description: '管理邮件分类标签，不接触邮件内容'
  },
  // ---- 网盘 / 文件 ----
  'drive.full': {
    name: '网盘完全访问',
    domain: 'drive',
    severity: 'critical',
    description: '完全访问整个网盘，包括共享盘、权限管理与文件永久删除'
  },
  'drive.readwrite': {
    name: '网盘文件读写',
    domain: 'drive',
    severity: 'high',
    description: '读取、上传、修改、删除网盘中的全部文件'
  },
  'drive.read': {
    name: '网盘文件读取',
    domain: 'drive',
    severity: 'high',
    description: '读取网盘中的全部文件，可批量外泄文档与机密资料'
  },
  'drive.file': {
    name: '单文件访问',
    domain: 'drive',
    severity: 'medium',
    description: '仅访问用户在应用中主动打开或创建的文件，范围受限'
  },
  'drive.metadata': {
    name: '文件元数据',
    domain: 'drive',
    severity: 'low',
    description: '读取文件名、路径、修改时间等元数据，不读取内容'
  },
  // ---- 通讯录 ----
  'contacts.full': {
    name: '全租户通讯录管理',
    domain: 'contact',
    severity: 'critical',
    description: '管理整个组织的通讯录与目录，可读取全员 PII 并修改目录结构'
  },
  'contacts.readwrite': {
    name: '通讯录读写',
    domain: 'contact',
    severity: 'high',
    description: '读取并修改联系人信息，可被用于篡改联系人实施诈骗'
  },
  'contacts.read': {
    name: '通讯录读取',
    domain: 'contact',
    severity: 'high',
    description: '读取全组织通讯录，暴露员工姓名、邮箱、电话、汇报关系'
  },
  // ---- 日历 ----
  'calendar.readwrite': {
    name: '日历读写',
    domain: 'calendar',
    severity: 'medium',
    description: '读取日程详情并可创建、修改、删除会议'
  },
  'calendar.read': {
    name: '日历读取',
    domain: 'calendar',
    severity: 'medium',
    description: '读取日程安排、与会人与会议地点'
  },
  // ---- 即时消息 ----
  'im.chat.readwrite': {
    name: '消息读写',
    domain: 'im',
    severity: 'medium',
    description: '读取聊天记录并可发送、修改消息'
  },
  'im.chat.read': {
    name: '消息读取',
    domain: 'im',
    severity: 'medium',
    description: '读取即时消息聊天记录'
  },
  'im.chat.send': {
    name: '消息代发',
    domain: 'im',
    severity: 'medium',
    description: '以用户身份发送即时消息'
  },
  // ---- 租户管理 ----
  'admin.tenant.full': {
    name: '租户完全管理',
    domain: 'admin',
    severity: 'critical',
    description: '租户级管理权限，可管理用户、应用与安全策略'
  },
  'admin.users.read': {
    name: '全员账号信息读取',
    domain: 'admin',
    severity: 'critical',
    description: '读取全租户账号、账号状态与安全信息'
  },
  'admin.audit.read': {
    name: '审计日志读取',
    domain: 'admin',
    severity: 'medium',
    description: '读取租户审计日志，可用于探测防御薄弱点'
  },
  // ---- 基础身份 ----
  openid: {
    name: '身份标识',
    domain: 'account',
    severity: 'low',
    description: '获取用户唯一标识（openid），用于登录'
  },
  profile: {
    name: '基础资料',
    domain: 'account',
    severity: 'low',
    description: '读取昵称、头像等基础资料'
  },
  email: {
    name: '邮箱地址',
    domain: 'account',
    severity: 'low',
    description: '读取用户邮箱地址'
  },
  'user.read': {
    name: '基础账号信息',
    domain: 'account',
    severity: 'low',
    description: '读取当前登录用户的基础账号信息'
  },
  // ---- 离线访问 ----
  offline_access: {
    name: '离线访问',
    domain: 'offline',
    severity: 'medium',
    description: '申请 refresh token，用户离线后应用仍可长期访问，扩大了令牌失窃风险'
  }
}

/** 字典外 scope 的关键字兜底规则 */
function classifyUnknown(scope: string): Omit<ScopeMeta, 'scope'> {
  const s = scope.toLowerCase()
  const domain = detectDomain(s)
  if (/(^|[._-])(full|admin|manage|management)([._-]|$)/.test(s)) {
    return {
      name: scope,
      domain: domain === 'other' ? 'admin' : domain,
      severity: 'high',
      description: '未在字典中的管理/完全控制类权限，按高危兜底，建议人工确认'
    }
  }
  if (domain !== 'other' && /(read|write|send|rw)/.test(s)) {
    return {
      name: scope,
      domain,
      severity: 'high',
      description: '未在字典中但涉及敏感数据域读写的权限，按高危兜底，建议人工确认'
    }
  }
  if (/read|write|send/.test(s)) {
    return {
      name: scope,
      domain,
      severity: 'medium',
      description: '未在字典中的读写类权限，按中危兜底，建议人工确认'
    }
  }
  return {
    name: scope,
    domain,
    severity: 'unknown',
    description: '未识别的 scope，字典与关键字规则均未命中，按低风险兜底，需人工确认'
  }
}

function detectDomain(s: string): ScopeDomain {
  if (s.includes('mail') || s.includes('gmail')) return 'mail'
  if (s.includes('drive') || s.includes('file') || s.includes('doc')) return 'drive'
  if (s.includes('contact') || s.includes('directory') || s.includes('people')) return 'contact'
  if (s.includes('calendar') || s.includes('event')) return 'calendar'
  if (s.includes('im') || s.includes('chat') || s.includes('message')) return 'im'
  if (s.includes('admin') || s.includes('tenant')) return 'admin'
  if (s.includes('offline') || s.includes('refresh')) return 'offline'
  if (s.includes('openid') || s.includes('profile') || s.includes('user')) return 'account'
  return 'other'
}

export function getScopeMeta(scope: string): ScopeMeta {
  const hit = SCOPE_DICTIONARY[scope]
  if (hit) return { scope, ...hit }
  return { scope, ...classifyUnknown(scope) }
}

/** 邮件 / 网盘 / 通讯录的严重或高危权限 —— 治理重点标记对象 */
export function isSensitiveDataScope(meta: ScopeMeta): boolean {
  return (
    (meta.domain === 'mail' || meta.domain === 'drive' || meta.domain === 'contact') &&
    (meta.severity === 'critical' || meta.severity === 'high')
  )
}

export function isHighSeverity(severity: ScopeSeverity): boolean {
  return severity === 'critical' || severity === 'high'
}

function computeRiskScore(uniqueScopes: string[], publisherVerified: boolean): number {
  const score = uniqueScopes.reduce((sum, scope) => {
    return sum + SEVERITY_SCORE[getScopeMeta(scope).severity]
  }, 0)
  return score + (publisherVerified ? 0 : 10)
}

export function riskLevelFromScore(score: number): RiskLevel {
  if (score >= 40) return 'high'
  if (score >= 15) return 'medium'
  return 'low'
}

interface AggregationInput {
  grants: GrantRecord[]
  statusByApp: Map<string, AppStatus>
}

/** 将授权明细按应用汇总 */
export function aggregateApps({ grants, statusByApp }: AggregationInput): AppSummary[] {
  const byApp = new Map<string, GrantRecord[]>()
  for (const g of grants) {
    const list = byApp.get(g.appId) ?? []
    list.push(g)
    byApp.set(g.appId, list)
  }

  const summaries: AppSummary[] = []
  for (const [appId, list] of byApp) {
    const first = list[0]
    const userSet = new Set(list.map((g) => g.userId))
    const scopeUsers = new Map<string, Set<string>>()
    const allScopes = new Set<string>()
    const domainSet = new Set<ScopeDomain>()
    const deptCount = new Map<string, number>()
    let lastUsedAt: string | null = null
    let firstGrantedAt = list[0].grantedAt

    for (const g of list) {
      if (g.grantedAt < firstGrantedAt) firstGrantedAt = g.grantedAt
      if (g.lastUsedAt && (!lastUsedAt || g.lastUsedAt > lastUsedAt)) lastUsedAt = g.lastUsedAt
      deptCount.set(g.department, (deptCount.get(g.department) ?? 0) + 1)
      for (const scope of g.scopes) {
        allScopes.add(scope)
        domainSet.add(getScopeMeta(scope).domain)
        const users = scopeUsers.get(scope) ?? new Set<string>()
        users.add(g.userId)
        scopeUsers.set(scope, users)
      }
    }

    const uniqueScopes = [...allScopes]
    const riskScore = computeRiskScore(uniqueScopes, first.publisherVerified)
    const riskLevel = riskLevelFromScore(riskScore)

    const scopes: AppScopeStat[] = uniqueScopes
      .map((scope) => {
        const meta = getScopeMeta(scope)
        return { ...meta, userCount: scopeUsers.get(scope)?.size ?? 0 }
      })
      .sort((a, b) => SEVERITY_SCORE[b.severity] - SEVERITY_SCORE[a.severity])

    const highRiskUserCount = countHighRiskUsers(list)

    summaries.push({
      appId,
      appName: first.appName,
      publisher: first.publisher,
      publisherVerified: first.publisherVerified,
      status: statusByApp.get(appId) ?? 'pending',
      riskLevel,
      riskScore,
      userCount: userSet.size,
      scopeCount: uniqueScopes.length,
      highRiskUserCount,
      scopes,
      domains: [...domainSet],
      departments: [...deptCount.entries()]
        .map(([name, count]) => ({ name, count }))
        .sort((a, b) => b.count - a.count),
      firstGrantedAt,
      lastUsedAt
    })
  }

  return summaries.sort((a, b) => b.riskScore - a.riskScore || b.userCount - a.userCount)
}

/** 持有任一高危/严重 scope 授权的用户数 */
export function countHighRiskUsers(grants: GrantRecord[]): number {
  const users = new Set<string>()
  for (const g of grants) {
    if (g.scopes.some((s) => isHighSeverity(getScopeMeta(s).severity))) users.add(g.userId)
  }
  return users.size
}

export function countCriticalScopeGrants(grants: GrantRecord[]): number {
  return grants.filter((g) =>
    g.scopes.some((s) => getScopeMeta(s).severity === 'critical')
  ).length
}
