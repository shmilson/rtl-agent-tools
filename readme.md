# RTL & Agent Tools

Right-to-Left (RTL) support **and** productivity tools for AI chat agents inside VS Code
(and VS Code–based editors such as Cursor and Antigravity).

Automatically detects Hebrew, Arabic, Persian and other RTL languages and applies proper
RTL styling — while keeping code blocks left-to-right. On top of RTL, it adds a toolbar of
agent helpers: auto-approve, auto-resume on rate limits, in-conversation search, message
navigation, conversation copy, and configurable quick-prompt buttons.

Supported agents: **Claude Code**, **Codex (ChatGPT)**, **Gemini Code Assist**,
**GitHub Copilot Chat**, and **Antigravity Chat**.

---

## Features

### RTL
- **Automatic RTL detection** for Hebrew, Arabic, Persian, Urdu, Syriac and more, using a
  first-strong-character heuristic with a majority fallback for mixed Hebrew/English text.
- **Per-paragraph direction** — each paragraph, list item and heading gets its own
  direction, so mixed conversations read correctly.
- **Code blocks stay LTR** — code is never mirrored.
- **Input box RTL** — the composer switches direction as you type (toggle uniform vs.
  per-line direction with the ⇔ button).
- **Plan / Review documents RTL** (Claude Code) — headings, lists, tables and blockquotes
  align right; code stays LTR.
- **Agent question popups, conversation history, and permission dialogs** all support RTL.

### Toolbar tools
The extension injects a small toolbar into the agent's input footer:

| Button | What it does |
|--------|--------------|
| ↑ / ↓ | Jump between your own messages (right-click to toggle the user-message border) |
| 🔍 | Search inside the conversation — highlights every match, navigate with ↑/↓ or Enter / Shift+Enter |
| ⏰ | **Auto-Resume** — when a rate-limit message appears, automatically continues once the quota resets |
| 📋 | Copy the entire conversation |
| ⇔ | Toggle input direction mode (uniform / per-line) |
| ⚡ | **Quick-prompt buttons** — insert your own saved snippets into the input box; right-click to manage them |
| 💪 | **YOLO mode** — auto-approve tool calls after a countdown, with a **NO!** cancel button (right-click for delay + "Auto Approve Plans") |

---

## Installation

1. Install the `.vsix` — in VS Code: `Ctrl+Shift+X` → `...` → **Install from VSIX...**
2. Restart VS Code.

That's it. RTL is injected automatically into Claude Code, Codex and Gemini — no manual
setup. The extension also re-injects automatically after the agent updates, so RTL keeps
working across agent versions.

### Copilot Chat (optional)
Copilot Chat requires the **Custom CSS and JS Loader** extension
(`be5invis.vscode-custom-css`):

1. Install the Custom CSS and JS Loader extension.
2. Run **RTL & Agent Tools: Configure Custom CSS Loader** (`Ctrl+Shift+P`).
3. Run **Enable Custom CSS and JS** (from the Custom CSS extension).
4. Restart VS Code.

---

## Commands

- **RTL & Agent Tools: Check and Inject** — manually inject RTL into Claude Code, Codex and Gemini
- **RTL & Agent Tools: Configure Custom CSS Loader** — set up Custom CSS for Copilot Chat
- **RTL & Agent Tools: Remove All Injections** — restore all original files (run before uninstalling)

## Settings

| Setting | Default | Description |
|---------|---------|-------------|
| `rtlForVsCodeAgents.autoInject` | `true` | Re-inject RTL into new agent versions |
| `rtlForVsCodeAgents.checkIntervalHours` | `0` | How often to re-check the agents (0 = startup only) |
| `rtlForVsCodeAgents.autoConfigureCustomCss` | `false` | Auto-configure Custom CSS Loader (Copilot) |
| `rtlForVsCodeAgents.userMessageBorder` | `true` | Border on user messages (toggle via right-click on ↑↓) |
| `rtlForVsCodeAgents.yoloCountdownSeconds` | `5` | YOLO countdown before auto-approve (0 = instant) |
| `rtlForVsCodeAgents.quickPrompts` | `[]` | Seed for the ⚡ quick-prompt buttons (manage via right-click on ⚡) |

> **Updates:** this build does **not** check for or download updates. To change anything,
> edit the extension files directly and re-inject (or rebuild the VSIX).

## Troubleshooting

| Problem | Solution |
|---------|----------|
| RTL not working in Claude Code / Codex / Gemini | Run **Check and Inject** |
| RTL not working in Copilot | Run **Configure Custom CSS Loader**, then **Enable Custom CSS and JS** |
| RTL stopped after a VS Code / agent update | Run **Check and Inject** and reload the window |

## Credits

This project is a fork / derivative work, released under the same license as its upstream:

- Based on **rtl-for-vs-code-agents** by **GuyRonnen** (GPL-3.0) — the RTL injection engine and
  the VS Code agent integration.
- Which in turn drew on the **claude-desktop-rtl-patch** by **shraga100**.
- The **YOLO mode** auto-approve-with-countdown idea originates from a snippet by **Chris Le** (chrisle).

Thanks to all of the above. See `NOTICE` for the attribution notice.

## License

GPL-3.0 — see [LICENSE.txt](LICENSE.txt). As a derivative of a GPL-3.0 work, this project is
also distributed under GPL-3.0, and the attribution above is preserved per the license.
