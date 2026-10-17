// ============================================================
// 扩展图标生成脚本（开发期一次性运行，无需任何第三方依赖）
// 用法：node generate-icons.js
// 生成一张简单的猫咪头像 PNG 图标，输出到 icons/ 目录
// ============================================================

'use strict';

const fs = require('fs');
const path = require('path');
const zlib = require('zlib');

// 图标用到的颜色（RGB）
const ORANGE = [245, 166, 35]; // 猫咪毛色
const DARK = [42, 36, 34];     // 眼睛、鼻子
const PINK = [249, 208, 160];  // 内耳

/* ---------------- CRC32（PNG 块校验必需） ---------------- */
const CRC_TABLE = (() => {
  const t = new Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = (c & 1) ? (0xedb88320 ^ (c >>> 1)) : (c >>> 1);
    t[n] = c >>> 0;
  }
  return t;
})();

function crc32(buf) {
  let c = 0xffffffff;
  for (let i = 0; i < buf.length; i++) {
    c = (CRC_TABLE[(c ^ buf[i]) & 0xff] ^ (c >>> 8)) >>> 0;
  }
  return (c ^ 0xffffffff) >>> 0;
}

/* ---------------- PNG 编码 ---------------- */
function chunk(type, data) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length, 0);
  const t = Buffer.from(type, 'ascii');
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(Buffer.concat([t, data])), 0);
  return Buffer.concat([len, t, data, crc]);
}

function encodePNG(size, rgba) {
  const sig = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(size, 0);
  ihdr.writeUInt32BE(size, 4);
  ihdr[8] = 8; // 位深
  ihdr[9] = 6; // 颜色类型：RGBA
  ihdr[10] = 0;
  ihdr[11] = 0;
  ihdr[12] = 0;

  // 每行前加一个 0 作为滤波类型（None）
  const stride = size * 4;
  const raw = Buffer.alloc((stride + 1) * size);
  for (let y = 0; y < size; y++) {
    raw[y * (stride + 1)] = 0;
    rgba.copy(raw, y * (stride + 1) + 1, y * stride, (y + 1) * stride);
  }

  const idat = zlib.deflateSync(raw, { level: 9 });
  return Buffer.concat([sig, chunk('IHDR', ihdr), chunk('IDAT', idat), chunk('IEND', Buffer.alloc(0))]);
}

/* ---------------- 几何判断 ---------------- */
function inCircle(x, y, cx, cy, r) {
  return (x - cx) ** 2 + (y - cy) ** 2 <= r * r;
}

function sign(p, a, b) {
  return (p[0] - b[0]) * (a[1] - b[1]) - (a[0] - b[0]) * (p[1] - b[1]);
}

function inTriangle(px, py, a, b, c) {
  const d1 = sign([px, py], a, b);
  const d2 = sign([px, py], b, c);
  const d3 = sign([px, py], c, a);
  const hasNeg = d1 < 0 || d2 < 0 || d3 < 0;
  const hasPos = d1 > 0 || d2 > 0 || d3 > 0;
  return !(hasNeg && hasPos);
}

/* ---------------- 绘制猫咪头像（像素级） ---------------- */
function renderIcon(size) {
  const buf = Buffer.alloc(size * size * 4); // 初始透明
  const S = size;
  const N = (x, y) => [x * S, y * S];

  const headC = N(0.5, 0.56);
  const headR = 0.32 * S;
  const earL = [N(0.28, 0.36), N(0.35, 0.12), N(0.47, 0.32)];
  const earR = [N(0.53, 0.32), N(0.65, 0.12), N(0.72, 0.36)];
  const earInL = [N(0.32, 0.33), N(0.35, 0.21), N(0.42, 0.3)];
  const earInR = [N(0.58, 0.3), N(0.65, 0.21), N(0.68, 0.33)];
  const eyeL = N(0.4, 0.54);
  const eyeR = N(0.6, 0.54);
  const eyeRr = 0.035 * S;
  const noseT = [N(0.486, 0.615), N(0.514, 0.615), N(0.5, 0.645)];

  for (let y = 0; y < S; y++) {
    for (let x = 0; x < S; x++) {
      let color = null;
      if (inCircle(x, y, headC[0], headC[1], headR)) color = ORANGE;
      else if (inTriangle(x, y, earL[0], earL[1], earL[2])) color = ORANGE;
      else if (inTriangle(x, y, earR[0], earR[1], earR[2])) color = ORANGE;
      if (!color) continue;

      if (inTriangle(x, y, earInL[0], earInL[1], earInL[2])) color = PINK;
      else if (inTriangle(x, y, earInR[0], earInR[1], earInR[2])) color = PINK;
      else if (inCircle(x, y, eyeL[0], eyeL[1], eyeRr)) color = DARK;
      else if (inCircle(x, y, eyeR[0], eyeR[1], eyeRr)) color = DARK;
      else if (inTriangle(x, y, noseT[0], noseT[1], noseT[2])) color = DARK;

      const i = (y * S + x) * 4;
      buf[i] = color[0];
      buf[i + 1] = color[1];
      buf[i + 2] = color[2];
      buf[i + 3] = 255;
    }
  }
  return buf;
}

/* ---------------- 输出文件 ---------------- */
const dir = path.join(__dirname, 'icons');
fs.mkdirSync(dir, { recursive: true });

for (const size of [16, 32, 48, 128]) {
  const png = encodePNG(size, renderIcon(size));
  fs.writeFileSync(path.join(dir, `icon${size}.png`), png);
  console.log(`已生成 icons/icon${size}.png（${png.length} 字节）`);
}
