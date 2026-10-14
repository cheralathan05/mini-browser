import type { BrowserTabState } from "@/types/browser";

export const HOME_DISPLAY_URL = "home://start";
const searchBaseUrl = "https://www.google.com/search?q=";

function createStartPageMarkup() {
  return `<!doctype html>
  <html lang="zh-CN">
    <head>
      <meta charset="UTF-8" />
      <meta name="viewport" content="width=device-width, initial-scale=1.0" />
      <title>Start</title>
      <style>
        :root {
          color-scheme: dark;
        }

        * {
          box-sizing: border-box;
        }

        body {
          margin: 0;
          min-height: 100vh;
          font-family: "Avenir Next", "Segoe UI", sans-serif;
          color: #f8fafc;
          background:
            radial-gradient(circle at top left, rgba(251, 191, 36, 0.24), transparent 22%),
            radial-gradient(circle at bottom right, rgba(56, 189, 248, 0.18), transparent 28%),
            linear-gradient(180deg, #090f1e 0%, #04070f 100%);
          padding: 48px 24px;
        }

        .shell {
          max-width: 1080px;
          margin: 0 auto;
        }

        .hero {
          padding: 36px;
          border-radius: 32px;
          background: rgba(15, 23, 42, 0.72);
          border: 1px solid rgba(255, 255, 255, 0.08);
          box-shadow: 0 24px 80px rgba(4, 7, 15, 0.35);
          backdrop-filter: blur(28px);
        }

        .eyebrow {
          display: inline-flex;
          gap: 10px;
          align-items: center;
          padding: 8px 14px;
          border-radius: 999px;
          background: rgba(255, 255, 255, 0.06);
          color: #94a3b8;
          letter-spacing: 0.28em;
          font-size: 11px;
          text-transform: uppercase;
        }

        h1 {
          margin: 18px 0 12px;
          font-family: "Iowan Old Style", Georgia, serif;
          font-size: clamp(42px, 8vw, 72px);
          line-height: 1;
        }

        p {
          margin: 0;
          max-width: 700px;
          font-size: 17px;
          line-height: 1.75;
          color: #cbd5e1;
        }

        .grid {
          display: grid;
          grid-template-columns: repeat(auto-fit, minmax(180px, 1fr));
          gap: 18px;
          margin-top: 28px;
        }

        .card {
          display: block;
          text-decoration: none;
          color: inherit;
          padding: 20px;
          border-radius: 24px;
          background: linear-gradient(180deg, rgba(30, 41, 59, 0.78), rgba(15, 23, 42, 0.9));
          border: 1px solid rgba(255, 255, 255, 0.08);
          transition: transform 180ms ease, border-color 180ms ease, background 180ms ease;
        }

        .card:hover {
          transform: translateY(-4px);
          border-color: rgba(125, 211, 252, 0.4);
          background: linear-gradient(180deg, rgba(51, 65, 85, 0.86), rgba(15, 23, 42, 0.95));
        }

        .card strong {
          display: block;
          font-size: 18px;
          margin-bottom: 8px;
        }

        .card span {
          color: #94a3b8;
          font-size: 14px;
          line-height: 1.65;
        }

        .footer {
          margin-top: 28px;
          color: #94a3b8;
          font-size: 14px;
        }

        code {
          padding: 4px 8px;
          border-radius: 999px;
          background: rgba(255, 255, 255, 0.08);
          color: #e2e8f0;
        }
      </style>
    </head>
    <body>
      <div class="shell">
        <section class="hero">
          <div class="eyebrow">Browser</div>
          <h1>从这里开始浏览</h1>
          <p>
            地址栏支持直接输入网址，也支持把普通文本当作搜索关键词处理。你现在可以打开常用站点，
            或者在顶栏按 <code>Ctrl/Cmd + L</code> 快速聚焦地址栏。
          </p>
          <div class="grid">
            <a class="card" href="https://openai.com">
              <strong>OpenAI</strong>
              <span>产品、文档与最新模型入口。</span>
            </a>
            <a class="card" href="https://developer.mozilla.org">
              <strong>MDN</strong>
              <span>Web 平台 API 与浏览器规范参考。</span>
            </a>
            <a class="card" href="https://github.com">
              <strong>GitHub</strong>
              <span>代码仓库、Issues 与 Pull Requests。</span>
            </a>
            <a class="card" href="https://news.ycombinator.com">
              <strong>HN</strong>
              <span>快速查看技术社区的热议内容。</span>
            </a>
          </div>
          <div class="footer">
            输入完整协议 URL，或直接输入关键词搜索。新标签页快捷键是
            <code>Ctrl/Cmd + T</code>。
          </div>
        </section>
      </div>
    </body>
  </html>`;
}

export const START_PAGE_URL = `data:text/html;charset=UTF-8,${encodeURIComponent(
  createStartPageMarkup(),
)}`;

export function resolveInputToUrl(input: string) {
  const value = input.trim();

  if (!value || value === HOME_DISPLAY_URL || value.toLowerCase() === "home") {
    return START_PAGE_URL;
  }

  if (/^[a-zA-Z][a-zA-Z\d+\-.]*:/.test(value)) {
    return value;
  }

  if (/^(localhost|\d{1,3}(?:\.\d{1,3}){3})(:\d+)?(\/.*)?$/i.test(value)) {
    return `http://${value}`;
  }

  if (/^[\w.-]+\.[a-z]{2,}(\/.*)?$/i.test(value)) {
    return `https://${value}`;
  }

  return `${searchBaseUrl}${encodeURIComponent(value)}`;
}

export function toDisplayUrl(url: string) {
  return url.startsWith("data:text/html") ? HOME_DISPLAY_URL : url;
}

export function inferTitleFromUrl(url: string) {
  if (url.startsWith("data:text/html")) {
    return "Start";
  }

  try {
    const parsedUrl = new URL(url);
    return parsedUrl.hostname.replace(/^www\./, "") || parsedUrl.href;
  } catch {
    return "New Tab";
  }
}

function createTabId() {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
    return crypto.randomUUID();
  }

  return `tab-${Math.random().toString(36).slice(2, 11)}`;
}

export function createBrowserTab(url: string = START_PAGE_URL): BrowserTabState {
  return {
    id: createTabId(),
    title: inferTitleFromUrl(url),
    url,
    displayUrl: toDisplayUrl(url),
    isLoading: false,
    isAutomationControlled: false,
    canGoBack: false,
    canGoForward: false,
  };
}
