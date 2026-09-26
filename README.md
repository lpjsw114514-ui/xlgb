# ECG · 心电监护

> 一个黑白极简的浏览器心电监护页面：Web Bluetooth 直连心率设备，实时绘制 ECG 波形，每次心跳迸发白色星光。

![HTML](https://img.shields.io/badge/HTML-5-E34F26?logo=html5&logoColor=white)
![CSS](https://img.shields.io/badge/CSS-3-1572B6?logo=css3&logoColor=white)
![JavaScript](https://img.shields.io/badge/JavaScript-ES6+-F7DF1E?logo=javascript&logoColor=black)
![Web Bluetooth](https://img.shields.io/badge/Web%20Bluetooth-API-4285F4?logo=bluetooth&logoColor=white)
![License](https://img.shields.io/badge/License-MIT-green)

### 🔗 在线体验：**[https://xinlv.pages.dev](https://xinlv.pages.dev)**

---

## 简介

**ECG · 心电监护**是一个纯前端、零依赖的实时心率可视化项目。它不依赖任何后端服务，也不需要安装 App，打开网页即可连接支持标准 BLE 心率服务（`0x180D`）的设备，把心跳变成一条持续滚动的 ECG 波形，并用星光粒子标记每一次心搏。

视觉上采用黑白极简风格：黑色背景、白色网格、发光的白色波形，以及心跳瞬间爆发的白色星光与涟漪。整体没有多余色彩，强调“生命信号”本身的节奏感与科技感。

未连接设备时，页面自动进入**模拟模式**。拖动底部的速度滑块，可以模拟不同运动强度下的心率变化——从静息状态的 68 BPM 到接近极限的 180 BPM，波形会随之加快，星光也会更密集。

---

## 功能特性

- **Web Bluetooth 直连** — 支持标准 BLE 心率服务（`0x180D`）的设备，无需额外驱动或 App
- **实时心电图** — 200Hz 采样，P/Q/R/S/T 五波叠加，R 峰清晰可辨，波形以 500px/s 向左滚动
- **心跳星光** — 每次 R 峰触发一簇白色星光粒子，向外扩散并逐渐衰减，同时产生一圈涟漪
- **黑白极简视觉** — 纯黑背景、白色网格、多层辉光波形，暗角收束视线
- **模拟模式** — 未连接设备时可用速度滑块模拟运动强度，心率平滑跟随并带自然波动
- **关于面板** — 内置兼容设备列表，涵盖华为、Polar、Garmin、Wahoo、小米/Amazfit、Samsung、Apple 等主流品牌
- **响应式布局** — 适配桌面与移动端
- **零依赖** — 原生 HTML + CSS + JavaScript，无框架、无构建工具

---

## 技术栈

| 技术 | 用途 |
|---|---|
| HTML5 | 页面结构 |
| CSS3 | 布局、毛玻璃面板、暗角、响应式 |
| JavaScript (ES6+) | 主循环、状态管理、蓝牙通信 |
| Canvas 2D | 网格、ECG 波形、星光粒子、涟漪 |
| Web Bluetooth API | 读取心率测量特征值（Heart Rate Measurement） |

**波形生成原理：** 由五个高斯函数叠加生成标准心电波形：

- P 波（`t = 0.120`，幅度 `0.090`）
- Q 波（`t = 0.213`，幅度 `-0.130`）
- R 波（`t = 0.235`，幅度 `1.000`）
- S 波（`t = 0.262`，幅度 `-0.250`）
- T 波（`t = 0.420`，幅度 `0.250`）

R 峰穿越检测触发星光，星光精灵预渲染以避免每帧创建渐变。

---

## 快速开始

### 在线体验

直接访问：**[https://xinlv.pages.dev](https://xinlv.pages.dev)**

> 用 **Chrome** 或 **Edge** 打开，点击「连接心率设备」即可。Cloudflare Pages 默认提供 HTTPS，满足 Web Bluetooth 的安全上下文要求。

### 本地运行

不要直接双击 `index.html`（`file://` 协议下 Web Bluetooth 会被浏览器拦截）。用一行命令起个本地服务：

```bash
# Python 3
python -m http.server 8000

# 或 Node.js
npx serve
```

然后访问 `http://localhost:8000`。

### 部署到 GitHub Pages

1. 把三个文件上传到仓库根目录：

   ```
   index.html
   style.css
   script.js
   ```

2. 进入仓库 **Settings → Pages**
3. **Source** 选 `Deploy from a branch`
4. **Branch** 选 `main`，目录选 `/ (root)`，保存
5. 等 1–2 分钟，访问 `https://你的用户名.github.io/仓库名/`

> GitHub Pages 默认提供 HTTPS，满足 Web Bluetooth 的安全上下文要求。

---

## 使用方法

1. 用 **Chrome** 或 **Edge** 打开 [https://xinlv.pages.dev](https://xinlv.pages.dev)（或本地服务）
2. 点击底部「连接心率设备」，在浏览器弹窗中选择你的设备
3. 连接成功后，心电图会实时显示你的心率，每次心搏都会触发星光
4. 未连接设备时，拖动「速度」滑块即可模拟不同强度下的心率变化
5. 点击右上角「关于」查看完整兼容设备列表与使用提示

---

## 兼容设备

只要设备支持标准 BLE 心率服务（`0x180D`）即可连接。部分手表/手环需先在设备端开启「心率广播」或「心率推送」功能，浏览器才能搜索到。

| 品牌 | 示例设备 |
|---|---|
| 华为 HUAWEI | WATCH GT 2/3/4/5、WATCH 4/4 Pro/5、WATCH Ultimate、WATCH FIT 2/3/4、手环 4–10 |
| Polar | H10、H9、OH1、Verity Sense |
| Garmin | HRM-Dual、HRM-Pro、HRM-Pro Plus、支持广播的 Garmin 手表 |
| Wahoo | TICKR、TICKR X、TICKR X2、TICKR FIT |
| 小米 / Amazfit | 小米手环 6–10、Amazfit Band 系列、Amazfit GTR/GTS |
| Samsung | Galaxy Watch 4–8、Galaxy Watch FE、Galaxy Watch Ultra |
| Apple | Apple Watch Series 1–11、SE、Ultra（需开启心率广播） |
| 其他 | Suunto 心率带、Decathlon/Kalenji 双模心率带、moofit、MyZone、Coospo、Magene |

---

## 浏览器要求

- **Chrome** / **Edge** 等 Chromium 内核浏览器
- 页面运行在 **HTTPS** 或 **localhost** 下
- 设备处于配对模式，且未被其他 App 占用

> Safari 与 Firefox 目前不支持 Web Bluetooth API。

---

## 项目结构

```
.
├── index.html      # 页面结构
├── style.css       # 样式：黑白极简、毛玻璃面板、响应式
├── script.js       # 逻辑：主循环、ECG 波形、蓝牙、星光粒子
└── README.md       # 本文件
```

---

## 自定义

### 修改波形速度

在 `script.js` 中调整 `PX_PER_MS`：

```javascript
const PX_PER_MS = 0.50;   // 越大滚动越快
```

### 修改模拟心率范围

在 `script.js` 的 `update()` 函数中调整：

```javascript
target = 68 + 112 * (1 - Math.exp(-speed / 7.5))
//        ↑静息    ↑最大增量
```

### 修改星光颜色

在 `script.js` 中调整 `SPARK_SPRITES`：

```javascript
const SPARK_SPRITES = [
  makeSprite(255, 255, 255),   // 纯白
  makeSprite(225, 225, 225),   // 浅灰
  makeSprite(190, 190, 190)    // 灰
];
```

### 兼容非标准设备

若设备未广播标准心率服务，可将 `requestDevice` 改为：

```javascript
const device = await navigator.bluetooth.requestDevice({
  acceptAllDevices: true,
  optionalServices: ['heart_rate']
});
```

---

## 常见问题

**Q：浏览器搜索不到我的设备？**
A：确认设备已开启「心率广播」功能；确认设备未被其他 App 占用；确认页面在 HTTPS 或 localhost 下运行。

**Q：连接成功但没有数据？**
A：部分设备需要先在设备端启动一次心率测量，广播才会持续。

**Q：Safari 能用吗？**
A：不能。Web Bluetooth API 目前仅 Chromium 内核浏览器支持。

**Q：可以跑在手机上吗？**
A：可以。Android 版 Chrome 支持 Web Bluetooth；iOS 由于浏览器限制暂不支持。

---

## 许可证

[MIT](LICENSE)

---

<p align="center">
  <sub>ECG · 心电监护 &nbsp;|&nbsp; Real-time Heart Monitor</sub><br>
  <a href="https://xinlv.pages.dev">https://xinlv.pages.dev</a>
</p>
