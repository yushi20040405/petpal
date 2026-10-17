// ============================================================
// 对话库共享模块 - chat.js
// 新标签页（newtab.js）与悬浮挂件（content.js）共同依赖，
// 通过 window.CHAT 暴露对话库、开场随机与效果应用。
//
// 数据结构（可扩展）：
//   DIALOGUES —— 对话列表，每条代表一个主题的「对话树」：
//     id      唯一标识
//     topic   主题：greeting/mood/food/weather/daily/affection/question
//     label   主题中文名
//     opening 小动物的开场第一句话
//     options 回答选项数组：
//       text    用户可选的回答文字
//       reply   小动物对此回答的回应
//       effects 数值影响（mood 心情加成 / intimacy 亲密度 / energy 精力）
//       next    可选，指向下一轮对话节点（结构与顶层相同，可再往下嵌套，最多 2~3 轮）
// ============================================================

'use strict';

window.CHAT = (() => {
  const C = window.COMPANION;

  /* ---------------- 对话库 ---------------- */
  const DIALOGUES = [
    {
      id: 'greet-1',
      topic: 'greeting',
      label: '问候',
      opening: '今天过得怎么样呀？',
      options: [
        {
          text: '超级棒！一整天都想着你～',
          reply: '嘿嘿，我也最想你了！🥰',
          effects: { mood: 8, intimacy: 5 },
        },
        {
          text: '还行吧，就是有点累…',
          reply: '那快抱抱我充充电～',
          effects: { mood: 4, intimacy: 3 },
          next: {
            opening: '抱抱之后有没有好一点呀？',
            options: [
              { text: '好多啦，你真是小天使', reply: '那我以后天天给你充电！✨', effects: { mood: 6, intimacy: 4 } },
              { text: '还是有点累…', reply: '那今晚早点睡，我会守着你的～', effects: { mood: 3, intimacy: 3 } },
            ],
          },
        },
        {
          text: '不太好…',
          reply: '没关系，说出来会好受一点哦，我听着呢',
          effects: { mood: 2, intimacy: 4 },
        },
        {
          text: '不想说话',
          reply: '（安静地靠过来陪着你）',
          effects: { mood: -2, intimacy: 1 },
        },
      ],
    },
    {
      id: 'mood-1',
      topic: 'mood',
      label: '心情',
      opening: '你最近心情怎么样呀？',
      options: [
        { text: '很好呀', reply: '那我更开心啦！😊', effects: { mood: 6, intimacy: 4 } },
        { text: '一般般', reply: '那我们一起做点开心的事吧～', effects: { mood: 3, intimacy: 2 } },
        { text: '有点低落…', reply: '抱抱你，我会一直陪着你的 💕', effects: { mood: 5, intimacy: 5 } },
      ],
    },
    {
      id: 'food-1',
      topic: 'food',
      label: '食物偏好',
      opening: '你知道我最喜欢吃的是什么吗？',
      options: [
        { text: '你喜欢吃的东西呀～', reply: '猜对啦！你喂的我都记在心里呢 🍽️', effects: { mood: 7, intimacy: 5 } },
        { text: '不知道诶，告诉我嘛', reply: '那下次喂我的时候，注意看我的表情哦～', effects: { mood: 3, intimacy: 2 } },
        { text: '只要是我喂的你都喜欢？', reply: '嘿嘿，被你发现啦！', effects: { mood: 6, intimacy: 4 } },
      ],
    },
    {
      id: 'weather-1',
      topic: 'weather',
      label: '天气',
      opening: '今天天气好舒服呀～',
      options: [
        { text: '是呀，阳光很好', reply: '好想出去晒太阳散步～', effects: { mood: 5, intimacy: 2 } },
        { text: '下雨了，有点闷', reply: '那我们在家里窝着，也很开心呀', effects: { mood: 4, intimacy: 3 } },
        { text: '天气不重要，有你就好', reply: '你嘴真甜～😳', effects: { mood: 8, intimacy: 5 } },
      ],
    },
    {
      id: 'daily-1',
      topic: 'daily',
      label: '日常',
      opening: '你今天都忙什么啦？',
      options: [
        { text: '上班上课，忙死了', reply: '辛苦啦，快摸摸我放松一下～', effects: { mood: 4, intimacy: 3 } },
        { text: '一直在摸鱼等你～', reply: '那我们正好一起玩呀！', effects: { mood: 6, intimacy: 4 } },
        { text: '没啥特别的', reply: '那我现在来给你加一点小惊喜吧 ✨', effects: { mood: 5, intimacy: 3 } },
      ],
    },
    {
      id: 'affection-1',
      topic: 'affection',
      label: '撒娇',
      opening: '可以再陪陪我吗？🥺',
      options: [
        { text: '当然可以呀', reply: '耶！最喜欢你啦！', effects: { mood: 8, intimacy: 5 } },
        { text: '我现在有点忙…', reply: '那好吧…我会乖乖等你的', effects: { mood: -4, intimacy: 1 } },
        { text: '你已经很可爱了', reply: '才没有呢…（脸红）', effects: { mood: 7, intimacy: 5 } },
      ],
    },
    {
      id: 'question-1',
      topic: 'question',
      label: '提问',
      opening: '我可以问你一个问题吗？',
      options: [
        {
          text: '可以呀，问吧',
          reply: '你最喜欢和我一起做什么呀？',
          effects: { mood: 3, intimacy: 2 },
          next: {
            opening: '（期待地看着你）',
            options: [
              { text: '一起玩！', reply: '我也是！一起玩最开心啦～', effects: { mood: 7, intimacy: 4 } },
              { text: '安静地陪着你', reply: '那样也很幸福呢 💕', effects: { mood: 6, intimacy: 4 } },
              { text: '你猜～', reply: '哼，还卖关子！', effects: { mood: 3, intimacy: 3 } },
            ],
          },
        },
        { text: '不行，这是秘密', reply: '小气鬼！', effects: { mood: -2, intimacy: 1 } },
      ],
    },
    {
      id: 'sleep-1',
      topic: 'daily',
      label: '睡觉',
      opening: '你昨晚睡得好吗？',
      options: [
        { text: '睡得可香了', reply: '那真好，我睡得也不错～', effects: { mood: 4, intimacy: 2 } },
        { text: '熬夜了…', reply: '要注意身体呀，我会心疼的', effects: { mood: 3, intimacy: 4 } },
        { text: '想你想得睡不着', reply: '哎呀，那今晚我陪你睡～😴', effects: { mood: 8, intimacy: 5 } },
      ],
    },
    {
      id: 'secret-1',
      topic: 'daily',
      label: '秘密',
      opening: '我偷偷告诉你一个秘密～',
      options: [
        { text: '什么秘密呀？', reply: '其实……我最喜欢的人就是你呀', effects: { mood: 9, intimacy: 6 } },
        { text: '不听不听', reply: '哼，我偏要告诉你！', effects: { mood: 3, intimacy: 2 } },
        { text: '我也有一个秘密', reply: '好呀，你先说！', effects: { mood: 6, intimacy: 4 } },
      ],
    },
  ];

  /* ---------------- 辅助函数 ---------------- */
  // 随机选一条对话树（作为主动聊天的开场）
  function pickDialogue() {
    return DIALOGUES[Math.floor(Math.random() * DIALOGUES.length)];
  }

  // 应用对话选项的数值效果，返回 { levelUp, changed }
  function applyEffects(state, effects) {
    const result = { levelUp: false, changed: false };
    if (!effects) return result;

    // 心情加成：作用于 moodBonus（-30~30），由 companion.computeMood 参与心情判定
    if (typeof effects.mood === 'number') {
      state.moodBonus = C.clampRange((state.moodBonus || 0) + effects.mood, -30, 30);
      result.changed = true;
    }
    // 亲密度：复用 addIntimacy，自动处理等级成长与升级检测
    if (typeof effects.intimacy === 'number') {
      const r = C.addIntimacy(state, effects.intimacy);
      result.levelUp = r.levelUp;
      result.changed = true;
    }
    // 精力：少数选项会补充/消耗精力
    if (typeof effects.energy === 'number') {
      state.energy = C.clamp(state.energy + effects.energy);
      result.changed = true;
    }
    return result;
  }

  return {
    DIALOGUES,
    pickDialogue,
    applyEffects,
  };
})();
