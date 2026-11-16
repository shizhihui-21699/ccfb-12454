<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref, watch, nextTick } from 'vue'
import * as echarts from 'echarts'
import { useGovernanceStore } from '../stores/governance'
import { DOMAIN_LABEL } from '../shared/risk'
import type { ScopeDomain } from '../shared/types'
import RiskBadge from '../components/RiskBadge.vue'

const store = useGovernanceStore()
const statusChartEl = ref<HTMLDivElement>()
const riskChartEl = ref<HTMLDivElement>()
const barChartEl = ref<HTMLDivElement>()
let charts: echarts.ECharts[] = []

const stats = computed(() => store.stats)

const criticalApps = computed(() =>
  store.apps.filter((a) => a.scopes.some((s) => s.severity === 'critical')).slice(0, 6)
)

function criticalScopesOf(row: { scopes: { scope: string; severity: string }[] }) {
  return row.scopes.filter((x) => x.severity === 'critical')
}

const domainOrder: ScopeDomain[] = ['mail', 'drive', 'contact', 'admin', 'im', 'calendar', 'offline', 'account', 'other']
const domainExposure = computed(() => {
  if (!stats.value) return []
  return [...stats.value.domainExposure].sort(
    (a, b) => domainOrder.indexOf(a.domain as ScopeDomain) - domainOrder.indexOf(b.domain as ScopeDomain)
  )
})

function renderCharts() {
  charts.forEach((c) => c.dispose())
  charts = []
  if (!stats.value || !statusChartEl.value || !riskChartEl.value || !barChartEl.value) return

  const statusChart = echarts.init(statusChartEl.value)
  statusChart.setOption({
    tooltip: { trigger: 'item' },
    legend: { bottom: 0, itemWidth: 12, itemHeight: 12 },
    series: [
      {
        name: '治理状态',
        type: 'pie',
        radius: ['42%', '68%'],
        center: ['50%', '44%'],
        label: { formatter: '{b}\n{c} 个' },
        data: stats.value.statusDist,
        color: ['#22c55e', '#f59e0b', '#94a3b8']
      }
    ]
  })

  const riskChart = echarts.init(riskChartEl.value)
  riskChart.setOption({
    tooltip: { trigger: 'item' },
    legend: { bottom: 0, itemWidth: 12, itemHeight: 12 },
    series: [
      {
        name: '风险分级',
        type: 'pie',
        radius: ['42%', '68%'],
        center: ['50%', '44%'],
        label: { formatter: '{b}\n{c} 个' },
        data: stats.value.riskDist,
        color: ['#ef4444', '#f59e0b', '#22c55e']
      }
    ]
  })

  const barChart = echarts.init(barChartEl.value)
  const top = stats.value.topExposedApps
  barChart.setOption({
    tooltip: {
      trigger: 'axis',
      axisPointer: { type: 'shadow' },
      formatter: (params: unknown) => {
        const p = (params as { name: string; value: number }[])[0]
        return `${p.name}<br/>授权人数：${p.value} 人`
      }
    },
    grid: { left: 8, right: 24, top: 16, bottom: 8, containLabel: true },
    xAxis: { type: 'value', splitLine: { lineStyle: { color: '#eef0f4' } } },
    yAxis: {
      type: 'category',
      inverse: true,
      data: top.map((t) => t.appName),
      axisLabel: { width: 130, overflow: 'truncate' }
    },
    series: [
      {
        type: 'bar',
        data: top.map((t) => ({
          value: t.userCount,
          itemStyle: {
            color: t.riskLevel === 'high' ? '#ef4444' : t.riskLevel === 'medium' ? '#f59e0b' : '#22c55e',
            borderRadius: [0, 4, 4, 0]
          }
        })),
        barWidth: 16,
        label: { show: true, position: 'right', formatter: '{c} 人' }
      }
    ]
  })

  charts = [statusChart, riskChart, barChart]
}

function onResize() {
  charts.forEach((c) => c.resize())
}

onMounted(async () => {
  await store.loadAll()
  await nextTick()
  renderCharts()
  window.addEventListener('resize', onResize)
})

onBeforeUnmount(() => {
  window.removeEventListener('resize', onResize)
  charts.forEach((c) => c.dispose())
})

watch(
  () => store.apps,
  () => nextTick(renderCharts),
  { deep: true }
)
</script>

<template>
  <div class="page-container" v-if="stats">
    <h2 class="page-title">第三方 OAuth 授权风险总览</h2>
    <p class="page-subtitle">数据来自办公套件导出的授权记录，经本地规则引擎按应用汇总与风险分级</p>

    <el-row :gutter="14">
      <el-col :span="4">
        <div class="stat-card">
          <span class="stat-label">接入第三方应用</span>
          <span class="stat-value">{{ stats.totalApps }}</span>
          <span class="stat-extra">覆盖 {{ stats.totalUsers }} 名员工</span>
        </div>
      </el-col>
      <el-col :span="4">
        <div class="stat-card">
          <span class="stat-label">有效授权记录</span>
          <span class="stat-value">{{ stats.totalGrants }}</span>
          <span class="stat-extra">含已撤销前的历史导入</span>
        </div>
      </el-col>
      <el-col :span="4">
        <div class="stat-card">
          <span class="stat-label">高危应用</span>
          <span class="stat-value text-danger">{{ stats.highRiskApps }}</span>
          <span class="stat-extra">风险分 ≥ 40</span>
        </div>
      </el-col>
      <el-col :span="4">
        <div class="stat-card">
          <span class="stat-label">待评估应用</span>
          <span class="stat-value text-warning">{{ stats.pendingApps }}</span>
          <span class="stat-extra">尚未完成安全评审</span>
        </div>
      </el-col>
      <el-col :span="4">
        <div class="stat-card">
          <span class="stat-label">已禁用应用</span>
          <span class="stat-value">{{ stats.disabledApps }}</span>
          <span class="stat-extra">可执行批量撤销</span>
        </div>
      </el-col>
      <el-col :span="4">
        <div class="stat-card">
          <span class="stat-label">含严重权限的授权</span>
          <span class="stat-value text-danger">{{ stats.criticalScopeGrants }}</span>
          <span class="stat-extra">完全访问 / 租户管理类</span>
        </div>
      </el-col>
    </el-row>

    <el-row :gutter="14" style="margin-top: 14px">
      <el-col :span="8">
        <div class="card">
          <div class="card-title">应用治理状态分布</div>
          <div ref="statusChartEl" style="height: 280px"></div>
        </div>
      </el-col>
      <el-col :span="8">
        <div class="card">
          <div class="card-title">应用风险分级分布</div>
          <div ref="riskChartEl" style="height: 280px"></div>
        </div>
      </el-col>
      <el-col :span="8">
        <div class="card">
          <div class="card-title">授权人数 Top 8（按风险着色）</div>
          <div ref="barChartEl" style="height: 280px"></div>
        </div>
      </el-col>
    </el-row>

    <el-row :gutter="14" style="margin-top: 14px">
      <el-col :span="10">
        <div class="card">
          <div class="card-title">数据域暴露面</div>
          <el-table :data="domainExposure" size="small" :show-header="true">
            <el-table-column label="数据域" prop="domainName" width="110" />
            <el-table-column label="涉及应用">
              <template #default="{ row }">
                <el-tag size="small" type="info">{{ row.apps }} 个</el-tag>
              </template>
            </el-table-column>
            <el-table-column label="暴露员工数">
              <template #default="{ row }">
                <span :class="{ 'text-danger': row.users >= 50 }">{{ row.users }} 人</span>
              </template>
            </el-table-column>
          </el-table>
          <p class="text-muted" style="font-size: 12px; margin: 10px 0 0">
            邮件 / 网盘文件 / 通讯录为重点治理数据域，任一域的读写类权限即标记为高危。
          </p>
        </div>
      </el-col>
      <el-col :span="14">
        <div class="card">
          <div class="card-title">
            严重权限预警
            <el-tag type="danger" size="small" effect="dark" style="margin-left: 8px">
              {{ criticalApps.length }} 个应用持有完全访问/管理类权限
            </el-tag>
          </div>
          <el-table :data="criticalApps" size="small">
            <el-table-column label="应用" min-width="150">
              <template #default="{ row }">
                <router-link :to="`/apps/${row.appId}`" class="app-link">{{ row.appName }}</router-link>
              </template>
            </el-table-column>
            <el-table-column label="发布方" prop="publisher" min-width="140" />
            <el-table-column label="风险" width="92">
              <template #default="{ row }">
                <RiskBadge :level="row.riskLevel" :score="row.riskScore" />
              </template>
            </el-table-column>
            <el-table-column label="严重权限" min-width="200">
              <template #default="{ row }">
                <el-space :size="4" wrap>
                  <el-tag
                    v-for="s in criticalScopesOf(row)"
                    :key="s.scope"
                    type="danger"
                    size="small"
                    effect="dark"
                  >
                    <span class="mono">{{ s.scope }}</span>
                  </el-tag>
                </el-space>
              </template>
            </el-table-column>
          </el-table>
        </div>
      </el-col>
    </el-row>
  </div>
</template>

<style scoped>
.card-title {
  font-weight: 600;
  margin-bottom: 10px;
  display: flex;
  align-items: center;
}

.app-link {
  color: #2563eb;
  text-decoration: none;
}

.app-link:hover {
  text-decoration: underline;
}

.mono {
  font-family: 'SF Mono', 'Menlo', 'Consolas', monospace;
}
</style>
