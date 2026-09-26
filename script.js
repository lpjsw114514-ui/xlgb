(function () {
'use strict';

/* ==========================================================
   画布 / 尺寸
========================================================== */
const canvas = document.getElementById('c');
const ctx    = canvas.getContext('2d');

let W = 0, H = 0, DPR = 1, cx = 0, cy = 0;
let A = 160;
let baseY = 0;

const TAU = Math.PI * 2;

function resize() {
  DPR = Math.min(window.devicePixelRatio || 1, 2);
  W = window.innerWidth;
  H = window.innerHeight;

  canvas.width  = Math.round(W * DPR);
  canvas.height = Math.round(H * DPR);
  canvas.style.width  = W + 'px';
  canvas.style.height = H + 'px';
  ctx.setTransform(DPR, 0, 0, DPR, 0, 0);

  cx = W / 2;
  cy = H / 2;

  A     = Math.min(H * 0.26, 200);
  baseY = cy + 0.375 * A;
}

window.addEventListener('resize', resize);
window.addEventListener('orientationchange', () => setTimeout(resize, 120));

/* ==========================================================
   设置
========================================================== */
const settings = {
  particles:     true,
  fullscreen:    false,
  particleColor: '#ffffff',
  sway:          'free',
  magnify:       true,
  mark:          true
};

/* ==========================================================
   状态
========================================================== */
const SAMPLE_MS = 5;
const PX_PER_MS = 0.50;

let simTime        = 0;
let nextSampleTime = 0;

let samples = [];
let phase   = 0;
let beatEnv = 0;

let bpm          = 72;
let beatInterval = 60000 / 72;
let speed        = 0;
let usingReal    = false;
let realBpm      = 0;

const sparks  = [];
const ripples = [];
const marks   = [];

/* ==========================================================
   心电波形
========================================================== */
function ecgAt(t) {
  let v = 0;
  v += 0.090 * Math.exp(-Math.pow((t - 0.120) / 0.0250, 2));
  v -= 0.130 * Math.exp(-Math.pow((t - 0.213) / 0.0080, 2));
  v += 1.000 * Math.exp(-Math.pow((t - 0.235) / 0.0105, 2));
  v -= 0.250 * Math.exp(-Math.pow((t - 0.262) / 0.0120, 2));
  v += 0.250 * Math.exp(-Math.pow((t - 0.420) / 0.0480, 2));
  return v;
}

/* ==========================================================
   摆动方向 → 速度向量
========================================================== */
function pickVelocity(spd) {
  const s = settings.sway;
  let ang, vx, vy, cos, sin;

  if (s === 'up') {
    ang = -Math.PI / 2 + (Math.random() - 0.5) * Math.PI * 0.75;
    vx = Math.cos(ang) * spd;
    vy = Math.sin(ang) * spd;
  } else if (s === 'down') {
    ang = Math.PI / 2 + (Math.random() - 0.5) * Math.PI * 0.75;
    vx = Math.cos(ang) * spd;
    vy = Math.sin(ang) * spd;
  } else if (s === 'left') {
    ang = Math.PI + (Math.random() - 0.5) * Math.PI * 0.75;
    vx = Math.cos(ang) * spd;
    vy = Math.sin(ang) * spd;
  } else if (s === 'right') {
    ang = (Math.random() - 0.5) * Math.PI * 0.75;
    vx = Math.cos(ang) * spd;
    vy = Math.sin(ang) * spd;
  } else if (s === 'cw') {
    ang = Math.random() * TAU;
    cos = Math.cos(ang);
    sin = Math.sin(ang);
    vx = (cos * 0.72 + sin * 0.55) * spd;
    vy = (sin * 0.72 - cos * 0.55) * spd;
  } else if (s === 'ccw') {
    ang = Math.random() * TAU;
    cos = Math.cos(ang);
    sin = Math.sin(ang);
    vx = (cos * 0.72 - sin * 0.55) * spd;
    vy = (sin * 0.72 + cos * 0.55) * spd;
  } else {
    ang = Math.random() * TAU;
    vx = Math.cos(ang) * spd;
    vy = Math.sin(ang) * spd;
  }

  return { vx: vx, vy: vy };
}

/* ==========================================================
   心跳 → 粒子迸发
========================================================== */
function onBeat(beatTime) {
  const rx = W - (simTime - beatTime) * PX_PER_MS;
  const ry = baseY - A * 0.95;

  if (settings.particles) {
    /* 主迸发 */
    const n = 48 + (Math.random() * 20 | 0);
    for (let i = 0; i < n; i++) {
      const spd = 30 + Math.random() * 260;
      const v = pickVelocity(spd);
      sparks.push({
        x: rx, y: ry,
        vx: v.vx, vy: v.vy,
        life: 1,
        decay: 0.55 + Math.random() * 0.95,
        size: 0.7 + Math.random() * 1.9,
        trail: [rx, ry],
        maxTrail: 5 + (Math.random() * 7 | 0)
      });
    }

    /* 亮核 */
    for (let i = 0; i < 6; i++) {
      const spd = 20 + Math.random() * 70;
      const v = pickVelocity(spd);
      sparks.push({
        x: rx, y: ry,
        vx: v.vx, vy: v.vy,
        life: 1,
        decay: 0.35 + Math.random() * 0.35,
        size: 2.6 + Math.random() * 1.8,
        trail: [rx, ry],
        maxTrail: 10
      });
    }

    /* 全屏粒子：屏幕各处随机爆发 */
    if (settings.fullscreen) {
      for (let g = 0; g < 10; g++) {
        const gx = Math.random() * W;
        const gy = Math.random() * H * 0.82;
        const cnt = 4 + (Math.random() * 5 | 0);

        for (let i = 0; i < cnt; i++) {
          const spd = 20 + Math.random() * 160;
          const v = pickVelocity(spd);
          sparks.push({
            x: gx, y: gy,
            vx: v.vx, vy: v.vy,
            life: 1,
            decay: 0.5 + Math.random() * 0.9,
            size: 0.6 + Math.random() * 1.5,
            trail: [gx, gy],
            maxTrail: 4 + (Math.random() * 6 | 0)
          });
        }
      }
    }
  }

  /* 涟漪 */
  ripples.push({
    x: rx, y: ry,
    r: 4,
    maxR: 100 + Math.random() * 70,
    life: 1,
    decay: 1.4 + Math.random() * 0.7
  });
}

/* ==========================================================
   更新
========================================================== */
function update(dt) {
  let target;
  if (usingReal && realBpm > 0) {
    target = realBpm;
  } else {
    const now = performance.now() / 1000;
    target = 68 + 112 * (1 - Math.exp(-speed / 7.5))
           + Math.sin(now * 1.50) * 2.2
           + Math.sin(now * 0.53 + 1.3) * 1.6;
  }

  bpm += (target - bpm) * (1 - Math.exp(-dt / 800));
  bpm = Math.max(30, Math.min(220, bpm));
  beatInterval = 60000 / bpm;

  simTime += dt;

  let guard = 0;
  const R = 0.235;

  while (nextSampleTime <= simTime && guard++ < 300) {
    const prevPhase = phase;
    phase += SAMPLE_MS / beatInterval;

    let wrapped = false;
    if (phase >= 1) { phase -= 1; wrapped = true; }

    samples.push({ t: nextSampleTime, v: ecgAt(phase) });

    let hit;
    if (!wrapped) {
      hit = (prevPhase < R && phase >= R);
    } else {
      hit = (prevPhase < R) || (phase >= R);
    }
    if (hit) onBeat(nextSampleTime);

    nextSampleTime += SAMPLE_MS;
  }

  const maxAge = (W + 260) / PX_PER_MS;
  while (samples.length && (simTime - samples[0].t) > maxAge) {
    samples.shift();
  }

  const markAge = (W + 400) / PX_PER_MS;
  for (let i = marks.length - 1; i >= 0; i--) {
    if (simTime - marks[i].t > markAge) marks.splice(i, 1);
  }

  let d = phase - R;
  if (d < 0) d += 1;
  beatEnv = Math.exp(-d * 17);

  bpmVal.textContent = Math.round(bpm);
  bpmVal.style.transform = 'scale(' + (1 + beatEnv * 0.05).toFixed(4) + ')';
}

/* ==========================================================
   绘制：网格
========================================================== */
function drawGrid() {
  const minor = 10, major = 50;

  ctx.lineWidth = 1;

  ctx.strokeStyle = 'rgba(255,255,255,0.030)';
  ctx.beginPath();
  for (let x = 0; x < W; x += minor) { ctx.moveTo(x + .5, 0); ctx.lineTo(x + .5, H); }
  for (let y = 0; y < H; y += minor) { ctx.moveTo(0, y + .5); ctx.lineTo(W, y + .5); }
  ctx.stroke();

  ctx.strokeStyle = 'rgba(255,255,255,0.065)';
  ctx.beginPath();
  for (let x = 0; x < W; x += major) { ctx.moveTo(x + .5, 0); ctx.lineTo(x + .5, H); }
  for (let y = 0; y < H; y += major) { ctx.moveTo(0, y + .5); ctx.lineTo(W, y + .5); }
  ctx.stroke();

  ctx.strokeStyle = 'rgba(255,255,255,0.09)';
  ctx.beginPath();
  ctx.moveTo(0, baseY + .5);
  ctx.lineTo(W, baseY + .5);
  ctx.stroke();
}

/* ==========================================================
   绘制：心电波形
========================================================== */
function drawWave() {
  const n = samples.length;
  if (n < 2) return;

  const path = new Path2D();
  let started = false;

  for (let i = 0; i < n; i++) {
    const s = samples[i];
    const x = W - (simTime - s.t) * PX_PER_MS;
    if (x < -30) continue;
    if (x > W + 30) break;

    const y = baseY - s.v * A;
    if (!started) { path.moveTo(x, y); started = true; }
    else path.lineTo(x, y);
  }
  if (!started) return;

  const grad = ctx.createLinearGradient(0, 0, W * 0.26, 0);
  grad.addColorStop(0, 'rgba(255,255,255,0)');
  grad.addColorStop(1, 'rgba(255,255,255,1)');

  ctx.save();
  ctx.lineCap  = 'round';
  ctx.lineJoin = 'round';
  ctx.strokeStyle = grad;

  const layers = [
    { w: 16,  a: 0.035 },
    { w: 8,   a: 0.070 },
    { w: 4,   a: 0.160 },
    { w: 2,   a: 0.400 },
    { w: 0.95,a: 1.000 }
  ];

  for (let i = 0; i < layers.length; i++) {
    ctx.globalAlpha = layers[i].a;
    ctx.lineWidth   = layers[i].w;
    ctx.stroke(path);
  }

  ctx.restore();
  ctx.globalAlpha = 1;
}

/* ==========================================================
   绘制：打点标记
========================================================== */
function drawMarks() {
  if (marks.length === 0) return;

  ctx.save();
  for (let i = 0; i < marks.length; i++) {
    const m = marks[i];
    const x = W - (simTime - m.t) * PX_PER_MS;
    if (x < -30 || x > W + 30) continue;

    const topY = baseY - A * 1.2;
    const botY = baseY + A * 0.8;

    /* 竖线 */
    ctx.strokeStyle = 'rgba(255,255,255,.28)';
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(x, topY);
    ctx.lineTo(x, botY);
    ctx.stroke();

    /* 光晕 */
    ctx.globalAlpha = 0.28;
    ctx.fillStyle = '#fff';
    ctx.beginPath();
    ctx.arc(x, topY, 8, 0, TAU);
    ctx.fill();
    ctx.globalAlpha = 1;

    /* 圆点 */
    ctx.fillStyle = '#fff';
    ctx.beginPath();
    ctx.arc(x, topY, 3.5, 0, TAU);
    ctx.fill();
  }
  ctx.restore();
}

/* ==========================================================
   绘制：粒子 + 拖尾 + 涟漪
========================================================== */
function drawSparks(dtSec) {
  ctx.save();
  ctx.globalCompositeOperation = 'lighter';

  const damp    = Math.pow(0.14, dtSec);
  const gravity = 55;
  const col     = settings.particleColor;

  for (let i = sparks.length - 1; i >= 0; i--) {
    const p = sparks[i];

    p.life -= dtSec * p.decay;
    if (p.life <= 0) { sparks.splice(i, 1); continue; }

    p.trail.push(p.x, p.y);
    while (p.trail.length > p.maxTrail * 2) {
      p.trail.shift();
      p.trail.shift();
    }

    p.vy += gravity * dtSec;
    p.x  += p.vx * dtSec;
    p.y  += p.vy * dtSec;
    p.vx *= damp;
    p.vy *= damp;

    const a = p.life * p.life;

    /* 拖尾 */
    const tn = p.trail.length / 2;
    for (let j = 0; j < tn; j++) {
      const k  = j / tn;
      const ta = a * k * k * 0.45;
      if (ta < 0.01) continue;

      const tr = p.size * k * 0.85;
      if (tr < 0.2) continue;

      ctx.globalAlpha = ta;
      ctx.fillStyle = col;
      ctx.beginPath();
      ctx.arc(p.trail[j * 2], p.trail[j * 2 + 1], tr, 0, TAU);
      ctx.fill();
    }

    /* 核心 */
    const cr = p.size * (0.5 + p.life * 0.9);
    ctx.globalAlpha = a;
    ctx.fillStyle = col;
    ctx.beginPath();
    ctx.arc(p.x, p.y, cr, 0, TAU);
    ctx.fill();

    /* 大粒子十字光芒 */
    if (p.size > 2.2 && p.life > 0.4) {
      const L = p.size * 3.5 * p.life;
      ctx.globalAlpha = a * 0.5;
      ctx.fillRect(p.x - L, p.y - 0.5, L * 2, 1);
      ctx.fillRect(p.x - 0.5, p.y - L, 1, L * 2);
    }
  }

  /* 涟漪 */
  for (let i = ripples.length - 1; i >= 0; i--) {
    const rp = ripples[i];
    rp.life -= dtSec * rp.decay;
    if (rp.life <= 0) { ripples.splice(i, 1); continue; }

    const t    = 1 - rp.life;
    const ease = 1 - Math.pow(1 - t, 2.4);
    const r    = rp.r + (rp.maxR - rp.r) * ease;

    ctx.globalAlpha = rp.life * rp.life * 0.5;
    ctx.strokeStyle = col;
    ctx.lineWidth   = 1.5 * rp.life + 0.2;
    ctx.beginPath();
    ctx.arc(rp.x, rp.y, r, 0, TAU);
    ctx.stroke();
  }

  ctx.restore();
  ctx.globalAlpha = 1;
}

/* ==========================================================
   绘制：局部放大窗口
========================================================== */
function roundRect(c, x, y, w, h, r) {
  c.beginPath();
  c.moveTo(x + r, y);
  c.arcTo(x + w, y, x + w, y + h, r);
  c.arcTo(x + w, y + h, x, y + h, r);
  c.arcTo(x, y + h, x, y, r);
  c.arcTo(x, y, x + w, y, r);
  c.closePath();
}

function drawMagnify() {
  if (!settings.magnify) return;
  if (samples.length < 10) return;

  const boxW = Math.min(260, W * 0.36);
  const boxH = boxW * 0.62;
  const bx = W - boxW - 20;
  const by = H - boxH - 140;

  /* 找最近一个心跳周期的采样 */
  const startT = simTime - beatInterval * 0.98;
  const seg = [];
  for (let i = samples.length - 1; i >= 0; i--) {
    const s = samples[i];
    if (s.t < startT) break;
    seg.unshift(s);
  }
  if (seg.length < 4) return;

  ctx.save();

  /* 背景 */
  ctx.fillStyle = 'rgba(0,0,0,.58)';
  ctx.strokeStyle = 'rgba(255,255,255,.18)';
  ctx.lineWidth = 1;
  roundRect(ctx, bx, by, boxW, boxH, 10);
  ctx.fill();
  ctx.stroke();

  /* 标题 */
  ctx.fillStyle = 'rgba(255,255,255,.45)';
  ctx.font = '10px ui-monospace, "SF Mono", Menlo, monospace';
  ctx.textBaseline = 'top';
  ctx.fillText('ECG · 局部放大', bx + 11, by + 9);

  /* 缩放参数 */
  const padX = 10;
  const padY = 26;
  const innerW = boxW - padX * 2;
  const innerH = boxH - padY - 8;
  const midY = by + padY + innerH / 2;

  const tStart = seg[0].t;
  const tEnd   = seg[seg.length - 1].t;
  const tSpan  = (tEnd - tStart) || 1;

  const scaleX = innerW / tSpan;
  const scaleY = innerH * 0.40;

  const path = new Path2D();
  for (let i = 0; i < seg.length; i++) {
    const s = seg[i];
    const px = bx + padX + (s.t - tStart) * scaleX;
    const py = midY - s.v * scaleY;
    if (i === 0) path.moveTo(px, py);
    else path.lineTo(px, py);
  }

  ctx.lineCap  = 'round';
  ctx.lineJoin = 'round';
  ctx.strokeStyle = '#fff';

  const layers = [
    { w: 9,  a: 0.05 },
    { w: 4.5,a: 0.15 },
    { w: 2.2,a: 0.45 },
    { w: 1,  a: 1.00 }
  ];

  for (let i = 0; i < layers.length; i++) {
    ctx.globalAlpha = layers[i].a;
    ctx.lineWidth   = layers[i].w;
    ctx.stroke(path);
  }

  ctx.globalAlpha = 1;
  ctx.restore();
}

/* ==========================================================
   渲染
========================================================== */
function render(dtSec) {
  ctx.fillStyle = '#000';
  ctx.fillRect(0, 0, W, H);

  drawGrid();
  drawWave();
  drawMarks();
  drawSparks(dtSec);
  drawMagnify();
}

/* ==========================================================
   主循环
========================================================== */
let lastT = 0;

function loop(now) {
  if (!lastT) lastT = now;
  let dt = now - lastT;
  lastT = now;

  if (dt < 0)  dt = 0;
  if (dt > 50) dt = 50;

  update(dt);
  render(dt / 1000);

  requestAnimationFrame(loop);
}

/* ==========================================================
   DOM 引用
========================================================== */
const btnConn  = document.getElementById('btnConnect');
const statusEl = document.getElementById('status');
const speedEl  = document.getElementById('speed');
const speedVal = document.getElementById('speedVal');
const bpmVal   = document.getElementById('bpmVal');
const srcTag   = document.getElementById('srcTag');

const aboutBtn     = document.getElementById('aboutBtn');
const settingsBtn  = document.getElementById('settingsBtn');

const aboutPanel    = document.getElementById('aboutPanel');
const settingsPanel = document.getElementById('settingsPanel');
const helpPanel     = document.getElementById('helpPanel');

const aboutClose    = document.getElementById('aboutClose');
const settingsClose = document.getElementById('settingsClose');
const helpClose     = document.getElementById('helpClose');

const qqLink    = document.getElementById('qqLink');
const showHelp  = document.getElementById('showHelp');
const clearMarks= document.getElementById('clearMarks');

/* 设置控件 */
const setParticles  = document.getElementById('setParticles');
const setFullscreen = document.getElementById('setFullscreen');
const setMagnify    = document.getElementById('setMagnify');
const setMark       = document.getElementById('setMark');
const setSway       = document.getElementById('setSway');
const colorRow      = document.getElementById('colorRow');

/* ==========================================================
   模态面板控制
========================================================== */
function openModal(el)  { el.classList.add('show'); }
function closeModal(el) { el.classList.remove('show'); }
function closeAllModals() {
  closeModal(aboutPanel);
  closeModal(settingsPanel);
  closeModal(helpPanel);
}

aboutBtn.addEventListener('click', function () {
  closeModal(settingsPanel);
  closeModal(helpPanel);
  openModal(aboutPanel);
});

settingsBtn.addEventListener('click', function () {
  closeModal(aboutPanel);
  closeModal(helpPanel);
  openModal(settingsPanel);
});

aboutClose.addEventListener('click', function () { closeModal(aboutPanel); });
settingsClose.addEventListener('click', function () { closeModal(settingsPanel); });
helpClose.addEventListener('click', function () { closeModal(helpPanel); });

[aboutPanel, settingsPanel, helpPanel].forEach(function (p) {
  p.addEventListener('click', function (e) {
    if (e.target === p) closeModal(p);
  });
});

document.addEventListener('keydown', function (e) {
  if (e.key === 'Escape') closeAllModals();
});

/* 使用说明 */
showHelp.addEventListener('click', function () {
  closeModal(settingsPanel);
  openModal(helpPanel);
});

/* ==========================================================
   设置项绑定
========================================================== */
setParticles.checked  = settings.particles;
setFullscreen.checked = settings.fullscreen;
setMagnify.checked    = settings.magnify;
setMark.checked       = settings.mark;
setSway.value         = settings.sway;

setParticles.addEventListener('change', function () {
  settings.particles = setParticles.checked;
});

setFullscreen.addEventListener('change', function () {
  settings.fullscreen = setFullscreen.checked;
});

setMagnify.addEventListener('change', function () {
  settings.magnify = setMagnify.checked;
});

setMark.addEventListener('change', function () {
  settings.mark = setMark.checked;
});

setSway.addEventListener('change', function () {
  settings.sway = setSway.value;
});

/* 颜色选择 */
colorRow.addEventListener('click', function (e) {
  const btn = e.target.closest('.colorDot');
  if (!btn) return;

  const all = colorRow.querySelectorAll('.colorDot');
  for (let i = 0; i < all.length; i++) all[i].classList.remove('active');
  btn.classList.add('active');

  settings.particleColor = btn.dataset.color;
});

/* 清除标记 */
clearMarks.addEventListener('click', function () {
  marks.length = 0;
});

/* ==========================================================
   QQ 群：点击复制群号
========================================================== */
function fallbackCopy(text, cb) {
  try {
    const ta = document.createElement('textarea');
    ta.value = text;
    ta.style.position = 'fixed';
    ta.style.opacity  = '0';
    document.body.appendChild(ta);
    ta.select();
    document.execCommand('copy');
    document.body.removeChild(ta);
    cb && cb();
  } catch (e) {}
}

if (qqLink) {
  qqLink.addEventListener('click', function () {
    const qq = qqLink.dataset.qq;

    const done = function () {
      const old = qqLink.textContent;
      qqLink.classList.add('copied');
      qqLink.textContent = '已复制群号 ✓';
      setTimeout(function () {
        qqLink.classList.remove('copied');
        qqLink.textContent = old;
      }, 1400);
    };

    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(qq).then(done).catch(function () {
        fallbackCopy(qq, done);
      });
    } else {
      fallbackCopy(qq, done);
    }
  });
}

/* ==========================================================
   Canvas 点击：添加运动节点标记
========================================================== */
canvas.addEventListener('click', function (e) {
  if (!settings.mark) return;

  const x = e.clientX;
  const y = e.clientY;

  /* 只在波形区域附近添加 */
  if (y < baseY - A * 1.7 || y > baseY + A * 1.7) return;

  /* 排除局部放大窗口区域 */
  if (settings.magnify) {
    const boxW = Math.min(260, W * 0.36);
    const boxH = boxW * 0.62;
    const bx = W - boxW - 20;
    const by = H - boxH - 140;
    if (x >= bx && x <= bx + boxW && y >= by && y <= by + boxH) return;
  }

  const t = simTime - (W - x) / PX_PER_MS;
  marks.push({ t: t });
});

/* ==========================================================
   蓝牙心率
========================================================== */
function setStatus(text, cls) {
  statusEl.textContent = text;
  statusEl.className = cls || '';
}

function parseHR(event) {
  const dv = event.target.value;
  if (!dv || dv.byteLength < 2) return;

  const flags = dv.getUint8(0);
  const is16  = (flags & 0x01) !== 0;
  const hr    = is16 ? dv.getUint16(1, true) : dv.getUint8(1);

  if (hr >= 25 && hr <= 230) {
    realBpm   = hr;
    usingReal = true;
  }
}

async function connect() {
  if (!navigator.bluetooth) {
    setStatus('当前浏览器不支持 Web Bluetooth', 'warn');
    return;
  }

  try {
    btnConn.disabled = true;
    setStatus('正在搜索附近的心率设备…');

    const device = await navigator.bluetooth.requestDevice({
      filters: [{ services: ['heart_rate'] }]
      // 若设备未广播标准服务，可改为：
      // acceptAllDevices: true,
      // optionalServices: ['heart_rate']
    });

    device.addEventListener('gattserverdisconnected', onDisconnected);
    setStatus('正在连接 ' + (device.name || '未知设备') + ' …');

    const server = await device.gatt.connect();
    const svc    = await server.getPrimaryService('heart_rate');
    const ch     = await svc.getCharacteristic('heart_rate_measurement');

    await ch.startNotifications();
    ch.addEventListener('characteristicvaluechanged', parseHR);

    usingReal = true;
    speedEl.disabled = true;

    btnConn.textContent = '断开连接';
    btnConn.dataset.on  = '1';
    btnConn.disabled    = false;

    srcTag.textContent = 'LIVE';
    setStatus('已连接 · ' + (device.name || '心率设备') + ' · 实时接收中', 'ok');

  } catch (err) {
    btnConn.disabled = false;
    usingReal = false;
    speedEl.disabled = false;

    if (err && err.name === 'NotFoundError') {
      setStatus('已取消选择设备');
    } else if (err && err.name === 'SecurityError') {
      setStatus('需要 HTTPS 或 localhost 才能使用蓝牙', 'warn');
    } else {
      setStatus('连接失败：' + (err && err.message ? err.message : err), 'warn');
    }
  }
}

function onDisconnected() {
  usingReal = false;
  speedEl.disabled = false;
  btnConn.textContent = '连接心率设备';
  btnConn.dataset.on  = '0';
  srcTag.textContent  = 'SIM';
  setStatus('设备已断开 · 已切回模拟模式');
}

btnConn.addEventListener('click', function () {
  if (btnConn.dataset.on === '1') {
    if (navigator.bluetooth && navigator.bluetooth.getDevices) {
      navigator.bluetooth.getDevices().then(function (list) {
        list.forEach(function (d) {
          try { if (d.gatt && d.gatt.connected) d.gatt.disconnect(); } catch (e) {}
        });
      }).catch(function () {});
    }
    onDisconnected();
    return;
  }
  connect();
});

/* ==========================================================
   速度滑块
========================================================== */
speedEl.addEventListener('input', function () {
  speed = parseFloat(speedEl.value) || 0;
  speedVal.textContent = speed.toFixed(1) + ' km/h';
});

/* ==========================================================
   初始化
========================================================== */
function init() {
  if (!navigator.bluetooth) {
    btnConn.disabled = true;
    btnConn.textContent = '浏览器不支持 Web Bluetooth';
    setStatus('请使用 Chrome / Edge（HTTPS 或 localhost）', 'warn');
  } else if (location.protocol === 'file:') {
    setStatus('提示：蓝牙需在 https 或 localhost 下使用', 'warn');
  }

  speedVal.textContent = speed.toFixed(1) + ' km/h';

  resize();
  nextSampleTime = 0;
  simTime = 0;

  requestAnimationFrame(loop);
}

init();

})();
