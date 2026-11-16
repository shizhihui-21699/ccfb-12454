import { defineStore } from 'pinia'
import { ref } from 'vue'
import { ElMessage } from 'element-plus'
import { api } from '../api/client'
import { parseCsv } from '../utils/format'
import type {
  AppStatus,
  AppSummary,
  AuditEntry,
  DashboardStats,
  GrantRecord,
  ImportResult,
  RevokeItem,
  RevokeResponse
} from '../shared/types'

export const useGovernanceStore = defineStore('governance', () => {
  const apps = ref<AppSummary[]>([])
  const grants = ref<GrantRecord[]>([])
  const stats = ref<DashboardStats | null>(null)
  const audit = ref<AuditEntry[]>([])
  const loading = ref(false)

  async function loadAll() {
    loading.value = true
    try {
      const [state, appList, statsData, auditData] = await Promise.all([
        api.getState(),
        api.getApps(),
        api.getStats(),
        api.getAudit()
      ])
      grants.value = state.grants
      apps.value = appList
      stats.value = statsData
      audit.value = auditData
    } finally {
      loading.value = false
    }
  }

  async function changeStatus(appId: string, status: AppStatus, reason?: string) {
    await api.setAppStatus(appId, status, reason)
    ElMessage.success(`治理状态已更新为「${status === 'approved' ? '已批准' : status === 'disabled' ? '已禁用' : '待评估'}」`)
    await loadAll()
  }

  async function batchRevoke(items: RevokeItem[]): Promise<RevokeResponse> {
    const result = await api.revoke(items)
    if (result.failed > 0) {
      ElMessage.warning(`撤销完成：成功 ${result.revoked}，跳过 ${result.skipped}，失败 ${result.failed}`)
    } else {
      ElMessage.success(`已撤销 ${result.revoked} 条授权${result.skipped ? `，跳过 ${result.skipped} 条` : ''}`)
    }
    await loadAll()
    return result
  }

  /** 解析导入文件内容为记录数组（服务端还会做一次校验与归一化） */
  function parseFile(fileName: string, text: string): unknown[] {
    const lower = fileName.toLowerCase()
    if (lower.endsWith('.csv')) {
      return parseCsv(text).map((row) => ({
        ...row,
        publisherVerified: row.publisherVerified === 'true',
        scopes: row.scopes ? row.scopes.split(/[;,]/).map((s) => s.trim()).filter(Boolean) : []
      }))
    }
    const json = JSON.parse(text)
    if (Array.isArray(json)) return json
    if (Array.isArray(json.records)) return json.records
    if (Array.isArray(json.grants)) return json.grants
    throw new Error('JSON 结构无法识别：应为数组，或包含 records / grants 数组')
  }

  async function importRecords(records: unknown[]): Promise<ImportResult> {
    const result = await api.importGrants(records)
    ElMessage.success(`导入完成：新增 ${result.inserted}，更新 ${result.updated}，跳过 ${result.skipped}`)
    await loadAll()
    return result
  }

  async function resetEnvironment() {
    await api.reset()
    ElMessage.success('模拟环境已重置为初始种子数据')
    await loadAll()
  }

  return {
    api,
    apps,
    grants,
    stats,
    audit,
    loading,
    loadAll,
    changeStatus,
    batchRevoke,
    parseFile,
    importRecords,
    resetEnvironment
  }
})
