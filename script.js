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

  schedulePanelRectsUpdate();
}

window.addEventListener('resize', resize);
window.addEventListener('orientationchange', () => setTimeout(resize, 120));

/* ==========================================================
   设置
========================================================== */
const settings = {
  glass:         false,
  glassAlpha:    0.30,
  edgeWarp:      true,
  warpStrength:  1.0,
  particles:     true,
  density:       1.6,
  particleColor: '#ffffff',
  sway:          'free',
  fullDist:      false,
  anchor:        'rpeak',
  customAnchor:  { x: 0.5, y: 0.5 },
  radiusPct:     60,
  magnify:       true,
  mark:          true,
  signal:        true,
  sigStrength:   true
};

/* ==========================================================
   状态
========================================================== */
const SAMPLE_MS = 5;
const PX_PER_MS = 0.50;
const MAX_SPARKS = 9000;

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

let signalStrength = 0;
let lastPacketTime = performance.now();

let pickingAnchor = false;

const sparks  = [];
const ripples = [];
const marks   = [];

/* ==========================================================
   玻璃面板边缘挤压
   —— 每帧获取所有玻璃面板的矩形，粒子经过其边缘时被拉伸
========================================================== */
const panelRects = [];        // 缓存的面板矩形
let panelRectsDirty = false;

function schedulePanelRectsUpdate() {
  panelRectsDirty = true;
}

function updatePanelRects() {
  panelRects.length = 0;

  const selectors = [
    '.topBtn',
    '#panel',
    '.modalCard',
    '.modalClose',
    '#btnConnect'
  ];

  for (let i = 0; i < selectors.length; i++) {
    const els = document.querySelectorAll(selectors[i]);
    for (let j = 0; j < els.length; j++) {
      const el = els[j];
      const r = el.getBoundingClientRect();
      if (r.width > 4 && r.height > 4 && r.bottom > 0 && r.top < H) {
        panelRects.push({
          x: r.left,
          y: r.top,
          w: r.width,
          h: r.height
        });
      }
    }
  }

  panelRectsDirty = false;
}

/* 计算点到矩形的最近点 */
function nearestPointOnRect(px, py, rect) {
  const nx = Math.max(rect.x, Math.min(px, rect.x + rect.w));
  const ny = Math.max(rect.y, Math.min(py, rect.y + rect.h));
  return { x: nx, y: ny };
}

/* 对粒子位置和形状应用挤压
   —— 返回绘制时使用的显示坐标和缩放系数 */
const INFLUENCE = 60;   // 影响半径（px）

function getEdgeWarp(px, py) {
  if (!settings.edgeWarp || panelRects.length === 0) {
    return { dx: 0, dy: 0, sx: 1, sy: 1, rot: 0 };
  }

  let bestT = 0;
  let bestDx = 0, bestDy = 0;
  let bestNx = 0, bestNy = 0;
  let bestInside = false;

  for (let i = 0; i < panelRects.length; i++) {
    const rect = panelRects[i];

    const np = nearestPointOnRect(px, py, rect);
    const ndx = px - np.x;
    const ndy = py - np.y;
    const dist = Math.hypot(ndx, ndy);

    if (dist > INFLUENCE) continue;

    const inside =
      px > rect.x && px < rect.x + rect.w &&
      py > rect.y && py < rect.y + rect.h;

    const t = 1 - dist / INFLUENCE;
    if (t > bestT) {
      bestT = t;
      bestDx = ndx;
      bestDy = ndy;
      bestInside = inside;
      if (dist > 0.001) {
        bestNx = ndx / dist;
        bestNy = ndy / dist;
      }
    }
  }

  if (bestT <= 0) {
    return { dx: 0, dy: 0, sx: 1, sy: 1, rot: 0 };
  }

  const strength = settings.warpStrength || 1.0;

  /* 挤压：越靠近边缘，垂直方向越被压缩、平行方向越被拉长 */
  const stretch = bestT * bestT * 2.2 * strength;

  /* 位移：外部向内拉，内部向边缘推 */
  const pull = bestT * bestT * 14 * strength;

  const dx = bestInside ? bestNx * pull : -bestNx * pull;
  const dy = bestInside ? bestNy * pull : -bestNy * pull;

  /* 椭圆方向：沿法线方向拉长，切向压缩 */
  const rot = Math.atan2(bestNy, bestNx);

  return {
    dx: dx,
    dy: dy,
    sx: 1 + stretch,               // 沿法线拉伸
    sy: 1 / (1 + stretch * 0.45),  // 沿切线压缩
    rot: rot
  };
}

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
    vx = Math.cos(ang) * spd; vy = Math.sin(ang) * spd;
  } else if (s === 'down') {
    ang = Math.PI / 2 + (Math.random() - 0.5) * Math.PI * 0.75;
    vx = Math.cos(ang) * spd; vy = Math.sin(ang) * spd;
  } else if (s === 'left') {
    ang = Math.PI + (Math.random() - 0.5) * Math.PI * 0.75;
    vx = Math.cos(ang) * spd; vy = Math.sin(ang) * spd;
  } else if (s === 'right') {
    ang = (Math.random() - 0.5) * Math.PI * 0.75;
    vx = Math.cos(ang) * spd; vy = Math.sin(ang) * spd;
  } else if (s === 'cw') {
    ang = Math.random() * TAU;
    cos = Math.cos(ang); sin = Math.sin(ang);
    vx = (cos * 0.72 + sin * 0.55) * spd;
    vy = (sin * 0.72 - cos * 0.55) * spd;
  } else if (s === 'ccw') {
    ang = Math.random() * TAU;
    cos = Math.cos(ang); sin = Math.sin(ang);
    vx = (cos * 0.72 - sin * 0.55) * spd;
    vy = (sin * 0.72 + cos * 0.55) * spd;
  } else {
    ang = Math.random() * TAU;
    vx = Math.cos(ang) * spd; vy = Math.sin(ang) * spd;
  }
  return { vx: vx, vy: vy };
}

function addSpark(p) {
  sparks.push(p);
  if (sparks.length > MAX_SPARKS) {
    sparks.splice(0, sparks.length - MAX_SPARKS);
  }
}

function getCloudCenter(rx, ry) {
  if (settings.fullDist) return { x: W / 2, y: H / 2 };
  const a = settings.anchor;
  if (a === 'center') return { x: W / 2, y: H / 2 };
  if (a === 'top')    return { x: W / 2, y: H * 0.22 };
  if (a === 'bottom') return { x: W / 2, y: H * 0.78 };
  if (a === 'left')   return { x: W * 0.22, y: H / 2 };
  if (a === 'right')  return { x: W * 0.78, y: H / 2 };
  if (a === 'custom') return { x: W * settings.customAnchor.x, y: H * settings.customAnchor.y };
  return { x: rx, y: ry };
}

function getCloudRadius() {
  if (settings.fullDist) return Math.hypot(W, H) * 0.55;
  return Math.min(W, H) * (settings.radiusPct / 100);
}

/* ==========================================================
   信号灯脉冲
========================================================== */
const signalEl = document.getElementById('signal');

function signalPulse() {
  if (!settings.signal || !signalEl) return;
  signalEl.classList.remove('beat');
  void signalEl.offsetWidth;
  signalEl.classList.add('beat');
}

/* ==========================================================
   心跳 → 粒子迸发
========================================================== */
function onBeat(beatTime) {
  const rx = W - (simTime - beatTime) * PX_PER_MS;
  const ry = baseY - A * 0.95;

  signalPulse();

  if (settings.particles) {
    const mult = settings.density || 1.6;
    const center = getCloudCenter(rx, ry);
    const cloudR = getCloudRadius();

    const baseN = settings.fullDist ? 480 : 320;
    const n = Math.round((baseN + Math.random() * 180) * mult);

    for (let i = 0; i < n; i++) {
      const ang = Math.random() * TAU;
      const u = Math.random();
      const r = cloudR * Math.pow(u, settings.fullDist ? 0.62 : 0.55);
      const px = center.x + Math.cos(ang) * r;
      const py = center.y + Math.sin(ang) * r * 0.88;
      if (px < -40 || px > W + 40 || py < -40 || py > H + 40) continue;

      const spd = 6 + Math.random() * 44;
      const v = pickVelocity(spd);

      addSpark({
        x: px, y: py, vx: v.vx, vy: v.vy,
        life: 1,
        decay: 0.055 + Math.random() * 0.14,
        size: 1.4,
        trail: null,
        twinklePhase: Math.random() * TAU,
        twinkleSpeed: 1.2 + Math.random() * 4.5,
        star: true
      });
    }

    const nc = Math.round(18 * mult);
    for (let i = 0; i < nc; i++) {
      const spd = 25 + Math.random() * 120;
      const v = pickVelocity(spd);
      addSpark({
        x: rx, y: ry, vx: v.vx, vy: v.vy,
        life: 1,
        decay: 0.35 + Math.random() * 0.4,
        size: 3.0,
        trail: [rx, ry],
        maxTrail: 9,
        star: false
      });
    }
  }

  ripples.push({
    x: rx, y: ry, r: 4,
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
    if (!wrapped) hit = (prevPhase < R && phase >= R);
    else          hit = (prevPhase < R) || (phase >= R);
    if (hit) onBeat(nextSampleTime);

    nextSampleTime += SAMPLE_MS;
  }

  const maxAge = (W + 260) / PX_PER_MS;
  while (samples.length && (simTime - samples[0].t) > maxAge) samples.shift();

  const markAge = (W + 400) / PX_PER_MS;
  for (let i = marks.length - 1; i >= 0; i--) {
    if (simTime - marks[i].t > markAge) marks.splice(i, 1);
  }

  let d = phase - R;
  if (d < 0) d += 1;
  beatEnv = Math.exp(-d * 17);

  bpmVal.textContent = Math.round(bpm);
  bpmVal.style.transform = 'scale(' + (1 + beatEnv * 0.05).toFixed(4) + ')';

  if (usingReal) {
    const sinceLast = performance.now() - lastPacketTime;
    if (sinceLast > 3000)      signalStrength -= dt * 0.05;
    else if (sinceLast > 1500) signalStrength -= dt * 0.015;
    else signalStrength += (98 - signalStrength) * (1 - Math.exp(-dt / 1500));
  } else {
    const tgt = 88 + Math.sin(performance.now() / 2000) * 4;
    signalStrength += (tgt - signalStrength) * (1 - Math.exp(-dt / 800));
  }
  signalStrength = Math.max(0, Math.min(100, signalStrength));

  updateSigStrengthUI();
}

/* ==========================================================
   信号强度 UI
========================================================== */
const sigBarEls = document.querySelectorAll('#sigStrengthRow .sigBars i');
const sigPctEl  = document.getElementById('sigPct');

function updateSigStrengthUI() {
  const v = signalStrength;
  const level = v >= 85 ? 4 : v >= 60 ? 3 : v >= 35 ? 2 : v >= 12 ? 1 : 0;
  for (let i = 0; i < sigBarEls.length; i++) {
    if (i < level) sigBarEls[i].classList.add('on');
    else sigBarEls[i].classList.remove('on');
  }
  sigPctEl.textContent = Math.round(v) + '%';
}

/* ==========================================================
   绘制
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

function drawMarks() {
  if (marks.length === 0) return;
  ctx.save();
  for (let i = 0; i < marks.length; i++) {
    const m = marks[i];
    const x = W - (simTime - m.t) * PX_PER_MS;
    if (x < -30 || x > W + 30) continue;

    const topY = baseY - A * 1.2;
    const botY = baseY + A * 0.8;

    ctx.strokeStyle = 'rgba(255,255,255,.28)';
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(x, topY);
    ctx.lineTo(x, botY);
    ctx.stroke();

    ctx.globalAlpha = 0.28;
    ctx.fillStyle = '#fff';
    ctx.beginPath();
    ctx.arc(x, topY, 8, 0, TAU);
    ctx.fill();
    ctx.globalAlpha = 1;

    ctx.fillStyle = '#fff';
    ctx.beginPath();
    ctx.arc(x, topY, 3.5, 0, TAU);
    ctx.fill();
  }
  ctx.restore();
}

function drawPickerCrosshair() {
  if (!pickingAnchor) return;
  if (!mouseX && !mouseY) return;
  ctx.save();
  ctx.strokeStyle = 'rgba(255,255,255,.55)';
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.moveTo(mouseX - 22, mouseY); ctx.lineTo(mouseX - 6, mouseY);
  ctx.moveTo(mouseX + 6, mouseY);  ctx.lineTo(mouseX + 22, mouseY);
  ctx.moveTo(mouseX, mouseY - 22); ctx.lineTo(mouseX, mouseY - 6);
  ctx.moveTo(mouseX, mouseY + 6);  ctx.lineTo(mouseX, mouseY + 22);
  ctx.stroke();
  ctx.beginPath();
  ctx.arc(mouseX, mouseY, 3, 0, TAU);
  ctx.stroke();
  ctx.restore();
}

let mouseX = 0, mouseY = 0;

/* ==========================================================
   绘制粒子（带玻璃边缘挤压）
========================================================== */
function drawSparks(dtSec) {
  ctx.save();
  ctx.globalCompositeOperation = 'lighter';

  const damp    = Math.pow(0.30, dtSec);
  const col     = settings.particleColor;
  const timeSec = simTime * 0.001;

  for (let i = sparks.length - 1; i >= 0; i--) {
    const p = sparks[i];

    /* 真实物理更新 */
    p.life -= dtSec * p.decay;
    if (p.life <= 0) { sparks.splice(i, 1); continue; }

    p.x += p.vx * dtSec;
    p.y += p.vy * dtSec;
    p.vx *= damp;
    p.vy *= damp;
    if (p.star) p.vy -= 2.5 * dtSec;

    const a = p.life * p.life;

    let tw = 1;
    if (p.star) {
      const s = Math.sin(p.twinklePhase + timeSec * p.twinkleSpeed);
      tw = 0.22 + 0.78 * (0.5 + 0.5 * s);
    }

    /* 应用玻璃边缘挤压（仅改变绘制时的位置和形状，不改变真实位置） */
    const warp = getEdgeWarp(p.x, p.y);
    const drawX = p.x + warp.dx;
    const drawY = p.y + warp.dy;

    /* 拖尾 */
    if (p.trail && p.trail.length) {
      p.trail.push(drawX, drawY);
      while (p.trail.length > p.maxTrail * 2) {
        p.trail.shift(); p.trail.shift();
      }
      const tn = p.trail.length / 2;
      for (let j = 0; j < tn; j++) {
        const k = j / tn;
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
    }

    const cr = p.size * (0.5 + p.life * 0.9);

    /* 粒子核心：如果有挤压，绘制成椭圆 */
    if (warp.sx !== 1 || warp.sy !== 1) {
      ctx.save();
      ctx.translate(drawX, drawY);
      ctx.rotate(warp.rot);
      ctx.scale(warp.sx, warp.sy);

      ctx.globalAlpha = a * tw;
      ctx.fillStyle = col;
      ctx.beginPath();
      ctx.arc(0, 0, cr, 0, TAU);
      ctx.fill();

      if (p.star && p.size > 1.0) {
        ctx.globalAlpha = a * tw * 0.22;
        ctx.beginPath();
        ctx.arc(0, 0, cr * 3.2, 0, TAU);
        ctx.fill();
      }

      ctx.restore();
    } else {
      ctx.globalAlpha = a * tw;
      ctx.fillStyle = col;
      ctx.beginPath();
      ctx.arc(drawX, drawY, cr, 0, TAU);
      ctx.fill();

      if (p.star && p.size > 1.0) {
        ctx.globalAlpha = a * tw * 0.22;
        ctx.beginPath();
        ctx.arc(drawX, drawY, cr * 3.2, 0, TAU);
        ctx.fill();
      }
    }

    /* 亮核的十字光芒 */
    if (!p.star && p.size > 2.2 && p.life > 0.4) {
      const L = p.size * 3.5 * p.life;
      ctx.globalAlpha = a * 0.5;
      ctx.fillRect(drawX - L, drawY - 0.5, L * 2, 1);
      ctx.fillRect(drawX - 0.5, drawY - L, 1, L * 2);
    }
  }

  /* 涟漪 */
  for (let i = ripples.length - 1; i >= 0; i--) {
    const rp = ripples[i];
    rp.life -= dtSec * rp.decay;
    if (rp.life <= 0) { ripples.splice(i, 1); continue; }
    const t = 1 - rp.life;
    const ease = 1 - Math.pow(1 - t, 2.4);
    const r = rp.r + (rp.maxR - rp.r) * ease;
    ctx.globalAlpha = rp.life * rp.life * 0.5;
    ctx.strokeStyle = col;
    ctx.lineWidth = 1.5 * rp.life + 0.2;
    ctx.beginPath();
    ctx.arc(rp.x, rp.y, r, 0, TAU);
    ctx.stroke();
  }

  ctx.restore();
  ctx.globalAlpha = 1;
}

/* ==========================================================
   局部放大
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

  const startT = simTime - beatInterval * 0.98;
  const seg = [];
  for (let i = samples.length - 1; i >= 0; i--) {
    const s = samples[i];
    if (s.t < startT) break;
    seg.unshift(s);
  }
  if (seg.length < 4) return;

  ctx.save();
  ctx.fillStyle = 'rgba(0,0,0,.58)';
  ctx.strokeStyle = 'rgba(255,255,255,.18)';
  ctx.lineWidth = 1;
  roundRect(ctx, bx, by, boxW, boxH, 10);
  ctx.fill();
  ctx.stroke();

  ctx.fillStyle = 'rgba(255,255,255,.45)';
  ctx.font = '10px ui-monospace, "SF Mono", Menlo, monospace';
  ctx.textBaseline = 'top';
  ctx.fillText('ECG · 局部放大', bx + 11, by + 9);

  const padX = 10, padY = 26;
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

  ctx.lineCap = 'round';
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
    ctx.lineWidth = layers[i].w;
    ctx.stroke(path);
  }
  ctx.globalAlpha = 1;
  ctx.restore();
}

function render(dtSec) {
  /* 每次渲染前，如果面板矩形需要更新，就重新计算一次 */
  if (panelRectsDirty) updatePanelRects();

  ctx.fillStyle = '#000';
  ctx.fillRect(0, 0, W, H);
  drawGrid();
  drawWave();
  drawMarks();
  drawSparks(dtSec);
  drawPickerCrosshair();
  drawMagnify();
}

let lastT = 0;
function loop(now) {
  if (!lastT) lastT = now;
  let dt = now - lastT;
  lastT = now;
  if (dt < 0) dt = 0;
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
const pickHintEl = document.getElementById('pickHint');

const setGlass      = document.getElementById('setGlass');
const setGlassAlpha = document.getElementById('setGlassAlpha');
const glassAlphaRow = document.getElementById('glassAlphaRow');
const glassAlphaHint= document.getElementById('glassAlphaHint');

const setEdgeWarp      = document.getElementById('setEdgeWarp');
const setWarpStrength  = document.getElementById('setWarpStrength');
const edgeWarpRow      = document.getElementById('edgeWarpRow');
const warpStrengthRow  = document.getElementById('warpStrengthRow');
const warpStrengthHint = document.getElementById('warpStrengthHint');

const setParticles  = document.getElementById('setParticles');
const setMagnify    = document.getElementById('setMagnify');
const setMark       = document.getElementById('setMark');
const setSway       = document.getElementById('setSway');
const setDensity    = document.getElementById('setDensity');
const setSignal     = document.getElementById('setSignal');
const setSigStrength= document.getElementById('setSigStrength');
const setFullDist   = document.getElementById('setFullDist');
const setAnchor     = document.getElementById('setAnchor');
const setRadius     = document.getElementById('setRadius');
const pickAnchorBtn = document.getElementById('pickAnchor');

const anchorRow       = document.getElementById('anchorRow');
const customAnchorRow = document.getElementById('customAnchorRow');
const radiusRow       = document.getElementById('radiusRow');
const customAnchorHint= document.getElementById('customAnchorHint');
const radiusHint      = document.getElementById('radiusHint');

const colorRow       = document.getElementById('colorRow');
const sigStrengthRow = document.getElementById('sigStrengthRow');

/* ==========================================================
   液态玻璃开关
========================================================== */
function applyGlass() {
  if (settings.glass) {
    document.body.classList.add('liquid-glass');
    glassAlphaRow.style.display = '';
    edgeWarpRow.style.display = '';
    warpStrengthRow.style.display = '';

    document.documentElement.style.setProperty('--glass-alpha', settings.glassAlpha);
    glassAlphaHint.textContent = Math.round(settings.glassAlpha * 100) + '%';
    warpStrengthHint.textContent = Math.round(settings.warpStrength * 100) + '%';

    /* 开启液态玻璃时，立即重新获取面板矩形位置 */
    schedulePanelRectsUpdate();
  } else {
    document.body.classList.remove('liquid-glass');
    glassAlphaRow.style.display = 'none';
    edgeWarpRow.style.display = 'none';
    warpStrengthRow.style.display = 'none';
  }
}

function updateGlassAlpha(val) {
  settings.glassAlpha = val;
  document.documentElement.style.setProperty('--glass-alpha', val);
  glassAlphaHint.textContent = Math.round(val * 100) + '%';
}

/* ==========================================================
   模态面板
========================================================== */
function openModal(el)  { el.classList.add('show'); schedulePanelRectsUpdate(); }
function closeModal(el) { el.classList.remove('show'); schedulePanelRectsUpdate(); }
function closeAllModals() {
  closeModal(aboutPanel);
  closeModal(settingsPanel);
  closeModal(helpPanel);
}

aboutBtn.addEventListener('click', () => {
  closeModal(settingsPanel); closeModal(helpPanel); openModal(aboutPanel);
});
settingsBtn.addEventListener('click', () => {
  closeModal(aboutPanel); closeModal(helpPanel); openModal(settingsPanel);
});
aboutClose.addEventListener('click', () => closeModal(aboutPanel));
settingsClose.addEventListener('click', () => closeModal(settingsPanel));
helpClose.addEventListener('click', () => closeModal(helpPanel));

[aboutPanel, settingsPanel, helpPanel].forEach((p) => {
  p.addEventListener('click', (e) => { if (e.target === p) closeModal(p); });
});

document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape') {
    if (pickingAnchor) { exitPicking(); return; }
    closeAllModals();
  }
});

showHelp.addEventListener('click', () => {
  closeModal(settingsPanel); openModal(helpPanel);
});

/* ==========================================================
   拾取锚点
========================================================== */
function enterPicking() {
  pickingAnchor = true;
  document.body.classList.add('picking');
  pickHintEl.classList.add('show');
  closeModal(settingsPanel);
}
function exitPicking() {
  pickingAnchor = false;
  document.body.classList.remove('picking');
  pickHintEl.classList.remove('show');
}
function updateCustomAnchorHint() {
  const x = Math.round(settings.customAnchor.x * 100);
  const y = Math.round(settings.customAnchor.y * 100);
  customAnchorHint.textContent = '当前：' + x + '% , ' + y + '%';
}

function updateDistUI() {
  if (settings.fullDist) {
    if (pickingAnchor) exitPicking();
    anchorRow.classList.add('dimmed');
    radiusRow.classList.add('dimmed');
    customAnchorRow.classList.add('dimmed');
    setAnchor.disabled = true;
    setRadius.disabled = true;
    pickAnchorBtn.disabled = true;
  } else {
    anchorRow.classList.remove('dimmed');
    radiusRow.classList.remove('dimmed');
    customAnchorRow.classList.remove('dimmed');
    setAnchor.disabled = false;
    setRadius.disabled = false;
    pickAnchorBtn.disabled = false;
    if (settings.anchor === 'custom') {
      customAnchorRow.style.display = '';
      updateCustomAnchorHint();
    } else {
      customAnchorRow.style.display = 'none';
    }
  }
}

/* ==========================================================
   设置绑定
========================================================== */
setGlass.checked       = settings.glass;
setEdgeWarp.checked    = settings.edgeWarp;
setWarpStrength.value  = String(Math.round(settings.warpStrength * 100));
setParticles.checked   = settings.particles;
setMagnify.checked     = settings.magnify;
setMark.checked        = settings.mark;
setSignal.checked      = settings.signal;
setSigStrength.checked = settings.sigStrength;
setFullDist.checked    = settings.fullDist;
setSway.value          = settings.sway;
setDensity.value       = String(settings.density);
setAnchor.value        = settings.anchor;
setRadius.value        = String(settings.radiusPct);
setGlassAlpha.value    = String(Math.round(settings.glassAlpha * 100));

radiusHint.textContent = '屏幕短边的 ' + settings.radiusPct + '%';
warpStrengthHint.textContent = Math.round(settings.warpStrength * 100) + '%';
updateCustomAnchorHint();
updateDistUI();
applyGlass();

setGlass.addEventListener('change', () => {
  settings.glass = setGlass.checked;
  applyGlass();
});

setGlassAlpha.addEventListener('input', () => {
  const val = parseInt(setGlassAlpha.value, 10) / 100;
  updateGlassAlpha(val);
});

setEdgeWarp.addEventListener('change', () => {
  settings.edgeWarp = setEdgeWarp.checked;
  /* 开关切换时刷新面板矩形 */
  schedulePanelRectsUpdate();
});

setWarpStrength.addEventListener('input', () => {
  settings.warpStrength = parseInt(setWarpStrength.value, 10) / 100;
  warpStrengthHint.textContent = Math.round(settings.warpStrength * 100) + '%';
});

setParticles.addEventListener('change', () => {
  settings.particles = setParticles.checked;
});
setMagnify.addEventListener('change', () => {
  settings.magnify = setMagnify.checked;
});
setMark.addEventListener('change', () => {
  settings.mark = setMark.checked;
});
setSignal.addEventListener('change', () => {
  settings.signal = setSignal.checked;
});
setSigStrength.addEventListener('change', () => {
  settings.sigStrength = setSigStrength.checked;
  if (settings.sigStrength) sigStrengthRow.classList.remove('hide');
  else sigStrengthRow.classList.add('hide');
});
setFullDist.addEventListener('change', () => {
  settings.fullDist = setFullDist.checked;
  updateDistUI();
});
setSway.addEventListener('change', () => {
  settings.sway = setSway.value;
});
setDensity.addEventListener('change', () => {
  settings.density = parseFloat(setDensity.value) || 1.6;
});
setAnchor.addEventListener('change', () => {
  settings.anchor = setAnchor.value;
  if (settings.anchor === 'custom') {
    customAnchorRow.style.display = '';
    updateCustomAnchorHint();
    enterPicking();
  } else {
    customAnchorRow.style.display = 'none';
  }
});
setRadius.addEventListener('input', () => {
  settings.radiusPct = parseInt(setRadius.value, 10) || 60;
  radiusHint.textContent = '屏幕短边的 ' + settings.radiusPct + '%';
});
pickAnchorBtn.addEventListener('click', () => {
  settings.anchor = 'custom';
  setAnchor.value = 'custom';
  customAnchorRow.style.display = '';
  enterPicking();
});
colorRow.addEventListener('click', (e) => {
  const btn = e.target.closest('.colorDot');
  if (!btn) return;
  const all = colorRow.querySelectorAll('.colorDot');
  for (let i = 0; i < all.length; i++) all[i].classList.remove('active');
  btn.classList.add('active');
  settings.particleColor = btn.dataset.color;
});
clearMarks.addEventListener('click', () => { marks.length = 0; });

/* ==========================================================
   QQ 群复制
========================================================== */
function fallbackCopy(text, cb) {
  try {
    const ta = document.createElement('textarea');
    ta.value = text;
    ta.style.position = 'fixed';
    ta.style.opacity = '0';
    document.body.appendChild(ta);
    ta.select();
    document.execCommand('copy');
    document.body.removeChild(ta);
    cb && cb();
  } catch (e) {}
}

if (qqLink) {
  qqLink.addEventListener('click', () => {
    const qq = qqLink.dataset.qq;
    const done = () => {
      const old = qqLink.textContent;
      qqLink.classList.add('copied');
      qqLink.textContent = '已复制群号 ✓';
      setTimeout(() => {
        qqLink.classList.remove('copied');
        qqLink.textContent = old;
      }, 1400);
    };
    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(qq).then(done).catch(() => fallbackCopy(qq, done));
    } else {
      fallbackCopy(qq, done);
    }
  });
}

/* ==========================================================
   Canvas 事件
========================================================== */
canvas.addEventListener('mousemove', (e) => {
  mouseX = e.clientX;
  mouseY = e.clientY;
});

canvas.addEventListener('click', (e) => {
  const x = e.clientX, y = e.clientY;
  if (pickingAnchor) {
    settings.customAnchor = { x: x / W, y: y / H };
    updateCustomAnchorHint();
    exitPicking();
    return;
  }
  if (!settings.mark) return;
  if (y < baseY - A * 1.7 || y > baseY + A * 1.7) return;
  if (settings.magnify) {
    const boxW = Math.min(260, W * 0.36);
    const boxH = boxW * 0.62;
    const bx = W - boxW - 20;
    const by = H - boxH - 140;
    if (x >= bx && x <= bx + boxW && y >= by && y <= by + boxH) return;
  }
  marks.push({ t: simTime - (W - x) / PX_PER_MS });
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
  const is16 = (flags & 0x01) !== 0;
  const hr = is16 ? dv.getUint16(1, true) : dv.getUint8(1);
  if (hr >= 25 && hr <= 230) {
    realBpm = hr;
    usingReal = true;
    lastPacketTime = performance.now();
    signalStrength = Math.min(100, signalStrength + 12);
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
    lastPacketTime = performance.now();

    btnConn.textContent = '断开连接';
    btnConn.dataset.on = '1';
    btnConn.disabled = false;
    srcTag.textContent = 'LIVE';
    setStatus('已连接 · ' + (device.name || '心率设备') + ' · 实时接收中', 'ok');
    schedulePanelRectsUpdate();
  } catch (err) {
    btnConn.disabled = false;
    usingReal = false;
    speedEl.disabled = false;
    if (err && err.name === 'NotFoundError') setStatus('已取消选择设备');
    else if (err && err.name === 'SecurityError') setStatus('需要 HTTPS 或 localhost 才能使用蓝牙', 'warn');
    else setStatus('连接失败：' + (err && err.message ? err.message : err), 'warn');
  }
}

function onDisconnected() {
  usingReal = false;
  speedEl.disabled = false;
  btnConn.textContent = '连接心率设备';
  btnConn.dataset.on = '0';
  srcTag.textContent = 'SIM';
  setStatus('设备已断开 · 已切回模拟模式');
  schedulePanelRectsUpdate();
}

btnConn.addEventListener('click', () => {
  if (btnConn.dataset.on === '1') {
    if (navigator.bluetooth && navigator.bluetooth.getDevices) {
      navigator.bluetooth.getDevices().then((list) => {
        list.forEach((d) => {
          try { if (d.gatt && d.gatt.connected) d.gatt.disconnect(); } catch (e) {}
        });
      }).catch(() => {});
    }
    onDisconnected();
    return;
  }
  connect();
});

speedEl.addEventListener('input', () => {
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

  /* 延迟一下再获取面板位置，等首帧渲染完成后布局才稳定 */
  setTimeout(schedulePanelRectsUpdate, 200);

  requestAnimationFrame(loop);
}

init();

})();