<script setup lang="ts">
import { ref } from 'vue'
import { ElMessage } from 'element-plus'
import { UploadFilled, Download } from '@element-plus/icons-vue'
import { useGovernanceStore } from '../stores/governance'
import { downloadText } from '../utils/format'
import type { ImportResult } from '../shared/types'

const store = useGovernanceStore()
const importing = ref(false)
const result = ref<ImportResult | null>(null)
const previewRows = ref<unknown[]>([])
const fileName = ref('')

async function handleFile(file: { raw: File; name: string }) {
  fileName.value = file.name
  const text = await file.raw.text()
  try {
    previewRows.value = store.parseFile(file.name, text).slice(0, 5)
    ElMessage.success(`文件解析成功，可在导入前预览前 ${Math.min(5, previewRows.value.length)} 行`)
  } catch (err) {
    ElMessage.error(`解析失败：${(err as Error).message}`)
    previewRows.value = []
  }
  return false
}

async function doImport() {
  if (!fileName.value) {
    ElMessage.warning('请先选择导出文件')
    return
  }
  importing.value = true
  try {
    // 重新读取完整文件（预览只截取了前 5 行）
    const input = document.querySelector<HTMLInputElement>('input[type=file]')
    const file = input?.files?.[0]
    if (!file) {
      ElMessage.warning('请重新选择文件')
      return
    }
    const text = await file.text()
    const records = store.parseFile(file.name, text)
    result.value = await store.importRecords(records)
  } catch (err) {
    ElMessage.error(`导入失败：${(err as Error).message}`)
  } finally {
    importing.value = false
  }
}

async function loadSampleAndImport(kind: 'json' | 'csv') {
  importing.value = true
  try {
    const res = await fetch(`/sample/oauth-grants.${kind}`)
    const text = await res.text()
    const records = store.parseFile(`oauth-grants.${kind}`, text)
    result.value = await store.importRecords(records)
    fileName.value = `内置样本 oauth-grants.${kind}`
  } finally {
    importing.value = false
  }
}

async function downloadSample(kind: 'json' | 'csv') {
  const res = await fetch(`/sample/oauth-grants.${kind}`)
  const text = await res.text()
  downloadText(
    `oauth-grants.${kind}`,
    text,
    kind === 'json' ? 'application/json' : 'text/csv;charset=utf-8'
  )
}
</script>

<template>
  <div class="page-container">
    <h2 class="page-title">授权记录导入</h2>
    <p class="page-subtitle">
      上传办公套件管理后台导出的 OAuth 授权记录（JSON 数组 / 含 records 或 grants 字段的 JSON / CSV），
      服务端按 id 执行新增或更新，并逐行校验。
    </p>

    <el-row :gutter="14">
      <el-col :span="14">
        <div class="card">
          <el-upload drag :auto-upload="false" :show-file-list="false" accept=".json,.csv" :before-upload="handleFile">
            <el-icon class="el-icon--upload"><upload-filled /></el-icon>
            <div class="el-upload__text">将导出文件拖到此处，或<em>点击选择</em></div>
            <template #tip>
              <div class="el-upload__tip">支持 .json / .csv，单次上限 8MB；scopes 多个值用分号或逗号分隔</div>
            </template>
          </el-upload>

          <div v-if="fileName" style="margin-top: 12px">
            <el-alert :title="`已选择文件：${fileName}`" type="success" :closable="false" show-icon />
          </div>

          <div style="margin-top: 16px; display: flex; gap: 10px">
            <el-button type="primary" :loading="importing" :disabled="!fileName" @click="doImport">
              校验并导入
            </el-button>
            <el-button @click="downloadSample('json')" :icon="Download">下载 JSON 样本</el-button>
            <el-button @click="downloadSample('csv')" :icon="Download">下载 CSV 样本</el-button>
          </div>

          <el-divider>或直接导入内置样本（用于演示）</el-divider>
          <el-space>
            <el-button plain :loading="importing" @click="loadSampleAndImport('json')">导入内置 JSON 样本</el-button>
            <el-button plain :loading="importing" @click="loadSampleAndImport('csv')">导入内置 CSV 样本</el-button>
          </el-space>
        </div>
      </el-col>

      <el-col :span="10">
        <div class="card" v-if="previewRows.length">
          <div class="section-title">解析预览（前 5 行）</div>
          <el-table :data="previewRows" size="small" max-height="260">
            <el-table-column label="员工" prop="userName" width="90" />
            <el-table-column label="应用" prop="appName" min-width="120" />
            <el-table-column label="权限" min-width="160">
              <template #default="{ row }">
                <span class="mono">{{ Array.isArray(row.scopes) ? row.scopes.join(', ') : row.scopes }}</span>
              </template>
            </el-table-column>
          </el-table>
        </div>

        <div class="card" v-if="result" style="margin-top: 14px">
          <div class="section-title">最近一次导入结果</div>
          <el-descriptions :column="2" border size="small">
            <el-descriptions-item label="总行数">{{ result.totalRows }}</el-descriptions-item>
            <el-descriptions-item label="新增">
              <span class="text-success">{{ result.inserted }}</span>
            </el-descriptions-item>
            <el-descriptions-item label="更新">{{ result.updated }}</el-descriptions-item>
            <el-descriptions-item label="跳过">
              <span :class="{ 'text-danger': result.skipped > 0 }">{{ result.skipped }}</span>
            </el-descriptions-item>
          </el-descriptions>
          <el-table v-if="result.errors.length" :data="result.errors" size="small" style="margin-top: 10px" max-height="220">
            <el-table-column label="行号" prop="row" width="70" />
            <el-table-column label="错误原因" prop="reason" min-width="200" />
          </el-table>
        </div>
      </el-col>
    </el-row>
  </div>
</template>

<style scoped>
.section-title {
  font-weight: 600;
  margin-bottom: 12px;
}
.mono {
  font-family: 'SF Mono', 'Menlo', 'Consolas', monospace;
  font-size: 12px;
}
</style>
