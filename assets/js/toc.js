!(function () {
  'use strict';
  // 确保 #toc 和 .content 元素都存在，tocbot 才能正常工作
  if (document.querySelector('#toc') && document.querySelector('.content')) {
    // 检查 tocbot 是否已加载 (防止因加载顺序问题导致错误)
    if (typeof tocbot !== 'undefined') {
      // 销毁可能已存在的 tocbot 实例，以便重新初始化并应用新设置
      // 这对于确保新选项生效很重要，特别是如果 tocbot 已经被主题默认初始化过
      if (document.querySelector('#toc ul.toc-list')) {
        // 简单检查 tocbot 是否已生成目录结构
        tocbot.destroy();
      }

      // 使用新的配置初始化 tocbot
      tocbot.init({
        tocSelector: '#toc',
        contentSelector: '.content',
        ignoreSelector: '[data-toc-skip]', // 用于跳过特定标题
        headingSelector: 'h2, h3, h4, h5, h6', // 这里是关键，包含 H4、H5、H6
        orderedList: false, // 根据需要选择是否使用有序列表
        scrollSmooth: false, // 根据需要选择是否平滑滚动
        collapseDepth: 6, // 确保深度足够显示所有层级
        // 其他 tocbot 选项...
      });
    }
  }
})();
