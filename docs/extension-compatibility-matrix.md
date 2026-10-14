# Extension Compatibility Matrix

Milo uses Electron's extension runtime, which is not fully compatible with Chrome.
Chrome Web Store installs are allowed by default. The compatibility matrix in
`src/main/services/extension-compatibility.ts` records reviewed extensions and
can explicitly block extensions with known hard failures.

Unknown Chrome Web Store and local unpacked extensions are marked as unreviewed
until an entry is added to the matrix.

## Compatibility Levels

- `verified`: tested against Milo's supported extension scenarios and allowed by default.
- `candidate`: allowed for controlled rollout, but known gaps or incomplete coverage remain.
- `blocked`: explicitly unsupported because required APIs or UX surfaces are missing.
- `unreviewed`: default state for extensions without a matrix entry.

## Entry Requirements

Before adding a `verified` entry, record:

- Chrome Web Store extension ID.
- Extension name and tested version.
- Test date.
- Required Chrome extension APIs.
- Known missing APIs or behavior gaps.
- Manual test notes for install, enable, disable, remove, restart reload, and core user flow.

Example matrix entry:

```ts
{
  id: "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
  name: "Example Extension",
  level: "candidate",
  installPolicy: "warn",
  testedVersion: "1.2.3",
  testedAt: "2026-04-24",
  missingApis: ["chrome.contextMenus"],
  knownIssues: ["Context menu entries are not surfaced in Milo yet."],
}
```

## Recommended Test Matrix

- Install from Chrome Web Store page.
- Load after app restart in the same Milo profile.
- Enable, disable, and remove from the Extensions page.
- Exercise content scripts on at least two regular HTTPS pages.
- Exercise background/runtime messaging if the extension uses it.
- Exercise popup/action UI if the extension depends on toolbar interactions.
- Confirm `action.default_popup`, `browser_action.default_popup`, or `page_action.default_popup`
  opens from the Milo toolbar when present.
- Confirm no unsupported API warnings appear in the Electron console.

## Policy

- Unknown Chrome Web Store extensions are allowed to install and shown as unreviewed.
- Existing store extensions keep loading unless they are explicitly marked as blocked.
- Local unpacked extensions are allowed for developer testing and shown as unreviewed.
