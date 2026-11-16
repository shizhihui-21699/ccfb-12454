<script setup lang="ts">
import { SEVERITY_LABEL, SEVERITY_SCORE } from '../shared/risk'

const severityRules = [
  {
    level: 'critical',
    label: SEVERITY_LABEL.critical,
    score: SEVERITY_SCORE.critical,
    color: '#dc2626',
    criteria: '*.full 完全委托类（邮箱/网盘完全访问）、全租户通讯录管理、租户管理、全员账号读取',
    examples: ['mail.full', 'drive.full', 'contacts.full', 'admin.tenant.full', 'admin.users.read']
  },
  {
    level: 'high',
    label: SEVERITY_LABEL.high,
    score: SEVERITY_SCORE.high,
    color: '#ea580c',
    criteria: '邮件、网盘文件、通讯录三大敏感数据域的读取 / 读写 / 代发 / 代发信权限',
    examples: ['mail.read', 'mail.readwrite', 'mail.send', 'drive.read', 'drive.readwrite', 'contacts.read', 'contacts.readwrite']
  },
  {
    level: 'medium',
    label: SEVERITY_LABEL.medium,
    score: SEVERITY_SCORE.medium,
    color: '#d97706',
    criteria: '日历、即时消息、审计日志读取、离线访问（refresh token）、单文件受限访问、邮件元数据',
    examples: ['calendar.readwrite', 'im.chat.read', 'offline_access', 'admin.audit.read', 'drive.file']
  },
  {
    level: 'low',
    label: SEVERITY_LABEL.low,
    score: SEVERITY_SCORE.low,
    color: '#2563eb',
    criteria: 'openid / profile / email 等基础身份类，以及文件元数据、邮件标签等不接触内容的权限',
    examples: ['openid', 'profile', 'email', 'user.read', 'drive.metadata']
  },
  {
    level: 'unknown',
    label: SEVERITY_LABEL.unknown,
    score: SEVERITY_SCORE.unknown,
    color: '#64748b',
    criteria: '字典外 scope：命中 full/admin/manage 关键字按高危兜底；命中敏感域读写按高危兜底；其余按低风险兜底，均提示人工确认',
    examples: ['approval.workflow.readwrite', 'widget.dashboard']
  }
]

const appRules = [
  { title: '计分方式', content: '对应用去重后的 scope 集合逐个计分并求和；同一 scope 不因授权人数多而重复累计，避免"用的人多=风险高"的误判。' },
  { title: '发布方未验证', content: '发布方未通过办公套件验证的应用额外 +10 分，反映供应链与仿冒应用风险。' },
  { title: '高危应用', content: '风险分 ≥ 40：通常持有至少一个严重权限，或两个以上敏感数据域高危权限，建议优先禁用并撤销。' },
  { title: '中危应用', content: '风险分 15 ~ 39：持有单项高危或多个中危权限，需要业务方说明使用场景后再决定批准或禁用。' },
  { title: '低危应用', content: '风险分 < 15：仅基础身份或元数据类权限，走快速批准通道。' },
  { title: '治理状态与风险分级解耦', content: '风险分级由规则自动计算；已批准 / 待评估 / 禁用是人工治理决策，二者独立展示，禁用是调用撤销接口的前置条件。' }
]

const scopeTable = [
  { scope: 'mail.full', score: 40 },
  { scope: 'drive.full', score: 40 },
  { scope: 'contacts.full', score: 40 },
  { scope: 'admin.tenant.full', score: 40 },
  { scope: 'admin.users.read', score: 40 },
  { scope: 'mail.read / mail.readwrite / mail.send', score: 20 },
  { scope: 'drive.read / drive.readwrite', score: 20 },
  { scope: 'contacts.read / contacts.readwrite', score: 20 },
  { scope: 'calendar / im / offline_access / audit', score: 8 },
  { scope: 'openid / profile / email / 元数据类', score: 1 }
]
</script>

<template>
  <div class="page-container">
    <h2 class="page-title">风险分级口径</h2>
    <p class="page-subtitle">
      本台所有分级均由本地规则引擎（src/shared/risk.ts）确定性计算，规则可审计、可调参；以下为当前生效口径。
    </p>

    <el-row :gutter="14">
      <el-col :span="15">
        <div v-for="r in severityRules" :key="r.level" class="card rule-card">
          <div class="rule-head">
            <el-tag :color="r.color" effect="dark" disable-transitions style="border: none">
              {{ r.label }}权限
            </el-tag>
            <span class="rule-score">计分 {{ r.score }} 分/个</span>
          </div>
          <p class="rule-criteria">{{ r.criteria }}</p>
          <div class="rule-examples">
            <el-tag v-for="ex in r.examples" :key="ex" size="small" effect="plain" class="mono">{{ ex }}</el-tag>
          </div>
        </div>
      </el-col>

      <el-col :span="9">
        <div class="card">
          <div class="section-title">应用级分级规则</div>
          <el-timeline>
            <el-timeline-item v-for="r in appRules" :key="r.title" :timestamp="r.title" placement="top" type="primary">
              <span class="text-muted">{{ r.content }}</span>
            </el-timeline-item>
          </el-timeline>
        </div>

        <div class="card" style="margin-top: 14px">
          <div class="section-title">分值速查</div>
          <el-table :data="scopeTable" size="small">
            <el-table-column label="权限（类）" prop="scope" min-width="220" class="mono" />
            <el-table-column label="分值" prop="score" width="80">
              <template #default="{ row }">
                <strong :class="{ 'text-danger': row.score >= 20 }">{{ row.score }}</strong>
              </template>
            </el-table-column>
          </el-table>
        </div>

        <div class="card" style="margin-top: 14px">
          <div class="section-title">处置建议（SOP）</div>
          <ol class="sop">
            <li>高危 + 未验证发布方：直接禁用，通知员工并批量撤销授权。</li>
            <li>高危 + 已验证：要求业务负责人 3 个工作日内说明最小权限需求，到期未说明转禁用。</li>
            <li>中危：纳入季度复审，核查最近 90 天是否仍有使用。</li>
            <li>低危：快速批准；长期未使用的授权定期清理。</li>
          </ol>
        </div>
      </el-col>
    </el-row>
  </div>
</template>

<style scoped>
.rule-card {
  margin-bottom: 12px;
}
.rule-head {
  display: flex;
  align-items: center;
  gap: 12px;
  margin-bottom: 8px;
}
.rule-score {
  font-weight: 700;
}
.rule-criteria {
  margin: 0 0 10px;
  line-height: 1.7;
}
.rule-examples {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
}
.section-title {
  font-weight: 600;
  margin-bottom: 12px;
}
.mono {
  font-family: 'SF Mono', 'Menlo', 'Consolas', monospace;
  font-size: 12px;
}
.sop {
  padding-left: 18px;
  margin: 0;
  line-height: 2;
  color: #374151;
}
</style>
