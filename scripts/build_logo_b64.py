#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
生成 echo logo 的 base64 数据文件，供 renderer.js 在 pageHTML 时内联到 footer。

用法：python3 scripts/build_logo_b64.py [源 PNG 路径]
默认读取 assets/echo-logo-horizontal.png → 输出 assets/echo-logo-base64.js

为什么需要这个文件：
- 导出的独立 HTML 要单文件可分发（不能依赖外部 assets/ 目录）
- 把 PNG 转 base64 字符串嵌入 JS，renderer.js 检测 window.ECHO_LOGO_BASE64 后
  使用 data:image/png;base64,... 作为 img src，免去相对路径问题
"""
import os
import sys
import base64

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
DEFAULT_SRC = os.path.join(ROOT, "assets", "echo-logo-horizontal.png")
OUT = os.path.join(ROOT, "assets", "echo-logo-base64.js")


def main():
    src = sys.argv[1] if len(sys.argv) > 1 else DEFAULT_SRC
    if not os.path.exists(src):
        print(f"源文件不存在: {src}", file=sys.stderr)
        sys.exit(1)

    with open(src, "rb") as f:
        b64 = base64.b64encode(f.read()).decode("ascii")

    src_kb = os.path.getsize(src) / 1024
    out_kb = os.path.getsize(OUT) / 1024 if os.path.exists(OUT) else 0
    print(f"源图: {src} ({src_kb:.1f} KB)")
    print(f"输出: {OUT}")
    print(f"base64 长度: {len(b64)} 字符")

    with open(OUT, "w", encoding="utf-8") as f:
        f.write('/* echo logo 内联 base64。自动生成：python3 scripts/build_logo_b64.py */\n')
        f.write(f'window.ECHO_LOGO_BASE64="{b64}";\n')

    final_kb = os.path.getsize(OUT) / 1024
    print(f"已写入 ({final_kb:.1f} KB, 之前 {out_kb:.1f} KB)")


if __name__ == "__main__":
    main()
