# RTL & Agent Tools — Project Guide

## Overview

VS Code extension that adds Right-to-Left (RTL) support **and** agent productivity tools for
AI chat agents: Claude Code, Codex (ChatGPT), Gemini Code Assist, GitHub Copilot Chat, and
Antigravity Chat. VS Code (and VS Code–based editors) only — there is no desktop or browser
build, and no self-update mechanism (update by editing the files and re-injecting, or by
rebuilding the VSIX).

## Architecture

Two main files:

| File | Runs in | Purpose |
|------|---------|---------|
| `src/extension.js` | VS Code main process | Extension host: auto-injection, status bar, commands |
| `rtl-for-vs-code-agents.js` | Webview / browser context | The injected script: RTL detection, DOM manipulation, CSS injection, toolbar tools |

`inject-plan-rtl.js` is a small script injected into Claude Code's Plan/Review document
webview. `debug-rewind.js` is a DevTools helper (not shipped logic).

### Injection mechanism

- **Claude Code / Codex / Gemini**: `extension.js` appends `rtl-for-vs-code-agents.js` to the
  agent's webview `index.js` (or `app_bundle.js`). A `.backup` copy of the original is kept,
  and an internal `MARKER` comment lets us detect / strip our injection.
- **Copilot**: uses the Custom CSS and JS Loader extension (`be5invis.vscode-custom-css`) to
  load the script into VS Code's main window.
- **Auto re-injection**: on extension activation and when the agent version changes, the
  script is restored + re-injected so RTL survives agent updates. This is NOT a network
  update — nothing is downloaded.

### How the injected script works

1. `init()` → injects `<style id="rtl-monaco-style">` with all CSS rules
2. `processElements()` — main loop that:
   - Scans chat messages via `CONFIG.chatSelectors`
   - Detects RTL with `shouldBeRTLText()` (first-strong-char + majority fallback)
   - Applies direction per element / per paragraph; keeps code blocks LTR
   - Processes inputs, history list, and injects the toolbar
3. A `MutationObserver` watches for new nodes and streaming text (re-applies after React re-renders)
4. `setInterval` handles Monaco inputs and toolbar re-injection

### Toolbar tools (in the injected script)

Nav ↑↓, Search 🔍, Auto-Resume ⏰, Copy conversation, Input-direction ⇔, Quick-prompts ⚡,
and YOLO 💪. State (YOLO delay, auto-resume on/off, quick prompts, border toggle, input-dir
mode) is persisted in `localStorage`, so changes take effect without a reload.

## Key DOM selectors by agent

### Claude Code (webview)
- User messages: `[class*="message_"][class*="userMessageContainer_"]`
- Agent messages: `[class*="timelineMessage_"]`, `[class*="root_"]`
- Input box: `div[contenteditable="plaintext-only"][role="textbox"]`
- Input footer: `[class*="inputFooter_"]`
- History: `[class*="sessionItem_"]`, `[class*="sessionName_"]`
- CSS classes have hashed suffixes (e.g. `inputFooter_gGYT1w`) — always match `[class*="prefix_"]`

### Codex (ChatGPT)
- User messages: `[data-content-search-unit-key$=":user"]`
- Composer: `.ProseMirror[data-codex-composer="true"]`, footer `.composer-footer`

### Gemini Code Assist
- Messages: `.history-item-text`
- Input: `.chat-submit-input[contenteditable="plaintext-only"]`

### Copilot / VS Code Chat (main window)
- User messages: `.interactive-request`; agent: `.interactive-response`
- Markdown: `.chat-markdown-part`; uses a virtualized Monaco list (only visible rows exist)

## Development workflow

1. Edit `rtl-for-vs-code-agents.js` (webview logic) or `src/extension.js` (host logic)
2. Run the **Check and Inject** command (or reload the extension host) to re-inject locally
3. Reload the agent window to see changes
4. For Copilot the file is loaded via Custom CSS, so changes apply on reload

## Build

```bash
npx @vscode/vsce package --no-dependencies    # Build a VSIX from this folder
```

Install the VSIX via `Ctrl+Shift+X` → `...` → Install from VSIX.

## Conventions

- Version lives in `package.json`; the VSIX manifest mirrors it
- Command/settings namespace `rtlForVsCodeAgents.*` is an internal id — keep it stable so
  saved user settings keep working
- The injected script runs in an IIFE `(function(){ ... })()` to avoid polluting global scope

## Gotchas

- Claude Code CSS classes have **hashed suffixes** that change between versions — never
  hardcode full class names, always use `[class*="prefix_"]`
- Copilot chat uses a **virtualized list** — only visible rows are in the DOM, so
  `scrollIntoView` / message navigation don't work reliably there
- React re-renders strip inline styles and `data-rtl-applied`; both the observer and the
  interval re-apply RTL to recover (e.g. after Rewind)
