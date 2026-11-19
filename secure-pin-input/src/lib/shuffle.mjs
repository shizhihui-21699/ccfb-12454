/**
 * 软键盘布局随机化
 *
 * 两个维度同时做随机，让"坐标 -> 字符"在每次点击后都失效：
 *   1. Fisher-Yates 洗牌：每次按键后整盘字符重新排列
 *   2. 单元格位置抖动：每个字符渲染位置再叠加随机偏移，
 *      即使木马只记录点击坐标，同一坐标在不同布局里指向不同字符
 *
 * 随机源使用 crypto.getRandomValues（密码学安全），不用 Math.random。
 */

const ALL_CHARS = '0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZ';

export function cryptoRandomInt(max) {
  // 拒绝采样，避免取模偏置
  const limit = 256 - (256 % max);
  const buf = new Uint8Array(1);
  let v;
  do {
    crypto.getRandomValues(buf);
    v = buf[0];
  } while (v >= limit);
  return v % max;
}

export function shuffle(arr) {
  const a = arr.slice();
  for (let i = a.length - 1; i > 0; i--) {
    const j = cryptoRandomInt(i + 1);
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

/**
 * 生成一版布局。
 * @param {number} cols 列数
 * @param {string[]} chars 字符集
 * @param {number} jitterPx 每格随机抖动上限（px）
 */
export function buildLayout(chars = ALL_CHARS.split(''), cols = 6, jitterPx = 6) {
  const order = shuffle(chars);
  return order.map((ch, i) => {
    const row = Math.floor(i / cols);
    const col = i % cols;
    return {
      ch,
      row,
      col,
      // 每格独立抖动，几何位置不固定
      dx: jitterPx ? (cryptoRandomInt(jitterPx * 2 + 1) - jitterPx) : 0,
      dy: jitterPx ? (cryptoRandomInt(jitterPx * 2 + 1) - jitterPx) : 0,
    };
  });
}

export const KEYSET = ALL_CHARS;
