// ============================================================
// 食物偏好共享模块 - preferences.js
// 新标签页（newtab.js）、悬浮挂件（content.js）、设置弹窗（popup.js）共同依赖，
// 通过 window.PREFS 暴露宠物类型映射、默认偏好、偏好解析与喂食反应。
//
// 偏好等级：'like'（喜欢）/ 'neutral'（普通）/ 'dislike'（讨厌）。
// 存储结构 foodPreferences（chrome.storage.local）：
//   { [宠物类型]: { [食物id]: 'like' | 'neutral' | 'dislike' } }
// 解析优先级：已保存的用户调整 > 该类型默认预设 > neutral。
// ============================================================

'use strict';

window.PREFS = (() => {
  /* ---------------- 宠物 → 类型映射 ---------------- */
  // 其余宠物归为 'other'，无特殊默认偏好（全部 neutral）。
  const PET_TYPES = {
    xiaomao: 'cat',
    xiaogou: 'dog',
    tianyuan: 'dog',
    xiaotuzi: 'rabbit',
  };

  /* ---------------- 各类型默认偏好 ---------------- */
  // 猫：喜欢鱼、牛奶；讨厌水果（及水果类果汁）。
  // 狗：喜欢骨头、肉；讨厌中药。
  // 兔子：喜欢胡萝卜、苹果；讨厌牛奶。
  const DEFAULT_PREFERENCES = {
    cat: {
      fish: 'like', milk: 'like',
      apple: 'dislike', cherry: 'dislike', grape: 'dislike',
      watermelon: 'dislike', applejuice: 'dislike', watermelonjuice: 'dislike',
    },
    dog: {
      bone: 'like', meat: 'like',
      medicine: 'dislike',
    },
    rabbit: {
      carrot: 'like', apple: 'like',
      milk: 'dislike',
    },
    other: {},
  };

  /* ---------------- 偏好等级 → 喂食反应 ---------------- */
  // mood：心情加成（作用于 moodBonus）；intimacy：亲密度增减；
  // gain：饱腹/口渴度的增量（讨厌时为 0，即不增加）。
  const FEED_REACTIONS = {
    like:    { bubble: '好好吃！最喜欢这个了～', mood: 15, intimacy: 5,  gain: 20 },
    neutral: { bubble: '谢谢～',                  mood: 5,  intimacy: 2,  gain: 20 },
    dislike: { bubble: '我不喜欢这个…',           mood: -5, intimacy: 0,  gain: 0 },
  };

  // 中药类饮品的特殊反应：苦脸，但健康值提升
  const MEDICINE_BUBBLE = '好苦…但为了健康我会喝下去 🥺';
  const MEDICINE_HEALTH_GAIN = 15;

  function petTypeOf(petId) {
    return PET_TYPES[petId] || 'other';
  }

  // 解析某宠物类型对某食物的偏好（已保存 > 默认预设 > neutral）
  function resolvePreference(foodPreferences, petType, foodId) {
    const saved = foodPreferences && foodPreferences[petType] && foodPreferences[petType][foodId];
    if (saved) return saved;
    const preset = DEFAULT_PREFERENCES[petType] || {};
    if (preset[foodId]) return preset[foodId];
    return 'neutral';
  }

  // 生成某宠物类型对应的完整预设对象（供 popup“恢复默认”使用）
  function presetFor(petType) {
    return { ...(DEFAULT_PREFERENCES[petType] || {}) };
  }

  function isMedicine(foodId) {
    return foodId === 'medicine';
  }

  /* ---------------- 供 popup 编辑的食物清单 ---------------- */
  // 每个类型下值得让用户手动调整的食物 id（对应默认偏好 + 少量常见项）。
  const EDITABLE_FOODS = {
    cat: ['fish', 'milk', 'apple', 'cherry', 'watermelon'],
    dog: ['bone', 'meat', 'medicine', 'milk'],
    rabbit: ['carrot', 'apple', 'milk'],
  };

  return {
    PET_TYPES,
    DEFAULT_PREFERENCES,
    FEED_REACTIONS,
    MEDICINE_BUBBLE,
    MEDICINE_HEALTH_GAIN,
    petTypeOf,
    resolvePreference,
    presetFor,
    isMedicine,
    EDITABLE_FOODS,
  };
})();
