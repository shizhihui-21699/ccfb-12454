import { defineConfig } from 'vite'
import vue from '@vitejs/plugin-vue'
import { mockAdminPlugin } from './server/mockAdmin'

export default defineConfig({
  plugins: [vue(), mockAdminPlugin()],
  server: {
    port: 5173,
    host: '127.0.0.1'
  }
})
