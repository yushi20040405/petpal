// ============================================================
// 悬浮宠物挂件 - content.js（Manifest V3 Content Script）
// 内联 SVG + 分层动画 + 环形功能菜单 + 陪伴系统
// 依赖：pets.js、food.js、companion.js（按 manifest 顺序注入）
// 职责：
//   1. 在网页右下角注入可拖动、可收起的悬浮宠物
//   2. 时间问候、主动小动作（随亲密度解锁）、心情、亲密度、玩耍、提醒、生病
//   3. 点击宠物弹出环形功能菜单 + 状态面板（与 newtab 一致，尺寸缩小）
//   4. 缓慢漂浮移动（鼠标靠近时停下）、走到屏幕边缘、全屏隐藏
// ============================================================

'use strict';

(() => {
  const C = window.COMPANION;
  const PREFS = window.PREFS;
  const CHAT = window.CHAT;

  // 防重复注入：扩展重载后，旧脚本可能在页面残留挂件 DOM，先清理再重建
  const staleWidget = document.getElementById('pet-float');
  if (staleWidget) staleWidget.remove();
  const staleFly = document.getElementById('pet-fly-layer');
  if (staleFly) staleFly.remove();

  // 默认设置（UI 字段 + 陪伴状态）
  const DEFAULTS = {
    showFloatingPet: true,
    selectedPets: window.PET_LIST.map((p) => p.id),
    currentPet: null,
    floatPos: null,
    floatCollapsed: false,
    ...C.DEFAULTS,
  };

  // 运行时状态
  let widget = null;
  let els = {};
  let state = {
    petId: null, petStates: {}, fullness: 50, thirst: 50, energy: 80, intimacy: 0, health: 100, mood: 'normal',
    lastFedTime: null, lastInteractTime: null, lastVisitTime: null, lastVisitDay: null,
    companionDays: 1, feedCount: 0, drinkCount: 0, playCount: 0, petCount: 0,
    doNotDisturb: false, unlocked: [], feeding: false,
    proactiveChat: true, chatTriggerDay: null, chatTriggerCount: 0,
    foodPreferences: {}, moodBonus: 0,
  };
  let bubbleTimer = null;
  let bubbleHideTimer = null;
  let drag = null;
  let building = false;
  let panelOpen = false;      // 食物/饮品面板是否展开
  let menuOpen = false;       // 环形菜单 + 状态面板是否展开
  let menuCloseTimer = null;  // 环形菜单淡出后真正隐藏的定时器
  let decayTimer = null;
  let actionTimer = null;
  let chatCheckTimer = null;  // 主动聊天检查定时器
  let boredReminded = false;
  let sickNotified = false;
  // 聊天面板运行时状态
  let chatActive = false;
  let chatNode = null;
  const sessionStart = Date.now();
  let sitReminded = false;
  let cachedRect = null;      // 悬浮挂件缓存的视口矩形（供“鼠标靠近”判定）
  let lastRectAt = 0;

  function save(obj) {
    return chrome.storage.local.set(obj).catch(() => {});
  }

  // 持久化全局陪伴状态 + 当前宠物三态快照
  function persistState() {
    const s = state;
    const petStates = C.stashPetState(state.petStates, state.petId, state);
    state.petStates = petStates;
    return save({
      petStates,
      intimacy: s.intimacy, health: s.health, mood: s.mood,
      lastVisitTime: s.lastVisitTime, lastVisitDay: s.lastVisitDay, companionDays: s.companionDays,
      feedCount: s.feedCount, drinkCount: s.drinkCount, playCount: s.playCount, petCount: s.petCount,
      unlocked: s.unlocked,
      proactiveChat: s.proactiveChat,
      chatTriggerDay: s.chatTriggerDay, chatTriggerCount: s.chatTriggerCount,
      foodPreferences: s.foodPreferences, moodBonus: s.moodBonus,
    });
  }

  function cacheRect() {
    if (widget) cachedRect = widget.getBoundingClientRect();
  }

  /* ---------------- 设置读取 / 宠物选择 ---------------- */
  async function loadSettings() {
    const data = await chrome.storage.local.get(DEFAULTS);
    const known = new Set(window.PET_LIST.map((p) => p.id));
    let selected = Array.isArray(data.selectedPets)
      ? data.selectedPets.filter((id) => known.has(id)) : [];
    if (selected.length === 0) selected = window.PET_LIST.map((p) => p.id);
    const currentPet = known.has(data.currentPet) ? data.currentPet : null;
    const num = (v, d) => (typeof v === 'number' ? C.clamp(v) : d);

    // 旧版扁平三态 → 按宠物存储（只迁移一次）
    const petStates = C.migratePetStates(
      data.petStates && typeof data.petStates === 'object' ? data.petStates : {},
      data
    );

    return {
      ...data,
      selectedPets: selected,
      currentPet,
      petStates,
      intimacy: num(data.intimacy, C.DEFAULTS.intimacy),
      health: num(data.health, C.DEFAULTS.health),
      lastVisitTime: typeof data.lastVisitTime === 'number' ? data.lastVisitTime : null,
      lastVisitDay: typeof data.lastVisitDay === 'string' ? data.lastVisitDay : null,
      companionDays: typeof data.companionDays === 'number' ? Math.max(1, data.companionDays) : 1,
      feedCount: typeof data.feedCount === 'number' ? data.feedCount : 0,
      drinkCount: typeof data.drinkCount === 'number' ? data.drinkCount : 0,
      playCount: typeof data.playCount === 'number' ? data.playCount : 0,
      petCount: typeof data.petCount === 'number' ? data.petCount : 0,
      doNotDisturb: data.doNotDisturb === true,
      unlocked: Array.isArray(data.unlocked) ? data.unlocked : [],
      proactiveChat: data.proactiveChat !== false,
      chatTriggerDay: typeof data.chatTriggerDay === 'string' ? data.chatTriggerDay : null,
      chatTriggerCount: typeof data.chatTriggerCount === 'number' ? data.chatTriggerCount : 0,
      foodPreferences: data.foodPreferences && typeof data.foodPreferences === 'object' ? data.foodPreferences : {},
      moodBonus: typeof data.moodBonus === 'number' ? data.moodBonus : 0,
    };
  }

  function resolvePet(settings) {
    const pool = window.PET_LIST.filter((p) => settings.selectedPets.includes(p.id));
    const use = pool.length ? pool : window.PET_LIST;
    if (settings.currentPet) {
      const found = use.find((p) => p.id === settings.currentPet);
      if (found) return found;
    }
    const chosen = use[Math.floor(Math.random() * use.length)];
    save({ currentPet: chosen.id });
    return chosen;
  }

  async function fetchInlineSvg(src) {
    const res = await fetch(chrome.runtime.getURL(src));
    if (!res.ok) throw new Error('加载失败：' + src);
    const text = await res.text();
    const doc = new DOMParser().parseFromString(text, 'image/svg+xml');
    const svg = doc.querySelector('svg');
    if (!svg) throw new Error('解析失败：' + src);
    svg.removeAttribute('width');
    svg.removeAttribute('height');
    return svg;
  }

  /* ---------------- 主流程：注入悬浮层 ---------------- */
  async function initWidget() {
    if (widget || building) return;
    if (document.getElementById('pet-float')) return;
    building = true;
    try {
      const settings = await loadSettings();
      if (!settings.showFloatingPet) return;

      widget = document.createElement('div');
      widget.id = 'pet-float';
      widget.className = 'pet-float';
      // pet-ui 是环形菜单 + 状态面板的定位容器（供边缘检测整体平移）
      widget.innerHTML = `
        <button type="button" class="pet-float-toggle" title="收起"></button>
        <div class="pet-float-body">
          <div class="pet-bubble" hidden></div>
          <span class="pet-mood"></span>
          <div class="pet-breathe">
            <div class="pet-blink">
              <div class="pet-bounce">
                <div class="pet-svg"></div>
              </div>
            </div>
          </div>
          <div class="pet-fx-layer"></div>
          <div class="pet-ui">
            <div class="status-panel" hidden>
              <div class="stat-row"><span class="stat-key">饱腹</span><div class="stat-bar"><i class="stat-fill stat-fill-food" data-stat="fullness"></i></div><b class="stat-val" data-stat="fullness">50%</b></div>
              <div class="stat-row"><span class="stat-key">口渴</span><div class="stat-bar"><i class="stat-fill stat-fill-drink" data-stat="thirst"></i></div><b class="stat-val" data-stat="thirst">50%</b></div>
              <div class="stat-row"><span class="stat-key">精力</span><div class="stat-bar"><i class="stat-fill stat-fill-energy" data-stat="energy"></i></div><b class="stat-val" data-stat="energy">80%</b></div>
              <div class="stat-row"><span class="stat-key">心情</span><b class="stat-val" data-stat="mood">🙂 普通</b></div>
              <div class="stat-row"><span class="stat-key">亲密度</span><b class="stat-val" data-stat="intimacy">Lv.1 初识</b></div>
              <div class="stat-row"><span class="stat-key">健康</span><b class="stat-val" data-stat="health">健康</b></div>
            </div>
            <div class="ring-menu" hidden></div>
          </div>
          <div class="pet-food-panel" hidden></div>
          <div class="pet-chat-panel" hidden>
            <div class="chat-header">
              <span class="chat-title">聊天</span>
              <button type="button" class="chat-close" title="结束聊天">×</button>
            </div>
            <div class="chat-body"></div>
          </div>
        </div>
      `;
      document.body.appendChild(widget);

      const flyLayer = document.createElement('div');
      flyLayer.id = 'pet-fly-layer';
      document.body.appendChild(flyLayer);

      els.toggle = widget.querySelector('.pet-float-toggle');
      els.body = widget.querySelector('.pet-float-body');
      els.bubble = widget.querySelector('.pet-bubble');
      els.mood = widget.querySelector('.pet-mood');
      els.svg = widget.querySelector('.pet-svg');
      els.fx = widget.querySelector('.pet-fx-layer');
      els.panel = widget.querySelector('.pet-food-panel');
      els.ui = widget.querySelector('.pet-ui');
      els.ring = widget.querySelector('.ring-menu');
      els.status = widget.querySelector('.status-panel');
      els.fly = flyLayer;
      els.chat = widget.querySelector('.pet-chat-panel');
      els.chatBody = widget.querySelector('.pet-chat-panel .chat-body');
      els.chatTitle = widget.querySelector('.pet-chat-panel .chat-title');
      els.chatClose = widget.querySelector('.pet-chat-panel .chat-close');

      // 状态面板里的进度条 / 数值元素，用 data-stat 关联
      els.statFill = {};
      els.statVal = {};
      widget.querySelectorAll('.stat-fill').forEach((el) => { els.statFill[el.dataset.stat] = el; });
      widget.querySelectorAll('.stat-val').forEach((el) => { els.statVal[el.dataset.stat] = el; });

      applyPosition(settings.floatPos);
      if (settings.floatCollapsed) widget.classList.add('collapsed');
      updateToggleIcon();

      // 决定当前宠物，并按宠物加载三态（切换不再重置，每只各自记忆）
      const pet = resolvePet(settings);
      let petStates = settings.petStates;
      const ps = C.loadPetState(petStates, pet.id);
      C.decayAll(ps);
      petStates = C.stashPetState(petStates, pet.id, ps);

      Object.assign(state, {
        petId: pet.id, petStates,
        fullness: ps.fullness, thirst: ps.thirst, energy: ps.energy,
        lastFedTime: ps.lastFedTime, lastInteractTime: ps.lastInteractTime,
        intimacy: settings.intimacy,
        health: settings.health,
        lastVisitTime: settings.lastVisitTime, lastVisitDay: settings.lastVisitDay,
        companionDays: settings.companionDays,
        feedCount: settings.feedCount, drinkCount: settings.drinkCount,
        playCount: settings.playCount, petCount: settings.petCount,
        doNotDisturb: settings.doNotDisturb, unlocked: settings.unlocked,
        proactiveChat: settings.proactiveChat,
        chatTriggerDay: settings.chatTriggerDay,
        chatTriggerCount: settings.chatTriggerCount,
        foodPreferences: settings.foodPreferences,
        moodBonus: settings.moodBonus,
      });

      const visit = C.onVisit(state);
      refreshMood();
      await persistState();

      await renderPet(pet);
      renderFoodPanel(pet.id);
      buildRingMenu();
      updateStatusPanel();

      bindEvents();
      startStatusLoop();
      startActionScheduler();
      startChatScheduler();
      updateFullscreenVisibility();
      cacheRect();

      // 聊天面板关闭按钮
      els.chatClose.addEventListener('click', (e) => {
        e.stopPropagation();
        closeChat();
      });
      // 点击聊天面板内部不冒泡（避免误触发宠物拖动/点击）
      els.chat.addEventListener('click', (e) => e.stopPropagation());

      // 跨天重置主动聊天计数
      const today = C.dayKey(Date.now());
      if (state.chatTriggerDay !== today) {
        state.chatTriggerDay = today;
        state.chatTriggerCount = 0;
        await persistState();
      }

      showBubble(visit.greeting, 5000);
      if (state.fullness < 30 || state.thirst < 30) setTimeout(checkStatusAlert, 1800);
    } catch (err) {
      console.error('[萌宠伴侣] 悬浮宠物初始化失败：', err);
    } finally {
      building = false;
    }
  }

  function applyPosition(pos) {
    if (pos && typeof pos.x === 'number' && typeof pos.y === 'number') {
      widget.style.left = pos.x + 'px';
      widget.style.top = pos.y + 'px';
      widget.style.right = 'auto';
      widget.style.bottom = 'auto';
    } else {
      widget.style.left = 'auto';
      widget.style.top = 'auto';
      widget.style.right = '20px';
      widget.style.bottom = '20px';
    }
  }

  // 收起/展开按钮图标与提示：展开态显示「—」（点击收起），收起态显示「＋」（点击展开）
  function updateToggleIcon() {
    if (!els.toggle) return;
    const collapsed = widget.classList.contains('collapsed');
    els.toggle.textContent = collapsed ? '＋' : '—';
    els.toggle.title = collapsed ? '展开' : '收起';
  }

  async function renderPet(asset) {
    els.svg.innerHTML = '';
    try {
      const svg = await fetchInlineSvg(asset.src);
      els.svg.appendChild(svg);
      const hasEyes = svg.querySelector('#pet-eye-left, #pet-eye-right');
      widget.classList.toggle('has-eyes', !!hasEyes);
    } catch (e) {
      const img = document.createElement('img');
      img.src = chrome.runtime.getURL(asset.src);
      img.alt = asset.name;
      img.style.width = '100%';
      img.style.height = '100%';
      img.style.objectFit = 'contain';
      els.svg.innerHTML = '';
      els.svg.appendChild(img);
      widget.classList.remove('has-eyes');
      console.error(e);
    }
  }

  /* ---------------- 心情 ---------------- */
  // 心情徽章：用 emotion/ 文件夹图标替换原来的 emoji。
  function setMoodIcon(mood) {
    const existing = els.mood.querySelector('img');
    if (existing && existing.dataset.mood === mood) return;
    els.mood.innerHTML = '';
    const img = document.createElement('img');
    img.src = C.assetURL(C.moodIcon(mood));
    img.alt = C.moodInfo(mood).label;
    img.draggable = false;
    img.dataset.mood = mood;
    els.mood.appendChild(img);
  }

  function refreshMood() {
    const prev = state.mood;
    const mood = C.computeMood(state);
    state.mood = mood;
    for (const m of Object.keys(C.MOOD_INFO)) widget.classList.remove('mood-' + m);
    widget.classList.add('mood-' + mood);
    setMoodIcon(mood);

    if (mood !== prev && !state.doNotDisturb) {
      if (mood === 'bored' || mood === 'angry') {
        if (!boredReminded) {
          const info = C.moodInfo(mood);
          showBubble(info.emoji + ' ' + info.bubble, {
            duration: 5000,
            clickable: mood === 'bored',
            onClick: mood === 'bored' ? playWithPet : null,
          });
          boredReminded = true;
        }
      } else if (mood === 'sleepy') {
        showBubble('😴 ' + C.moodInfo('sleepy').bubble, 4000);
      }
    }
    if (mood !== 'bored' && mood !== 'angry') boredReminded = false;
    updateStatusPanel();
  }

  /* ---------------- 状态面板（点击宠物后显示在宠物上方） ---------------- */
  function updateStatusPanel() {
    if (!els.statFill || !els.statVal) return;
    els.statFill.fullness.style.width = state.fullness + '%';
    els.statFill.thirst.style.width = state.thirst + '%';
    els.statFill.energy.style.width = state.energy + '%';
    els.statVal.fullness.textContent = state.fullness + '%';
    els.statVal.thirst.textContent = state.thirst + '%';
    els.statVal.energy.textContent = state.energy + '%';

    const m = C.moodInfo(state.mood);
    els.statVal.mood.textContent = `${m.emoji} ${m.label}`;

    const lv = C.levelInfo(state.intimacy);
    els.statVal.intimacy.textContent = `Lv.${lv.level} ${lv.name}`;

    els.statVal.health.textContent = state.health >= 100 ? '健康' : `${state.health}% 不适`;
  }

  /* ---------------- 环形功能菜单 ---------------- */
  function buildRingMenu() {
    // 悬浮层只保留「喂食 / 喂水」两个按钮；喂食按钮使用「零食罐头」插画区分
    els.ring.appendChild(C.buildRingMenu({ feed: 'onther/零食罐头.svg' }, ['feed', 'drink']));
    els.ring.addEventListener('click', (e) => {
      const btn = e.target.closest('.ring-btn');
      if (!btn) return;
      e.stopPropagation();
      handleRingAction(btn.dataset.act);
    });
  }

  function handleRingAction(act) {
    if (act === 'feed') openFoodPanel('food');
    else if (act === 'drink') openFoodPanel('drink');
    else if (act === 'play') playWithPet();
    else if (act === 'clean') doClean();
    else if (act === 'heal') doHeal();
    else if (act === 'rest') doRest();
  }

  function showMenuAndStatus() {
    clearTimeout(menuCloseTimer);
    els.ring.hidden = false;
    els.status.hidden = false;
    void els.ring.offsetWidth;
    els.ring.classList.add('show');
    els.status.classList.add('show');
    menuOpen = true;
    updateStatusPanel();
    fitUI();
  }

  function hideMenuAndStatus() {
    if (!menuOpen) return;
    menuOpen = false;
    els.ring.classList.remove('show');
    els.status.classList.remove('show');
    menuCloseTimer = setTimeout(() => {
      els.ring.hidden = true;
      els.status.hidden = true;
    }, 220);
  }

  function toggleMenuAndStatus() {
    if (menuOpen) hideMenuAndStatus();
    else showMenuAndStatus();
  }

  // 边缘检测：菜单/面板可能超出视口，测量后整体平移回屏幕内
  function fitUI() {
    if (!els.ui) return;
    els.ui.style.transform = '';
    const vw = window.innerWidth, vh = window.innerHeight;
    const nodes = [els.status, ...els.ring.querySelectorAll('.ring-btn')];
    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
    nodes.forEach((n) => {
      const r = n.getBoundingClientRect();
      if (!r || (r.width === 0 && r.height === 0)) return;
      minX = Math.min(minX, r.left); minY = Math.min(minY, r.top);
      maxX = Math.max(maxX, r.right); maxY = Math.max(maxY, r.bottom);
    });
    if (!isFinite(minX)) return;
    let dx = 0, dy = 0;
    if (minX < 8) dx = 8 - minX;
    if (minY < 8) dy = 8 - minY;
    if (maxX > vw - 8) dx = (vw - 8) - maxX;
    if (maxY > vh - 8) dy = (vh - 8) - maxY;
    if (dx || dy) els.ui.style.transform = `translate(${dx}px, ${dy}px)`;
  }

  // 聊天面板边缘检测：整体平移回屏幕内（保持居中基准）
  function fitChat() {
    if (!els.chat || els.chat.hidden) return;
    els.chat.style.transform = 'translateX(-50%)';
    const r = els.chat.getBoundingClientRect();
    const vw = window.innerWidth, vh = window.innerHeight;
    let dx = 0, dy = 0;
    if (r.left < 8) dx = 8 - r.left;
    if (r.top < 8) dy = 8 - r.top;
    if (r.right > vw - 8) dx = (vw - 8) - r.right;
    if (r.bottom > vh - 8) dy = (vh - 8) - r.bottom;
    if (dx || dy) els.chat.style.transform = `translateX(-50%) translate(${dx}px, ${dy}px)`;
  }

  /* ---------------- 食物/饮品面板 ---------------- */
  function renderFoodPanel(petId) {
    const items = window.FOOD_HELPER.getFoods(petId);
    els.panel.innerHTML = '';
    items.forEach((item) => {
      const card = window.FOOD_HELPER.createFoodCard(item);
      card.addEventListener('click', (e) => {
        e.stopPropagation();
        onConsume(card);
      });
      els.panel.appendChild(card);
    });
  }

  function openFoodPanel(prefer = null) {
    // 只显示对应种类：喂食只显示食物（food/），喂水只显示饮品（water/）
    els.panel.querySelectorAll('.food-card').forEach((card) => {
      card.style.display = prefer && card.dataset.kind !== prefer ? 'none' : '';
    });
    els.panel.hidden = false;
    els.panel.classList.remove('show');
    void els.panel.offsetWidth;
    els.panel.classList.add('show');
    panelOpen = true;
    if (prefer) {
      const target = els.panel.querySelector(`.food-card[data-kind='${prefer}']`);
      if (target) target.scrollIntoView({ block: 'nearest', inline: 'center', behavior: 'smooth' });
    }
  }

  function closeFoodPanel() {
    els.panel.hidden = true;
    els.panel.classList.remove('show');
    panelOpen = false;
  }

  /* ---------------- 事件绑定 ---------------- */
  function bindEvents() {
    els.toggle.addEventListener('click', (e) => {
      e.stopPropagation();
      widget.classList.toggle('collapsed');
      updateToggleIcon();
      save({ floatCollapsed: widget.classList.contains('collapsed') });
    });

    widget.addEventListener('pointerdown', onPointerDown);
    widget.addEventListener('pointermove', onPointerMove);
    widget.addEventListener('pointerup', onPointerUp);
    widget.addEventListener('pointercancel', onPointerUp);

    document.addEventListener('click', (e) => {
      if (panelOpen && !els.panel.contains(e.target)) closeFoodPanel();
      if (menuOpen && !widget.contains(e.target)) hideMenuAndStatus();
    });
  }

  function onPointerDown(e) {
    if (e.button !== 0) return;
    // 点击按钮 / 菜单 / 食物面板 / 气泡时不进入拖动
    if (e.target.closest('.pet-float-toggle, .pet-food-panel, .pet-ui, .pet-bubble, .pet-chat-panel')) return;
    e.preventDefault();
    const r = widget.getBoundingClientRect();
    drag = { startX: e.clientX, startY: e.clientY, left: r.left, top: r.top, moved: false };
    widget.classList.add('dragging');
    widget.setPointerCapture(e.pointerId);
  }

  function onPointerMove(e) {
    if (!drag) return;
    const dx = e.clientX - drag.startX;
    const dy = e.clientY - drag.startY;
    if (!drag.moved && Math.abs(dx) + Math.abs(dy) < 4) return;
    if (!drag.moved) {
      // 真正开始拖动时收起菜单与食物面板，避免拖拽过程中残留
      hideMenuAndStatus();
      closeFoodPanel();
    }
    drag.moved = true;
    widget.style.left = (drag.left + dx) + 'px';
    widget.style.top = (drag.top + dy) + 'px';
    widget.style.right = 'auto';
    widget.style.bottom = 'auto';
  }

  function onPointerUp(e) {
    if (!drag) return;
    const wasDrag = drag.moved;
    drag = null;
    widget.classList.remove('dragging');
    if (widget.hasPointerCapture(e.pointerId)) widget.releasePointerCapture(e.pointerId);
    const r = widget.getBoundingClientRect();
    save({ floatPos: { x: r.left, y: r.top } });
    cacheRect();
    if (!wasDrag) handlePetClick(e);
  }

  function handlePetClick(e) {
    const part = detectPart(e);
    const r = widget.getBoundingClientRect();
    if (part === 'head') {
      playBounce();
      widget.classList.add('squint');
      setTimeout(() => widget.classList.remove('squint'), 1200);
      spawnIllustrationFX(4, e.clientX - r.left, e.clientY - r.top);
      showBubble('摸摸头，好舒服～', 1800);
      recordInteraction('pet', 2);
    } else if (part === 'tail') {
      widget.classList.add('tail-touch');
      setTimeout(() => widget.classList.remove('tail-touch'), 700);
      showBubble('尾巴缩了一下～', 1600);
      recordInteraction('pet', 1);
    } else if (part === 'paw') {
      widget.classList.add('paw-touch');
      setTimeout(() => widget.classList.remove('paw-touch'), 700);
      showBubble('握手手～', 1600);
      recordInteraction('pet', 1);
    } else {
      playBounce();
      blush();
      spawnIllustrationFX(4, e.clientX - r.left, e.clientY - r.top);
      recordInteraction('pet', 1);
    }
    // 点击宠物：抚摸的同时打开/关闭环形菜单 + 状态面板
    toggleMenuAndStatus();
  }

  function detectPart(e) {
    const t = e.target;
    if (t && t.closest) {
      if (t.closest('#pet-head')) return 'head';
      if (t.closest('#pet-tail')) return 'tail';
      if (t.closest('#pet-paw-left') || t.closest('#pet-paw-right')) return 'paw';
    }
    const svg = els.svg.querySelector('svg');
    if (svg) {
      const r = svg.getBoundingClientRect();
      const y = (e.clientY - r.top) / r.height;
      const x = (e.clientX - r.left) / r.width;
      if (y < 0.42) return 'head';
      if (y > 0.72) return x < 0.5 ? 'paw' : 'tail';
    }
    return 'body';
  }

  /* ---------------- 动画 / 特效 ---------------- */
  function playBounce() {
    widget.classList.remove('bounce');
    void widget.offsetWidth;
    widget.classList.add('bounce');
    setTimeout(() => widget.classList.remove('bounce'), 580);
  }

  function blush() {
    widget.classList.add('blushing');
    setTimeout(() => widget.classList.remove('blushing'), 2000);
  }

  function playEat() {
    widget.classList.remove('eating');
    void widget.offsetWidth;
    widget.classList.add('eating');
    setTimeout(() => widget.classList.remove('eating'), 950);
  }

  function playDrink() {
    widget.classList.remove('drinking');
    void widget.offsetWidth;
    widget.classList.add('drinking');
    setTimeout(() => widget.classList.remove('drinking'), 800);
  }

  function shakeHead() {
    widget.classList.remove('shake');
    void widget.offsetWidth;
    widget.classList.add('shake');
    setTimeout(() => widget.classList.remove('shake'), 520);
  }

  function spawnFX(x, y, count = 6, symbols = ['❤️', '💖', '💕', '⭐', '✨', '💗']) {
    for (let i = 0; i < count; i++) {
      const el = document.createElement('span');
      el.className = 'fx';
      el.textContent = symbols[Math.floor(Math.random() * symbols.length)];
      el.style.left = x + 'px';
      el.style.top = y + 'px';
      el.style.setProperty('--dx', ((Math.random() - 0.5) * 80) + 'px');
      el.style.setProperty('--rot', ((Math.random() - 0.5) * 60) + 'deg');
      el.style.fontSize = (14 + Math.random() * 14) + 'px';
      els.fx.appendChild(el);
      setTimeout(() => el.remove(), 1200);
    }
  }

  // 插画粒子（小花 / 棒棒糖；清洁时用牙刷 / 星星）
  function spawnIllustrationFX(count, x, y, paths) {
    const rect = widget.getBoundingClientRect();
    const cx = typeof x === 'number' ? x : rect.width / 2;
    const cy = typeof y === 'number' ? y : rect.height * 0.45;
    const list = paths || C.PET_EFFECT_ICONS;
    for (let i = 0; i < count; i++) {
      const img = document.createElement('img');
      img.className = 'fx fx-img';
      img.src = C.assetURL(list[Math.floor(Math.random() * list.length)]);
      img.alt = '';
      img.draggable = false;
      img.style.left = (cx + (Math.random() - 0.5) * 22) + 'px';
      img.style.top = (cy + (Math.random() - 0.5) * 16) + 'px';
      img.style.setProperty('--dx', ((Math.random() - 0.5) * 260) + 'px');
      img.style.setProperty('--dy', (-45 - Math.random() * 110) + 'px');
      img.style.setProperty('--rot', ((Math.random() - 0.5) * 100) + 'deg');
      img.style.animationDelay = (Math.random() * 0.12) + 's';
      els.fx.appendChild(img);
      setTimeout(() => img.remove(), 1500);
    }
  }

  /* ---------------- 主动小动作 ---------------- */
  const ACTION_DURATION = {
    yawn: 2200, stretch: 2400, wag: 2000, look: 1800,
    sleep: 5000, edge: 2600,
  };

  function startActionScheduler() {
    clearTimeout(actionTimer);
    const mood = state.mood;
    let delay;
    if (mood === 'bored' || mood === 'angry') delay = 15000 + Math.random() * 20000;
    else if (mood === 'sleepy') delay = 40000 + Math.random() * 30000;
    else delay = 20000 + Math.random() * 40000;
    actionTimer = setTimeout(() => {
      playRandomAction();
      startActionScheduler();
    }, delay);
  }

  function playRandomAction() {
    if (state.feeding) { startActionScheduler(); return; }
    const lv = C.levelInfo(state.intimacy).level;
    playAction(C.pickAction(lv).key);
    if (lv >= 3 && Math.random() < 0.4) {
      showBubble(C.randomLine(state.intimacy), 2200);
    }
  }

  function playAction(key) {
    if (key === 'edge') { playEdgeWalk(); return; }
    for (const a of C.ACTIONS) widget.classList.remove('action-' + a.key);
    void widget.offsetWidth;
    widget.classList.add('action-' + key);
    const dur = ACTION_DURATION[key] || 2000;
    if (key === 'sleep') showBubble('Zzz…', 2600);
    setTimeout(() => widget.classList.remove('action-' + key), dur);
  }

  // 苦脸 / 拒绝动画（讨厌食物或喝中药时）
  function playBitter() {
    widget.classList.remove('bitter');
    void widget.offsetWidth;
    widget.classList.add('bitter');
    setTimeout(() => widget.classList.remove('bitter'), 700);
  }

  function currentPetName() {
    const p = window.PET_LIST.find((x) => x.id === state.petId);
    return p ? p.name : '小宠物';
  }

  /* ---------------- 主动聊天 ---------------- */
  function startChatScheduler() {
    clearTimeout(chatCheckTimer);
    const delay = 15000 + Math.random() * 30000; // 15~45 秒
    chatCheckTimer = setTimeout(() => {
      maybeTriggerChat();
      startChatScheduler();
    }, delay);
  }

  function allowChatTriggerToday() {
    const today = C.dayKey(Date.now());
    if (state.chatTriggerDay !== today) return true;
    return state.chatTriggerCount < 30;
  }

  function recordChatTrigger() {
    const today = C.dayKey(Date.now());
    if (state.chatTriggerDay !== today) {
      state.chatTriggerDay = today;
      state.chatTriggerCount = 0;
    }
    state.chatTriggerCount++;
    persistState();
  }

  function maybeTriggerChat() {
    if (state.proactiveChat === false) return;
    if (state.doNotDisturb) return;
    if (chatActive) return;
    if (state.feeding) return;
    if (drag) return;                             // 拖动中不打断
    if (widget.classList.contains('action-sleep')) return;
    if (!allowChatTriggerToday()) return;
    if (Math.random() > 0.8) return;

    recordChatTrigger();
    showBubble('我想和你聊天～', { duration: 0, clickable: true, onClick: openChat });
  }

  /* ---------------- 聊天面板与对话流程 ---------------- */
  function openChat() {
    if (chatActive) return;
    hideBubble();
    chatActive = true;
    chatNode = CHAT.pickDialogue();
    els.chatTitle.textContent = `和 ${currentPetName()} 聊天`;
    els.chatBody.innerHTML = '';
    els.chat.hidden = false;
    els.chat.classList.remove('show');
    void els.chat.offsetWidth;
    els.chat.classList.add('show');
    fitChat();
    renderChatTurn(chatNode.opening, chatNode.options);
  }

  function closeChat() {
    els.chat.classList.remove('show');
    els.chat.hidden = true;
    chatActive = false;
    chatNode = null;
  }

  function appendChatLine(role, text) {
    const line = document.createElement('div');
    line.className = 'chat-line chat-' + role;
    line.textContent = text;
    els.chatBody.appendChild(line);
    els.chatBody.scrollTop = els.chatBody.scrollHeight;
  }

  function renderChatTurn(petText, options) {
    appendChatLine('pet', petText);
    const opts = document.createElement('div');
    opts.className = 'chat-options';
    options.forEach((opt) => {
      const b = document.createElement('button');
      b.type = 'button';
      b.className = 'chat-option';
      b.textContent = opt.text;
      b.addEventListener('click', () => onChatOption(opt));
      opts.appendChild(b);
    });
    els.chatBody.appendChild(opts);
    els.chatBody.scrollTop = els.chatBody.scrollHeight;
  }

  function onChatOption(opt) {
    els.chatBody.querySelectorAll('.chat-option').forEach((b) => { b.disabled = true; });
    appendChatLine('user', opt.text);
    appendChatLine('pet', opt.reply);

    const r = CHAT.applyEffects(state, opt.effects);
    refreshMood();
    updateStatusPanel();
    persistState();
    if (r.levelUp) {
      const rect = widget.getBoundingClientRect();
      spawnFX(rect.width / 2, rect.height * 0.3, 10, ['🎉', '✨', '⭐', '💖', '🎊']);
      showBubble(`亲密度升级：${C.levelInfo(state.intimacy).name}！`, 3000);
    }

    if (opt.next) {
      chatNode = opt.next;
      setTimeout(() => renderChatTurn(chatNode.opening, chatNode.options), 420);
    } else {
      endChat();
    }
  }

  function endChat() {
    appendChatLine('pet', '和你聊天真开心，下次再聊呀～ 👋');
    setTimeout(closeChat, 1800);
  }

  // 走到屏幕边缘再回来：用 left/top 过渡移动整个挂件（短暂、罕见，开销可接受）
  function playEdgeWalk() {
    if (!widget || widget.classList.contains('edge-walk')) return;
    widget.classList.add('edge-walk');
    const r = widget.getBoundingClientRect();
    const dir = Math.random() < 0.5 ? -1 : 1;
    const targetX = dir < 0 ? 8 : Math.max(8, window.innerWidth - r.width - 8);
    const targetY = Math.min(Math.max(8, r.top), Math.max(8, window.innerHeight - r.height - 8));
    widget.style.transition = 'left 1.1s ease-in-out, top 1.1s ease-in-out';
    widget.style.left = targetX + 'px';
    widget.style.top = targetY + 'px';
    widget.style.right = 'auto';
    widget.style.bottom = 'auto';
    setTimeout(() => {
      widget.style.left = r.left + 'px';
      widget.style.top = r.top + 'px';
      widget.style.right = 'auto';
      widget.style.bottom = 'auto';
      setTimeout(() => {
        widget.style.transition = '';
        widget.classList.remove('edge-walk');
        save({ floatPos: { x: r.left, y: r.top } });
        cacheRect();
      }, 1100);
    }, 1100);
  }

  /* ---------------- 环形菜单动作：玩耍 / 清洁 / 治疗 / 休息 ---------------- */
  async function playWithPet() {
    if (state.feeding) return;
    const rect = widget.getBoundingClientRect();
    spawnIllustrationFX(6, rect.width / 2, rect.height * 0.4);
    const msgs = ['好开心！', '再来一次！', '一起玩～'];
    showBubble(msgs[Math.floor(Math.random() * msgs.length)], 2000);
    state.energy = C.clamp(state.energy + 20);
    updateStatusPanel();
    await recordInteraction('play', 3);
  }

  async function doClean() {
    if (state.feeding) return;
    const rect = widget.getBoundingClientRect();
    spawnIllustrationFX(6, rect.width / 2, rect.height * 0.4, C.CLEAN_EFFECT_ICONS);
    showBubble('清清爽爽～', 2000);
    await recordInteraction('pet', 1);
  }

  async function doHeal() {
    if (state.health >= 100) {
      showBubble('我很健康，不用治疗哦～', 2000);
      return;
    }
    state.health = 100;
    sickNotified = false;
    updateStatusPanel();
    const rect = widget.getBoundingClientRect();
    spawnFX(rect.width / 2, rect.height * 0.3, 10, ['🎉', '✨', '⭐', '💖', '🎊']);
    showBubble('身体好多了，谢谢！', 3000);
    await recordInteraction('pet', 1);
  }

  async function doRest() {
    if (state.feeding) return;
    playAction('sleep');
    showBubble('小睡一会儿…', 2600);
    state.energy = C.clamp(state.energy + 10);
    updateStatusPanel();
    await recordInteraction('pet', 1);
  }

  /* ---------------- 互动记录 / 亲密度 ---------------- */
  async function recordInteraction(kind, amount) {
    state.lastInteractTime = Date.now();
    if (kind === 'feed') state.feedCount++;
    else if (kind === 'drink') state.drinkCount++;
    else if (kind === 'play') state.playCount++;
    else if (kind === 'pet') state.petCount++;

    const r = C.addIntimacy(state, amount);
    refreshMood();
    await persistState();

    if (r.levelUp) {
      const rect = widget.getBoundingClientRect();
      spawnFX(rect.width / 2, rect.height * 0.3, 10, ['🎉', '✨', '⭐', '💖', '🎊']);
      showBubble(`亲密度升级：${r.name}！`, 3000);
    }
    return r;
  }

  /* ---------------- 对话气泡 ---------------- */
  function showBubble(text, opts = {}) {
    const { duration = 2000, clickable = false, onClick = null } = opts;
    clearTimeout(bubbleTimer);
    clearTimeout(bubbleHideTimer);
    els.bubble.textContent = text;
    els.bubble.classList.toggle('clickable', clickable);
    els.bubble.onclick = clickable
      ? (e) => { e.stopPropagation(); if (onClick) onClick(); }
      : null;
    els.bubble.classList.remove('hide');
    els.bubble.hidden = false;
    els.bubble.classList.remove('show');
    void els.bubble.offsetWidth;
    els.bubble.classList.add('show');
    if (duration > 0) bubbleTimer = setTimeout(hideBubble, duration);
  }

  function hideBubble() {
    clearTimeout(bubbleTimer);
    clearTimeout(bubbleHideTimer);
    if (els.bubble.hidden) return;
    els.bubble.onclick = null;
    els.bubble.classList.remove('clickable', 'show');
    els.bubble.classList.add('hide');
    bubbleHideTimer = setTimeout(() => {
      els.bubble.hidden = true;
      els.bubble.classList.remove('hide');
    }, 200);
  }

  function checkStatusAlert() {
    if (state.fullness >= 30 && state.thirst >= 30) return;
    if (state.thirst < state.fullness) {
      showBubble('好渴呀～', { duration: 5000, clickable: true, onClick: () => openFoodPanel('drink') });
    } else {
      showBubble('我饿了～', { duration: 5000, clickable: true, onClick: () => openFoodPanel('food') });
    }
  }

  function checkSitReminder() {
    if (sitReminded || state.doNotDisturb) return;
    if (Date.now() - sessionStart > 45 * C.MIN) {
      sitReminded = true;
      showBubble('坐久了，起来动一动吧～', 5000);
    }
  }

  // 每 30 秒：衰减 + 生病 + 心情 + 饥饿/口渴 + 久坐提醒
  function startStatusLoop() {
    if (decayTimer) return;
    decayTimer = setInterval(() => {
      const changed = C.decayAll(state);
      const sickChanged = C.applySickness(state);
      if (changed || sickChanged) {
        updateStatusPanel();
        persistState();
        if (sickChanged && state.health < 100 && !sickNotified && !state.doNotDisturb) {
          sickNotified = true;
          showBubble('😿 我不太舒服…点「治疗」帮帮我', 5000);
        }
        if (state.health >= 100) sickNotified = false;
      }
      refreshMood();
      checkStatusAlert();
      checkSitReminder();
    }, 30000);
  }

  /* ---------------- 喂食 / 喂水 ---------------- */
  function getMouthPoint() {
    const svg = els.svg.querySelector('svg');
    const el = svg && (svg.querySelector('#pet-mouth') || svg.querySelector('#pet-head'));
    if (el) {
      const r = el.getBoundingClientRect();
      return { x: r.left + r.width / 2, y: r.top + r.height / 2 };
    }
    const r = els.svg.getBoundingClientRect();
    return { x: r.left + r.width / 2, y: r.top + r.height * 0.42 };
  }

  function flyFoodToMouth(card) {
    const iconEl = card.querySelector('.food-card-icon') || card;
    const from = iconEl.getBoundingClientRect();
    const to = getMouthPoint();
    const startX = from.left + from.width / 2;
    const startY = from.top + from.height / 2;
    const dx = to.x - startX;
    const dy = to.y - startY;
    const arc = -45;

    const fly = document.createElement('div');
    fly.className = 'food-fly';
    const srcImg = card.querySelector('img');
    const svgEl = card.querySelector('svg');
    if (srcImg) {
      const img = document.createElement('img');
      img.src = srcImg.src;
      img.alt = '食物';
      img.className = 'food-icon';
      fly.appendChild(img);
    } else if (svgEl) {
      fly.innerHTML = svgEl.outerHTML;
    }
    fly.style.left = startX + 'px';
    fly.style.top = startY + 'px';
    els.fly.appendChild(fly);

    const anim = fly.animate(
      [
        { transform: 'translate(-50%, -50%) translate(0px, 0px) scale(1)', opacity: 1 },
        { transform: `translate(-50%, -50%) translate(${dx / 2}px, ${dy / 2 + arc}px) scale(0.85)`, opacity: 1, offset: 0.55 },
        { transform: `translate(-50%, -50%) translate(${dx}px, ${dy}px) scale(0.4)`, opacity: 0 },
      ],
      { duration: 560, easing: 'ease-in-out' }
    );
    return anim.finished.then(() => fly.remove());
  }

  async function onConsume(card) {
    const kind = card.dataset.kind || 'food';
    const isDrink = kind === 'drink';
    const foodId = card.dataset.id;
    const current = isDrink ? state.thirst : state.fullness;

    if (current >= 100) {
      shakeHead();
      showBubble(isDrink ? '喝不下了～' : '吃不下了～', 1600);
      return;
    }
    if (state.feeding) return;
    state.feeding = true;
    closeFoodPanel();
    try {
      await flyFoodToMouth(card);

      state.lastFedTime = Date.now();
      state.energy = C.clamp(state.energy + 5);

      // —— 食物偏好系统 ——
      const petType = PREFS.petTypeOf(state.petId);
      const pref = PREFS.resolvePreference(state.foodPreferences, petType, foodId);
      let intimacyGain = 0;

      const mouthFX = () => {
        const p = getMouthPoint();
        const r = widget.getBoundingClientRect();
        spawnIllustrationFX(4, p.x - r.left, p.y - r.top, C.FEED_EFFECT_ICONS);
      };

      if (PREFS.isMedicine(foodId)) {
        // 中药：苦脸 + 健康提升
        state.health = C.clamp(state.health + PREFS.MEDICINE_HEALTH_GAIN);
        state.thirst = Math.min(100, state.thirst + 10);
        if (pref === 'dislike') {
          state.moodBonus = C.clampRange((state.moodBonus || 0) - 5, -30, 30);
        }
        playBitter();
        showBubble(PREFS.MEDICINE_BUBBLE, 2600);
      } else {
        const r = PREFS.FEED_REACTIONS[pref] || PREFS.FEED_REACTIONS.neutral;
        state.moodBonus = C.clampRange((state.moodBonus || 0) + r.mood, -30, 30);
        intimacyGain = r.intimacy;
        const gain = r.gain;
        if (isDrink) state.thirst = Math.min(100, state.thirst + gain);
        else state.fullness = Math.min(100, state.fullness + gain);

        if (pref === 'like') {
          playBounce();   // 开心跳跃
          mouthFX();
        } else if (pref === 'dislike') {
          shakeHead();    // 摇头拒绝
        } else {
          if (isDrink) playDrink(); else playEat();
          mouthFX();
        }
        showBubble(r.bubble, 2200);
      }

      updateStatusPanel();
      await recordInteraction(isDrink ? 'drink' : 'feed', intimacyGain);
    } finally {
      state.feeding = false;
    }
  }

  /* ---------------- 鼠标靠近：暂停漂浮 ---------------- */
  document.addEventListener('mousemove', (e) => {
    if (!widget) return;
    const now = Date.now();
    if (now - lastRectAt > 200) { cacheRect(); lastRectAt = now; }
    if (!cachedRect) return;
    const cx = cachedRect.left + cachedRect.width / 2;
    const cy = cachedRect.top + cachedRect.height / 2;
    const near = Math.hypot(e.clientX - cx, e.clientY - cy) < 170;
    widget.classList.toggle('nearby', near);
  });

  window.addEventListener('resize', () => {
    cacheRect();
    if (menuOpen) fitUI();
    if (chatActive) fitChat();
  });

  /* ---------------- 全屏隐藏 ---------------- */
  function updateFullscreenVisibility() {
    if (!widget) return;
    const fs = document.fullscreenElement || document.webkitFullscreenElement;
    widget.classList.toggle('fs-hidden', !!fs);
  }

  /* ---------------- 销毁 ---------------- */
  function destroyWidget() {
    if (widget) {
      widget.remove();
      widget = null;
      els = {};
      panelOpen = false;
      menuOpen = false;
      cachedRect = null;
    }
    const fly = document.getElementById('pet-fly-layer');
    if (fly) fly.remove();
    if (decayTimer) { clearInterval(decayTimer); decayTimer = null; }
    if (actionTimer) { clearTimeout(actionTimer); actionTimer = null; }
  }

  // 刷新宠物（勾选或当前宠物变化时）
  async function refreshPet() {
    const settings = await loadSettings();
    const pet = resolvePet(settings);
    let petStates = settings.petStates;
    const ps = C.loadPetState(petStates, pet.id);
    C.decayAll(ps);
    petStates = C.stashPetState(petStates, pet.id, ps);

    Object.assign(state, {
      petId: pet.id, petStates,
      fullness: ps.fullness, thirst: ps.thirst, energy: ps.energy,
      lastFedTime: ps.lastFedTime, lastInteractTime: ps.lastInteractTime,
      intimacy: settings.intimacy,
      health: settings.health,
      lastVisitTime: settings.lastVisitTime, lastVisitDay: settings.lastVisitDay,
      companionDays: settings.companionDays,
      unlocked: settings.unlocked, doNotDisturb: settings.doNotDisturb,
      proactiveChat: settings.proactiveChat,
      chatTriggerDay: settings.chatTriggerDay,
      chatTriggerCount: settings.chatTriggerCount,
      foodPreferences: settings.foodPreferences,
      moodBonus: settings.moodBonus,
    });
    refreshMood();
    await persistState();
    await renderPet(pet);
    renderFoodPanel(pet.id);
    updateStatusPanel();
  }

  /* ---------------- 存储变更监听 ---------------- */
  chrome.storage.onChanged.addListener((changes, area) => {
    if (area !== 'local') return;
    if ('showFloatingPet' in changes) {
      if (changes.showFloatingPet.newValue) initWidget();
      else destroyWidget();
    } else if ('doNotDisturb' in changes) {
      state.doNotDisturb = changes.doNotDisturb.newValue === true;
    } else if ('proactiveChat' in changes) {
      state.proactiveChat = changes.proactiveChat.newValue !== false;
    } else if ('foodPreferences' in changes) {
      state.foodPreferences = changes.foodPreferences.newValue || {};
    } else if (('currentPet' in changes || 'selectedPets' in changes) && widget) {
      refreshPet();
    }
  });

  document.addEventListener('fullscreenchange', updateFullscreenVisibility);
  document.addEventListener('webkitfullscreenchange', updateFullscreenVisibility);

  initWidget();
})();
