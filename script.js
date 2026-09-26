(function() {
    'use strict';

    // ==================== 数据存储 ====================
    const NICKNAME_KEY = 'pomodoro_nickname';
    const RECORDS_KEY = 'pomodoro_records';
    const TOTAL_MINUTES_KEY = 'pomodoro_total_minutes';
    const SETTINGS_KEY = 'pomodoro_work_rest_settings';
    const CYCLE_KEY = 'pomodoro_auto_cycle';

    const DEFAULT_SETTINGS = { workMinutes: 25, restMinutes: 5 };
    const BASE_TIME = new Date('2020-01-01T00:00:00Z').getTime();
    const CODE_VALID_MS = 2 * 60 * 60 * 1000; // 2 小时

    let nickname = localStorage.getItem(NICKNAME_KEY) || '专注者';
    let records = [];
    try { records = JSON.parse(localStorage.getItem(RECORDS_KEY)) || []; } catch(e) { records = []; }
    let settings = { ...DEFAULT_SETTINGS };
    try { const saved = JSON.parse(localStorage.getItem(SETTINGS_KEY)); if (saved && saved.workMinutes) settings = saved; } catch(e) {}
    let autoCycle = localStorage.getItem(CYCLE_KEY) === 'true';

    let totalMinutesStored = parseInt(localStorage.getItem(TOTAL_MINUTES_KEY), 10);
    if (isNaN(totalMinutesStored)) totalMinutesStored = records.reduce((sum, r) => sum + (r.minutes || 0), 0);

    function saveRecords() { localStorage.setItem(RECORDS_KEY, JSON.stringify(records)); }
    function saveSettings() { localStorage.setItem(SETTINGS_KEY, JSON.stringify(settings)); }
    function saveCycle() { localStorage.setItem(CYCLE_KEY, autoCycle.toString()); }
    function saveTotalMinutes(n) { totalMinutesStored = n; localStorage.setItem(TOTAL_MINUTES_KEY, n.toString()); }

    function calculateTomatoes(totalMinutes) { return Math.floor(totalMinutes / 30); }
    function calculateLevel(tomatoes) {
        if (tomatoes >= 10000) return 6;
        if (tomatoes >= 1000) return 5;
        if (tomatoes >= 200) return 4;
        if (tomatoes >= 100) return 3;
        if (tomatoes >= 50) return 2;
        if (tomatoes >= 20) return 1;
        return 0;
    }
    function getTotalFocusMinutes() { return totalMinutesStored; }
    function getTomatoCount() { return calculateTomatoes(getTotalFocusMinutes()); }
    function getLevel() { return calculateLevel(getTomatoCount()); }

    // ==================== 番茄钟状态 ====================
    const state = {
        mode: 'work',
        workMinutes: settings.workMinutes,
        restMinutes: settings.restMinutes,
        totalSeconds: settings.workMinutes * 60,
        remainingSeconds: settings.workMinutes * 60,
        isRunning: false,
        isPaused: false,
        soundEnabled: true,
        timerId: null,
        lastTickTime: 0,
        accumulatedPauseMs: 0,
        pauseStartTime: 0,
        totalDurationMs: settings.workMinutes * 60 * 1000,
    };

    // DOM元素
    const timerSubview = document.getElementById('timerSubview');
    const statsSubview = document.getElementById('statsSubview');
    const settingsSubview = document.getElementById('settingsSubview');
    const navBtns = document.querySelectorAll('.nav-btn');
    const btnSound = document.getElementById('btnSound');
    const btnStart = document.getElementById('btnStart');
    const btnReset = document.getElementById('btnReset');
    const cycleToggle = document.getElementById('cycleToggle');
    const timerDisplay = document.getElementById('timerDisplay');
    const timerLabel = document.getElementById('timerLabel');
    const ringProgress = document.getElementById('ringProgress');
    const presetContainer = document.getElementById('presetContainer');
    const countValueEl = document.getElementById('countValue');
    const tomatoCountEl = document.getElementById('tomatoCount');
    const homeNickname = document.getElementById('homeNickname');
    const levelBadge = document.getElementById('levelBadge');
    const celebrationOverlay = document.getElementById('celebrationOverlay');
    const successOverlay = document.getElementById('successOverlay');
    const btnCloseSuccess = document.getElementById('btnCloseSuccess');
    const successMessage = document.getElementById('successMessage');
    const celebrationSubText = document.getElementById('celebrationSubText');

    const totalMinutesEl = document.getElementById('totalMinutes');
    const totalTomatoesEl = document.getElementById('totalTomatoes');
    const levelDisplayEl = document.getElementById('levelDisplay');
    const recordListEl = document.getElementById('recordList');

    const nicknameInput = document.getElementById('nicknameInput');
    const btnSaveNickname = document.getElementById('btnSaveNickname');
    const nicknameError = document.getElementById('nicknameError');
    const nicknameSuccess = document.getElementById('nicknameSuccess');

    const workMinutesInput = document.getElementById('workMinutesInput');
    const restMinutesInput = document.getElementById('restMinutesInput');
    const btnSaveWorkRest = document.getElementById('btnSaveWorkRest');
    const workRestError = document.getElementById('workRestError');
    const workRestSuccess = document.getElementById('workRestSuccess');

    // 导入/导出 DOM
    const btnExportData = document.getElementById('btnExportData');
    const btnImportData = document.getElementById('btnImportData');
    const btnCopyCode = document.getElementById('btnCopyCode');
    const importExportArea = document.getElementById('importExportArea');
    const codeInfo = document.getElementById('codeInfo');
    const dataError = document.getElementById('dataError');
    const dataSuccess = document.getElementById('dataSuccess');

    const RING_CIRCUMFERENCE = 785.4;
    let successTimeout = null;

    // ==================== 更新UI ====================
    function formatTime(totalSeconds) {
        const secs = Math.max(0, Math.floor(totalSeconds));
        const hours = Math.floor(secs / 3600);
        const minutes = Math.floor((secs % 3600) / 60);
        const seconds = secs % 60;
        if (hours > 0) return `${hours}:${String(minutes).padStart(2,'0')}:${String(seconds).padStart(2,'0')}`;
        return `${String(minutes).padStart(2,'0')}:${String(seconds).padStart(2,'0')}`;
    }

    function updateDisplay() {
        timerDisplay.textContent = formatTime(state.remainingSeconds);
        timerDisplay.classList.toggle('small', state.remainingSeconds >= 3600);
        const ratio = state.totalSeconds > 0 ? state.remainingSeconds / state.totalSeconds : 0;
        timerDisplay.classList.remove('warning','danger');
        if (state.isRunning || state.isPaused) {
            if (ratio <= 0.1 && state.remainingSeconds > 0) timerDisplay.classList.add('danger');
            else if (ratio <= 0.25 && state.remainingSeconds > 0) timerDisplay.classList.add('warning');
        }
        if (state.mode === 'rest') {
            timerLabel.textContent = state.isRunning ? '休息中' : state.isPaused ? '休息暂停' : '休息时间';
            timerLabel.classList.add('rest');
            timerDisplay.style.color = 'var(--rest-green)';
        } else {
            timerLabel.textContent = state.isRunning ? '专注中' : state.isPaused ? '已暂停' : '剩余时间';
            timerLabel.classList.remove('rest');
            timerDisplay.style.color = 'var(--text-primary)';
        }
        document.title = state.isRunning ? `⏱ ${formatTime(state.remainingSeconds)} (${state.mode === 'rest' ? '休息' : '专注'})` : '🍅 番茄钟';
    }

    function updateRing() {
        const ratio = state.totalSeconds > 0 ? state.remainingSeconds / state.totalSeconds : 0;
        const offset = RING_CIRCUMFERENCE * (1 - ratio);
        ringProgress.setAttribute('stroke-dashoffset', offset);
        ringProgress.classList.remove('warning','danger','rest');
        if (state.mode === 'rest') {
            ringProgress.classList.add('rest');
        } else if (state.isRunning || state.isPaused) {
            if (ratio <= 0.1 && state.remainingSeconds > 0) ringProgress.classList.add('danger');
            else if (ratio <= 0.25 && state.remainingSeconds > 0) ringProgress.classList.add('warning');
        }
        if (state.remainingSeconds <= 0) ringProgress.classList.remove('warning','danger');
    }

    function updatePresetButtons() {
        document.querySelectorAll('.preset-btn').forEach(btn => {
            const min = parseInt(btn.dataset.minutes, 10);
            btn.classList.toggle('active', min === state.workMinutes);
        });
    }

    function updateStartButton() {
        if (state.isRunning) {
            btnStart.textContent = '⏸ 暂停';
            btnStart.classList.add('paused');
        } else if (state.isPaused) {
            btnStart.textContent = '▶ 继续';
            btnStart.classList.add('paused');
        } else {
            btnStart.textContent = '▶ 开始';
            btnStart.classList.remove('paused');
        }
    }

    function updateSoundButton() { btnSound.textContent = state.soundEnabled ? '🔊' : '🔇'; }

    function updateCycleButton() {
        cycleToggle.classList.toggle('active', autoCycle);
        cycleToggle.textContent = autoCycle ? '🔁 循环开' : '🔁 循环关';
    }

    function updateLevelAndStats() {
        const totalMinutes = getTotalFocusMinutes();
        const tomatoes = getTomatoCount();
        const level = getLevel();
        countValueEl.textContent = tomatoes;
        levelBadge.textContent = `⭐ LV${level}`;
        totalMinutesEl.textContent = totalMinutes;
        totalTomatoesEl.textContent = tomatoes;
        levelDisplayEl.textContent = `LV${level}`;
    }

    function updateStatsAndRecords() {
        updateLevelAndStats();
        recordListEl.innerHTML = '';
        if (records.length === 0) {
            recordListEl.innerHTML = '<div class="empty-records">暂无记录，开始第一个番茄吧！</div>';
            return;
        }
        const sorted = [...records].sort((a, b) => b.timestamp - a.timestamp);
        sorted.forEach(record => {
            const item = document.createElement('div');
            item.className = 'record-item';
            const dateStr = new Date(record.timestamp).toLocaleString('zh-CN', {
                month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit'
            });
            item.innerHTML = `<span class="date">${dateStr}</span><span class="duration">${record.minutes} 分钟</span>`;
            recordListEl.appendChild(item);
        });
    }

    function updateNicknameDisplay() {
        homeNickname.textContent = `👤 ${nickname}`;
        nicknameInput.value = nickname;
    }

    function updateAllUI() {
        updateDisplay();
        updateRing();
        updatePresetButtons();
        updateStartButton();
        updateSoundButton();
        updateCycleButton();
        updateLevelAndStats();
        updateNicknameDisplay();
    }

    // ==================== 昵称 ====================
    btnSaveNickname.addEventListener('click', () => {
        const newNickname = nicknameInput.value.trim();
        if (!newNickname) {
            nicknameError.textContent = '请输入昵称';
            nicknameSuccess.textContent = '';
            return;
        }
        nickname = newNickname;
        localStorage.setItem(NICKNAME_KEY, nickname);
        updateNicknameDisplay();
        nicknameError.textContent = '';
        nicknameSuccess.textContent = '昵称已保存';
        showSuccess('昵称保存成功', '耶耶耶太好了');
        setTimeout(() => { nicknameSuccess.textContent = ''; }, 2000);
    });

    // ==================== 工作/休息设置 ====================
    function loadSettingsToInputs() {
        workMinutesInput.value = settings.workMinutes;
        restMinutesInput.value = settings.restMinutes;
    }

    btnSaveWorkRest.addEventListener('click', () => {
        const wm = parseInt(workMinutesInput.value, 10);
        const rm = parseInt(restMinutesInput.value, 10);
        if (isNaN(wm) || wm <= 0 || isNaN(rm) || rm <= 0) {
            workRestError.textContent = '请输入有效的分钟数';
            workRestSuccess.textContent = '';
            return;
        }
        if (wm > 180) { workRestError.textContent = '工作分钟数不能超过180'; return; }
        if (rm > 60) { workRestError.textContent = '休息分钟数不能超过60'; return; }
        settings.workMinutes = wm;
        settings.restMinutes = rm;
        saveSettings();
        state.workMinutes = wm;
        state.restMinutes = rm;
        if (state.mode === 'work') {
            state.totalSeconds = wm * 60;
            state.totalDurationMs = wm * 60 * 1000;
            if (!state.isRunning && !state.isPaused) state.remainingSeconds = state.totalSeconds;
        } else {
            state.totalSeconds = rm * 60;
            state.totalDurationMs = rm * 60 * 1000;
            if (!state.isRunning && !state.isPaused) state.remainingSeconds = state.totalSeconds;
        }
        updatePresetButtons();
        updateDisplay();
        updateRing();
        workRestError.textContent = '';
        workRestSuccess.textContent = '设置已保存';
        showSuccess('设置已保存', '工作/休息时间已更新');
        setTimeout(() => { workRestSuccess.textContent = ''; }, 2000);
    });

    // ==================== 循环开关 ====================
    cycleToggle.addEventListener('click', () => {
        autoCycle = !autoCycle;
        saveCycle();
        updateCycleButton();
    });

    // ==================== 纯数字编码：导入/导出 ====================

    function writeVarint(bytes, n) {
        n = n >>> 0;
        while (n >= 0x80) {
            bytes.push((n & 0x7F) | 0x80);
            n >>>= 7;
        }
        bytes.push(n);
    }

    function readVarint(bytes, pos) {
        let result = 0;
        let shift = 0;
        let b;
        do {
            if (pos >= bytes.length) throw new Error('编码不完整');
            b = bytes[pos++];
            result |= (b & 0x7F) << shift;
            shift += 7;
            if (shift > 35) throw new Error('varint 过长');
        } while (b & 0x80);
        return { value: result >>> 0, pos };
    }

    function writeVarintSigned(bytes, n) {
        const zigzag = ((n << 1) ^ (n >> 31)) >>> 0;
        writeVarint(bytes, zigzag);
    }

    function readVarintSigned(bytes, pos) {
        const r = readVarint(bytes, pos);
        const value = (r.value >>> 1) ^ -(r.value & 1);
        return { value, pos: r.pos };
    }

    function bytesToDecimalString(bytes) {
        let n = 0n;
        for (const b of bytes) {
            n = (n << 8n) | BigInt(b);
        }
        return n.toString();
    }

    function decimalStringToBytes(str) {
        if (!/^\d+$/.test(str)) throw new Error('编码格式错误，只允许数字');
        let n = BigInt(str);
        if (n === 0n) throw new Error('编码无效');
        const bytes = [];
        while (n > 0n) {
            bytes.unshift(Number(n & 0xFFn));
            n >>= 8n;
        }
        return bytes;
    }

    // 编码：完整记录 + 时间戳
    function encodeData() {
        const bytes = [];
        bytes.push(1); // 版本

        let flags = 0;
        if (autoCycle) flags |= 1;
        bytes.push(flags);

        bytes.push(settings.workMinutes & 0xFF);
        bytes.push(settings.restMinutes & 0xFF);

        // 总专注分钟数（根据记录重新计算，保证一致）
        const totalMinutes = records.reduce((sum, r) => sum + (r.minutes || 0), 0);
        writeVarint(bytes, totalMinutes);

        // 导出时间戳
        writeVarint(bytes, Date.now());

        // 昵称
        const nickBytes = new TextEncoder().encode(nickname.slice(0, 20));
        const nickLen = Math.min(nickBytes.length, 60);
        bytes.push(nickLen);
        for (let i = 0; i < nickLen; i++) bytes.push(nickBytes[i]);

        // 全部记录，按时间升序
        const sorted = [...records].sort((a, b) => a.timestamp - b.timestamp);
        writeVarint(bytes, sorted.length);

        let prevMinutes = 0;
        for (const r of sorted) {
            const minFromBase = Math.floor((r.timestamp - BASE_TIME) / 60000);
            const delta = minFromBase - prevMinutes;
            prevMinutes = minFromBase;
            writeVarintSigned(bytes, delta);
            bytes.push(Math.min(255, r.minutes) & 0xFF);
        }

        return bytesToDecimalString(bytes);
    }

    // 解码：校验有效期
    function decodeData(code) {
        const bytes = decimalStringToBytes(code);
        let pos = 0;

        const version = bytes[pos++];
        if (version !== 1) throw new Error('不支持的编码版本');

        const flags = bytes[pos++];
        const decodedAutoCycle = (flags & 1) === 1;

        const workMinutes = bytes[pos++];
        const restMinutes = bytes[pos++];
        if (workMinutes < 1 || workMinutes > 180) throw new Error('工作分钟数异常');
        if (restMinutes < 1 || restMinutes > 60) throw new Error('休息分钟数异常');

        const r1 = readVarint(bytes, pos);
        const decodedTotalMinutes = r1.value;
        pos = r1.pos;

        const r2 = readVarint(bytes, pos);
        const exportTime = r2.value;
        pos = r2.pos;

        // 有效期检查
        const now = Date.now();
        if (now - exportTime > CODE_VALID_MS) {
            throw new Error('编码已过期（超过2小时），请重新生成');
        }
        if (exportTime > now + 60000) {
            throw new Error('编码时间异常');
        }

        const nickLen = bytes[pos++];
        if (nickLen > 120) throw new Error('昵称长度异常');
        const nickBytes = bytes.slice(pos, pos + nickLen);
        pos += nickLen;
        const decodedNickname = new TextDecoder().decode(new Uint8Array(nickBytes));

        const r3 = readVarint(bytes, pos);
        const recordCount = r3.value;
        pos = r3.pos;
        if (recordCount > 10000) throw new Error('记录数量异常');

        const decodedRecords = [];
        let prevMinutes = 0;
        for (let i = 0; i < recordCount; i++) {
            const r = readVarintSigned(bytes, pos);
            pos = r.pos;
            const delta = r.value;
            const minFromBase = prevMinutes + delta;
            prevMinutes = minFromBase;
            const timestamp = BASE_TIME + minFromBase * 60000;
            const minutes = bytes[pos++];
            decodedRecords.push({
                date: new Date(timestamp).toISOString(),
                timestamp,
                minutes
            });
        }

        return {
            nickname: decodedNickname,
            totalMinutes: decodedTotalMinutes,
            settings: { workMinutes, restMinutes },
            autoCycle: decodedAutoCycle,
            records: decodedRecords
        };
    }

    function updateCodeInfo(code) {
        const len = code ? code.length : 0;
        if (len === 0) {
            codeInfo.textContent = '';
            codeInfo.className = 'code-info';
            return;
        }
        codeInfo.className = 'code-info ok';
        codeInfo.textContent = `编码长度：${len} 位 · 有效期 2 小时`;
    }

    // 导出
    btnExportData.addEventListener('click', () => {
        try {
            // 同步总分钟数
            const total = records.reduce((sum, r) => sum + (r.minutes || 0), 0);
            saveTotalMinutes(total);
            const code = encodeData();
            importExportArea.value = code;
            updateCodeInfo(code);
            dataError.textContent = '';
            dataSuccess.textContent = '编码已生成，有效期 2 小时，可点击复制';
            copyToClipboard(code).then(() => {
                dataSuccess.textContent = '编码已生成并复制到剪贴板';
            }).catch(() => {});
            setTimeout(() => { dataSuccess.textContent = ''; }, 3000);
        } catch (e) {
            dataError.textContent = '导出失败：' + e.message;
            dataSuccess.textContent = '';
        }
    });

    // 复制
    btnCopyCode.addEventListener('click', () => {
        const code = importExportArea.value.trim();
        if (!code) {
            dataError.textContent = '暂无编码可复制';
            dataSuccess.textContent = '';
            return;
        }
        copyToClipboard(code).then(() => {
            dataError.textContent = '';
            dataSuccess.textContent = '已复制到剪贴板';
            setTimeout(() => { dataSuccess.textContent = ''; }, 2000);
        }).catch(() => {
            dataError.textContent = '复制失败，请手动选择复制';
            dataSuccess.textContent = '';
        });
    });

    // 导入
    btnImportData.addEventListener('click', () => {
        const code = importExportArea.value.trim();
        if (!code) {
            dataError.textContent = '请先粘贴导入编码';
            dataSuccess.textContent = '';
            return;
        }
        if (!/^\d+$/.test(code)) {
            dataError.textContent = '编码格式错误，只允许数字';
            dataSuccess.textContent = '';
            return;
        }
        try {
            const data = decodeData(code);
            if (!confirm('导入将覆盖当前所有数据（昵称、设置、记录、等级），确定继续吗？')) {
                return;
            }

            nickname = data.nickname || '专注者';
            localStorage.setItem(NICKNAME_KEY, nickname);

            settings = {
                workMinutes: data.settings.workMinutes,
                restMinutes: data.settings.restMinutes
            };
            saveSettings();
            state.workMinutes = settings.workMinutes;
            state.restMinutes = settings.restMinutes;

            autoCycle = data.autoCycle;
            saveCycle();

            // 根据导入的记录重新计算总分钟数，确保准确
            const total = data.records.reduce((sum, r) => sum + (r.minutes || 0), 0);
            saveTotalMinutes(total);

            records = data.records.map(r => ({
                date: r.date,
                minutes: r.minutes,
                timestamp: r.timestamp
            }));
            saveRecords();

            state.mode = 'work';
            state.totalSeconds = settings.workMinutes * 60;
            state.totalDurationMs = settings.workMinutes * 60 * 1000;
            state.remainingSeconds = state.totalSeconds;
            state.isRunning = false;
            state.isPaused = false;
            stopTimerInterval();

            updateAllUI();
            updateStatsAndRecords();
            loadSettingsToInputs();
            updateCodeInfo('');
            dataError.textContent = '';
            dataSuccess.textContent = '数据导入成功！';
            showSuccess('数据导入成功', '历史数据已完整恢复');
            setTimeout(() => { dataSuccess.textContent = ''; }, 3000);
        } catch (e) {
            dataError.textContent = '导入失败：' + e.message;
            dataSuccess.textContent = '';
        }
    });

    importExportArea.addEventListener('input', () => {
        const code = importExportArea.value.trim();
        updateCodeInfo(code);
    });

    function copyToClipboard(text) {
        return new Promise((resolve, reject) => {
            if (navigator.clipboard && navigator.clipboard.writeText) {
                navigator.clipboard.writeText(text).then(resolve).catch(() => {
                    fallbackCopy(text).then(resolve).catch(reject);
                });
            } else {
                fallbackCopy(text).then(resolve).catch(reject);
            }
        });
    }

    function fallbackCopy(text) {
        return new Promise((resolve, reject) => {
            try {
                const textarea = document.createElement('textarea');
                textarea.value = text;
                textarea.style.position = 'fixed';
                textarea.style.opacity = '0';
                document.body.appendChild(textarea);
                textarea.select();
                document.execCommand('copy');
                document.body.removeChild(textarea);
                resolve();
            } catch (e) {
                reject(e);
            }
        });
    }

    // ==================== 计时逻辑 ====================
    function setMode(mode) {
        state.mode = mode;
        if (mode === 'work') {
            state.totalSeconds = state.workMinutes * 60;
            state.totalDurationMs = state.workMinutes * 60 * 1000;
        } else {
            state.totalSeconds = state.restMinutes * 60;
            state.totalDurationMs = state.restMinutes * 60 * 1000;
        }
        state.remainingSeconds = state.totalSeconds;
        state.isRunning = false;
        state.isPaused = false;
        stopTimerInterval();
        updateStartButton();
        updateDisplay();
        updateRing();
    }

    function startTimer() {
        if (state.isRunning) return;
        if (state.remainingSeconds <= 0) resetTimer();
        state.isRunning = true;
        state.isPaused = false;
        state.lastTickTime = Date.now();
        state.accumulatedPauseMs = 0;
        updateStartButton();
        updateDisplay();
        if (state.timerId) clearInterval(state.timerId);
        state.timerId = setInterval(tick, 200);
        hideCelebration();
    }

    function pauseTimer() {
        if (!state.isRunning) return;
        state.isRunning = false;
        state.isPaused = true;
        state.pauseStartTime = Date.now();
        stopTimerInterval();
        updateStartButton();
        updateDisplay();
    }

    function resumeTimer() {
        if (state.isRunning || !state.isPaused) return;
        state.isRunning = true;
        state.isPaused = false;
        state.accumulatedPauseMs += Date.now() - state.pauseStartTime;
        state.lastTickTime = Date.now();
        updateStartButton();
        updateDisplay();
        if (state.timerId) clearInterval(state.timerId);
        state.timerId = setInterval(tick, 200);
    }

    function resetTimer() {
        stopTimerInterval();
        state.isRunning = false;
        state.isPaused = false;
        setMode(state.mode);
        hideCelebration();
        updateStartButton();
        updateDisplay();
        updateRing();
    }

    function stopTimerInterval() {
        if (state.timerId) {
            clearInterval(state.timerId);
            state.timerId = null;
        }
    }

    function tick() {
        const now = Date.now();
        const elapsedMs = (now - state.lastTickTime) + state.accumulatedPauseMs;
        const remainingMs = state.totalDurationMs - elapsedMs;
        state.remainingSeconds = Math.max(0, Math.ceil(remainingMs / 1000));
        updateDisplay();
        updateRing();
        if (remainingMs <= 0) {
            state.remainingSeconds = 0;
            completeCurrentPhase();
        }
    }

    function completeCurrentPhase() {
        stopTimerInterval();
        state.isRunning = false;
        state.isPaused = false;
        updateStartButton();

        if (state.mode === 'work') {
            const focusMinutes = state.workMinutes;
            records.push({
                date: new Date().toISOString(),
                minutes: focusMinutes,
                timestamp: Date.now()
            });
            saveRecords();
            saveTotalMinutes(totalMinutesStored + focusMinutes);
            updateStatsAndRecords();
            const tomatoes = getTomatoCount();
            countValueEl.textContent = tomatoes;
            tomatoCountEl.classList.remove('bump');
            void tomatoCountEl.offsetWidth;
            tomatoCountEl.classList.add('bump');
            if (state.soundEnabled) playCompletionSound();

            if (autoCycle) {
                setMode('rest');
                showCelebration('休息时间', '休息一下吧');
                startTimer();
            } else {
                showCelebration('时间到！', '干得漂亮，休息一下吧');
                resetTimer();
            }
        } else if (state.mode === 'rest') {
            if (state.soundEnabled) playCompletionSound();
            if (autoCycle) {
                setMode('work');
                showCelebration('休息结束', '开始新的专注吧');
                startTimer();
            } else {
                showCelebration('休息结束', '准备下一次专注吧');
                resetTimer();
            }
        }
    }

    function showCelebration(title, subText) {
        celebrationOverlay.querySelector('.text').textContent = title;
        celebrationSubText.textContent = subText || '';
        celebrationOverlay.classList.add('active');
        clearTimeout(showCelebration._t);
        showCelebration._t = setTimeout(() => {
            celebrationOverlay.classList.remove('active');
        }, 3000);
    }
    function hideCelebration() { celebrationOverlay.classList.remove('active'); }

    function showSuccess(title, msg) {
        successOverlay.querySelector('.text').textContent = title;
        successMessage.textContent = msg || '耶耶耶太好了';
        successOverlay.classList.add('active');
        if (successTimeout) clearTimeout(successTimeout);
        successTimeout = setTimeout(() => {
            successOverlay.classList.remove('active');
        }, 3000);
    }
    function hideSuccessOverlay() {
        successOverlay.classList.remove('active');
        if (successTimeout) clearTimeout(successTimeout);
    }
    btnCloseSuccess.addEventListener('click', hideSuccessOverlay);

    // 声音
    let audioContext = null;
    function getAudioContext() {
        if (!audioContext) {
            try { audioContext = new (window.AudioContext || window.webkitAudioContext)(); } catch(e) { audioContext = null; }
        }
        return audioContext;
    }
    function playCompletionSound() {
        try {
            const ctx = getAudioContext();
            if (!ctx) return;
            if (ctx.state === 'suspended') ctx.resume();
            const notes = [
                { freq: 523.25, time: 0, duration: 0.25 },
                { freq: 659.25, time: 0.18, duration: 0.25 },
                { freq: 783.99, time: 0.36, duration: 0.4 },
            ];
            notes.forEach(note => {
                const osc = ctx.createOscillator();
                const gain = ctx.createGain();
                osc.type = 'sine';
                osc.frequency.setValueAtTime(note.freq, ctx.currentTime + note.time);
                gain.gain.setValueAtTime(0, ctx.currentTime + note.time);
                gain.gain.linearRampToValueAtTime(0.3, ctx.currentTime + note.time + 0.03);
                gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + note.time + note.duration);
                osc.connect(gain); gain.connect(ctx.destination);
                osc.start(ctx.currentTime + note.time);
                osc.stop(ctx.currentTime + note.time + note.duration + 0.05);
            });
        } catch(e) {}
    }

    // ==================== 预设按钮 ====================
    presetContainer.addEventListener('click', (e) => {
        const btn = e.target.closest('.preset-btn');
        if (!btn) return;
        const minutes = parseInt(btn.dataset.minutes, 10);
        state.workMinutes = minutes;
        settings.workMinutes = minutes;
        saveSettings();
        if (state.mode === 'work' && !state.isRunning && !state.isPaused) {
            state.totalSeconds = minutes * 60;
            state.totalDurationMs = minutes * 60 * 1000;
            state.remainingSeconds = state.totalSeconds;
        }
        updatePresetButtons();
        updateDisplay();
        updateRing();
        workMinutesInput.value = minutes;
    });

    // ==================== 控制按钮 ====================
    btnStart.addEventListener('click', () => {
        if (state.isRunning) pauseTimer();
        else if (state.isPaused) resumeTimer();
        else startTimer();
    });

    btnReset.addEventListener('click', resetTimer);

    btnSound.addEventListener('click', () => {
        state.soundEnabled = !state.soundEnabled;
        updateSoundButton();
        if (state.soundEnabled) playCompletionSound();
    });

    // 键盘快捷键
    document.addEventListener('keydown', (e) => {
        const tag = e.target.tagName;
        if (tag === 'INPUT' || tag === 'TEXTAREA') return;
        if (e.code === 'Space') {
            e.preventDefault();
            if (state.isRunning) pauseTimer();
            else if (state.isPaused) resumeTimer();
            else startTimer();
        } else if (e.code === 'KeyR') {
            e.preventDefault();
            resetTimer();
        }
    });

    // ==================== 视图切换 ====================
    function showTimerView() {
        timerSubview.style.display = 'block';
        statsSubview.style.display = 'none';
        settingsSubview.style.display = 'none';
        navBtns.forEach(btn => btn.classList.toggle('active', btn.dataset.view === 'timer'));
    }
    function showStatsView() {
        timerSubview.style.display = 'none';
        statsSubview.style.display = 'flex';
        settingsSubview.style.display = 'none';
        navBtns.forEach(btn => btn.classList.toggle('active', btn.dataset.view === 'stats'));
        updateStatsAndRecords();
    }
    function showSettingsView() {
        timerSubview.style.display = 'none';
        statsSubview.style.display = 'none';
        settingsSubview.style.display = 'flex';
        navBtns.forEach(btn => btn.classList.toggle('active', btn.dataset.view === 'settings'));
        loadSettingsToInputs();
        nicknameInput.value = nickname;
        nicknameError.textContent = '';
        nicknameSuccess.textContent = '';
        dataError.textContent = '';
        dataSuccess.textContent = '';
        updateCodeInfo(importExportArea.value.trim());
    }

    navBtns.forEach(btn => {
        btn.addEventListener('click', () => {
            const view = btn.dataset.view;
            if (view === 'timer') showTimerView();
            else if (view === 'stats') showStatsView();
            else if (view === 'settings') showSettingsView();
        });
    });

    // ==================== 初始化 ====================
    function init() {
        state.workMinutes = settings.workMinutes;
        state.restMinutes = settings.restMinutes;
        state.totalSeconds = settings.workMinutes * 60;
        state.remainingSeconds = state.totalSeconds;
        state.totalDurationMs = settings.workMinutes * 60 * 1000;
        updateAllUI();
        updateStatsAndRecords();
        showTimerView();
    }

    init();
})();