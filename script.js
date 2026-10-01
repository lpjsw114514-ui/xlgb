(function () {
'use strict';

/* ==========================================================
   视口尺寸
========================================================== */
const canvas = document.getElementById('c');

let CW = 1, CH = 1, ASPECT = 1, DPR = 1;
let BG_BASEY = 0;
let BG_A = 0;

const bgCanvas = document.createElement('canvas');
const bgCtx = bgCanvas.getContext('2d', { alpha: false });

/* ==========================================================
   WebGL2
========================================================== */
const gl = canvas.getContext('webgl2', {
  alpha: false,
  antialias: false,
  premultipliedAlpha: false,
  preserveDrawingBuffer: false
});

if (!gl) {
  document.body.innerHTML = '<div style="color:#fff;padding:40px;font-family:monospace">当前浏览器不支持 WebGL2，请使用 Chrome 或 Edge。</div>';
  return;
}

gl.getExtension('EXT_color_buffer_float');
gl.getExtension('OES_texture_float_linear');

/* ==========================================================
   着色器
========================================================== */
const QUAD_VS = `#version 300 es
in vec2 aPos;
out vec2 vUV;
void main() {
  vUV = aPos * 0.5 + 0.5;
  gl_Position = vec4(aPos, 0.0, 1.0);
}`;

const COPY_FS = `#version 300 es
precision highp float;
in vec2 vUV;
out vec4 outColor;
uniform sampler2D uTex;
void main() {
  outColor = texture(uTex, vUV);
}`;

const BLUR_FS = `#version 300 es
precision highp float;
in vec2 vUV;
out vec4 outColor;
uniform sampler2D uTex;
uniform vec2 uTexel;
uniform vec2 uDir;
uniform float uRadius;
void main() {
  vec2 off = uTexel * uDir * uRadius;
  vec4 c = texture(uTex, vUV) * 0.2270270270;
  c += (texture(uTex, vUV + off * 1.3846153846) +
        texture(uTex, vUV - off * 1.3846153846)) * 0.3162162162;
  c += (texture(uTex, vUV + off * 3.2307692308) +
        texture(uTex, vUV - off * 3.2307692308)) * 0.0702702703;
  outColor = c;
}`;

/* ---- 主着色器：支持多形状 SDF ---- */
const GLASS_FS = `#version 300 es
precision highp float;

in vec2 vUV;
out vec4 outColor;

uniform sampler2D uFaceTex;
uniform sampler2D uInnerTex;
uniform sampler2D uOuterTex;

uniform vec2  uResolution;
uniform float uAspect;

#define MAX_SHAPES 4
uniform int   uShapeCount;
uniform vec2  uShapeCenter[MAX_SHAPES];
uniform vec2  uShapeHalfSize[MAX_SHAPES];
uniform float uShapeRadius[MAX_SHAPES];

uniform float uGlassThickness;
uniform float uNormalTransition;
uniform float uIOR;
uniform float uDispersion;
uniform float uBackgroundDistance;
uniform float uRoughness;
uniform vec2  uOpticalCenter;
uniform float uTime;

const float PI = 3.14159265359;

float quintic(float t) {
  return t * t * t * (t * (t * 6.0 - 15.0) + 10.0);
}

float sdRoundRect(vec2 p, vec2 halfSize, float radius) {
  vec2 q = abs(p) - halfSize + radius;
  return min(max(q.x, q.y), 0.0) + length(max(q, 0.0)) - radius;
}

/* polynomial smooth-min */
float smin(float a, float b, float k) {
  float h = clamp(0.5 + 0.5 * (b - a) / k, 0.0, 1.0);
  return mix(b, a, h) - k * h * (1.0 - h);
}

/* 组合所有形状的 SDF */
float glassSurfaceSdf(vec2 p) {
  float sdf = 1e6;
  for (int i = 0; i < MAX_SHAPES; i++) {
    if (i >= uShapeCount) break;
    vec2 lp = p - uShapeCenter[i];
    float d = sdRoundRect(lp, uShapeHalfSize[i], uShapeRadius[i]);
    sdf = smin(sdf, d, 0.008);
  }
  return sdf;
}

float heightAt(vec2 p) {
  float sdf = glassSurfaceSdf(p);
  float interior = max(-sdf, 0.0);
  float bevel = max(uNormalTransition * 0.82, 0.0001);
  float t = clamp(interior / bevel, 0.0, 1.0);
  return uGlassThickness * quintic(t);
}

vec3 normalAt(vec2 p) {
  float stepSize = clamp(uNormalTransition * 0.13, 0.003, 0.012);

  float hL = heightAt(p - vec2(stepSize / uAspect, 0.0));
  float hR = heightAt(p + vec2(stepSize / uAspect, 0.0));
  float hD = heightAt(p - vec2(0.0, stepSize));
  float hU = heightAt(p + vec2(0.0, stepSize));

  vec2 grad = vec2(
    (hR - hL) / (2.0 * stepSize / uAspect),
    (hU - hD) / (2.0 * stepSize)
  );
  return normalize(vec3(-grad, 1.0));
}

float D_GGX(float NoH, float a) {
  float a2 = a * a;
  float d = NoH * NoH * (a2 - 1.0) + 1.0;
  return a2 / (PI * d * d + 1e-7);
}

float V_SmithGGXCorrelated(float NoV, float NoL, float a) {
  float a2 = a * a;
  float gv = NoL * sqrt(NoV * NoV * (1.0 - a2) + a2);
  float gl = NoV * sqrt(NoL * NoL * (1.0 - a2) + a2);
  return 0.5 / (gv + gl + 1e-7);
}

vec3 F_Schlick(float u, vec3 f0) {
  return f0 + (1.0 - f0) * pow(clamp(1.0 - u, 0.0, 1.0), 5.0);
}

vec3 safeRefract(vec3 I, vec3 N, float eta) {
  vec3 R = refract(I, N, eta);
  if (dot(R, R) < 1e-6) return reflect(I, N);
  return R;
}

void main() {
  vec2 uv = vUV;
  vec2 p = (uv - 0.5) * vec2(uAspect, 1.0);

  float sdf = glassSurfaceSdf(p);
  float aa = fwidth(sdf) * 0.75;
  float glassMask = 1.0 - smoothstep(-aa, aa, sdf);

  /* 玻璃外 → 直接显示原始背景 */
  if (glassMask < 0.001) {
    outColor = texture(uFaceTex, uv);
    return;
  }

  vec3 normal = normalAt(p);

  float interior = max(-sdf, 0.0);
  float bevel = max(uNormalTransition * 0.82, 0.0001);
  float t = clamp(interior / bevel, 0.0, 1.0);
  float height = uGlassThickness * quintic(t);

  float centerZone = smoothstep(0.6, 0.95, t);
  normal = normalize(mix(normal, vec3(0.0, 0.0, 1.0), centerZone));

  vec3 incident = vec3(0.0, 0.0, -1.0);
  float eta = 1.0 / uIOR;
  vec3 insideRay = safeRefract(incident, normal, eta);

  float glassPath = height / max(-insideRay.z, 0.025);

  vec3 backNormal = vec3(0.0, 0.0, 1.0);

  vec3 edgeDirection = normalize(vec3(normal.x, normal.y, 0.0) + vec3(0.0001, 0.0001, 0.0));

  float rimDisplacement = uGlassThickness * 0.55 * (1.0 - t);

  float iorR = uIOR - uDispersion;
  float iorG = uIOR;
  float iorB = uIOR + uDispersion;

  vec3 insideR = safeRefract(incident, normal, 1.0 / iorR);
  vec3 insideG = safeRefract(incident, normal, 1.0 / iorG);
  vec3 insideB = safeRefract(incident, normal, 1.0 / iorB);

  float pathR = height / max(-insideR.z, 0.025);
  float pathG = height / max(-insideG.z, 0.025);
  float pathB = height / max(-insideB.z, 0.025);

  vec3 PR = vec3(p.x + insideR.x * pathR, p.y + insideR.y * pathR, 0.0);
  vec3 PG = vec3(p.x + insideG.x * pathG, p.y + insideG.y * pathG, 0.0);
  vec3 PB = vec3(p.x + insideB.x * pathB, p.y + insideB.y * pathB, 0.0);

  vec3 outR = safeRefract(insideR, backNormal, iorR);
  vec3 outG = safeRefract(insideG, backNormal, iorG);
  vec3 outB = safeRefract(insideB, backNormal, iorB);

  float tR = -uBackgroundDistance / min(outR.z, -0.001);
  float tG = -uBackgroundDistance / min(outG.z, -0.001);
  float tB = -uBackgroundDistance / min(outB.z, -0.001);

  vec3 hitR = PR + outR * tR;
  vec3 hitG = PG + outG * tG;
  vec3 hitB = PB + outB * tB;

  vec2 bgUVR = hitR.xy / vec2(uAspect, 1.0) + 0.5;
  vec2 bgUVG = hitG.xy / vec2(uAspect, 1.0) + 0.5;
  vec2 bgUVB = hitB.xy / vec2(uAspect, 1.0) + 0.5;

  vec2 faceUV = uOpticalCenter + (uv - uOpticalCenter) * 0.975;

  vec2 innerUVR = bgUVR - edgeDirection.xy * rimDisplacement;
  vec2 innerUVG = bgUVG - edgeDirection.xy * rimDisplacement;
  vec2 innerUVB = bgUVB - edgeDirection.xy * rimDisplacement;

  vec2 outerUVR = bgUVR + edgeDirection.xy * rimDisplacement * 1.28;
  vec2 outerUVG = bgUVG + edgeDirection.xy * rimDisplacement * 1.28;
  vec2 outerUVB = bgUVB + edgeDirection.xy * rimDisplacement * 1.28;

  vec3 faceCol = texture(uFaceTex, faceUV).rgb;

  vec3 innerCol = vec3(
    texture(uInnerTex, innerUVR).r,
    texture(uInnerTex, innerUVG).g,
    texture(uInnerTex, innerUVB).b
  );

  vec3 outerCol = vec3(
    texture(uOuterTex, outerUVR).r,
    texture(uOuterTex, outerUVG).g,
    texture(uOuterTex, outerUVB).b
  );

  float outerBevelSupport = smoothstep(0.0, 1.0, 1.0 - t);
  float curvature = 1.0 - normal.z;
  float curvWeight = smoothstep(0.0, 0.35, curvature);

  float faceWeight  = max(t * 0.85 + 0.15, 0.0);
  float innerWeight = outerBevelSupport * (0.55 + curvWeight * 0.45);
  float outerWeight = outerBevelSupport * 0.45;

  float wsum = faceWeight + innerWeight + outerWeight + 1e-6;
  faceWeight  /= wsum;
  innerWeight /= wsum;
  outerWeight /= wsum;

  vec3 refracted = faceCol * faceWeight + innerCol * innerWeight + outerCol * outerWeight;

  float outerShadow = smoothstep(0.0, 0.4, -sdf / uNormalTransition) * 0.18;
  refracted *= (1.0 - outerShadow);
  refracted = mix(refracted, refracted * 0.96 + vec3(0.04), 0.22);

  float f0scalar = (uIOR - 1.0) / (uIOR + 1.0);
  vec3 F0 = vec3(f0scalar * f0scalar);

  float rough = clamp(uRoughness, 0.04, 1.0);
  float a = rough * rough;

  vec3 V = vec3(0.0, 0.0, 1.0);

  float directWeight = curvWeight * outerBevelSupport;

  float ang = uTime * 0.08;
  float ca = cos(ang), sa = sin(ang);

  vec3 L0 = normalize(vec3( 0.93 * ca - 0.92 * sa,  0.92 * ca + 0.93 * sa,  0.35));
  vec3 L1 = normalize(vec3(-0.90 * ca - 0.94 * sa,  0.94 * ca - 0.90 * sa,  0.40));
  vec3 L2 = normalize(vec3( 0.91 * ca + 0.95 * sa, -0.95 * ca + 0.91 * sa,  0.30));
  vec3 L3 = normalize(vec3(-0.96 * ca + 0.90 * sa, -0.90 * ca - 0.96 * sa,  0.38));

  vec3 lightColor0 = vec3(0.85, 0.92, 1.00);
  vec3 lightColor1 = vec3(1.00, 0.94, 0.86);
  vec3 lightColor2 = vec3(0.88, 0.95, 1.00);
  vec3 lightColor3 = vec3(1.00, 0.92, 0.82);

  vec3 lightDirs[4];
  vec3 lightCols[4];
  lightDirs[0] = L0; lightCols[0] = lightColor0;
  lightDirs[1] = L1; lightCols[1] = lightColor1;
  lightDirs[2] = L2; lightCols[2] = lightColor2;
  lightDirs[3] = L3; lightCols[3] = lightColor3;

  vec3 specular = vec3(0.0);
  for (int i = 0; i < 4; i++) {
    vec3 L = lightDirs[i];
    vec3 H = normalize(L + V);

    float NoV = max(dot(normal, V), 1e-4);
    float NoL = max(dot(normal, L), 1e-4);
    float NoH = max(dot(normal, H), 0.0);
    float VoH = max(dot(V, H), 0.0);

    float D = D_GGX(NoH, a);
    float Vis = V_SmithGGXCorrelated(NoV, NoL, a);
    vec3  F = F_Schlick(VoH, F0);

    vec3 spec = D * Vis * F * lightCols[i] * NoL;
    specular += spec;
  }

  specular *= directWeight * 2.4;

  float NoV = max(dot(normal, V), 1e-4);
  vec3 envFres = F_Schlick(NoV, F0) * 0.35 * (0.35 + 0.65 * outerBevelSupport);
  specular += envFres * 0.6;

  vec3 finalCol = refracted + specular;

  float edgeLift = smoothstep(0.4, 1.0, 1.0 - t) * 0.12;
  finalCol += vec3(edgeLift);

  outColor = vec4(finalCol, glassMask);
}`;

/* ==========================================================
   编译工具
========================================================== */
function compileShader(type, src) {
  const s = gl.createShader(type);
  gl.shaderSource(s, src);
  gl.compileShader(s);
  if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) {
    console.error(gl.getShaderInfoLog(s));
    console.error(src);
  }
  return s;
}

function createProgram(vsSrc, fsSrc) {
  const vs = compileShader(gl.VERTEX_SHADER, vsSrc);
  const fs = compileShader(gl.FRAGMENT_SHADER, fsSrc);
  const p = gl.createProgram();
  gl.attachShader(p, vs);
  gl.attachShader(p, fs);
  gl.linkProgram(p);
  if (!gl.getProgramParameter(p, gl.LINK_STATUS)) {
    console.error(gl.getProgramInfoLog(p));
  }
  return p;
}

const copyProgram  = createProgram(QUAD_VS, COPY_FS);
const blurProgram  = createProgram(QUAD_VS, BLUR_FS);
const glassProgram = createProgram(QUAD_VS, GLASS_FS);

/* ==========================================================
   全屏四边形
========================================================== */
const quadVAO = gl.createVertexArray();
gl.bindVertexArray(quadVAO);

const quadVBO = gl.createBuffer();
gl.bindBuffer(gl.ARRAY_BUFFER, quadVBO);
gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([
  -1, -1,  1, -1, -1,  1,
  -1,  1,  1, -1,  1,  1
]), gl.STATIC_DRAW);

gl.enableVertexAttribArray(0);
gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0);

gl.bindVertexArray(null);

/* ==========================================================
   RT
========================================================== */
function createRT(w, h) {
  const tex = gl.createTexture();
  gl.bindTexture(gl.TEXTURE_2D, tex);
  gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, w, h, 0, gl.RGBA, gl.UNSIGNED_BYTE, null);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);

  const fbo = gl.createFramebuffer();
  gl.bindFramebuffer(gl.FRAMEBUFFER, fbo);
  gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, tex, 0);
  gl.bindFramebuffer(gl.FRAMEBUFFER, null);
  gl.bindTexture(gl.TEXTURE_2D, null);

  return { tex, fbo, w, h };
}

function destroyRT(rt) {
  if (!rt) return;
  gl.deleteFramebuffer(rt.fbo);
  gl.deleteTexture(rt.tex);
}

const PYRAMID_LEVELS = 5;
let paintComposeRT = null;
const pyramid = [];

function rebuildRenderTargets() {
  destroyRT(paintComposeRT);
  for (let i = 0; i < pyramid.length; i++) {
    destroyRT(pyramid[i].a);
    destroyRT(pyramid[i].b);
  }
  pyramid.length = 0;

  paintComposeRT = createRT(CW, CH);

  let pw = CW, ph = CH;
  for (let i = 0; i < PYRAMID_LEVELS; i++) {
    pw = Math.max(2, pw >> 1);
    ph = Math.max(2, ph >> 1);
    pyramid.push({
      a: createRT(pw, ph),
      b: createRT(pw, ph),
      w: pw,
      h: ph
    });
  }
}

/* ==========================================================
   尺寸
========================================================== */
function resizeCanvas() {
  DPR = Math.min(window.devicePixelRatio || 1, 2);

  const vw = window.innerWidth;
  const vh = window.innerHeight;

  CW = Math.max(2, Math.round(vw * DPR));
  CH = Math.max(2, Math.round(vh * DPR));
  ASPECT = vw / vh;

  canvas.width  = CW;
  canvas.height = CH;
  canvas.style.width  = vw + 'px';
  canvas.style.height = vh + 'px';

  bgCanvas.width  = CW;
  bgCanvas.height = CH;

  BG_BASEY = CH * 0.55;
  BG_A     = Math.min(CH * 0.14, 260);

  rebuildRenderTargets();
}

window.addEventListener('resize', resizeCanvas);
window.addEventListener('orientationchange', () => setTimeout(resizeCanvas, 120));

/* ==========================================================
   设置
========================================================== */
const settings = {
  glass:          true,
  glassThickness: 0.038,
  ior:            1.46,
  dispersion:     0.004,
  particles:      true,
  density:        1.6,
  particleColor:  '#ffffff',
  sway:           'free',
  fullDist:       false,
  anchor:         'rpeak',
  customAnchor:   { x: 0.5, y: 0.5 },
  radiusPct:      60,
  magnify:        true,
  mark:           true,
  signal:         true,
  sigStrength:    true
};

/* ==========================================================
   状态
========================================================== */
const SAMPLE_MS = 5;
const PX_PER_MS = 0.5;
const MAX_SPARKS = 6000;

let simTime = 0;
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
   渲染辅助
========================================================== */
function bindRT(rt) {
  gl.bindFramebuffer(gl.FRAMEBUFFER, rt ? rt.fbo : null);
  if (rt) gl.viewport(0, 0, rt.w, rt.h);
  else    gl.viewport(0, 0, CW, CH);
}

function drawQuad() {
  gl.bindVertexArray(quadVAO);
  gl.drawArrays(gl.TRIANGLES, 0, 6);
  gl.bindVertexArray(null);
}

/* ==========================================================
   背景渲染
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

function bgDrawGrid() {
  const minor = Math.max(8, Math.round(CH / 100));
  const major = minor * 5;
  bgCtx.lineWidth = 1;

  bgCtx.strokeStyle = 'rgba(255,255,255,0.030)';
  bgCtx.beginPath();
  for (let x = 0; x < CW; x += minor) { bgCtx.moveTo(x + .5, 0); bgCtx.lineTo(x + .5, CH); }
  for (let y = 0; y < CH; y += minor) { bgCtx.moveTo(0, y + .5); bgCtx.lineTo(CW, y + .5); }
  bgCtx.stroke();

  bgCtx.strokeStyle = 'rgba(255,255,255,0.065)';
  bgCtx.beginPath();
  for (let x = 0; x < CW; x += major) { bgCtx.moveTo(x + .5, 0); bgCtx.lineTo(x + .5, CH); }
  for (let y = 0; y < CH; y += major) { bgCtx.moveTo(0, y + .5); bgCtx.lineTo(CW, y + .5); }
  bgCtx.stroke();

  bgCtx.strokeStyle = 'rgba(255,255,255,0.09)';
  bgCtx.beginPath();
  bgCtx.moveTo(0, BG_BASEY + .5);
  bgCtx.lineTo(CW, BG_BASEY + .5);
  bgCtx.stroke();
}

function bgDrawWave() {
  const n = samples.length;
  if (n < 2) return;

  const path = new Path2D();
  let started = false;

  for (let i = 0; i < n; i++) {
    const s = samples[i];
    const x = CW - (simTime - s.t) * PX_PER_MS;
    if (x < -30) continue;
    if (x > CW + 30) break;
    const y = BG_BASEY - s.v * BG_A;
    if (!started) { path.moveTo(x, y); started = true; }
    else path.lineTo(x, y);
  }
  if (!started) return;

  const grad = bgCtx.createLinearGradient(0, 0, CW * 0.26, 0);
  grad.addColorStop(0, 'rgba(255,255,255,0)');
  grad.addColorStop(1, 'rgba(255,255,255,1)');

  bgCtx.save();
  bgCtx.lineCap  = 'round';
  bgCtx.lineJoin = 'round';
  bgCtx.strokeStyle = grad;

  const layers = [
    { w: 22,   a: 0.035 },
    { w: 11,   a: 0.070 },
    { w: 5.5,  a: 0.160 },
    { w: 2.8,  a: 0.400 },
    { w: 1.3,  a: 1.000 }
  ];
  for (let i = 0; i < layers.length; i++) {
    bgCtx.globalAlpha = layers[i].a;
    bgCtx.lineWidth   = layers[i].w;
    bgCtx.stroke(path);
  }
  bgCtx.restore();
  bgCtx.globalAlpha = 1;
}

function bgDrawMarks() {
  if (marks.length === 0) return;
  bgCtx.save();
  for (let i = 0; i < marks.length; i++) {
    const m = marks[i];
    const x = CW - (simTime - m.t) * PX_PER_MS;
    if (x < -30 || x > CW + 30) continue;

    const topY = BG_BASEY - BG_A * 1.2;
    const botY = BG_BASEY + BG_A * 0.8;

    bgCtx.strokeStyle = 'rgba(255,255,255,.28)';
    bgCtx.lineWidth = 1.4;
    bgCtx.beginPath();
    bgCtx.moveTo(x, topY);
    bgCtx.lineTo(x, botY);
    bgCtx.stroke();

    bgCtx.globalAlpha = 0.28;
    bgCtx.fillStyle = '#fff';
    bgCtx.beginPath();
    bgCtx.arc(x, topY, 12, 0, Math.PI * 2);
    bgCtx.fill();
    bgCtx.globalAlpha = 1;

    bgCtx.fillStyle = '#fff';
    bgCtx.beginPath();
    bgCtx.arc(x, topY, 5, 0, Math.PI * 2);
    bgCtx.fill();
  }
  bgCtx.restore();
}

function bgDrawSparks(dtSec) {
  bgCtx.save();
  bgCtx.globalCompositeOperation = 'lighter';

  const damp    = Math.pow(0.30, dtSec);
  const col     = settings.particleColor;
  const timeSec = simTime * 0.001;

  for (let i = sparks.length - 1; i >= 0; i--) {
    const p = sparks[i];

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

    if (p.trail && p.trail.length) {
      p.trail.push(p.x, p.y);
      while (p.trail.length > p.maxTrail * 2) {
        p.trail.shift(); p.trail.shift();
      }
      const tn = p.trail.length / 2;
      for (let j = 0; j < tn; j++) {
        const k = j / tn;
        const ta = a * k * k * 0.45;
        if (ta < 0.01) continue;
        const tr = p.size * k * 0.85;
        if (tr < 0.25) continue;
        bgCtx.globalAlpha = ta;
        bgCtx.fillStyle = col;
        bgCtx.beginPath();
        bgCtx.arc(p.trail[j * 2], p.trail[j * 2 + 1], tr, 0, Math.PI * 2);
        bgCtx.fill();
      }
    }

    const cr = p.size * (0.5 + p.life * 0.9);

    bgCtx.globalAlpha = a * tw;
    bgCtx.fillStyle = col;
    bgCtx.beginPath();
    bgCtx.arc(p.x, p.y, cr, 0, Math.PI * 2);
    bgCtx.fill();

    if (p.star && p.size > 1.0) {
      bgCtx.globalAlpha = a * tw * 0.22;
      bgCtx.beginPath();
      bgCtx.arc(p.x, p.y, cr * 3.2, 0, Math.PI * 2);
      bgCtx.fill();
    }

    if (!p.star && p.size > 2.2 && p.life > 0.4) {
      const L = p.size * 3.5 * p.life;
      bgCtx.globalAlpha = a * 0.5;
      bgCtx.fillRect(p.x - L, p.y - 0.5, L * 2, 1);
      bgCtx.fillRect(p.x - 0.5, p.y - L, 1, L * 2);
    }
  }

  for (let i = ripples.length - 1; i >= 0; i--) {
    const rp = ripples[i];
    rp.life -= dtSec * rp.decay;
    if (rp.life <= 0) { ripples.splice(i, 1); continue; }

    const t = 1 - rp.life;
    const ease = 1 - Math.pow(1 - t, 2.4);
    const r = rp.r + (rp.maxR - rp.r) * ease;

    bgCtx.globalAlpha = rp.life * rp.life * 0.5;
    bgCtx.strokeStyle = col;
    bgCtx.lineWidth = 2.2 * rp.life + 0.3;
    bgCtx.beginPath();
    bgCtx.arc(rp.x, rp.y, r, 0, Math.PI * 2);
    bgCtx.stroke();
  }

  bgCtx.restore();
  bgCtx.globalAlpha = 1;
}

function bgRoundRect(c, x, y, w, h, r) {
  c.beginPath();
  c.moveTo(x + r, y);
  c.arcTo(x + w, y, x + w, y + h, r);
  c.arcTo(x + w, y + h, x, y + h, r);
  c.arcTo(x, y + h, x, y, r);
  c.arcTo(x, y, x + w, y, r);
  c.closePath();
}

function bgDrawMagnify() {
  if (!settings.magnify) return;
  if (samples.length < 10) return;

  const boxW = Math.min(CW * 0.36, 380);
  const boxH = boxW * 0.62;
  const bx = CW - boxW - 30;
  const by = CH - boxH - 380;

  const startT = simTime - beatInterval * 0.98;
  const seg = [];
  for (let i = samples.length - 1; i >= 0; i--) {
    const s = samples[i];
    if (s.t < startT) break;
    seg.unshift(s);
  }
  if (seg.length < 4) return;

  bgCtx.save();

  bgCtx.fillStyle = 'rgba(0,0,0,.58)';
  bgCtx.strokeStyle = 'rgba(255,255,255,.18)';
  bgCtx.lineWidth = 1.2;
  bgRoundRect(bgCtx, bx, by, boxW, boxH, 14);
  bgCtx.fill();
  bgCtx.stroke();

  bgCtx.fillStyle = 'rgba(255,255,255,.45)';
  bgCtx.font = '15px ui-monospace, "SF Mono", Menlo, monospace';
  bgCtx.textBaseline = 'top';
  bgCtx.fillText('ECG · 局部放大', bx + 15, by + 13);

  const padX = 14, padY = 38;
  const innerW = boxW - padX * 2;
  const innerH = boxH - padY - 12;
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

  bgCtx.lineCap = 'round';
  bgCtx.lineJoin = 'round';
  bgCtx.strokeStyle = '#fff';
  const layers = [
    { w: 13,   a: 0.05 },
    { w: 6.5,  a: 0.15 },
    { w: 3.2,  a: 0.45 },
    { w: 1.4,  a: 1.00 }
  ];
  for (let i = 0; i < layers.length; i++) {
    bgCtx.globalAlpha = layers[i].a;
    bgCtx.lineWidth = layers[i].w;
    bgCtx.stroke(path);
  }
  bgCtx.globalAlpha = 1;
  bgCtx.restore();
}

function bgRender(dtSec) {
  bgCtx.fillStyle = '#000';
  bgCtx.fillRect(0, 0, CW, CH);

  bgDrawGrid();
  bgDrawWave();
  bgDrawMarks();
  bgDrawSparks(dtSec);
  bgDrawMagnify();
}

/* ==========================================================
   模糊金字塔
========================================================== */
function runBlurPass(srcTex, dstRT, dirX, dirY, radius) {
  bindRT(dstRT);
  gl.useProgram(blurProgram);

  gl.activeTexture(gl.TEXTURE0);
  gl.bindTexture(gl.TEXTURE_2D, srcTex);
  gl.uniform1i(gl.getUniformLocation(blurProgram, 'uTex'), 0);

  gl.uniform2f(gl.getUniformLocation(blurProgram, 'uTexel'), 1 / dstRT.w, 1 / dstRT.h);
  gl.uniform2f(gl.getUniformLocation(blurProgram, 'uDir'), dirX, dirY);
  gl.uniform1f(gl.getUniformLocation(blurProgram, 'uRadius'), radius);

  drawQuad();
}

function updatePyramid() {
  let srcTex = paintComposeRT.tex;

  for (let i = 0; i < PYRAMID_LEVELS; i++) {
    const lv = pyramid[i];
    runBlurPass(srcTex, lv.a, 1, 0, 1.0);
    runBlurPass(lv.a.tex, lv.b, 0, 1, 1.0);
    srcTex = lv.b.tex;
  }
}

/* ==========================================================
   上传背景（关键修复：翻转 Y）
========================================================== */
function uploadBackground() {
  /* 关键：让纹理 Y 轴与 WebGL UV 对齐，消除镜像 */
  gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, true);

  gl.bindTexture(gl.TEXTURE_2D, paintComposeRT.tex);
  gl.texImage2D(
    gl.TEXTURE_2D, 0, gl.RGBA,
    gl.RGBA, gl.UNSIGNED_BYTE,
    bgCanvas
  );
  gl.bindTexture(gl.TEXTURE_2D, null);

  /* 恢复默认，避免影响其他纹理上传 */
  gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, false);
}

/* ==========================================================
   从 DOM 读取玻璃形状
========================================================== */
const MAX_SHAPES = 4;

/* 复用数组，避免每帧分配 */
const shapeCenters = new Float32Array(MAX_SHAPES * 2);
const shapeHalfSizes = new Float32Array(MAX_SHAPES * 2);
const shapeRadii = new Float32Array(MAX_SHAPES);

function collectGlassShapes() {
  if (!settings.glass) return 0;

  const vw = window.innerWidth;
  const vh = window.innerHeight;

  let count = 0;

  function pushRect(el) {
    if (count >= MAX_SHAPES) return;
    const rect = el.getBoundingClientRect();
    if (rect.width < 2 || rect.height < 2) return;
    if (rect.right < 0 || rect.bottom < 0) return;
    if (rect.left > vw || rect.top > vh) return;

    /* CSS 像素 → corrected 坐标 */
    const u0 = rect.left / vw;
    const u1 = rect.right / vw;
    const v0 = 1 - rect.bottom / vh;   /* 顶部 → WebGL y 向上 */
    const v1 = 1 - rect.top / vh;

    const uc = (u0 + u1) * 0.5;
    const vc = (v0 + v1) * 0.5;

    const cx = (uc - 0.5) * ASPECT;
    const cy = (vc - 0.5);

    const halfW = ((u1 - u0) * 0.5) * ASPECT;
    const halfH = (v1 - v0) * 0.5;

    /* 读取真实 border-radius（CSS 像素），clamp 到短边一半 */
    let br = 0;
    try {
      const cs = getComputedStyle(el);
      br = parseFloat(cs.borderTopLeftRadius) || 0;
    } catch (e) {}
    if (br <= 0) br = Math.min(rect.width, rect.height) * 0.5;
    br = Math.min(br, Math.min(rect.width, rect.height) * 0.5);

    const radiusShader = br / vh;

    shapeCenters[count * 2] = cx;
    shapeCenters[count * 2 + 1] = cy;
    shapeHalfSizes[count * 2] = halfW;
    shapeHalfSizes[count * 2 + 1] = halfH;
    shapeRadii[count] = radiusShader;

    count++;
  }

  /* 顶部按钮 */
  const btns = document.querySelectorAll('.topBtn');
  for (let i = 0; i < btns.length; i++) {
    if (btns[i].offsetParent === null) continue;
    pushRect(btns[i]);
  }

  /* 打开的面板 */
  const openModal = document.querySelector('.modal.show');
  if (openModal) {
    const card = openModal.querySelector('.modalCard');
    if (card) pushRect(card);
  }

  return count;
}

/* ==========================================================
   玻璃渲染
========================================================== */
const glassUniforms = {
  uFaceTex:            gl.getUniformLocation(glassProgram, 'uFaceTex'),
  uInnerTex:           gl.getUniformLocation(glassProgram, 'uInnerTex'),
  uOuterTex:           gl.getUniformLocation(glassProgram, 'uOuterTex'),
  uResolution:         gl.getUniformLocation(glassProgram, 'uResolution'),
  uAspect:             gl.getUniformLocation(glassProgram, 'uAspect'),
  uShapeCount:         gl.getUniformLocation(glassProgram, 'uShapeCount'),
  uShapeCenter:        gl.getUniformLocation(glassProgram, 'uShapeCenter'),
  uShapeHalfSize:      gl.getUniformLocation(glassProgram, 'uShapeHalfSize'),
  uShapeRadius:        gl.getUniformLocation(glassProgram, 'uShapeRadius'),
  uGlassThickness:     gl.getUniformLocation(glassProgram, 'uGlassThickness'),
  uNormalTransition:   gl.getUniformLocation(glassProgram, 'uNormalTransition'),
  uIOR:                gl.getUniformLocation(glassProgram, 'uIOR'),
  uDispersion:         gl.getUniformLocation(glassProgram, 'uDispersion'),
  uBackgroundDistance: gl.getUniformLocation(glassProgram, 'uBackgroundDistance'),
  uRoughness:          gl.getUniformLocation(glassProgram, 'uRoughness'),
  uOpticalCenter:      gl.getUniformLocation(glassProgram, 'uOpticalCenter'),
  uTime:               gl.getUniformLocation(glassProgram, 'uTime')
};

function renderGlass(timeSec) {
  bindRT(null);

  gl.clearColor(0, 0, 0, 1);
  gl.clear(gl.COLOR_BUFFER_BIT);

  const shapeCount = collectGlassShapes();

  if (!settings.glass || shapeCount === 0) {
    /* 无玻璃：直接显示背景 */
    gl.useProgram(copyProgram);
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, paintComposeRT.tex);
    gl.uniform1i(gl.getUniformLocation(copyProgram, 'uTex'), 0);
    drawQuad();
    return;
  }

  gl.useProgram(glassProgram);
  gl.enable(gl.BLEND);
  gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA);

  gl.uniform1i(glassUniforms.uFaceTex,  0);
  gl.uniform1i(glassUniforms.uInnerTex, 1);
  gl.uniform1i(glassUniforms.uOuterTex, 2);

  gl.activeTexture(gl.TEXTURE0);
  gl.bindTexture(gl.TEXTURE_2D, pyramid[0].b.tex);
  gl.activeTexture(gl.TEXTURE1);
  gl.bindTexture(gl.TEXTURE_2D, pyramid[1].b.tex);
  gl.activeTexture(gl.TEXTURE2);
  gl.bindTexture(gl.TEXTURE_2D, pyramid[3].b.tex);

  gl.uniform2f(glassUniforms.uResolution, CW, CH);
  gl.uniform1f(glassUniforms.uAspect, ASPECT);

  gl.uniform1i(glassUniforms.uShapeCount, shapeCount);
  gl.uniform2fv(glassUniforms.uShapeCenter, shapeCenters);
  gl.uniform2fv(glassUniforms.uShapeHalfSize, shapeHalfSizes);
  gl.uniform1fv(glassUniforms.uShapeRadius, shapeRadii);

  /* 每个形状的过渡带：取最小 halfHeight 的 55% */
  let minHalfH = 1;
  for (let i = 0; i < shapeCount; i++) {
    const h = shapeHalfSizes[i * 2 + 1];
    if (h < minHalfH) minHalfH = h;
  }
  const normalTransition = Math.max(minHalfH * 0.55, 0.008);

  gl.uniform1f(glassUniforms.uGlassThickness, settings.glassThickness);
  gl.uniform1f(glassUniforms.uNormalTransition, normalTransition);
  gl.uniform1f(glassUniforms.uIOR, settings.ior);
  gl.uniform1f(glassUniforms.uDispersion, settings.dispersion);
  gl.uniform1f(glassUniforms.uBackgroundDistance, 1.2);
  gl.uniform1f(glassUniforms.uRoughness, 0.32);
  gl.uniform2f(glassUniforms.uOpticalCenter, 0.5, 0.5);
  gl.uniform1f(glassUniforms.uTime, timeSec);

  drawQuad();

  gl.disable(gl.BLEND);
}

/* ==========================================================
   粒子/心跳
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
    ang = Math.random() * Math.PI * 2;
    cos = Math.cos(ang); sin = Math.sin(ang);
    vx = (cos * 0.72 + sin * 0.55) * spd;
    vy = (sin * 0.72 - cos * 0.55) * spd;
  } else if (s === 'ccw') {
    ang = Math.random() * Math.PI * 2;
    cos = Math.cos(ang); sin = Math.sin(ang);
    vx = (cos * 0.72 - sin * 0.55) * spd;
    vy = (sin * 0.72 + cos * 0.55) * spd;
  } else {
    ang = Math.random() * Math.PI * 2;
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
  if (settings.fullDist) return { x: CW / 2, y: CH / 2 };
  const a = settings.anchor;
  if (a === 'center') return { x: CW / 2, y: CH / 2 };
  if (a === 'top')    return { x: CW / 2, y: CH * 0.22 };
  if (a === 'bottom') return { x: CW / 2, y: CH * 0.78 };
  if (a === 'left')   return { x: CW * 0.22, y: CH / 2 };
  if (a === 'right')  return { x: CW * 0.78, y: CH / 2 };
  if (a === 'custom') return { x: CW * settings.customAnchor.x, y: CH * settings.customAnchor.y };
  return { x: rx, y: ry };
}

function getCloudRadius() {
  if (settings.fullDist) return Math.hypot(CW, CH) * 0.55;
  return Math.min(CW, CH) * (settings.radiusPct / 100);
}

const signalEl = document.getElementById('signal');

function signalPulse() {
  if (!settings.signal || !signalEl) return;
  signalEl.classList.remove('beat');
  void signalEl.offsetWidth;
  signalEl.classList.add('beat');
}

function onBeat(beatTime) {
  const rx = CW - (simTime - beatTime) * PX_PER_MS;
  const ry = BG_BASEY - BG_A * 0.95;

  signalPulse();

  if (settings.particles) {
    const mult = settings.density || 1.6;
    const center = getCloudCenter(rx, ry);
    const cloudR = getCloudRadius();

    const baseN = settings.fullDist ? 480 : 320;
    const n = Math.round((baseN + Math.random() * 180) * mult);

    for (let i = 0; i < n; i++) {
      const ang = Math.random() * Math.PI * 2;
      const u = Math.random();
      const r = cloudR * Math.pow(u, settings.fullDist ? 0.62 : 0.55);
      const px = center.x + Math.cos(ang) * r;
      const py = center.y + Math.sin(ang) * r * 0.88;
      if (px < -60 || px > CW + 60 || py < -60 || py > CH + 60) continue;

      const spd = 6 + Math.random() * 44;
      const v = pickVelocity(spd);

      addSpark({
        x: px, y: py, vx: v.vx, vy: v.vy,
        life: 1,
        decay: 0.055 + Math.random() * 0.14,
        size: 1.8,
        trail: null,
        twinklePhase: Math.random() * Math.PI * 2,
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
        size: 3.6,
        trail: [rx, ry],
        maxTrail: 9,
        star: false
      });
    }
  }

  ripples.push({
    x: rx, y: ry, r: 6,
    maxR: 140 + Math.random() * 100,
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

  const maxAge = (CW + 400) / PX_PER_MS;
  while (samples.length && (simTime - samples[0].t) > maxAge) samples.shift();

  const markAge = (CW + 600) / PX_PER_MS;
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
   主循环
========================================================== */
let lastT = 0;

function loop(now) {
  if (!lastT) lastT = now;
  let dt = now - lastT;
  lastT = now;
  if (dt < 0) dt = 0;
  if (dt > 50) dt = 50;

  const dtSec = dt / 1000;
  const timeSec = now / 1000;

  update(dt);
  bgRender(dtSec);
  uploadBackground();
  updatePyramid();
  renderGlass(timeSec);

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
const setThickness  = document.getElementById('setThickness');
const setIOR        = document.getElementById('setIOR');
const setDisp       = document.getElementById('setDisp');
const thicknessHint = document.getElementById('thicknessHint');
const iorHint       = document.getElementById('iorHint');
const dispHint      = document.getElementById('dispHint');
const glassParamsRow= document.getElementById('glassParamsRow');

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
   模态面板
========================================================== */
function openModal(el)  { el.classList.add('show'); }
function closeModal(el) { el.classList.remove('show'); }
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
setThickness.value     = String(Math.round(settings.glassThickness * 1000));
setIOR.value           = String(Math.round(settings.ior * 100));
setDisp.value          = String(Math.round(settings.dispersion * 1000));
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

thicknessHint.textContent = settings.glassThickness.toFixed(3);
iorHint.textContent       = settings.ior.toFixed(2);
dispHint.textContent      = settings.dispersion.toFixed(3);
radiusHint.textContent    = '屏幕短边的 ' + settings.radiusPct + '%';
updateCustomAnchorHint();
updateDistUI();

setGlass.addEventListener('change', () => {
  settings.glass = setGlass.checked;
  if (glassParamsRow) glassParamsRow.style.opacity = settings.glass ? '1' : '0.4';
  if (settings.glass) document.body.classList.add('liquid-glass');
  else document.body.classList.remove('liquid-glass');
});

setThickness.addEventListener('input', () => {
  settings.glassThickness = parseInt(setThickness.value, 10) / 1000;
  thicknessHint.textContent = settings.glassThickness.toFixed(3);
});

setIOR.addEventListener('input', () => {
  settings.ior = parseInt(setIOR.value, 10) / 100;
  iorHint.textContent = settings.ior.toFixed(2);
});

setDisp.addEventListener('input', () => {
  settings.dispersion = parseInt(setDisp.value, 10) / 1000;
  dispHint.textContent = settings.dispersion.toFixed(3);
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
function getCanvasCoord(clientX, clientY) {
  const rect = canvas.getBoundingClientRect();
  const x = (clientX - rect.left) / rect.width  * CW;
  const y = (clientY - rect.top)  / rect.height * CH;
  return { x, y };
}

canvas.addEventListener('click', (e) => {
  const { x: cx, y: cy } = getCanvasCoord(e.clientX, e.clientY);

  if (pickingAnchor) {
    settings.customAnchor = { x: cx / CW, y: cy / CH };
    updateCustomAnchorHint();
    exitPicking();
    return;
  }

  if (!settings.mark) return;
  if (cy < BG_BASEY - BG_A * 1.7 || cy > BG_BASEY + BG_A * 1.7) return;

  if (settings.magnify) {
    const boxW = Math.min(CW * 0.36, 380);
    const boxH = boxW * 0.62;
    const bx = CW - boxW - 30;
    const by = CH - boxH - 380;
    if (cx >= bx && cx <= bx + boxW && cy >= by && cy <= by + boxH) return;
  }

  marks.push({ t: simTime - (CW - cx) / PX_PER_MS });
});

canvas.addEventListener('touchstart', (e) => {
  if (e.touches.length !== 1) return;
  const t = e.touches[0];
  const { x: cx, y: cy } = getCanvasCoord(t.clientX, t.clientY);

  if (pickingAnchor) {
    e.preventDefault();
    settings.customAnchor = { x: cx / CW, y: cy / CH };
    updateCustomAnchorHint();
    exitPicking();
    return;
  }

  if (!settings.mark) return;
  if (cy < BG_BASEY - BG_A * 1.7 || cy > BG_BASEY + BG_A * 1.7) return;

  if (settings.magnify) {
    const boxW = Math.min(CW * 0.36, 380);
    const boxH = boxW * 0.62;
    const bx = CW - boxW - 30;
    const by = CH - boxH - 380;
    if (cx >= bx && cx <= bx + boxW && cy >= by && cy <= by + boxH) return;
  }

  marks.push({ t: simTime - (CW - cx) / PX_PER_MS });
}, { passive: false });

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
  if (glassParamsRow) glassParamsRow.style.opacity = settings.glass ? '1' : '0.4';

  if (settings.glass) document.body.classList.add('liquid-glass');
  else document.body.classList.remove('liquid-glass');

  resizeCanvas();

  nextSampleTime = 0;
  simTime = 0;

  requestAnimationFrame(loop);
}

init();

})();
