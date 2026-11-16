<script setup lang="ts">
import { computed, ref } from 'vue'
import { useRouter } from 'vue-router'
import { ElMessageBox } from 'element-plus'
import { useGovernanceStore } from '../stores/governance'
import {
  DOMAIN_LABEL,
  STATUS_LABEL,
  STATUS_TAG_TYPE
} from '../shared/risk'
import { daysAgo } from '../utils/format'
import type { AppStatus, AppSummary, RevokeItem } from '../shared/types'
import RiskBadge from '../components/RiskBadge.vue'
import ScopeTag from '../components/ScopeTag.vue'

const router = useRouter()
const store = useGovernanceStore()

const keyword = ref('')
const statusFilter = ref<AppStatus | 'all'>('all')
const riskFilter = ref<string>('all')
const sensitiveOnly = ref(false)

const filteredApps = computed(() => {
  const kw = keyword.value.trim().toLowerCase()
  return store.apps.filter((a) => {
    if (statusFilter.value !== 'all' && a.status !== statusFilter.value) return false
    if (riskFilter.value !== 'all' && a.riskLevel !== riskFilter.value) return false
    if (sensitiveOnly.value && !a.scopes.some((s) => s.severity === 'critical' || s.severity === 'high')) {
      return false
    }
    if (kw && !`${a.appName}${a.publisher}${a.appId}`.toLowerCase().includes(kw)) return false
    return true
  })
})

async function onStatusChange(app: AppSummary, status: AppStatus) {
  let reason: string | undefined
  if (status === 'disabled') {
    try {
      const { value } = await ElMessageBox.prompt(`禁用「${app.appName}」后，可在详情页批量撤销其全部授权。请填写禁用理由：`, '禁用应用', {
        confirmButtonText: '确认禁用',
        cancelButtonText: '取消',
        inputType: 'textarea',
        inputPlaceholder: '例如：存在未验证发布方 + 邮件全量读取，超出业务需要',
        inputValidator: (v) => (v && v.trim() ? true : '请填写禁用理由')
      })
      reason = value
    } catch {
      return
    }
  }
  await store.changeStatus(app.appId, status, reason)
}

async function quickRevokeAll(app: AppSummary) {
  try {
    await ElMessageBox.confirm(
      `将对「${app.appName}」的全部 ${app.userCount} 名用户授权执行批量撤销（调用本地模拟管理接口），是否继续？`,
      '批量撤销确认',
      { type: 'warning', confirmButtonText: '确认撤销', cancelButtonText: '取消' }
    )
  } catch {
    return
  }
  const detail = await store.api.getAppDetail(app.appId)
  const items: RevokeItem[] = detail.grants.map((g) => ({
    grantId: g.id,
    userId: g.userId,
    appId: g.appId
  }))
  const result = await store.batchRevoke(items)
  ElMessageBox.alert(
    `请求 ${result.requested} 条，成功撤销 ${result.revoked} 条，跳过 ${result.skipped} 条，失败 ${result.failed} 条。`,
    '批量撤销结果',
    { confirmButtonText: '知道了' }
  )
}

function onStatusCommand(app: AppSummary, cmd: AppStatus) {
  onStatusChange(app, cmd)
}
</script>

<template>
  <div class="page-container">
    <h2 class="page-title">应用治理</h2>
    <p class="page-subtitle">
      按应用汇总授权人数与权限范围；⚠ 标记表示涉及邮件 / 网盘文件 / 通讯录的高危或严重权限。禁用应用后可批量撤销授权。
    </p>

    <div class="card filter-bar" style="margin-bottom: 14px">
      <el-input v-model="keyword" placeholder="搜索应用名 / 发布方 / AppID" clearable style="width: 260px" />
      <el-select v-model="statusFilter" style="width: 130px">
        <el-option label="全部状态" value="all" />
        <el-option v-for="(label, key) in STATUS_LABEL" :key="key" :label="label" :value="key" />
      </el-select>
      <el-select v-model="riskFilter" style="width: 130px">
        <el-option label="全部风险" value="all" />
        <el-option label="高危" value="high" />
        <el-option label="中危" value="medium" />
        <el-option label="低危" value="low" />
      </el-select>
      <el-checkbox v-model="sensitiveOnly">仅看含高危/严重权限</el-checkbox>
      <div style="flex: 1"></div>
      <el-tag type="info" effect="plain">共 {{ filteredApps.length }} / {{ store.apps.length }} 个应用</el-tag>
    </div>

    <div class="card" style="padding: 0; overflow: hidden">
      <el-table :data="filteredApps" row-key="appId" style="width: 100%">
        <el-table-column label="应用" min-width="210">
          <template #default="{ row }">
            <div class="app-cell">
              <router-link :to="`/apps/${row.appId}`" class="app-name">{{ row.appName }}</router-link>
              <div class="text-muted publisher">
                {{ row.publisher }}
                <el-tag v-if="row.publisherVerified" size="small" type="success" effect="plain">已验证</el-tag>
                <el-tag v-else size="small" type="warning" effect="plain">未验证</el-tag>
              </div>
            </div>
          </template>
        </el-table-column>

        <el-table-column label="风险分级" width="100">
          <template #default="{ row }">
            <RiskBadge :level="row.riskLevel" :score="row.riskScore" />
          </template>
        </el-table-column>

        <el-table-column label="治理状态" width="100">
          <template #default="{ row }">
            <el-tag :type="STATUS_TAG_TYPE[row.status as AppStatus]" effect="plain">
              {{ STATUS_LABEL[row.status as AppStatus] }}
            </el-tag>
          </template>
        </el-table-column>

        <el-table-column label="授权人数" width="150" sortable :sort-by="'userCount'">
          <template #default="{ row }">
            <strong>{{ row.userCount }}</strong> 人
            <div v-if="row.highRiskUserCount > 0" class="text-danger" style="font-size: 12px">
              其中 {{ row.highRiskUserCount }} 人持高危权限
            </div>
          </template>
        </el-table-column>

        <el-table-column label="权限范围（去重）" min-width="330">
          <template #default="{ row }">
            <div class="scope-wrap">
              <el-space :size="4" wrap>
                <ScopeTag v-for="s in row.scopes.slice(0, 5)" :key="s.scope" :scope="s.scope" />
                <el-tag
                  v-if="row.scopes.length > 5"
                  size="small"
                  effect="plain"
                  type="info"
                >+{{ row.scopes.length - 5 }} 个</el-tag>
              </el-space>
              <div class="domain-line text-muted">
                数据域：
                <el-tag
                  v-for="d in row.domains"
                  :key="d"
                  size="small"
                  :type="['mail', 'drive', 'contact'].includes(d) ? 'danger' : 'info'"
                  effect="plain"
                >{{ DOMAIN_LABEL[d as keyof typeof DOMAIN_LABEL] }}</el-tag>
              </div>
            </div>
          </template>
        </el-table-column>

        <el-table-column label="最近使用" width="100">
          <template #default="{ row }">
            <span class="text-muted">{{ daysAgo(row.lastUsedAt) }}</span>
          </template>
        </el-table-column>

        <el-table-column label="操作" width="240" fixed="right">
          <template #default="{ row }">
            <el-button link type="primary" @click="router.push(`/apps/${row.appId}`)">详情</el-button>
            <el-dropdown
              trigger="click"
              @command="onStatusCommand(row, $event as AppStatus)"
            >
              <el-button link type="warning">改状态<el-icon class="el-icon--right"><arrow-down /></el-icon></el-button>
              <template #dropdown>
                <el-dropdown-menu>
                  <el-dropdown-item command="approved" :disabled="row.status === 'approved'">标记已批准</el-dropdown-item>
                  <el-dropdown-item command="pending" :disabled="row.status === 'pending'">转为待评估</el-dropdown-item>
                  <el-dropdown-item command="disabled" :disabled="row.status === 'disabled'">禁用应用</el-dropdown-item>
                </el-dropdown-menu>
              </template>
            </el-dropdown>
            <el-button
              link
              type="danger"
              :disabled="row.status !== 'disabled' || row.userCount === 0"
              @click="quickRevokeAll(row)"
            >
              批量撤销
            </el-button>
          </template>
        </el-table-column>
      </el-table>
    </div>
  </div>
</template>

<style scoped>
.app-cell .app-name {
  font-weight: 600;
  color: #2563eb;
  text-decoration: none;
}
.app-cell .app-name:hover {
  text-decoration: underline;
}
.publisher {
  font-size: 12px;
  margin-top: 2px;
  display: flex;
  gap: 6px;
  align-items: center;
}
.scope-wrap {
  display: flex;
  flex-direction: column;
  gap: 6px;
}
.domain-line {
  font-size: 12px;
  display: flex;
  gap: 4px;
  align-items: center;
  flex-wrap: wrap;
}
</style>
