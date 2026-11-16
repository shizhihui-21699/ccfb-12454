<script setup lang="ts">
import { computed, ref } from 'vue'
import { useRouter } from 'vue-router'
import { useGovernanceStore } from '../stores/governance'
import { formatDate } from '../utils/format'
import ScopeTag from '../components/ScopeTag.vue'

const router = useRouter()
const store = useGovernanceStore()

const keyword = ref('')
const appFilter = ref('all')
const severityFilter = ref('all')
const pageSize = ref(20)
const currentPage = ref(1)

const filtered = computed(() => {
  const kw = keyword.value.trim().toLowerCase()
  return store.grants.filter((g) => {
    if (appFilter.value !== 'all' && g.appId !== appFilter.value) return false
    if (severityFilter.value !== 'all') {
      const hit = g.scopes.some((s) => {
        const sev = s.includes('full') || s.includes('admin') ? 'critical' : null
        if (severityFilter.value === 'critical') return sev === 'critical'
        return true
      })
      if (!hit) return false
      if (severityFilter.value === 'high') {
        const hasHigh = g.scopes.some((s) =>
          /(^|[._])(mail|drive|contacts|contact)([._])/.test(s) && /read|write|send/.test(s)
        )
        if (!hasHigh) return false
      }
    }
    if (kw && !`${g.userName}${g.email}${g.appName}${g.department}`.toLowerCase().includes(kw)) {
      return false
    }
    return true
  })
})

const paged = computed(() =>
  filtered.value.slice((currentPage.value - 1) * pageSize.value, currentPage.value * pageSize.value)
)
</script>

<template>
  <div class="page-container">
    <h2 class="page-title">授权明细</h2>
    <p class="page-subtitle">办公套件导出的全部 OAuth 授权记录（{{ store.grants.length }} 条），可按应用、员工与权限级别检索</p>

    <div class="card filter-bar">
      <el-input v-model="keyword" placeholder="搜索员工 / 邮箱 / 部门 / 应用" clearable style="width: 280px" />
      <el-select v-model="appFilter" filterable style="width: 220px">
        <el-option label="全部应用" value="all" />
        <el-option v-for="a in store.apps" :key="a.appId" :label="a.appName" :value="a.appId" />
      </el-select>
      <el-select v-model="severityFilter" style="width: 170px">
        <el-option label="全部权限级别" value="all" />
        <el-option label="仅含严重（full/admin）" value="critical" />
        <el-option label="仅含邮件/网盘/通讯录读写" value="high" />
      </el-select>
      <div style="flex: 1"></div>
      <el-button type="primary" plain @click="router.push('/import')">导入新记录</el-button>
    </div>

    <div class="card" style="padding: 0; overflow: hidden">
      <el-table :data="paged" size="small" style="width: 100%">
        <el-table-column label="授权 ID" prop="id" width="90" class="mono" />
        <el-table-column label="员工" min-width="120">
          <template #default="{ row }">
            <div>{{ row.userName }}</div>
            <div class="text-muted" style="font-size: 12px">{{ row.department }}</div>
          </template>
        </el-table-column>
        <el-table-column label="账号" prop="email" min-width="180" class="mono" />
        <el-table-column label="应用" min-width="150">
          <template #default="{ row }">
            <router-link :to="`/apps/${row.appId}`" class="app-link">{{ row.appName }}</router-link>
          </template>
        </el-table-column>
        <el-table-column label="权限" min-width="260">
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

      <div style="padding: 12px; display: flex; justify-content: flex-end">
        <el-pagination
          v-model:current-page="currentPage"
          v-model:page-size="pageSize"
          :total="filtered.length"
          :page-sizes="[20, 50, 100]"
          layout="total, sizes, prev, pager, next"
          background
        />
      </div>
    </div>
  </div>
</template>

<style scoped>
.app-link {
  color: #2563eb;
  text-decoration: none;
}
.app-link:hover {
  text-decoration: underline;
}
.mono {
  font-family: 'SF Mono', 'Menlo', 'Consolas', monospace;
  font-size: 12px;
}
</style>
