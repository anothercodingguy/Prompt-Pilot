document.addEventListener('DOMContentLoaded', () => {
    // --- Chrome API Fallback Shim for Standalone Testing ---
    if (!window.chrome || !chrome.storage || !chrome.storage.local) {
        window.chrome = window.chrome || {};
        window.chrome.storage = {
            local: {
                get: (keys, cb) => {
                    const res = {};
                    const list = Array.isArray(keys) ? keys : (typeof keys === 'string' ? [keys] : Object.keys(keys || {}));
                    list.forEach(k => {
                        const item = localStorage.getItem(k);
                        if (item !== null) {
                            try { res[k] = JSON.parse(item); } catch (e) { res[k] = item; }
                        }
                    });
                    if (cb) cb(res);
                    return Promise.resolve(res);
                },
                set: (obj, cb) => {
                    Object.entries(obj).forEach(([k, v]) => {
                        localStorage.setItem(k, typeof v === 'string' ? v : JSON.stringify(v));
                    });
                    if (cb) cb();
                    return Promise.resolve();
                },
                remove: (keys, cb) => {
                    const list = Array.isArray(keys) ? keys : [keys];
                    list.forEach(k => localStorage.removeItem(k));
                    if (cb) cb();
                    return Promise.resolve();
                }
            }
        };
        if (!chrome.tabs) {
            chrome.tabs = {
                query: () => Promise.resolve([{ id: 1, url: 'https://example.com' }])
            };
        }
        if (!chrome.scripting) {
            chrome.scripting = {
                executeScript: () => Promise.resolve([{ result: { success: true, message: 'Preview mode simulated' } }])
            };
        }
    }

    // --- Configuration & Constants ---
    const DEFAULT_BACKEND_URL = 'http://localhost:3000';
    const DEFAULT_MODEL = 'openai/gpt-oss-120b';

    const GROQ_MODELS = [
        { id: 'openai/gpt-oss-120b', name: 'GPT OSS 120B (Recommended)', label: 'GPT OSS 120B' },
        { id: 'openai/gpt-oss-20b', name: 'GPT OSS 20B (Ultra-Fast)', label: 'GPT OSS 20B' },
        { id: 'groq/compound', name: 'Groq Compound (Multi-Engine)', label: 'Compound' },
        { id: 'qwen/qwen3.8-27b', name: 'Qwen 3.8 27B (Balanced)', label: 'Qwen 3.8 27B' }
    ];

    const BACKEND_URL_KEY = 'backend_url';
    const MODEL_KEY = 'groq_model';
    const THEME_KEY = 'app_theme';
    const HISTORY_KEY = 'prompt_history';
    const USER_TONE_KEY = 'user_tone';

    // --- Templates ---
    const TEMPLATES = {
        'fix-code': "Here is my code:\n```\n[PASTE CODE HERE]\n```\n\nIt gives this error:\n[PASTE ERROR HERE]\n\nPlease debug the issue, explain why it happened, and provide the corrected code.",
        'email': "Write a polished, professional email to [RECIPIENT] regarding [TOPIC]. Keep the tone polite, clear, and actionable with a clear next step.",
        'summarize': "Summarize the following text into 3-5 concise bullet points, highlighting key takeaways and action items:\n\n[PASTE TEXT HERE]"
    };

    // --- DOM Elements ---
    const tabs = document.querySelectorAll('.nav-tab');
    const views = document.querySelectorAll('.view');

    // Settings
    const settingsBtn = document.getElementById('settings-btn');
    const settingsWrapper = document.getElementById('settings-wrapper');
    const closeSettingsBtn = document.getElementById('close-settings');
    const backendStatusText = document.getElementById('backend-status-text');
    const backendUrlInput = document.getElementById('backend-url-input');
    const modelSelect = document.getElementById('model-select');
    const customModelInput = document.getElementById('custom-model-input');
    const themeSelect = document.getElementById('theme-select');
    const saveKeyBtn = document.getElementById('save-key');
    const keyStatus = document.getElementById('key-status');

    // Main Inputs
    const promptInput = document.getElementById('prompt-input');
    const charCount = document.getElementById('char-count');
    const toneSelect = document.getElementById('tone-select');
    const templateChips = document.querySelectorAll('.chip');
    const generateBtn = document.getElementById('generate-btn');
    const btnIcon = generateBtn.querySelector('.btn-icon');
    const spinner = generateBtn.querySelector('.spinner');
    const stopBtn = document.getElementById('stop-btn');

    // Output
    const promptOutput = document.getElementById('prompt-output');
    const outputBadge = document.getElementById('output-badge');
    const outputCounter = document.getElementById('output-counter');
    const speedIndicator = document.getElementById('speed-indicator');
    const clearOutputBtn = document.getElementById('clear-output-btn');
    const copyBtn = document.getElementById('copy-btn');
    const copyLabel = copyBtn.querySelector('.copy-label');
    const insertBtn = document.getElementById('insert-btn');
    const toast = document.getElementById('error-toast');

    // History
    const historyList = document.getElementById('history-list');
    const clearHistoryBtn = document.getElementById('clear-history');
    const historySearch = document.getElementById('history-search');

    // --- State ---
    let currentAbortController = null;
    let isGenerating = false;
    let promptHistory = [];
    let rawGeneratedText = '';

    // --- Initialization ---
    init();

    function init() {
        chrome.storage.local.get([
            BACKEND_URL_KEY,
            MODEL_KEY,
            THEME_KEY,
            USER_TONE_KEY,
            HISTORY_KEY
        ], (result) => {
            const savedBackendUrl = result[BACKEND_URL_KEY] || DEFAULT_BACKEND_URL;
            if (backendUrlInput) {
                backendUrlInput.value = savedBackendUrl;
            }

            const savedModel = result[MODEL_KEY] || DEFAULT_MODEL;
            populateModels(savedModel);

            const savedTheme = result[THEME_KEY] || 'default';
            if (themeSelect) {
                themeSelect.value = savedTheme;
            }
            applyTheme(savedTheme);

            if (toneSelect && result[USER_TONE_KEY]) {
                toneSelect.value = result[USER_TONE_KEY];
            }

            promptHistory = result[HISTORY_KEY] || [];
            renderHistory();

            checkBackendStatus(savedBackendUrl);
        });

        updateDraftCounters();
    }

    // --- Backend Health Check ---
    async function checkBackendStatus(url) {
        const targetUrl = url || DEFAULT_BACKEND_URL;
        try {
            const controller = new AbortController();
            const timeoutId = setTimeout(() => controller.abort(), 1200);
            const res = await fetch(`${targetUrl.replace(/\/+$/, '')}/api/health`, { signal: controller.signal });
            clearTimeout(timeoutId);
            if (res.ok) {
                if (backendStatusText) backendStatusText.textContent = 'Backend Active • Groq LPU';
                const dot = document.querySelector('.status-dot');
                if (dot) {
                    dot.classList.remove('offline');
                    dot.classList.add('online');
                }
                return true;
            }
        } catch (_) {
            // Local server offline
        }
        if (backendStatusText) backendStatusText.textContent = 'Groq Cloud LPU (Direct Key)';
        const dot = document.querySelector('.status-dot');
        if (dot) {
            dot.classList.add('offline');
            dot.classList.remove('online');
        }
        return false;
    }

    // --- Populate Model Options ---
    function populateModels(selectedModelId) {
        if (!modelSelect) return;
        modelSelect.innerHTML = '';
        GROQ_MODELS.forEach(m => {
            const opt = document.createElement('option');
            opt.value = m.id;
            opt.textContent = m.name;
            modelSelect.appendChild(opt);
        });

        const customOpt = document.createElement('option');
        customOpt.value = 'custom';
        customOpt.textContent = 'Custom Model...';
        modelSelect.appendChild(customOpt);

        const currentModel = selectedModelId || DEFAULT_MODEL;
        const exists = GROQ_MODELS.some(m => m.id === currentModel);
        if (exists) {
            modelSelect.value = currentModel;
            if (customModelInput) customModelInput.classList.add('hidden');
        } else {
            modelSelect.value = 'custom';
            if (customModelInput) {
                customModelInput.value = currentModel;
                customModelInput.classList.remove('hidden');
            }
        }
    }

    // --- Event Listeners ---

    // Tabs
    tabs.forEach(tab => {
        tab.addEventListener('click', () => switchTab(tab.dataset.tab));
    });

    // Model Selector Change
    if (modelSelect) {
        modelSelect.addEventListener('change', () => {
            if (modelSelect.value === 'custom') {
                customModelInput.classList.remove('hidden');
                customModelInput.focus();
            } else {
                customModelInput.classList.add('hidden');
            }
        });
    }

    // Theme Selector Change
    if (themeSelect) {
        themeSelect.addEventListener('change', () => {
            applyTheme(themeSelect.value);
        });
    }

    // Tone Selector Change
    if (toneSelect) {
        toneSelect.addEventListener('change', () => {
            chrome.storage.local.set({ [USER_TONE_KEY]: toneSelect.value });
        });
    }

    // Quick Templates
    templateChips.forEach(chip => {
        chip.addEventListener('click', () => {
            const key = chip.dataset.template;
            const templateText = TEMPLATES[key];
            if (!templateText) return;

            const currentVal = promptInput.value.trim();
            if (currentVal) {
                promptInput.value = currentVal + "\n\n" + templateText;
                showToast('Template appended to draft.', 'success');
            } else {
                promptInput.value = templateText;
                showToast('Template inserted.', 'success');
            }
            promptInput.focus();
            updateDraftCounters();
        });
    });

    // Draft Input Counter & Shortcuts
    promptInput.addEventListener('input', updateDraftCounters);
    promptInput.addEventListener('keydown', (e) => {
        if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') {
            e.preventDefault();
            if (!isGenerating) {
                handleGenerate();
            }
        }
    });

    // Settings Drawer Toggle & Save
    settingsBtn.addEventListener('click', () => toggleSettings());
    closeSettingsBtn.addEventListener('click', () => toggleSettings(false));
    if (saveKeyBtn) saveKeyBtn.addEventListener('click', saveSettings);

    [customModelInput, backendUrlInput].forEach(input => {
        if (input) {
            input.addEventListener('keydown', (e) => {
                if (e.key === 'Enter') {
                    e.preventDefault();
                    saveSettings();
                } else if (e.key === 'Escape') {
                    toggleSettings(false);
                }
            });
        }
    });

    // Generation Controls
    generateBtn.addEventListener('click', handleGenerate);
    stopBtn.addEventListener('click', stopGeneration);

    // Output Box Inline Editing
    promptOutput.addEventListener('input', () => {
        if (!promptOutput.classList.contains('empty')) {
            rawGeneratedText = promptOutput.innerText || '';
            updateOutputCounters(rawGeneratedText);
        }
    });

    // Copy Output
    copyBtn.addEventListener('click', () => {
        const text = getCleanOutputText();
        if (!text || promptOutput.classList.contains('empty')) return;

        copyTextToClipboard(text).then(() => {
            if (copyLabel) copyLabel.textContent = 'Copied!';
            showToast('Copied prompt to clipboard!', 'success');
            setTimeout(() => {
                if (copyLabel) copyLabel.textContent = 'Copy';
            }, 1800);
        }).catch(() => {
            showToast('Failed to copy to clipboard.', 'error');
        });
    });

    // Insert Output into Active Webpage
    insertBtn.addEventListener('click', insertIntoActivePage);

    // Clear Output
    clearOutputBtn.addEventListener('click', clearOutput);

    // History Search & Clear
    if (historySearch) {
        historySearch.addEventListener('input', (e) => {
            renderHistory(e.target.value.trim().toLowerCase());
        });
    }

    if (clearHistoryBtn) {
        clearHistoryBtn.addEventListener('click', () => {
            if (promptHistory.length === 0) return;
            chrome.storage.local.remove([HISTORY_KEY], () => {
                promptHistory = [];
                renderHistory();
                showToast('History cleared.');
            });
        });
    }

    // Global Key Listener
    document.addEventListener('keydown', (e) => {
        if (e.key === 'Escape' && settingsWrapper.classList.contains('open')) {
            toggleSettings(false);
        }
    });

    // --- UI Helper Functions ---

    function switchTab(tabName) {
        tabs.forEach(t => t.classList.toggle('active', t.dataset.tab === tabName));
        views.forEach(v => v.classList.toggle('active', v.id === `${tabName}-view`));
        if (tabName === 'history' && historySearch) {
            historySearch.value = '';
            renderHistory();
            setTimeout(() => historySearch.focus(), 50);
        }
    }

    function toggleSettings(forceState) {
        const willOpen = typeof forceState === 'boolean' ? forceState : !settingsWrapper.classList.contains('open');
        settingsWrapper.classList.toggle('open', willOpen);
    }

    function saveSettings() {
        let selectedModel = modelSelect.value;
        if (selectedModel === 'custom') {
            selectedModel = customModelInput ? customModelInput.value.trim() : '';
            if (!selectedModel) {
                showStatus('Enter a custom model name.', 'error');
                return;
            }
        }

        const backendUrl = backendUrlInput ? backendUrlInput.value.trim() : DEFAULT_BACKEND_URL;
        const selectedTheme = themeSelect ? themeSelect.value : 'default';

        chrome.storage.local.set({
            [MODEL_KEY]: selectedModel,
            [BACKEND_URL_KEY]: backendUrl,
            [THEME_KEY]: selectedTheme
        }, () => {
            applyTheme(selectedTheme);
            checkBackendStatus(backendUrl);
            showStatus('Preferences saved!', 'success');
            setTimeout(() => {
                toggleSettings(false);
                keyStatus.textContent = '';
            }, 800);
        });
    }

    function applyTheme(theme) {
        if (!theme || theme === 'default') {
            document.body.removeAttribute('data-theme');
        } else {
            document.body.setAttribute('data-theme', theme);
        }
    }

    function showStatus(msg, type) {
        keyStatus.textContent = msg;
        keyStatus.style.color = type === 'success' ? 'var(--success)' : 'var(--error)';
    }

    function showToast(msg, type) {
        toast.textContent = msg;
        toast.style.borderColor = type === 'error' ? 'rgba(239, 68, 68, 0.4)' : 'var(--border-default)';
        toast.classList.add('show');
        setTimeout(() => toast.classList.remove('show'), 2800);
    }

    function updateDraftCounters() {
        const val = promptInput.value;
        const charLen = val.length;
        const wordCount = val.trim() ? val.trim().split(/\s+/).length : 0;
        charCount.textContent = `${charLen} chars • ${wordCount} words`;
    }

    function updateOutputCounters(text) {
        if (!text) {
            outputCounter.textContent = '';
            return;
        }
        const charLen = text.length;
        const wordCount = text.trim().split(/\s+/).length;
        outputCounter.textContent = `${charLen} chars • ${wordCount} words`;
    }

    function getCleanOutputText() {
        return rawGeneratedText || promptOutput.innerText || '';
    }

    function copyTextToClipboard(text) {
        if (navigator.clipboard && typeof navigator.clipboard.writeText === 'function') {
            return navigator.clipboard.writeText(text).catch(() => fallbackCopy(text));
        }
        return fallbackCopy(text);
    }

    function fallbackCopy(text) {
        try {
            const tempTextArea = document.createElement('textarea');
            tempTextArea.value = text;
            tempTextArea.style.position = 'fixed';
            tempTextArea.style.opacity = '0';
            tempTextArea.style.pointerEvents = 'none';
            document.body.appendChild(tempTextArea);
            tempTextArea.focus();
            tempTextArea.select();
            const success = document.execCommand('copy');
            document.body.removeChild(tempTextArea);
            if (!success) throw new Error('execCommand copy returned false');
            return Promise.resolve();
        } catch (e) {
            return Promise.reject(e);
        }
    }

    function clearOutput() {
        rawGeneratedText = '';
        promptOutput.innerHTML = `
            <div class="empty-state">
                <div class="empty-title">Ready to refine your prompt</div>
                <div class="empty-subtitle">Pick a suggestion above or enter your rough thoughts in the prompt box to generate a structured CO-STAR prompt.</div>
            </div>
        `;
        promptOutput.classList.add('empty');
        promptOutput.contentEditable = 'false';
        outputBadge.classList.add('hidden');
        clearOutputBtn.classList.add('hidden');
        copyBtn.disabled = true;
        insertBtn.disabled = true;
        outputCounter.textContent = '';
        speedIndicator.classList.add('hidden');
    }

    function stopGeneration() {
        if (currentAbortController) {
            currentAbortController.abort();
            currentAbortController = null;
            showToast('Generation stopped.');
        }
    }

    // --- Generation with SSE Streaming & Markdown ---

    async function handleGenerate() {
        const prompt = promptInput.value.trim();
        const tone = toneSelect ? toneSelect.value : 'Standard';

        if (!prompt) {
            showToast('Please enter a draft prompt.', 'error');
            promptInput.focus();
            return;
        }

        chrome.storage.local.get([
            BACKEND_URL_KEY,
            MODEL_KEY
        ], async (result) => {
            const backendUrl = result[BACKEND_URL_KEY] || DEFAULT_BACKEND_URL;
            const model = result[MODEL_KEY] || DEFAULT_MODEL;

            setLoading(true);
            currentAbortController = new AbortController();

            // Prepare promptOutput container
            rawGeneratedText = '';
            promptOutput.classList.remove('empty');
            promptOutput.classList.add('streaming-cursor');
            promptOutput.contentEditable = 'false';
            promptOutput.textContent = '';
            outputBadge.classList.add('hidden');
            speedIndicator.classList.remove('hidden');
            speedIndicator.textContent = 'Connecting to Groq...';

            const SYSTEM_PROMPT = `You are an expert Prompt Engineer. Rewrite the user's input to be ${tone} in style. Use the CO-STAR framework (Context, Objective, Style, Tone, Audience, Response) to structure the output. Do NOT explain the framework, just output the refined prompt.`;

            const startTime = performance.now();
            let tokenCount = 0;

            try {
                speedIndicator.textContent = 'Connecting to backend...';
                const generateEndpoint = `${backendUrl.replace(/\/+$/, '')}/api/generate`;
                let response;

                try {
                    response = await fetch(generateEndpoint, {
                        method: 'POST',
                        signal: currentAbortController.signal,
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify({ prompt, tone, model })
                    });
                } catch (fetchErr) {
                    if (currentAbortController.signal.aborted) throw fetchErr;
                    throw new Error(`Cannot connect to PromptPilot backend at ${backendUrl}. Please start the server with: npm start (or node server.js)`);
                }

                if (!response.ok) {
                    const errPayload = await response.json().catch(() => null);
                    const errMsg = errPayload?.error || `Backend Error: ${response.status} ${response.statusText}`;
                    throw new Error(errMsg);
                }

                const reader = response.body.getReader();
                const decoder = new TextDecoder('utf-8');
                let buffer = '';

                while (true) {
                    const { done, value } = await reader.read();
                    if (done) break;

                    buffer += decoder.decode(value, { stream: true });
                    const lines = buffer.split('\n');
                    buffer = lines.pop(); // keep last incomplete line

                    for (const line of lines) {
                        const trimmed = line.trim();
                        if (!trimmed || !trimmed.startsWith('data:')) continue;
                        const dataStr = trimmed.slice(5).trim();
                        if (dataStr === '[DONE]') continue;

                        try {
                            const parsed = JSON.parse(dataStr);
                            const delta = parsed.choices?.[0]?.delta;
                            const textDelta = delta?.content || '';
                            const reasoningDelta = delta?.reasoning || '';

                            if (textDelta) {
                                rawGeneratedText += textDelta;
                                tokenCount++;
                                promptOutput.textContent = rawGeneratedText;
                                promptOutput.scrollTop = promptOutput.scrollHeight;

                                // Update speed & counters
                                const elapsedSec = Math.max((performance.now() - startTime) / 1000, 0.05);
                                const tokPerSec = Math.round(tokenCount / elapsedSec);
                                speedIndicator.textContent = `${tokPerSec} tok/s`;
                                updateOutputCounters(rawGeneratedText);
                            } else if (reasoningDelta && !rawGeneratedText) {
                                speedIndicator.textContent = 'Reasoning...';
                            }
                        } catch (_) {
                            // Ignore incomplete json fragments
                        }
                    }
                }

                if (!rawGeneratedText) {
                    promptOutput.textContent = 'No output generated. Please check your prompt.';
                    clearOutputBtn.classList.remove('hidden');
                } else {
                    // Render formatted markdown on completion
                    promptOutput.innerHTML = renderMarkdown(rawGeneratedText);
                    promptOutput.contentEditable = 'true';
                    outputBadge.classList.remove('hidden');
                    clearOutputBtn.classList.remove('hidden');
                    copyBtn.disabled = false;
                    insertBtn.disabled = false;

                    const totalTime = ((performance.now() - startTime) / 1000).toFixed(1);
                    speedIndicator.textContent = `Groq LPU • ${totalTime}s`;

                    // Persist History
                    saveHistory({
                        id: Date.now(),
                        input: prompt,
                        output: rawGeneratedText,
                        tone: tone,
                        provider: 'Groq',
                        model: model,
                        timestamp: Date.now()
                    });
                }

            } catch (error) {
                if (error.name === 'AbortError') {
                    if (rawGeneratedText) {
                        promptOutput.innerHTML = renderMarkdown(rawGeneratedText);
                        promptOutput.contentEditable = 'true';
                        outputBadge.classList.remove('hidden');
                        clearOutputBtn.classList.remove('hidden');
                        copyBtn.disabled = false;
                        insertBtn.disabled = false;
                        speedIndicator.textContent = 'Stopped';
                    } else {
                        clearOutput();
                    }
                } else {
                    console.error("PromptPilot Error:", error);
                    promptOutput.classList.remove('empty');
                    promptOutput.textContent = `Error: ${error.message}`;
                    clearOutputBtn.classList.remove('hidden');
                    showToast(error.message, 'error');
                    speedIndicator.textContent = 'Error';
                }
            } finally {
                promptOutput.classList.remove('streaming-cursor');
                setLoading(false);
                currentAbortController = null;
            }
        });
    }

    function setLoading(isLoading) {
        isGenerating = isLoading;
        generateBtn.disabled = isLoading;
        if (isLoading) {
            if (btnIcon) btnIcon.classList.add('hidden');
            if (spinner) spinner.classList.remove('hidden');
            generateBtn.classList.add('hidden');
            stopBtn.classList.remove('hidden');
            copyBtn.disabled = true;
            insertBtn.disabled = true;
            clearOutputBtn.classList.add('hidden');
        } else {
            if (btnIcon) btnIcon.classList.remove('hidden');
            if (spinner) spinner.classList.add('hidden');
            generateBtn.classList.remove('hidden');
            stopBtn.classList.add('hidden');
        }
    }

    // Markdown Parser
    function renderMarkdown(text) {
        if (!text) return '';
        let escaped = text
            .replace(/&/g, '&amp;')
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;');

        const tokens = [];

        // 1. Fenced code blocks placeholder
        escaped = escaped.replace(/```([a-z0-9_-]*)\n([\s\S]*?)```/gi, (match, lang, code) => {
            const id = `@@@CODEBLOCK_${tokens.length}@@@`;
            tokens.push(`<pre><code>${code.trim()}</code></pre>`);
            return id;
        });

        // 2. Inline code placeholder
        escaped = escaped.replace(/`([^`\n]+)`/g, (match, code) => {
            const id = `@@@INLINECODE_${tokens.length}@@@`;
            tokens.push(`<code>${code}</code>`);
            return id;
        });

        // 3. Horizontal dividers
        escaped = escaped.replace(/^---$/gm, '<hr>');

        // 4. Headers
        escaped = escaped.replace(/^### (.*$)/gim, '<h3>$1</h3>');
        escaped = escaped.replace(/^## (.*$)/gim, '<h2>$1</h2>');
        escaped = escaped.replace(/^# (.*$)/gim, '<h1>$1</h1>');

        // 5. Blockquotes
        escaped = escaped.replace(/^(&gt;|>)\s?(.*$)/gim, '<blockquote>$2</blockquote>');

        // 6. Numbered lists
        escaped = escaped.replace(/(?:^[ \t]*\d+\.[ \t]+.*$\n?)+/gm, (match) => {
            const items = match.trim().split('\n').map(l => {
                const content = l.replace(/^[ \t]*\d+\.[ \t]+/, '');
                return `<li>${content}</li>`;
            }).join('\n');
            return `<ol>\n${items}\n</ol>\n`;
        });

        // 7. Bullet lists
        escaped = escaped.replace(/(?:^[ \t]*[-*][ \t]+.*$\n?)+/gm, (match) => {
            const items = match.trim().split('\n').map(l => {
                const content = l.replace(/^[ \t]*[-*][ \t]+/, '');
                return `<li>${content}</li>`;
            }).join('\n');
            return `<ul>\n${items}\n</ul>\n`;
        });

        // 8. Bold & Italics
        escaped = escaped.replace(/\*\*([^\*\n]+)\*\*/g, '<strong>$1</strong>');
        escaped = escaped.replace(/\*([^\*\n]+)\*/g, '<em>$1</em>');

        // 9. Paragraphs
        const lines = escaped.split('\n');
        let rendered = lines.map(line => {
            const trimmed = line.trim();
            if (
                trimmed.startsWith('@@@CODEBLOCK_') ||
                trimmed.startsWith('<h') ||
                trimmed.startsWith('<ul') ||
                trimmed.startsWith('</ul') ||
                trimmed.startsWith('<ol') ||
                trimmed.startsWith('</ol') ||
                trimmed.startsWith('<li>') ||
                trimmed.startsWith('</li>') ||
                trimmed.startsWith('<blockquote') ||
                trimmed.startsWith('<hr') ||
                trimmed === ''
            ) {
                return line;
            }
            return `<p>${line}</p>`;
        }).join('\n');

        // 10. Restore protected code tokens
        tokens.forEach((content, i) => {
            rendered = rendered.replace(new RegExp(`@@@CODEBLOCK_${i}@@@`, 'g'), content);
            rendered = rendered.replace(new RegExp(`@@@INLINECODE_${i}@@@`, 'g'), content);
        });

        return rendered;
    }

    // --- Page Text Injection ---

    async function insertIntoActivePage() {
        const text = getCleanOutputText();
        if (!text || promptOutput.classList.contains('empty')) return;

        try {
            const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
            if (!tab || !tab.id) {
                showToast('No active browser tab found.', 'error');
                return;
            }

            if (tab.url && (
                tab.url.startsWith('chrome://') ||
                tab.url.startsWith('chrome-extension://') ||
                tab.url.startsWith('edge://') ||
                tab.url.startsWith('about:') ||
                tab.url.startsWith('view-source:') ||
                tab.url.includes('chromewebstore.google.com') ||
                tab.url.includes('chrome.google.com/webstore')
            )) {
                showToast('Cannot insert text into browser system or Web Store pages.', 'error');
                return;
            }

            const results = await chrome.scripting.executeScript({
                target: { tabId: tab.id },
                func: injectTextDirectly,
                args: [text]
            });

            const result = results?.[0]?.result;
            if (result && result.success) {
                showToast('Inserted prompt into page!', 'success');
            } else {
                showToast(result?.message || 'Click inside a text box on the page first.', 'error');
            }
        } catch (err) {
            console.error('Page insertion error:', err);
            showToast('Could not insert: ' + err.message, 'error');
        }
    }

    function injectTextDirectly(text) {
        function getDeepActiveElement(doc) {
            let el = doc.activeElement;
            while (el && el.shadowRoot && el.shadowRoot.activeElement) {
                el = el.shadowRoot.activeElement;
            }
            return el;
        }

        let activeElement = getDeepActiveElement(document);

        function isElementEditable(el) {
            if (!el) return false;
            const isInput = (el.tagName === 'INPUT' && !['button', 'submit', 'checkbox', 'radio', 'file', 'image'].includes(el.type)) || el.tagName === 'TEXTAREA';
            const isEditable = el.isContentEditable || el.getAttribute('contenteditable') === 'true';
            return isInput || isEditable;
        }

        // If active element is body or not editable (e.g. extension stole focus), search for candidate input
        if (!isElementEditable(activeElement)) {
            const candidate = document.querySelector('textarea, [contenteditable="true"], div[role="textbox"], input[type="text"]:not([readonly]), input:not([type]):not([readonly])');
            if (candidate) {
                activeElement = candidate;
                activeElement.focus();
            }
        }

        if (!isElementEditable(activeElement)) {
            return { success: false, message: 'Please click inside a text input field on the page first.' };
        }

        const isInput = activeElement.tagName === 'INPUT' || activeElement.tagName === 'TEXTAREA';
        const isEditable = activeElement.isContentEditable || activeElement.getAttribute('contenteditable') === 'true';

        try {
            activeElement.focus();
            const commandSucceeded = document.execCommand('insertText', false, text);
            if (commandSucceeded) {
                return { success: true };
            }
        } catch (_) {}

        if (isInput) {
            const start = activeElement.selectionStart || 0;
            const end = activeElement.selectionEnd || 0;
            const originalVal = activeElement.value || '';
            activeElement.value = originalVal.slice(0, start) + text + originalVal.slice(end);
            activeElement.selectionStart = activeElement.selectionEnd = start + text.length;
            activeElement.dispatchEvent(new Event('input', { bubbles: true }));
            activeElement.dispatchEvent(new Event('change', { bubbles: true }));
            return { success: true };
        }

        if (isEditable) {
            const selection = window.getSelection();
            if (selection && selection.rangeCount > 0) {
                const range = selection.getRangeAt(0);
                range.deleteContents();
                const textNode = document.createTextNode(text);
                range.insertNode(textNode);
                range.collapse(false);
                activeElement.dispatchEvent(new Event('input', { bubbles: true }));
                return { success: true };
            } else {
                activeElement.innerText += text;
                activeElement.dispatchEvent(new Event('input', { bubbles: true }));
                return { success: true };
            }
        }

        return { success: false, message: 'Could not insert into this field.' };
    }

    // --- History Management ---

    function saveHistory(item) {
        promptHistory.unshift(item);
        if (promptHistory.length > 30) promptHistory.pop();
        chrome.storage.local.set({ [HISTORY_KEY]: promptHistory }, () => {
            renderHistory();
        });
    }

    function renderHistory(query = '') {
        if (!historyList) return;
        historyList.innerHTML = '';

        const filtered = promptHistory.filter(item => {
            if (!query) return true;
            return (
                (item.input && item.input.toLowerCase().includes(query)) ||
                (item.output && item.output.toLowerCase().includes(query)) ||
                (item.tone && item.tone.toLowerCase().includes(query)) ||
                (item.model && item.model.toLowerCase().includes(query))
            );
        });

        if (filtered.length === 0) {
            historyList.innerHTML = `<div class="empty-history">${query ? 'No matching prompts found.' : 'No history yet.'}</div>`;
            return;
        }

        filtered.forEach(item => {
            const card = document.createElement('div');
            card.className = 'history-card';

            const timeStr = formatRelativeTime(item.timestamp);
            const modelBadge = item.model ? ` (${item.model.replace('openai/', '').replace('groq/', '')})` : '';

            card.innerHTML = `
                <div class="history-card-header">
                    <h4>Groq: ${item.tone}${modelBadge} • ${timeStr}</h4>
                    <div class="history-actions">
                        <button class="history-action-btn copy-card-btn" title="Copy output" aria-label="Copy output">
                            <svg xmlns="http://www.w3.org/2000/svg" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                                <rect x="9" y="9" width="13" height="13" rx="2" ry="2"></rect>
                                <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"></path>
                            </svg>
                        </button>
                        <button class="history-action-btn delete delete-card-btn" title="Delete from history" aria-label="Delete item">
                            <svg xmlns="http://www.w3.org/2000/svg" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                                <line x1="18" y1="6" x2="6" y2="18"></line>
                                <line x1="6" y1="6" x2="18" y2="18"></line>
                            </svg>
                        </button>
                    </div>
                </div>
                <p>${escapeHtml(item.output)}</p>
            `;

            card.addEventListener('click', (e) => {
                if (e.target.closest('.history-actions')) return;
                restoreHistory(item);
            });

            const cardCopyBtn = card.querySelector('.copy-card-btn');
            cardCopyBtn.addEventListener('click', (e) => {
                e.stopPropagation();
                copyTextToClipboard(item.output).then(() => {
                    showToast('History prompt copied!', 'success');
                }).catch(() => {
                    showToast('Failed to copy history item.', 'error');
                });
            });

            const cardDeleteBtn = card.querySelector('.delete-card-btn');
            cardDeleteBtn.addEventListener('click', (e) => {
                e.stopPropagation();
                deleteHistoryItem(item.id);
            });

            historyList.appendChild(card);
        });
    }

    function deleteHistoryItem(id) {
        promptHistory = promptHistory.filter(h => h.id !== id);
        chrome.storage.local.set({ [HISTORY_KEY]: promptHistory }, () => {
            renderHistory(historySearch ? historySearch.value.trim().toLowerCase() : '');
            showToast('Prompt removed from history.');
        });
    }

    function restoreHistory(item) {
        promptInput.value = item.input || '';
        rawGeneratedText = item.output || '';
        promptOutput.innerHTML = renderMarkdown(item.output || '');
        promptOutput.classList.remove('empty');
        promptOutput.contentEditable = 'true';
        outputBadge.classList.remove('hidden');
        clearOutputBtn.classList.remove('hidden');
        if (toneSelect && item.tone) toneSelect.value = item.tone;
        copyBtn.disabled = false;
        insertBtn.disabled = false;
        updateDraftCounters();
        updateOutputCounters(item.output || '');
        switchTab('pilot');
        showToast('Restored prompt to editor.');
    }

    function formatRelativeTime(timestamp) {
        if (!timestamp) return '';
        const now = Date.now();
        const diffMs = now - timestamp;
        const diffSec = Math.floor(diffMs / 1000);
        const diffMin = Math.floor(diffSec / 60);
        const diffHour = Math.floor(diffMin / 60);
        const diffDay = Math.floor(diffHour / 24);

        if (diffSec < 60) return 'Just now';
        if (diffMin < 60) return `${diffMin}m ago`;
        if (diffHour < 24) return `${diffHour}h ago`;
        if (diffDay === 1) return 'Yesterday';
        return new Date(timestamp).toLocaleDateString([], { month: 'short', day: 'numeric' });
    }

    function escapeHtml(text) {
        if (!text) return '';
        return text
            .replace(/&/g, '&amp;')
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;')
            .replace(/'/g, '&#039;');
    }
});
