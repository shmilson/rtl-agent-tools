/**
 * Standalone script to inject Plan RTL into Claude Code's extension.js.
 * Run: node inject-plan-rtl.js
 *
 * IMPORTANT: The injected script lives inside a backtick template literal (s46).
 * All backslash escapes must be doubled: \p → \\p, \u → \\u, etc.
 */
const fs = require('fs');
const path = require('path');
const os = require('os');

const PLAN_MARKER = 'RTL-Plan-Injection';

function buildPlanRTLScript() {
    // NOTE: This string is injected INTO a JS template literal (backtick string).
    // Backslashes must be doubled so they survive template evaluation.
    // \p{L} → \\p{L}, \u200F → \\u200F
    return [
        '<script nonce="{{NONCE}}">',
        '// ' + PLAN_MARKER,
        '(function(){',
        '  var RTL_RANGES=[{s:0x0590,e:0x05FF},{s:0x0600,e:0x06FF},{s:0x0750,e:0x077F},{s:0x08A0,e:0x08FF},{s:0x0700,e:0x074F},{s:0x0780,e:0x07BF}];',
        '  function isRTL(c){var code=c.charCodeAt(0);return RTL_RANGES.some(function(r){return code>=r.s&&code<=r.e})}',
        '  function containsRTL(t){if(!t)return false;for(var i=0;i<t.length;i++)if(isRTL(t[i]))return true;return false}',
        // \\p{L} — double-escaped for the backtick template literal
        '  function shouldBeRTLText(t){if(!t)return false;t=t.trim();if(!t)return false;var first=null,rc=0,lc=0;for(var ch of t){if(isRTL(ch)){rc++;if(first===null)first=true}else if(/\\\\p{L}/u.test(ch)){lc++;if(first===null)first=false}}if(first===null)return false;if(first)return true;var tot=rc+lc;return tot>0&&(rc/tot)>=0.3}',
        // \\u200F — double-escaped for the backtick template literal
        '  function injectRLM(el){var RLM="\\\\u200F";var f=el.firstChild;if(f&&f.nodeType===3&&f.textContent.startsWith(RLM))return;el.insertBefore(document.createTextNode(RLM),f)}',
        '  function processContent(){',
        '    var content=document.getElementById("content");',
        '    if(!content)return;',
        '    content.querySelectorAll("p,li,h1,h2,h3,h4,h5,h6").forEach(function(el){',
        '      if(el.style.direction==="rtl")return;',
        '      if(shouldBeRTLText(el.textContent)){',
        '        el.style.direction="rtl";el.style.textAlign="right";el.style.unicodeBidi="isolate";',
        '        el.setAttribute("data-rtl-applied","true");',
        '        if(el.tagName==="LI")el.style.listStylePosition="inside";',
        '        injectRLM(el);',
        '      }',
        '    });',
        '    content.querySelectorAll("ul,ol").forEach(function(el){',
        '      if(el.style.direction==="rtl")return;',
        '      if(containsRTL(el.textContent)){',
        '        el.style.direction="rtl";el.style.textAlign="right";el.style.paddingRight="20px";el.style.paddingLeft="0";',
        '        el.setAttribute("data-rtl-applied","true");',
        '      }',
        '    });',
        '    content.querySelectorAll("blockquote,details,summary,td,th,dt,dd").forEach(function(el){',
        '      if(el.style.direction==="rtl")return;',
        '      if(shouldBeRTLText(el.textContent)){',
        '        el.style.direction="rtl";el.style.textAlign="right";el.style.unicodeBidi="isolate";',
        '        el.setAttribute("data-rtl-applied","true");',
        '      }',
        '    });',
        '    content.querySelectorAll("pre,code").forEach(function(el){',
        '      el.style.direction="ltr";el.style.textAlign="left";el.style.unicodeBidi="embed";',
        '    });',
        '  }',
        '  window.addEventListener("message",function(e){if(e.data&&e.data.type==="updateContent")setTimeout(processContent,50)});',
        '  if(document.readyState==="loading")document.addEventListener("DOMContentLoaded",processContent);',
        '  else processContent();',
        '})();',
        '</script>'
    ].join('\n');
}

// Find Claude Code extension
const home = os.homedir();
const extensionsDir = path.join(home, '.vscode', 'extensions');
const entries = fs.readdirSync(extensionsDir);
const claudeDir = entries.find(e => e.startsWith('anthropic.claude-code-'));
if (!claudeDir) {
    console.log('Claude Code extension not found');
    process.exit(1);
}

const extensionDir = path.join(extensionsDir, claudeDir);
const extJsPath = path.join(extensionDir, 'extension.js');

let content = fs.readFileSync(extJsPath, 'utf8');
if (content.includes(PLAN_MARKER)) {
    console.log('Already injected');
    process.exit(0);
}

const planBodyClose = content.indexOf("vscode.postMessage({ type: 'ready' })");
if (planBodyClose < 0) {
    console.log('Plan template not found');
    process.exit(1);
}

const bodyCloseIdx = content.indexOf('</body>', planBodyClose);
if (bodyCloseIdx < 0) {
    console.log('</body> not found');
    process.exit(1);
}

// Create backup
const backupPath = `${extJsPath}.rtl-backup`;
if (!fs.existsSync(backupPath)) {
    fs.copyFileSync(extJsPath, backupPath);
    console.log('Backup created:', backupPath);
}

const rtlScript = buildPlanRTLScript();
const before = content.substring(0, bodyCloseIdx);
const after = content.substring(bodyCloseIdx);
content = before + rtlScript + '\n' + after;
fs.writeFileSync(extJsPath, content, 'utf8');

// Verify
const verify = fs.readFileSync(extJsPath, 'utf8');
console.log('Marker present:', verify.includes(PLAN_MARKER));

// Check escaping: after template evaluation, \\p should become \p
const injIdx = verify.indexOf(PLAN_MARKER);
const chunk = verify.substring(injIdx, injIdx + 1000);
const hasDoubleEscape = chunk.includes('\\\\p{L}');
console.log('Double-escaped \\\\p{L}:', hasDoubleEscape);

console.log('Plan RTL injected successfully!');
