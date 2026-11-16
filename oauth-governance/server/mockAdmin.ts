// 本地模拟的办公套件管理接口（Vite dev-server 中间件，内存态）
// 提供：授权查询、应用治理状态变更、授权导入、批量撤销、审计日志、环境重置
import type { Connect, Plugin, ViteDevServer } from 'vite'
import type { ServerResponse } from 'node:http'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import {
  aggregateApps,
  countCriticalScopeGrants,
  getScopeMeta
} from '../src/shared/risk'
import type {
  AppStatus,
  AuditEntry,
  AuditAction,
  GrantRecord,
  ImportResult,
  RevokeItem,
  RevokeResponse,
  RevokeResultItem
} from '../src/shared/types'

interface SeedFile {
  generatedAt: string
  initialStatus: Record<string, AppStatus>
  grants: GrantRecord[]
}

interface ServerState {
  grants: GrantRecord[]
  statusByApp: Map<string, AppStatus>
  audit: AuditEntry[]
}

let state: ServerState | null = null
let seq = 0

function loadSeed(): ServerState {
  const raw = readFileSync(resolve(__dirname, 'seed.json'), 'utf-8')
  const seed = JSON.parse(raw) as SeedFile
  return {
    grants: structuredClone(seed.grants),
    statusByApp: new Map(Object.entries(seed.initialStatus)),
    audit: [
      {
        id: `a${String(++seq).padStart(5, '0')}`,
        time: new Date().toISOString(),
        action: 'reset',
        operator: 'system',
        target: '模拟管理接口',
        detail: `载入种子数据：${seed.grants.length} 条授权记录`,
        result: 'success'
      }
    ]
  }
}

function ensureState(): ServerState {
  if (!state) state = loadSeed()
  return state
}

function sendJson(res: ServerResponse, data: unknown, status = 200) {
  res.statusCode = status
  res.setHeader('Content-Type', 'application/json; charset=utf-8')
  res.end(JSON.stringify(data))
}

function readBody(req: Connect.IncomingMessage): Promise<string> {
  return new Promise((resolvePromise, reject) => {
    let body = ''
    req.on('data', (chunk) => {
      body += chunk
      if (body.length > 8 * 1024 * 1024) {
        reject(new Error('请求体超过 8MB 限制'))
        req.destroy()
      }
    })
    req.on('end', () => resolvePromise(body))
    req.on('error', reject)
  })
}

function addAudit(
  s: ServerState,
  action: AuditAction,
  target: string,
  detail: string,
  result: AuditEntry['result'] = 'success'
) {
  s.audit.unshift({
    id: `a${String(++seq).padStart(5, '0')}`,
    time: new Date().toISOString(),
    action,
    operator: '安全管理员',
    target,
    detail,
    result
  })
}

const VALID_STATUS: AppStatus[] = ['approved', 'pending', 'disabled']

function normalizeGrant(row: Record<string, unknown>, index: number): GrantRecord {
  const required = ['userId', 'userName', 'appId', 'appName', 'scopes']
  for (const key of required) {
    if (row[key] === undefined || row[key] === null || row[key] === '') {
      throw new Error(`第 ${index} 行缺少必填字段 ${key}`)
    }
  }
  const scopes = Array.isArray(row.scopes)
    ? (row.scopes as unknown[]).map(String)
    : String(row.scopes)
        .split(/[;,]/)
        .map((x) => x.trim())
        .filter(Boolean)
  if (scopes.length === 0) throw new Error(`第 ${index} 行 scopes 为空`)

  return {
    id: row.id ? String(row.id) : `imp_${Date.now()}_${index}`,
    userId: String(row.userId),
    userName: String(row.userName ?? row.userId),
    department: String(row.department ?? '未分配部门'),
    email: String(row.email ?? ''),
    appId: String(row.appId),
    appName: String(row.appName),
    publisher: String(row.publisher ?? '未知发布方'),
    publisherVerified:
      row.publisherVerified === true || String(row.publisherVerified).toLowerCase() === 'true',
    scopes,
    grantedAt: row.grantedAt ? String(row.grantedAt) : new Date().toISOString(),
    lastUsedAt: row.lastUsedAt ? String(row.lastUsedAt) : null
  }
}

function handleImport(s: ServerState, records: unknown[]): ImportResult {
  const result: ImportResult = { totalRows: records.length, inserted: 0, updated: 0, skipped: 0, errors: [] }
  const existing = new Map(s.grants.map((g) => [g.id, g]))
  const incoming = new Set<string>()

  records.forEach((raw, i) => {
    const rowNum = i + 1
    if (typeof raw !== 'object' || raw === null) {
      result.errors.push({ row: rowNum, reason: '记录不是对象' })
      result.skipped++
      return
    }
    try {
      const grant = normalizeGrant(raw as Record<string, unknown>, rowNum)
      if (incoming.has(grant.id)) {
        result.errors.push({ row: rowNum, reason: `导入文件内 id 重复：${grant.id}` })
        result.skipped++
        return
      }
      incoming.add(grant.id)
      if (existing.has(grant.id)) {
        const idx = s.grants.findIndex((g) => g.id === grant.id)
        s.grants[idx] = grant
        result.updated++
      } else {
        s.grants.push(grant)
        result.inserted++
      }
    } catch (err) {
      result.errors.push({ row: rowNum, reason: (err as Error).message })
      result.skipped++
    }
  })

  addAudit(
    s,
    'import',
    '授权记录导入',
    `共 ${result.totalRows} 行：新增 ${result.inserted}，更新 ${result.updated}，跳过 ${result.skipped}`,
    result.errors.length ? 'partial' : 'success'
  )
  return result
}

function handleRevoke(s: ServerState, items: RevokeItem[]): RevokeResponse {
  const results: RevokeResultItem[] = []
  let revoked = 0
  let skipped = 0
  let failed = 0

  for (const item of items) {
    const base: RevokeResultItem = {
      grantId: item.grantId,
      userId: item.userId,
      appId: item.appId,
      scope: item.scope,
      status: 'failed'
    }
    const grant = s.grants.find((g) => g.id === item.grantId)
    if (!grant) {
      base.reason = '授权记录不存在或已被撤销'
      failed++
      results.push(base)
      continue
    }
    if (s.statusByApp.get(item.appId) !== 'disabled') {
      base.status = 'skipped'
      base.reason = '应用未处于禁用状态，治理流程拒绝撤销（请先禁用应用）'
      skipped++
      results.push(base)
      continue
    }
    if (item.scope) {
      if (!grant.scopes.includes(item.scope)) {
        base.status = 'skipped'
        base.reason = '该授权不含指定 scope'
        skipped++
        results.push(base)
        continue
      }
      grant.scopes = grant.scopes.filter((x) => x !== item.scope)
      if (grant.scopes.length === 0) {
        s.grants = s.grants.filter((g) => g.id !== grant.id)
      }
      base.status = 'revoked'
      base.reason = `已撤销权限 ${item.scope}`
      revoked++
      results.push(base)
      continue
    }
    s.grants = s.grants.filter((g) => g.id !== grant.id)
    base.status = 'revoked'
    base.reason = '已撤销整条授权'
    revoked++
    results.push(base)
  }

  addAudit(
    s,
    'revoke',
    '批量撤销授权',
    `请求 ${items.length} 条：成功 ${revoked}，跳过 ${skipped}，失败 ${failed}`,
    failed ? (revoked ? 'partial' : 'failed') : 'success'
  )

  return { requested: items.length, revoked, skipped, failed, results }
}

export function mockAdminPlugin(): Plugin {
  return {
    name: 'mock-admin-api',
    configureServer(server: ViteDevServer) {
      server.middlewares.use('/api', async (req, res) => {
        const s = ensureState()
        const url = new URL(req.url ?? '/', 'http://localhost')
        const path = url.pathname
        const method = req.method ?? 'GET'

        // 模拟网络延迟
        await new Promise((r) => setTimeout(r, 120))

        try {
          // ---------- 全量状态 ----------
          if (method === 'GET' && path === '/state') {
            return sendJson(res, {
              grants: s.grants,
              statusByApp: Object.fromEntries(s.statusByApp),
              serverTime: new Date().toISOString()
            })
          }

          // ---------- 应用汇总列表 ----------
          if (method === 'GET' && path === '/apps') {
            const apps = aggregateApps({ grants: s.grants, statusByApp: s.statusByApp })
            return sendJson(res, apps)
          }

          // ---------- 应用详情 ----------
          const appMatch = path.match(/^\/apps\/([^/]+)$/)
          if (method === 'GET' && appMatch) {
            const appId = decodeURIComponent(appMatch[1])
            const grants = s.grants.filter((g) => g.appId === appId)
            if (grants.length === 0 && !s.statusByApp.has(appId)) {
              return sendJson(res, { message: '应用不存在' }, 404)
            }
            const [summary] = aggregateApps({
              grants: s.grants,
              statusByApp: s.statusByApp
            }).filter((a) => a.appId === appId)
            return sendJson(res, { ...(summary ?? { appId, status: s.statusByApp.get(appId) }), grants })
          }

          // ---------- 应用治理状态变更 ----------
          const statusMatch = path.match(/^\/apps\/([^/]+)\/status$/)
          if (method === 'POST' && statusMatch) {
            const appId = decodeURIComponent(statusMatch[1])
            const body = JSON.parse(await readBody(req)) as { status: AppStatus; reason?: string }
            if (!VALID_STATUS.includes(body.status)) {
              return sendJson(res, { message: `非法状态：${body.status}` }, 400)
            }
            const grants = s.grants.filter((g) => g.appId === appId)
            if (grants.length === 0) return sendJson(res, { message: '应用不存在' }, 404)
            const appName = grants[0].appName
            const before = s.statusByApp.get(appId) ?? 'pending'
            s.statusByApp.set(appId, body.status)
            addAudit(
              s,
              body.status === 'approved'
                ? 'approve'
                : body.status === 'disabled'
                  ? 'disable'
                  : 'request_review',
              appName,
              `状态 ${before} → ${body.status}${body.reason ? `；理由：${body.reason}` : ''}`
            )
            return sendJson(res, { appId, status: body.status })
          }

          // ---------- 授权导入 ----------
          if (method === 'POST' && path === '/grants/import') {
            const body = JSON.parse(await readBody(req)) as { records: unknown[] }
            if (!Array.isArray(body.records)) {
              return sendJson(res, { message: '请求体需要 { records: [...] }' }, 400)
            }
            return sendJson(res, handleImport(s, body.records))
          }

          // ---------- 批量撤销 ----------
          if (method === 'POST' && path === '/revoke') {
            const body = JSON.parse(await readBody(req)) as { items: RevokeItem[] }
            if (!Array.isArray(body.items)) {
              return sendJson(res, { message: '请求体需要 { items: [...] }' }, 400)
            }
            return sendJson(res, handleRevoke(s, body.items))
          }

          // ---------- 审计日志 ----------
          if (method === 'GET' && path === '/audit') {
            return sendJson(res, s.audit)
          }

          // ---------- 仪表盘统计 ----------
          if (method === 'GET' && path === '/stats') {
            const apps = aggregateApps({ grants: s.grants, statusByApp: s.statusByApp })
            const users = new Set(s.grants.map((g) => g.userId))
            const statusName: Record<AppStatus, string> = {
              approved: '已批准',
              pending: '待评估',
              disabled: '已禁用'
            }
            const domainName: Record<string, string> = {
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
            const domainMap = new Map<string, { apps: Set<string>; users: Set<string> }>()
            for (const g of s.grants) {
              for (const sc of g.scopes) {
                const d = getScopeMeta(sc).domain
                const entry = domainMap.get(d) ?? { apps: new Set(), users: new Set() }
                entry.apps.add(g.appId)
                entry.users.add(g.userId)
                domainMap.set(d, entry)
              }
            }
            return sendJson(res, {
              totalApps: apps.length,
              totalGrants: s.grants.length,
              totalUsers: users.size,
              highRiskApps: apps.filter((a) => a.riskLevel === 'high').length,
              pendingApps: apps.filter((a) => a.status === 'pending').length,
              disabledApps: apps.filter((a) => a.status === 'disabled').length,
              criticalScopeGrants: countCriticalScopeGrants(s.grants),
              statusDist: VALID_STATUS.map((st) => ({
                name: statusName[st],
                value: apps.filter((a) => a.status === st).length
              })),
              riskDist: [
                { name: '高危', value: apps.filter((a) => a.riskLevel === 'high').length },
                { name: '中危', value: apps.filter((a) => a.riskLevel === 'medium').length },
                { name: '低危', value: apps.filter((a) => a.riskLevel === 'low').length }
              ],
              topExposedApps: apps
                .slice()
                .sort((a, b) => b.userCount - a.userCount)
                .slice(0, 8)
                .map((a) => ({ appName: a.appName, userCount: a.userCount, riskLevel: a.riskLevel })),
              domainExposure: [...domainMap.entries()].map(([domain, v]) => ({
                domain,
                domainName: domainName[domain] ?? domain,
                apps: v.apps.size,
                users: v.users.size
              }))
            })
          }

          // ---------- 重置环境 ----------
          if (method === 'POST' && path === '/reset') {
            state = loadSeed()
            return sendJson(res, { ok: true, grants: state.grants.length })
          }

          return sendJson(res, { message: `未找到接口：${method} ${path}` }, 404)
        } catch (err) {
          return sendJson(res, { message: (err as Error).message }, 500)
        }
      })
    }
  }
}
