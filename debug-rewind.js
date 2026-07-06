// Paste this in the Claude Code DevTools console to debug the Rewind RTL issue
// It monitors user message containers and logs what happens when Rewind is clicked

(function() {
    const selectors = [
        '[class*="message_"][class*="userMessageContainer_"]',
        '[class*="timelineMessage_"]',
        '[class*="root_"]'
    ].join(', ');

    // Log current state of all user messages
    function logState(reason) {
        const msgs = document.querySelectorAll('[class*="message_"][class*="userMessageContainer_"]');
        console.group(`[RTL Debug] ${reason} — ${msgs.length} user messages`);
        msgs.forEach((el, i) => {
            const text = (el.textContent || '').substring(0, 50);
            console.log(`  #${i}: dir=${el.style.direction || 'none'}, align=${el.style.textAlign || 'none'}, data-rtl=${el.getAttribute('data-rtl-applied')}, text="${text}..."`);
        });
        console.groupEnd();
    }

    // Watch for ANY DOM changes in the chat area
    const obs = new MutationObserver((mutations) => {
        let dominated = false;
        for (const m of mutations) {
            // Check removed nodes
            for (const node of m.removedNodes) {
                if (node.nodeType !== 1) continue;
                if (node.matches && node.matches(selectors)) {
                    console.warn('[RTL Debug] REMOVED chat element:', node.className, 'had data-rtl:', node.getAttribute('data-rtl-applied'));
                    dominated = true;
                }
                const children = node.querySelectorAll ? node.querySelectorAll(selectors) : [];
                children.forEach(c => {
                    console.warn('[RTL Debug] REMOVED (nested):', c.className, 'had data-rtl:', c.getAttribute('data-rtl-applied'));
                    dominated = true;
                });
            }
            // Check added nodes
            for (const node of m.addedNodes) {
                if (node.nodeType !== 1) continue;
                if (node.matches && node.matches(selectors)) {
                    console.log('[RTL Debug] ADDED chat element:', node.className, 'dir:', node.style.direction);
                    dominated = true;
                }
                const children = node.querySelectorAll ? node.querySelectorAll(selectors) : [];
                children.forEach(c => {
                    console.log('[RTL Debug] ADDED (nested):', c.className, 'dir:', c.style.direction);
                    dominated = true;
                });
            }
            // Check attribute changes on chat elements
            if (m.type === 'attributes' && m.target.matches && m.target.matches(selectors)) {
                console.log('[RTL Debug] ATTR changed on:', m.attributeName, '=', m.target.getAttribute(m.attributeName), 'on', m.target.className.substring(0, 60));
                dominated = true;
            }
        }
        if (dominated) {
            setTimeout(() => logState('After DOM change'), 50);
        }
    });

    obs.observe(document.body, { childList: true, subtree: true, attributes: true, attributeFilter: ['style', 'class', 'data-rtl-applied'] });

    logState('Initial state');
    console.log('[RTL Debug] 🔍 Monitoring active. Click Rewind now...');
})();
