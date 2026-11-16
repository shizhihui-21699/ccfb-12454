<script setup lang="ts">
import { computed } from 'vue'
import { getScopeMeta, isSensitiveDataScope, SEVERITY_TAG_TYPE, SEVERITY_LABEL } from '../shared/risk'
import type { ScopeSeverity } from '../shared/types'

const props = defineProps<{
  scope: string
  showName?: boolean
  size?: 'small' | 'default' | 'large'
}>()

const meta = computed(() => getScopeMeta(props.scope))
const sensitive = computed(() => isSensitiveDataScope(meta.value))
const tagType = computed(() => SEVERITY_TAG_TYPE[meta.value.severity])
const severityLabel = computed(() => SEVERITY_LABEL[meta.value.severity as ScopeSeverity])
</script>

<template>
  <el-tooltip :content="meta.description" placement="top" :show-after="200">
    <el-tag
      :type="tagType"
      :size="size ?? 'small'"
      :effect="meta.severity === 'critical' ? 'dark' : 'light'"
      :class="{ 'sensitive-scope': sensitive }"
      disable-transitions
    >
      <span v-if="sensitive" title="涉及邮件/网盘/通讯录的高危权限">⚠ </span>
      <span class="mono">{{ scope }}</span>
      <span v-if="showName">（{{ meta.name }}·{{ severityLabel }}）</span>
    </el-tag>
  </el-tooltip>
</template>

<style scoped>
.sensitive-scope {
  font-weight: 600;
}
.mono {
  font-family: 'SF Mono', 'Menlo', 'Consolas', monospace;
}
</style>
