(() => {
    const STORAGE_KEY = "classroomManager_v9";
    const OLD_SEAT_KEY = "seatMap_v8";
    const OLD_CLEANING_KEY = "cleaningSchedule_v8";
    const WELCOME_KEY = "classroomManager_welcomeLastShownAt";
    const WELCOME_INTERVAL = 40 * 60 * 1000;
    const SEAT_COUNT = 39;
    const SPECIAL_SEATS = [0, 1, 2];
    const MAIN_SEATS = Array.from({ length: 36 }, (_, i) => i + 3);
    const DAYS = ["周一", "周二", "周三", "周四", "周五"];

    const DEFAULT_STUDENTS = [
        "童恩泽", "胡涵予", "曹雨涵", "陈星宇", "李紫嫣",
        "王佳琪", "曾可馨", "刘天乐", "王小满", "谌琳朗",
        "何雨萱", "田宸钰", "陈雨菲", "胡雅棋", "杨誉翔",
        "胡晓婷", "向思涵", "石宇丰", "李好", "方甜",
        "瞿雯沁", "何奥奥", "肖娅楠", "李旻泽", "刘佳雯",
        "王可欣", "夏侯德琳", "姚凯馨", "张倩", "苏雯欣",
        "夏文祺", "刘叶娜", "侯烨欣", "彭诗涵", "徐冷妍",
        "余妙琦", "魏瑾瑜", "兰舒煜", "姜欣扬"
    ];

    const DEFAULT_EXCLUDED = ["夏文祺", "石宇丰", "曹雨涵"];
    const CLASSROOM_ROLES = [
        { id: "sweep", label: "扫地", defaultCount: 2 },
        { id: "mop", label: "拖地", defaultCount: 1 },
        { id: "trash", label: "倒垃圾", defaultCount: 2 },
        { id: "board", label: "黑板整理", defaultCount: 1 }
    ];

    const STUDIO_ROLES = [
        { id: "studioSweep", label: "画室扫地", defaultCount: 1, defaultDays: [0, 1, 2, 3, 4] },
        { id: "studioMop", label: "画室拖地", defaultCount: 1, defaultDays: [0, 1, 2, 3, 4] },
        { id: "studioTrash", label: "画室倒垃圾", defaultCount: 1, defaultDays: [1, 3] }
    ];

    const ROW_MODE_LABELS = {
        swapHalves: "前后三排整体互换",
        fullCycle: "全班六行循环"
    };

    const COLUMN_DIRECTION_LABELS = {
        right: "向右",
        left: "向左"
    };

    const PICKER_MODE_LABELS = {
        taskUnique: "同次任务不重复",
        roundUnique: "每轮内不重复",
        free: "完全可重复"
    };

    const $ = (selector, root = document) => root.querySelector(selector);
    const $$ = (selector, root = document) => Array.from(root.querySelectorAll(selector));

    let state = createDefaultState();
    let dragInfo = null;
    let toastTimer = null;
    let saveTimer = null;
    let serviceConnected = false;
    let backupPath = null;
    let settingsDraft = null;
    let settingsDirty = false;
    let pendingPanelTarget = null;

    document.addEventListener("DOMContentLoaded", init);

    async function init() {
        setupWelcomeScreen();
        setSyncStatus("loading", "正在连接");
        state = await loadState();
        normalizeState();
        localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
        bindEvents();
        renderAll();
        updateBackupPathText();
        updateSyncAfterLoad();
    }

    function bindEvents() {
        document.body.addEventListener("click", handleClick);
        document.body.addEventListener("input", handleInput);
        document.body.addEventListener("change", handleChange);
        document.body.addEventListener("dragstart", handleDragStart);
        document.body.addEventListener("dragend", handleDragEnd);
        document.body.addEventListener("dragover", handleDragOver);
        document.body.addEventListener("drop", handleDrop);
        window.addEventListener("beforeunload", handleBeforeUnload);
        $("#dataFileInput").addEventListener("change", importData);
    }

    function handleClick(event) {
        const actionButton = event.target.closest("[data-action]");
        if (actionButton) {
            event.preventDefault();
            runAction(actionButton.dataset.action, actionButton);
            return;
        }

        const navButton = event.target.closest("[data-panel-target]");
        if (navButton) {
            switchPanel(navButton.dataset.panelTarget);
        }
    }

    function handleInput(event) {
        if (isSettingsField(event.target)) {
            updateSettingsDraftFromTarget(event.target);
        }
    }

    function handleChange(event) {
        const target = event.target;

        if (isSettingsField(target)) {
            updateSettingsDraftFromTarget(target);
            return;
        }

        if (target.id === "pickerCount") {
            state.picker.count = clampNumber(target.value, 1, Math.max(1, state.students.length), 1);
            saveState();
            renderPickerControls();
            return;
        }

        if (target.id === "pickerRounds") {
            state.picker.rounds = clampNumber(target.value, 1, 20, 1);
            saveState();
            renderPickerControls();
            return;
        }

        if (target.id === "pickerRepeatMode") {
            state.picker.repeatMode = validPickerMode(target.value);
            saveState();
            renderPickerControls();
            return;
        }
    }

    function runAction(action, source) {
        const actions = {
            "export-data": exportData,
            "import-data": () => $("#dataFileInput").click(),
            "select-backup-file": selectBackupFile,
            "refresh-backup-status": refreshBackupStatus,
            "rotate-seats": rotateSeats,
            "randomize-seats": randomizeSeats,
            "export-seat-image": () => exportImage("seatExportArea", "24美术2班座位表.png"),
            "toggle-seat-lock": () => toggleSeatLock(Number(source.dataset.seatIndex)),
            "generate-cleaning": () => generateCleaningSchedule(true),
            "rotate-cleaning-week": rotateCleaningWeek,
            "export-cleaning-image": () => exportImage("cleaningExportArea", "24美术2班清洁表.png"),
            "set-cleaning-leader": () => setCleaningLeader(Number(source.dataset.dayIndex), source.dataset.name),
            "run-picker": runPicker,
            "clear-picker-results": clearPickerResults,
            "save-students": saveSettingsFromDraft,
            "restore-default-students": restoreDefaultStudents,
            "save-cleaning-settings": saveSettingsFromDraft,
            "save-settings": saveSettingsFromDraft,
            "discard-settings": discardSettingsDraft,
            "confirm-save-settings-leave": saveSettingsAndLeave,
            "confirm-discard-settings-leave": discardSettingsAndLeave,
            "cancel-settings-leave": closeSettingsLeaveDialog,
            "reset-seat-locks": resetSeatLocks,
            "reset-state": resetState
        };

        if (actions[action]) actions[action]();
    }

    function createDefaultState() {
        const base = {
            version: 9,
            students: [...DEFAULT_STUDENTS],
            seats: {
                assignments: normalizeSeatAssignments(DEFAULT_STUDENTS, DEFAULT_STUDENTS),
                locked: [],
                rowMode: "swapHalves",
                columnDirection: "right",
                includeSpecialAuto: false
            },
            cleaning: {
                excluded: [...DEFAULT_EXCLUDED],
                classroomCounts: Object.fromEntries(CLASSROOM_ROLES.map(role => [role.id, role.defaultCount])),
                studioRoles: Object.fromEntries(STUDIO_ROLES.map(role => [
                    role.id,
                    { count: role.defaultCount, days: [...role.defaultDays] }
                ])),
                schedule: []
            },
            picker: {
                count: 1,
                rounds: 1,
                repeatMode: "taskUnique"
            }
        };

        base.cleaning.schedule = buildGeneratedCleaning(base);
        return base;
    }

    async function loadState() {
        const serviceState = await loadStateFromService();
        if (serviceState) return serviceState;

        const saved = localStorage.getItem(STORAGE_KEY);
        if (saved) {
            try {
                return JSON.parse(saved);
            } catch (error) {
                console.warn("v9 data parse failed", error);
            }
        }

        return migrateOldState();
    }

    async function loadStateFromService() {
        try {
            const response = await fetch("/api/state", { cache: "no-store" });
            serviceConnected = true;
            const data = await response.json();
            backupPath = data.backupPath || null;
            if (data.ok && data.state) {
                return data.state;
            }
            if (data.error) {
                showToast(`${data.error}，已尝试使用浏览器本地缓存`);
            }
        } catch (error) {
            serviceConnected = false;
            backupPath = null;
        }
        return null;
    }

    function migrateOldState() {
        const migrated = createDefaultState();
        const oldSeats = readJson(OLD_SEAT_KEY);
        const oldCleaning = readJson(OLD_CLEANING_KEY);

        if (Array.isArray(oldSeats)) {
            migrated.seats.assignments = normalizeSeatAssignments(oldSeats, migrated.students);
        }

        if (Array.isArray(oldCleaning)) {
            migrated.cleaning.schedule = migrateOldCleaning(oldCleaning, migrated);
        }

        return migrated;
    }

    function migrateOldCleaning(oldCleaning, source) {
        const schedule = createEmptyCleaningSchedule();

        DAYS.forEach((_, dayIndex) => {
            const oldDay = Array.isArray(oldCleaning[dayIndex]) ? oldCleaning[dayIndex] : [];
            schedule[dayIndex].classroom.board = cleanNameList(oldDay[0], source.students);
            schedule[dayIndex].classroom.sweep = cleanNameList(oldDay[1], source.students);
            schedule[dayIndex].classroom.mop = cleanNameList(oldDay[2], source.students);
            schedule[dayIndex].classroom.trash = cleanNameList(oldDay[3], source.students);
            schedule[dayIndex].studio.studioSweep = cleanNameList(oldDay[4], source.students);
            schedule[dayIndex].studio.studioMop = cleanNameList(oldDay[5], source.students);
            schedule[dayIndex].studio.studioTrash = cleanNameList(oldDay[6], source.students);
            schedule[dayIndex].leader = firstClassroomName(schedule[dayIndex]) || "";
        });

        return schedule;
    }

    function readJson(key) {
        const raw = localStorage.getItem(key);
        if (!raw) return null;
        try {
            return JSON.parse(raw);
        } catch (error) {
            console.warn(`Failed to parse ${key}`, error);
            return null;
        }
    }

    function normalizeState() {
        const defaults = createDefaultState();

        state.version = 9;
        state.students = sanitizeNameList(Array.isArray(state.students) ? state.students : defaults.students);
        if (!state.students.length) state.students = [...DEFAULT_STUDENTS];

        state.seats = state.seats || {};
        state.seats.assignments = normalizeSeatAssignments(state.seats.assignments || defaults.seats.assignments, state.students);
        state.seats.locked = uniqueNumbers(state.seats.locked).filter(index => index >= 0 && index < SEAT_COUNT);
        state.seats.rowMode = validRowMode(state.seats.rowMode);
        state.seats.columnDirection = validColumnDirection(state.seats.columnDirection);
        state.seats.includeSpecialAuto = Boolean(state.seats.includeSpecialAuto);

        state.cleaning = state.cleaning || {};
        state.cleaning.excluded = sanitizeNameList(state.cleaning.excluded || defaults.cleaning.excluded);
        state.cleaning.classroomCounts = normalizeClassroomCounts(state.cleaning.classroomCounts);
        state.cleaning.studioRoles = normalizeStudioRoles(state.cleaning.studioRoles);
        state.cleaning.schedule = Array.isArray(state.cleaning.schedule) && state.cleaning.schedule.length
            ? normalizeCleaningSchedule(state.cleaning.schedule, state)
            : buildGeneratedCleaning(state);

        state.picker = state.picker || {};
        state.picker.count = clampNumber(state.picker.count, 1, Math.max(1, state.students.length), 1);
        state.picker.rounds = clampNumber(state.picker.rounds, 1, 20, 1);
        state.picker.repeatMode = validPickerMode(state.picker.repeatMode);
    }

    function saveState(options = {}) {
        localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
        if (options.remote === false) return;
        queueRemoteSave();
    }

    function queueRemoteSave() {
        clearTimeout(saveTimer);
        setSyncStatus("saving", "保存中");
        saveTimer = setTimeout(saveStateToService, 240);
    }

    async function saveStateToService() {
        if (!serviceConnected) {
            setSyncStatus("offline", "本地缓存");
            return;
        }

        try {
            const response = await fetch("/api/state", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ state })
            });
            const data = await response.json();
            backupPath = data.backupPath || backupPath;
            updateBackupPathText();
            if (response.ok && data.ok) {
                setSyncStatus("saved", "已保存");
                return;
            }
            setSyncStatus(backupPath ? "error" : "unbound", backupPath ? "同步失败" : "未绑定");
        } catch (error) {
            serviceConnected = false;
            setSyncStatus("offline", "本地缓存");
        }
    }

    function renderAll() {
        renderSeats();
        renderCleaning();
        renderPickerControls();
        renderSettings();
        renderStats();
    }

    function switchPanel(panelName) {
        const currentPanel = $(".panel.active")?.dataset.panel;
        settingsDirty = hasSettingsChanges();
        if (currentPanel === "settings" && panelName !== "settings" && settingsDirty) {
            pendingPanelTarget = panelName;
            openSettingsLeaveDialog();
            return;
        }

        if (panelName === "settings") {
            enterSettingsPanel();
        }

        forceSwitchPanel(panelName);
    }

    function forceSwitchPanel(panelName) {
        $$(".panel").forEach(panel => panel.classList.toggle("active", panel.dataset.panel === panelName));
        $$(".nav-item").forEach(button => button.classList.toggle("active", button.dataset.panelTarget === panelName));
    }

    function renderStats() {
        const assignedCount = state.seats.assignments.filter(Boolean).length;
        const lockedCount = state.seats.locked.length;
        $("#seatStats").textContent = `${assignedCount}个座位已安排，${lockedCount}个锁定`;
        $("#seatSettingsSummary").textContent = `${ROW_MODE_LABELS[state.seats.rowMode]}，列${COLUMN_DIRECTION_LABELS[state.seats.columnDirection]}，特殊座位${state.seats.includeSpecialAuto ? "参与" : "不参与"}自动操作`;
        $("#cleaningStats").textContent = `免值日 ${state.cleaning.excluded.length} 人，抽选规则：${PICKER_MODE_LABELS[state.picker.repeatMode]}`;
    }

    function renderSeats() {
        const container = $("#seatMap");
        container.innerHTML = "";

        const podiumRow = document.createElement("div");
        podiumRow.className = "podium-area";

        const leftGroup = document.createElement("div");
        leftGroup.className = "special-seat-group";
        leftGroup.append(createSeatCard(0, "讲台左1"), createSeatCard(1, "讲台左2"));

        const podium = document.createElement("div");
        podium.className = "podium";
        podium.textContent = "讲 台";

        const rightGroup = document.createElement("div");
        rightGroup.className = "special-seat-group";
        rightGroup.append(createSeatCard(2, "讲台右1"));

        podiumRow.append(leftGroup, podium, rightGroup);

        const grid = document.createElement("div");
        grid.className = "main-grid";
        MAIN_SEATS.forEach(index => grid.appendChild(createSeatCard(index, `${index - 2}号`)));

        container.append(podiumRow, grid);
    }

    function createSeatCard(index, label) {
        const name = state.seats.assignments[index] || "空座";
        const locked = isSeatLocked(index);
        const card = document.createElement("article");
        card.className = `seat-card${locked ? " locked" : ""}`;
        card.dataset.seatIndex = String(index);
        card.draggable = !locked;
        card.innerHTML = `
            <button class="seat-lock" type="button" data-action="toggle-seat-lock" data-seat-index="${index}" title="${locked ? "解除锁定" : "锁定座位"}">${locked ? "固定" : "锁"}</button>
            <div class="seat-label">${escapeHtml(label)}</div>
            <div class="seat-name" title="${escapeHtml(name)}">${escapeHtml(name)}</div>
        `;
        return card;
    }

    function toggleSeatLock(index) {
        if (!Number.isInteger(index) || index < 0 || index >= SEAT_COUNT) return;
        const locked = new Set(state.seats.locked);
        if (locked.has(index)) locked.delete(index);
        else locked.add(index);
        state.seats.locked = Array.from(locked).sort((a, b) => a - b);
        saveState();
        renderSeats();
        renderStats();
    }

    function isSeatLocked(index) {
        return state.seats.locked.includes(index);
    }

    function moveSeat(fromIndex, toIndex) {
        if (fromIndex === toIndex) return;
        if (isSeatLocked(fromIndex) || isSeatLocked(toIndex)) {
            showToast("锁定座位不能拖入或拖出");
            return;
        }

        [state.seats.assignments[fromIndex], state.seats.assignments[toIndex]] = [
            state.seats.assignments[toIndex],
            state.seats.assignments[fromIndex]
        ];
        saveState();
        renderSeats();
    }

    function randomizeSeats() {
        shuffleSeatGroup(MAIN_SEATS);
        if (state.seats.includeSpecialAuto) shuffleSeatGroup(SPECIAL_SEATS);
        saveState();
        renderSeats();
        showToast("座位已随机调整，锁定座位保持不变");
    }

    function shuffleSeatGroup(indices) {
        const available = indices.filter(index => !isSeatLocked(index));
        const names = shuffle(available.map(index => state.seats.assignments[index]));
        available.forEach((index, position) => {
            state.seats.assignments[index] = names[position];
        });
    }

    function rotateSeats() {
        const next = [...state.seats.assignments];
        applySeatMapping(MAIN_SEATS, getMainSeatDestination, next);

        if (state.seats.includeSpecialAuto) {
            applySeatMapping(SPECIAL_SEATS, getSpecialSeatDestination, next);
        }

        state.seats.assignments = next;
        saveState();
        renderSeats();
        showToast("座位已按当前模式轮换");
    }

    function applySeatMapping(indices, getDestination, nextAssignments) {
        const locked = new Set(state.seats.locked);
        const activeCount = indices.filter(index => !locked.has(index)).length;
        if (activeCount <= 1) return;

        indices.forEach(source => {
            if (locked.has(source)) return;
            let destination = getDestination(source);
            let guard = 0;
            while (locked.has(destination) && guard < indices.length) {
                destination = getDestination(destination);
                guard += 1;
            }
            if (!locked.has(destination)) {
                nextAssignments[destination] = state.seats.assignments[source];
            }
        });
    }

    function getSpecialSeatDestination(index) {
        const current = SPECIAL_SEATS.indexOf(index);
        return SPECIAL_SEATS[(current + 1) % SPECIAL_SEATS.length];
    }

    function getMainSeatDestination(index) {
        const offset = index - 3;
        const row = Math.floor(offset / 6);
        const column = offset % 6;
        const nextColumn = state.seats.columnDirection === "left" ? (column + 5) % 6 : (column + 1) % 6;
        const nextRow = state.seats.rowMode === "fullCycle"
            ? (row === 0 ? 5 : row - 1)
            : (row < 3 ? row + 3 : row - 3);
        return 3 + nextRow * 6 + nextColumn;
    }

    function renderCleaning() {
        const board = $("#cleaningBoard");
        board.innerHTML = "";

        DAYS.forEach((day, dayIndex) => {
            const dayCard = document.createElement("section");
            dayCard.className = "day-card";

            const head = document.createElement("div");
            head.className = "day-head";
            head.innerHTML = `
                <strong>${day}</strong>
                <span class="leader-chip">${escapeHtml(getDayLeaderLabel(dayIndex))}</span>
            `;

            dayCard.appendChild(head);
            dayCard.appendChild(createBlockTitle("教室6S"));
            CLASSROOM_ROLES.forEach(role => dayCard.appendChild(createCleaningLane(dayIndex, "classroom", role)));
            dayCard.appendChild(createBlockTitle("画室卫生"));
            STUDIO_ROLES.forEach(role => dayCard.appendChild(createCleaningLane(dayIndex, "studio", role)));
            board.appendChild(dayCard);
        });
    }

    function createBlockTitle(text) {
        const title = document.createElement("div");
        title.className = "block-title";
        title.textContent = text;
        return title;
    }

    function createCleaningLane(dayIndex, section, role) {
        const disabled = section === "studio" && !isStudioRoleEnabled(role.id, dayIndex);
        const names = getCleaningList(dayIndex, section, role.id);
        const targetCount = section === "classroom" ? getClassroomRoleCount(role.id) : ensureStudioRole(role.id).count;
        const lane = document.createElement("div");
        lane.className = `clean-lane${disabled ? " disabled" : ""}`;
        lane.dataset.section = section;
        lane.dataset.dayIndex = String(dayIndex);
        lane.dataset.roleId = role.id;

        const head = document.createElement("div");
        head.className = "lane-head";
        head.innerHTML = `
            <span>${escapeHtml(role.label)}</span>
            <span class="lane-count">${disabled ? "未启用" : `${names.length}/${targetCount}`}</span>
        `;
        lane.appendChild(head);

        const list = document.createElement("div");
        list.className = "tag-list";

        if (disabled) {
            const empty = document.createElement("div");
            empty.className = "empty-lane";
            empty.textContent = "当日不启用";
            list.appendChild(empty);
        } else if (!names.length) {
            const empty = document.createElement("div");
            empty.className = "empty-lane";
            empty.textContent = "拖入姓名";
            list.appendChild(empty);
        } else {
            names.forEach((name, personIndex) => {
                list.appendChild(createCleaningTag(dayIndex, section, role.id, name, personIndex));
            });
        }

        lane.appendChild(list);
        return lane;
    }

    function createCleaningTag(dayIndex, section, roleId, name, personIndex) {
        const tag = document.createElement("span");
        tag.className = "clean-tag";
        tag.draggable = true;
        tag.dataset.dayIndex = String(dayIndex);
        tag.dataset.section = section;
        tag.dataset.roleId = roleId;
        tag.dataset.personIndex = String(personIndex);
        tag.dataset.name = name;

        const nameEl = document.createElement("span");
        nameEl.className = "tag-name";
        nameEl.textContent = name;
        tag.appendChild(nameEl);

        if (section === "classroom") {
            const isLeader = state.cleaning.schedule[dayIndex].leader === name;
            const button = document.createElement("button");
            button.className = `mini-tag-btn${isLeader ? " is-leader" : ""}`;
            button.type = "button";
            button.dataset.action = "set-cleaning-leader";
            button.dataset.dayIndex = String(dayIndex);
            button.dataset.name = name;
            button.textContent = isLeader ? "组长" : "组员";
            tag.appendChild(button);
        }

        return tag;
    }

    function getDayLeaderLabel(dayIndex) {
        const leader = state.cleaning.schedule[dayIndex]?.leader;
        return leader ? `组长 ${leader}` : "未指定组长";
    }

    function generateCleaningSchedule(showMessage) {
        if (settingsDirty && !saveSettingsFromDraft({ silent: true })) return;
        state.cleaning.schedule = buildGeneratedCleaning(state);
        saveState();
        renderCleaning();
        renderStats();
        if (showMessage) showToast("清洁表已按当前设置重新生成");
    }

    function buildGeneratedCleaning(source) {
        const schedule = createEmptyCleaningSchedule();
        const pool = shuffle(source.students.filter(name => !source.cleaning.excluded.includes(name)));
        let pointer = 0;

        DAYS.forEach((_, dayIndex) => {
            const assignedToday = new Set();

            CLASSROOM_ROLES.forEach(role => {
                schedule[dayIndex].classroom[role.id] = takeFromPool(pool, getClassroomRoleCountFromSource(source, role.id), assignedToday, () => pointer++);
            });

            STUDIO_ROLES.forEach(role => {
                const config = getStudioRoleConfigFromSource(source, role.id);
                schedule[dayIndex].studio[role.id] = config.days.includes(dayIndex)
                    ? takeFromPool(pool, config.count, assignedToday, () => pointer++)
                    : [];
            });

            schedule[dayIndex].leader = firstClassroomName(schedule[dayIndex]) || "";
        });

        return schedule;
    }

    function takeFromPool(pool, count, assignedToday, nextPointer) {
        if (!pool.length || count <= 0) return [];
        const result = [];
        let safety = 0;

        while (result.length < count && safety < pool.length * 4) {
            const index = nextPointer() % pool.length;
            const name = pool[index];
            if (!assignedToday.has(name) || assignedToday.size >= pool.length) {
                result.push(name);
                assignedToday.add(name);
            }
            safety += 1;
        }

        return result;
    }

    function rotateCleaningWeek() {
        state.cleaning.schedule.push(state.cleaning.schedule.shift());
        saveState();
        renderCleaning();
        showToast("清洁表已顺延一周");
    }

    function setCleaningLeader(dayIndex, name) {
        if (!state.cleaning.schedule[dayIndex]) return;
        if (!isInClassroomDay(dayIndex, name)) {
            showToast("小组长必须在当日教室6S小组内");
            return;
        }
        state.cleaning.schedule[dayIndex].leader = name;
        saveState();
        renderCleaning();
    }

    function moveCleaningName(source, destination) {
        if (source.section === destination.section && source.dayIndex === destination.dayIndex && source.roleId === destination.roleId) return;

        const sourceList = getCleaningList(source.dayIndex, source.section, source.roleId);
        let removeIndex = source.personIndex;
        if (sourceList[removeIndex] !== source.name) removeIndex = sourceList.indexOf(source.name);
        if (removeIndex < 0) return;

        sourceList.splice(removeIndex, 1);
        getCleaningList(destination.dayIndex, destination.section, destination.roleId).push(source.name);

        const sourceDay = state.cleaning.schedule[source.dayIndex];
        if (source.section === "classroom" && sourceDay.leader === source.name && !isInClassroomDay(source.dayIndex, source.name)) {
            sourceDay.leader = firstClassroomName(sourceDay) || "";
        }

        const targetDay = state.cleaning.schedule[destination.dayIndex];
        if (destination.section === "classroom" && !targetDay.leader) {
            targetDay.leader = source.name;
        }

        saveState();
        renderCleaning();
    }

    function runPicker() {
        state.picker.count = clampNumber($("#pickerCount").value, 1, Math.max(1, state.students.length), 1);
        state.picker.rounds = clampNumber($("#pickerRounds").value, 1, 20, 1);
        state.picker.repeatMode = validPickerMode($("#pickerRepeatMode").value);
        saveState();
        renderPickerControls();

        const results = buildPickerResults();
        if (!results) return;
        renderPickerResults(results);
    }

    function buildPickerResults() {
        const { count, rounds, repeatMode } = state.picker;
        const students = [...state.students];
        if (!students.length) {
            showToast("学生名单为空，无法抽选");
            return null;
        }

        if ((repeatMode === "taskUnique" && count * rounds > students.length) || (repeatMode === "roundUnique" && count > students.length)) {
            showToast("当前重复规则下人数不足，请减少数量或轮数");
            return null;
        }

        const results = [];
        let taskPool = shuffle(students);

        for (let round = 0; round < rounds; round += 1) {
            let names;
            if (repeatMode === "taskUnique") {
                names = taskPool.splice(0, count);
            } else if (repeatMode === "roundUnique") {
                names = shuffle(students).slice(0, count);
            } else {
                names = Array.from({ length: count }, () => students[Math.floor(Math.random() * students.length)]);
            }
            results.push(names);
        }

        return results;
    }

    function renderPickerControls() {
        const max = Math.max(1, state.students.length);
        [["pickerCount", state.picker.count]].forEach(([id, value]) => {
            const input = $(`#${id}`);
            if (input) {
                input.max = String(max);
                input.value = String(value);
            }
        });

        [["pickerRounds", state.picker.rounds]].forEach(([id, value]) => {
            const input = $(`#${id}`);
            if (input) input.value = String(value);
        });

        [["pickerRepeatMode", state.picker.repeatMode]].forEach(([id, value]) => {
            const select = $(`#${id}`);
            if (select) select.value = value;
        });

        if (!settingsDirty) renderSettings();
    }

    function renderPickerResults(results) {
        const container = $("#pickerResults");
        container.innerHTML = "";

        results.forEach((names, index) => {
            const round = document.createElement("section");
            round.className = "result-round";
            round.style.animationDelay = `${index * 45}ms`;
            round.innerHTML = `<h3>第 ${index + 1} 轮</h3>`;

            const list = document.createElement("div");
            list.className = "result-names";
            names.forEach(name => {
                const item = document.createElement("span");
                item.className = "result-name";
                item.textContent = name;
                list.appendChild(item);
            });

            round.appendChild(list);
            container.appendChild(round);
        });
    }

    function clearPickerResults() {
        $("#pickerResults").innerHTML = `<div class="empty-state">设置数量和轮数后开始抽选。</div>`;
    }

    function renderSettings() {
        const source = settingsDraft || createSettingsDraft();
        const studentsTextArea = $("#studentsTextArea");
        const excludedTextArea = $("#excludedTextArea");

        if (document.activeElement !== studentsTextArea) studentsTextArea.value = source.students.join("\n");
        if (document.activeElement !== excludedTextArea) excludedTextArea.value = source.cleaning.excluded.join("\n");

        $("#rowModeSelect").value = source.seats.rowMode;
        $("#columnDirectionSelect").value = source.seats.columnDirection;
        $("#includeSpecialAuto").checked = source.seats.includeSpecialAuto;
        $("#pickerCountSetting").value = source.picker.count;
        $("#pickerRoundsSetting").value = source.picker.rounds;
        $("#pickerRepeatSetting").value = source.picker.repeatMode;
        renderRoleSettings(source);
        updateBackupPathText();
    }

    function renderRoleSettings(source = settingsDraft || createSettingsDraft()) {
        const classroomHost = $("#classroomRoleSettings");
        const studioHost = $("#studioRoleSettings");
        classroomHost.innerHTML = "<h4>教室6S岗位人数</h4>";
        studioHost.innerHTML = "<h4>画室岗位设置</h4>";

        CLASSROOM_ROLES.forEach(role => {
            const row = document.createElement("div");
            row.className = "role-setting-row";
            row.innerHTML = `
                <span>${escapeHtml(role.label)}</span>
                <input type="number" min="0" max="8" value="${getClassroomRoleCountFromDraft(source, role.id)}" data-classroom-count="${role.id}" aria-label="${escapeHtml(role.label)}人数">
            `;
            classroomHost.appendChild(row);
        });

        STUDIO_ROLES.forEach(role => {
            const config = getStudioRoleConfigFromDraft(source, role.id);
            const row = document.createElement("div");
            row.className = "role-setting-row";
            row.innerHTML = `
                <span>${escapeHtml(role.label)}</span>
                <input type="number" min="0" max="8" value="${config.count}" data-studio-count="${role.id}" aria-label="${escapeHtml(role.label)}人数">
            `;

            const dayChecks = document.createElement("div");
            dayChecks.className = "day-checks";
            DAYS.forEach((day, dayIndex) => {
                const label = document.createElement("label");
                label.innerHTML = `
                    <input type="checkbox" ${config.days.includes(dayIndex) ? "checked" : ""} data-studio-day="${role.id}:${dayIndex}">
                    ${day}
                `;
                dayChecks.appendChild(label);
            });
            row.appendChild(dayChecks);
            studioHost.appendChild(row);
        });
    }

    function enterSettingsPanel() {
        if (!settingsDraft || !settingsDirty) {
            settingsDraft = createSettingsDraft();
        }
        renderSettings();
        if (settingsDirty) setSyncStatus("dirty", "设置未保存");
    }

    function createSettingsDraft() {
        return {
            students: [...state.students],
            seats: {
                rowMode: state.seats.rowMode,
                columnDirection: state.seats.columnDirection,
                includeSpecialAuto: state.seats.includeSpecialAuto
            },
            cleaning: {
                excluded: [...state.cleaning.excluded],
                classroomCounts: deepClone(state.cleaning.classroomCounts),
                studioRoles: deepClone(state.cleaning.studioRoles)
            },
            picker: deepClone(state.picker)
        };
    }

    function hasSettingsChanges() {
        if (!settingsDraft) return false;
        return JSON.stringify(normalizeSettingsSnapshot(settingsDraft)) !== JSON.stringify(normalizeSettingsSnapshot(createSettingsDraft()));
    }

    function normalizeSettingsSnapshot(draft) {
        const students = sanitizeNameList(draft.students || []);
        const fallbackStudentCount = Math.max(1, students.length || state.students.length || DEFAULT_STUDENTS.length);

        return {
            students,
            seats: {
                rowMode: validRowMode(draft.seats?.rowMode),
                columnDirection: validColumnDirection(draft.seats?.columnDirection),
                includeSpecialAuto: Boolean(draft.seats?.includeSpecialAuto)
            },
            cleaning: {
                excluded: sanitizeNameList(draft.cleaning?.excluded || []),
                classroomCounts: normalizeClassroomCounts(draft.cleaning?.classroomCounts || {}),
                studioRoles: normalizeStudioRoles(draft.cleaning?.studioRoles || {})
            },
            picker: {
                count: clampNumber(draft.picker?.count, 1, fallbackStudentCount, 1),
                rounds: clampNumber(draft.picker?.rounds, 1, 20, 1),
                repeatMode: validPickerMode(draft.picker?.repeatMode)
            }
        };
    }

    function isSettingsField(target) {
        if (!target.closest("#settingsPanel")) return false;
        return Boolean(
            target.matches("textarea, select, input") &&
            (
                target.id === "studentsTextArea" ||
                target.id === "excludedTextArea" ||
                target.id === "rowModeSelect" ||
                target.id === "columnDirectionSelect" ||
                target.id === "includeSpecialAuto" ||
                target.id === "pickerCountSetting" ||
                target.id === "pickerRoundsSetting" ||
                target.id === "pickerRepeatSetting" ||
                target.dataset.classroomCount ||
                target.dataset.studioCount ||
                target.dataset.studioDay
            )
        );
    }

    function updateSettingsDraftFromTarget(target) {
        if (!settingsDraft) settingsDraft = createSettingsDraft();

        if (target.id === "studentsTextArea") {
            settingsDraft.students = sanitizeNameList(target.value.split(/\r?\n/));
        } else if (target.id === "excludedTextArea") {
            settingsDraft.cleaning.excluded = sanitizeNameList(target.value.split(/\r?\n|、|,|，/));
        } else if (target.id === "rowModeSelect") {
            settingsDraft.seats.rowMode = validRowMode(target.value);
        } else if (target.id === "columnDirectionSelect") {
            settingsDraft.seats.columnDirection = validColumnDirection(target.value);
        } else if (target.id === "includeSpecialAuto") {
            settingsDraft.seats.includeSpecialAuto = target.checked;
        } else if (target.id === "pickerCountSetting") {
            settingsDraft.picker.count = clampNumber(target.value, 1, Math.max(1, settingsDraft.students.length || state.students.length), 1);
        } else if (target.id === "pickerRoundsSetting") {
            settingsDraft.picker.rounds = clampNumber(target.value, 1, 20, 1);
        } else if (target.id === "pickerRepeatSetting") {
            settingsDraft.picker.repeatMode = validPickerMode(target.value);
        } else if (target.dataset.classroomCount) {
            const roleId = target.dataset.classroomCount;
            settingsDraft.cleaning.classroomCounts[roleId] = clampNumber(target.value, 0, 8, getClassroomRole(roleId).defaultCount);
        } else if (target.dataset.studioCount) {
            const roleId = target.dataset.studioCount;
            settingsDraft.cleaning.studioRoles[roleId] = getStudioRoleConfigFromDraft(settingsDraft, roleId);
            settingsDraft.cleaning.studioRoles[roleId].count = clampNumber(target.value, 0, 8, getStudioRole(roleId).defaultCount);
        } else if (target.dataset.studioDay) {
            const [roleId, rawDay] = target.dataset.studioDay.split(":");
            const dayIndex = Number(rawDay);
            const config = getStudioRoleConfigFromDraft(settingsDraft, roleId);
            const days = new Set(config.days);
            if (target.checked) days.add(dayIndex);
            else days.delete(dayIndex);
            settingsDraft.cleaning.studioRoles[roleId] = {
                ...config,
                days: Array.from(days).sort((a, b) => a - b)
            };
        }

        settingsDirty = hasSettingsChanges();
        updateSyncAfterLoad();
    }

    function saveSettingsFromDraft(options = {}) {
        if (!settingsDraft) settingsDraft = createSettingsDraft();
        const names = sanitizeNameList(settingsDraft.students);
        if (!names.length) {
            showToast("学生名单至少需要一名学生");
            return false;
        }

        state.students = names;
        state.seats.rowMode = validRowMode(settingsDraft.seats.rowMode);
        state.seats.columnDirection = validColumnDirection(settingsDraft.seats.columnDirection);
        state.seats.includeSpecialAuto = Boolean(settingsDraft.seats.includeSpecialAuto);
        state.cleaning.excluded = sanitizeNameList(settingsDraft.cleaning.excluded);
        state.cleaning.classroomCounts = normalizeClassroomCounts(settingsDraft.cleaning.classroomCounts);
        state.cleaning.studioRoles = normalizeStudioRoles(settingsDraft.cleaning.studioRoles);
        state.picker.count = clampNumber(settingsDraft.picker.count, 1, Math.max(1, names.length), 1);
        state.picker.rounds = clampNumber(settingsDraft.picker.rounds, 1, 20, 1);
        state.picker.repeatMode = validPickerMode(settingsDraft.picker.repeatMode);

        reconcileSeats();
        state.cleaning.schedule = normalizeCleaningSchedule(state.cleaning.schedule, state);
        settingsDraft = createSettingsDraft();
        settingsDirty = false;
        saveState();
        renderAll();
        if (!options.silent) showToast("设置已保存");
        return true;
    }

    function restoreDefaultStudents() {
        if (!settingsDraft) settingsDraft = createSettingsDraft();
        settingsDraft.students = [...DEFAULT_STUDENTS];
        settingsDirty = true;
        renderSettings();
        setSyncStatus("dirty", "设置未保存");
        showToast("默认名单已放入设置草稿，保存后生效");
    }

    function saveCleaningSettings(showMessage = true) {
        const saved = saveSettingsFromDraft({ silent: true });
        if (saved && showMessage) showToast("清洁设置已保存");
        return saved;
    }

    function discardSettingsDraft() {
        settingsDraft = createSettingsDraft();
        settingsDirty = false;
        renderSettings();
        updateSyncAfterLoad();
        showToast("已放弃设置更改");
    }

    function openSettingsLeaveDialog() {
        $("#settingsLeaveDialog").hidden = false;
    }

    function closeSettingsLeaveDialog() {
        pendingPanelTarget = null;
        $("#settingsLeaveDialog").hidden = true;
    }

    function saveSettingsAndLeave() {
        if (!saveSettingsFromDraft()) return;
        $("#settingsLeaveDialog").hidden = true;
        const target = pendingPanelTarget;
        pendingPanelTarget = null;
        if (target) forceSwitchPanel(target);
    }

    function discardSettingsAndLeave() {
        settingsDraft = createSettingsDraft();
        settingsDirty = false;
        $("#settingsLeaveDialog").hidden = true;
        updateSyncAfterLoad();
        const target = pendingPanelTarget;
        pendingPanelTarget = null;
        if (target) forceSwitchPanel(target);
    }

    function resetSeatLocks() {
        state.seats.locked = [];
        saveState();
        renderSeats();
        renderStats();
        showToast("全部座位锁定已解除");
    }

    function resetState() {
        if (!confirm("确定重置 v9 系统数据？旧版 v8 数据不会被删除。")) return;
        state = createDefaultState();
        settingsDraft = createSettingsDraft();
        settingsDirty = false;
        saveState();
        renderAll();
        clearPickerResults();
        showToast("系统数据已重置");
    }

    function exportData() {
        const blob = new Blob([JSON.stringify(state, null, 2)], { type: "application/json" });
        const url = URL.createObjectURL(blob);
        const link = document.createElement("a");
        link.href = url;
        link.download = "24美术2班常规管理系统备份.json";
        document.body.appendChild(link);
        link.click();
        link.remove();
        URL.revokeObjectURL(url);
    }

    function importData(event) {
        const file = event.target.files[0];
        if (!file) return;

        const reader = new FileReader();
        reader.onload = () => {
            try {
                const data = JSON.parse(reader.result);
                if (data.version === 9 || data.students || data.seats?.assignments) {
                    state = data;
                } else {
                    state = createDefaultState();
                    if (Array.isArray(data.seats)) state.seats.assignments = normalizeSeatAssignments(data.seats, state.students);
                    if (Array.isArray(data.cleaning)) state.cleaning.schedule = migrateOldCleaning(data.cleaning, state);
                }
                normalizeState();
                saveState();
                renderAll();
                clearPickerResults();
                showToast("数据已恢复");
            } catch (error) {
                console.error(error);
                showToast("备份文件无效");
            } finally {
                event.target.value = "";
            }
        };
        reader.readAsText(file);
    }

    async function selectBackupFile() {
        setSyncStatus("saving", "选择文件");
        try {
            const response = await fetch("/api/backup/select", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ state })
            });
            serviceConnected = true;
            const data = await response.json();
            if (!data.ok) {
                updateSyncAfterLoad();
                if (!data.cancelled) showToast(data.error || "选择保存文件失败");
                return;
            }
            backupPath = data.backupPath || null;
            updateBackupPathText();
            saveState();
            showToast("自动保存文件已绑定");
        } catch (error) {
            serviceConnected = false;
            setSyncStatus("offline", "本地缓存");
            showToast("本地服务未连接，无法选择保存文件");
        }
    }

    async function refreshBackupStatus() {
        try {
            const response = await fetch("/api/backup/status", { cache: "no-store" });
            serviceConnected = true;
            const data = await response.json();
            backupPath = data.backupPath || null;
            updateBackupPathText();
            setSyncStatus(backupPath ? "saved" : "unbound", backupPath ? "已保存" : "未绑定");
        } catch (error) {
            serviceConnected = false;
            backupPath = null;
            updateBackupPathText();
            setSyncStatus("offline", "本地缓存");
        }
    }

    function updateBackupPathText() {
        const target = $("#backupPathStatus");
        if (!target) return;
        target.textContent = backupPath || "未绑定";
        target.title = backupPath || "";
    }

    function updateSyncAfterLoad() {
        settingsDirty = hasSettingsChanges();
        if (settingsDirty) {
            setSyncStatus("dirty", "设置未保存");
            return;
        }
        if (!serviceConnected) {
            setSyncStatus("offline", "本地缓存");
            return;
        }
        setSyncStatus(backupPath ? "saved" : "unbound", backupPath ? "已保存" : "未绑定");
    }

    function setSyncStatus(status, text) {
        const indicator = $("#syncIndicator");
        const label = $("#syncText");
        if (!indicator || !label) return;
        indicator.dataset.status = status;
        label.textContent = text;
    }

    function handleBeforeUnload(event) {
        settingsDirty = hasSettingsChanges();
        if (!settingsDirty) return;
        event.preventDefault();
        event.returnValue = "";
    }

    function setupWelcomeScreen() {
        const screen = $("#welcomeScreen");
        if (!screen) return;

        const lastShown = Number(localStorage.getItem(WELCOME_KEY) || 0);
        const shouldShow = Date.now() - lastShown > WELCOME_INTERVAL;
        if (!shouldShow) {
            screen.classList.add("hidden");
            return;
        }

        localStorage.setItem(WELCOME_KEY, String(Date.now()));
        setTimeout(() => screen.classList.add("leaving"), 2200);
        setTimeout(() => screen.classList.add("hidden"), 2850);
    }

    function exportImage(elementId, filename) {
        const element = $(`#${elementId}`);
        if (!window.html2canvas) {
            showToast("图片导出脚本未加载，请联网后重试");
            return;
        }

        window.html2canvas(element, { scale: 2, backgroundColor: "#ffffff" }).then(canvas => {
            const link = document.createElement("a");
            link.download = filename;
            link.href = canvas.toDataURL("image/png");
            link.click();
        });
    }

    function handleDragStart(event) {
        const seat = event.target.closest(".seat-card");
        if (seat) {
            const index = Number(seat.dataset.seatIndex);
            if (isSeatLocked(index)) {
                event.preventDefault();
                return;
            }
            dragInfo = { type: "seat", index };
            seat.classList.add("dragging");
            event.dataTransfer.effectAllowed = "move";
            return;
        }

        const tag = event.target.closest(".clean-tag");
        if (tag) {
            dragInfo = {
                type: "clean",
                dayIndex: Number(tag.dataset.dayIndex),
                section: tag.dataset.section,
                roleId: tag.dataset.roleId,
                personIndex: Number(tag.dataset.personIndex),
                name: tag.dataset.name
            };
            tag.classList.add("dragging");
            event.dataTransfer.effectAllowed = "move";
        }
    }

    function handleDragEnd() {
        dragInfo = null;
        $$(".dragging").forEach(el => el.classList.remove("dragging"));
        clearDropTargets();
    }

    function handleDragOver(event) {
        if (!dragInfo) return;
        clearDropTargets();

        if (dragInfo.type === "seat") {
            const seat = event.target.closest(".seat-card");
            if (!seat) return;
            const index = Number(seat.dataset.seatIndex);
            if (isSeatLocked(index)) return;
            event.preventDefault();
            seat.classList.add("drop-target");
            return;
        }

        if (dragInfo.type === "clean") {
            const lane = event.target.closest(".clean-lane");
            if (!lane || lane.classList.contains("disabled")) return;
            event.preventDefault();
            lane.classList.add("drop-target");
        }
    }

    function handleDrop(event) {
        if (!dragInfo) return;

        if (dragInfo.type === "seat") {
            const seat = event.target.closest(".seat-card");
            if (!seat) return;
            event.preventDefault();
            moveSeat(dragInfo.index, Number(seat.dataset.seatIndex));
            clearDropTargets();
            return;
        }

        if (dragInfo.type === "clean") {
            const lane = event.target.closest(".clean-lane");
            if (!lane || lane.classList.contains("disabled")) return;
            event.preventDefault();
            moveCleaningName(dragInfo, {
                dayIndex: Number(lane.dataset.dayIndex),
                section: lane.dataset.section,
                roleId: lane.dataset.roleId
            });
            clearDropTargets();
        }
    }

    function clearDropTargets() {
        $$(".drop-target").forEach(el => el.classList.remove("drop-target"));
    }

    function createEmptyCleaningSchedule() {
        return DAYS.map(() => ({
            leader: "",
            classroom: Object.fromEntries(CLASSROOM_ROLES.map(role => [role.id, []])),
            studio: Object.fromEntries(STUDIO_ROLES.map(role => [role.id, []]))
        }));
    }

    function normalizeCleaningSchedule(schedule, source) {
        const normalized = createEmptyCleaningSchedule();

        DAYS.forEach((_, dayIndex) => {
            const day = schedule[dayIndex] || {};
            CLASSROOM_ROLES.forEach(role => {
                normalized[dayIndex].classroom[role.id] = cleanNameList(day.classroom?.[role.id], source.students);
            });
            STUDIO_ROLES.forEach(role => {
                normalized[dayIndex].studio[role.id] = cleanNameList(day.studio?.[role.id], source.students);
            });
            normalized[dayIndex].leader = source.students.includes(day.leader) && isNameInClassroomDay(normalized[dayIndex], day.leader)
                ? day.leader
                : firstClassroomName(normalized[dayIndex]) || "";
        });

        return normalized;
    }

    function normalizeSeatAssignments(assignments, students) {
        const source = Array.isArray(assignments) ? assignments : [];
        const result = Array(SEAT_COUNT).fill("");
        const seen = new Set();
        const validStudents = new Set(students);

        for (let index = 0; index < SEAT_COUNT; index += 1) {
            const name = String(source[index] || "").trim();
            if (name && validStudents.has(name) && !seen.has(name)) {
                result[index] = name;
                seen.add(name);
            }
        }

        students.forEach(name => {
            if (seen.has(name)) return;
            const emptyIndex = result.findIndex(value => !value);
            if (emptyIndex >= 0) {
                result[emptyIndex] = name;
                seen.add(name);
            }
        });

        return result;
    }

    function reconcileSeats() {
        state.seats.assignments = normalizeSeatAssignments(state.seats.assignments, state.students);
        state.seats.locked = state.seats.locked.filter(index => state.seats.assignments[index]);
    }

    function normalizeClassroomCounts(counts = {}) {
        return Object.fromEntries(CLASSROOM_ROLES.map(role => [
            role.id,
            clampNumber(counts[role.id], 0, 8, role.defaultCount)
        ]));
    }

    function normalizeStudioRoles(configs = {}) {
        return Object.fromEntries(STUDIO_ROLES.map(role => {
            const config = configs[role.id] || {};
            const hasExplicitDays = Array.isArray(config.days);
            const days = uniqueNumbers(config.days).filter(day => day >= 0 && day < DAYS.length);
            return [
                role.id,
                {
                    count: clampNumber(config.count, 0, 8, role.defaultCount),
                    days: hasExplicitDays ? days : [...role.defaultDays]
                }
            ];
        }));
    }

    function getCleaningList(dayIndex, section, roleId) {
        return state.cleaning.schedule[dayIndex][section][roleId];
    }

    function getClassroomRole(roleId) {
        return CLASSROOM_ROLES.find(role => role.id === roleId) || CLASSROOM_ROLES[0];
    }

    function getStudioRole(roleId) {
        return STUDIO_ROLES.find(role => role.id === roleId) || STUDIO_ROLES[0];
    }

    function getClassroomRoleCount(roleId) {
        return clampNumber(state.cleaning.classroomCounts[roleId], 0, 8, getClassroomRole(roleId).defaultCount);
    }

    function getClassroomRoleCountFromSource(source, roleId) {
        return clampNumber(source.cleaning.classroomCounts?.[roleId], 0, 8, getClassroomRole(roleId).defaultCount);
    }

    function getClassroomRoleCountFromDraft(source, roleId) {
        return clampNumber(source.cleaning.classroomCounts?.[roleId], 0, 8, getClassroomRole(roleId).defaultCount);
    }

    function ensureStudioRole(roleId) {
        if (!state.cleaning.studioRoles[roleId]) {
            const role = getStudioRole(roleId);
            state.cleaning.studioRoles[roleId] = { count: role.defaultCount, days: [...role.defaultDays] };
        }
        return state.cleaning.studioRoles[roleId];
    }

    function getStudioRoleConfigFromSource(source, roleId) {
        const role = getStudioRole(roleId);
        const config = source.cleaning.studioRoles?.[roleId] || {};
        const rawDays = Array.isArray(config.days) ? config.days : role.defaultDays;
        return {
            count: clampNumber(config.count, 0, 8, role.defaultCount),
            days: uniqueNumbers(rawDays).filter(day => day >= 0 && day < DAYS.length)
        };
    }

    function getStudioRoleConfigFromDraft(source, roleId) {
        const role = getStudioRole(roleId);
        if (!source.cleaning.studioRoles[roleId]) {
            source.cleaning.studioRoles[roleId] = { count: role.defaultCount, days: [...role.defaultDays] };
        }
        const config = source.cleaning.studioRoles[roleId];
        const rawDays = Array.isArray(config.days) ? config.days : role.defaultDays;
        return {
            count: clampNumber(config.count, 0, 8, role.defaultCount),
            days: uniqueNumbers(rawDays).filter(day => day >= 0 && day < DAYS.length)
        };
    }

    function isStudioRoleEnabled(roleId, dayIndex) {
        return ensureStudioRole(roleId).days.includes(dayIndex);
    }

    function firstClassroomName(day) {
        return CLASSROOM_ROLES.flatMap(role => day.classroom[role.id] || []).find(Boolean);
    }

    function isInClassroomDay(dayIndex, name) {
        return isNameInClassroomDay(state.cleaning.schedule[dayIndex], name);
    }

    function isNameInClassroomDay(day, name) {
        return CLASSROOM_ROLES.some(role => (day.classroom[role.id] || []).includes(name));
    }

    function sanitizeNameList(values) {
        const seen = new Set();
        return values
            .map(value => String(value || "").trim())
            .filter(Boolean)
            .filter(name => {
                if (seen.has(name)) return false;
                seen.add(name);
                return true;
            });
    }

    function cleanNameList(values, students) {
        const valid = new Set(students);
        return sanitizeNameList(Array.isArray(values) ? values : []).filter(name => valid.has(name));
    }

    function uniqueNumbers(values) {
        return Array.from(new Set(Array.isArray(values) ? values.map(Number).filter(Number.isFinite) : []));
    }

    function validRowMode(mode) {
        return mode === "fullCycle" ? "fullCycle" : "swapHalves";
    }

    function validColumnDirection(direction) {
        return direction === "left" ? "left" : "right";
    }

    function validPickerMode(mode) {
        return ["taskUnique", "roundUnique", "free"].includes(mode) ? mode : "taskUnique";
    }

    function clampNumber(value, min, max, fallback) {
        const number = Number(value);
        if (!Number.isFinite(number)) return fallback;
        return Math.min(max, Math.max(min, Math.round(number)));
    }

    function shuffle(values) {
        const result = [...values];
        for (let index = result.length - 1; index > 0; index -= 1) {
            const target = Math.floor(Math.random() * (index + 1));
            [result[index], result[target]] = [result[target], result[index]];
        }
        return result;
    }

    function deepClone(value) {
        return JSON.parse(JSON.stringify(value));
    }

    function escapeHtml(value) {
        return String(value)
            .replaceAll("&", "&amp;")
            .replaceAll("<", "&lt;")
            .replaceAll(">", "&gt;")
            .replaceAll('"', "&quot;")
            .replaceAll("'", "&#039;");
    }

    function showToast(message) {
        const toast = $("#toast");
        toast.textContent = message;
        toast.classList.add("show");
        clearTimeout(toastTimer);
        toastTimer = setTimeout(() => toast.classList.remove("show"), 2400);
    }
})();
