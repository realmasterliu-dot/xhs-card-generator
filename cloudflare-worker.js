/**
 * 小红书卡片生成器 v2 · LLM 跨域转发代理（Cloudflare Worker）
 *
 * 用途：解决「浏览器直连 LLM API 被 CORS 拦截」的问题，例如腾讯 tokenhub、
 *      部分国内云厂商等不支持浏览器跨域的服务商。
 *
 * 部署步骤（约 5 分钟，免费）：
 *  1. 打开 https://dash.cloudflare.com → 登录（没有账号可先用邮箱注册）
 *  2. 左侧菜单进入 Workers & Pages → Create → Create Worker
 *  3. 把本文件全部内容粘贴进 worker 代码编辑器，替换默认代码
 *  4. 点右上角 Deploy 部署
 *  5. 部署后在页面右侧看到 xxx.workers.dev 的 URL（如 https://my-llm-proxy.xxx.workers.dev）
 *  6. 把该 URL 填到工具「代理转发地址」输入框 → 点「测试连接」即可
 *
 * 安全性说明：
 *  - API Key 由浏览器直接发往本 Worker，Worker 仅做转发，不落盘不记录
 *  - 建议为 Worker 设置访问保护（在 Worker 设置里加一个 Bearer Token 校验），
 *    可防止被他人盗用作代理。工具端协议已预留。
 */

// 可选：访问保护。留空则不校验；填了则工具端需在代理地址后加 #token=<你的保护token>
// 例如：https://my-llm-proxy.xxx.workers.dev#tok_abc123
const ACCESS_TOKEN = ''; // 例如 'tok_abc123'，留空 = 不校验

const ALLOWED_ORIGINS = '*'; // 允许跨域来源；'*' = 全部（GitHub Pages 够用）

async function handleRequest(request) {
  // —— CORS 预检 ——
  if (request.method === 'OPTIONS') {
    return new Response(null, {
      status: 204,
      headers: corsHeaders(),
    });
  }

  // —— 只接受 POST ——
  if (request.method !== 'POST') {
    return json({ ok: false, error: { message: 'method not allowed' } }, 405);
  }

  // —— 访问保护（可选）——
  const authHeader = request.headers.get('Authorization') || '';
  const url = new URL(request.url);
  const urlToken = url.hash.replace(/^#?token=/, '');
  if (ACCESS_TOKEN) {
    if (authHeader !== ('Bearer ' + ACCESS_TOKEN) && urlToken !== ACCESS_TOKEN) {
      return json({ ok: false, error: { message: 'unauthorized: invalid access token' } }, 401);
    }
  }

  // —— 解析工具端请求体（协议与 server.py /api/chat 一致）——
  let payload;
  try {
    payload = await request.json();
  } catch (e) {
    return json({ ok: false, error: { message: 'invalid json body' } }, 400);
  }

  const baseUrl = String(payload.baseUrl || '').trim().replace(/\/+$/, '');
  const apiKey = String(payload.apiKey || '').trim();
  const model = String(payload.model || '').trim();
  const messages = payload.messages;
  const temperature = payload.temperature == null ? 0.7 : payload.temperature;

  if (!baseUrl || !model || !Array.isArray(messages)) {
    return json({ ok: false, error: { message: 'missing baseUrl / model / messages' } }, 400);
  }
  if (!apiKey) {
    return json({ ok: false, error: { message: 'missing apiKey' } }, 400);
  }

  // —— 组装上游请求 ——
  const upstreamBody = {
    model,
    messages,
    temperature,
  };
  // 部分服务商（DeepSeek / OpenAI）支持 json_object；腾讯 tokenhub 等不支持时
  // 若报 400 会自动去掉重试一次
  const wantJson = /deepseek|openai/i.test(baseUrl);

  for (let attempt = 0; attempt < 2; attempt++) {
    const body = { ...upstreamBody };
    if (wantJson && attempt === 0) body.response_format = { type: 'json_object' };

    try {
      const resp = await fetch(baseUrl + '/chat/completions', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': 'Bearer ' + apiKey,
        },
        body: JSON.stringify(body),
      });

      const text = await resp.text();
      // 透传上游 JSON（保留 choices 结构，工具端直接读取）
      if (resp.ok) {
        try {
          return new Response(text, {
            status: 200,
            headers: { ...corsHeaders(), 'Content-Type': 'application/json; charset=utf-8' },
          });
        } catch (e) {
          return json({ ok: false, error: { message: 'upstream bad json' } }, 502);
        }
      }

      // 400 且可能是不支持 response_format → 去掉重试
      if (resp.status === 400 && wantJson && attempt === 0) continue;

      // 其它错误：透传错误信息
      let errMsg = 'HTTP ' + resp.status;
      try {
        const j = JSON.parse(text);
        errMsg = (j.error && (j.error.message || j.error.type)) || errMsg;
      } catch (e) { /* keep */ }
      return json({ ok: false, error: { message: errMsg, status: resp.status } }, resp.status);
    } catch (e) {
      return json({ ok: false, error: { message: 'proxy upstream error: ' + e.message } }, 502);
    }
  }

  return json({ ok: false, error: { message: 'unexpected' } }, 500);
}

function corsHeaders() {
  return {
    'Access-Control-Allow-Origin': ALLOWED_ORIGINS,
    'Access-Control-Allow-Methods': 'POST, GET, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type, Authorization',
    'Access-Control-Max-Age': '86400',
  };
}

function json(obj, status) {
  return new Response(JSON.stringify(obj), {
    status,
    headers: { ...corsHeaders(), 'Content-Type': 'application/json; charset=utf-8' },
  });
}

export default {
  fetch: handleRequest,
};
