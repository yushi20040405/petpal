// ============================================================
// 食物数据共享模块 - food.js
// 新标签页（newtab.js）与悬浮挂件（content.js）共同依赖，
// 通过 window.FOOD_HELPER 暴露食物目录、图标解析与卡片创建。
//
// 每项食物带稳定 id（供食物偏好系统使用）、kind 字段：
//   'food'（食物，增加饱腹度）/'drink'（饮品，增加口渴度）。
//
// 卡片图标一律取自 food/ 与 water/ 文件夹中的 SVG 插画：
//   · 食物（kind='food'）只取 food/ 文件夹图片；
//   · 饮品（kind='drink'）只取 water/ 文件夹图片。
// 部分新增食物（鱼/骨头/肉/胡萝卜/苹果）直接指定专属 icon。
// 运行环境：新标签页脚本 & content script（两者均可用 chrome.runtime）。
// ============================================================

'use strict';

(() => {
  /* ---------------- 图片文件清单 ---------------- */
  // 扩展无法在运行期枚举目录，故显式列出 food/ 与 water/ 两个文件夹下的全部图片。
  const FOOD_FILE_LISTS = {
    food: [
      '樱桃.svg', '葡萄.svg', '西瓜.svg',
      '小蛋糕.svg', '蛋糕.svg', '纸杯蛋糕.svg',
      '冰淇淋.svg', '甜筒.svg',
      '披萨.svg', '拉面.svg', '寿司.svg', '便当.svg',
    ],
    water: [
      '牛奶.svg', '核桃露.svg', '杏仁露.svg', '酸奶.svg',
      '芒果汁.svg', '奶茶.svg', '可乐.svg', '苏打水.svg',
      '中药.svg', '椰汁.svg', '矿泉水.svg', '西瓜汁.svg',
      '番茄汁.svg', '苹果汁.svg', '汽水.svg', '咖啡.svg',
      '啤酒.svg', '柠檬汁.svg',
    ],
  };

  /* ---------------- 文件名 → 展示类型 ---------------- */
  // 用于把「蛋糕/甜点/餐食」等卡片匹配到相应对应图片；匹配不到时从所在文件夹随机取图。
  const FOOD_TYPES = {
    milk:    { keywords: ['牛奶', '核桃露', '杏仁露', '酸奶'] },
    cake:    { keywords: ['蛋糕'] },
    dessert: { keywords: ['冰淇淋', '甜筒'] },
    dish:    { keywords: ['披萨', '拉面', '寿司', '便当'] },
    drink:   { keywords: ['汁', '奶茶', '可乐', '苏打水', '中药', '矿泉水', '汽水', '咖啡', '啤酒'] },
    fruit:   { keywords: ['西瓜', '樱桃', '葡萄'] },
  };

  // 匹配优先级：更具体的类型在前（如“牛奶”先于“饮品”，避免牛奶被归入普通饮品）
  const FOOD_TYPE_ORDER = ['milk', 'cake', 'dessert', 'dish', 'drink', 'fruit'];

  function classifyFile(fileName) {
    const base = fileName.toLowerCase();
    for (const type of FOOD_TYPE_ORDER) {
      if (FOOD_TYPES[type].keywords.some((k) => base.includes(k))) {
        return type;
      }
    }
    return null;
  }

  // 建立 “文件夹 → 类型 → 图片路径列表”（图片路径已带 folder/ 前缀）
  const IMAGES_BY_FOLDER = { food: {}, water: {} };
  Object.keys(FOOD_FILE_LISTS).forEach((folder) => {
    const map = (IMAGES_BY_FOLDER[folder] = {});
    FOOD_FILE_LISTS[folder].forEach((file) => {
      const type = classifyFile(file) || 'other';
      if (!map[type]) map[type] = [];
      map[type].push(`${folder}/${file}`);
    });
  });

  /* ---------------- 食物目录（含稳定 id，供偏好系统使用） ---------------- */
  // 字段说明：
  //   id   —— 稳定标识，食物偏好 foodPreferences 以此作为键；
  //   name —— 展示名；
  //   kind —— 'food'（饱腹）/ 'drink'（口渴）；
  //   type —— 图片匹配类型（用于从文件夹选图）；
  //   icon —— 可选，专属图标路径；不填则按 type 从对应文件夹随机选图。
  const FOODS = {
    // —— 食物（增加饱腹度）——
    fish:       { id: 'fish',       name: '小鱼',    kind: 'food',  type: 'fish',      icon: 'food/鱼.svg' },
    bone:       { id: 'bone',       name: '骨头',    kind: 'food',  type: 'bone',      icon: 'food/骨头.svg' },
    meat:       { id: 'meat',       name: '肉肉',    kind: 'food',  type: 'meat',      icon: 'food/肉.svg' },
    carrot:     { id: 'carrot',     name: '胡萝卜',  kind: 'food',  type: 'vegetable', icon: 'food/胡萝卜.svg' },
    apple:      { id: 'apple',      name: '苹果',    kind: 'food',  type: 'fruit',     icon: 'food/苹果.svg' },
    cherry:     { id: 'cherry',     name: '樱桃',    kind: 'food',  type: 'fruit',     icon: 'food/樱桃.svg' },
    grape:      { id: 'grape',      name: '葡萄',    kind: 'food',  type: 'fruit',     icon: 'food/葡萄.svg' },
    watermelon: { id: 'watermelon', name: '西瓜',    kind: 'food',  type: 'fruit',     icon: 'food/西瓜.svg' },
    cake:       { id: 'cake',       name: '蛋糕',    kind: 'food',  type: 'cake',      icon: 'food/蛋糕.svg' },
    cupcake:    { id: 'cupcake',    name: '纸杯蛋糕', kind: 'food', type: 'cake',      icon: 'food/纸杯蛋糕.svg' },
    smallcake:  { id: 'smallcake',  name: '小蛋糕',  kind: 'food',  type: 'cake',      icon: 'food/小蛋糕.svg' },
    icecream:   { id: 'icecream',   name: '冰淇淋',  kind: 'food',  type: 'dessert',   icon: 'food/冰淇淋.svg' },
    cone:       { id: 'cone',       name: '甜筒',    kind: 'food',  type: 'dessert',   icon: 'food/甜筒.svg' },
    pizza:      { id: 'pizza',      name: '披萨',    kind: 'food',  type: 'dish',      icon: 'food/披萨.svg' },
    ramen:      { id: 'ramen',      name: '拉面',    kind: 'food',  type: 'dish',      icon: 'food/拉面.svg' },
    sushi:      { id: 'sushi',      name: '寿司',    kind: 'food',  type: 'dish',      icon: 'food/寿司.svg' },
    bento:      { id: 'bento',      name: '便当',    kind: 'food',  type: 'dish',      icon: 'food/便当.svg' },
    // —— 饮品（增加口渴度）——
    milk:       { id: 'milk',       name: '牛奶',    kind: 'drink', type: 'milk',      icon: 'water/牛奶.svg' },
    walnut:     { id: 'walnut',     name: '核桃露',  kind: 'drink', type: 'milk',      icon: 'water/核桃露.svg' },
    almond:     { id: 'almond',     name: '杏仁露',  kind: 'drink', type: 'milk',      icon: 'water/杏仁露.svg' },
    yogurt:     { id: 'yogurt',     name: '酸奶',    kind: 'drink', type: 'milk',      icon: 'water/酸奶.svg' },
    mango:      { id: 'mango',      name: '芒果汁',  kind: 'drink', type: 'drink',     icon: 'water/芒果汁.svg' },
    milktea:    { id: 'milktea',    name: '奶茶',    kind: 'drink', type: 'drink',     icon: 'water/奶茶.svg' },
    cola:       { id: 'cola',       name: '可乐',    kind: 'drink', type: 'drink',     icon: 'water/可乐.svg' },
    soda:       { id: 'soda',       name: '苏打水',  kind: 'drink', type: 'drink',     icon: 'water/苏打水.svg' },
    medicine:   { id: 'medicine',   name: '中药',    kind: 'drink', type: 'drink',     icon: 'water/中药.svg' },
    coconut:    { id: 'coconut',    name: '椰汁',    kind: 'drink', type: 'drink',     icon: 'water/椰汁.svg' },
    water:      { id: 'water',      name: '矿泉水',  kind: 'drink', type: 'drink',     icon: 'water/矿泉水.svg' },
    watermelonjuice: { id: 'watermelonjuice', name: '西瓜汁', kind: 'drink', type: 'drink', icon: 'water/西瓜汁.svg' },
    tomatojuice: { id: 'tomatojuice', name: '番茄汁', kind: 'drink', type: 'drink',    icon: 'water/番茄汁.svg' },
    applejuice: { id: 'applejuice', name: '苹果汁',  kind: 'drink', type: 'drink',     icon: 'water/苹果汁.svg' },
    sparkle:    { id: 'sparkle',    name: '汽水',    kind: 'drink', type: 'drink',     icon: 'water/汽水.svg' },
    coffee:     { id: 'coffee',     name: '咖啡',    kind: 'drink', type: 'drink',     icon: 'water/咖啡.svg' },
    beer:       { id: 'beer',       name: '啤酒',    kind: 'drink', type: 'drink',     icon: 'water/啤酒.svg' },
    lemon:      { id: 'lemon',      name: '柠檬汁',  kind: 'drink', type: 'drink',     icon: 'water/柠檬汁.svg' },
  };

  /* ---------------- 各宠物对应食物（引用食物 id） ---------------- */
  // 猫：小鱼/牛奶（喜欢）+ 水果（讨厌）+ 奶茶/蛋糕（普通）
  // 狗：骨头/肉（喜欢）+ 中药（讨厌）+ 披萨/苏打水（普通）
  // 兔：胡萝卜/苹果（喜欢）+ 牛奶（讨厌）+ 樱桃/矿泉水（普通）
  const FOODS_BY_PET = {
    xiaomao:  ['fish', 'milk', 'apple', 'cherry', 'watermelon', 'milktea', 'cake'],
    xiaogou:  ['bone', 'meat', 'medicine', 'pizza', 'soda', 'cherry'],
    tianyuan: ['bone', 'meat', 'pizza', 'soda', 'cherry', 'water'],
    xiaotuzi: ['carrot', 'apple', 'milk', 'cherry', 'water', 'cake'],
  };

  // 其它宠物使用默认食物（均有 food/ 或 water/ 下的图片）
  const DEFAULT_FOOD_IDS = ['cherry', 'cake', 'icecream', 'pizza', 'water', 'milktea'];

  function getFood(id) {
    return FOODS[id] || null;
  }

  function getFoods(petId) {
    const ids = FOODS_BY_PET[petId] || DEFAULT_FOOD_IDS;
    return ids.map(getFood).filter(Boolean);
  }

  /* ---------------- 图片选取 ---------------- */
  function pickRandom(arr) {
    return arr[Math.floor(Math.random() * arr.length)];
  }

  // 根据 kind 决定从哪个文件夹取图：饮品只取 water/，食物只取 food/。
  // type 精确匹配不到时，从该文件夹全部图片里随机一张，保证卡片始终有真实插画。
  function pickFoodImage(type, kind) {
    const folder = kind === 'drink' ? 'water' : 'food';
    const byType = IMAGES_BY_FOLDER[folder][type];
    if (byType && byType.length) return pickRandom(byType);
    return `${folder}/${pickRandom(FOOD_FILE_LISTS[folder])}`;
  }

  // 解析某食物的图标 URL（未提供专属 icon 时按 type/kind 随机选图）
  function foodIconURL(food) {
    if (food.icon) return chrome.runtime.getURL(food.icon);
    return chrome.runtime.getURL(pickFoodImage(food.type, food.kind));
  }

  /* ---------------- 卡片创建 ---------------- */
  // 创建单个食物/饮品卡片：图标 + 名称 + 「食/饮」角标。
  // 不绑定点击事件，由调用方决定投喂逻辑；通过 data-kind / data-id 区分。
  function createFoodCard(food) {
    const card = document.createElement('button');
    card.type = 'button';
    card.className = 'food-card';
    card.title = food.name;

    const kind = food.kind || 'food';
    card.dataset.kind = kind;   // 供投喂逻辑判断增加哪个状态
    card.dataset.id = food.id;  // 供食物偏好系统判断喜好等级

    const icon = document.createElement('span');
    icon.className = 'food-card-icon';

    const img = document.createElement('img');
    img.src = foodIconURL(food);
    img.alt = food.name;
    img.draggable = false;
    icon.appendChild(img);

    const label = document.createElement('span');
    label.className = 'food-card-name';
    label.textContent = food.name;

    // 小角标：饮（蓝）/ 食（橙），视觉上区分两类
    const badge = document.createElement('span');
    badge.className = 'food-card-badge';
    badge.textContent = kind === 'drink' ? '饮' : '食';

    card.append(icon, label, badge);
    return card;
  }

  window.FOOD_HELPER = {
    FOOD_FILE_LISTS,
    FOODS,
    FOODS_BY_PET,
    DEFAULT_FOOD_IDS,
    getFood,
    getFoods,
    FOOD_TYPES,
    pickFoodImage,
    foodIconURL,
    createFoodCard,
  };
})();
