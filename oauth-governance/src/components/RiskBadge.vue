<script setup lang="ts">
import { computed } from 'vue'
import { RISK_LABEL, RISK_TAG_TYPE } from '../shared/risk'
import type { RiskLevel } from '../shared/types'

const props = defineProps<{ level: RiskLevel; score?: number }>()

const label = computed(() => RISK_LABEL[props.level])
const tagType = computed(() => RISK_TAG_TYPE[props.level])
</script>

<template>
  <el-tag :type="tagType" effect="dark" disable-transitions>
    {{ label }}<span v-if="score !== undefined" class="score">·{{ score }}</span>
  </el-tag>
</template>

<style scoped>
.score {
  opacity: 0.75;
  margin-left: 2px;
}
</style>
