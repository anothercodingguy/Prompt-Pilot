/**
 * PromptPilot Backend Server
 * Handles Groq API inference and SSE streaming with zero external dependencies.
 */

const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');

// Simple .env parser to avoid requiring external npm dependencies
function loadEnv() {
    const envPath = path.resolve(__dirname, '.env');
    if (fs.existsSync(envPath)) {
        const content = fs.readFileSync(envPath, 'utf8');
        content.split('\n').forEach(line => {
            const trimmed = line.trim();
            if (!trimmed || trimmed.startsWith('#')) return;
            const eqIndex = trimmed.indexOf('=');
            if (eqIndex > 0) {
                const key = trimmed.slice(0, eqIndex).trim();
                const val = trimmed.slice(eqIndex + 1).trim().replace(/^['"]|['"]$/g, '');
                if (!process.env[key]) {
                    process.env[key] = val;
                }
            }
        });
    }
}

loadEnv();

const PORT = parseInt(process.env.PORT || '3000', 10);
const GROQ_API_KEY = process.env.GROQ_API_KEY;
const DEFAULT_MODEL = process.env.GROQ_DEFAULT_MODEL || 'openai/gpt-oss-120b';
const GROQ_API_URL = 'https://api.groq.com/openai/v1/chat/completions';

function setCorsHeaders(res) {
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
}

const server = http.createServer(async (req, res) => {
    setCorsHeaders(res);

    // Handle preflight CORS request
    if (req.method === 'OPTIONS') {
        res.writeHead(204);
        res.end();
        return;
    }

    const parsedUrl = new URL(req.url, `http://${req.headers.host || 'localhost'}`);

    // GET /api/health
    if (req.method === 'GET' && parsedUrl.pathname === '/api/health') {
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({
            status: 'ok',
            service: 'PromptPilot Backend',
            provider: 'groq',
            defaultModel: DEFAULT_MODEL,
            hasKey: Boolean(GROQ_API_KEY),
            timestamp: Date.now()
        }));
        return;
    }

    // POST /api/generate
    if (req.method === 'POST' && parsedUrl.pathname === '/api/generate') {
        let bodyRaw = '';
        req.on('data', chunk => {
            bodyRaw += chunk;
            if (bodyRaw.length > 1e6) { // 1MB limit
                req.destroy();
            }
        });

        req.on('end', async () => {
            let payload;
            try {
                payload = JSON.parse(bodyRaw);
            } catch (err) {
                res.writeHead(400, { 'Content-Type': 'application/json' });
                res.end(JSON.stringify({ error: 'Invalid JSON body' }));
                return;
            }

            const prompt = payload.prompt?.trim();
            const tone = payload.tone || 'Standard';
            const model = payload.model || DEFAULT_MODEL;

            if (!prompt) {
                res.writeHead(400, { 'Content-Type': 'application/json' });
                res.end(JSON.stringify({ error: 'Missing prompt in request' }));
                return;
            }

            if (!GROQ_API_KEY) {
                res.writeHead(500, { 'Content-Type': 'application/json' });
                res.end(JSON.stringify({ error: 'Backend Groq API Key is not configured.' }));
                return;
            }

            const SYSTEM_PROMPT = `You are an expert Prompt Engineer. Rewrite the user's input to be ${tone} in style. Use the CO-STAR framework (Context, Objective, Style, Tone, Audience, Response) to structure the output. Do NOT explain the framework, just output the refined prompt.`;

            const abortController = new AbortController();
            res.on('close', () => {
                if (!res.writableEnded) {
                    abortController.abort();
                }
            });

            try {
                const groqResponse = await fetch(GROQ_API_URL, {
                    method: 'POST',
                    signal: abortController.signal,
                    headers: {
                        'Content-Type': 'application/json',
                        'Authorization': `Bearer ${GROQ_API_KEY}`
                    },
                    body: JSON.stringify({
                        model: model,
                        messages: [
                            { role: 'system', content: SYSTEM_PROMPT },
                            { role: 'user', content: prompt }
                        ],
                        temperature: 0.7,
                        max_tokens: 2048,
                        stream: true
                    })
                });

                if (!groqResponse.ok) {
                    const errText = await groqResponse.text().catch(() => 'Groq API request failed');
                    let errMsg = `Groq API Error: ${groqResponse.status}`;
                    try {
                        const parsed = JSON.parse(errText);
                        if (parsed.error?.message) errMsg = parsed.error.message;
                    } catch (_) {}
                    res.writeHead(groqResponse.status, { 'Content-Type': 'application/json' });
                    res.end(JSON.stringify({ error: errMsg }));
                    return;
                }

                // Send SSE response headers
                res.writeHead(200, {
                    'Content-Type': 'text/event-stream',
                    'Cache-Control': 'no-cache',
                    'Connection': 'keep-alive',
                    'X-Accel-Buffering': 'no'
                });

                const reader = groqResponse.body.getReader();
                while (true) {
                    const { done, value } = await reader.read();
                    if (done) break;
                    res.write(value);
                }
                res.end();
            } catch (err) {
                if (err.name === 'AbortError') {
                    res.end();
                } else {
                    console.error('[PromptPilot Backend Error]:', err);
                    if (!res.headersSent) {
                        res.writeHead(500, { 'Content-Type': 'application/json' });
                        res.end(JSON.stringify({ error: err.message || 'Internal server error' }));
                    } else {
                        res.write(`data: {"error": "${err.message}"}\n\n`);
                        res.end();
                    }
                }
            }
        });
        return;
    }

    // Serve static files for browser preview (e.g. http://localhost:3000)
    if (req.method === 'GET') {
        let reqPath = parsedUrl.pathname;
        if (reqPath === '/' || reqPath === '') {
            reqPath = '/popup.html';
        }

        // Prevent directory traversal or accessing sensitive files
        const safePath = path.normalize(reqPath).replace(/^(\.\.[\/\\])+/, '');
        if (safePath.startsWith('/.') || safePath.includes('.env') || safePath.includes('package')) {
            res.writeHead(403, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ error: 'Access denied' }));
            return;
        }

        const filePath = path.join(__dirname, safePath);
        if (fs.existsSync(filePath) && fs.statSync(filePath).isFile()) {
            const ext = path.extname(filePath).toLowerCase();
            const mimeTypes = {
                '.html': 'text/html; charset=utf-8',
                '.css': 'text/css; charset=utf-8',
                '.js': 'application/javascript; charset=utf-8',
                '.json': 'application/json; charset=utf-8',
                '.png': 'image/png',
                '.svg': 'image/svg+xml'
            };

            const contentType = mimeTypes[ext] || 'application/octet-stream';
            res.writeHead(200, { 'Content-Type': contentType });
            fs.createReadStream(filePath).pipe(res);
            return;
        }
    }

    // Default 404
    res.writeHead(404, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ error: 'Endpoint not found' }));
});

server.listen(PORT, '0.0.0.0', () => {
    console.log(`PromptPilot backend server running at http://localhost:${PORT}`);
    console.log(`Web preview available at http://localhost:${PORT}/popup.html`);
    console.log(`Groq Provider active with model: ${DEFAULT_MODEL}`);
});
