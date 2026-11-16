// 前后端共享的领域类型定义

/** 权限影响的数据域 */
export type ScopeDomain =
  | 'mail' // 邮件
  | 'drive' // 网盘 / 文件
  | 'contact' // 通讯录
  | 'calendar' // 日历
  | 'im' // 即时消息
  | 'admin' // 租户管理
  | 'account' // 基础身份（openid/profile 等）
  | 'offline' // 离线访问（refresh token）
  | 'other'

/** 权限严重级别 */
export type ScopeSeverity = 'critical' | 'high' | 'medium' | 'low' | 'unknown'

/** 应用治理状态 */
export type AppStatus = 'approved' | 'pending' | 'disabled'

/** 应用风险分级 */
export type RiskLevel = 'high' | 'medium' | 'low'

export interface ScopeMeta {
  scope: string
  name: string
  domain: ScopeDomain
  severity: ScopeSeverity
  description: string
}

/** 办公套件导出的单条 OAuth 授权记录 */
export interface GrantRecord {
  id: string
  userId: string
  userName: string
  department: string
  email: string
  appId: string
  appName: string
  publisher: string
  publisherVerified: boolean
  scopes: string[]
  grantedAt: string // ISO 时间
  lastUsedAt: string | null
}

/** 按应用汇总后的视图 */
export interface AppSummary {
  appId: string
  appName: string
  publisher: string
  publisherVerified: boolean
  status: AppStatus
  riskLevel: RiskLevel
  riskScore: number
  userCount: number
  scopeCount: number
  highRiskUserCount: number
  scopes: AppScopeStat[]
  domains: ScopeDomain[]
  departments: { name: string; count: number }[]
  firstGrantedAt: string
  lastUsedAt: string | null
}

export interface AppScopeStat {
  scope: string
  name: string
  domain: ScopeDomain
  severity: ScopeSeverity
  description: string
  userCount: number
}

export interface AppDetail extends AppSummary {
  grants: GrantRecord[]
}

export type AuditAction =
  | 'import'
  | 'approve'
  | 'request_review'
  | 'disable'
  | 'revoke'
  | 'reset'

export interface AuditEntry {
  id: string
  time: string
  action: AuditAction
  operator: string
  target: string
  detail: string
  result: 'success' | 'partial' | 'failed'
}

export interface DashboardStats {
  totalApps: number
  totalGrants: number
  totalUsers: number
  highRiskApps: number
  pendingApps: number
  disabledApps: number
  criticalScopeGrants: number
  statusDist: { name: string; value: number }[]
  riskDist: { name: string; value: number }[]
  topExposedApps: { appName: string; userCount: number; riskLevel: RiskLevel }[]
  domainExposure: { domain: string; domainName: string; apps: number; users: number }[]
}

export interface ImportResult {
  totalRows: number
  inserted: number
  updated: number
  skipped: number
  errors: { row: number; reason: string }[]
}

export interface RevokeItem {
  grantId: string
  userId: string
  appId: string
  scope?: string
}

export interface RevokeResultItem {
  grantId: string
  userId: string
  appId: string
  scope?: string
  status: 'revoked' | 'skipped' | 'failed'
  reason?: string
}

export interface RevokeResponse {
  requested: number
  revoked: number
  skipped: number
  failed: number
  results: RevokeResultItem[]
}
