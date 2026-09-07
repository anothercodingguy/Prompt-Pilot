# PromptPilot

PromptPilot is an AI prompt refinement Chrome Extension powered by **Groq Ultra-Fast LPU Inference**. It structures messy, raw ideas into actionable, high-performing prompts using the **CO-STAR** framework.

## 🚀 Key Highlights
- **Zero Client API Key Entry:** The Groq API key is held securely in the backend—no need to paste keys into the extension popup.
- **Groq LPU Acceleration:** Powered by ultra-fast Groq models (`openai/gpt-oss-120b`, `openai/gpt-oss-20b`, and `groq/compound`).
- **ChatGPT Dark Aesthetic:** Sleek capsule controls, tone selector, markdown rendering, and instant copy/insert.
- **Dual-Layer Architecture:** Runs with a local Node.js backend server, with seamless automatic fallback to direct cloud Groq inference.

---

## 🛠️ Quick Start

### 1. Start the Backend Server
```bash
# In the PromptPilot directory:
npm start
# or:
node server.js
```
The server will start on `http://localhost:3000`.

To change the port or Groq API key, edit `.env`:
```env
PORT=3000
GROQ_API_KEY=gsk_...
GROQ_DEFAULT_MODEL=openai/gpt-oss-120b
```

### 2. Load Extension in Chrome
1. Open Google Chrome and navigate to `chrome://extensions`.
2. Enable **Developer mode** (top-right toggle).
3. Click **Load unpacked** (top-left button).
4. Select the `PromptPilot` folder (`/Users/suyash/Downloads/PromptPilot`).
5. Pin PromptPilot to your toolbar and click it to open!

---

## ⚙️ Features
- **Tone Selector:** Standard, Professional, Creative, Coder Mode, Academic, ELI5.
- **Quick Template Chips:** Code debugging, email polishing, text summarization.
- **Markdown Response View:** Formatted headers, code blocks, bold text, and lists.
- **Insert into Active Page:** Type generated prompts directly into any web page input field.
- **Prompt History:** Searchable, persistent local history.
