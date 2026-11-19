/**
 * 一键启动：会话密钥服务(3001) + Vite 前端(5173)
 * 用法：npm run demo
 */
import { spawn } from 'node:child_process';

const children = [
  spawn(process.execPath, ['server/session-server.mjs'], {
    env: { ...process.env, PORT: '3001' },
    stdio: 'inherit',
  }),
  spawn('npx', ['vite'], { stdio: 'inherit' }),
];

const shutdown = () => children.forEach((c) => c.kill());
process.on('SIGINT', () => {
  shutdown();
  process.exit(0);
});
process.on('exit', shutdown);
