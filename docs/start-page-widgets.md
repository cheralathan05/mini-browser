# Start Page Widgets

Milo start page widgets use a small protocol layer on top of `widget://...`.

Two user-extensible modes are supported:

- `widget://package/<id>` for installed local widget packages
- `widget://dev/<name>?entry=http://127.0.0.1:5175/widget.html` for local development

For package management, open `milo://widgets` or use the "Manage widget packages" action from the start page protocol widget modal. The manager page supports:

- installing a local widget folder
- overwrite confirmation when the package id already exists
- revealing the widgets root or a specific package folder
- viewing the parsed manifest and copying `widget://package/<id>`
- generating a starter package with one click

## Package Layout

Copy a widget folder into the Milo widgets root directory:

```text
<userData>/widgets/<your-widget>/
  widget.json
  index.html
  widget.js
  widget.css
```

`widget.json`:

```json
{
  "id": "weather-clock",
  "name": "Weather Clock",
  "version": "1.0.0",
  "entry": "index.html",
  "description": "Example local widget package.",
  "defaultTitle": "Weather Clock",
  "defaultSize": { "w": 4, "h": 4 },
  "permissions": {
    "network": true,
    "openExternal": false
  }
}
```

Rules:

- `id`, `name`, `version`, and `entry` are required.
- `entry` must be a relative file path inside the widget folder.
- `defaultSize` controls the initial grid size when `widget://package/<id>` is added to the start page.
- Widget files are served from `milo://widget-package/<id>/...`.
- Widgets run inside a sandboxed iframe and do not receive `browserShell`.

## Using A Package Widget

Add a protocol widget from the start page with one of these sources:

```text
widget://package/weather-clock
widget://package/weather-clock?refresh=15m
widget://package/weather-clock?refresh=30s&city=shanghai
```

The sample package `hello-snapshot` is created automatically in the widgets root.

## Browser Automation API

Widget refresh cadence is owned by Milo's main-process cron trigger runtime. When a widget source includes `refresh=...`, Milo schedules that widget instance and sends `host:refresh` to the visible runtime on each tick.

The widget code owns webpage automation. Package widgets receive `window.milo` automatically. Dev widgets can include the same client explicitly:

```html
<script src="milo://widget-api/client.js"></script>
```

Available API:

```ts
type MiloWidgetApi = {
  browser: {
    call(tool: string, input?: Record<string, unknown>): Promise<unknown>;
    open(input?: Record<string, unknown>): Promise<unknown>;
    snapshot(input?: Record<string, unknown>): Promise<unknown>;
    extract(input?: Record<string, unknown>): Promise<unknown>;
    extractRecords(input?: Record<string, unknown>): Promise<unknown>;
    extractData(input?: Record<string, unknown>): Promise<unknown>;
    interact(input?: Record<string, unknown>): Promise<unknown>;
    navigate(input?: Record<string, unknown>): Promise<unknown>;
    context(input?: Record<string, unknown>): Promise<unknown>;
  };
  widget: {
    ready(): void;
    refresh(): void;
    error(message: string): void;
    onRefresh(listener: (payload: { reason: "interval"; refreshedAt: number }) => void): () => void;
  };
  onRefresh(listener: (payload: { reason: "interval"; refreshedAt: number }) => void): () => void;
};
```

Important automation contracts:

- `milo.browser.open(input)` maps to `page.open`. Input must include `{ url }` or `{ tabId }`. It returns `opened.page`, a `PageRef` with `sessionId`, `tabId`, `documentId`, `leaseId`, and `observeOnly`.
- `milo.browser.extract(input)` maps to `page.extract`. Use this when you have `opened.page` and want text, records, or images: `{ page: opened.page, mode: "text" | "records" | "images" | "auto", maxItems?: number, recordSchema?: object }`.
- `milo.browser.extractData(input)` maps to `browser.extract_data`. It does not accept `page`, `task`, or `mode`. Use exactly one of `{ session: { sessionId, tabId }, script: "return { ... };" }` or `{ session: { sessionId, tabId }, extraction: { type: "records", recordSchema?: object } }`.
- `milo.browser.navigate(input)` maps to `browser.navigate`. It requires `{ session: { sessionId, tabId }, url }`. Use `milo.browser.open({ url })` for the initial load.
- `milo.browser.call(tool, input)` is limited to the widget automation allowlist: `page.open`, `page.snapshot`, `page.extract`, `page.interact`, `extract.records`, `browser.extract_data`, `browser.navigate`, and `browser.get_page_context`. There is no `close` tool for widgets. The host owns the hidden automation tab lifecycle.

Use `opened.page` directly for `page.*` helpers. For `browser.*` helpers that require a session, derive it from the page:

```js
const opened = await window.milo.browser.open({
  url,
  waitUntil: "domcontentloaded",
  timeoutMs: 15000,
});
const session = {
  sessionId: opened.page.sessionId,
  tabId: opened.page.tabId,
};
```

Use `extractData` only for deterministic DOM JavaScript or structured record extraction:

```js
const result = await window.milo.browser.extractData({
  session,
  script: `
    const text = document.body ? document.body.innerText : "";
    return { title: document.title, text };
  `,
});
```

Do not write this:

```js
await window.milo.browser.extractData({
  page: opened.page,
  task: "Extract usage data",
  mode: "text",
});
```

That shape belongs to no widget automation schema and will fail validation.

Example source:

```text
widget://package/price-card?refresh=10m&url=https%3A%2F%2Fexample.com%2Fprices
```

Do not run aggressive timers inside widgets. Let Milo trigger refresh, then call `milo.browser.*` from the refresh handler. Browser automation calls are bound to the widget's workspace and are rejected if the widget instance no longer exists on the start page.

## Dev Widgets

For local iteration, run a dev server that serves a widget html entry and add:

```text
widget://dev/local-demo?entry=http://127.0.0.1:5175/widget.html
widget://dev/local-demo?entry=http://127.0.0.1:5175/widget.html&refresh=5s
```

Currently `dev` mode only accepts `localhost` or `127.0.0.1`.

## Host Messaging

Milo sends messages to widgets via `postMessage`. Widget refresh cadence is driven by the main-process trigger runtime, not by a widget-local or start-page-local polling loop. When a protocol widget source includes `refresh=...`, Milo registers a background timer trigger for that widget instance and forwards each trigger to the visible widget runtime as `host:refresh`.

Host to widget:

```ts
type HostMessage =
  | {
      type: "host:update-context";
      payload: {
        instanceId: string;
        title: string;
        source: string;
        theme: "light" | "dark";
        locale: string;
        refreshIntervalMs: number | null;
        params: Record<string, string>;
        packageId?: string;
        packageName?: string;
      };
    }
  | {
      type: "host:refresh";
      payload: {
        reason: "interval";
        refreshedAt: number;
      };
    };
```

Widget to host:

```ts
type WidgetMessage =
  | { type: "widget:ready" }
  | { type: "widget:refresh" }
  | { type: "widget:error"; payload: { message: string } };
```

The low-level `milo:browser:call` and `milo:browser:result` messages are internal to the `window.milo` client. Widget authors should use the JS API above.

## Minimal Widget Example

```html
<!doctype html>
<html>
  <body>
    <div id="app">Loading...</div>
    <script type="module">
      const app = document.getElementById("app");
      let context = {};

      async function refresh() {
        const url = context.params?.url || "https://example.com";
        try {
          const opened = await window.milo.browser.open({
            url,
            waitUntil: "domcontentloaded",
            timeoutMs: 15000,
          });
          const data = await window.milo.browser.extract({
            page: opened.page,
            mode: "records",
            maxItems: 10,
          });
          app.textContent = JSON.stringify(data, null, 2);
        } catch (error) {
          app.textContent = error instanceof Error ? error.message : String(error);
          window.milo.widget.error(app.textContent);
        }
      }

      window.addEventListener("message", (event) => {
        const message = event.data;
        if (!message || typeof message !== "object") {
          return;
        }

        if (message.type === "host:update-context") {
          context = message.payload || {};
          app.textContent = "Ready";
          window.milo.widget.ready();
          refresh();
        }
      });

      window.milo.widget.onRefresh(refresh);
    </script>
  </body>
</html>
```

## Notes

- Keep widget assets self-contained inside the package folder.
- Use the `params` object from the host message for simple configuration.
- Let Milo control refresh cadence from the main process; do not start aggressive polling loops in the widget itself.
