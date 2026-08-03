#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
构建脚本：从 demo-content.json 生成
  1. demo/demo-data.js          —— 工具页 index.html 引用的演示数据（window.XHS_DEMO）
  2. demo/魔弹论预览.html         —— 独立演示预览页（renderer.js 与数据全部内联，可单独分发）

用法：python3 scripts/build_demo.py
"""
import json
import os

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
SRC = os.path.join(ROOT, "demo-content.json")
JS_OUT = os.path.join(ROOT, "demo", "demo-data.js")
HTML_OUT = os.path.join(ROOT, "demo", "魔弹论预览.html")
RENDERER = os.path.join(ROOT, "assets", "renderer.js")


def main():
    with open(SRC, "r", encoding="utf-8") as f:
        content = json.load(f)
    theme = content.get("meta", {}).get("theme", "演示")

    # 1) demo-data.js
    js = "/* 自动生成，请勿手改：python3 scripts/build_demo.py */\n"
    js += "window.XHS_DEMO = " + json.dumps(content, ensure_ascii=False, indent=2) + ";\n"
    with open(JS_OUT, "w", encoding="utf-8") as f:
        f.write(js)

    # 2) 独立预览页（全内联）
    with open(RENDERER, "r", encoding="utf-8") as f:
        renderer_src = f.read()
    demo_json = json.dumps(content, ensure_ascii=False)
    html = f"""<!DOCTYPE html>
<html lang="zh-CN">
<head>
<meta charset="UTF-8">
<title>{theme} · écho 卡片演示</title>
<link rel="stylesheet" href="https://cdnjs.cloudflare.com/ajax/libs/font-awesome/6.4.0/css/all.min.css">
<script src="https://cdnjs.cloudflare.com/ajax/libs/html2canvas/1.4.1/html2canvas.min.js"></script>
<style>
/* 演示页壳样式 */
body {{ margin: 0; background-color: #f4f6f9; display: flex; flex-direction: column; height: 100vh; font-family: -apple-system, sans-serif; overflow: hidden; }}
.toolbar {{ flex-shrink: 0; width: 100%; background: white; padding: 15px 0; box-shadow: 0 4px 15px rgba(0,0,0,0.03); display: flex; justify-content: center; align-items: center; gap: 28px; z-index: 100; }}
.toolbar .note {{ font-size: 15px; font-weight: 700; color: #333; }}
.toolbar button {{ background: #FF5500; color: white; border: none; padding: 12px 30px; font-size: 16px; font-weight: bold; border-radius: 8px; cursor: pointer; transition: 0.2s; }}
.toolbar button:hover {{ filter: brightness(1.08); }}
.preview-area {{ flex: 1; display: flex; flex-direction: row; gap: 40px; padding: 0 50vw; overflow-x: auto; overflow-y: hidden; align-items: center; scroll-snap-type: x mandatory; scroll-padding: 50vw; }}
.preview-area::-webkit-scrollbar {{ height: 8px; }}
.preview-area::-webkit-scrollbar-thumb {{ background: #ccc; border-radius: 4px; }}
</style>
</head>
<body>
<div class="toolbar">
  <span class="note">仅输入关键词「{theme}」→ 自动调研 · 结构化 · 排版</span>
  <button onclick="downloadCards()"><i class="fas fa-download"></i> 一键下载全部卡片</button>
</div>
<div class="preview-area" id="previewArea"></div>
<script>
{renderer_src}
// 注入 écho 设计系统 CSS（由渲染引擎持有）
var _style = document.createElement('style');
_style.textContent = XHS.ECHO_CSS;
document.head.appendChild(_style);

// 渲染演示内容
var DEMO = {demo_json};
XHS.render(DEMO, document.getElementById('previewArea'));

async function downloadCards() {{
  const wrappers = document.querySelectorAll('.card-wrapper');
  for (let i = 0; i < wrappers.length; i++) {{
    const w = wrappers[i]; const c = w.querySelector('.xhs-card');
    w.classList.add('is-exporting');
    try {{
      await new Promise(r => setTimeout(r, 150));
      const canvas = await html2canvas(c, {{ scale: 1, useCORS: true, backgroundColor: null }});
      const link = document.createElement('a');
      link.download = `{theme}_card_${{i + 1}}.png`;
      link.href = canvas.toDataURL();
      link.click();
    }} catch (e) {{ console.error("截图失败:", e); }}
    finally {{ w.classList.remove('is-exporting'); }}
  }}
}}
</script>
</body>
</html>
"""
    with open(HTML_OUT, "w", encoding="utf-8") as f:
        f.write(html)
    print("已生成:")
    print("  ", JS_OUT)
    print("  ", HTML_OUT)


if __name__ == "__main__":
    main()
