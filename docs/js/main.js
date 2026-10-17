/* ============================================================
   萌宠伴侣 · 官网交互脚本
   功能：
   1. 移动端汉堡菜单展开 / 收起
   2. 滚动后导航栏吸顶毛玻璃效果
   3. 滚动监听高亮当前区块（scroll-spy）
   4. IntersectionObserver 滚动进入视口淡入上移
   5. 平滑锚点跳转（配合 CSS scroll-behavior，这里做移动端菜单收起）
   ============================================================ */

'use strict';

document.addEventListener('DOMContentLoaded', () => {
  const header = document.getElementById('site-header');
  const navToggle = document.getElementById('nav-toggle');
  const siteNav = document.getElementById('site-nav');

  /* ---------- 1. 汉堡菜单 ---------- */
  navToggle.addEventListener('click', () => {
    const open = siteNav.classList.toggle('is-open');
    navToggle.classList.toggle('is-open', open);
    navToggle.setAttribute('aria-expanded', String(open));
    navToggle.setAttribute('aria-label', open ? '关闭菜单' : '打开菜单');
  });

  // 点击导航链接后收起移动端菜单
  siteNav.querySelectorAll('.nav-link').forEach((link) => {
    link.addEventListener('click', () => {
      siteNav.classList.remove('is-open');
      navToggle.classList.remove('is-open');
      navToggle.setAttribute('aria-expanded', 'false');
    });
  });

  /* ---------- 2. 导航栏吸顶毛玻璃 ---------- */
  const onScroll = () => {
    header.classList.toggle('is-scrolled', window.scrollY > 12);
  };
  onScroll();
  window.addEventListener('scroll', onScroll, { passive: true });

  /* ---------- 3. 滚动高亮当前区块（scroll-spy） ---------- */
  // 目标区块 id 与导航链接 href 对应
  const sections = ['intro', 'features', 'install', 'download'];
  const navLinks = {};
  sections.forEach((id) => {
    navLinks[id] = siteNav.querySelector(`.nav-link[href="#${id}"]`);
  });

  const spy = new IntersectionObserver(
    (entries) => {
      entries.forEach((entry) => {
        if (entry.isIntersecting) {
          const id = entry.target.id;
          // 清除所有高亮，再点亮当前区块
          Object.values(navLinks).forEach((a) => a && a.classList.remove('is-active'));
          if (navLinks[id]) navLinks[id].classList.add('is-active');
        }
      });
    },
    {
      // 顶部留出吸顶导航的高度，让区块进入视口中部才算“当前”
      rootMargin: '-40% 0px -55% 0px',
      threshold: 0,
    }
  );

  sections.forEach((id) => {
    const el = document.getElementById(id);
    if (el) spy.observe(el);
  });

  /* ---------- 4. 滚动进入视口淡入上移 ---------- */
  const revealObserver = new IntersectionObserver(
    (entries, observer) => {
      entries.forEach((entry) => {
        if (entry.isIntersecting) {
          entry.target.classList.add('is-visible');
          // 淡入一次后即可停止观察，提升性能
          observer.unobserve(entry.target);
        }
      });
    },
    { threshold: 0.15, rootMargin: '0px 0px -40px 0px' }
  );

  document.querySelectorAll('.reveal').forEach((el) => revealObserver.observe(el));
});
