<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'
import { useGovernanceStore } from '../stores/governance'
import { formatDate } from '../utils/format'
import type { AuditAction } from '../shared/types'

const store = useGovernanceStore()
const actionFilter = ref<AuditAction | 'all'>('all')

const actionMeta: Record<AuditAction, { label: string; type: 'success' | 'warning' | 'danger' | 'info' | 'primary' }> = {
  import: { label: '导入', type: 'primary' },
  approve: { label: '批准', type: 'success' },
  request_review: { label: '转待评估', type: 'warning' },
  disable: { label: '禁用', type: 'danger' },
  revoke: { label: '撤销授权', type: 'danger' },
  reset: { label: '环境重置', type: 'info' }
}

const filtered = computed(() =>
  actionFilter.value === 'all'
    ? store.audit
    : store.audit.filter((a) => a.action === actionFilter.value)
)

onMounted(() => store.loadAll())
</script>

<template>
  <div class="page-container">
    <h2 class="page-title">操作审计</h2>
    <p class="page-subtitle">记录治理动作的操作人、对象、结果与时间，模拟接口内存保留，重置环境后回到初始状态</p>

    <div class="card filter-bar">
      <el-select v-model="actionFilter" style="width: 160px">
        <el-option label="全部动作" value="all" />
        <el-option v-for="(meta, key) in actionMeta" :key="key" :label="meta.label" :value="key" />
      </el-select>
      <div style="flex: 1"></div>
      <el-tag type="info" effect="plain">{{ filtered.length }} 条记录</el-tag>
    </div>

    <div class="card" style="padding: 0; overflow: hidden">
      <el-table :data="filtered" size="small">
        <el-table-column label="时间" width="170">
          <template #default="{ row }">{{ formatDate(row.time) }}</template>
        </el-table-column>
        <el-table-column label="动作" width="110">
          <template #default="{ row }">
            <el-tag :type="actionMeta[row.action as AuditAction].type" size="small">
              {{ actionMeta[row.action as AuditAction].label }}
            </el-tag>
          </template>
        </el-table-column>
        <el-table-column label="操作人" prop="operator" width="120" />
        <el-table-column label="对象" prop="target" min-width="160" />
        <el-table-column label="详情" prop="detail" min-width="260" />
        <el-table-column label="结果" width="90">
          <template #default="{ row }">
            <el-tag
              size="small"
              :type="row.result === 'success' ? 'success' : row.result === 'partial' ? 'warning' : 'danger'"
            >
              {{ row.result === 'success' ? '成功' : row.result === 'partial' ? '部分成功' : '失败' }}
            </el-tag>
          </template>
        </el-table-column>
      </el-table>
    </div>
  </div>
</template>
