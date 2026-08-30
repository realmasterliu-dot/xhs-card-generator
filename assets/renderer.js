/**
 * renderer.js — écho 小红书卡片渲染引擎
 *
 * 职责：
 *  1. 注入 écho 设计系统 CSS（与原始飞书模板完全一致，含防溢出/孤字/品牌资产规则）
 *  2. 将「结构化内容 JSON」确定性渲染为卡片 DOM（杜绝 LLM 直接写 HTML 的排版漂移）
 *  3. 提供字数统计、单页校验、独立 HTML 导出
 *
 * 内容 JSON Schema（由 LLM「组织阶段」产出）：
 * {
 *   meta: { theme, mode, brand, ... },
 *   pages: [{
 *     mainTitle: "...（可用 <hl>词</hl> 局部高亮）",
 *     blocks: [
 *       { t:"metric", v:"强效果" },                                  // 视觉焦点大数字/词眼
 *       { t:"bento", span:"full|half", style:"default|tint|accent",
 *         icon:"fa-xxx", title:"...", text:"..." },                  // Bento 网格盒
 *       { t:"list", items:[{num?,title,text},...] },                 // 123 常规列表
 *       { t:"prose", paras:["..."], annotation:"..." }               // 长文 + 金句注释
 *     ]
 *   }]
 * }
 */
(function (global) {
  'use strict';

  /* ---------------- écho 设计系统 CSS（原始模板原样保留 + 少量补充） ---------------- */

  /** 品牌字体（江成圆体）—— 已自托管于 assets/fonts/，@import 必须位于样式表最前 */
  var FONT_IMPORT = '@import url("assets/fonts/result.css");';

  /** 演示页壳样式（独立预览页 / 导出 HTML 使用） */
  var SHELL_CSS = [
    'body { margin: 0; background-color: #f4f6f9; display: flex; flex-direction: column; height: 100vh; font-family: "JiangChengYuanTi", -apple-system, sans-serif; overflow: hidden; }',
    '.toolbar { flex-shrink: 0; width: 100%; background: white; padding: 15px 0; box-shadow: 0 4px 15px rgba(0,0,0,0.03); display: flex; justify-content: center; z-index: 100; }',
    '.toolbar button { background: #FF5500; color: white; border: none; padding: 12px 30px; font-size: 16px; font-weight: bold; border-radius: 8px; cursor: pointer; transition: 0.2s; }',
    '.preview-area { flex: 1; display: flex; flex-direction: row; gap: 40px; padding: 0 50vw; overflow-x: auto; overflow-y: hidden; align-items: center; scroll-snap-type: x mandatory; scroll-padding: 50vw; }',
    '.preview-area::-webkit-scrollbar { height: 8px; }',
    '.preview-area::-webkit-scrollbar-thumb { background: #ccc; border-radius: 4px; }'
  ].join('\n');

  /** 卡片设计系统 CSS（自动注入到任意宿主页面） */
  var CARD_CSS = [
    /* @import 改在 index.html head 用 <link> 加载（利于 html2canvas 导出识别 @font-face） */
    '.card-wrapper { width: 435px; height: 581px; flex-shrink: 0; position: relative; scroll-snap-align: center; box-shadow: 0 15px 35px rgba(0,0,0,0.08); border-radius: 12px; overflow: hidden; background: #fff; }',
    '.xhs-card { width: 1242px; height: 1660px; background-color: #FBF9F6; padding: 80px 80px 70px 80px; box-sizing: border-box; position: absolute; top: 0; left: 0; transform-origin: top left; transform: scale(0.35); overflow: hidden; display: flex; flex-direction: column; font-family: "JiangChengYuanTi", -apple-system, "PingFang SC", "Microsoft YaHei", sans-serif; font-weight: normal; }',
    '.main-title { font-size: 84px; color: #111; margin: 0 0 35px 0; line-height: 1.3; font-weight: 800; z-index: 2; flex-shrink: 0; }',
    '.highlight { color: #FF5500; font-weight: 700; }',
    '.content-body { flex: 1; display: flex; flex-direction: column; gap: 32px; z-index: 2; margin-top: 0; }',
    '.content-body.is-centered { flex: none; margin: auto 0; justify-content: center; text-align: left; }',
    '.bento-metric { font-size: 100px; font-weight: 900; color: #FF5500; line-height: 1.1; margin: 0 0 16px 0; letter-spacing: -2px; }',
    '.bento-grid { display: grid; grid-template-columns: repeat(6, 1fr); gap: 24px; width: 100%; align-content: start; }',
    '.bento-box { background: #FFFFFF; border-radius: 24px; padding: 32px; border: 2px solid #EFEBE4; display: flex; flex-direction: column; position: relative; overflow: hidden; box-sizing: border-box; }',
    '.bento-box.s-accent { background: linear-gradient(135deg, #FF5500 0%, #FF3300 100%); border-color: #FF5500; color: #FFFFFF; }',
    '.bento-box.s-tint { background-color: rgba(255, 85, 0, 0.04); border-color: rgba(255, 85, 0, 0.15); }',
    '.w-full { grid-column: span 6; } .w-half { grid-column: span 3; }',
    '.box-title { font-size: 46px; font-weight: 700; margin: 0 0 16px 0; line-height: 1.4; display: flex; align-items: center; gap: 15px; color: inherit; z-index: 2; }',
    '.box-title i { color: #FF5500; } .s-accent .box-title i { color: #FFF; }',
    '.bento-text { font-size: 36px; color: #444; line-height: 1.6; margin: 0 0 12px 0; z-index: 2; position: relative; }',
    '.s-accent .bento-text { color: #FFF; }',
    '.s-accent .highlight { color: #FFF; border-bottom: 2px solid rgba(255,255,255,0.6); padding-bottom: 2px; }',
    '.classic-list { display: flex; flex-direction: column; gap: 32px; width: 100%; }',
    '.list-item { display: flex; gap: 24px; align-items: flex-start; background: #fff; padding: 32px; border-radius: 20px; box-shadow: 0 4px 15px rgba(0,0,0,0.02); }',
    '.list-num { font-size: 48px; color: #FF5500; font-weight: 900; line-height: 1; background: rgba(255,85,0,0.1); padding: 16px; border-radius: 16px; min-width: 60px; text-align: center; }',
    '.list-content { flex: 1; }',
    '.list-content h2 { font-size: 44px; color: #111; margin: 0 0 12px 0; }',
    '.list-content p { font-size: 36px; color: #555; margin: 0; line-height: 1.6; }',
    '.prose-layout { display: flex; flex-direction: column; gap: 24px; width: 100%; }',
    '.prose-text { font-size: 38px; color: #333; line-height: 1.7; margin: 0; }',
    '.prose-annotation { border-left: 10px solid #FF5500; background: #fff; padding: 32px 40px; font-size: 36px; color: #666; font-style: italic; border-radius: 0 20px 20px 0; margin-top: 10px; box-shadow: 0 4px 15px rgba(0,0,0,0.02); }',
    '.visual-element { position: absolute; bottom: -100px; right: -100px; width: 800px; height: 800px; background: radial-gradient(circle, rgba(255,85,0,0.1) 0%, rgba(250,250,250,0) 70%); border-radius: 50%; z-index: 1; pointer-events: none; }',
    '.footer-branding { margin-top: auto; border-top: 4px solid rgba(0,0,0,0.06); padding-top: 30px; font-size: 32px; color: #888; display: flex; justify-content: space-between; align-items: center; z-index: 2; font-weight: 500; flex-shrink: 0; min-height: 92px; }',
    '.footer-branding .footer-logo { height: 60px; width: auto; display: block; }',
    '.footer-right { color: #FF5500; font-weight: 700; }',
    /* 补充：导出放大用 */
    '.card-wrapper.is-exporting { width: 1242px !important; height: 1660px !important; overflow: visible !important; }',
    '.card-wrapper.is-exporting .xhs-card { transform: none !important; }'
  ].join('\n');

  /** 完整样式（独立预览页 / 导出 HTML 使用，<link> 已在外层页面加载过则浏览器去重） */
  var ECHO_CSS = FONT_IMPORT + '\n' + CARD_CSS + '\n' + SHELL_CSS;

  /* ---------------- 自动注入卡片样式 + 品牌字体（幂等） ----------------
   * 渲染引擎加载即注入，杜绝宿主页面漏引用导致「只有文字无样式」或字体缺失。
   * @import 必须位于样式表最前，故文本以 FONT_IMPORT 开头。
   * 若宿主页面已通过 <link> 引入字体（如 index.html 的 #brand-font-css），则跳过字体 @import，
   * 避免同一字体被注册两遍（248 个面 → 124 个）。 */
  (function ensureCardCSS() {
    if (!global.document || !global.document.head) return;
    if (global.document.getElementById('echo-card-style')) return;
    var hasFontLink = !!global.document.getElementById('brand-font-css') ||
      Array.prototype.some.call(global.document.querySelectorAll('link[rel="stylesheet"]'), function (l) {
        return /result\.css/.test(l.getAttribute('href') || '');
      });
    var fontCss = hasFontLink ? '' : (FONT_IMPORT + '\n');
    var st = global.document.createElement('style');
    st.id = 'echo-card-style';
    st.textContent = fontCss + CARD_CSS;
    global.document.head.appendChild(st);
  })();

  /* ---------------- 工具函数 ---------------- */

  function esc(s) {
    return String(s == null ? '' : s)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      /* 白名单：<br> 是内容 JSON 里唯一允许的标签（用于手动断句），转义后还原为真标签 */
      .replace(/&lt;br\s*\/?&gt;/gi, '<br>');
  }

  /** 将 <hl>核心词</hl> 安全转换为 <span class="highlight"> */
  function hlToHtml(text) {
    var parts = String(text == null ? '' : text).split(/(<hl>.*?<\/hl>)/g);
    return parts.map(function (p) {
      if (p.indexOf('<hl>') === 0 && p.lastIndexOf('</hl>') === p.length - 5) {
        return '<span class="highlight">' + esc(p.slice(4, -5)) + '</span>';
      }
      return esc(p);
    }).join('');
  }

  /** 统计纯文本字数（去标签、去空白；<br> 计 0） */
  function countChars(text) {
    return String(text == null ? '' : text)
      .replace(/<br\s*\/?>/gi, '')
      .replace(/<[^>]+>/g, '')
      .replace(/\s+/g, '')
      .length;
  }

  /** 统计单页字数 */
  function pageCharCount(page) {
    var n = countChars(page.mainTitle);
    (page.blocks || []).forEach(function (b) {
      if (b.t === 'metric') n += countChars(b.v);
      else if (b.t === 'bento') n += countChars(b.title) + countChars(b.text);
      else if (b.t === 'list') {
        (b.items || []).forEach(function (it) { n += countChars(it.title) + countChars(it.text); });
      } else if (b.t === 'prose') {
        (b.paras || []).forEach(function (p) { n += countChars(p); });
        n += countChars(b.annotation);
      }
    });
    return n;
  }

  /* ---------------- 块级渲染 ---------------- */

  function blockHTML(b) {
    switch (b.t) {
      case 'metric':
        return '<div class="bento-metric">' + esc(b.v) + '</div>';
      case 'bento': {
        var span = b.span === 'half' ? 'w-half' : 'w-full';
        var style = b.style === 'accent' ? ' s-accent' : (b.style === 'tint' ? ' s-tint' : '');
        var icon = b.icon ? '<i class="fas ' + esc(b.icon) + '"></i>' : '';
        return '<div class="bento-box ' + span + style + '">' +
          '<div class="box-title">' + icon + hlToHtml(b.title) + '</div>' +
          '<p class="bento-text">' + hlToHtml(b.text) + '</p></div>';
      }
      case 'list': {
        var items = (b.items || []).map(function (it, i) {
          var num = it.num != null ? it.num : ('0' + (i + 1)).slice(-2);
          return '<div class="list-item"><div class="list-num">' + esc(num) + '</div>' +
            '<div class="list-content"><h2>' + hlToHtml(it.title) + '</h2>' +
            '<p>' + hlToHtml(it.text) + '</p></div></div>';
        }).join('');
        return '<div class="classic-list">' + items + '</div>';
      }
      case 'prose': {
        var paras = (b.paras || []).map(function (p) {
          return '<p class="prose-text">' + hlToHtml(p) + '</p>';
        }).join('');
        var ann = b.annotation ? '<div class="prose-annotation">' + hlToHtml(b.annotation) + '</div>' : '';
        return '<div class="prose-layout">' + paras + ann + '</div>';
      }
      default:
        return '';
    }
  }

  /* 左下角 footer：默认品牌「écho」展示 logo 图，自定义品牌名则回退到文字版 */
  function footerBrandHTML(brand) {
    var useLogo = !brand || brand === 'écho';
    if (!useLogo) return '<span>' + esc(brand) + '</span>';
    var src = (global.ECHO_LOGO_BASE64)
      ? 'data:image/png;base64,' + global.ECHO_LOGO_BASE64
      : 'assets/echo-logo-horizontal.png';
    return '<img class="footer-logo" src="' + src + '" alt="écho">';
  }

  function pageHTML(page, isLast, brand) {
    var bodyClass = isLast ? 'content-body is-centered' : 'content-body';
    var footerRight = isLast
      ? '欢迎联系我们 <i class="fas fa-comment-dots"></i>'
      : '右滑查看更多 <i class="fas fa-arrow-right"></i>';
    var blocks = (page.blocks || []).map(blockHTML).join('');
    var title = page.mainTitle ? '<h1 class="main-title">' + hlToHtml(page.mainTitle) + '</h1>' : '';
    return '<div class="card-wrapper">' +
      '<div class="xhs-card">' +
      title +
      '<div class="' + bodyClass + '">' + blocks + '</div>' +
      '<div class="footer-branding">' + footerBrandHTML(brand) +
      '<span class="footer-right">' + footerRight + '</span></div>' +
      '<div class="visual-element"></div>' +
      '</div></div>';
  }

  /**
   * 渲染整组卡片到容器
   * @returns {{count:number, pageChars:number[], total:number, warnings:object[]}}
   */
  function render(content, container) {
    var pages = (content && content.pages) || [];
    var brand = (content.meta && content.meta.brand) || 'écho';
    container.innerHTML = pages.map(function (p, i) {
      return pageHTML(p, i === pages.length - 1, brand);
    }).join('');

    var pageChars = pages.map(pageCharCount);
    var total = pageChars.reduce(function (a, b) { return a + b; }, 0);
    var warnings = [];
    pageChars.forEach(function (c, i) {
      if (c > 350) warnings.push({ page: i + 1, type: 'overflow', msg: '第 ' + (i + 1) + ' 页 ' + c + ' 字，超过 350 字上限' });
      else if (c < 80) warnings.push({ page: i + 1, type: 'underfilled', msg: '第 ' + (i + 1) + ' 页仅 ' + c + ' 字，过少——建议增加 bento 网格或拆解内容填满版面' });
    });
    return { count: pages.length, pageChars: pageChars, total: total, warnings: warnings };
  }

  /* ---------------- 独立 HTML 导出 ---------------- */

  function exportHTML(content, opts) {
    opts = opts || {};
    var pages = (content && content.pages) || [];
    var brand = (content.meta && content.meta.brand) || 'écho';
    var title = (content.meta && content.meta.theme) ? content.meta.theme + ' · écho 卡片' : 'écho 卡片';
    var cards = pages.map(function (p, i) {
      return pageHTML(p, i === pages.length - 1, brand);
    }).join('');
    var logoInline = global.ECHO_LOGO_BASE64
      ? '<script>window.ECHO_LOGO_BASE64="' + global.ECHO_LOGO_BASE64.replace(/"/g, '\\"') + '";<\/script>\n'
      : '';
    return '<!DOCTYPE html>\n<html lang="zh-CN">\n<head>\n' +
      '<meta charset="UTF-8">\n<title>' + esc(title) + '</title>\n' +
      '<link rel="stylesheet" href="https://cdnjs.cloudflare.com/ajax/libs/font-awesome/6.4.0/css/all.min.css">\n' +
      logoInline +
      '<script src="assets/html2canvas.min.js" onerror="var s=document.createElement(\'script\');s.src=\'https://cdnjs.cloudflare.com/ajax/libs/html2canvas/1.4.1/html2canvas.min.js\';document.head.appendChild(s);"><\/script>\n' +
      '<style>\n' + ECHO_CSS + '\n</style>\n</head>\n<body>\n' +
      '<div class="toolbar"><button onclick="downloadCards()"><i class="fas fa-download"></i> 一键下载全部卡片</button></div>\n' +
      '<div class="preview-area" id="previewArea">\n' + cards + '\n</div>\n' +
      '<script>\n' +
      'async function downloadCards() {\n' +
      '  if (document.fonts && document.fonts.ready) { try { await document.fonts.ready; } catch (e) {} }\n' +
      '  const wrappers = document.querySelectorAll(".card-wrapper");\n' +
      '  for (let i = 0; i < wrappers.length; i++) {\n' +
      '    const w = wrappers[i]; const c = w.querySelector(".xhs-card");\n' +
      '    w.classList.add("is-exporting");\n' +
      '    try {\n' +
      '      await new Promise(r => setTimeout(r, 150));\n' +
      '      const canvas = await html2canvas(c, { scale: 1, useCORS: true, backgroundColor: null });\n' +
      '      const link = document.createElement("a");\n' +
      '      link.download = "echo_card_" + (i + 1) + ".png";\n' +
      '      link.href = canvas.toDataURL();\n' +
      '      link.click();\n' +
      '    } catch (e) { console.error("截图失败:", e); }\n' +
      '    finally { w.classList.remove("is-exporting"); }\n' +
      '  }\n' +
      '}\n' +
      '<\/script>\n</body>\n</html>';
  }

  global.XHS = {
    ECHO_CSS: ECHO_CSS,
    esc: esc,
    hlToHtml: hlToHtml,
    countChars: countChars,
    pageCharCount: pageCharCount,
    blockHTML: blockHTML,
    pageHTML: pageHTML,
    render: render,
    exportHTML: exportHTML
  };
})(window);
