// ============================================================
// 新标签页萌宠伴侣 - newtab.js
// 内联 SVG + 分层动画 + 环形功能菜单 + 陪伴系统
// 依赖：pets.js（宠物清单）、food.js（食物）、companion.js（状态/心情/问候/菜单图标）
// 职责：
//   1. 读取并维护完整状态（按宠物三态 + 全局亲密度/健康/陪伴天数）
//   2. 时间问候、主动小动作（随亲密度解锁）、心情切换、亲密度成长、生病机制
//   3. 点击宠物弹出环形功能菜单与状态面板；点击不同部位有不同抚摸反应
//   4. 喂食/喂水/玩耍/清洁/治疗/休息；投喂飞行与吃东西动画
// ============================================================

'use strict';

const C = window.COMPANION;
const PREFS = window.PREFS;
const CHAT = window.CHAT;

/* ============================================================
   一、设置与持久化
   ============================================================ */
const DEFAULT_SETTINGS = {
  selectedPets: window.PET_LIST.map((p) => p.id),
  currentPet: null,   // 当前展示的小动物 id
  ...C.DEFAULTS,
};

// 读取设置（带默认值与旧数据兜底）
async function loadSettings() {
  const known = new Set(window.PET_LIST.map((p) => p.id));
  try {
    const data = await chrome.storage.local.get(DEFAULT_SETTINGS);

    let selected = Array.isArray(data.selectedPets)
      ? data.selectedPets.filter((id) => known.has(id))
      : [];
    if (selected.length === 0) selected = DEFAULT_SETTINGS.selectedPets.slice();

    const currentPet = known.has(data.currentPet) ? data.currentPet : null;
    const num = (v, d) => (typeof v === 'number' ? C.clamp(v) : d);

    // 旧版扁平三态 → 按宠物存储（只迁移一次）
    const petStates = C.migratePetStates(
      data.petStates && typeof data.petStates === 'object' ? data.petStates : {},
      data
    );

    return {
      selectedPets: selected,
      currentPet,
      petStates,
      intimacy: num(data.intimacy, DEFAULT_SETTINGS.intimacy),
      health: num(data.health, DEFAULT_SETTINGS.health),
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
  } catch (e) {
    return {
      selectedPets: DEFAULT_SETTINGS.selectedPets.slice(),
      currentPet: null,
      petStates: {},
      ...C.DEFAULTS,
    };
  }
}

// 持久化当前展示的小动物
async function persistCurrentPet(id) {
  try { await chrome.storage.local.set({ currentPet: id }); } catch (e) { /* 忽略 */ }
}

// 持久化全局陪伴状态 + 当前宠物三态快照（统一入口）
function persistStatus() {
  const s = state;
  const petStates = C.stashPetState(state.petStates, state.pet.id, state);
  state.petStates = petStates;
  return chrome.storage.local.set({
    petStates,
    intimacy: s.intimacy, health: s.health, mood: s.mood,
    lastVisitTime: s.lastVisitTime, lastVisitDay: s.lastVisitDay, companionDays: s.companionDays,
    feedCount: s.feedCount, drinkCount: s.drinkCount, playCount: s.playCount, petCount: s.petCount,
    unlocked: s.unlocked,
    proactiveChat: s.proactiveChat,
    chatTriggerDay: s.chatTriggerDay, chatTriggerCount: s.chatTriggerCount,
    foodPreferences: s.foodPreferences, moodBonus: s.moodBonus,
  }).catch(() => {});
}

/* ============================================================
   二、DOM 引用
   ============================================================ */
const stage = document.getElementById('pet-stage');
const petSvg = document.getElementById('pet-svg');
const fxLayer = document.getElementById('fx-layer');
const petNameEl = document.getElementById('pet-name');
const greetingEl = document.getElementById('greeting');
const foodPanel = document.getElementById('food-panel');
const ringMenu = document.getElementById('ring-menu');
const statusPanel = document.getElementById('status-panel');
const bubbleEl = document.getElementById('pet-bubble');
const flyLayer = document.getElementById('fly-layer');
const moodEl = document.getElementById('pet-mood');
const chatPanel = document.getElementById('chat-panel');
const chatBody = document.getElementById('chat-body');
const chatTitle = document.getElementById('chat-title');
const chatClose = document.getElementById('chat-close');

// 状态面板里的数值元素
const statFullness = document.getElementById('stat-fullness');
const statThirst = document.getElementById('stat-thirst');
const statEnergy = document.getElementById('stat-energy');
const statFullnessVal = document.getElementById('stat-fullness-val');
const statThirstVal = document.getElementById('stat-thirst-val');
const statEnergyVal = document.getElementById('stat-energy-val');
const statMood = document.getElementById('stat-mood');
const statIntimacy = document.getElementById('stat-intimacy');
const statHealth = document.getElementById('stat-health');

/* ============================================================
   三、运行时状态
   ============================================================ */
const state = {
  pet: null,
  petStates: {},
  fullness: 50,
  thirst: 50,
  energy: 80,
  intimacy: 0,
  health: 100,
  mood: 'normal',
  lastFedTime: null,
  lastInteractTime: null,
  lastVisitTime: null,
  lastVisitDay: null,
  companionDays: 1,
  feedCount: 0,
  drinkCount: 0,
  playCount: 0,
  petCount: 0,
  doNotDisturb: false,
  unlocked: [],
  feeding: false, // 食物飞行中，防止连点
  proactiveChat: true,
  chatTriggerDay: null,
  chatTriggerCount: 0,
  foodPreferences: {},
  moodBonus: 0,
};
let bubbleTimer = null;      // 气泡自动隐藏定时器
let bubbleHideTimer = null;  // 气泡淡出动画完成定时器
let panelOpen = false;       // 食物/饮品列表是否展开
let menuOpen = false;        // 环形菜单 + 状态面板是否展开
let menuCloseTimer = null;   // 环形菜单淡出后真正隐藏的定时器
let actionTimer = null;      // 主动小动作定时器
let chatCheckTimer = null;   // 主动聊天检查定时器
let boredReminded = false;   // 是否已提醒过“无聊”
let sickNotified = false;    // 是否已提醒过“生病”
// 聊天面板运行时状态
let chatActive = false;      // 聊天面板是否打开
let chatNode = null;         // 当前对话节点 { opening, options }
const sessionStart = Date.now(); // 本次会话开始时间（用于久坐提醒）
let sitReminded = false;     // 本次会话是否已提醒过久坐

/* ============================================================
   四、选中 / 随机逻辑
   ============================================================ */
function pickPool(selectedIds) {
  const pool = window.PET_LIST.filter((p) => selectedIds.includes(p.id));
  return pool.length ? pool : window.PET_LIST;
}

function resolvePet(settings) {
  const pool = pickPool(settings.selectedPets);
  if (settings.currentPet) {
    const saved = pool.find((p) => p.id === settings.currentPet);
    if (saved) return saved;
  }
  const chosen = pool[Math.floor(Math.random() * pool.length)];
  persistCurrentPet(chosen.id);
  return chosen;
}

/* ============================================================
   五、内联 SVG 渲染
   ============================================================ */
async function fetchInlineSvg(src) {
  const res = await fetch(src);
  if (!res.ok) throw new Error(`加载失败：${src}`);
  const text = await res.text();
  const doc = new DOMParser().parseFromString(text, 'image/svg+xml');
  const svg = doc.querySelector('svg');
  if (!svg) throw new Error(`SVG 解析失败：${src}`);
  svg.removeAttribute('width');
  svg.removeAttribute('height');
  return svg;
}

async function renderPet(asset) {
  petSvg.innerHTML = '';
  try {
    const svg = await fetchInlineSvg(asset.src);
    petSvg.appendChild(svg);
    const hasEyes = svg.querySelector('#pet-eye-left, #pet-eye-right');
    stage.classList.toggle('has-eyes', !!hasEyes);
  } catch (e) {
    petSvg.textContent = asset.name;
    stage.classList.remove('has-eyes');
    console.error(e);
  }
}

/* ============================================================
   六、状态面板（点击宠物后显示在宠物旁边）
   ============================================================ */
function updateStatusPanel() {
  statFullness.style.width = state.fullness + '%';
  statThirst.style.width = state.thirst + '%';
  statEnergy.style.width = state.energy + '%';
  statFullnessVal.textContent = state.fullness + '%';
  statThirstVal.textContent = state.thirst + '%';
  statEnergyVal.textContent = state.energy + '%';

  const m = C.moodInfo(state.mood);
  statMood.textContent = `${m.emoji} ${m.label}`;

  const lv = C.levelInfo(state.intimacy);
  statIntimacy.textContent = `Lv.${lv.level} ${lv.name}`;

  statHealth.textContent = state.health >= 100 ? '健康' : `${state.health}% 不适`;
}

function showMenuAndStatus() {
  clearTimeout(menuCloseTimer);
  ringMenu.hidden = false;
  statusPanel.hidden = false;
  // 强制重排后再加 .show，触发 transform + opacity 入场过渡
  void ringMenu.offsetWidth;
  ringMenu.classList.add('show');
  statusPanel.classList.add('show');
  menuOpen = true;
  updateStatusPanel();
}

function hideMenuAndStatus() {
  if (!menuOpen) return;
  menuOpen = false;
  ringMenu.classList.remove('show');
  statusPanel.classList.remove('show');
  // 等淡出动画结束后再真正隐藏
  menuCloseTimer = setTimeout(() => {
    ringMenu.hidden = true;
    statusPanel.hidden = true;
  }, 220);
}

function toggleMenuAndStatus() {
  if (menuOpen) hideMenuAndStatus();
  else showMenuAndStatus();
}

/* ============================================================
   七、环形功能菜单 + 食物/饮品列表
   ============================================================ */
function buildRingMenu() {
  const menu = C.buildRingMenu();
  ringMenu.innerHTML = '';
  ringMenu.appendChild(menu);

  ringMenu.addEventListener('click', (e) => {
    const btn = e.target.closest('.ring-btn');
    if (!btn) return;
    e.stopPropagation(); // 阻止事件冒泡到舞台，避免误触发“点击宠物”
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

function renderFoodPanel(pet) {
  const items = window.FOOD_HELPER.getFoods(pet.id);
  foodPanel.innerHTML = '';
  items.forEach((item) => {
    const card = window.FOOD_HELPER.createFoodCard(item);
    card.addEventListener('click', (e) => {
      e.stopPropagation(); // 阻止冒泡，避免触发舞台点击
      onConsume(card);
    });
    foodPanel.appendChild(card);
  });
}

function openFoodPanel(prefer = null) {
  // 只显示对应种类：喂食只显示食物（food/），喂水只显示饮品（water/）
  foodPanel.querySelectorAll('.food-card').forEach((card) => {
    card.style.display = prefer && card.dataset.kind !== prefer ? 'none' : '';
  });
  foodPanel.hidden = false;
  foodPanel.classList.remove('show');
  void foodPanel.offsetWidth;
  foodPanel.classList.add('show');
  panelOpen = true;
  if (prefer) {
    const target = foodPanel.querySelector(`.food-card[data-kind='${prefer}']`);
    if (target) target.scrollIntoView({ block: 'nearest', inline: 'center', behavior: 'smooth' });
  }
}

function closeFoodPanel() {
  foodPanel.hidden = true;
  foodPanel.classList.remove('show');
  panelOpen = false;
}

/* ============================================================
   八、投喂 / 喂水
   ============================================================ */
function getMouthPoint() {
  const svg = petSvg.querySelector('svg');
  const el = svg && (svg.querySelector('#pet-mouth') || svg.querySelector('#pet-head'));
  if (el) {
    const r = el.getBoundingClientRect();
    return { x: r.left + r.width / 2, y: r.top + r.height / 2 };
  }
  const r = stage.getBoundingClientRect();
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
  const arc = -55;

  const fly = document.createElement('div');
  fly.className = 'food-fly';
  const icon = card.querySelector('img');
  const svg = card.querySelector('svg');
  if (icon) {
    const img = document.createElement('img');
    img.src = icon.src;
    img.alt = icon.alt;
    img.className = 'food-icon';
    fly.appendChild(img);
  } else if (svg) {
    fly.innerHTML = svg.outerHTML;
  }
  fly.style.left = `${startX}px`;
  fly.style.top = `${startY}px`;
  flyLayer.appendChild(fly);

  const anim = fly.animate(
    [
      { transform: 'translate(-50%, -50%) translate(0px, 0px) scale(1)', opacity: 1 },
      {
        transform: `translate(-50%, -50%) translate(${dx / 2}px, ${dy / 2 + arc}px) scale(0.85)`,
        opacity: 1,
        offset: 0.55,
      },
      { transform: `translate(-50%, -50%) translate(${dx}px, ${dy}px) scale(0.4)`, opacity: 0 },
    ],
    { duration: 620, easing: 'ease-in-out' }
  );
  return anim.finished.then(() => fly.remove());
}

function playEatAnimation() {
  stage.classList.remove('eating');
  void stage.offsetWidth;
  stage.classList.add('eating');
  setTimeout(() => stage.classList.remove('eating'), 950);
}

function playDrinkAnimation() {
  stage.classList.remove('drinking');
  void stage.offsetWidth;
  stage.classList.add('drinking');
  setTimeout(() => stage.classList.remove('drinking'), 800);
}

function shakeHead() {
  stage.classList.remove('shake');
  void stage.offsetWidth;
  stage.classList.add('shake');
  setTimeout(() => stage.classList.remove('shake'), 520);
}

function spawnFeedFX() {
  const p = getMouthPoint();
  const rect = stage.getBoundingClientRect();
  spawnIllustrationFX(4, p.x - rect.left, p.y - rect.top, C.FEED_EFFECT_ICONS);
}

function spawnDrinkFX() {
  const p = getMouthPoint();
  const rect = stage.getBoundingClientRect();
  spawnIllustrationFX(4, p.x - rect.left, p.y - rect.top, C.FEED_EFFECT_ICONS);
}

// 点击卡片：按种类投喂食物或饮品（结合食物偏好系统）
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

    state.lastFedTime = Date.now();           // 投喂/饮水都刷新衰减计时
    state.energy = C.clamp(state.energy + 5); // 进食也能恢复一点精力

    // —— 食物偏好系统：根据宠物类型 + 食物 id 解析喜欢/普通/讨厌 ——
    const petType = PREFS.petTypeOf(state.pet.id);
    const pref = PREFS.resolvePreference(state.foodPreferences, petType, foodId);
    let intimacyGain = 0; // 亲密度增量（讨厌/中药时为 0）

    if (PREFS.isMedicine(foodId)) {
      // 中药：无论喜好都做苦脸，但健康值提升；若本就讨厌，心情略降
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
      // 讨厌：不增加饱腹/口渴；喜欢/普通按 gain 增加
      const gain = r.gain;
      if (isDrink) state.thirst = Math.min(100, state.thirst + gain);
      else state.fullness = Math.min(100, state.fullness + gain);

      if (pref === 'like') {
        bounce(); // 开心跳跃
        if (isDrink) spawnDrinkFX(); else spawnFeedFX();
      } else if (pref === 'dislike') {
        shakeHead(); // 摇头拒绝
      } else {
        // 普通：正常进食/喝水
        if (isDrink) { playDrinkAnimation(); spawnDrinkFX(); }
        else { playEatAnimation(); spawnFeedFX(); }
      }
      showBubble(r.bubble, 2200);
    }

    updateStatusPanel();
    await recordInteraction(isDrink ? 'drink' : 'feed', intimacyGain);
  } finally {
    state.feeding = false;
  }
}

/* ============================================================
   九、状态 UI 与衰减
   ============================================================ */
function updateAllStatusUI() {
  updateStatusPanel();
  const lv = C.levelInfo(state.intimacy);
  petNameEl.innerHTML = `${state.pet.name}<span class="tag">Lv.${lv.level} ${lv.name} · 第 ${state.companionDays} 天</span>`;
}

// 页面停留期间定时（每 30 秒）：衰减 + 生病 + 心情 + 饥饿/口渴 + 久坐提醒
function startStatusLoop() {
  setInterval(() => {
    const changed = C.decayAll(state);
    const sickChanged = C.applySickness(state);
    if (changed || sickChanged) {
      updateStatusPanel();
      persistStatus();
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

// 状态低时弹气泡：更紧急（数值更低）的优先（免打扰也不屏蔽）
function checkStatusAlert() {
  if (state.fullness >= 30 && state.thirst >= 30) return;
  if (state.thirst < state.fullness) {
    showBubble('好渴呀～', { duration: 5000, clickable: true, onClick: () => openFoodPanel('drink') });
  } else {
    showBubble('我饿了～', { duration: 5000, clickable: true, onClick: () => openFoodPanel('food') });
  }
}

// 久坐提醒：页面停留超过 45 分钟提醒一次（免打扰时抑制）
function checkSitReminder() {
  if (sitReminded || state.doNotDisturb) return;
  if (Date.now() - sessionStart > 45 * C.MIN) {
    sitReminded = true;
    showBubble('坐久了，起来动一动吧～', 5000);
  }
}

/* ============================================================
   十、互动记录 / 亲密度 / 升级庆祝
   ============================================================ */
async function recordInteraction(kind, amount) {
  state.lastInteractTime = Date.now();
  if (kind === 'feed') state.feedCount++;
  else if (kind === 'drink') state.drinkCount++;
  else if (kind === 'play') state.playCount++;
  else if (kind === 'pet') state.petCount++;

  const r = C.addIntimacy(state, amount);
  refreshMood();
  await persistStatus();

  if (r.levelUp) {
    celebrate(`亲密度升级：${r.name}！`);
  }
  return r;
}

function celebrate(text) {
  const rect = stage.getBoundingClientRect();
  spawnFX(rect.width / 2, rect.height * 0.3, 12, ['🎉', '✨', '⭐', '💖', '🎊']);
  showBubble(text, 3000);
}

/* ============================================================
   十一、对话气泡
   ============================================================ */
function showBubble(text, opts = {}) {
  const { duration = 2000, clickable = false, onClick = null } = opts;
  clearTimeout(bubbleTimer);
  clearTimeout(bubbleHideTimer);
  bubbleEl.textContent = text;
  bubbleEl.classList.toggle('clickable', clickable);
  bubbleEl.onclick = clickable
    ? (e) => { e.stopPropagation(); if (onClick) onClick(); }
    : null;
  bubbleEl.classList.remove('hide');
  bubbleEl.hidden = false;
  bubbleEl.classList.remove('show');
  void bubbleEl.offsetWidth;
  bubbleEl.classList.add('show');
  if (duration > 0) bubbleTimer = setTimeout(hideBubble, duration);
}

function hideBubble() {
  clearTimeout(bubbleTimer);
  clearTimeout(bubbleHideTimer);
  if (bubbleEl.hidden) return;
  bubbleEl.onclick = null;
  bubbleEl.classList.remove('clickable', 'show');
  bubbleEl.classList.add('hide');
  bubbleHideTimer = setTimeout(() => {
    bubbleEl.hidden = true;
    bubbleEl.classList.remove('hide');
  }, 200);
}

/* ============================================================
   十二、主动小动作（每 20~60 秒随机，频率随心情、动作随亲密度解锁）
   ============================================================ */
const ACTION_DURATION = {
  yawn: 2200, stretch: 2400, wag: 2000, look: 1800,
  sleep: 5000, edge: 2600,
};

function startActionScheduler() {
  clearTimeout(actionTimer);
  const mood = state.mood;
  let delay;
  if (mood === 'bored' || mood === 'angry') delay = 15000 + Math.random() * 20000; // 频繁，显得着急
  else if (mood === 'sleepy') delay = 40000 + Math.random() * 30000;                 // 慵懒
  else delay = 20000 + Math.random() * 40000;                                       // 默认 20~60s
  actionTimer = setTimeout(() => {
    playRandomAction();
    startActionScheduler();
  }, delay);
}

function playRandomAction() {
  if (state.feeding) { startActionScheduler(); return; }
  const lv = C.levelInfo(state.intimacy).level;
  playAction(C.pickAction(lv).key);
  // 亲密度较高时，偶尔随动作说一句走心的话
  if (lv >= 3 && Math.random() < 0.4) {
    showBubble(C.randomLine(state.intimacy), 2200);
  }
}

function playAction(key) {
  for (const a of C.ACTIONS) stage.classList.remove('action-' + a.key);
  void stage.offsetWidth;
  stage.classList.add('action-' + key);
  const dur = ACTION_DURATION[key] || 2000;
  if (key === 'sleep') showBubble('Zzz…', 2600);
  setTimeout(() => stage.classList.remove('action-' + key), dur);
}

// 苦脸 / 拒绝动画（讨厌食物或喝中药时）
function playBitter() {
  stage.classList.remove('bitter');
  void stage.offsetWidth;
  stage.classList.add('bitter');
  setTimeout(() => stage.classList.remove('bitter'), 700);
}

/* ============================================================
   十二·五、主动聊天
   ============================================================ */
// 主动聊天调度器：每隔随机 15~45 秒检查一次，条件满足且有 80% 概率弹出气泡
function startChatScheduler() {
  clearTimeout(chatCheckTimer);
  const delay = 15000 + Math.random() * 30000;
  chatCheckTimer = setTimeout(() => {
    maybeTriggerChat();
    startChatScheduler();
  }, delay);
}

// 判断今天是否还能触发主动聊天（每天最多 30 次）
function allowChatTriggerToday() {
  const today = C.dayKey(Date.now());
  if (state.chatTriggerDay !== today) return true; // 新的一天
  return state.chatTriggerCount < 30;
}

// 记录一次主动聊天触发（跨天时自动重置计数）
function recordChatTrigger() {
  const today = C.dayKey(Date.now());
  if (state.chatTriggerDay !== today) {
    state.chatTriggerDay = today;
    state.chatTriggerCount = 0;
  }
  state.chatTriggerCount++;
  persistStatus();
}

// 尝试弹出“我想和你聊天”气泡（满足条件才触发）
function maybeTriggerChat() {
  if (state.proactiveChat === false) return;   // 用户关闭主动聊天
  if (state.doNotDisturb) return;              // 免打扰只保留饥饿/口渴提醒
  if (chatActive) return;                      // 已在聊天
  if (state.feeding) return;                   // 正在喂食，不打断
  if (stage.classList.contains('action-sleep')) return; // 睡觉中不打扰
  if (!allowChatTriggerToday()) return;        // 今日次数已达上限
  if (Math.random() > 0.8) return;             // 80% 概率

  recordChatTrigger();
  // 气泡不自动消失，直到用户点击才打开聊天面板；可覆盖其他普通气泡
  showBubble('我想和你聊天～', { duration: 0, clickable: true, onClick: openChat });
}

/* ============================================================
   十二·六、聊天面板与对话流程
   ============================================================ */
function openChat() {
  if (chatActive) return;
  hideBubble(); // 收起“我想和你聊天”气泡
  chatActive = true;
  chatNode = CHAT.pickDialogue(); // 随机选一条对话树
  chatTitle.textContent = `和 ${state.pet.name} 聊天`;
  chatBody.innerHTML = '';
  chatPanel.hidden = false;
  chatPanel.classList.remove('show');
  void chatPanel.offsetWidth;
  chatPanel.classList.add('show');
  renderChatTurn(chatNode.opening, chatNode.options);
}

function closeChat() {
  chatPanel.classList.remove('show');
  chatPanel.hidden = true;
  chatActive = false;
  chatNode = null;
}

function appendChatLine(role, text) {
  const line = document.createElement('div');
  line.className = 'chat-line chat-' + role;
  line.textContent = text;
  chatBody.appendChild(line);
  chatBody.scrollTop = chatBody.scrollHeight;
}

// 渲染一轮：追加宠物的话 + 本轮选项按钮
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
  chatBody.appendChild(opts);
  chatBody.scrollTop = chatBody.scrollHeight;
}

// 用户点选某个选项：先锁定本轮按钮，追加回应并应用数值效果，再决定是否进入下一轮
function onChatOption(opt) {
  chatBody.querySelectorAll('.chat-option').forEach((b) => { b.disabled = true; });
  appendChatLine('user', opt.text);
  appendChatLine('pet', opt.reply);

  const r = CHAT.applyEffects(state, opt.effects);
  refreshMood();
  updateStatusPanel();
  persistStatus();
  if (r.levelUp) celebrate(`亲密度升级：${C.levelInfo(state.intimacy).name}！`);

  if (opt.next) {
    chatNode = opt.next;
    setTimeout(() => renderChatTurn(chatNode.opening, chatNode.options), 420);
  } else {
    endChat();
  }
}

// 对话结束：追加告别语，短暂停留后自动关闭
function endChat() {
  appendChatLine('pet', '和你聊天真开心，下次再聊呀～ 👋');
  setTimeout(closeChat, 1800);
}

/* ============================================================
   十三、环形菜单动作：玩耍 / 清洁 / 治疗 / 休息
   ============================================================ */
async function playWithPet() {
  if (state.feeding) return;
  // 用插画粒子（小花/棒棒糖）替代 emoji 爱心
  spawnIllustrationFX(6);
  const msgs = ['好开心！', '再来一次！', '一起玩～'];
  showBubble(msgs[Math.floor(Math.random() * msgs.length)], 2000);
  state.energy = C.clamp(state.energy + 20);
  updateStatusPanel();
  await recordInteraction('play', 3);
}

// 清洁：牙刷 + 星星粒子
async function doClean() {
  if (state.feeding) return;
  const rect = stage.getBoundingClientRect();
  spawnIllustrationFX(6, rect.width / 2, rect.height * 0.4, C.CLEAN_EFFECT_ICONS);
  showBubble('清清爽爽～', 2000);
  await recordInteraction('pet', 1);
}

// 治疗：健康度恢复满；如果本来就健康就说“我很健康”
async function doHeal() {
  if (state.health >= 100) {
    showBubble('我很健康，不用治疗哦～', 2000);
    return;
  }
  state.health = 100;
  sickNotified = false;
  updateStatusPanel();
  celebrate('身体好多了，谢谢！');
  await recordInteraction('pet', 1);
}

// 休息：打盹片刻，恢复精力
async function doRest() {
  if (state.feeding) return;
  playAction('sleep');
  showBubble('小睡一会儿…', 2600);
  state.energy = C.clamp(state.energy + 10);
  updateStatusPanel();
  await recordInteraction('pet', 1);
}

/* ============================================================
   十四、心情
   ============================================================ */
// 心情徽章：用 emotion/ 文件夹图标替换原来的 emoji。
function setMoodIcon(mood) {
  const existing = moodEl.querySelector('img');
  if (existing && existing.dataset.mood === mood) return;
  moodEl.innerHTML = '';
  const img = document.createElement('img');
  img.src = C.assetURL(C.moodIcon(mood));
  img.alt = C.moodInfo(mood).label;
  img.draggable = false;
  img.dataset.mood = mood;
  moodEl.appendChild(img);
}

function refreshMood() {
  const prev = state.mood;
  const mood = C.computeMood(state);
  state.mood = mood;
  for (const m of Object.keys(C.MOOD_INFO)) stage.classList.remove('mood-' + m);
  stage.classList.add('mood-' + mood);
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

/* ============================================================
   十五、点击互动（不同部位不同反应 + 打开菜单/状态）
   ============================================================ */
function detectPart(e) {
  const t = e.target;
  if (t && t.closest) {
    if (t.closest('#pet-head')) return 'head';
    if (t.closest('#pet-tail')) return 'tail';
    if (t.closest('#pet-paw-left') || t.closest('#pet-paw-right')) return 'paw';
  }
  const svg = petSvg.querySelector('svg');
  if (svg) {
    const r = svg.getBoundingClientRect();
    const y = (e.clientY - r.top) / r.height;
    const x = (e.clientX - r.left) / r.width;
    if (y < 0.42) return 'head';
    if (y > 0.72) return x < 0.5 ? 'paw' : 'tail';
  }
  return 'body';
}

function bounce() {
  stage.classList.remove('bounce');
  void stage.offsetWidth;
  stage.classList.add('bounce');
  setTimeout(() => stage.classList.remove('bounce'), 580);
}

function blush() {
  stage.classList.add('blushing');
  setTimeout(() => stage.classList.remove('blushing'), 2000);
}

function petBody(e) {
  bounce();
  blush();
  const rect = stage.getBoundingClientRect();
  spawnIllustrationFX(4, e.clientX - rect.left, e.clientY - rect.top);
  recordInteraction('pet', 1);
}

function petHead(e) {
  bounce();
  stage.classList.add('squint');
  setTimeout(() => stage.classList.remove('squint'), 1200);
  const rect = stage.getBoundingClientRect();
  spawnIllustrationFX(4, e.clientX - rect.left, e.clientY - rect.top);
  showBubble('摸摸头，好舒服～', 1800);
  recordInteraction('pet', 2);
}

function petTail(e) {
  stage.classList.add('tail-touch');
  setTimeout(() => stage.classList.remove('tail-touch'), 700);
  showBubble('尾巴缩了一下～', 1600);
  recordInteraction('pet', 1);
}

function petPaw(e) {
  stage.classList.add('paw-touch');
  setTimeout(() => stage.classList.remove('paw-touch'), 700);
  showBubble('握手手～', 1600);
  recordInteraction('pet', 1);
}

function onStageClick(e) {
  // 点击宠物：先抚摸对应部位，再打开/关闭环形菜单与状态面板
  const part = detectPart(e);
  if (part === 'head') petHead(e);
  else if (part === 'tail') petTail(e);
  else if (part === 'paw') petPaw(e);
  else petBody(e);
  toggleMenuAndStatus();
}

function setupInteractions() {
  stage.addEventListener('click', onStageClick);
}

/* ============================================================
   十六、插画粒子（小花 / 棒棒糖替换 emoji 爱心）
   ============================================================ */
function spawnIllustrationFX(count, x, y, paths) {
  const rect = stage.getBoundingClientRect();
  const cx = typeof x === 'number' ? x : rect.width / 2;
  const cy = typeof y === 'number' ? y : rect.height * 0.45;
  const list = paths || C.PET_EFFECT_ICONS;
  for (let i = 0; i < count; i++) {
    const img = document.createElement('img');
    img.className = 'fx fx-img';
    img.src = C.assetURL(list[Math.floor(Math.random() * list.length)]);
    img.alt = '';
    img.draggable = false;
    // 起始点加入随机偏移，避免所有粒子从同一点挤在一起
    img.style.left = `${cx + (Math.random() - 0.5) * 28}px`;
    img.style.top = `${cy + (Math.random() - 0.5) * 20}px`;
    // 更大的水平/垂直散布范围，让粒子四散飘开
    img.style.setProperty('--dx', `${(Math.random() - 0.5) * 340}px`);
    img.style.setProperty('--dy', `${-60 - Math.random() * 150}px`);
    img.style.setProperty('--rot', `${(Math.random() - 0.5) * 120}deg`);
    img.style.animationDelay = `${Math.random() * 0.12}s`;
    fxLayer.appendChild(img);
    setTimeout(() => img.remove(), 1500);
  }
}

// 生成 emoji 粒子（喝水 / 庆祝等，保留少量 emoji 用于液体/庆祝特效）
function spawnFX(x, y, count = 6, symbols = ['❤️', '💖', '💕', '⭐', '✨', '💗']) {
  for (let i = 0; i < count; i++) {
    const el = document.createElement('span');
    el.className = 'fx';
    el.textContent = symbols[Math.floor(Math.random() * symbols.length)];
    el.style.left = `${x}px`;
    el.style.top = `${y}px`;
    el.style.setProperty('--dx', `${(Math.random() - 0.5) * 120}px`);
    el.style.setProperty('--rot', `${(Math.random() - 0.5) * 60}deg`);
    el.style.fontSize = `${16 + Math.random() * 18}px`;
    el.style.animationDelay = `${Math.random() * 0.1}s`;
    fxLayer.appendChild(el);
    setTimeout(() => el.remove(), 1200);
  }
}

/* ============================================================
   十七、初始化
   ============================================================ */
async function init() {
  const settings = await loadSettings();
  const hour = new Date().getHours();
  greetingEl.textContent = C.greetingForPeriod(hour);
  // 按时间段在问候语后追加早/午/晚餐图标
  const meal = C.mealIconForHour(hour);
  if (meal) {
    const img = document.createElement('img');
    img.className = 'greeting-meal';
    img.src = C.assetURL(meal);
    img.alt = '';
    img.draggable = false;
    greetingEl.appendChild(img);
  }

  const pet = resolvePet(settings);

  // 按宠物加载三态：每只宠物都有自己的饱腹/口渴/精力，切换不再重置
  let petStates = settings.petStates;
  const ps = C.loadPetState(petStates, pet.id);
  C.decayAll(ps);
  petStates = C.stashPetState(petStates, pet.id, ps);

  Object.assign(state, {
    pet,
    petStates,
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

  // 访问问候 + 陪伴天数（更新 lastVisitTime 等）
  const visit = C.onVisit(state);
  refreshMood();
  await persistStatus();

  await renderPet(pet);
  renderFoodPanel(pet);
  buildRingMenu();
  updateAllStatusUI();
  startStatusLoop();
  startActionScheduler();
  startChatScheduler();
  setupInteractions();

  // 聊天面板关闭按钮
  chatClose.addEventListener('click', (e) => {
    e.stopPropagation();
    closeChat();
  });
  // 点击聊天面板内部不冒泡到舞台（避免误触发点击宠物）
  chatPanel.addEventListener('click', (e) => e.stopPropagation());

  // 跨天重置主动聊天计数（避免沿用昨日次数）
  const today = C.dayKey(Date.now());
  if (state.chatTriggerDay !== today) {
    state.chatTriggerDay = today;
    state.chatTriggerCount = 0;
    await persistStatus();
  }

  // 点击食物面板内部不冒泡到舞台（避免误关菜单 / 误触宠物）
  foodPanel.addEventListener('click', (e) => e.stopPropagation());

  // 点击外部关闭环形菜单 / 状态面板 / 食物列表
  document.addEventListener('click', (e) => {
    if (panelOpen && !foodPanel.contains(e.target)) closeFoodPanel();
    if (menuOpen && !stage.contains(e.target)) hideMenuAndStatus();
  });

  // 问候气泡 5 秒后淡出
  showBubble(visit.greeting, 5000);

  // 初始状态低时稍后提示
  if (state.fullness < 30 || state.thirst < 30) setTimeout(checkStatusAlert, 1800);
}

// 当用户在弹窗里勾选/取消勾选小动物时，刷新本页显示新宠物
if (typeof chrome !== 'undefined' && chrome.storage && chrome.storage.onChanged) {
  chrome.storage.onChanged.addListener((changes, area) => {
    if (area === 'local' && changes.selectedPets) {
      location.reload();
    }
  });
}

init();
