<template>
  <div class="page">
    <nav class="topbar">
      <div class="brand">🏦 演示网银 SecureBank</div>
      <a class="test-link" href="/trojan.html">→ 木马攻防测试台</a>
    </nav>

    <main class="card">
      <h1>个人网银登录</h1>
      <p class="sub">防窥口令输入组件演示 · 口令默认 <code>836219</code></p>

      <label class="field">
        <span>登录账号</span>
        <input v-model="account" placeholder="请输入账号（演示：任意）" />
      </label>

      <label class="field">
        <span>登录口令</span>
        <SecurePinInput @submitted="onResult" />
      </label>

      <div v-if="result" class="result" :class="result.ok && result.data.ok ? 'good' : 'bad'">
        <template v-if="result.ok && result.data.ok">
          <strong>{{ result.data.matched ? '✅ 登录成功' : '❌ 口令不匹配' }}</strong>
          <pre>{{ JSON.stringify(result.data, null, 2) }}</pre>
        </template>
        <template v-else>
          <strong>❌ 请求失败</strong>
          <pre>{{ JSON.stringify(result.data, null, 2) }}</pre>
        </template>
      </div>
    </main>

    <footer class="foot">
      本页所有加密均在浏览器内通过 Web Crypto 完成；服务端只收到密文。
    </footer>
  </div>
</template>

<script setup>
import { ref } from 'vue';
import SecurePinInput from './components/SecurePinInput.vue';

const account = ref('demo-user');
const result = ref(null);

function onResult(r) {
  result.value = r;
}
</script>
