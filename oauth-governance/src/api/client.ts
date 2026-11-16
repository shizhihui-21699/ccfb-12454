import type {
  AppDetail,
  AppStatus,
  AuditEntry,
  DashboardStats,
  GrantRecord,
  ImportResult,
  RevokeItem,
  RevokeResponse,
  AppSummary
} from '../shared/types'

async function request<T>(url: string, options?: RequestInit): Promise<T> {
  const res = await fetch(url, {
    headers: { 'Content-Type': 'application/json' },
    ...options
  })
  const data = await res.json().catch(() => ({}))
  if (!res.ok) {
    throw new Error((data as { message?: string }).message ?? `请求失败（${res.status}）`)
  }
  return data as T
}

export const api = {
  getState: () =>
    request<{ grants: GrantRecord[]; statusByApp: Record<string, AppStatus> }>('/api/state'),

  getApps: () => request<AppSummary[]>('/api/apps'),

  getAppDetail: (appId: string) => request<AppDetail>(`/api/apps/${encodeURIComponent(appId)}`),

  setAppStatus: (appId: string, status: AppStatus, reason?: string) =>
    request<{ appId: string; status: AppStatus }>(`/api/apps/${encodeURIComponent(appId)}/status`, {
      method: 'POST',
      body: JSON.stringify({ status, reason })
    }),

  importGrants: (records: unknown[]) =>
    request<ImportResult>('/api/grants/import', {
      method: 'POST',
      body: JSON.stringify({ records })
    }),

  revoke: (items: RevokeItem[]) =>
    request<RevokeResponse>('/api/revoke', {
      method: 'POST',
      body: JSON.stringify({ items })
    }),

  getAudit: () => request<AuditEntry[]>('/api/audit'),

  getStats: () => request<DashboardStats>('/api/stats'),

  reset: () => request<{ ok: boolean; grants: number }>('/api/reset', { method: 'POST' })
}
