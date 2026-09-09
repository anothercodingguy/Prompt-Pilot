/**
 * PromptPilot Chrome Extension - Background Service Worker
 * Acts as the extension's background proxy and fallback service.
 */

const GROQ_API_URL = 'https://api.groq.com/openai/v1/chat/completions';
const DEFAULT_MODEL = 'openai/gpt-oss-120b';

chrome.runtime.onInstalled.addListener(() => {
    console.log('PromptPilot Extension installed and initialized with Groq backend service.');
    // Set default provider to groq
    chrome.storage.local.set({
        ai_provider: 'groq',
        groq_model: DEFAULT_MODEL
    });
});

// Listener for background messages from popup
chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
    chrome.storage.local.get(['backend_url'], (res) => {
        const backendUrl = (res.backend_url || 'http://localhost:3000').replace(/\/+$/, '');

        if (request.action === 'checkBackend') {
            fetch(`${backendUrl}/api/health`)
                .then(r => r.json())
                .then(data => sendResponse({ online: true, details: data }))
                .catch(() => sendResponse({ online: false, mode: 'cloud_groq' }));
            return;
        }

        if (request.action === 'generatePromptFallback') {
            const { prompt, tone = 'Standard', model = DEFAULT_MODEL } = request;

            fetch(`${backendUrl}/api/generate`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ prompt, tone, model })
            })
            .then(async (r) => {
                if (!r.ok) {
                    const err = await r.json().catch(() => ({}));
                    throw new Error(err.error || `Backend Error: ${r.status}`);
                }
                return r.text();
            })
            .then(data => {
                sendResponse({ success: true, raw: data });
            })
            .catch(err => {
                sendResponse({ success: false, error: err.message });
            });
            return;
        }
    });

    return true; // async response
});
