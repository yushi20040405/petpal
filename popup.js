// ============================================================
// 新标签页萌宠伴侣 - popup.js（自由选择版）
// 职责：列出全部 20 只小动物，让用户自由勾选（多选）出现在
//       新标签页中的宠物，并写入 chrome.storage.local。
// ============================================================

'use strict';

const grid = document.getElementById('pet-grid');
const statusEl = document.getElementById('status');
const statsEl = document.getElementById('stats');

let selected = new Set();

/* ---------------- 初始化 ---------------- */
async function init() {
  const data = await chrome.storage.local.get({
    selectedPets: window.PET_LIST.map((p) => p.id),
    showFloatingPet: true,
    doNotDisturb: false,
    proactiveChat: true,
    companionDays: 1,
    intimacy: 0,
  });

  const known = new Set(window.PET_LIST.map((p) => p.id));
  let list = Array.isArray(data.selectedPets)
    ? data.selectedPets.filter((id) => known.has(id))
    : [];
  if (list.length === 0) list = window.PET_LIST.map((p) => p.id);

  selected = new Set(list);

  // 悬浮宠物开关：读回已保存的状态
  const showFloat = document.getElementById('show-float');
  showFloat.checked = data.showFloatingPet !== false;

  // 免打扰开关：读回已保存的状态
  const dnd = document.getElementById('do-not-disturb');
  dnd.checked = data.doNotDisturb === true;

  // 主动聊天开关：读回已保存的状态
  const proactive = document.getElementById('proactive-chat');
  proactive.checked = data.proactiveChat !== false;

  renderStats(data.companionDays, data.intimacy);
  renderGrid();
  updateStatus();
}

/* ---------------- 状态/亲密度展示 ---------------- */
function renderStats(days, intimacy) {
  const lv = window.COMPANION.levelInfo(typeof intimacy === 'number' ? intimacy : 0);
  statsEl.textContent = `相伴第 ${days} 天 · 亲密度 Lv.${lv.level}「${lv.name}」`;
}

/* ---------------- 渲染网格 ---------------- */
function renderGrid() {
  grid.innerHTML = '';
  window.PET_LIST.forEach((pet) => {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'pet-card';
    btn.dataset.pet = pet.id;
    btn.classList.toggle('active', selected.has(pet.id));
    btn.title = pet.name;

    const img = document.createElement('img');
    img.src = pet.src;
    img.alt = pet.name;
    img.draggable = false;

    const name = document.createElement('span');
    name.className = 'name';
    name.textContent = pet.name;

    const check = document.createElement('span');
    check.className = 'check';
    check.textContent = '✓';

    btn.append(img, name, check);
    btn.addEventListener('click', () => toggle(pet.id));
    grid.appendChild(btn);
  });
}

/* ---------------- 切换勾选 ---------------- */
async function toggle(id) {
  if (selected.has(id)) {
    if (selected.size <= 1) {
      updateStatus('至少要保留一只小动物哦');
      return;
    }
    selected.delete(id);
  } else {
    selected.add(id);
  }

  await save();
  const card = grid.querySelector(`.pet-card[data-pet="${id}"]`);
  if (card) card.classList.toggle('active', selected.has(id));
  updateStatus();
}

/* ---------------- 持久化 ---------------- */
async function save() {
  // 选择变更时把 currentPet 置空，让新标签页在“新的选择池”里重新随机一只；
  // 普通刷新（未改选择）则继续沿用已保存的 currentPet，避免刷新后变化。
  await chrome.storage.local.set({ selectedPets: [...selected], currentPet: null });
}

/* ---------------- 状态提示 ---------------- */
function updateStatus(msg) {
  statusEl.textContent = msg || `已选择 ${selected.size} / ${window.PET_LIST.length} 只`;
}

/* ---------------- 全选 / 清空 ---------------- */
document.getElementById('select-all').addEventListener('click', async () => {
  selected = new Set(window.PET_LIST.map((p) => p.id));
  await save();
  renderGrid();
  updateStatus();
});

document.getElementById('clear-all').addEventListener('click', async () => {
  // 清空到只剩第一只（至少保留一只）
  const first = window.PET_LIST[0];
  selected = new Set([first.id]);
  await save();
  renderGrid();
  updateStatus(`已清空，保留「${first.name}」`);
});

// 悬浮宠物开关：写入 chrome.storage.local，content.js 会实时响应
document.getElementById('show-float').addEventListener('change', (e) => {
  chrome.storage.local.set({ showFloatingPet: e.target.checked });
});

// 免打扰开关：写入 chrome.storage.local，newtab/content 会实时响应
document.getElementById('do-not-disturb').addEventListener('change', (e) => {
  chrome.storage.local.set({ doNotDisturb: e.target.checked });
});

// 主动聊天开关：写入 chrome.storage.local，newtab/content 会实时响应
document.getElementById('proactive-chat').addEventListener('change', (e) => {
  chrome.storage.local.set({ proactiveChat: e.target.checked });
});

// 重置陪伴数据：清空亲密度/陪伴天数/累计次数/按宠物三态等，便于重新测试。
// 保留用户的选择与开关设置（selectedPets / currentPet / showFloatingPet / floatPos / floatCollapsed / doNotDisturb）。
document.getElementById('reset-data').addEventListener('click', async () => {
  const keep = ['selectedPets', 'currentPet', 'showFloatingPet', 'floatPos', 'floatCollapsed', 'doNotDisturb'];
  const all = await chrome.storage.local.get(null);
  const toRemove = Object.keys(all).filter((k) => !keep.includes(k));
  if (toRemove.length) await chrome.storage.local.remove(toRemove);
  updateStatus('已重置陪伴数据，刷新页面即可重新开始');
  const cur = await chrome.storage.local.get({ companionDays: 1, intimacy: 0 });
  renderStats(cur.companionDays, cur.intimacy);
});

init();
