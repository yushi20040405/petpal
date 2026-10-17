// ============================================================
// 陪伴系统共享模块 - companion.js
// 新标签页（newtab.js）与悬浮挂件（content.js）共同依赖，
// 统一维护状态默认值、随时间衰减、心情计算、时间问候、
// 随机小动作与亲密度成长，避免两端逻辑不一致。
// 通过 window.COMPANION 暴露。
//
// 状态分两层：
//   · 全局状态（所有宠物共享）：亲密度 intimacy、陪伴天数 companionDays、
//     累计喂食/喂水/玩耍/抚摸次数、已解锁配饰 unlocked、免打扰 doNotDisturb。
//   · 按宠物状态（petStates[petId]）：饱腹 fullness、口渴 thirst、精力 energy、
//     以及各自的上次喂食/互动时间。切换宠物时各自的三态互不影响。
//
// 仅读取时间与互动状态，不读取任何用户浏览内容，保护隐私。
// ============================================================

'use strict';

window.COMPANION = (() => {
  const HOUR = 3600000;
  const MIN = 60000;

  /* ---------------- 状态默认值 ---------------- */
  const DEFAULTS = {
    fullness: 50,             // 饱腹度 0~100（旧版扁平字段，仅用于迁移）
    thirst: 50,               // 口渴度 0~100（旧版扁平字段，仅用于迁移）
    energy: 80,               // 精力/活力 0~100（旧版扁平字段，仅用于迁移）
    intimacy: 0,              // 亲密度 0~100（全局）
    health: 100,              // 健康度 0~100（全局；<100 表示生病，可治疗）
    mood: 'normal',           // 心情（缓存，实际每次由 computeMood 重算）
    lastFedTime: null,        // 上次喂食/喂水时间（旧版扁平字段，仅用于迁移）
    lastInteractTime: null,   // 上次任意互动时间（旧版扁平字段，仅用于迁移）
    lastVisitTime: null,      // 上次打开页面时间（全局）
    lastVisitDay: null,       // 上次打开页面的日期键（陪伴天数去重）
    companionDays: 1,         // 陪伴天数（全局）
    feedCount: 0,             // 累计喂食次数
    drinkCount: 0,            // 累计喂水次数
    playCount: 0,             // 累计玩耍次数
    petCount: 0,              // 累计抚摸次数
    doNotDisturb: false,      // 免打扰开关
    unlocked: [],             // 已解锁的配饰 emoji
    proactiveChat: true,      // 主动聊天开关（可在 popup 关闭）
    chatTriggerDay: null,     // 主动聊天：当天日期键（用于每日次数重置）
    chatTriggerCount: 0,      // 主动聊天：当天已触发次数
    foodPreferences: {},      // 食物偏好 { [宠物类型]: { [食物id]: 'like'|'neutral'|'dislike' } }
    moodBonus: 0,             // 心情加成（聊天/喂食偏好带来的情绪偏移，范围 -30~30）
    petStates: {},            // 按宠物分别存储的三态 { [petId]: {fullness,thirst,energy,lastFedTime,lastInteractTime} }
  };

  /* ---------------- 按宠物分别存储三态 ---------------- */
  // 一只全新宠物的初始三态（饱腹/口渴/精力 + 衰减计时起点）
  function newPetState() {
    return { fullness: 50, thirst: 50, energy: 80, lastFedTime: Date.now(), lastInteractTime: Date.now() };
  }

  // 读取某只宠物的三态；不存在则返回初始值
  function loadPetState(petStates, petId) {
    const st = (petStates && petStates[petId]) || null;
    if (!st) return newPetState();
    const num = (v, d) => (typeof v === 'number' ? clamp(v) : d);
    return {
      fullness: num(st.fullness, 50),
      thirst: num(st.thirst, 50),
      energy: num(st.energy, 80),
      lastFedTime: typeof st.lastFedTime === 'number' ? st.lastFedTime : null,
      lastInteractTime: typeof st.lastInteractTime === 'number' ? st.lastInteractTime : null,
    };
  }

  // 把当前宠物最新三态写回 petStates，返回更新后的对象（不落盘，由调用方持久化）
  function stashPetState(petStates, petId, s) {
    const out = { ...(petStates || {}) };
    out[petId] = {
      fullness: clamp(s.fullness),
      thirst: clamp(s.thirst),
      energy: clamp(s.energy),
      lastFedTime: s.lastFedTime,
      lastInteractTime: s.lastInteractTime,
    };
    return out;
  }

  // 旧版把三态存在扁平键里；升级后首次运行时把旧数据迁入 petStates（只跑一次）
  function migratePetStates(petStates, legacy) {
    if (petStates && Object.keys(petStates).length) return petStates;
    const out = { ...(petStates || {}) };
    const id = legacy && legacy.currentPet;
    if (id) {
      const num = (v, d) => (typeof v === 'number' ? v : d);
      out[id] = {
        fullness: num(legacy.fullness, 50),
        thirst: num(legacy.thirst, 50),
        energy: num(legacy.energy, 80),
        lastFedTime: typeof legacy.lastFedTime === 'number' ? legacy.lastFedTime : null,
        lastInteractTime: typeof legacy.lastInteractTime === 'number' ? legacy.lastInteractTime : null,
      };
    }
    return out;
  }

  /* ---------------- 时间感知 ---------------- */
  // 时间段：早上 6-9 / 上午 9-12 / 下午 12-18 / 晚上 18-23 / 深夜 23-6
  function timePeriod(hour) {
    if (hour >= 6 && hour < 9) return 'morning';
    if (hour >= 9 && hour < 12) return 'forenoon';
    if (hour >= 12 && hour < 18) return 'afternoon';
    if (hour >= 18 && hour < 23) return 'evening';
    return 'night';
  }

  const GREETING_BY_PERIOD = {
    morning:   '早上好～今天也要元气满满哦 ☀️',
    forenoon:  '上午好呀～',
    afternoon: '下午好，记得喝水休息一下～',
    evening:   '晚上好～',
    night:     '夜深了，早点休息哦 🌙',
  };

  function greetingForPeriod(hour) {
    return GREETING_BY_PERIOD[timePeriod(hour)];
  }

  /* ---------------- 数值工具 ---------------- */
  function clamp(v) {
    return Math.max(0, Math.min(100, Math.round(v)));
  }

  // 通用区间钳制（用于心情加成等非 0~100 的数值）
  function clampRange(v, min, max) {
    if (typeof v !== 'number') v = min;
    return Math.max(min, Math.min(max, v));
  }

  // 随时间衰减：距离 timestamp 每过 perHours 小时 -delta
  function applyDecay(value, timestamp, perHours = 1, delta = 5) {
    if (!timestamp || typeof value !== 'number') return value;
    const steps = Math.floor((Date.now() - timestamp) / (perHours * HOUR));
    return steps > 0 ? Math.max(0, value - steps * delta) : value;
  }

  // 心情加成随时间缓慢回归 0（情绪会平复，避免永远停留在开心/生气）
  function decayMoodBonus(s) {
    if (typeof s.moodBonus !== 'number') { s.moodBonus = 0; return false; }
    const before = s.moodBonus;
    if (s.moodBonus > 0) s.moodBonus = Math.max(0, s.moodBonus - 2);
    else if (s.moodBonus < 0) s.moodBonus = Math.min(0, s.moodBonus + 2);
    return s.moodBonus !== before;
  }

  // 就地衰减三项状态与心情加成，返回是否有变化（供调用方决定是否持久化）
  function decayAll(s) {
    const before = `${s.fullness}|${s.thirst}|${s.energy}|${s.moodBonus || 0}`;
    s.fullness = Math.round(applyDecay(s.fullness, s.lastFedTime, 1, 5));
    s.thirst = Math.round(applyDecay(s.thirst, s.lastFedTime, 1, 5));
    s.energy = Math.round(applyDecay(s.energy, s.lastInteractTime, 2, 5)); // 每 2 小时 -5
    decayMoodBonus(s);
    return before !== `${s.fullness}|${s.thirst}|${s.energy}|${s.moodBonus || 0}`;
  }

  /* ---------------- 心情 ---------------- */
  const MOOD_INFO = {
    happy:   { emoji: '😊', label: '开心', bubble: '今天心情超好～' },
    normal:  { emoji: '🙂', label: '普通', bubble: '今天也要加油哦～' },
    hungry:  { emoji: '😋', label: '饿',   bubble: '肚子咕咕叫了…' },
    thirsty: { emoji: '🥤', label: '渴',   bubble: '喉咙好干呀…' },
    sleepy:  { emoji: '😴', label: '困',   bubble: '好困呀，想睡觉…' },
    bored:   { emoji: '🥱', label: '无聊', bubble: '陪我玩一会儿吧～' },
    angry:   { emoji: '😾', label: '生气', bubble: '你是不是把我忘了…' },
  };

  // 心情判定顺序：饿/渴 > 困 > 心情加成（开心/生气）> 生气 > 无聊 > 开心 > 普通
  function computeMood(s, now = Date.now()) {
    const idle = s.lastInteractTime ? now - s.lastInteractTime : 0;
    if (s.fullness < 30 || s.thirst < 30) {
      return s.thirst < s.fullness ? 'thirsty' : 'hungry';
    }
    if (s.energy < 30) return 'sleepy';
    // 心情加成：聊天/喂食偏好带来的情绪偏移（-30~30）
    const bonus = typeof s.moodBonus === 'number' ? s.moodBonus : 0;
    if (bonus <= -15) return 'angry';
    if (bonus >= 15) return 'happy';
    if (s.lastInteractTime && idle > 24 * HOUR) return 'angry';
    if (s.lastInteractTime && idle > 2 * HOUR) return 'bored';
    if (s.fullness >= 60 && s.thirst >= 60 && s.energy >= 60 &&
        (!s.lastInteractTime || idle <= 30 * MIN)) {
      return 'happy';
    }
    return 'normal';
  }

  function moodInfo(mood) {
    return MOOD_INFO[mood] || MOOD_INFO.normal;
  }

  /* ---------------- 生病机制 ---------------- */
  // 健康度 health 为全局状态（0~100，<100 表示“生病”，可治疗恢复）。
  // 饱腹 / 口渴 / 精力三者长期都极低时健康度下降；状态好转后缓慢自愈。
  function applySickness(s) {
    const before = s.health;
    if (s.fullness < 15 && s.thirst < 15 && s.energy < 15) {
      s.health = clamp(s.health - 4);          // 严重疏于照料 → 生病
    } else if (s.fullness >= 55 && s.thirst >= 55 && s.energy >= 55) {
      s.health = clamp(s.health + 2);          // 状态良好 → 缓慢自愈
    }
    return s.health !== before;
  }

  /* ---------------- 随机小动作（随亲密度等级解锁） ---------------- */
  // unlock = 该动作在第几级解锁；低级只做基础动作，亲密度越高动作越丰富。
  const ACTIONS = [
    { key: 'yawn',    label: '打哈欠', unlock: 1 },
    { key: 'look',    label: '看鼠标', unlock: 1 },
    { key: 'sleep',   label: '打盹',   unlock: 1 },
    { key: 'stretch', label: '伸懒腰', unlock: 2 },
    { key: 'wag',     label: '摇尾巴', unlock: 3 },
    { key: 'edge',    label: '散步',   unlock: 5 },
  ];

  // 在当前等级可用的动作里随机挑一个
  function pickAction(level = 5) {
    const pool = ACTIONS.filter((a) => a.unlock <= level);
    return pool[Math.floor(Math.random() * pool.length)] || ACTIONS[0];
  }

  /* ---------------- 亲密度与成长 ---------------- */
  // lines：该等级解锁的走心文案（随机寒暄）。
  const LEVELS = [
    { level: 1, threshold: 0,   name: '初识', lines: ['……', '（安静地看着你）'] },
    { level: 2, threshold: 20,  name: '熟悉', lines: ['今天过得怎么样？', '你来了呀～'] },
    { level: 3, threshold: 45,  name: '亲密', lines: ['最喜欢你啦！', '抱抱～'] },
    { level: 4, threshold: 70,  name: '挚友', lines: ['有你在真好', '我会一直陪着你'] },
    { level: 5, threshold: 100, name: '家人', lines: ['我们是一家人呀', '谢谢你一直陪着我'] },
  ];

  function levelInfo(score) {
    let cur = LEVELS[0];
    for (const l of LEVELS) if (score >= l.threshold) cur = l;
    return cur;
  }

  // 按亲密度返回一句随机“走心话”
  function randomLine(score) {
    const info = levelInfo(score);
    const lines = info.lines && info.lines.length ? info.lines : ['……'];
    return lines[Math.floor(Math.random() * lines.length)];
  }

  // 增加亲密度；返回是否升级
  function addIntimacy(s, amount) {
    const before = levelInfo(s.intimacy).level;
    s.intimacy = clamp(s.intimacy + amount);
    const after = levelInfo(s.intimacy).level;
    const info = levelInfo(s.intimacy);
    return { levelUp: after > before, level: info.level, name: info.name };
  }

  /* ---------------- 功能菜单图标映射（来自 onther/ 与 emotion/ 插画） ---------------- */
  // 环形菜单的六个功能按钮：
  //   喂食：宠粮主食；喂水：食具水具；玩耍：玩具逗宠；
  //   清洁：如厕清洁；治疗：绝育手术；休息：窝垫笼舍。
  const ACTION_ICONS = [
    { act: 'feed',  icon: 'onther/宠粮主食.svg', label: '喂食' },
    { act: 'drink', icon: 'onther/食具水具.svg', label: '喂水' },
    { act: 'play',  icon: 'onther/玩具逗宠.svg', label: '玩耍' },
    { act: 'clean', icon: 'onther/如厕清洁.svg', label: '清洁' },
    { act: 'heal',  icon: 'onther/绝育手术.svg', label: '治疗' },
    { act: 'rest',  icon: 'onther/窝垫笼舍.svg', label: '休息' },
  ];

  // 抚摸/玩耍时飘出的插画粒子（小花 / 棒棒糖）
  const PET_EFFECT_ICONS = ['onther/花花.svg', 'onther/棒棒糖.svg'];

  // 清洁（洗澡）时飘出的插画粒子（牙刷 + 星星）
  const CLEAN_EFFECT_ICONS = ['emotion/牙刷.svg', 'onther/星星.svg'];

  // 喂食/喂水后飘出的插画粒子（蝴蝶结 + 洗澡）
  const FEED_EFFECT_ICONS = ['onther/蝴蝶结.svg', 'onther/洗澡.svg'];

  // 心情 → emotion/ 文件夹图标映射（替换原 emoji 心情徽章）
  const MOOD_ICONS = {
    happy:   'emotion/开心.svg',
    normal:  'emotion/挑眉.svg',
    hungry:  'emotion/皱眉.svg',
    thirsty: 'emotion/不开心.svg',
    sleepy:  'emotion/无语.svg',
    bored:   'emotion/伤心.svg',
    angry:   'emotion/愤怒.svg',
  };

  function moodIcon(mood) {
    return MOOD_ICONS[mood] || MOOD_ICONS.normal;
  }

  // 根据小时返回餐点图标（用于问候气泡，早/午/晚餐）；深夜返回 null（不加图标）
  function mealIconForHour(hour) {
    if (hour >= 6 && hour < 11) return 'onther/早餐.svg';
    if (hour >= 11 && hour < 17) return 'onther/午餐.svg';
    if (hour >= 17 && hour < 23) return 'onther/晚餐.svg';
    return null;
  }

  // 把扩展内相对路径转成可用 URL（新标签页 / content script 都能用）
  function assetURL(path) {
    if (typeof chrome !== 'undefined' && chrome.runtime && chrome.runtime.getURL) {
      return chrome.runtime.getURL(path);
    }
    return path;
  }

  // 构建环形菜单按钮（图标 + 文字标签），供 newtab / content 复用。
  // iconOverrides：可选的 { act: 图标路径 }，供某些端覆盖默认图标（如悬浮层的喂食按钮）。
  // acts：可选的功能键数组（如 ['feed','drink']），只生成这些按钮；省略则生成全部。
  // 返回按钮片段（不含外层容器），由调用方挂到自己的 .ring-menu 容器里，
  // 避免出现「容器嵌套容器」导致 :not(.show) 选择器误命中。
  function buildRingMenu(iconOverrides = {}, acts = null) {
    const frag = document.createDocumentFragment();
    const items = acts ? ACTION_ICONS.filter((a) => acts.includes(a.act)) : ACTION_ICONS;
    items.forEach((item, i) => {
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'ring-btn';
      btn.dataset.act = item.act;
      btn.title = item.label;
      btn.style.setProperty('--i', i);
      const inner = document.createElement('span');
      inner.className = 'ring-btn-inner';
      const img = document.createElement('img');
      img.src = assetURL(iconOverrides[item.act] || item.icon);
      img.alt = item.label;
      img.draggable = false;
      const label = document.createElement('span');
      label.className = 'ring-label';
      label.textContent = item.label;
      // 圆形图标按钮（inner）+ 下方文字标签（label）并列，便于 CSS 分别定位
      inner.appendChild(img);
      btn.append(inner, label);
      frag.appendChild(btn);
    });
    return frag;
  }

  /* ---------------- 访问问候 ---------------- */
  function dayKey(ts) {
    const d = new Date(ts);
    return `${d.getFullYear()}-${d.getMonth() + 1}-${d.getDate()}`;
  }

  // 打开页面时调用：更新陪伴天数 / 上次访问时间，返回要显示的问候语。
  // 问候优先级：首次 → 新的一天 → 离开超 6 小时 → 按时间段。
  function onVisit(s, now = Date.now()) {
    const res = { greeting: '', isNewDay: false };
    const today = dayKey(now);
    if (!s.lastVisitTime) {
      s.companionDays = 1;
      s.lastVisitDay = today;
      res.greeting = '这是我们相伴的第 1 天 💕';
      res.isNewDay = true;
    } else if (s.lastVisitDay !== today) {
      s.companionDays = (s.companionDays || 1) + 1;
      s.lastVisitDay = today;
      res.greeting = `这是我们相伴的第 ${s.companionDays} 天 💕`;
      res.isNewDay = true;
    } else if (now - s.lastVisitTime > 6 * HOUR) {
      res.greeting = '你回来啦，我好想你！';
      // 亲密度较高时，追加一句走心的话
      if (levelInfo(s.intimacy).level >= 3) {
        res.greeting += ' ' + randomLine(s.intimacy);
      }
    } else {
      res.greeting = greetingForPeriod(new Date(now).getHours());
    }
    s.lastVisitTime = now;
    return res;
  }

  return {
    DEFAULTS,
    HOUR,
    MIN,
    newPetState,
    loadPetState,
    stashPetState,
    migratePetStates,
    timePeriod,
    greetingForPeriod,
    clamp,
    applyDecay,
    decayAll,
    decayMoodBonus,
    computeMood,
    moodInfo,
    MOOD_INFO,
    applySickness,
    pickAction,
    ACTIONS,
    addIntimacy,
    levelInfo,
    randomLine,
    LEVELS,
    ACTION_ICONS,
    PET_EFFECT_ICONS,
    CLEAN_EFFECT_ICONS,
    FEED_EFFECT_ICONS,
    MOOD_ICONS,
    moodIcon,
    mealIconForHour,
    assetURL,
    buildRingMenu,
    onVisit,
    dayKey,
    clampRange,
  };
})();
