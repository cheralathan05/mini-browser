import React, { useEffect, useMemo, useState } from "react";
import ReactDOM from "react-dom/client";
import { AgentMessageMarkdown } from "@/components/agent/agent-message-markdown";
import "./render-preview.css";

type LoadState =
  | { status: "loading" }
  | { status: "missing"; message: string }
  | { status: "ready"; document: RenderPreviewDocument };

const localeText = {
  "en-US": {
    htmlTitle: "HTML Preview",
    markdownTitle: "Markdown Preview",
    missing: "Preview content is no longer available.",
    source: "Source",
  },
  "zh-CN": {
    htmlTitle: "HTML 预览",
    markdownTitle: "Markdown 预览",
    missing: "预览内容已不可用。",
    source: "来源",
  },
};

function getLocale() {
  const language = navigator.language.trim().toLowerCase();
  return language.startsWith("zh") ? "zh-CN" : "en-US";
}

function escapeHtmlAttribute(value: string) {
  return value
    .replace(/&/g, "&amp;")
    .replace(/"/g, "&quot;")
    .replace(/</g, "&lt;");
}

function injectBaseTag(html: string, baseUrl?: string) {
  if (!baseUrl) {
    return html;
  }

  const baseTag = `<base href="${escapeHtmlAttribute(baseUrl)}">`;
  if (/<base\s/i.test(html)) {
    return html;
  }
  if (/<head(?:\s[^>]*)?>/i.test(html)) {
    return html.replace(/<head(?:\s[^>]*)?>/i, (match) => `${match}${baseTag}`);
  }
  return html.replace(/<html(?:\s[^>]*)?>/i, (match) => `${match}<head>${baseTag}</head>`);
}

function buildHtmlDocument(content: string, baseUrl?: string) {
  if (/^\s*<!doctype\s+html\b/i.test(content) || /<html[\s>]/i.test(content)) {
    return injectBaseTag(content, baseUrl);
  }

  const baseTag = baseUrl ? `<base href="${escapeHtmlAttribute(baseUrl)}">` : "";
  return `<!doctype html>
<html>
  <head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    ${baseTag}
    <style>
      :root { color-scheme: light dark; }
      html, body { min-height: 100%; }
      body {
        margin: 0;
        padding: 24px;
        background: Canvas;
        color: CanvasText;
        font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
      }
      img, video, canvas, svg { max-width: 100%; height: auto; }
      table { border-collapse: collapse; }
    </style>
  </head>
  <body>${content}</body>
</html>`;
}

function RenderPreviewPage() {
  const locale = getLocale();
  const text = localeText[locale];
  const [state, setState] = useState<LoadState>({ status: "loading" });

  useEffect(() => {
    let cancelled = false;
    const id = new URLSearchParams(window.location.search).get("id")?.trim() ?? "";
    if (!id || !window.browserShell?.renderPreviewGetDocument) {
      setState({ status: "missing", message: text.missing });
      return;
    }

    void window.browserShell.renderPreviewGetDocument(id)
      .then((document) => {
        if (cancelled) {
          return;
        }
        setState(document ? { status: "ready", document } : { status: "missing", message: text.missing });
      })
      .catch(() => {
        if (!cancelled) {
          setState({ status: "missing", message: text.missing });
        }
      });

    return () => {
      cancelled = true;
    };
  }, [text.missing]);

  const htmlDocument = useMemo(() => {
    if (state.status !== "ready" || state.document.format !== "html") {
      return "";
    }
    return buildHtmlDocument(state.document.content, state.document.sourceUrl);
  }, [state]);

  if (state.status === "loading") {
    return <div className="render-preview-status" />;
  }

  if (state.status === "missing") {
    return <div className="render-preview-status">{state.message}</div>;
  }

  const title = state.document.format === "html" ? text.htmlTitle : text.markdownTitle;

  return (
    <main className="render-preview-shell">
      <header className="render-preview-header">
        <div className="render-preview-title">{title}</div>
        {state.document.sourceTitle || state.document.sourceUrl ? (
          <div className="render-preview-source">
            <span>{text.source}</span>
            <strong>{state.document.sourceTitle || state.document.sourceUrl}</strong>
          </div>
        ) : null}
      </header>
      <section className="render-preview-body">
        {state.document.format === "html" ? (
          <iframe
            className="render-preview-html-frame"
            sandbox="allow-scripts"
            srcDoc={htmlDocument}
            title={title}
          />
        ) : (
          <AgentMessageMarkdown
            className="render-preview-markdown"
            content={state.document.content}
          />
        )}
      </section>
    </main>
  );
}

ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <RenderPreviewPage />
  </React.StrictMode>,
);
