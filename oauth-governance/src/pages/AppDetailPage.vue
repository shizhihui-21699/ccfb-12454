<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { ElMessage, ElMessageBox } from 'element-plus'
import { api } from '../api/client'
import { useGovernanceStore } from '../stores/governance'
import {
  DOMAIN_LABEL,
  SEVERITY_LABEL,
  STATUS_LABEL,
  STATUS_TAG_TYPE
} from '../shared/risk'
import { formatDate } from '../utils/format'
import type { AppDetail, AppStatus, RevokeItem, RevokeResultItem } from '../shared/types'
import RiskBadge from '../components/RiskBadge.vue'
import ScopeTag from '../components/ScopeTag.vue'

const route = useRoute()
const router = useRouter()
const store = useGovernanceStore()

const appId = route.params.appId as string
const detail = ref<AppDetail | null>(null)
const selectedGrants = ref<string[]>([])
const revokeResults = ref<RevokeResultItem[]>([])
const resultDialogVisible = ref(false)

const summary = computed(() => store.apps.find((a) => a.appId === appId) ?? detail.value)

async function loadDetail() {
  detail.value = await api.getAppDetail(appId)
}

onMounted(loadDetail)

async function changeStatus(status: AppStatus) {
  let reason: string | undefined
  if (status === 'disabled') {
    try {
      const { value } = await ElMessageBox.prompt('请填写禁用理由：', '禁用应用', {
        confirmButtonText: '确认禁用',
        cancelButtonText: '取消',
        inputType: 'textarea',
        inputValidator: (v) => (v && v.trim() ? true : '请填写禁用理由')
      })
      reason = value
    } catch {
      return
    }
  }
  await store.changeStatus(appId, status, reason)
  await loadDetail()
}

async function revoke(grantIds: string[]) {
  if (!detail.value) return
  const isDisabled = detail.value.status === 'disabled'
  try {
    await ElMessageBox.confirm(
      isDisabled
        ? `确认撤销选中的 ${grantIds.length} 条授权？该操作调用本地模拟管理接口。`
        : `应用当前不是「已禁用」状态，模拟接口将拒绝撤销。仍要提交 ${grantIds.length} 条请求以演示拦截吗？`,
      '撤销确认',
      { type: 'warning', confirmButtonText: '确认', cancelButtonText: '取消' }
    )
  } catch {
    return
  }
  const idSet = new Set(grantIds)
  const items: RevokeItem[] = detail.value.grants
    .filter((g) => idSet.has(g.id))
    .map((g) => ({ grantId: g.id, userId: g.userId, appId: g.appId }))
  const result = await store.batchRevoke(items)
  revokeResults.value = result.results
  resultDialogVisible.value = true
  selectedGrants.value = []
  await loadDetail()
}

async function revokeAll() {
  if (!detail.value) return
  const all = detail.value.grants.map((g) => g.id)
  await revoke(all)
}

function onSelectionChange(rows: { id: string }[]) {
  selectedGrants.value = rows.map((r) => r.id)
}

const statusTagType = computed(() =>
  detail.value ? STATUS_TAG_TYPE[detail.value.status] : 'info'
)
const statusLabel = computed(() => (detail.value ? STATUS_LABEL[detail.value.status] : ''))
</script>

<template>
  <div class="page-container" v-if="detail && summary">
    <el-page-header @back="router.push('/apps')" class="back-header">
      <template #content>
        <span class="header-name">{{ detail.appName }}</span>
        <RiskBadge :level="summary.riskLevel" :score="summary.riskScore" style="margin-left: 10px" />
        <el-tag :type="statusTagType" effect="plain" style="margin-left: 8px">{{ statusLabel }}</el-tag>
      </template>
    </el-page-header>

    <el-row :gutter="14" style="margin-top: 16px">
      <el-col :span="16">
        <div class="card">
          <div class="section-title">申请的权限范围</div>
          <el-table :data="detail.scopes" size="small">
            <el-table-column label="Scope" min-width="190">
              <template #default="{ row }">
                <ScopeTag :scope="row.scope" show-name />
              </template>
            </el-table-column>
            <el-table-column label="级别" width="80">
              <template #default="{ row }">
                <el-tag
                  size="small"
                  :type="row.severity === 'critical' ? 'danger' : row.severity === 'high' ? 'danger' : row.severity === 'medium' ? 'warning' : 'info'"
                  :effect="row.severity === 'critical' ? 'dark' : 'light'"
                >{{ SEVERITY_LABEL[row.severity as keyof typeof SEVERITY_LABEL] }}</el-tag>
              </template>
            </el-table-column>
            <el-table-column label="数据域" width="100">
              <template #default="{ row }">{{ DOMAIN_LABEL[row.domain as keyof typeof DOMAIN_LABEL] }}</template>
            </el-table-column>
            <el-table-column label="持权人数" width="90">
              <template #default="{ row }">
                <strong :class="{ 'text-danger': ['critical', 'high'].includes(row.severity) }">{{ row.userCount }}</strong> 人
              </template>
            </el-table-column>
            <el-table-column label="权限说明" min-width="240">
              <template #default="{ row }"><span class="text-muted">{{ row.description }}</span></template>
            </el-table-column>
          </el-table>
        </div>

        <div class="card" style="margin-top: 14px">
          <div class="section-title" style="display: flex; align-items: center">
            员工授权明细（{{ detail.grants.length }} 条）
            <div style="flex: 1"></div>
            <el-button
              type="danger"
              plain
              size="small"
              :disabled="selectedGrants.length === 0"
              @click="revoke(selectedGrants)"
            >撤销选中（{{ selectedGrants.length }}）</el-button>
            <el-button
              type="danger"
              size="small"
              :disabled="detail.status !== 'disabled' || detail.grants.length === 0"
              @click="revokeAll"
            >全部撤销</el-button>
          </div>
          <el-alert
            v-if="detail.status !== 'disabled'"
            type="warning"
            :closable="false"
            show-icon
            style="margin-bottom: 10px"
            title="应用尚未禁用：模拟管理接口会拒绝撤销请求，请先在右上方将应用转为「已禁用」。"
          />
          <el-table
            :data="detail.grants"
            size="small"
            height="420"
            @selection-change="onSelectionChange"
          >
            <el-table-column type="selection" width="42" />
            <el-table-column label="员工" min-width="130">
              <template #default="{ row }">
                <div>{{ row.userName }}</div>
                <div class="text-muted" style="font-size: 12px">{{ row.department }}</div>
              </template>
            </el-table-column>
            <el-table-column label="账号" prop="email" min-width="180" class="mono" />
            <el-table-column label="持有权限" min-width="220">
              <template #default="{ row }">
                <el-space :size="4" wrap>
                  <ScopeTag v-for="s in row.scopes" :key="s" :scope="s" />
                </el-space>
              </template>
            </el-table-column>
            <el-table-column label="授权时间" width="150">
              <template #default="{ row }">{{ formatDate(row.grantedAt) }}</template>
            </el-table-column>
            <el-table-column label="最近使用" width="150">
              <template #default="{ row }">{{ formatDate(row.lastUsedAt) }}</template>
            </el-table-column>
          </el-table>
        </div>
      </el-col>

      <el-col :span="8">
        <div class="card">
          <div class="section-title">应用档案</div>
          <el-descriptions :column="1" border size="small">
            <el-descriptions-item label="应用名称">{{ detail.appName }}</el-descriptions-item>
            <el-descriptions-item label="App ID"><span class="mono">{{ detail.appId }}</span></el-descriptions-item>
            <el-descriptions-item label="发布方">{{ detail.publisher }}</el-descriptions-item>
            <el-descriptions-item label="发布方验证">
              <el-tag :type="detail.publisherVerified ? 'success' : 'warning'" size="small">
                {{ detail.publisherVerified ? '已验证' : '未验证（风险分 +10）' }}
              </el-tag>
            </el-descriptions-item>
            <el-descriptions-item label="风险评分">
              <RiskBadge :level="summary.riskLevel" :score="summary.riskScore" />
            </el-descriptions-item>
            <el-descriptions-item label="授权人数">{{ summary.userCount }} 人（{{ summary.highRiskUserCount }} 人持高危权限）</el-descriptions-item>
            <el-descriptions-item label="去重权限数">{{ summary.scopeCount }} 个</el-descriptions-item>
            <el-descriptions-item label="覆盖部门">
              <el-space :size="4" wrap>
                <el-tag v-for="d in summary.departments.slice(0, 5)" :key="d.name" size="small" effect="plain">
                  {{ d.name }} {{ d.count }}
                </el-tag>
              </el-space>
            </el-descriptions-item>
            <el-descriptions-item label="首次授权">{{ formatDate(summary.firstGrantedAt) }}</el-descriptions-item>
            <el-descriptions-item label="最近使用">{{ formatDate(summary.lastUsedAt) }}</el-descriptions-item>
          </el-descriptions>

          <div class="section-title" style="margin-top: 18px">治理操作</div>
          <el-space wrap>
            <el-button type="success" plain :disabled="detail.status === 'approved'" @click="changeStatus('approved')">
              标记已批准
            </el-button>
            <el-button type="warning" plain :disabled="detail.status === 'pending'" @click="changeStatus('pending')">
              转为待评估
            </el-button>
            <el-button type="danger" plain :disabled="detail.status === 'disabled'" @click="changeStatus('disabled')">
              禁用应用
            </el-button>
          </el-space>
          <p class="text-muted" style="font-size: 12px; margin: 12px 0 0; line-height: 1.7">
            治理流程：禁用应用 → 勾选/全选员工授权 → 调用模拟管理接口批量撤销。<br />
            所有状态变更与撤销动作都会写入操作审计。
          </p>
        </div>
      </el-col>
    </el-row>

    <el-dialog v-model="resultDialogVisible" title="批量撤销结果" width="640px">
      <el-table :data="revokeResults" size="small" max-height="380">
        <el-table-column label="员工" prop="userId" width="100" />
        <el-table-column label="授权 ID" prop="grantId" width="110" class="mono" />
        <el-table-column label="结果" width="90">
          <template #default="{ row }">
            <el-tag
              size="small"
              :type="row.status === 'revoked' ? 'success' : row.status === 'skipped' ? 'warning' : 'danger'"
            >
              {{ row.status === 'revoked' ? '已撤销' : row.status === 'skipped' ? '已跳过' : '失败' }}
            </el-tag>
          </template>
        </el-table-column>
        <el-table-column label="说明" prop="reason" min-width="200" />
      </el-table>
      <template #footer>
        <el-button type="primary" @click="resultDialogVisible = false">关闭</el-button>
      </template>
    </el-dialog>
  </div>
</template>

<style scoped>
.back-header {
  background: #fff;
  padding: 12px 16px;
  border-radius: 10px;
  border: 1px solid var(--gov-border);
}
.header-name {
  font-size: 16px;
  font-weight: 700;
}
.section-title {
  font-weight: 600;
  margin-bottom: 12px;
}
.mono {
  font-family: 'SF Mono', 'Menlo', 'Consolas', monospace;
  font-size: 12px;
}
</style>
