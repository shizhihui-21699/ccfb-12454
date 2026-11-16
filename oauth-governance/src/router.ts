import { createRouter, createWebHashHistory } from 'vue-router'

export const router = createRouter({
  history: createWebHashHistory(),
  routes: [
    { path: '/', redirect: '/dashboard' },
    {
      path: '/dashboard',
      name: 'dashboard',
      component: () => import('./pages/DashboardPage.vue'),
      meta: { title: '风险总览' }
    },
    {
      path: '/apps',
      name: 'apps',
      component: () => import('./pages/AppsPage.vue'),
      meta: { title: '应用治理' }
    },
    {
      path: '/apps/:appId',
      name: 'app-detail',
      component: () => import('./pages/AppDetailPage.vue'),
      meta: { title: '应用详情' }
    },
    {
      path: '/grants',
      name: 'grants',
      component: () => import('./pages/GrantsPage.vue'),
      meta: { title: '授权明细' }
    },
    {
      path: '/import',
      name: 'import',
      component: () => import('./pages/ImportPage.vue'),
      meta: { title: '授权导入' }
    },
    {
      path: '/audit',
      name: 'audit',
      component: () => import('./pages/AuditPage.vue'),
      meta: { title: '操作审计' }
    },
    {
      path: '/policy',
      name: 'policy',
      component: () => import('./pages/PolicyPage.vue'),
      meta: { title: '分级口径' }
    }
  ]
})
