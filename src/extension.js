const vscode = require('vscode');
const fs = require('fs');
const path = require('path');
const os = require('os');

// Internal marker written into injected files so we can detect / strip our injection.
// This is an implementation detail, not a product name.
const MARKER = 'RTL for VS Code Agents';
const SCRIPT_FILE = 'rtl-for-vs-code-agents.js';

// The extension version is stamped into the injection marker so we can detect a STALE
// injection (an older script left inside the agent) and refresh it — even when the file
// is already "injected". Read once at load, independent of activate().
const CURRENT_VERSION = (() => {
    try {
        return JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'package.json'), 'utf8')).version;
    } catch (e) {
        return '0';
    }
})();

let statusBarItem;

function getConfig() {
    return vscode.workspace.getConfiguration('rtlForVsCodeAgents');
}

function getScriptContent(extensionPath) {
    const scriptPath = path.join(extensionPath, SCRIPT_FILE);
    return fs.readFileSync(scriptPath, 'utf8');
}

function resolveCodexWebviewEntrypoint(extensionDir) {
    const indexHtmlPath = path.join(extensionDir, 'webview', 'index.html');
    if (!fs.existsSync(indexHtmlPath)) {
        return null;
    }

    const html = fs.readFileSync(indexHtmlPath, 'utf8');
    const match = html.match(/<script[^>]+src="\.\/([^"]+\.js)"/i);
    if (!match) {
        return null;
    }

    return path.join(extensionDir, 'webview', match[1].replace(/\//g, path.sep));
}

function listExtensionInstallations() {
    const home = os.homedir();
    const locations = [
        { label: 'VS Code', basePath: path.join(home, '.vscode', 'extensions') },
        { label: 'VS Code (Remote/WSL)', basePath: path.join(home, '.vscode-server', 'extensions') },
        { label: 'VS Code Insiders (Remote/WSL)', basePath: path.join(home, '.vscode-server-insiders', 'extensions') },
        { label: 'Cursor', basePath: path.join(home, '.cursor', 'extensions') },
        { label: 'Cursor (Remote/WSL)', basePath: path.join(home, '.cursor-server', 'extensions') },
        { label: 'Antigravity', basePath: path.join(home, '.antigravity', 'extensions') },
        { label: 'Antigravity IDE', basePath: path.join(home, '.antigravity-ide', 'extensions') }
    ];

    // Extension patterns to search for
    const extensionPatterns = [
        {
            prefix: 'anthropic.claude-code-',
            type: 'claude-extension',
            webviewFile: path.join('webview', 'index.js')
        },
        {
            prefix: 'google.geminicodeassist-',
            type: 'gemini-extension',
            webviewFile: path.join('webview', 'app_bundle.js')
        },
        {
            prefix: 'openai.chatgpt-',
            type: 'codex-extension',
            resolveIndexPath: resolveCodexWebviewEntrypoint
        }
    ];

    const results = [];

    for (const location of locations) {
        if (!fs.existsSync(location.basePath)) {
            continue;
        }

        const entries = fs.readdirSync(location.basePath, { withFileTypes: true });
        for (const entry of entries) {
            if (!entry.isDirectory()) continue;

            for (const pattern of extensionPatterns) {
                if (!entry.name.startsWith(pattern.prefix)) continue;

                const extensionDir = path.join(location.basePath, entry.name);
                const indexPath = pattern.resolveIndexPath
                    ? pattern.resolveIndexPath(extensionDir)
                    : path.join(extensionDir, pattern.webviewFile);

                if (!indexPath) continue;

                results.push({
                    type: pattern.type,
                    location: location.label,
                    name: entry.name,
                    extensionDir,
                    indexPath
                });
            }
        }
    }

    return results;
}

function getAntigravityAppInstallation() {
    const localAppData = process.env.LOCALAPPDATA || path.join(os.homedir(), 'AppData', 'Local');
    const appPath = path.join(localAppData, 'Programs', 'Antigravity');
    const chatPath = path.join(appPath, 'resources', 'app', 'extensions', 'antigravity', 'out', 'media', 'chat.js');

    if (fs.existsSync(chatPath)) {
        return {
            type: 'antigravity-app',
            location: 'Antigravity',
            name: 'Antigravity App',
            extensionDir: appPath,
            indexPath: chatPath
        };
    }

    return null;
}

function ensureBackup(indexPath) {
    const backupPath = `${indexPath}.backup`;
    if (!fs.existsSync(backupPath)) {
        fs.copyFileSync(indexPath, backupPath);
        return true;
    }
    return false;
}

function isInjected(content) {
    return content.includes('// ' + MARKER);
}

// True only when the injection matches the CURRENT extension version. An injection from
// an older build is "injected" but NOT current, so it must be refreshed.
function isCurrentInjection(content) {
    return content.includes('// ' + MARKER + ' v' + CURRENT_VERSION + ' ');
}

function hasAnyInjection(content) {
    return content.includes('// ' + MARKER) || content.includes('// RTL Support for Claude Code');
}

function needsInjection(indexPath) {
    if (!fs.existsSync(indexPath)) return false;
    const content = fs.readFileSync(indexPath, 'utf8');
    // Re-inject if not injected at all, or if the injected script is from an older version.
    return !isInjected(content) || !isCurrentInjection(content);
}

function buildConfigBlock() {
    const config = getConfig();
    const yoloSeconds = Number(config.get('yoloCountdownSeconds', 5)) || 0;
    const userMessageBorder = config.get('userMessageBorder', true);
    const quickPrompts = Array.isArray(config.get('quickPrompts', [])) ? config.get('quickPrompts', []) : [];
    return `window.__RTL_CONFIG__ = ${JSON.stringify({ yoloDelayMs: yoloSeconds * 1000, userMessageBorder, quickPrompts })};`;
}

const PLAN_MARKER = 'RTL-Plan-Injection';

/**
 * Build a minimal inline RTL script for the Claude Code Plan/Review webview.
 * Includes only: RTL detection, processChildrenForRTL, observer, and init.
 */
function buildPlanRTLScript() {
    // IMPORTANT: The output of this function is injected INTO a JS backtick template
    // literal (the s46 variable in Claude Code's extension.js). That means all
    // backslash escapes are evaluated TWICE: once when this template is evaluated,
    // and once when s46 is evaluated. So we need double-escaping:
    //   \\\\p{L} → (our template) → \\p{L} → (s46 template) → \p{L}  ✓
    //   \\\\u200F → (our template) → \\u200F → (s46 template) → \u200F ✓
    // Also: use double-quotes inside the script to avoid issues with s46's backticks.
    return [
        '<script nonce="{{NONCE}}">',
        '// ' + PLAN_MARKER,
        '(function(){',
        '  var RTL_RANGES=[{s:0x0590,e:0x05FF},{s:0x0600,e:0x06FF},{s:0x0750,e:0x077F},{s:0x08A0,e:0x08FF},{s:0x0700,e:0x074F},{s:0x0780,e:0x07BF}];',
        '  function isRTL(c){var code=c.charCodeAt(0);return RTL_RANGES.some(function(r){return code>=r.s&&code<=r.e})}',
        '  function containsRTL(t){if(!t)return false;for(var i=0;i<t.length;i++)if(isRTL(t[i]))return true;return false}',
        '  function shouldBeRTLText(t){if(!t)return false;t=t.trim();if(!t)return false;var first=null,rc=0,lc=0;for(var ch of t){if(isRTL(ch)){rc++;if(first===null)first=true}else if(/\\\\p{L}/u.test(ch)){lc++;if(first===null)first=false}}if(first===null)return false;if(first)return true;var tot=rc+lc;return tot>0&&(rc/tot)>=0.3}',
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

/**
 * Inject RTL script into the Plan/Review webview HTML template inside Claude Code's extension.js.
 * Finds '</body>' inside the plan template and inserts the RTL script before it.
 */
function injectPlanRTL(extensionDir) {
    const extJsPath = path.join(extensionDir, 'extension.js');
    if (!fs.existsSync(extJsPath)) return { changed: false, reason: 'no-extension-js' };

    let content = fs.readFileSync(extJsPath, 'utf8');

    // Already injected?
    if (content.includes(PLAN_MARKER)) return { changed: false, reason: 'already-injected' };

    // Find the plan template: look for the closing </body> that's inside the template string.
    // The plan template has a unique structure: </script>\n</body>\n</html> at the end of a backtick-string.
    // We look for '</body>' preceded by '</script>' to target only the plan template.
    const planBodyClose = content.indexOf('vscode.postMessage({ type: \'ready\' });');
    if (planBodyClose < 0) return { changed: false, reason: 'plan-template-not-found' };

    // Find the </script></body> after the ready message
    const bodyCloseIdx = content.indexOf('</body>', planBodyClose);
    if (bodyCloseIdx < 0) return { changed: false, reason: 'body-close-not-found' };

    // Create backup of extension.js
    const backupPath = `${extJsPath}.rtl-backup`;
    if (!fs.existsSync(backupPath)) {
        fs.copyFileSync(extJsPath, backupPath);
    }

    const rtlScript = buildPlanRTLScript();
    const before = content.substring(0, bodyCloseIdx);
    const after = content.substring(bodyCloseIdx);
    content = before + rtlScript + '\n' + after;
    fs.writeFileSync(extJsPath, content, 'utf8');
    return { changed: true, reason: 'injected' };
}

/**
 * Remove the Plan RTL injection from Claude Code's extension.js.
 */
function stripPlanInjection(extensionDir) {
    const extJsPath = path.join(extensionDir, 'extension.js');
    const backupPath = `${extJsPath}.rtl-backup`;

    if (fs.existsSync(backupPath)) {
        fs.copyFileSync(backupPath, extJsPath);
        fs.unlinkSync(backupPath);
        return true;
    }

    // Fallback: strip inline
    if (!fs.existsSync(extJsPath)) return false;
    let content = fs.readFileSync(extJsPath, 'utf8');
    if (!content.includes(PLAN_MARKER)) return false;

    // Remove the injected <script>...</script> block
    const startTag = `<script>\n// ${PLAN_MARKER}`;
    const si = content.indexOf(startTag);
    if (si < 0) return false;
    const endTag = '</script>';
    const ei = content.indexOf(endTag, si);
    if (ei < 0) return false;
    content = content.substring(0, si) + content.substring(ei + endTag.length);
    // Clean up extra newline
    content = content.replace(/\n\n<\/body>/, '\n</body>');
    fs.writeFileSync(extJsPath, content, 'utf8');
    return true;
}

function injectScript(indexPath, scriptContent) {
    let original = fs.readFileSync(indexPath, 'utf8');
    const wasInjected = isInjected(original);
    if (wasInjected && isCurrentInjection(original)) {
        return { changed: false, reason: 'already-current' };
    }

    // ensureBackup only copies if no backup exists yet, so a stale injection never
    // becomes the "pristine" backup — the backup stays the original agent file.
    ensureBackup(indexPath);

    // Strip any existing injection (old version or legacy header) before re-appending.
    original = stripInjection(original);

    const configBlock = buildConfigBlock();
    const appended = `${original}\n\n// ${MARKER} v${CURRENT_VERSION} (injected)\n${configBlock}\n${scriptContent}\n`;
    fs.writeFileSync(indexPath, appended, 'utf8');
    return { changed: true, reason: wasInjected ? 're-injected' : 'injected' };
}

async function confirmInjection(target) {
    let nameLine;
    if (target.type === 'antigravity-app') {
        nameLine = 'Antigravity: installation found requiring RTL injection.';
    } else if (target.type === 'codex-extension') {
        nameLine = 'Codex: installation found requiring RTL injection.';
    } else if (target.type === 'gemini-extension') {
        nameLine = 'Gemini Code Assist: new version found requiring RTL injection.';
    } else {
        nameLine = 'Claude Code: new version found requiring RTL injection.';
    }

    const detail = target.name ? `\nVersion: ${target.name}` : '';

    const message = `${nameLine}${detail}\n\nRTL injection will modify a local file. Continue?`;
    const yes = 'Inject';
    const no = 'Not now';

    const choice = await vscode.window.showInformationMessage(message, yes, no);
    return choice === yes;
}

function showPostInjectNotice(targets) {
    const includesAntigravity = targets.some(t => t.type === 'antigravity-app');
    const includesWebviewExtension = targets.some(t =>
        t.type === 'claude-extension' ||
        t.type === 'gemini-extension' ||
        t.type === 'codex-extension'
    );

    let message = 'RTL: injection successful.';
    let buttons = [];

    if (includesWebviewExtension) {
        message += ' Restart Extension Host to apply changes.';
        buttons.push('Restart Extension Host', 'Reload Window');
    }
    if (includesAntigravity) {
        message += ' Antigravity: restart the app.';
    }

    vscode.window.showInformationMessage(message, ...buttons).then(choice => {
        if (choice === 'Restart Extension Host') {
            vscode.commands.executeCommand('workbench.action.restartExtensionHost');
        } else if (choice === 'Reload Window') {
            vscode.commands.executeCommand('workbench.action.reloadWindow');
        }
    });
}

async function checkAndInject(context, options = {}) {
    const { quiet = false, interactive = false, notifyNoChanges = false } = options;
    const config = getConfig();

    if (!config.get('autoInject', true) && quiet) {
        return;
    }

    const scriptContent = getScriptContent(context.extensionPath);
    const installations = listExtensionInstallations();
    const antigravityApp = getAntigravityAppInstallation();
    const targets = antigravityApp ? [...installations, antigravityApp] : installations;

    if (targets.length === 0) {
        if (!quiet && notifyNoChanges) {
            vscode.window.showInformationMessage('RTL: no installations of Codex, Claude Code, Gemini Code Assist or Antigravity found.');
        }
        return;
    }

    const injectedPaths = new Set(context.globalState.get('rtlForVsCodeAgents.injectedPaths', []));
    const updatedPaths = [];
    const errors = [];

    for (const install of targets) {
        if (!fs.existsSync(install.indexPath)) {
            continue;
        }

        if (!needsInjection(install.indexPath)) {
            continue;
        }

        if (interactive) {
            const approved = await confirmInjection(install);
            if (!approved) {
                continue;
            }
        }

        try {
            const result = injectScript(install.indexPath, scriptContent);
            if (result.changed) {
                injectedPaths.add(install.indexPath);
                updatedPaths.push(install);
            }
            // Also inject RTL into Plan/Review webview for Claude Code
            if (install.type === 'claude-extension') {
                try {
                    injectPlanRTL(install.extensionDir);
                } catch (planErr) {
                    console.error('RTL: failed to inject Plan RTL:', planErr.message);
                }
            }
        } catch (error) {
            errors.push({ install, error });
        }
    }

    await context.globalState.update('rtlForVsCodeAgents.injectedPaths', Array.from(injectedPaths));
    await context.globalState.update('rtlForVsCodeAgents.lastCheck', Date.now());

    if (!quiet) {
        if (updatedPaths.length > 0) {
            showPostInjectNotice(updatedPaths);
        } else if (errors.length === 0 && notifyNoChanges) {
            vscode.window.showInformationMessage('RTL injection: nothing to update.');
        }

        if (errors.length > 0) {
            const message = errors[0].error?.message || 'Unknown error';
            vscode.window.showWarningMessage(`RTL injection: some injections failed — error: ${message}`);
        }
    }
}

async function configureCustomCss(context, options = {}) {
    const { quiet = false } = options;
    const scriptPath = path.join(context.extensionPath, SCRIPT_FILE);
    const fileUrl = `file:///${scriptPath.replace(/\\/g, '/')}`;

    const config = vscode.workspace.getConfiguration();
    const imports = config.get('vscode_custom_css.imports', []);

    if (!Array.isArray(imports)) {
        if (!quiet) {
            vscode.window.showWarningMessage('vscode_custom_css.imports is not an array. Please fix it manually.');
        }
        return;
    }

    // Remove stale RTL entries (old versions, wrong paths) before adding current one
    const cleanedImports = imports.filter(url =>
        typeof url !== 'string' || !url.includes('rtl-for-vs-code-agents') || url === fileUrl
    );

    if (!cleanedImports.includes(fileUrl)) {
        cleanedImports.push(fileUrl);
    }

    const changed = cleanedImports.length !== imports.length || !imports.includes(fileUrl);
    if (changed) {
        await config.update('vscode_custom_css.imports', cleanedImports, vscode.ConfigurationTarget.Global);
        if (!quiet) {
            vscode.window.showInformationMessage('Added RTL script to vscode_custom_css.imports. Run “Enable Custom CSS and JS” and restart VS Code.');
        }
    } else if (!quiet) {
        vscode.window.showInformationMessage('RTL script already configured in vscode_custom_css.imports.');
    }

    const customCssExt = vscode.extensions.getExtension('be5invis.vscode-custom-css');
    if (!customCssExt && !quiet) {
        const install = await vscode.window.showInformationMessage(
            'Custom CSS and JS Loader is required for Copilot RTL. Install now?',
            'Install'
        );
        if (install === 'Install') {
            await vscode.commands.executeCommand('workbench.extensions.installExtension', 'be5invis.vscode-custom-css');
        }
    }
}

function isCopilotInjectionActive() {
    try {
        const htmlPath = path.join(vscode.env.appRoot, 'out', 'vs', 'workbench', 'workbench.desktop.main.html');
        if (!fs.existsSync(htmlPath)) return null;
        const htmlContent = fs.readFileSync(htmlPath, 'utf8');

        const config = vscode.workspace.getConfiguration();
        const imports = config.get('vscode_custom_css.imports', []);
        if (!Array.isArray(imports) || imports.length === 0) return null;

        const rtlImports = imports.filter(url => typeof url === 'string' && url.includes('rtl-for-vs'));
        if (rtlImports.length === 0) return null;

        return rtlImports.some(url => htmlContent.includes(url));
    } catch (e) {
        return null;
    }
}

async function checkCopilotStatus() {
    const isActive = isCopilotInjectionActive();
    if (isActive === null || isActive === true) return;

    const reEnable = 'Enable Custom CSS';
    const choice = await vscode.window.showWarningMessage(
        'Copilot RTL: injection lost after VS Code update. Re-enable: "Enable Custom CSS and JS" + Reload Window.',
        reEnable,
        'Dismiss'
    );
    if (choice === reEnable) {
        await vscode.commands.executeCommand('workbench.action.showCommands');
        vscode.window.showInformationMessage('Search "Enable Custom CSS and JS", press Enter, then run "Reload Window".');
    }
}

// --- Version helper (local only; self-update over the network was removed) ---

function getLocalVersion(extensionPath) {
    const pkgPath = path.join(extensionPath, 'package.json');
    const pkg = JSON.parse(fs.readFileSync(pkgPath, 'utf8'));
    return pkg.version;
}

/**
 * Strip any RTL injection (current or legacy) from file content.
 * Returns the clean original content, or the input unchanged if no injection found.
 */
function stripInjection(content) {
    // Try current marker first, then legacy header
    let mi = content.indexOf('// ' + MARKER);
    if (mi <= 0) mi = content.indexOf('// RTL Support for Claude Code');
    if (mi <= 0) return content;
    return content.substring(0, mi).trimEnd();
}

function restoreAllBackups() {
    const installations = listExtensionInstallations();
    const antigravityApp = getAntigravityAppInstallation();
    const targets = antigravityApp ? [...installations, antigravityApp] : installations;
    let restored = 0;

    for (const target of targets) {
        const backupPath = `${target.indexPath}.backup`;
        if (fs.existsSync(backupPath) && fs.existsSync(target.indexPath)) {
            try {
                let content = fs.readFileSync(backupPath, 'utf8');
                // Clean backup in case it was created from an already-injected file
                content = stripInjection(content);
                fs.writeFileSync(target.indexPath, content, 'utf8');
                fs.unlinkSync(backupPath);
                restored++;
            } catch (e) {
                console.error(`RTL: failed to restore backup for ${target.indexPath}:`, e.message);
            }
        }
        // Also restore Plan RTL injection for Claude Code
        if (target.type === 'claude-extension') {
            try {
                if (stripPlanInjection(target.extensionDir)) restored++;
            } catch (e) {
                console.error(`RTL: failed to restore Plan RTL for ${target.extensionDir}:`, e.message);
            }
        }
    }
    return restored;
}

function reinjectAll(extensionPath) {
    const scriptContent = getScriptContent(extensionPath);
    const configBlock = buildConfigBlock();
    const installations = listExtensionInstallations();
    const antigravityApp = getAntigravityAppInstallation();
    const targets = antigravityApp ? [...installations, antigravityApp] : installations;
    let count = 0;

    for (const target of targets) {
        if (!fs.existsSync(target.indexPath)) continue;
        const content = fs.readFileSync(target.indexPath, 'utf8');
        if (!hasAnyInjection(content)) continue;

        // Strip old injection (current or legacy), re-append with new config
        const clean = stripInjection(content);
        if (clean === content) continue; // nothing was stripped
        const output = `${clean}\n\n// ${MARKER} v${CURRENT_VERSION} (injected)\n${configBlock}\n${scriptContent}\n`;
        fs.writeFileSync(target.indexPath, output, 'utf8');
        count++;

        // Also re-inject Plan RTL for Claude Code
        if (target.type === 'claude-extension') {
            try {
                stripPlanInjection(target.extensionDir);
                injectPlanRTL(target.extensionDir);
            } catch (e) {
                console.error('RTL: failed to re-inject Plan RTL:', e.message);
            }
        }
    }
    return count;
}

async function removeAllInjections(context) {
    const yes = 'Remove All';
    const no = 'Cancel';
    const choice = await vscode.window.showWarningMessage(
        'This will remove all RTL injections and restore original files. Continue?',
        { modal: true }, yes, no
    );
    if (choice !== yes) return;

    const restored = restoreAllBackups();
    await context.globalState.update('rtlForVsCodeAgents.injectedPaths', []);

    if (restored > 0) {
        const restart = 'Restart Extension Host';
        const reload = 'Reload Window';
        const message = `RTL: restored ${restored} file(s) to original. Restart Extension Host to apply.`;
        vscode.window.showInformationMessage(message, restart, reload).then(choice => {
            if (choice === restart) {
                vscode.commands.executeCommand('workbench.action.restartExtensionHost');
            } else if (choice === reload) {
                vscode.commands.executeCommand('workbench.action.reloadWindow');
            }
        });
    } else {
        vscode.window.showInformationMessage('RTL: no injections found to remove.');
    }
}

function updateStatusBar(localVersion) {
    if (!statusBarItem) return;
    statusBarItem.text = `RTL v${localVersion}`;
    statusBarItem.tooltip = 'RTL & Agent Tools: click for actions';
    statusBarItem.backgroundColor = undefined;
}

async function handleVersionUpgrade(context) {
    const localVersion = getLocalVersion(context.extensionPath);
    const storedVersion = context.globalState.get('rtlForVsCodeAgents.installedVersion');

    if (storedVersion && storedVersion !== localVersion) {
        console.log(`RTL: version changed ${storedVersion} → ${localVersion}, re-injecting...`);
        restoreAllBackups();
        // Re-inject with the new script even if no backup existed
        // (reinjectAll strips old injection by MARKER and re-appends current script)
        reinjectAll(context.extensionPath);
    }

    await context.globalState.update('rtlForVsCodeAgents.installedVersion', localVersion);
}

function scheduleAutoCheck(context) {
    const config = getConfig();
    if (!config.get('autoInject', true)) {
        return;
    }

    const hours = Number(config.get('checkIntervalHours', 0)) || 0;
    if (hours <= 0) {
        return;
    }

    const intervalMs = hours * 60 * 60 * 1000;
    const handle = setInterval(() => {
        checkAndInject(context, { quiet: false, interactive: true, notifyNoChanges: false });
    }, intervalMs);

    context.subscriptions.push({ dispose: () => clearInterval(handle) });
}

function maybeAutoConfigureCustomCss(context) {
    const config = getConfig();
    if (config.get('autoConfigureCustomCss', false)) {
        configureCustomCss(context, { quiet: true });
    }
}


function createStatusBarItem(context) {
    statusBarItem = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Right, 100);
    statusBarItem.command = 'rtlForVsCodeAgents.showMenu';
    const localVersion = getLocalVersion(context.extensionPath);
    updateStatusBar(localVersion);
    statusBarItem.show();
    context.subscriptions.push(statusBarItem);
}

async function activate(context) {
    console.log('RTL & Agent Tools: Activating...');

    // Handle version upgrade (restore old injections before re-injecting)
    await handleVersionUpgrade(context);

    // Create status bar item
    createStatusBarItem(context);

    // Register commands
    context.subscriptions.push(
        vscode.commands.registerCommand('rtlForVsCodeAgents.checkAndInject', () => checkAndInject(context, { quiet: false, interactive: true, notifyNoChanges: true })),
        vscode.commands.registerCommand('rtlForVsCodeAgents.configureCustomCss', () => configureCustomCss(context)),
        vscode.commands.registerCommand('rtlForVsCodeAgents.removeInjections', () => removeAllInjections(context)),
        vscode.commands.registerCommand('rtlForVsCodeAgents.showMenu', async () => {
            const items = [
                { label: '$(syringe) Check and Inject RTL', command: 'rtlForVsCodeAgents.checkAndInject' },
                { label: '$(settings-gear) Configure Custom CSS Loader', command: 'rtlForVsCodeAgents.configureCustomCss' },
                { label: '$(trash) Remove All Injections', command: 'rtlForVsCodeAgents.removeInjections' }
            ];
            const picked = await vscode.window.showQuickPick(items, { placeHolder: 'RTL & Agent Tools' });
            if (picked) {
                await vscode.commands.executeCommand(picked.command);
            }
        })
    );

    // Re-inject when settings change, then offer Reload
    context.subscriptions.push(
        vscode.workspace.onDidChangeConfiguration(e => {
            if (e.affectsConfiguration('rtlForVsCodeAgents.yoloCountdownSeconds') ||
                e.affectsConfiguration('rtlForVsCodeAgents.userMessageBorder')) {
                const updated = reinjectAll(context.extensionPath);
                if (updated > 0) {
                    vscode.window.showInformationMessage(
                        'RTL settings updated. Restart Extension Host to apply.',
                        'Restart Extension Host',
                        'Reload Window'
                    ).then(choice => {
                        if (choice === 'Restart Extension Host') {
                            vscode.commands.executeCommand('workbench.action.restartExtensionHost');
                        } else if (choice === 'Reload Window') {
                            vscode.commands.executeCommand('workbench.action.reloadWindow');
                        }
                    });
                }
            }
        })
    );

    // Auto-inject RTL into agent webviews
    checkAndInject(context, { quiet: false, interactive: true, notifyNoChanges: false });
    checkCopilotStatus();
    scheduleAutoCheck(context);
    maybeAutoConfigureCustomCss(context);

    console.log('RTL & Agent Tools: Activated successfully!');
}

function deactivate() {}

module.exports = {
    activate,
    deactivate
};
