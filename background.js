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
    if (request.action === 'checkBackend') {
        fetch('http://localhost:3000/api/health')
            .then(res => res.json())
            .then(data => sendResponse({ online: true, details: data }))
            .catch(() => sendResponse({ online: false, mode: 'cloud_groq' }));
        return true; // async response
    }

    if (request.action === 'generatePromptFallback') {
        const { prompt, tone = 'Standard', model = DEFAULT_MODEL } = request;

        fetch('http://localhost:3000/api/generate', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ prompt, tone, model })
        })
        .then(async (res) => {
            if (!res.ok) {
                const err = await res.json().catch(() => ({}));
                throw new Error(err.error || `Backend Error: ${res.status}`);
            }
            return res.text();
        })
        .then(data => {
            sendResponse({ success: true, raw: data });
        })
        .catch(err => {
            sendResponse({ success: false, error: err.message });
        });

        return true;
    }
});
