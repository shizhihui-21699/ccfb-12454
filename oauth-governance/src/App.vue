<script setup lang="ts">
import { computed, onMounted } from 'vue'
import { useRoute } from 'vue-router'
import {
  DataAnalysis,
  Grid,
  Document,
  Upload,
  List,
  Lock,
  RefreshLeft
} from '@element-plus/icons-vue'
import { useGovernanceStore } from './stores/governance'

const route = useRoute()
const store = useGovernanceStore()

const activeMenu = computed(() => {
  if (route.path.startsWith('/apps')) return '/apps'
  return route.path
})

const pageTitle = computed(() => (route.meta.title as string) ?? '第三方授权治理台')

onMounted(() => {
  store.loadAll()
})

const menus = [
  { path: '/dashboard', title: '风险总览', icon: DataAnalysis },
  { path: '/apps', title: '应用治理', icon: Grid },
  { path: '/grants', title: '授权明细', icon: Document },
  { path: '/import', title: '授权导入', icon: Upload },
  { path: '/audit', title: '操作审计', icon: List },
  { path: '/policy', title: '分级口径', icon: Lock }
]

async function onReset() {
  await store.resetEnvironment()
}
</script>

<template>
  <el-container style="height: 100vh">
    <el-aside width="220px" class="sidebar">
      <div class="logo">
        <el-icon :size="22"><Lock /></el-icon>
        <span>授权治理台</span>
      </div>
      <el-menu :default-active="activeMenu" router background-color="#1d2739" text-color="#b8c2d4"
        active-text-color="#ffffff" class="side-menu">
        <el-menu-item v-for="m in menus" :key="m.path" :index="m.path">
          <el-icon><component :is="m.icon" /></el-icon>
          <span>{{ m.title }}</span>
        </el-menu-item>
      </el-menu>
      <div class="sidebar-footer">
        <el-button size="small" plain :icon="RefreshLeft" @click="onReset">重置模拟环境</el-button>
      </div>
    </el-aside>

    <el-container>
      <el-header class="topbar">
        <div class="topbar-title">{{ pageTitle }}</div>
        <div class="topbar-right">
          <el-tag type="info" effect="plain">模拟管理接口 · 本地内存态</el-tag>
          <el-avatar :size="30" style="background-color: #2f405c">安</el-avatar>
          <span class="text-muted">安全管理员</span>
        </div>
      </el-header>

      <el-main class="main-area" v-loading="store.loading">
        <router-view />
      </el-main>
    </el-container>
  </el-container>
</template>

<style scoped>
.sidebar {
  background: var(--gov-sidebar);
  display: flex;
  flex-direction: column;
}

.logo {
  height: 60px;
  display: flex;
  align-items: center;
  gap: 10px;
  color: #fff;
  font-size: 17px;
  font-weight: 700;
  padding: 0 20px;
  letter-spacing: 1px;
}

.side-menu {
  border-right: none;
  flex: 1;
}

.side-menu :deep(.el-menu-item.is-active) {
  background-color: var(--gov-sidebar-active);
}

.sidebar-footer {
  padding: 14px;
  border-top: 1px solid #2f405c;
}

.sidebar-footer .el-button {
  width: 100%;
  background: transparent;
  color: #b8c2d4;
  border-color: #3d4f6e;
}

.topbar {
  background: #fff;
  border-bottom: 1px solid var(--gov-border);
  display: flex;
  align-items: center;
  justify-content: space-between;
  height: 60px;
}

.topbar-title {
  font-size: 16px;
  font-weight: 600;
}

.topbar-right {
  display: flex;
  align-items: center;
  gap: 10px;
}

.main-area {
  padding: 0;
  overflow-y: auto;
  background: var(--gov-bg);
}
</style>
