/**
 * RTL & Agent Tools: workbench (main window) script.
 *
 * Loaded into the editor's own window, where Antigravity renders its built-in agent chat.
 * That UI has no stable class names, so instead of chasing selectors this relies on the
 * browser's native bidi: `unicode-bidi: plaintext` gives every paragraph the direction of its
 * first strong character. Hebrew/Arabic paragraphs become RTL, everything else is untouched.
 *
 * Runs under the workbench's Trusted Types CSP: no innerHTML, no eval.
 */
(function () {
    'use strict';

    if (window.__rtlAgentToolsWorkbench) return;
    window.__rtlAgentToolsWorkbench = true;

    const STYLE_ID = 'rtl-agent-tools-workbench-style';
    const RTL_CHAR = /[֐-׿؀-ۿ܀-ݏݐ-ݿࢠ-ࣿיִ-﷿ﹰ-﻿]/;
    const LTR_CHAR = /[A-Za-zÀ-ɏͰ-ϿЀ-ӿ]/;

    // Editor surfaces that must never be touched.
    const EXCLUDED = '.monaco-editor, .xterm, .terminal-wrapper, pre, code';

    const CSS = `
        :where(p, li, h1, h2, h3, h4, h5, h6, blockquote, td, th, dd, dt, .whitespace-pre-wrap, .break-words, textarea, [contenteditable="true"], [contenteditable="plaintext-only"]) {
            unicode-bidi: plaintext;
        }
        :where(.monaco-editor, .xterm, pre, code) :where(p, li, div, span, textarea) {
            unicode-bidi: normal;
        }
        :where(ul, ol)[data-rtl-list="true"] {
            direction: rtl;
        }
    `;

    function firstStrongIsRTL(text) {
        for (const ch of text) {
            if (RTL_CHAR.test(ch)) return true;
            if (LTR_CHAR.test(ch)) return false;
        }
        return false;
    }

    function ensureStyle() {
        if (document.getElementById(STYLE_ID)) return;
        const style = document.createElement('style');
        style.id = STYLE_ID;
        style.textContent = CSS;
        (document.head || document.documentElement).appendChild(style);
    }

    // Bullets/numbers follow the list's own direction, which plaintext can't change.
    function fixLists(root) {
        const lists = root.querySelectorAll ? root.querySelectorAll('ul, ol') : [];
        for (const list of lists) {
            if (list.closest(EXCLUDED)) continue;
            const rtl = firstStrongIsRTL((list.textContent || '').slice(0, 400));
            if (rtl && list.getAttribute('data-rtl-list') !== 'true') {
                list.setAttribute('data-rtl-list', 'true');
            } else if (!rtl && list.hasAttribute('data-rtl-list')) {
                list.removeAttribute('data-rtl-list');
            }
        }
    }

    let scheduled = false;
    function scheduleFix() {
        if (scheduled) return;
        scheduled = true;
        requestAnimationFrame(() => {
            scheduled = false;
            ensureStyle();
            fixLists(document);
        });
    }

    function start() {
        ensureStyle();
        fixLists(document);
        new MutationObserver(scheduleFix).observe(document.documentElement, {
            childList: true,
            subtree: true
        });
        console.log('RTL & Agent Tools: workbench RTL active');
    }

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', start);
    } else {
        start();
    }
})();
