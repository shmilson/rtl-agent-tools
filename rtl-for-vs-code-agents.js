/**
 * RTL Support for VS Code AI Chat Agents
 * Supports Hebrew, Arabic, Persian, and other RTL languages
 *
 * Works with: GitHub Copilot Chat, Claude Code, Gemini CLI, and other AI chat extensions
 *
 * Installation:
 * 1. Install "Custom CSS and JS Loader" extension in VS Code
 * 2. Save this file somewhere permanent (e.g., C:\Users\YourName\vscode-custom\rtl-for-vscode-agents.js)
 * 3. Add to VS Code settings.json:
 *    "vscode_custom_css.imports": [
 *      "file:///C:/Users/YourName/vscode-custom/rtl-for-vscode-agents.js"
 *    ]
 * 4. Run command "Enable Custom CSS and JS" and restart VS Code
 * 
 * Note: VS Code will show "[Unsupported]" in title bar - this is normal
 */

(function() {
    'use strict';

    // localStorage can be missing or throw inside some webviews; one unguarded access used to
    // kill the whole script. Fall back to in-memory storage (settings then last for the session).
    const rtlStorage = (() => {
        const memory = new Map();
        const fallback = {
            getItem: k => (memory.has(k) ? memory.get(k) : null),
            setItem: (k, v) => { memory.set(k, String(v)); },
            removeItem: k => { memory.delete(k); }
        };
        try {
            const ls = window.localStorage;
            const probe = '__rtl_probe__';
            ls.setItem(probe, '1');
            ls.removeItem(probe);
            return {
                getItem: k => { try { return ls.getItem(k); } catch (e) { return fallback.getItem(k); } },
                setItem: (k, v) => { try { ls.setItem(k, v); } catch (e) { fallback.setItem(k, v); } },
                removeItem: k => { try { ls.removeItem(k); } catch (e) { fallback.removeItem(k); } }
            };
        } catch (e) {
            console.warn('RTL & Agent Tools: localStorage unavailable, using in-memory settings');
            return fallback;
        }
    })();

    // Track elements that had RTL applied — survives React re-renders that strip data attributes
    const rtlTrackedElements = new WeakSet();

    // Configuration
    const CONFIG = {
        // Font settings — system font first so Latin text keeps the agent's native look,
        // then graceful fallbacks with good Hebrew/Arabic/Persian coverage on macOS, Windows and Linux.
        fontFamily: 'system-ui, -apple-system, "Segoe UI", "Helvetica Neue", "Arial Hebrew", "Geeza Pro", "David", "Miriam", "Noto Sans Hebrew", "Noto Sans Arabic", "Tahoma", "Arial", sans-serif',
        fontSize: '14px',
        lineHeight: '1.6',

        // Selectors for chat content (add more as needed for different agents)
        chatSelectors: [
            // Copilot
            '.chat-markdown-part.rendered-markdown',
            '.chat-markdown-part',
            '.rendered-markdown',
            // Codex (OpenAI) — user messages
            '[data-content-search-unit-key$=":user"] .text-size-chat',
            // Codex (OpenAI) — assistant + Previous Messages (p/li/ol/ul with text-size-chat)
            'p.text-size-chat',
            'li.text-size-chat',
            'ol.text-size-chat',
            'ul.text-size-chat',
            // Claude Code (new version - using partial class matching for dynamic hashes)
            '[class*="message_"][class*="userMessageContainer_"]', // User message outer wrapper (has both classes)
            '[class*="timelineMessage_"]', // Agent/timeline messages container
            '[class*="root_"]', // Agent message content root (contains p, ul, ol, etc.)
            // Gemini CLI
            '.history-item-text',   // User and agent messages
            // Antigravity (Google)
            '.whitespace-pre-wrap', // User messages
            'div.prose.prose-sm',   // Agent messages
            // Claude Code - AskUserQuestion popup
            '[class*="questionTextLarge_"]',  // question text
            '[class*="optionLabel_"]',        // option label
            '[class*="optionDescription_"]',  // option description text
            '[class*="navTab_"]'              // navigation tab buttons (button has defined width → text-align works)
        ],

        // Selectors for input boxes
        inputSelectors: [
            // Codex composer input
            '.ProseMirror[data-codex-composer="true"]',
            // Claude Code input box
            'div[contenteditable="plaintext-only"][role="textbox"][aria-label="Message input"]',
            // Gemini CLI input box
            '.chat-submit-input[contenteditable="plaintext-only"]',
            // Copilot input box
            '.view-line',
            // Claude Code - AskUserQuestion "Other" free-text input
            '[class*="otherInput_"] [contenteditable="plaintext-only"]',
            // Claude Code - Permission request reject message input
            '[class*="rejectMessageInput_"] [contenteditable="plaintext-only"]'
        ],

        // Selectors for message containers
        messageContainerSelectors: [
            '[class*="message_"][class*="userMessageContainer_"]',
            '[class*="timelineMessage_"]',
            '[data-content-search-unit-key$=":user"]',
            '[data-content-search-unit-key$=":assistant"]',
            '.interactive-request',
            '.interactive-result',
            '.history-item-text',
            '.whitespace-pre-wrap',
            'div.prose.prose-sm'
        ],

        // How often to check for new content (ms)
        checkInterval: 500
    };

    // Constants for CSS-based RTL (Monaco Editor inputs)
    const RTL_STYLE_ID = 'rtl-monaco-style';
    const RTL_MODE_CLASS = 'rtl-mode-active';

    // RTL Unicode ranges
    const RTL_RANGES = [
        // Hebrew: U+0590 to U+05FF
        { start: 0x0590, end: 0x05FF },
        // Arabic: U+0600 to U+06FF
        { start: 0x0600, end: 0x06FF },
        // Arabic Supplement: U+0750 to U+077F
        { start: 0x0750, end: 0x077F },
        // Arabic Extended-A: U+08A0 to U+08FF
        { start: 0x08A0, end: 0x08FF },
        // Persian specific (within Arabic range)
        // Urdu specific (within Arabic range)
        // Syriac: U+0700 to U+074F
        { start: 0x0700, end: 0x074F },
        // Thaana (Maldivian): U+0780 to U+07BF
        { start: 0x0780, end: 0x07BF }
    ];

    /**
     * Check if a character is RTL
     */
    function isRTLChar(char) {
        const code = char.charCodeAt(0);
        return RTL_RANGES.some(range => code >= range.start && code <= range.end);
    }

    /**
     * Check if text contains RTL characters
     */
    function containsRTL(text) {
        if (!text) return false;
        for (let i = 0; i < text.length; i++) {
            if (isRTLChar(text[i])) {
                return true;
            }
        }
        return false;
    }

    /**
     * Smart RTL detection based on first strong character + majority fallback.
     * Scans for the first Unicode letter (skipping emojis, numbers, punctuation, bullets):
     * - First strong char is RTL → always true
     * - First strong char is LTR → true only if ≥30% of all letters are RTL
     * - No letters found → false
     *
     * Examples:
     *   "🎉 שלום"        → skip 🎉, space → ש is RTL → true
     *   "• פריט ראשון"   → skip •, space → פ is RTL → true
     *   "Hello עולם"     → H is LTR, RTL < 30% → false
     *   "1.1 Migration: הוספת שדות WhatsApp ו-table העדפות מטופל"
     *                    → M is LTR, but RTL ≥ 30% → true
     */
    function shouldBeRTLText(text) {
        if (!text) return false;
        const trimmed = text.trim();
        if (!trimmed) return false;

        let firstStrongIsRTL = null;
        let rtlCount = 0;
        let ltrCount = 0;

        for (const char of trimmed) {
            if (isRTLChar(char)) {
                rtlCount++;
                if (firstStrongIsRTL === null) firstStrongIsRTL = true;
            } else if (/\p{L}/u.test(char)) {
                ltrCount++;
                if (firstStrongIsRTL === null) firstStrongIsRTL = false;
            }
            // else: neutral character (emoji, number, punctuation, space) - skip
        }

        if (firstStrongIsRTL === null) return false; // no letters at all
        if (firstStrongIsRTL) return true; // first strong char is RTL → always RTL

        // First strong char is LTR - check if at least 30% of letters are RTL
        const totalLetters = rtlCount + ltrCount;
        return totalLetters > 0 && (rtlCount / totalLetters) >= 0.3;
    }

    /**
     * Get all text content from an element's subtree (excluding code blocks)
     */
    function getAllTextContent(element) {
        let fullText = '';

        // Skip code blocks
        if (element.tagName === 'PRE' || element.tagName === 'CODE') {
            return '';
        }

        // Skip attachment containers (Claude Code user message attachments)
        // These contain LTR text like filenames ("image.png", "711×170") that would
        // incorrectly cause the RTL detector to classify Hebrew messages as LTR
        if (element.matches && element.matches('[class*="userMessageAttachments_"], [class*="pill_"]')) {
            return '';
        }

        // Check direct text nodes
        for (const node of element.childNodes) {
            if (node.nodeType === Node.TEXT_NODE) {
                fullText += node.textContent + ' ';
            }
        }

        // Recursively check children
        for (const child of element.children) {
            // Skip code elements
            if (child.tagName === 'PRE' || child.tagName === 'CODE') {
                continue;
            }
            fullText += getAllTextContent(child) + ' ';
        }

        return fullText;
    }

    /**
     * Check if an element should be RTL based on its content
     */
    function shouldBeRTL(element) {
        const allText = getAllTextContent(element);
        return shouldBeRTLText(allText);
    }

    /**
     * Inject an RLM (Right-to-Left Mark) character at the start of an element
     * to anchor BiDi direction when the first child is an inline element with LTR text
     */
    function injectRLM(el) {
        const RLM = '\u200F';
        const first = el.firstChild;
        // Already injected?
        if (first && first.nodeType === Node.TEXT_NODE && first.textContent.startsWith(RLM)) return;
        el.insertBefore(document.createTextNode(RLM), first);
    }

    /**
     * Apply RTL styling to an element
     */
    function applyRTL(element) {
        element.style.direction = 'rtl';
        element.style.textAlign = 'right';
        element.style.unicodeBidi = 'isolate';
        element.style.fontFamily = CONFIG.fontFamily;
        element.setAttribute('data-rtl-applied', 'true');
        rtlTrackedElements.add(element);

        // Apply to buttons specifically to ensure both properties are set
        element.querySelectorAll('button').forEach(btn => {
            if (containsRTL(btn.textContent)) {
                btn.style.direction = 'rtl';
                btn.style.textAlign = 'right';
            }
        });

        // Apply to paragraphs - check each child independently
        element.querySelectorAll('p, li, h1, h2, h3, h4, h5, h6').forEach(el => {
            if (shouldBeRTLText(getAllTextContent(el))) {
                el.style.direction = 'rtl';
                el.style.textAlign = 'right';
                el.style.unicodeBidi = 'isolate';
                if (el.tagName === 'LI') {
                    el.style.listStylePosition = 'inside';
                }
                // Inject RLM (Right-to-Left Mark) at the start to anchor BiDi direction
                // when the first visible child is an inline element with LTR content
                injectRLM(el);
            }
        });

        // Apply to lists
        element.querySelectorAll('ul, ol').forEach(el => {
            if (containsRTL(el.textContent)) {
                el.style.direction = 'rtl';
                el.style.textAlign = 'right';
                el.style.paddingRight = '20px';
                el.style.paddingLeft = '0';
            }
        });

        // Keep code blocks LTR (including div.code for Copilot)
        element.querySelectorAll('div.code, pre, code').forEach(el => {
            el.style.direction = 'ltr';
            el.style.textAlign = 'left';
            el.style.unicodeBidi = 'embed';
        });
    }

    /**
     * Remove RTL styling from an element
     */
    function removeRTL(element) {
        element.style.direction = '';
        element.style.textAlign = '';
        element.style.fontFamily = '';
        element.removeAttribute('data-rtl-applied');
        rtlTrackedElements.delete(element);
    }

    /**
     * Apply RTL styling to input boxes.
     * In 'uniform' mode: entire box is RTL (direction: rtl, text-align: right).
     * In 'per-line' mode: browser auto-detects direction per paragraph (dir="auto").
     */
    function applyInputRTL(element) {
        const mode = getInputDirMode();
        element.style.fontFamily = CONFIG.fontFamily;
        element.setAttribute('data-rtl-input', 'true');

        if (mode === 'per-line') {
            element.setAttribute('dir', 'auto');
            element.style.direction = '';
            element.style.textAlign = '';
            element.style.unicodeBidi = 'plaintext';
        } else {
            element.removeAttribute('dir');
            element.style.direction = 'rtl';
            element.style.textAlign = 'right';
            element.style.unicodeBidi = 'plaintext';
        }

        // Sync RTL to mentionMirror sibling (Claude Code 2.1.76+)
        syncMirrorRTL(element, true);
    }

    /**
     * Remove RTL styling from input boxes
     */
    function removeInputRTL(element) {
        element.removeAttribute('dir');
        element.style.direction = 'ltr';
        element.style.textAlign = 'left';
        element.style.unicodeBidi = '';
        element.removeAttribute('data-rtl-input');

        // Sync LTR to mentionMirror sibling
        syncMirrorRTL(element, false);
    }

    /**
     * Sync RTL/LTR direction to the mentionMirror sibling element.
     * In Claude Code 2.1.76+, the input text is transparent (color: #0000)
     * and the visible text is rendered by a mentionMirror div with position: absolute.
     * Both must have matching direction for the caret to align with visible text.
     */
    function syncMirrorRTL(inputElement, isRTL) {
        const mirror = inputElement.parentElement &&
            inputElement.parentElement.querySelector('[class*="mentionMirror"]');
        if (!mirror) return;

        if (isRTL) {
            const mode = getInputDirMode();
            if (mode === 'per-line') {
                mirror.setAttribute('dir', 'auto');
                mirror.style.direction = '';
                mirror.style.textAlign = '';
                mirror.style.unicodeBidi = 'plaintext';
            } else {
                mirror.removeAttribute('dir');
                mirror.style.direction = 'rtl';
                mirror.style.textAlign = 'right';
                mirror.style.unicodeBidi = 'plaintext';
            }
            mirror.style.fontFamily = CONFIG.fontFamily;
        } else {
            mirror.removeAttribute('dir');
            mirror.style.direction = '';
            mirror.style.textAlign = '';
            mirror.style.unicodeBidi = '';
            mirror.style.fontFamily = '';
        }
    }

    /**
     * Inject CSS rules for RTL support in Monaco Editor (one-time operation)
     * This prevents flickering because CSS applies immediately when elements are created
     */
    function injectRTLStyles() {
        if (document.getElementById(RTL_STYLE_ID)) {
            return; // Already injected
        }

        const style = document.createElement('style');
        style.id = RTL_STYLE_ID;
        style.textContent = `
            /* RTL Mode for Monaco Editor Inputs (Copilot) */
            .${RTL_MODE_CLASS} .view-line,
            .${RTL_MODE_CLASS} .view-line[dir="ltr"] {
                direction: rtl !important;
                text-align: right !important;
                unicode-bidi: bidi-override !important;
                font-family: ${CONFIG.fontFamily} !important;
            }

            /* Counter Claude Code's * { direction: ltr; unicode-bidi: bidi-override } rule —
               apply broadly to all chat content, not just RTL-marked elements */
            [class*="message_"] *,
            [class*="timelineMessage_"] *,
            [class*="root_"] *,
            .rendered-markdown *,
            [class*="questionTextLarge_"] *,
            [class*="optionLabel_"] *,
            [class*="optionDescription_"] *,
            [data-content-search-unit-key$=":user"] *,
            [data-content-search-unit-key$=":assistant"] *,
            .text-size-chat,
            .text-size-chat *,
            [data-rtl-applied="true"],
            [data-rtl-applied="true"] * {
                unicode-bidi: plaintext !important;
            }
            [data-rtl-input="true"],
            [data-rtl-input="true"] + [class*="mentionMirror"] {
                unicode-bidi: plaintext !important;
            }
            /* Maintain code blocks as LTR within RTL containers */
            [data-rtl-applied="true"] pre,
            [data-rtl-applied="true"] pre *,
            [data-rtl-applied="true"] code,
            [data-rtl-applied="true"] code * {
                unicode-bidi: embed !important;
                direction: ltr !important;
                text-align: left !important;
            }

            /* Codex composer */
            [data-codex-composer="true"],
            [data-codex-composer="true"] p {
                unicode-bidi: plaintext !important;
            }
            [data-codex-composer="true"][data-rtl-input="true"],
            [data-codex-composer="true"][data-rtl-input="true"] p {
                direction: rtl !important;
                text-align: right !important;
            }

            /* Codex thread title and short labels */
            [style*="view-transition-name: header-title"] [data-rtl-applied="true"],
            [style*="view-transition-name: header-title"] [data-rtl-applied="true"] * {
                direction: rtl !important;
                text-align: right !important;
                unicode-bidi: plaintext !important;
            }
            [style*="view-transition-name: header-title"] .truncate[data-rtl-applied="true"] {
                white-space: normal !important;
                overflow: visible !important;
                text-overflow: clip !important;
            }

            /* Codex Previous Messages (collapsed section) — assistant paragraphs */
            .group.flex.min-w-0.flex-col > div > p.text-size-chat[data-rtl-applied="true"] {
                unicode-bidi: isolate !important;
            }

            /* Codex message text — override blue tint with neutral colors */
            .dark [data-content-search-unit-key$=":user"] .text-size-chat,
            html:not(.light) [data-content-search-unit-key$=":user"] .text-size-chat {
                color: #e3e3e3 !important;
            }
            .dark [data-content-search-unit-key$=":assistant"] .text-size-chat,
            .dark p.text-size-chat.leading-relaxed,
            html:not(.light) [data-content-search-unit-key$=":assistant"] .text-size-chat,
            html:not(.light) p.text-size-chat.leading-relaxed {
                color: #d0d0d0 !important;
            }
            .light [data-content-search-unit-key$=":user"] .text-size-chat {
                color: #1a1a1a !important;
            }
            .light [data-content-search-unit-key$=":assistant"] .text-size-chat,
            .light p.text-size-chat.leading-relaxed {
                color: #333333 !important;
            }

            /* Claude Code Chat History List - unconditional overrides */
            [class*="sessionName_"] {
                overflow: auto !important;
                text-overflow: unset !important;
                white-space: normal !important;
            }
            [class*="sessionItem_"] {
                height: auto !important;
                min-height: 28px !important;
                padding: 8px !important;
                border-bottom: 1px solid rgba(255, 255, 255, 0.15) !important;
                border-radius: 0 !important;
            }
            [class*="sessionItem_"]:last-child {
                border-bottom: none !important;
            }
            [class*="dropdown_"] {
                width: max(400px, 100vw - 32px) !important;
                max-height: 70% !important;
            }

            /* Claude Code Chat History Header Button - unconditional overrides */
            [class*="sessionsButtonText_"],
            [class*="titleTextInner_"] {
                white-space: normal !important;
                display: -webkit-box !important;
                -webkit-line-clamp: 3 !important;
                -webkit-box-orient: vertical !important;
                overflow: hidden !important;
            }
            [class*="sessionsButtonContent_"],
            [class*="titleGroup_"] {
                max-width: unset !important;
            }
            [class*="sessionsButton_"],
            [class*="titleText_"] {
                max-width: unset !important;
            }

            /* Expand collapsed user messages from ~3 lines to ~5 lines */
            [class*="userMessage_"] [class*="content_"][class*="collapsed_"] {
                max-height: 100px !important;
            }

            /* Codex user message collapse (Show more / Show less) */
            [data-content-search-unit-key$=":user"] .text-size-chat.rtl-collapsed {
                max-height: 6.5em;
                overflow: hidden;
                position: relative;
            }
            [data-content-search-unit-key$=":user"] .text-size-chat.rtl-collapsed::after {
                content: '';
                position: absolute;
                bottom: 0;
                left: 0;
                right: 0;
                height: 2em;
                background: linear-gradient(transparent, var(--token-input-background, #2a2a2a));
                pointer-events: none;
            }
            .rtl-show-more-btn {
                display: none;
                background: none;
                border: 1px solid rgba(255,255,255,0.2);
                border-radius: 8px;
                color: rgba(255,255,255,0.7);
                font-size: 11px;
                padding: 2px 10px;
                cursor: pointer;
                margin-top: 4px;
                transition: opacity 0.15s;
            }
            .rtl-show-more-btn:hover {
                background: rgba(255,255,255,0.08);
                color: rgba(255,255,255,0.9);
            }
            [data-content-search-unit-key$=":user"]:hover .rtl-show-more-btn,
            .rtl-show-more-btn.rtl-expanded {
                display: inline-block;
            }

            /* Claude Code UI accent borders */
            [class*="header_"]:has([class*="titleText_"]) {
                border: 2px solid #c8a2f8 !important;
            }
            /* User message borders — injected dynamically by applyUserMessageBorder() */

            /* Copilot / VS Code Chat — user message accent border (also dynamic) */

            /* Bright scrollbar for chat panel */
            * {
                scrollbar-color: rgba(255, 255, 255, 0.45) transparent !important;
                scrollbar-width: auto !important;
            }
            ::-webkit-scrollbar {
                width: 10px !important;
                height: 10px !important;
            }
            ::-webkit-scrollbar-track {
                background: transparent !important;
            }
            ::-webkit-scrollbar-thumb {
                background: rgba(255, 255, 255, 0.45) !important;
                border-radius: 5px !important;
            }
            ::-webkit-scrollbar-thumb:hover {
                background: rgba(255, 255, 255, 0.7) !important;
            }

            /* User message navigation buttons — inline in footer bar */
            #rtl-msg-nav {
                display: flex;
                gap: 2px;
                align-items: center;
            }
            #rtl-msg-nav button {
                width: 20px;
                height: 20px;
                border: none;
                border-radius: 4px;
                background: transparent;
                color: var(--app-secondary-foreground, rgba(255,255,255,0.5));
                cursor: pointer;
                display: flex;
                align-items: center;
                justify-content: center;
                padding: 0;
                opacity: 0.6;
                transition: opacity 0.15s, background 0.15s;
            }
            #rtl-msg-nav button:hover {
                opacity: 1;
                background: rgba(255,255,255,0.08);
            }
            #rtl-msg-nav button svg {
                width: 14px;
                height: 14px;
            }
            @keyframes rtl-nav-highlight {
                0%   { box-shadow: 0 0 0 0 rgba(249,131,131,0.7); }
                50%  { box-shadow: 0 0 8px 3px rgba(249,131,131,0.5); }
                100% { box-shadow: 0 0 0 0 rgba(249,131,131,0); }
            }
            .rtl-nav-highlight {
                animation: rtl-nav-highlight 0.9s ease-out !important;
            }

            /* Search match highlights inside messages */
            mark.rtl-search-mark {
                background: rgba(255, 200, 0, 0.35) !important;
                color: inherit !important;
                padding: 0 1px;
                border-radius: 2px;
            }
            mark.rtl-search-mark.rtl-search-mark-active {
                background: rgba(255, 165, 0, 0.7) !important;
                outline: 1px solid rgba(255, 140, 0, 0.9);
            }

            /* Input direction mode toggle button */
            #rtl-input-dir-btn {
                font-size: 13px;
                line-height: 1;
                opacity: 0.4;
                transition: opacity 0.2s, transform 0.15s;
            }
            #rtl-input-dir-btn.input-dir-perline {
                opacity: 1;
                transform: scale(1.15);
            }

            /* YOLO mode toggle button */
            #rtl-yolo-btn {
                font-size: 13px;
                line-height: 1;
                filter: grayscale(1);
                transition: filter 0.2s, transform 0.15s;
            }
            #rtl-yolo-btn.yolo-active {
                filter: grayscale(0);
                transform: scale(1.15);
            }
            @keyframes yolo-pulse {
                0%, 100% { filter: grayscale(0); transform: scale(1.15); }
                50%      { filter: grayscale(0); transform: scale(1.3); }
            }
            #rtl-yolo-btn.yolo-active {
                animation: yolo-pulse 1.5s ease-in-out infinite;
            }
            /* YOLO countdown overlay */
            .yolo-countdown {
                display: flex;
                align-items: center;
                gap: 6px;
                padding: 4px 8px;
                background: rgba(30, 30, 30, 0.92);
                border: 1px solid rgba(249, 131, 131, 0.5);
                border-radius: 6px;
                position: fixed;
                bottom: 60px;
                right: 16px;
                z-index: 99999;
                box-shadow: 0 2px 12px rgba(0,0,0,0.4);
                font-family: system-ui, sans-serif;
                font-size: 12px;
                color: rgba(255,255,255,0.85);
            }
            .yolo-countdown-bar-track {
                width: 120px;
                height: 6px;
                background: rgba(255,255,255,0.1);
                border-radius: 3px;
                overflow: hidden;
            }
            .yolo-countdown-bar-fill {
                height: 100%;
                background: linear-gradient(90deg, #f98383, #ff6b6b);
                border-radius: 3px;
                transition: width 0.1s linear;
            }
            .yolo-countdown-no {
                background: #d32f2f;
                color: #fff;
                border: none;
                border-radius: 4px;
                padding: 2px 8px;
                font-size: 11px;
                font-weight: 700;
                cursor: pointer;
                white-space: nowrap;
            }
            .yolo-countdown-no:hover {
                background: #b71c1c;
            }

            /* YOLO settings popup (right-click on 💪) */
            .yolo-settings-popup {
                position: fixed;
                z-index: 100000;
                background: var(--vscode-menu-background, #252526);
                border: 2px solid rgba(200, 200, 200, 0.45);
                border-radius: 6px;
                padding: 8px 10px;
                box-shadow: 0 4px 16px rgba(0,0,0,0.5);
                font-family: system-ui, sans-serif;
                font-size: 12px;
                color: var(--vscode-menu-foreground, rgba(255,255,255,0.85));
                display: flex;
                flex-direction: column;
                align-items: stretch;
                gap: 8px;
                min-width: 220px;
            }
            .yolo-settings-row {
                display: flex;
                align-items: center;
                gap: 6px;
                white-space: nowrap;
            }
            .yolo-settings-check {
                display: flex;
                align-items: center;
                gap: 8px;
                cursor: pointer;
                user-select: none;
            }
            .yolo-settings-check input[type="checkbox"] {
                margin: 0;
            }
            .yolo-settings-popup input[type="number"] {
                width: 48px;
                padding: 2px 4px;
                border: 1px solid var(--vscode-input-border, #3c3c3c);
                border-radius: 3px;
                background: var(--vscode-input-background, #1e1e1e);
                color: var(--vscode-input-foreground, #ccc);
                font-size: 12px;
                text-align: center;
            }
            .yolo-settings-popup .yolo-settings-hint {
                opacity: 0.55;
                font-size: 10px;
            }

            /* Codex fallback: native per-paragraph direction where our selectors miss */
            html.rtl-codex-fallback :where(p, li, ol, ul, h1, h2, h3, h4, h5, h6, blockquote, td, th):not([data-rtl-applied]) {
                unicode-bidi: plaintext;
            }
            html.rtl-codex-fallback :where(pre, code) :where(p, li, span, div) {
                unicode-bidi: normal;
            }

            /* Claude Code settings menu (⚙️) */
            .rtl-cc-popup {
                width: 340px;
                max-width: 92vw;
                gap: 6px;
                text-align: right;
            }
            .rtl-cc-status {
                font-size: 10px;
                opacity: 0.6;
                min-height: 13px;
            }
            .rtl-cc-status.rtl-cc-status-error {
                opacity: 1;
                color: var(--vscode-errorForeground, #f48771);
            }
            .rtl-cc-search,
            .rtl-cc-textbox input {
                padding: 3px 6px;
                border: 1px solid var(--vscode-input-border, #3c3c3c);
                border-radius: 3px;
                background: var(--vscode-input-background, #1e1e1e);
                color: var(--vscode-input-foreground, #ccc);
                font-size: 12px;
                font-family: inherit;
            }
            .rtl-cc-body {
                display: flex;
                flex-direction: column;
                gap: 10px;
                max-height: 60vh;
                overflow-y: auto;
                padding-left: 4px;
            }
            .rtl-cc-group {
                display: flex;
                flex-direction: column;
                gap: 2px;
            }
            .rtl-cc-group-title {
                font-size: 10px;
                font-weight: 700;
                opacity: 0.55;
                padding-bottom: 2px;
                border-bottom: 1px solid rgba(128,128,128,0.25);
                margin-bottom: 2px;
            }
            .rtl-cc-row {
                display: flex;
                align-items: center;
                justify-content: space-between;
                gap: 8px;
                padding: 3px 0;
            }
            .rtl-cc-text {
                display: flex;
                flex-direction: column;
                line-height: 1.25;
                cursor: help;
                min-width: 0;
            }
            .rtl-cc-label {
                font-size: 12px;
            }
            .rtl-cc-key {
                font-size: 9px;
                opacity: 0.45;
                direction: ltr;
                text-align: right;
                font-family: var(--vscode-editor-font-family, monospace);
            }
            .rtl-cc-row.rtl-cc-unset .rtl-cc-label {
                opacity: 0.6;
            }
            .rtl-cc-select {
                max-width: 150px;
                padding: 2px 4px;
                border: 1px solid var(--vscode-input-border, #3c3c3c);
                border-radius: 3px;
                background: var(--vscode-dropdown-background, #1e1e1e);
                color: var(--vscode-dropdown-foreground, #ccc);
                font-size: 11px;
                direction: ltr;
            }
            .rtl-cc-textbox {
                display: flex;
                gap: 4px;
            }
            .rtl-cc-textbox input {
                width: 96px;
            }
            .rtl-cc-textbox button {
                padding: 2px 8px;
                border: 1px solid rgba(128,128,128,0.4);
                border-radius: 3px;
                background: transparent;
                color: inherit;
                font-size: 11px;
                cursor: pointer;
            }
            .rtl-cc-switch {
                position: relative;
                flex: 0 0 auto;
                width: 32px;
                height: 18px;
                cursor: pointer;
            }
            .rtl-cc-switch input {
                position: absolute;
                opacity: 0;
                width: 0;
                height: 0;
            }
            .rtl-cc-knob {
                position: absolute;
                inset: 0;
                border-radius: 9px;
                background: rgba(128,128,128,0.35);
                transition: background 0.15s ease;
            }
            .rtl-cc-knob::before {
                content: "";
                position: absolute;
                top: 2px;
                right: 2px;
                width: 14px;
                height: 14px;
                border-radius: 50%;
                background: #fff;
                transition: transform 0.15s ease;
            }
            .rtl-cc-switch input:checked + .rtl-cc-knob {
                background: var(--vscode-button-background, #0e639c);
            }
            .rtl-cc-switch input:checked + .rtl-cc-knob::before {
                transform: translateX(-14px);
            }
            .rtl-cc-switch input:focus-visible + .rtl-cc-knob {
                outline: 1px solid var(--vscode-focusBorder, #007fd4);
                outline-offset: 1px;
            }
            .rtl-cc-foot {
                font-size: 9px;
                opacity: 0.45;
            }

            /* Quick-prompt buttons popup (⚡) */
            .rtl-qp-popup {
                min-width: 220px;
                max-width: 340px;
                display: flex;
                flex-direction: column;
                gap: 8px;
            }
            .rtl-qp-title {
                font-size: 12px;
                font-weight: 600;
                opacity: 0.85;
            }
            .rtl-qp-chips {
                display: flex;
                flex-wrap: wrap;
                gap: 6px;
            }
            .rtl-qp-chip {
                background: var(--vscode-button-secondaryBackground, #3a3d41);
                color: var(--vscode-button-secondaryForeground, #fff);
                border: none;
                border-radius: 12px;
                padding: 4px 10px;
                font-size: 12px;
                cursor: pointer;
                max-width: 100%;
                white-space: nowrap;
                overflow: hidden;
                text-overflow: ellipsis;
            }
            .rtl-qp-chip:hover {
                background: var(--vscode-button-background, #0e639c);
            }
            .rtl-qp-empty {
                font-size: 12px;
                opacity: 0.6;
            }
            .rtl-qp-manage,
            .rtl-qp-add,
            .rtl-qp-save {
                background: transparent;
                color: var(--vscode-textLink-foreground, #4daafc);
                border: 1px solid var(--vscode-menu-border, #454545);
                border-radius: 4px;
                padding: 3px 8px;
                font-size: 12px;
                cursor: pointer;
            }
            .rtl-qp-manage:hover,
            .rtl-qp-add:hover,
            .rtl-qp-save:hover {
                background: var(--vscode-toolbar-hoverBackground, rgba(255,255,255,0.08));
            }
            .rtl-qp-save {
                color: var(--vscode-button-foreground, #fff);
                background: var(--vscode-button-background, #0e639c);
                border-color: transparent;
            }
            .rtl-qp-list {
                display: flex;
                flex-direction: column;
                gap: 6px;
                max-height: 260px;
                overflow-y: auto;
            }
            .rtl-qp-row {
                display: flex;
                gap: 4px;
                align-items: center;
            }
            .rtl-qp-label-input {
                width: 64px;
                flex: 0 0 64px;
            }
            .rtl-qp-text-input {
                flex: 1 1 auto;
                min-width: 0;
            }
            .rtl-qp-label-input,
            .rtl-qp-text-input {
                background: var(--vscode-input-background, #3c3c3c);
                color: var(--vscode-input-foreground, #ccc);
                border: 1px solid var(--vscode-input-border, #555);
                border-radius: 3px;
                padding: 3px 6px;
                font-size: 12px;
            }
            .rtl-qp-del {
                background: transparent;
                color: #ff6b6b;
                border: none;
                cursor: pointer;
                font-size: 13px;
                padding: 2px 4px;
            }
            .rtl-qp-btnrow {
                display: flex;
                gap: 6px;
                justify-content: space-between;
            }

            /* Border toggle popup (right-click on ↑↓) */
            .rtl-border-popup {
                position: fixed;
                z-index: 100000;
                background: var(--vscode-menu-background, #252526);
                border: 1px solid var(--vscode-menu-border, #454545);
                border-radius: 6px;
                padding: 8px 10px;
                box-shadow: 0 4px 16px rgba(0,0,0,0.5);
                font-family: system-ui, sans-serif;
                font-size: 12px;
                color: var(--vscode-menu-foreground, rgba(255,255,255,0.85));
                display: flex;
                align-items: center;
                gap: 8px;
                white-space: nowrap;
                cursor: pointer;
                user-select: none;
            }
            .rtl-border-popup:hover {
                background: var(--vscode-menu-selectionBackground, #094771);
            }
            .rtl-border-toggle {
                width: 32px;
                height: 16px;
                border-radius: 8px;
                background: rgba(255,255,255,0.15);
                position: relative;
                transition: background 0.2s;
                flex-shrink: 0;
            }
            .rtl-border-toggle.on {
                background: #4caf50;
            }
            .rtl-border-toggle::after {
                content: '';
                position: absolute;
                width: 12px;
                height: 12px;
                border-radius: 50%;
                background: #fff;
                top: 2px;
                left: 2px;
                transition: transform 0.2s;
            }
            .rtl-border-toggle.on::after {
                transform: translateX(16px);
            }

            /* Search in conversation — button + top bar */
            #rtl-search-btn {
                font-size: 13px;
                line-height: 1;
                opacity: 0.6;
                transition: opacity 0.15s;
            }
            #rtl-search-btn:hover { opacity: 1; }

            #rtl-search-bar {
                position: fixed;
                bottom: 60px;
                right: 16px;
                z-index: 100000;
                display: flex;
                align-items: center;
                gap: 6px;
                padding: 6px 8px;
                background: var(--vscode-editorWidget-background, #252526);
                border: 2px solid rgba(200, 200, 200, 0.45);
                border-radius: 6px;
                box-shadow: 0 4px 16px rgba(0,0,0,0.5);
                font-family: system-ui, sans-serif;
                font-size: 12px;
                color: var(--vscode-editorWidget-foreground, rgba(255,255,255,0.85));
                direction: ltr;
            }
            #rtl-search-bar input.rtl-search-input {
                width: 220px;
                padding: 3px 6px;
                border: 1px solid var(--vscode-input-border, #3c3c3c);
                border-radius: 3px;
                background: var(--vscode-input-background, #1e1e1e);
                color: var(--vscode-input-foreground, #ccc);
                font-size: 12px;
                outline: none;
            }
            #rtl-search-bar input.rtl-search-input:focus {
                border-color: var(--vscode-focusBorder, #007fd4);
            }
            #rtl-search-bar .rtl-search-counter {
                min-width: 42px;
                text-align: center;
                opacity: 0.75;
                font-variant-numeric: tabular-nums;
            }
            #rtl-search-bar .rtl-search-counter.no-matches { color: #f98383; }
            #rtl-search-bar button.rtl-search-btn {
                width: 22px; height: 22px;
                border: none; border-radius: 3px;
                background: transparent;
                color: var(--vscode-editorWidget-foreground, rgba(255,255,255,0.8));
                cursor: pointer;
                display: flex; align-items: center; justify-content: center;
                padding: 0; opacity: 0.7;
            }
            #rtl-search-bar button.rtl-search-btn:hover {
                opacity: 1;
                background: var(--vscode-toolbar-hoverBackground, rgba(255,255,255,0.08));
            }
            #rtl-search-bar button.rtl-search-btn:disabled {
                opacity: 0.3; cursor: default; background: transparent;
            }
            #rtl-search-bar button.rtl-search-btn svg { width: 12px; height: 12px; }
            #rtl-search-bar button.rtl-search-close { font-size: 16px; line-height: 1; }

            /* Copy Message Button */
            .rtl-copy-msg-btn {
                position: absolute;
                top: 6px;
                right: 6px;
                z-index: 100;
                width: 24px;
                height: 24px;
                border: 1px solid var(--vscode-editorWidget-border, rgba(255, 255, 255, 0.15));
                border-radius: 4px;
                background: var(--vscode-editorWidget-background, #252526);
                color: var(--vscode-editorWidget-foreground, rgba(255, 255, 255, 0.7));
                cursor: pointer;
                opacity: 0;
                transition: opacity 0.2s, background 0.1s, color 0.1s;
                display: flex;
                align-items: center;
                justify-content: center;
                padding: 0;
            }
            
            /* Show on message hover */
            [class*="message_"]:hover .rtl-copy-msg-btn,
            [class*="timelineMessage_"]:hover .rtl-copy-msg-btn,
            [data-content-search-unit-key]:hover .rtl-copy-msg-btn,
            .interactive-request:hover .rtl-copy-msg-btn,
            .interactive-result:hover .rtl-copy-msg-btn,
            .history-item-text:hover .rtl-copy-msg-btn,
            .whitespace-pre-wrap:hover .rtl-copy-msg-btn,
            div.prose.prose-sm:hover .rtl-copy-msg-btn {
                opacity: 1;
            }
            
            .rtl-copy-msg-btn:hover {
                background: var(--vscode-toolbar-hoverBackground, rgba(255, 255, 255, 0.1));
                color: var(--vscode-editorWidget-foreground, #fff);
            }
            
            .rtl-copy-msg-btn svg {
                width: 14px;
                height: 14px;
                pointer-events: none;
            }
            
            /* Align button to the left if the container has RTL direction applied */
            [data-rtl-applied="true"] .rtl-copy-msg-btn,
            [class*="userMessageContainer_"][style*="direction: rtl"] .rtl-copy-msg-btn,
            [class*="timelineMessage_"][style*="direction: rtl"] .rtl-copy-msg-btn,
            [data-content-search-unit-key$=":user"][style*="direction: rtl"] .rtl-copy-msg-btn,
            [data-content-search-unit-key$=":assistant"][style*="direction: rtl"] .rtl-copy-msg-btn,
            .whitespace-pre-wrap[style*="direction: rtl"] .rtl-copy-msg-btn,
            [style*="direction: rtl"] .rtl-copy-msg-btn {
                right: auto !important;
                left: 6px !important;
            }

            /* Auto-Resume button and states */
            #rtl-auto-resume-btn {
                font-size: 13px;
                line-height: 1;
                transition: transform 0.15s, color 0.15s, background-color 0.15s;
            }
            #rtl-auto-resume-btn.auto-resume-active {
                opacity: 1;
                background: rgba(46, 204, 113, 0.2) !important;
                color: #2ecc71 !important;
            }
            #rtl-auto-resume-btn.auto-resume-timer-running {
                animation: rtl-resume-pulse 2s infinite;
                background: rgba(231, 76, 60, 0.2) !important;
                color: #e74c3c !important;
            }
            @keyframes rtl-resume-pulse {
                0%, 100% { box-shadow: 0 0 0 0 rgba(231, 76, 60, 0.4); transform: scale(1); }
                50% { box-shadow: 0 0 8px 4px rgba(231, 76, 60, 0.6); transform: scale(1.15); }
            }

        `;
        document.head.appendChild(style);
    }

    /**
     * Find the stable Monaco editor parent for a view-line element
     * This parent persists across keystrokes, unlike .view-line which is recreated
     */
    function findMonacoParent(viewLineElement) {
        // Look for the monaco-editor container (most stable)
        let parent = viewLineElement.closest('.monaco-editor');
        if (parent) return parent;

        // Fallback to view-lines
        parent = viewLineElement.closest('.view-lines');
        return parent || viewLineElement.parentElement;
    }

    /**
     * Process Monaco Editor input boxes for RTL
     * Uses CSS class toggle on parent instead of inline styles to prevent flickering
     */
    function processMonacoInputs() {
        const viewLines = document.querySelectorAll('.view-line');

        viewLines.forEach(viewLine => {
            const text = viewLine.textContent || '';
            const hasRTL = containsRTL(text);
            const monacoParent = findMonacoParent(viewLine);

            if (!monacoParent) return;

            const isCurrentlyRTL = monacoParent.classList.contains(RTL_MODE_CLASS);

            if (hasRTL && !isCurrentlyRTL) {
                monacoParent.classList.add(RTL_MODE_CLASS);
            } else if (!hasRTL && isCurrentlyRTL) {
                monacoParent.classList.remove(RTL_MODE_CLASS);
            }
        });
    }

    /**
     * Process input boxes
     */
    function processInputs() {
        const selector = CONFIG.inputSelectors.join(', ');
        const inputs = document.querySelectorAll(selector);

        inputs.forEach(input => {
            // Get the current text content
            const text = input.textContent || input.innerText || '';
            const hasRTL = containsRTL(text);
            const wasRTL = input.getAttribute('data-rtl-input') === 'true';

            if (hasRTL && !wasRTL) {
                applyInputRTL(input);
            } else if (!hasRTL && wasRTL) {
                removeInputRTL(input);
            }

            // Add event listener for real-time changes if not already added
            if (!input.hasAttribute('data-rtl-listener')) {
                input.setAttribute('data-rtl-listener', 'true');

                // Listen for input events
                input.addEventListener('input', function() {
                    const currentText = this.textContent || this.innerText || '';
                    const needsRTL = containsRTL(currentText);

                    if (needsRTL) {
                        applyInputRTL(this);
                    } else {
                        removeInputRTL(this);
                    }
                });
            }
        });
    }

    /**
     * User message navigation — track current index
     */
    let navCurrentIndex = -1;

    // ─── Search in conversation — state ───────────────────────────
    let searchMatches = [];
    let searchCurrentIndex = -1;
    let searchDebounceId = null;
    let searchQuery = '';

    // ─── YOLO Mode (auto-approve with countdown) ──────────────────
    let yoloPollId = null;
    let yoloRunning = false;
    let yoloCountdownActive = false;  // true while a countdown is in progress
    let yoloCancelledBtn = null;      // ref to the button the user cancelled — skip until it leaves DOM
    let yoloCountdownCancel = null;   // cancel function for active countdown

    // ─── Auto-Resume Mode ──────────────────────────────────────────
    let autoResumeActive = rtlStorage.getItem('rtl-auto-resume-active') === 'true';
    let autoResumeTimerId = null;
    let autoResumeTargetTime = null; // timestamp (ms) when reset happens + 60,000 buffer
    const YOLO_LS_KEY = 'rtl-yolo-delay-ms';
    const YOLO_AUTO_APPROVE_PLANS_LS_KEY = 'rtl-yolo-auto-approve-plans';
    const YOLO_POLL_MS = 500;
    const BORDER_LS_KEY = 'rtl-user-msg-border';
    const INPUT_DIR_MODE_LS_KEY = 'rtl-input-dir-mode'; // 'uniform' (default) or 'per-line'

    // Seed localStorage from injected config (only if not already set by user)
    if (rtlStorage.getItem(YOLO_LS_KEY) === null) {
        const seed = (window.__RTL_CONFIG__ && typeof window.__RTL_CONFIG__.yoloDelayMs === 'number')
            ? window.__RTL_CONFIG__.yoloDelayMs : 5000;
        rtlStorage.setItem(YOLO_LS_KEY, String(seed));
    }
    if (rtlStorage.getItem(YOLO_AUTO_APPROVE_PLANS_LS_KEY) === null) {
        rtlStorage.setItem(YOLO_AUTO_APPROVE_PLANS_LS_KEY, 'false');
    }
    if (rtlStorage.getItem(BORDER_LS_KEY) === null) {
        const seed = (window.__RTL_CONFIG__ && typeof window.__RTL_CONFIG__.userMessageBorder === 'boolean')
            ? window.__RTL_CONFIG__.userMessageBorder : true;
        rtlStorage.setItem(BORDER_LS_KEY, String(seed));
    }
    if (rtlStorage.getItem(INPUT_DIR_MODE_LS_KEY) === null) {
        const seed = (window.__RTL_CONFIG__ && window.__RTL_CONFIG__.inputDirMode)
            ? window.__RTL_CONFIG__.inputDirMode : 'uniform';
        rtlStorage.setItem(INPUT_DIR_MODE_LS_KEY, seed);
    }

    /** Read YOLO delay dynamically — changes take effect on next poll without reload */
    function getYoloDelayMs() {
        const v = parseInt(rtlStorage.getItem(YOLO_LS_KEY), 10);
        return isNaN(v) ? 5000 : v;
    }
    function setYoloDelayMs(ms) {
        rtlStorage.setItem(YOLO_LS_KEY, String(Math.max(0, ms)));
    }
    function getYoloAutoApprovePlans() {
        return rtlStorage.getItem(YOLO_AUTO_APPROVE_PLANS_LS_KEY) === 'true';
    }
    function setYoloAutoApprovePlans(on) {
        rtlStorage.setItem(YOLO_AUTO_APPROVE_PLANS_LS_KEY, String(!!on));
    }

    // ─── Input direction mode toggle ─────────────────────────────────
    // Default is 'per-line': uses dir="auto" + unicode-bidi:plaintext so each line picks
    // its own direction (correct for mixed Hebrew/English coding prompts). An explicit
    // saved 'uniform' still forces a single RTL direction for the whole input.
    function getInputDirMode() {
        return rtlStorage.getItem(INPUT_DIR_MODE_LS_KEY) === 'uniform' ? 'uniform' : 'per-line';
    }
    function setInputDirMode(mode) {
        rtlStorage.setItem(INPUT_DIR_MODE_LS_KEY, mode);
        reapplyInputDirection();
    }

    /** Re-apply direction to all active inputs after mode toggle */
    function reapplyInputDirection() {
        document.querySelectorAll(CONFIG.inputSelectors.join(', ')).forEach(input => {
            if (input.getAttribute('data-rtl-input') === 'true') {
                applyInputRTL(input);
            }
        });
    }

    // ─── User message border toggle ──────────────────────────────────
    function getUserMessageBorder() {
        return rtlStorage.getItem(BORDER_LS_KEY) !== 'false';
    }
    function setUserMessageBorder(on) {
        rtlStorage.setItem(BORDER_LS_KEY, String(on));
        applyUserMessageBorder();
    }

    /** Dynamically inject or remove the user message border style */
    function applyUserMessageBorder() {
        const STYLE_ID = 'rtl-user-msg-border-style';
        let el = document.getElementById(STYLE_ID);
        const enabled = getUserMessageBorder();

        if (enabled) {
            if (!el) {
                el = document.createElement('style');
                el.id = STYLE_ID;
                el.textContent = `
                    [class*="userMessage_"] {
                        border: 2px solid #f98383 !important;
                    }
                    .interactive-request .chat-markdown-part {
                        border: 2px solid #f98383 !important;
                        border-radius: 4px;
                        padding: 4px 8px;
                    }
                    [data-content-search-unit-key$=":user"] .rounded-2xl {
                        border: 2px solid #f98383 !important;
                    }
                `;
                document.head.appendChild(el);
            }
        } else {
            if (el) el.remove();
        }
    }

    // Apply on startup
    applyUserMessageBorder();
    // ────────────────────────────────────────────────────────────────

    // ─── Quick-prompt buttons (⚡) ────────────────────────────────────
    const QUICK_PROMPTS_LS_KEY = 'rtl-quick-prompts';

    function getQuickPrompts() {
        const raw = rtlStorage.getItem(QUICK_PROMPTS_LS_KEY);
        if (raw !== null) {
            try {
                const arr = JSON.parse(raw);
                if (Array.isArray(arr)) return arr;
            } catch (e) { /* corrupt — fall through and re-seed */ }
        }
        // Seed once: from the VS Code setting if provided, otherwise a few handy defaults.
        let seed = (window.__RTL_CONFIG__ && Array.isArray(window.__RTL_CONFIG__.quickPrompts))
            ? window.__RTL_CONFIG__.quickPrompts : [];
        if (!seed.length) {
            seed = [
                { label: 'המשך', text: 'המשך' },
                { label: 'עברית', text: 'ענה בבקשה בעברית.' },
                { label: 'טסטים', text: 'כתוב טסטים אוטומטיים לקוד הזה.' }
            ];
        }
        seed = seed
            .filter(p => p && typeof p.text === 'string' && p.text.length)
            .map(p => ({ label: String(p.label || p.text).slice(0, 24), text: String(p.text) }));
        rtlStorage.setItem(QUICK_PROMPTS_LS_KEY, JSON.stringify(seed));
        return seed;
    }

    function setQuickPrompts(arr) {
        rtlStorage.setItem(QUICK_PROMPTS_LS_KEY, JSON.stringify(Array.isArray(arr) ? arr : []));
    }

    /** Press Enter in an agent input box, then click its send button as a fallback. */
    function submitInput(inputEl) {
        for (const type of ['keydown', 'keypress', 'keyup']) {
            inputEl.dispatchEvent(new KeyboardEvent(type, {
                bubbles: true, cancelable: true, key: 'Enter', code: 'Enter', keyCode: 13
            }));
        }
        const form = inputEl.closest('form');
        if (form) {
            const submitBtn = form.querySelector('button[type="submit"]');
            if (submitBtn) submitBtn.click();
        } else {
            const footer = inputEl.closest('[class*="inputFooter_"]') || inputEl.closest('.composer-footer');
            if (footer) {
                const submitBtn = footer.querySelector('button[class*="footerButtonPrimary_"]') || footer.querySelector('button[type="submit"]');
                if (submitBtn) submitBtn.click();
            }
        }
    }

    /** Find the active agent input box (Claude Code / Codex / Gemini / Copilot). */
    function findActiveInput() {
        const inputs = Array.from(document.querySelectorAll(CONFIG.inputSelectors.join(', ')));
        if (!inputs.length) return null;
        const focused = inputs.find(el => el === document.activeElement);
        if (focused) return focused;
        return inputs.reverse().find(el => el.offsetParent !== null) || inputs[0];
    }

    /** Insert text into the active agent input box at the caret. Does NOT send. */
    function insertQuickPrompt(text) {
        const inputEl = findActiveInput();
        if (!inputEl) {
            console.warn('⚡ Quick-prompt: no input box found.');
            return;
        }
        inputEl.focus();
        let inserted = false;
        try {
            inserted = document.execCommand('insertText', false, text);
        } catch (e) { inserted = false; }
        if (!inserted) {
            if (inputEl.tagName === 'TEXTAREA' || inputEl.tagName === 'INPUT') {
                inputEl.value = (inputEl.value ? inputEl.value + ' ' : '') + text;
            } else {
                inputEl.textContent = (inputEl.textContent ? inputEl.textContent + ' ' : '') + text;
            }
        }
        inputEl.dispatchEvent(new Event('input', { bubbles: true }));
        if (containsRTL(inputEl.textContent || inputEl.value || '')) applyInputRTL(inputEl);
    }

    function onQpOutsideClick(ev) {
        const popup = document.querySelector('.rtl-qp-popup');
        if (popup && !popup.contains(ev.target) && ev.target.id !== 'rtl-quick-prompts-btn') {
            closeQuickPromptsPopup();
        }
    }
    function closeQuickPromptsPopup() {
        const ex = document.querySelector('.rtl-qp-popup');
        if (ex) ex.remove();
        document.removeEventListener('mousedown', onQpOutsideClick, true);
    }

    function showQuickPromptsPopup(mode) {
        if (document.querySelector('.rtl-qp-popup')) { closeQuickPromptsPopup(); return; }

        const popup = document.createElement('div');
        popup.className = 'rtl-qp-popup yolo-settings-popup';
        popup.style.bottom = '40px';
        popup.style.right = '16px';

        function render(currentMode) {
            popup.innerHTML = '';

            if (currentMode === 'manage') {
                const title = document.createElement('div');
                title.className = 'rtl-qp-title';
                title.textContent = 'כפתורי הוראה — עריכה';
                popup.appendChild(title);

                const list = document.createElement('div');
                list.className = 'rtl-qp-list';
                popup.appendChild(list);

                function addRow(p) {
                    const row = document.createElement('div');
                    row.className = 'rtl-qp-row';
                    const lab = document.createElement('input');
                    lab.type = 'text'; lab.placeholder = 'תווית'; lab.value = p.label || '';
                    lab.className = 'rtl-qp-label-input';
                    const txt = document.createElement('input');
                    txt.type = 'text'; txt.placeholder = 'הטקסט שיוזרק'; txt.value = p.text || '';
                    txt.className = 'rtl-qp-text-input';
                    const del = document.createElement('button');
                    del.className = 'rtl-qp-del'; del.textContent = '✕'; del.title = 'מחק';
                    del.addEventListener('click', (e) => { e.preventDefault(); e.stopPropagation(); row.remove(); });
                    row.appendChild(lab); row.appendChild(txt); row.appendChild(del);
                    list.appendChild(row);
                }
                getQuickPrompts().forEach(addRow);

                const btnRow = document.createElement('div');
                btnRow.className = 'rtl-qp-btnrow';
                const addBtn = document.createElement('button');
                addBtn.className = 'rtl-qp-add'; addBtn.textContent = '＋ הוסף';
                addBtn.addEventListener('click', (e) => { e.preventDefault(); e.stopPropagation(); addRow({ label: '', text: '' }); });
                const saveBtn = document.createElement('button');
                saveBtn.className = 'rtl-qp-save'; saveBtn.textContent = 'שמור';
                saveBtn.addEventListener('click', (e) => {
                    e.preventDefault(); e.stopPropagation();
                    const next = Array.from(list.querySelectorAll('.rtl-qp-row')).map(r => {
                        const t = r.querySelector('.rtl-qp-text-input').value.trim();
                        const l = r.querySelector('.rtl-qp-label-input').value.trim();
                        return { label: (l || t).slice(0, 24), text: t };
                    }).filter(p => p.text.length);
                    setQuickPrompts(next);
                    render('pick');
                });
                btnRow.appendChild(addBtn);
                btnRow.appendChild(saveBtn);
                popup.appendChild(btnRow);
                return;
            }

            // pick mode
            const prompts = getQuickPrompts();
            if (!prompts.length) {
                const empty = document.createElement('div');
                empty.className = 'rtl-qp-empty';
                empty.textContent = 'אין כפתורי הוראה עדיין.';
                popup.appendChild(empty);
            } else {
                const chips = document.createElement('div');
                chips.className = 'rtl-qp-chips';
                prompts.forEach(p => {
                    const b = document.createElement('button');
                    b.className = 'rtl-qp-chip';
                    b.textContent = p.label || p.text;
                    b.title = p.text;
                    b.addEventListener('click', (e) => {
                        e.preventDefault(); e.stopPropagation();
                        insertQuickPrompt(p.text);
                        closeQuickPromptsPopup();
                    });
                    chips.appendChild(b);
                });
                popup.appendChild(chips);
            }
            const manage = document.createElement('button');
            manage.className = 'rtl-qp-manage';
            manage.textContent = '✎ ערוך כפתורים';
            manage.addEventListener('click', (e) => { e.preventDefault(); e.stopPropagation(); render('manage'); });
            popup.appendChild(manage);
        }

        render(mode === 'manage' ? 'manage' : 'pick');
        document.body.appendChild(popup);
        setTimeout(() => document.addEventListener('mousedown', onQpOutsideClick, true), 0);
    }
    // ────────────────────────────────────────────────────────────────

    // ─── Claude Code settings menu (⚙️) ─────────────────────────────
    // Every change is sent as `/config key=value` through Claude Code's own input box, so the
    // agent applies it with its own validation. Current values come from the settings files
    // (read by the extension at injection time) and from changes made here since.

    const CC_SETTINGS_LS_KEY = 'rtl-cc-settings';

    const CC_SETTINGS_GROUPS = [
        { title: 'מודל ואופן עבודה', items: [
            { key: 'model', label: 'מודל', type: 'select',
              options: ['default', 'best', 'opus', 'opus[1m]', 'sonnet', 'sonnet[1m]', 'haiku', 'fable', 'fable[1m]', 'opusplan'],
              hint: 'המודל שעונה. [1m] = חלון הקשר של מיליון טוקנים. opusplan = Opus בתכנון ו-Sonnet בביצוע.' },
            { key: 'fast', label: 'מצב מהיר', type: 'bool', hint: 'אותו Opus, פלט מהיר יותר.' },
            { key: 'thinking', label: 'חשיבה לפני תשובה', type: 'bool', hint: 'משפר איכות במשימות מורכבות, מאט מעט.' },
            { key: 'permissionMode', label: 'מצב הרשאות', type: 'select',
              options: ['default', 'plan', 'acceptEdits', 'auto', 'dontAsk'],
              hint: 'default: שואל. acceptEdits: עורך בלי לשאול. plan: רק מתכנן. auto: מסווג מחליט. dontAsk: לא שואל, ודוחה את מה שלא אושר מראש.' },
            { key: 'useAutoModeDuringPlan', label: 'מצב auto גם בתכנון', type: 'bool', hint: 'האם מצב auto פעיל גם במצב תכנון.' },
            { key: 'switchModelsOnFlag', label: 'כשמודל לא זמין', type: 'select',
              options: ['Switch automatically', 'Ask each time'], hint: 'לעבור אוטומטית למודל אחר, או לשאול קודם.' },
            { key: 'outputStyle', label: 'סגנון תשובות', type: 'select',
              options: ['default', 'Concise', 'Explanatory', 'Learning', 'Proactive'], hint: 'קצר, מסביר, מלמד או יוזם.' },
            { key: 'language', label: 'שפת תשובות', type: 'text', placeholder: 'hebrew', hint: 'לדוגמה hebrew. ריק = ברירת מחדל.' }
        ]},
        { title: 'זיכרון והקשר', items: [
            { key: 'autoCompact', label: 'דחיסה אוטומטית', type: 'bool', hint: 'מסכם את תחילת השיחה כשמתקרבים לגבול ההקשר.' },
            { key: 'checkpoints', label: 'נקודות שחזור', type: 'bool', hint: 'שומר מצב לפני עריכות, לחזרה עם ‎/rewind.' },
            { key: 'gitignore', label: 'לכבד את ‎.gitignore', type: 'bool', hint: 'חיפוש קבצים מדלג על מה שב-‎.gitignore.' },
            { key: 'recap', label: 'סיכום בחזרה לשיחה', type: 'bool', hint: 'סיכום קצר כשחוזרים אחרי הפסקה.' },
            { key: 'externalEditorContext', label: 'הקשר מעורך חיצוני', type: 'bool', hint: 'לצרף הקשר כשכותבים הודעה בעורך חיצוני.' }
        ]},
        { title: 'עורך ו-IDE', items: [
            { key: 'autoConnectIde', label: 'חיבור אוטומטי ל-IDE', type: 'bool', hint: 'מטרמינל חיצוני: מתחבר ל-IDE הפתוח.' },
            { key: 'editor', label: 'מצב עריכה', type: 'select', options: ['normal', 'vim'], hint: 'קיצורי vim בשורת ההקלדה.' }
        ]},
        { title: 'ממשק ותצוגה', items: [
            { key: 'theme', label: 'ערכת צבעים', type: 'select',
              options: ['auto', 'dark', 'light', 'dark-daltonized', 'light-daltonized', 'dark-ansi', 'light-ansi'],
              hint: 'daltonized = מותאם לעיוורון צבעים. ansi = צבעי הטרמינל.' },
            { key: 'autoScroll', label: 'גלילה אוטומטית', type: 'bool', hint: 'גולל לתחתית כשמגיע פלט.' },
            { key: 'progressBar', label: 'פס התקדמות', type: 'bool', hint: 'פס התקדמות בזמן עבודה.' },
            { key: 'turnDuration', label: 'משך כל תור', type: 'bool', hint: 'מציג כמה זמן לקח כל תור.' },
            { key: 'timeFormat', label: 'תבנית שעה', type: 'select', options: ['auto', '12-hour', '24-hour', '24-hour-utc'], hint: '12 או 24 שעות, או UTC.' },
            { key: 'reduceMotion', label: 'פחות אנימציות', type: 'bool', hint: 'מפחית תנועה בממשק.' },
            { key: 'tips', label: 'טיפים', type: 'bool', hint: 'טיפים בזמן ההמתנה.' },
            { key: 'verbose', label: 'פלט מפורט', type: 'bool', hint: 'מציג תוצאות כלים במלואן.' },
            { key: 'promptSuggestionEnabled', label: 'הצעות להודעה הבאה', type: 'bool', hint: 'הצעות אחרי כל תשובה.' },
            { key: 'copyOnSelect', label: 'העתקה בסימון', type: 'bool', hint: 'סימון טקסט מעתיק אותו.' },
            { key: 'copyFullResponse', label: 'העתקת תשובה מלאה', type: 'bool', hint: 'העתקה לוקחת את כל התשובה.' },
            { key: 'prStatus', label: 'סטטוס PR', type: 'bool', hint: 'מציג את מצב ה-PR של הענף.' }
        ]},
        { title: 'סוכנים וזרימות עבודה', items: [
            { key: 'defaultToAgentsView', label: 'פתיחה בתצוגת סוכנים', type: 'bool', hint: 'פותח ישר את רשימת הסשנים והסוכנים.' },
            { key: 'leftArrowOpensAgents', label: 'חץ שמאלה פותח סוכנים', type: 'bool', hint: 'חץ שמאלה בשורה ריקה פותח את תצוגת הסוכנים.' },
            { key: 'workflows', label: 'זרימות עבודה', type: 'bool', hint: 'מאפשר הפעלת סוכנים רבים במקביל.' },
            { key: 'workflowKeywordTriggerEnabled', label: 'הפעלה במילת מפתח', type: 'bool', hint: 'מילה כמו ultracode מפעילה זרימת עבודה.' },
            { key: 'workflowSizeGuideline', label: 'גודל זרימת עבודה', type: 'select',
              options: ['small', 'medium', 'large', 'unrestricted'], hint: 'כמה סוכנים מותר להפעיל. יותר = יותר טוקנים.' },
            { key: 'worktreeBaseRef', label: 'בסיס ל-worktree', type: 'select', options: ['fresh', 'head'],
              hint: 'fresh: מהענף הראשי העדכני. head: ממה שיש לך עכשיו.' }
        ]},
        { title: 'התראות וחיבורים', items: [
            { key: 'inputNeededNotifEnabled', label: 'התראה כשצריך אותך', type: 'bool', hint: 'כשממתין לתשובה או לאישור.' },
            { key: 'agentPushNotifEnabled', label: 'התראות לטלפון', type: 'bool', hint: 'push כשסוכן מסיים או צריך אותך.' },
            { key: 'notifChannel', label: 'ערוץ התראות', type: 'select',
              options: ['auto', 'iterm2', 'terminal_bell', 'iterm2_with_bell', 'kitty', 'ghostty', 'notifications_disabled'],
              hint: 'איך נשלחת התראה. auto מזהה לבד.' },
            { key: 'remoteControl', label: 'שליטה מרחוק', type: 'select', options: ['default', 'true', 'false'],
              hint: 'שליטה בסשן מ-claude.ai או מהטלפון.' },
            { key: 'chrome', label: 'Claude in Chrome', type: 'bool', hint: 'פעולה בדפדפן Chrome שלך.' },
            { key: 'artifacts', label: 'Artifacts', type: 'bool', hint: 'פרסום דפי HTML פרטיים ב-claude.ai.' }
        ]}
    ];

    function getCcSettingValue(key) {
        try {
            const local = JSON.parse(rtlStorage.getItem(CC_SETTINGS_LS_KEY) || '{}');
            if (key in local) return local[key];
        } catch (e) { /* corrupt — fall through to the injected values */ }
        const injected = (window.__RTL_CONFIG__ && window.__RTL_CONFIG__.claudeSettings) || {};
        return key in injected ? injected[key] : undefined;
    }

    function rememberCcSetting(key, value) {
        let local = {};
        try { local = JSON.parse(rtlStorage.getItem(CC_SETTINGS_LS_KEY) || '{}'); } catch (e) { local = {}; }
        local[key] = value;
        rtlStorage.setItem(CC_SETTINGS_LS_KEY, JSON.stringify(local));
    }

    function replaceInputText(inputEl, text) {
        inputEl.focus();
        let done = false;
        try {
            document.execCommand('selectAll', false, null);
            done = text ? document.execCommand('insertText', false, text) : document.execCommand('delete', false, null);
        } catch (e) { done = false; }
        if (!done) {
            if (inputEl.tagName === 'TEXTAREA' || inputEl.tagName === 'INPUT') inputEl.value = text;
            else inputEl.textContent = text;
        }
        inputEl.dispatchEvent(new Event('input', { bubbles: true }));
    }

    /** Send `/config key=value` through the input box, restoring whatever draft was there. */
    function sendConfigCommand(key, value) {
        const inputEl = findActiveInput();
        if (!inputEl) return false;
        const draft = (inputEl.tagName === 'TEXTAREA' || inputEl.tagName === 'INPUT') ? inputEl.value : inputEl.textContent;
        replaceInputText(inputEl, `/config ${key}=${value}`);
        setTimeout(() => {
            submitInput(inputEl);
            if (draft && draft.trim()) {
                setTimeout(() => {
                    replaceInputText(inputEl, draft);
                    if (containsRTL(draft)) applyInputRTL(inputEl);
                }, 400);
            }
        }, 100);
        return true;
    }

    function onCcOutsideClick(ev) {
        const popup = document.querySelector('.rtl-cc-popup');
        if (popup && !popup.contains(ev.target) && ev.target.id !== 'rtl-cc-settings-btn') closeCcSettingsPopup();
    }
    function closeCcSettingsPopup() {
        const ex = document.querySelector('.rtl-cc-popup');
        if (ex) ex.remove();
        document.removeEventListener('mousedown', onCcOutsideClick, true);
    }

    function showCcSettingsPopup() {
        if (document.querySelector('.rtl-cc-popup')) { closeCcSettingsPopup(); return; }

        const popup = document.createElement('div');
        popup.className = 'rtl-cc-popup yolo-settings-popup';
        popup.style.bottom = '40px';
        popup.style.right = '16px';
        popup.setAttribute('dir', 'rtl');

        const title = document.createElement('div');
        title.className = 'rtl-qp-title';
        title.textContent = 'הגדרות Claude Code';
        popup.appendChild(title);

        const status = document.createElement('div');
        status.className = 'rtl-cc-status';
        status.textContent = 'כל שינוי נשלח כפקודת ‎/config';
        popup.appendChild(status);

        const search = document.createElement('input');
        search.type = 'text';
        search.className = 'rtl-cc-search';
        search.placeholder = 'חיפוש הגדרה…';
        popup.appendChild(search);

        const body = document.createElement('div');
        body.className = 'rtl-cc-body';
        popup.appendChild(body);

        function flash(text, ok) {
            status.textContent = text;
            status.classList.toggle('rtl-cc-status-error', !ok);
        }

        function apply(item, value, control) {
            if (!sendConfigCommand(item.key, value)) {
                flash('לא נמצאה תיבת הקלט של Claude Code', false);
                return;
            }
            rememberCcSetting(item.key, item.type === 'bool' ? value === 'true' : value);
            const row = control && control.closest('.rtl-cc-row');
            if (row) row.classList.remove('rtl-cc-unset');
            flash(`נשלח: ${item.key}=${value}`, true);
        }

        function buildControl(item) {
            const current = getCcSettingValue(item.key);
            if (item.type === 'bool') {
                const wrap = document.createElement('label');
                wrap.className = 'rtl-cc-switch';
                const input = document.createElement('input');
                input.type = 'checkbox';
                input.checked = current === true || current === 'true';
                const knob = document.createElement('span');
                knob.className = 'rtl-cc-knob';
                input.addEventListener('change', () => apply(item, input.checked ? 'true' : 'false', input));
                wrap.appendChild(input);
                wrap.appendChild(knob);
                return wrap;
            }
            if (item.type === 'select') {
                const select = document.createElement('select');
                select.className = 'rtl-cc-select';
                if (current === undefined) {
                    const placeholder = document.createElement('option');
                    placeholder.value = '';
                    placeholder.textContent = 'ברירת מחדל';
                    placeholder.disabled = true;
                    placeholder.selected = true;
                    select.appendChild(placeholder);
                }
                for (const opt of item.options) {
                    const o = document.createElement('option');
                    o.value = opt;
                    o.textContent = opt;
                    if (String(current) === opt) o.selected = true;
                    select.appendChild(o);
                }
                select.addEventListener('change', () => apply(item, select.value, select));
                return select;
            }
            const box = document.createElement('div');
            box.className = 'rtl-cc-textbox';
            const input = document.createElement('input');
            input.type = 'text';
            input.dir = 'ltr';
            input.placeholder = item.placeholder || '';
            input.value = typeof current === 'string' ? current : '';
            const go = document.createElement('button');
            go.textContent = 'החל';
            const submit = () => { if (input.value.trim()) apply(item, input.value.trim(), input); };
            go.addEventListener('click', (e) => { e.preventDefault(); e.stopPropagation(); submit(); });
            input.addEventListener('keydown', (e) => {
                e.stopPropagation();
                if (e.key === 'Enter') { e.preventDefault(); submit(); }
            });
            box.appendChild(input);
            box.appendChild(go);
            return box;
        }

        for (const group of CC_SETTINGS_GROUPS) {
            const section = document.createElement('div');
            section.className = 'rtl-cc-group';
            const gt = document.createElement('div');
            gt.className = 'rtl-cc-group-title';
            gt.textContent = group.title;
            section.appendChild(gt);
            for (const item of group.items) {
                const row = document.createElement('div');
                row.className = 'rtl-cc-row';
                if (getCcSettingValue(item.key) === undefined) row.classList.add('rtl-cc-unset');
                row.dataset.search = `${item.label} ${item.key} ${item.hint}`.toLowerCase();
                const text = document.createElement('div');
                text.className = 'rtl-cc-text';
                text.title = item.hint;
                const label = document.createElement('div');
                label.className = 'rtl-cc-label';
                label.textContent = item.label;
                const key = document.createElement('div');
                key.className = 'rtl-cc-key';
                key.textContent = item.key;
                text.appendChild(label);
                text.appendChild(key);
                row.appendChild(text);
                row.appendChild(buildControl(item));
                section.appendChild(row);
            }
            body.appendChild(section);
        }

        search.addEventListener('input', () => {
            const q = search.value.trim().toLowerCase();
            body.querySelectorAll('.rtl-cc-group').forEach(section => {
                let visible = 0;
                section.querySelectorAll('.rtl-cc-row').forEach(row => {
                    const show = !q || row.dataset.search.includes(q);
                    row.hidden = !show;
                    if (show) visible++;
                });
                section.hidden = visible === 0;
            });
        });
        search.addEventListener('keydown', (e) => e.stopPropagation());

        const foot = document.createElement('div');
        foot.className = 'rtl-cc-foot';
        foot.textContent = 'שם מעומעם = ההגדרה לא נקבעה ופועלת לפי ברירת המחדל';
        popup.appendChild(foot);

        document.body.appendChild(popup);
        setTimeout(() => { document.addEventListener('mousedown', onCcOutsideClick, true); search.focus(); }, 0);
    }
    // ────────────────────────────────────────────────────────────────

    function findYesButton(doc) {
        if (!doc) return null;

        // --- Codex approval dialog ---
        // Has a radiogroup with "Yes" selected (aria-checked="true") + separate Submit button
        const radioGroup = doc.querySelector('[role="radiogroup"]');
        if (radioGroup) {
            const yesRadio = radioGroup.querySelector('button[role="radio"][aria-checked="true"][aria-label="Yes"]');
            if (yesRadio) {
                // Find the Submit button in the same approval panel
                const panel = radioGroup.closest('.flex.flex-col.gap-1');
                if (panel) {
                    // Look for the button whose text includes "Submit"
                    const allBtns = panel.querySelectorAll('button');
                    for (const btn of allBtns) {
                        if (btn.textContent?.includes('Submit')) {
                            return btn;
                        }
                    }
                }
            }
        }

        // --- Claude Code approval dialog ---
        const buttons = doc.querySelectorAll('button');

        // Strategy 1: button with "Yes" text and a span containing "1"
        for (const button of buttons) {
            const text = button.textContent?.trim() || '';
            if (text.includes('Yes')) {
                const span = button.querySelector('span');
                if (span && span.textContent?.trim() === '1') {
                    return button;
                }
            }
        }

        // Strategy 2: exact text patterns
        for (const button of buttons) {
            const text = button.textContent?.trim() || '';
            if (text === '1 Yes' || text === 'Yes 1' || text === '1Yes') {
                return button;
            }
        }

        // Strategy 3: any button with "Yes" and a digit
        for (const button of buttons) {
            const text = button.textContent?.trim() || '';
            if (text.includes('Yes') && /\d/.test(text)) {
                return button;
            }
        }

        // Recursively check iframes
        const iframes = doc.querySelectorAll('iframe');
        for (const iframe of iframes) {
            try {
                const iframeDoc = iframe.contentDocument || iframe.contentWindow?.document;
                if (iframeDoc) {
                    const found = findYesButton(iframeDoc);
                    if (found) return found;
                }
            } catch (e) { /* cross-origin */ }
        }
        return null;
    }

    function isPlanApprovalButton(button) {
        if (!button) return false;

        const buttonText = (button.textContent || '').toLowerCase();
        if (buttonText.includes('auto-accept')) return true;

        let el = button;
        for (let i = 0; el && i < 6; i++, el = el.parentElement) {
            const text = (el.textContent || '').toLowerCase();
            if (
                text.includes('accept this plan?') &&
                (
                    text.includes('yes, and manually approve edits') ||
                    text.includes('no, keep planning') ||
                    text.includes('auto-accept')
                )
            ) {
                return true;
            }
        }
        return false;
    }

    /**
     * Show a countdown overlay, then click the button.
     * Returns a cancel function. If the user cancels (NO!) the button is NOT clicked.
     */
    function showCountdown(targetButton) {
        yoloCountdownActive = true;

        // Build overlay
        const overlay = document.createElement('div');
        overlay.className = 'yolo-countdown';

        const label = document.createElement('span');
        label.textContent = '💪 YOLO';

        const track = document.createElement('div');
        track.className = 'yolo-countdown-bar-track';
        const fill = document.createElement('div');
        fill.className = 'yolo-countdown-bar-fill';
        fill.style.width = '100%';
        track.appendChild(fill);

        const timer = document.createElement('span');
        timer.style.minWidth = '28px';
        timer.style.textAlign = 'center';

        const noBtn = document.createElement('button');
        noBtn.className = 'yolo-countdown-no';
        noBtn.textContent = 'NO!';

        overlay.appendChild(label);
        overlay.appendChild(track);
        overlay.appendChild(timer);
        overlay.appendChild(noBtn);
        document.body.appendChild(overlay);

        const delayMs = getYoloDelayMs(); // snapshot once per countdown
        const startTime = Date.now();
        let cancelled = false;
        let animFrame;

        function tick() {
            // If the Yes button disappeared (user clicked YES manually), cancel silently
            if (!targetButton.isConnected && !cancelled) {
                cleanup();
                console.log('YOLO: Yes button gone (manual click?) — countdown dismissed');
                return;
            }

            const elapsed = Date.now() - startTime;
            const remaining = Math.max(0, delayMs - elapsed);
            const pct = (remaining / delayMs) * 100;
            fill.style.width = pct + '%';
            timer.textContent = (remaining / 1000).toFixed(1) + 's';

            if (remaining <= 0 && !cancelled) {
                cleanup();
                if (targetButton.isConnected) {
                    console.log('YOLO: auto-clicking Yes');
                    targetButton.click();
                }
                return;
            }
            animFrame = requestAnimationFrame(tick);
        }

        function cleanup() {
            yoloCountdownActive = false;
            yoloCountdownCancel = null;
            cancelAnimationFrame(animFrame);
            overlay.remove();
        }

        function cancel() {
            cancelled = true;
            // Remember this button so poll skips it until it leaves the DOM
            yoloCancelledBtn = targetButton;
            cleanup();
            console.log('YOLO: cancelled by user');
        }

        noBtn.addEventListener('click', (e) => { e.stopPropagation(); cancel(); });
        animFrame = requestAnimationFrame(tick);

        yoloCountdownCancel = cancel;
        return cancel;
    }

    /** Poll for Yes buttons; when found start a countdown instead of clicking immediately */
    function yoloPoll() {
        if (yoloCountdownActive) return; // countdown in progress, skip

        // Clear cancelled-button ref once it leaves the DOM
        if (yoloCancelledBtn && !yoloCancelledBtn.isConnected) {
            yoloCancelledBtn = null;
        }

        const btn = findYesButton(document);
        if (btn) {
            // Skip if this is the same button the user already cancelled
            if (btn === yoloCancelledBtn) return;
            if (isPlanApprovalButton(btn) && !getYoloAutoApprovePlans()) return;

            // 0 delay = instant approve, no progress bar
            if (getYoloDelayMs() <= 0) {
                console.log('YOLO: instant auto-clicking Yes');
                btn.click();
                return;
            }

            showCountdown(btn);
        }
    }

    function startYolo() {
        if (yoloRunning) return;
        yoloRunning = true;
        yoloPoll();
        yoloPollId = setInterval(yoloPoll, YOLO_POLL_MS);
        console.log('💪 YOLO mode ON');
    }

    function stopYolo() {
        if (!yoloRunning) return;
        yoloRunning = false;
        if (yoloPollId) { clearInterval(yoloPollId); yoloPollId = null; }
        // Remove any active countdown overlay
        const overlay = document.querySelector('.yolo-countdown');
        if (overlay) overlay.remove();
        yoloCountdownActive = false;
        console.log('💪 YOLO mode OFF');
    }

    function toggleYolo() {
        yoloRunning ? stopYolo() : startYolo();
        // Update button visual
        const btn = document.getElementById('rtl-yolo-btn');
        if (btn) btn.classList.toggle('yolo-active', yoloRunning);
        return yoloRunning;
    }
    // ────────────────────────────────────────────────────────────────

    /**
     * Show a small settings popup near the YOLO button (right-click)
     */
    function showYoloSettings(e) {
        // Remove any existing popup
        const existing = document.querySelector('.yolo-settings-popup');
        if (existing) { existing.remove(); return; }

        const popup = document.createElement('div');
        popup.className = 'yolo-settings-popup';

        const delayRow = document.createElement('div');
        delayRow.className = 'yolo-settings-row';

        const lbl = document.createElement('span');
        lbl.textContent = '⏱ Delay:';

        const input = document.createElement('input');
        input.type = 'number';
        input.min = '0';
        input.max = '30';
        input.step = '1';
        input.value = String(getYoloDelayMs() / 1000);

        const unit = document.createElement('span');
        unit.textContent = 'sec';

        const hint = document.createElement('span');
        hint.className = 'yolo-settings-hint';
        hint.textContent = '(0 = instant)';

        delayRow.appendChild(lbl);
        delayRow.appendChild(input);
        delayRow.appendChild(unit);
        delayRow.appendChild(hint);
        popup.appendChild(delayRow);

        const plansToggle = document.createElement('label');
        plansToggle.className = 'yolo-settings-check';

        const plansCheckbox = document.createElement('input');
        plansCheckbox.type = 'checkbox';
        plansCheckbox.checked = getYoloAutoApprovePlans();

        const plansLabel = document.createElement('span');
        plansLabel.textContent = 'Auto Approve Plans';

        plansToggle.appendChild(plansCheckbox);
        plansToggle.appendChild(plansLabel);
        popup.appendChild(plansToggle);

        // Position near the button
        popup.style.bottom = '40px';
        popup.style.right = '16px';
        document.body.appendChild(popup);

        // Save on change
        input.addEventListener('input', () => {
            const secs = parseFloat(input.value);
            if (!isNaN(secs) && secs >= 0) {
                setYoloDelayMs(Math.round(secs * 1000));
            }
        });
        plansCheckbox.addEventListener('change', () => {
            setYoloAutoApprovePlans(plansCheckbox.checked);
        });

        // Close on outside click
        function onOutsideClick(ev) {
            if (!popup.contains(ev.target)) {
                popup.remove();
                document.removeEventListener('mousedown', onOutsideClick, true);
            }
        }
        // Delay listener so the current contextmenu event doesn't close it immediately
        setTimeout(() => document.addEventListener('mousedown', onOutsideClick, true), 0);

        // Focus the input
        input.focus();
        input.select();
    }

    /**
     * Show a toggle popup for user message borders (right-click on ↑↓)
     */
    function showBorderToggle(e) {
        // Remove any existing popup
        const existing = document.querySelector('.rtl-border-popup');
        if (existing) { existing.remove(); return; }

        const popup = document.createElement('div');
        popup.className = 'rtl-border-popup';

        const toggle = document.createElement('div');
        toggle.className = 'rtl-border-toggle' + (getUserMessageBorder() ? ' on' : '');

        const lbl = document.createElement('span');
        lbl.textContent = 'User message border';

        popup.appendChild(toggle);
        popup.appendChild(lbl);

        // Position near the buttons
        popup.style.bottom = '40px';
        popup.style.right = '16px';
        document.body.appendChild(popup);

        // Toggle on click
        popup.addEventListener('click', (ev) => {
            ev.preventDefault();
            ev.stopPropagation();
            const newVal = !getUserMessageBorder();
            setUserMessageBorder(newVal);
            toggle.classList.toggle('on', newVal);
        });

        // Close on outside click
        function onOutsideClick(ev) {
            if (!popup.contains(ev.target)) {
                popup.remove();
                document.removeEventListener('mousedown', onOutsideClick, true);
            }
        }
        setTimeout(() => document.addEventListener('mousedown', onOutsideClick, true), 0);
    }

    // ─── Auto-Resume Mode Helper Functions ─────────────────────────
    function formatTime(totalSeconds) {
        const h = Math.floor(totalSeconds / 3600);
        const m = Math.floor((totalSeconds % 3600) / 60);
        const s = totalSeconds % 60;
        const pad = (num) => String(num).padStart(2, '0');
        if (h > 0) {
            return `${h}:${pad(m)}:${pad(s)}`;
        }
        return `${m}:${pad(s)}`;
    }

    function parseResetTime(text) {
        const lower = text.toLowerCase();
        const isRateLimit = lower.includes('limit') || lower.includes('reset') || 
                            lower.includes('try again') || lower.includes('wait') || 
                            lower.includes('capacity') || lower.includes('blocked') ||
                            lower.includes('מכסה') || lower.includes('איפוס') || lower.includes('שחרור');
        if (!isRateLimit) return null;

        // Try absolute time first, e.g. "try again at 04:31 AM", "resets at 15:45", "בשעה 15:45"
        const absMatch = text.match(/(?:at|until|בשעה|ב-)\s*(\d{1,2}):(\d{2})(?:\s*([ap]m))?/i) || 
                         text.match(/(\d{1,2}):(\d{2})\s*([ap]m)/i);
        if (absMatch) {
            let hours = parseInt(absMatch[1], 10);
            const minutes = parseInt(absMatch[2], 10);
            const ampm = absMatch[3] ? absMatch[3].toLowerCase() : null;

            if (ampm) {
                if (ampm === 'pm' && hours < 12) hours += 12;
                if (ampm === 'am' && hours === 12) hours = 0;
            }

            const now = new Date();
            const target = new Date(now);
            target.setHours(hours, minutes, 0, 0);

            if (target.getTime() <= now.getTime()) {
                target.setDate(target.getDate() + 1);
            }
            return target.getTime() - now.getTime();
        }

        // Try relative time: e.g. "resets in 2h 14m", "try again in 45m"
        const relativeIndicator = text.match(/(?:in|for|within|בעוד|תוך)\s+([^.]+)/i);
        if (relativeIndicator) {
            const timePart = relativeIndicator[1];
            let hours = 0;
            let minutes = 0;
            let seconds = 0;
            
            const hoursMatch = timePart.match(/(\d+)\s*(?:h|hour|hours|שעות|שעה)\b/i);
            const minsMatch = timePart.match(/(\d+)\s*(?:m|min|mins|minute|minutes|דקות|דקה)\b/i);
            const secsMatch = timePart.match(/(\d+)\s*(?:s|sec|secs|second|seconds|שניות|שנייה)\b/i);

            if (hoursMatch) hours = parseInt(hoursMatch[1], 10);
            if (minsMatch) minutes = parseInt(minsMatch[1], 10);
            if (secsMatch) seconds = parseInt(secsMatch[1], 10);

            if (hours > 0 || minutes > 0 || seconds > 0) {
                return (hours * 3600 + minutes * 60 + seconds) * 1000;
            }
        }

        // Fallback relative parsing without "in/for" if the context is clearly rate limit
        let hours = 0;
        let minutes = 0;
        const hoursMatch = text.match(/(\d+)\s*(?:h|hour|hours|שעות|שעה)\b/i);
        const minsMatch = text.match(/(\d+)\s*(?:m|min|mins|minute|minutes|דקות|דקה)\b/i);
        if (hoursMatch) hours = parseInt(hoursMatch[1], 10);
        if (minsMatch) minutes = parseInt(minsMatch[1], 10);
        if (hours > 0 || minutes > 0) {
            return (hours * 3600 + minutes * 60) * 1000;
        }

        return null;
    }

    function updateAutoResumeButton() {
        const btn = document.getElementById('rtl-auto-resume-btn');
        if (!btn) return;

        btn.classList.toggle('auto-resume-active', autoResumeActive);
        
        if (autoResumeActive && autoResumeTargetTime) {
            btn.classList.add('auto-resume-timer-running');
            const remainingSec = Math.max(0, Math.round((autoResumeTargetTime - Date.now()) / 1000));
            btn.title = `Auto-Resume Mode: Active. Resuming in ${formatTime(remainingSec)} (Click to disable)`;
        } else {
            btn.classList.remove('auto-resume-timer-running');
            btn.title = autoResumeActive 
                ? 'Auto-Resume Mode: Enabled. Waiting for rate limit message... (Click to disable)'
                : 'Auto-Resume Mode: Disabled. (Click to enable)';
        }
    }

    function toggleAutoResume() {
        autoResumeActive = !autoResumeActive;
        rtlStorage.setItem('rtl-auto-resume-active', String(autoResumeActive));
        if (!autoResumeActive) {
            if (autoResumeTimerId) {
                clearTimeout(autoResumeTimerId);
                autoResumeTimerId = null;
            }
            autoResumeTargetTime = null;
            console.log('⏰ Auto-Resume Mode: Disabled');
        } else {
            console.log('⏰ Auto-Resume Mode: Enabled');
            checkAutoResume();
        }
        updateAutoResumeButton();
    }

    function checkAutoResume() {
        if (!autoResumeActive) {
            if (autoResumeTimerId) {
                clearTimeout(autoResumeTimerId);
                autoResumeTimerId = null;
                autoResumeTargetTime = null;
                updateAutoResumeButton();
            }
            return;
        }

        const msgs = document.querySelectorAll(CONFIG.messageContainerSelectors.join(', '));
        if (msgs.length === 0) return;

        let lastLimitMsgText = null;
        let lastLimitMsgEl = null;
        for (let i = msgs.length - 1; i >= 0; i--) {
            const text = msgs[i].textContent || '';
            const remainingMs = parseResetTime(text);
            if (remainingMs !== null) {
                lastLimitMsgText = text;
                lastLimitMsgEl = msgs[i];
                break;
            }
        }

        if (!lastLimitMsgEl) {
            if (autoResumeTimerId) {
                console.log('⏰ Auto-Resume: No rate limit message found. Cancelling timer.');
                clearTimeout(autoResumeTimerId);
                autoResumeTimerId = null;
                autoResumeTargetTime = null;
                updateAutoResumeButton();
            }
            return;
        }

        const remainingMs = parseResetTime(lastLimitMsgText);
        if (remainingMs === null) return;

        const now = Date.now();
        const calculatedTarget = now + remainingMs + 60000; // 1-minute buffer

        if (!autoResumeTimerId || Math.abs(autoResumeTargetTime - calculatedTarget) > 10000) {
            if (autoResumeTimerId) {
                clearTimeout(autoResumeTimerId);
            }
            autoResumeTargetTime = calculatedTarget;
            const delay = Math.max(0, autoResumeTargetTime - now);
            console.log(`⏰ Auto-Resume: Rate limit message found. Resuming in ${Math.round(delay/1000)}s.`);
            
            autoResumeTimerId = setTimeout(() => {
                triggerResume();
            }, delay);
        }
        updateAutoResumeButton();
    }

    function triggerResume() {
        console.log('⏰ Auto-Resume: Triggering resume!');
        autoResumeTimerId = null;
        autoResumeTargetTime = null;

        const buttons = Array.from(document.querySelectorAll('button'));
        const retryBtn = buttons.find(btn => {
            const text = (btn.textContent || '').toLowerCase();
            return text.includes('retry') || text.includes('try again') || text.includes('continue') || text.includes('נסה שנית') || text.includes('המשך');
        });

        if (retryBtn) {
            console.log('⏰ Auto-Resume: Clicking retry/continue button.');
            retryBtn.click();
            updateAutoResumeButton();
            return;
        }

        const inputSelector = CONFIG.inputSelectors.join(', ');
        const inputEl = document.querySelector(inputSelector);
        if (inputEl) {
            console.log('⏰ Auto-Resume: Typing "continue" in input.');
            inputEl.focus();
            if (inputEl.tagName === 'TEXTAREA' || inputEl.tagName === 'INPUT') {
                inputEl.value = 'continue';
            } else {
                inputEl.textContent = 'continue';
            }
            inputEl.dispatchEvent(new Event('input', { bubbles: true }));
            
            setTimeout(() => submitInput(inputEl), 100);
        } else {
            console.warn('⏰ Auto-Resume: Could not find message input element.');
        }

        updateAutoResumeButton();
    }

    /**
     * Inject navigation buttons (↑ ↓) above the chat input box
     */
    function injectMessageNavigation() {
        // Already injected
        if (document.getElementById('rtl-msg-nav')) return;

        // Build the shared nav element
        function buildNav() {
            const nav = document.createElement('div');
            nav.id = 'rtl-msg-nav';
            nav.addEventListener('mousedown', (e) => e.preventDefault());

            const upBtn = document.createElement('button');
            upBtn.title = 'Previous user message (↑)';
            upBtn.innerHTML = '<svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke-width="2.5" stroke="currentColor"><path stroke-linecap="round" stroke-linejoin="round" d="M4.5 15.75l7.5-7.5 7.5 7.5"/></svg>';
            upBtn.addEventListener('click', (e) => { e.preventDefault(); e.stopPropagation(); navigateUserMessages(-1); });
            upBtn.addEventListener('contextmenu', (e) => { e.preventDefault(); e.stopPropagation(); showBorderToggle(e); });

            const downBtn = document.createElement('button');
            downBtn.title = 'Next user message (↓)';
            downBtn.innerHTML = '<svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke-width="2.5" stroke="currentColor"><path stroke-linecap="round" stroke-linejoin="round" d="M19.5 8.25l-7.5 7.5-7.5-7.5"/></svg>';
            downBtn.addEventListener('click', (e) => { e.preventDefault(); e.stopPropagation(); navigateUserMessages(1); });
            downBtn.addEventListener('contextmenu', (e) => { e.preventDefault(); e.stopPropagation(); showBorderToggle(e); });

            const yoloBtn = document.createElement('button');
            yoloBtn.id = 'rtl-yolo-btn';
            yoloBtn.title = 'YOLO mode: auto-approve all tool calls';
            yoloBtn.textContent = '💪';
            if (yoloRunning) yoloBtn.classList.add('yolo-active');
            yoloBtn.addEventListener('click', (e) => { e.preventDefault(); e.stopPropagation(); toggleYolo(); });
            yoloBtn.addEventListener('contextmenu', (e) => { e.preventDefault(); e.stopPropagation(); showYoloSettings(e); });

            const inputDirBtn = document.createElement('button');
            inputDirBtn.id = 'rtl-input-dir-btn';
            inputDirBtn.textContent = '⇔';
            const currentMode = getInputDirMode();
            inputDirBtn.title = currentMode === 'per-line'
                ? 'Input direction: per-line (click for uniform)'
                : 'Input direction: uniform (click for per-line)';
            if (currentMode === 'per-line') inputDirBtn.classList.add('input-dir-perline');
            inputDirBtn.addEventListener('click', (e) => {
                e.preventDefault(); e.stopPropagation();
                const newMode = getInputDirMode() === 'uniform' ? 'per-line' : 'uniform';
                setInputDirMode(newMode);
                inputDirBtn.classList.toggle('input-dir-perline', newMode === 'per-line');
                inputDirBtn.title = newMode === 'per-line'
                    ? 'Input direction: per-line (click for uniform)'
                    : 'Input direction: uniform (click for per-line)';
            });

            const searchBtn = document.createElement('button');
            searchBtn.id = 'rtl-search-btn';
            searchBtn.title = 'Search in conversation';
            searchBtn.textContent = '🔍';
            searchBtn.addEventListener('click', (e) => {
                e.preventDefault(); e.stopPropagation();
                if (document.getElementById('rtl-search-bar')) {
                    closeSearchBar();
                } else {
                    openSearchBar();
                }
            });

            const copyConvBtn = document.createElement('button');
            copyConvBtn.id = 'rtl-copy-conv-btn';
            copyConvBtn.title = 'Copy entire conversation';
            copyConvBtn.innerHTML = '<svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke-width="2.5" stroke="currentColor"><path stroke-linecap="round" stroke-linejoin="round" d="M8.25 7.5V6.108c0-1.135.845-2.098 1.976-2.192.373-.03.748-.057 1.123-.08M15.75 18H18a2.25 2.25 0 002.25-2.25V6.108c0-1.135-.845-2.098-1.976-2.192a48.424 48.424 0 00-1.123-.08M15.75 18.75v-1.875a3.375 3.375 0 00-3.375-3.375h-1.5a1.125 1.125 0 01-1.125-1.125v-1.5A3.375 3.375 0 006.375 7.5H5.25m11.9-3.664A2.251 2.251 0 0015 2.25h-1.5a2.251 2.251 0 00-2.15 1.586m5.8 0c.065.21.1.433.1.664v.75h-6V4.5c0-.231.035-.454.1-.664M6.75 7.5H4.875c-.621 0-1.125.504-1.125 1.125v12c0 .621.504 1.125 1.125 1.125h9.75c.621 0 1.125-.504 1.125-1.125V16.5a9 9 0 00-9-9z"/></svg>';
            copyConvBtn.addEventListener('click', (e) => { e.preventDefault(); e.stopPropagation(); copyEntireConversation(); });

            const autoResumeBtn = document.createElement('button');
            autoResumeBtn.id = 'rtl-auto-resume-btn';
            autoResumeBtn.textContent = '⏰';
            autoResumeBtn.title = autoResumeActive 
                ? 'Auto-Resume Mode: Enabled. Waiting for rate limit message... (Click to disable)' 
                : 'Auto-Resume Mode: Disabled. (Click to enable)';
            if (autoResumeActive) {
                autoResumeBtn.classList.add('auto-resume-active');
            }
            autoResumeBtn.addEventListener('click', (e) => {
                e.preventDefault(); e.stopPropagation();
                toggleAutoResume();
            });

            const quickPromptsBtn = document.createElement('button');
            quickPromptsBtn.id = 'rtl-quick-prompts-btn';
            quickPromptsBtn.title = 'Quick prompts — insert a saved instruction (right-click to edit)';
            quickPromptsBtn.textContent = '⚡';
            quickPromptsBtn.addEventListener('click', (e) => { e.preventDefault(); e.stopPropagation(); showQuickPromptsPopup('pick'); });
            quickPromptsBtn.addEventListener('contextmenu', (e) => { e.preventDefault(); e.stopPropagation(); showQuickPromptsPopup('manage'); });

            nav.appendChild(upBtn);
            nav.appendChild(downBtn);
            nav.appendChild(searchBtn);
            nav.appendChild(autoResumeBtn);
            nav.appendChild(copyConvBtn);
            nav.appendChild(inputDirBtn);
            nav.appendChild(quickPromptsBtn);
            if (document.querySelector('[class*="inputFooter_"]')) {
                const ccSettingsBtn = document.createElement('button');
                ccSettingsBtn.id = 'rtl-cc-settings-btn';
                ccSettingsBtn.title = 'הגדרות Claude Code';
                ccSettingsBtn.textContent = '⚙️';
                ccSettingsBtn.addEventListener('click', (e) => { e.preventDefault(); e.stopPropagation(); showCcSettingsPopup(); });
                nav.appendChild(ccSettingsBtn);
            }
            nav.appendChild(yoloBtn);
            
            // Proactively update button's timer visual/classes if running
            setTimeout(updateAutoResumeButton, 0);

            return nav;
        }

        // --- Claude Code: insert before "Ask before edits" in inputFooter ---
        const footer = document.querySelector('[class*="inputFooter_"]');
        if (footer) {
            const permContainer = footer.querySelector('[class*="container_"][class*="_"]:has([class*="footerButtonPrimary_"])');
            if (permContainer) {
                footer.insertBefore(buildNav(), permContainer);
                return;
            }
        }

        // --- Codex: insert in the right column of composer-footer, before submit ---
        const codexComposer = document.querySelector('.ProseMirror[data-codex-composer="true"]');
        if (codexComposer) {
            const composerFooter = codexComposer.closest('.border-token-border')?.querySelector('.composer-footer');
            if (composerFooter) {
                // Right column: last child of the grid (contains submit button)
                const rightCol = composerFooter.querySelector(':scope > div:last-child');
                const submitBtn = rightCol?.querySelector('button');
                if (rightCol && submitBtn) {
                    rightCol.insertBefore(buildNav(), submitBtn);
                    return;
                }
            }
        }
    }

    /**
     * Navigate to the next/previous user message
     * @param {number} direction  -1 for up (previous), +1 for down (next)
     */
    function navigateUserMessages(direction) {
        // Claude Code user messages
        let msgs = Array.from(document.querySelectorAll(
            '[class*="message_"][class*="userMessageContainer_"]'
        ));
        // Codex user messages
        if (msgs.length === 0) {
            msgs = Array.from(document.querySelectorAll(
                '[data-content-search-unit-key$=":user"]'
            ));
        }
        if (msgs.length === 0) return;

        // Compute next index with cyclic wrap
        if (navCurrentIndex < 0 || navCurrentIndex >= msgs.length) {
            navCurrentIndex = direction === -1 ? msgs.length - 1 : 0;
        } else {
            navCurrentIndex += direction;
            if (navCurrentIndex < 0) navCurrentIndex = msgs.length - 1;
            if (navCurrentIndex >= msgs.length) navCurrentIndex = 0;
        }

        const target = msgs[navCurrentIndex];
        target.scrollIntoView({ behavior: 'smooth', block: 'center' });

        // Highlight pulse (short, one-shot)
        target.classList.remove('rtl-nav-highlight');
        void target.offsetWidth;
        target.classList.add('rtl-nav-highlight');
        target.addEventListener('animationend', () => {
            target.classList.remove('rtl-nav-highlight');
        }, { once: true });
    }

    // ─── Search in conversation ──────────────────────────────────
    const SEARCH_SELECTOR =
        '[class*="message_"][class*="userMessageContainer_"], ' +
        '[class*="timelineMessage_"], ' +
        '[data-content-search-unit-key$=":user"]';

    function unwrapSearchMarks() {
        document.querySelectorAll('mark.rtl-search-mark').forEach(mark => {
            const parent = mark.parentNode;
            if (!parent) return;
            while (mark.firstChild) parent.insertBefore(mark.firstChild, mark);
            parent.removeChild(mark);
            parent.normalize();
        });
    }

    function wrapMatchesInElement(el, query) {
        if (!query) return [];
        const marks = [];
        const walker = document.createTreeWalker(el, NodeFilter.SHOW_TEXT, {
            acceptNode(node) {
                if (!node.nodeValue) return NodeFilter.FILTER_REJECT;
                const p = node.parentNode;
                if (!p) return NodeFilter.FILTER_REJECT;
                const tag = p.nodeName;
                if (tag === 'SCRIPT' || tag === 'STYLE' || tag === 'MARK') return NodeFilter.FILTER_REJECT;
                return node.nodeValue.toLowerCase().includes(query)
                    ? NodeFilter.FILTER_ACCEPT
                    : NodeFilter.FILTER_REJECT;
            }
        });
        const textNodes = [];
        let n;
        while ((n = walker.nextNode())) textNodes.push(n);

        const qLen = query.length;
        textNodes.forEach(node => {
            const text = node.nodeValue;
            const lower = text.toLowerCase();
            const frag = document.createDocumentFragment();
            let i = 0, idx;
            while ((idx = lower.indexOf(query, i)) !== -1) {
                if (idx > i) frag.appendChild(document.createTextNode(text.slice(i, idx)));
                const mark = document.createElement('mark');
                mark.className = 'rtl-search-mark';
                mark.appendChild(document.createTextNode(text.slice(idx, idx + qLen)));
                frag.appendChild(mark);
                marks.push(mark);
                i = idx + qLen;
            }
            if (i < text.length) frag.appendChild(document.createTextNode(text.slice(i)));
            node.parentNode.replaceChild(frag, node);
        });
        return marks;
    }

    function collectSearchMatches(query) {
        unwrapSearchMarks();
        if (!query) return [];
        const containers = Array.from(document.querySelectorAll(SEARCH_SELECTOR));
        const allMarks = [];
        containers.forEach(el => {
            const marks = wrapMatchesInElement(el, query);
            allMarks.push(...marks);
        });
        return allMarks;
    }

    function scrollToSearchHit(el) {
        document.querySelectorAll('mark.rtl-search-mark-active')
            .forEach(m => m.classList.remove('rtl-search-mark-active'));
        el.classList.add('rtl-search-mark-active');
        el.scrollIntoView({ behavior: 'smooth', block: 'center' });
    }

    function updateSearchCounter() {
        const bar = document.getElementById('rtl-search-bar');
        if (!bar) return;
        const counter = bar.querySelector('.rtl-search-counter');
        const upBtn = bar.querySelector('button.rtl-search-btn[data-dir="up"]');
        const downBtn = bar.querySelector('button.rtl-search-btn[data-dir="down"]');
        const total = searchMatches.length;
        const pos = total > 0 ? (searchCurrentIndex + 1) : 0;
        counter.textContent = `${pos}/${total}`;
        counter.classList.toggle('no-matches', searchQuery !== '' && total === 0);
        upBtn.disabled = total === 0;
        downBtn.disabled = total === 0;
    }

    function updateSearchResults() {
        const bar = document.getElementById('rtl-search-bar');
        if (!bar) return;
        const input = bar.querySelector('input.rtl-search-input');
        const raw = (input.value || '').trim();
        searchQuery = raw.toLowerCase();
        searchMatches = collectSearchMatches(searchQuery);
        if (searchMatches.length > 0) {
            searchCurrentIndex = 0;
            scrollToSearchHit(searchMatches[0]);
        } else {
            searchCurrentIndex = -1;
        }
        updateSearchCounter();
    }

    function navigateSearch(direction) {
        if (!searchQuery) return;
        const prevIndex = searchCurrentIndex;
        searchMatches = collectSearchMatches(searchQuery);
        if (searchMatches.length === 0) {
            searchCurrentIndex = -1;
            updateSearchCounter();
            return;
        }
        // Restore index (clamped) then apply direction
        if (prevIndex < 0 || prevIndex >= searchMatches.length) {
            searchCurrentIndex = direction === -1 ? searchMatches.length - 1 : 0;
        } else {
            searchCurrentIndex = prevIndex;
        }
        searchCurrentIndex += direction;
        if (searchCurrentIndex < 0) searchCurrentIndex = searchMatches.length - 1;
        if (searchCurrentIndex >= searchMatches.length) searchCurrentIndex = 0;
        scrollToSearchHit(searchMatches[searchCurrentIndex]);
        updateSearchCounter();
    }

    function onSearchInput() {
        if (searchDebounceId) clearTimeout(searchDebounceId);
        searchDebounceId = setTimeout(() => {
            searchDebounceId = null;
            updateSearchResults();
        }, 150);
    }

    function onSearchKeydown(e) {
        if (e.key === 'Enter') {
            e.preventDefault();
            navigateSearch(e.shiftKey ? -1 : 1);
        } else if (e.key === 'Escape') {
            e.preventDefault();
            closeSearchBar();
        }
    }

    function openSearchBar() {
        if (document.getElementById('rtl-search-bar')) return;

        const bar = document.createElement('div');
        bar.id = 'rtl-search-bar';
        bar.addEventListener('mousedown', (e) => e.stopPropagation());

        const input = document.createElement('input');
        input.type = 'text';
        input.className = 'rtl-search-input';
        input.placeholder = 'Search in conversation…';
        input.addEventListener('input', onSearchInput);
        input.addEventListener('keydown', onSearchKeydown);

        const counter = document.createElement('span');
        counter.className = 'rtl-search-counter';
        counter.textContent = '0/0';

        const upBtn = document.createElement('button');
        upBtn.className = 'rtl-search-btn';
        upBtn.dataset.dir = 'up';
        upBtn.title = 'Previous match (Shift+Enter)';
        upBtn.disabled = true;
        upBtn.innerHTML = '<svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke-width="2.5" stroke="currentColor"><path stroke-linecap="round" stroke-linejoin="round" d="M4.5 15.75l7.5-7.5 7.5 7.5"/></svg>';
        upBtn.addEventListener('click', (e) => { e.preventDefault(); e.stopPropagation(); navigateSearch(-1); });

        const downBtn = document.createElement('button');
        downBtn.className = 'rtl-search-btn';
        downBtn.dataset.dir = 'down';
        downBtn.title = 'Next match (Enter)';
        downBtn.disabled = true;
        downBtn.innerHTML = '<svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke-width="2.5" stroke="currentColor"><path stroke-linecap="round" stroke-linejoin="round" d="M19.5 8.25l-7.5 7.5-7.5-7.5"/></svg>';
        downBtn.addEventListener('click', (e) => { e.preventDefault(); e.stopPropagation(); navigateSearch(1); });

        const closeBtn = document.createElement('button');
        closeBtn.className = 'rtl-search-btn rtl-search-close';
        closeBtn.dataset.dir = 'close';
        closeBtn.title = 'Close (Esc)';
        closeBtn.textContent = '×';
        closeBtn.addEventListener('click', (e) => { e.preventDefault(); e.stopPropagation(); closeSearchBar(); });

        bar.appendChild(input);
        bar.appendChild(counter);
        bar.appendChild(upBtn);
        bar.appendChild(downBtn);
        bar.appendChild(closeBtn);

        document.body.appendChild(bar);
        input.focus();
    }

    function closeSearchBar() {
        if (searchDebounceId) { clearTimeout(searchDebounceId); searchDebounceId = null; }
        const bar = document.getElementById('rtl-search-bar');
        if (bar) bar.remove();
        unwrapSearchMarks();
        searchMatches = [];
        searchCurrentIndex = -1;
        searchQuery = '';
    }

    /**
     * Fallback clipboard copy utility
     */
    function copyToClipboard(text) {
        if (navigator.clipboard && typeof navigator.clipboard.writeText === 'function') {
            return navigator.clipboard.writeText(text);
        } else {
            return new Promise((resolve, reject) => {
                try {
                    const textarea = document.createElement('textarea');
                    textarea.value = text;
                    textarea.style.position = 'fixed';
                    textarea.style.opacity = '0';
                    document.body.appendChild(textarea);
                    textarea.select();
                    const success = document.execCommand('copy');
                    document.body.removeChild(textarea);
                    if (success) {
                        resolve();
                    } else {
                        reject(new Error('execCommand copy failed'));
                    }
                } catch (err) {
                    reject(err);
                }
            });
        }
    }

    /**
     * Copy specific message handler
     */
    function handleCopyMessageClick(e, messageElement, button) {
        e.preventDefault();
        e.stopPropagation();
        
        const clone = messageElement.cloneNode(true);
        clone.querySelectorAll('.rtl-copy-msg-btn').forEach(btn => btn.remove());
        clone.querySelectorAll('.rtl-show-more-btn').forEach(btn => btn.remove());
        clone.querySelectorAll('mark.rtl-search-mark').forEach(mark => {
            const parent = mark.parentNode;
            if (parent) {
                while (mark.firstChild) parent.insertBefore(mark.firstChild, mark);
                parent.removeChild(mark);
            }
        });
        
        const text = (clone.innerText || clone.textContent || '').trim();
        copyToClipboard(text).then(() => {
            const originalHTML = button.innerHTML;
            button.innerHTML = '<svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke-width="2.5" stroke="currentColor"><path stroke-linecap="round" stroke-linejoin="round" d="M4.5 12.75l6 6 9-13.5" /></svg>';
            button.style.color = '#4caf50';
            button.style.borderColor = '#4caf50';
            
            setTimeout(() => {
                button.innerHTML = originalHTML;
                button.style.color = '';
                button.style.borderColor = '';
            }, 1500);
        }).catch(err => {
            console.error('Failed to copy message: ', err);
        });
    }

    /**
     * Copy entire conversation content
     */
    function copyEntireConversation() {
        const selector = CONFIG.messageContainerSelectors.join(', ');
        const elements = Array.from(document.querySelectorAll(selector));
        
        const topLevelElements = elements.filter(el => {
            return !elements.some(other => other !== el && other.contains(el));
        });
        
        if (topLevelElements.length === 0) {
            showCopyNotification('No messages found to copy');
            return;
        }
        
        let formattedText = '';
        
        topLevelElements.forEach(el => {
            let role = 'AI';
            const isUser = 
                el.matches('[class*="userMessageContainer_"]') ||
                el.matches('[data-content-search-unit-key$=":user"]') ||
                el.matches('.interactive-request') ||
                el.matches('.whitespace-pre-wrap') ||
                (el.className && el.className.includes('user'));
                
            if (isUser) {
                role = 'User';
            } else {
                const isAssistant = 
                    el.matches('[class*="timelineMessage_"]') ||
                    el.matches('[data-content-search-unit-key$=":assistant"]') ||
                    el.matches('.interactive-result') ||
                    el.matches('div.prose.prose-sm') ||
                    (el.className && (el.className.includes('agent') || el.className.includes('assistant') || el.className.includes('bot')));
                if (isAssistant) {
                    role = 'Agent';
                }
            }
            
            const clone = el.cloneNode(true);
            clone.querySelectorAll('.rtl-copy-msg-btn').forEach(btn => btn.remove());
            clone.querySelectorAll('.rtl-show-more-btn').forEach(btn => btn.remove());
            clone.querySelectorAll('mark.rtl-search-mark').forEach(mark => {
                const parent = mark.parentNode;
                if (parent) {
                    while (mark.firstChild) parent.insertBefore(mark.firstChild, mark);
                    parent.removeChild(mark);
                }
            });
            
            const text = (clone.innerText || clone.textContent || '').trim();
            if (text) {
                formattedText += `[${role}]:\n${text}\n\n`;
            }
        });
        
        copyToClipboard(formattedText.trim()).then(() => {
            showCopyNotification('Conversation copied to clipboard!');
        }).catch(err => {
            console.error('Failed to copy conversation: ', err);
            showCopyNotification('Failed to copy');
        });
    }

    /**
     * Show elegant copy toast notification
     */
    function showCopyNotification(text) {
        const existing = document.getElementById('rtl-copy-notification');
        if (existing) existing.remove();
        
        const notification = document.createElement('div');
        notification.id = 'rtl-copy-notification';
        notification.textContent = text;
        notification.style.position = 'fixed';
        notification.style.bottom = '100px';
        notification.style.left = '50%';
        notification.style.transform = 'translateX(-50%)';
        notification.style.background = 'rgba(30, 30, 30, 0.95)';
        notification.style.color = '#fff';
        notification.style.padding = '8px 16px';
        notification.style.borderRadius = '6px';
        notification.style.fontSize = '12px';
        notification.style.fontFamily = 'system-ui, sans-serif';
        notification.style.border = '1px solid rgba(255, 255, 255, 0.15)';
        notification.style.boxShadow = '0 4px 12px rgba(0,0,0,0.5)';
        notification.style.zIndex = '100001';
        notification.style.transition = 'opacity 0.2s ease';
        notification.style.opacity = '1';
        
        document.body.appendChild(notification);
        
        setTimeout(() => {
            notification.style.opacity = '0';
            setTimeout(() => notification.remove(), 200);
        }, 1500);
    }

    /**
     * Add copy message buttons to message containers
     */
    function processMessageCopyButtons() {
        const selector = CONFIG.messageContainerSelectors.join(', ');
        const elements = document.querySelectorAll(selector);

        const topLevel = Array.from(elements).filter(el => {
            return !Array.from(elements).some(other => other !== el && other.contains(el));
        });

        topLevel.forEach(container => {
            if (container.querySelector('.rtl-copy-msg-btn')) return;

            const style = window.getComputedStyle(container);
            if (style.position === 'static') {
                container.style.position = 'relative';
            }

            const btn = document.createElement('button');
            btn.className = 'rtl-copy-msg-btn';
            btn.title = 'Copy message';
            btn.innerHTML = '<svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke-width="2" stroke="currentColor"><path stroke-linecap="round" stroke-linejoin="round" d="M15.75 17.25v3.375c0 .621-.504 1.125-1.125 1.125h-9.75a1.125 1.125 0 01-1.125-1.125V7.875c0-.621.504-1.125 1.125-1.125H6.75a9.06 9.06 0 011.5.124m7.5 10.376h3.375c.621 0 1.125-.504 1.125-1.125V11.25c0-4.46-3.243-8.16-7.5-8.875a9.06 9.06 0 00-1.5-.124m7.5 10.376c0 .621-.504 1.125-1.125 1.125H6.75m10.875-1.125V11.25c0-4.46-3.243-8.16-7.5-8.875a9.06 9.06 0 00-1.5-.124M6.75 7.875v3.375c0 .621-.504 1.125-1.125 1.125H2.625M6.75 7.875V12m10.875-1.125v4.5m0 0a2.25 2.25 0 002.25 2.25h1.5a2.25 2.25 0 002.25-2.25v-4.5" /></svg>';
            
            btn.addEventListener('click', (e) => handleCopyMessageClick(e, container, btn));

            container.appendChild(btn);
        });
    }

    /**
     * Ensure all code blocks are LTR
     */
    function ensureCodeBlocksLTR() {
        // Force all code blocks to be LTR immediately
        const codeBlocks = document.querySelectorAll('div.code, pre, code');
        codeBlocks.forEach(block => {
            block.style.direction = 'ltr';
            block.style.textAlign = 'left';
            block.style.unicodeBidi = 'embed';
        });
    }

    /**
     * Process individual child elements for RTL
     * This handles cases where a message starts in English but has Hebrew paragraphs
     */
    function processChildrenForRTL(element) {
        // Process paragraphs, headings, and list items
        element.querySelectorAll('p, li, h1, h2, h3, h4, h5, h6').forEach(el => {
            // Skip if already processed and RTL
            if (el.style.direction === 'rtl') {
                return;
            }

            if (shouldBeRTLText(getAllTextContent(el))) {
                el.style.direction = 'rtl';
                el.style.textAlign = 'right';
                el.style.unicodeBidi = 'isolate';
                el.style.fontFamily = CONFIG.fontFamily;
                el.setAttribute('data-rtl-applied', 'true');
                if (el.tagName === 'LI') {
                    el.style.listStylePosition = 'inside';
                }
                injectRLM(el);
            }
        });

        // Process lists
        element.querySelectorAll('ul, ol').forEach(el => {
            // Skip if already processed and RTL
            if (el.style.direction === 'rtl') {
                return;
            }

            if (containsRTL(el.textContent)) {
                el.style.direction = 'rtl';
                el.style.textAlign = 'right';
                el.style.paddingRight = '20px';
                el.style.paddingLeft = '0';
                el.setAttribute('data-rtl-applied', 'true');
            }
        });
    }

    /**
     * Process Claude Code Planning webview — a separate webview with a #content div
     * containing rendered markdown (plan document).
     */
    function processPlanningWebview() {
        const content = document.getElementById('content');
        if (!content) return;
        // Only act in planning webview (has #comment-banner sibling)
        if (!document.getElementById('comment-banner')) return;

        processChildrenForRTL(content);
        // Also process direct block-level elements that processChildrenForRTL may skip
        content.querySelectorAll('blockquote, details, summary, td, th, dt, dd').forEach(el => {
            if (el.style.direction === 'rtl') return;
            if (shouldBeRTLText(getAllTextContent(el))) {
                el.style.direction = 'rtl';
                el.style.textAlign = 'right';
                el.style.unicodeBidi = 'isolate';
                el.style.fontFamily = CONFIG.fontFamily;
                el.setAttribute('data-rtl-applied', 'true');
            }
        });
    }

    /**
     * Collapse long Codex user messages with Show more / Show less toggle.
     */
    function processCodexUserMessageCollapse() {
        const containers = document.querySelectorAll('[data-content-search-unit-key$=":user"]');
        containers.forEach(container => {
            const textEl = container.querySelector('.text-size-chat');
            if (!textEl || textEl.hasAttribute('data-rtl-collapse-processed')) return;
            textEl.setAttribute('data-rtl-collapse-processed', 'true');

            // Wait for content to render, then check if it overflows
            requestAnimationFrame(() => {
                const lineHeight = parseFloat(getComputedStyle(textEl).lineHeight) || 22;
                const maxCollapsedHeight = lineHeight * 5; // ~5 lines
                if (textEl.scrollHeight <= maxCollapsedHeight + 10) return; // short message, skip

                textEl.classList.add('rtl-collapsed');

                const btn = document.createElement('button');
                btn.className = 'rtl-show-more-btn';
                btn.textContent = 'Show more';
                btn.addEventListener('click', (e) => {
                    e.preventDefault();
                    e.stopPropagation();
                    const isCollapsed = textEl.classList.contains('rtl-collapsed');
                    textEl.classList.toggle('rtl-collapsed');
                    btn.textContent = isCollapsed ? 'Show less' : 'Show more';
                    btn.classList.toggle('rtl-expanded', !isCollapsed);
                });

                // Insert button after the text element
                textEl.parentElement.appendChild(btn);
            });
        });
    }

    /**
     * Process Codex-specific compact UI elements such as thread title,
     * history items, menu labels, and question options.
     */
    function processCodexUI() {
        // Only target Codex-specific UI — thread title bar and history sidebar
        const uiElements = document.querySelectorAll([
            '[style*="view-transition-name: header-title"] .truncate',
            '[style*="view-transition-name: header-title"] button > span.truncate'
        ].join(', '));

        uiElements.forEach(el => {
            const text = (el.textContent || '').trim();
            const isRTL = shouldBeRTLText(text);

            if (isRTL) {
                el.style.direction = 'rtl';
                el.style.textAlign = 'right';
                el.style.unicodeBidi = 'plaintext';
                el.setAttribute('data-rtl-ui', 'true');
                el.setAttribute('data-rtl-applied', 'true');

                if (el.classList.contains('truncate') || el.classList.contains('whitespace-nowrap')) {
                    el.style.whiteSpace = 'normal';
                    el.style.overflow = 'visible';
                    el.style.textOverflow = 'clip';
                }
            } else {
                el.style.direction = '';
                el.style.textAlign = '';
                el.style.unicodeBidi = '';
                el.style.whiteSpace = '';
                el.style.overflow = '';
                el.style.textOverflow = '';
                el.removeAttribute('data-rtl-ui');
            }
        });
    }

    /**
     * Process Claude Code chat history list items for RTL
     * Checks each sessionItem's sessionName content and conditionally applies RTL
     */
    function processHistoryList() {
        // Process session items in the dropdown list
        const sessionItems = document.querySelectorAll('[class*="sessionItem_"]');
        sessionItems.forEach(item => {
            const sessionName = item.querySelector('[class*="sessionName_"]');
            if (!sessionName) return;

            const text = sessionName.textContent || '';
            const isRTL = shouldBeRTLText(text);

            if (isRTL) {
                item.style.textAlign = 'right';
                sessionName.style.direction = 'rtl';
                sessionName.setAttribute('data-rtl-applied', 'true');
            } else {
                item.style.textAlign = '';
                sessionName.style.direction = '';
                sessionName.removeAttribute('data-rtl-applied');
            }
        });

        // Process the header button text (current session title)
        const buttonTexts = document.querySelectorAll('[class*="sessionsButtonText_"], [class*="titleTextInner_"]');
        buttonTexts.forEach(el => {
            const text = el.textContent || '';
            if (shouldBeRTLText(text)) {
                el.style.direction = 'rtl';
                el.style.textAlign = 'right';
                el.setAttribute('data-rtl-applied', 'true');
            } else {
                el.style.direction = '';
                el.style.textAlign = '';
                el.removeAttribute('data-rtl-applied');
            }
        });
    }

    /**
     * Process all chat elements (including Antigravity)
     */
    function processElements() {
        const selector = CONFIG.chatSelectors.join(', ');
        const elements = document.querySelectorAll(selector);

        elements.forEach(element => {
            // Antigravity user message
            if (element.classList && element.classList.contains('whitespace-pre-wrap')) {
                // Simple RTL detection for user messages
                const text = element.textContent || '';
                if (containsRTL(text)) {
                    element.style.direction = 'rtl';
                    element.style.textAlign = 'right';
                    element.setAttribute('data-rtl-applied', 'true');
                } else if (element.getAttribute('data-rtl-applied') === 'true') {
                    element.style.direction = '';
                    element.style.textAlign = '';
                    element.removeAttribute('data-rtl-applied');
                }
                return;
            }
            // Antigravity agent message
            if (element.classList && element.classList.contains('prose') && element.classList.contains('prose-sm')) {
                // Only process if not already processed
                if (!element.hasAttribute('data-rtl-container-processed')) {
                    const firstText = getAllTextContent(element).substring(0, 500);
                    if (shouldBeRTLText(firstText)) {
                        element.setAttribute('data-rtl-container-processed', 'true');
                        // Apply RTL to text elements that should be RTL (check each independently)
                        element.querySelectorAll('p, h1, h2, h3, h4, h5, h6, li').forEach(el => {
                            if (shouldBeRTLText(getAllTextContent(el))) {
                                el.style.direction = 'rtl';
                                el.style.textAlign = 'right';
                                el.setAttribute('data-rtl-applied', 'true');
                                if (el.tagName === 'LI') {
                                    el.style.listStylePosition = 'inside';
                                }
                            }
                        });
                        // Also handle lists (ol, ul)
                        element.querySelectorAll('ol, ul').forEach(list => {
                            list.style.direction = 'rtl';
                            list.style.textAlign = 'right';
                            list.setAttribute('data-rtl-applied', 'true');
                        });
                    }
                }
                return;
            }

            // Claude Code timeline/agent messages - process all child elements
            if (element.matches && element.matches('[class*="timelineMessage_"], [class*="root_"]')) {
                // Always re-process children — Rewind replaces inner elements
                // while the container keeps its data-rtl-container-processed attribute
                processChildrenForRTL(element);
                element.setAttribute('data-rtl-container-processed', 'true');
                return;
            }

            // Default logic for Copilot/Claude user messages
            const wasRTL = element.getAttribute('data-rtl-applied') === 'true';
            const needsRTL = shouldBeRTL(element);
            const trackedRTL = rtlTrackedElements.has(element);

            if (needsRTL && !wasRTL) {
                applyRTL(element);
            } else if (needsRTL && wasRTL && !element.style.direction) {
                // Re-apply RTL if styles were stripped (e.g. Rewind re-render)
                applyRTL(element);
            } else if (!needsRTL && trackedRTL && !wasRTL) {
                // React re-render stripped data-rtl-applied and changed text (e.g. Rewind menu)
                // Re-apply RTL since we know this element had Hebrew content before
                applyRTL(element);
            } else if (!needsRTL && wasRTL) {
                removeRTL(element);
            } else if (!needsRTL && !wasRTL && !trackedRTL) {
                // Even if parent is LTR, check children for Hebrew paragraphs
                // This handles messages that start in English but have Hebrew content
                processChildrenForRTL(element);
            }
        });

        // Also process input boxes
        processInputs();

        // Process chat history list items for RTL
        processHistoryList();

        // Process Codex thread title, history labels, and compact controls
        processCodexUI();

        // Collapse long Codex user messages
        processCodexUserMessageCollapse();

        // Process Claude Code Planning webview (separate tab)
        processPlanningWebview();

        // Ensure all code blocks are LTR (run after RTL processing)
        ensureCodeBlocksLTR();

        // Inject user message navigation buttons above input
        injectMessageNavigation();
    }

    /**
     * Initialize the RTL support
     */
    /**
     * Safety net for Codex: its markup changes often, and when our selectors miss, nothing was
     * RTL at all. `unicode-bidi: plaintext` needs no class names — the browser gives each
     * paragraph the direction of its first strong character. Elements we handled ourselves
     * (data-rtl-applied) are left alone so the two don't fight.
     */
    function markCodexWebview() {
        try {
            const extensionId = new URLSearchParams(location.search).get('extensionId') || '';
            const isCodex = extensionId.toLowerCase().includes('openai.chatgpt')
                || !!document.querySelector('[data-codex-composer="true"]');
            if (isCodex) document.documentElement.classList.add('rtl-codex-fallback');
        } catch (e) { /* not a webview URL — skip the fallback */ }
    }

    function init() {
        // Inject CSS styles first (one-time) - prevents flickering in Monaco inputs
        injectRTLStyles();
        markCodexWebview();

        // Process existing elements
        processElements();
        processMessageCopyButtons();

        // Watch for new elements and streaming content
        const observer = new MutationObserver((mutations) => {
            let hasNewNodes = false;
            let hasTextChanges = false;

            mutations.forEach((mutation) => {
                if (mutation.addedNodes.length > 0) {
                    hasNewNodes = true;
                    mutation.addedNodes.forEach((node) => {
                        if (node.nodeType === 1) { // Element node
                            // Immediately handle code blocks
                            if (node.tagName === 'PRE' || node.tagName === 'CODE' ||
                                (node.classList && node.classList.contains('code'))) {
                                node.style.direction = 'ltr';
                                node.style.textAlign = 'left';
                                node.style.unicodeBidi = 'embed';
                            }

                            // Check for code blocks inside the node
                            const codeBlocks = node.querySelectorAll('div.code, pre, code');
                            if (codeBlocks.length > 0) {
                                codeBlocks.forEach(block => {
                                    block.style.direction = 'ltr';
                                    block.style.textAlign = 'left';
                                    block.style.unicodeBidi = 'embed';
                                });
                            }

                            // Immediately check if this node matches our chat selectors
                            const selector = CONFIG.chatSelectors.join(', ');
                            let chatElements = [];

                            // Check if the node itself is a chat element
                            if (node.matches && node.matches(selector)) {
                                chatElements.push(node);
                            }

                            // Check for chat elements inside the node
                            const childChatElements = node.querySelectorAll(selector);
                            if (childChatElements.length > 0) {
                                chatElements.push(...childChatElements);
                            }

                            // Process chat elements immediately
                            chatElements.forEach(element => {
                                // Claude Code timeline/agent messages - process all child elements
                                if (element.matches && element.matches('[class*="timelineMessage_"], [class*="root_"]')) {
                                    processChildrenForRTL(element);
                                    element.setAttribute('data-rtl-container-processed', 'true');
                                    return;
                                }

                                const wasRTL = element.getAttribute('data-rtl-applied') === 'true';
                                const needsRTL = shouldBeRTL(element);

                                if (needsRTL && !wasRTL) {
                                    applyRTL(element);
                                } else if (needsRTL && wasRTL && !element.style.direction) {
                                    applyRTL(element);
                                } else if (!needsRTL && wasRTL) {
                                    removeRTL(element);
                                } else if (!needsRTL && !wasRTL) {
                                    processChildrenForRTL(element);
                                }
                            });
                        }
                    });
                }
                if (mutation.type === 'characterData') {
                    hasTextChanges = true;
                }
            });

            // For streaming content updates, debounce and reprocess all
            if (hasTextChanges || hasNewNodes) {
                clearTimeout(window._rtlProcessTimeout);
                window._rtlProcessTimeout = setTimeout(() => {
                    processElements();
                }, 50);
            }
        });

        observer.observe(document.body, {
            childList: true,
            subtree: true,
            characterData: true // Needed for streaming messages
        });

        // Process periodically — catches re-renders (e.g. Rewind) that the observer may miss
        setInterval(() => {
            processElements();
            processMonacoInputs(); // Monaco Editor inputs (Copilot) - uses CSS class toggle
            processInputs();       // Other inputs (Claude Code) - uses inline styles
            injectMessageNavigation(); // Ensure nav buttons exist (handles late DOM)
            processMessageCopyButtons(); // Ensure copy buttons exist on messages
        }, 200);

        // Periodically check for auto-resume needs
        setInterval(() => {
            checkAutoResume();
        }, 1000);

        console.log('✅ RTL & Agent Tools: Initialized');
    }

    // Start when ready
    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', init);
    } else {
        init();
    }

    // Expose manual refresh function
    window.refreshRTL = function() {
        processElements();
        console.log('✅ RTL & Agent Tools: Refreshed');
    };

    // Expose YOLO mode toggle and settings
    window.toggleYOLO = toggleYolo;
    window.setYoloDelay = function(secs) { setYoloDelayMs(Math.round(secs * 1000)); console.log('YOLO delay set to ' + secs + 's'); };
    window.getYoloDelay = function() { return getYoloDelayMs() / 1000; };
    window.setYoloAutoApprovePlans = function(on) { setYoloAutoApprovePlans(on); };
    window.getYoloAutoApprovePlans = function() { return getYoloAutoApprovePlans(); };

    // Expose function to check RTL status
    window.checkRTL = function(text) {
        console.log(`Text: "${text}"`);
        console.log(`Contains RTL: ${containsRTL(text)}`);
    };

    console.log('🔄 RTL & Agent Tools loaded. Use window.refreshRTL() to manually refresh.');
})();
