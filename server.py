#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
小红书卡片生成器 v2 — 本地服务

作用：
  1. 以静态服务器方式打开工具（解决 file:// 下的一些限制）
  2. 提供 /api/chat 转发代理：浏览器 → 本服务 → LLM 服务商
     从而彻底规避浏览器直连第三方 API 的跨域(CORS)问题

用法：
  cd xhs-generator
  python3 server.py            # 默认 127.0.0.1:8765
  python3 server.py 9000       # 自定义端口
  然后浏览器打开 http://127.0.0.1:8765

说明：
  - 仅监听本机回环地址，不对外网开放
  - API Key 由浏览器传入，仅在内存中转发，不落盘
"""
import json
import mimetypes
import os
import sys
import urllib.request
import urllib.error
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

ROOT = os.path.dirname(os.path.abspath(__file__))
HOST = "127.0.0.1"
PORT = int(sys.argv[1]) if len(sys.argv) > 1 else 8765
TIMEOUT = 250  # 秒，LLM 长回答预留时间

CORS_HEADERS = {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Methods": "POST, GET, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type, Authorization",
}


class Handler(BaseHTTPRequestHandler):
    server_version = "XHSGen/2.0"

    # ---------- 基础 ----------
    def _send(self, code, body=b"", ctype="application/json; charset=utf-8"):
        self.send_response(code)
        for k, v in CORS_HEADERS.items():
            self.send_header(k, v)
        self.send_header("Content-Type", ctype)
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def _json(self, code, obj):
        self._send(code, json.dumps(obj, ensure_ascii=False).encode("utf-8"))

    def log_message(self, fmt, *args):  # 精简日志
        sys.stderr.write("[%s] %s\n" % (self.log_date_time_string(), fmt % args))

    # ---------- 路由 ----------
    def do_OPTIONS(self):
        self._send(204)

    def do_GET(self):
        if self.path == "/api/health":
            self._json(200, {"ok": True, "service": "xhs-generator-v2"})
            return
        self._serve_static(self.path)

    def do_POST(self):
        if self.path == "/api/chat":
            self._proxy_chat()
            return
        self._json(404, {"ok": False, "error": "not found"})

    # ---------- 静态文件 ----------
    def _serve_static(self, path):
        from urllib.parse import unquote
        if path in ("/", ""):
            path = "/index.html"
        rel = unquote(path.lstrip("/").split("?", 1)[0])
        # 路径穿越防护
        full = os.path.normpath(os.path.join(ROOT, rel))
        if not full.startswith(ROOT) or not os.path.isfile(full):
            self._send(404, b"not found", "text/plain; charset=utf-8")
            return
        ctype, _ = mimetypes.guess_type(full)
        if ctype is None:
            ctype = "application/octet-stream"
        with open(full, "rb") as f:
            self._send(200, f.read(), ctype)

    # ---------- LLM 转发 ----------
    def _proxy_chat(self):
        try:
            length = int(self.headers.get("Content-Length", 0))
            body = json.loads(self.rfile.read(length) or b"{}")
        except Exception:
            self._json(400, {"ok": False, "error": "invalid json body"})
            return

        base = str(body.get("baseUrl", "")).strip().rstrip("/")
        api_key = str(body.get("apiKey", "")).strip()
        model = str(body.get("model", "")).strip()
        messages = body.get("messages")
        temperature = body.get("temperature", 0.7)

        if not base or not model or not messages:
            self._json(400, {"ok": False, "error": "missing baseUrl/model/messages"})
            return
        if not api_key:
            self._json(400, {"ok": False, "error": "missing apiKey"})
            return

        url = base + "/chat/completions"
        payload = {
            "model": model,
            "messages": messages,
            "temperature": temperature,
        }
        # 服务商兼容：DeepSeek/OpenAI 支持 json_object；自定义服务商失败时降级重试
        req_headers = {
            "Content-Type": "application/json",
            "Authorization": "Bearer " + api_key,
        }
        data = json.dumps(payload).encode("utf-8")

        for attempt in (0, 1):
            p = dict(payload)
            if attempt == 0:
                p["response_format"] = {"type": "json_object"}
            try:
                req = urllib.request.Request(url, data=json.dumps(p).encode("utf-8"), headers=req_headers, method="POST")
                with urllib.request.urlopen(req, timeout=TIMEOUT) as resp:
                    raw = resp.read()
                try:
                    out = json.loads(raw)
                except Exception:
                    out = {"ok": False, "raw": raw.decode("utf-8", "replace")[:2000]}
                self._json(200, out)
                return
            except urllib.error.HTTPError as e:
                if attempt == 0 and e.code == 400:
                    # 可能是不支持 response_format，去掉重试一次
                    continue
                err_body = e.read().decode("utf-8", "replace")[:500]
                try:
                    detail = json.loads(err_body)
                    msg = detail.get("error", {}).get("message", err_body)
                except Exception:
                    msg = err_body
                self._json(e.code, {"ok": False, "error": {"message": msg, "status": e.code}})
                return
            except Exception as e:
                self._json(502, {"ok": False, "error": {"message": "proxy error: %s" % e}})
                return

        self._json(500, {"ok": False, "error": {"message": "unexpected"}})


if __name__ == "__main__":
    try:
        srv = ThreadingHTTPServer((HOST, PORT), Handler)
    except OSError as e:
        sys.stderr.write("启动失败：%s（端口 %d 可能被占用）\n" % (e, PORT))
        sys.exit(1)
    print("=" * 56)
    print("  小红书卡片生成器 v2 · 本地服务已启动")
    print("  请在浏览器打开:  http://%s:%d" % (HOST, PORT))
    print("  按 Ctrl+C 停止。")
    print("=" * 56)
    try:
        srv.serve_forever()
    except KeyboardInterrupt:
        print("\n已停止。")
