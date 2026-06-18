# Examly AI Automation — v3.0.0

**Zero-human-interaction** automation for Examly / iamneo / neo.iamneo.ai courses.

| Feature | What it does |
|---|---|
| ▶️ **Video** | Opens every module, plays videos at **16× speed**, skips stalls, waits for completion |
| 📝 **MCQ** | Reads every MCQ in the test, asks **Gemini AI** for the correct answer, clicks it |
| 💻 **Coding** | Reads the problem, generates working code via AI, pastes it, clicks Run/Compile, checks test results — retries up to **5× automatically** if tests fail |
| ⚡ **Full Auto** | All three at once — the extension navigates every module by itself end-to-end |

---

## Installation

1. Clone / download this folder (`examly-ext-fixed`)
2. Open Chrome → go to `chrome://extensions/`
3. Enable **Developer mode** (toggle, top-right)
4. Click **Load unpacked**
5. Select the `examly-ext-fixed` folder
6. The extension icon appears in the Chrome toolbar ✅

---

## One-time Setup (required for MCQ + Coding AI)

1. Get a **free** Gemini API key at: <https://aistudio.google.com/app/apikey>
2. Click the extension icon
3. Paste the key into the **Gemini API Key** field
4. Click **Save** — the "✓ Saved" badge will appear

> Alternatively, use **OpenRouter** (click the 🟣 OpenRouter tab) with any model you choose.

---

## Usage

1. Go to your Examly / iamneo course dashboard page
2. Click the extension icon
3. Click **⚡ Full Auto** (selects Video + MCQ + Coding)
4. Click **▶ Start Automation**

The extension will:
- Expand all course folders
- Open each module one by one
- Skip already-completed modules automatically
- Handle all test pre-screens (Agree, Fullscreen, Take Test, Resume)
- Dismiss tab-switch warnings automatically
- Navigate through every MCQ and coding question
- Submit the test and exit back to the course page
- Move to the next module and repeat

A green toast notification on the page shows live progress.

---

## File Structure

```
examly-ext-fixed/
├── manifest.json      ← Extension config (v3.0.0)
├── background.js      ← Service worker: Gemini / OpenRouter API calls
├── content.js         ← Full page automation logic (merged + enhanced)
├── content.css        ← Toast notification style
├── popup.html         ← Extension popup UI
├── popup.js           ← Popup logic (Full Auto button, settings)
└── icons/
    ├── icon16.png
    ├── icon48.png
    └── icon128.png
```

---

## How Coding Automation Works

1. Reads the problem statement from the page
2. Reads any sample test cases shown
3. Detects the programming language (Java / Python / C++ / etc.)
4. Sends everything to Gemini AI with a strict prompt
5. Pastes the generated code into the Monaco/CodeMirror editor
6. Clicks **Compile & Run**
7. Reads the output panel:
   - If **all tests pass** → clicks Submit Code → moves to next question
   - If **error** → sends the broken code + error message back to AI, asks for a fix → retries (up to 5 attempts)
8. If all 5 attempts fail, submits the best attempt and moves on

---

## Troubleshooting

| Problem | Fix |
|---|---|
| "No API key" error | Enter your Gemini API key in the popup and click Save |
| Extension not injecting | Refresh the Examly page, then click the extension again |
| Video not completing | The video might be in a nested iframe — the extension handles this automatically via cross-frame messaging |
| Code pasted but wrong editor | Open DevTools (F12) → find the editor's CSS class → add it to `pasteCodeIntoEditor()` in content.js |
| Gemini 429 rate limit | Free tier hit — wait 60 seconds and click Start again |
| Tab-switch warning blocks test | The extension auto-dismisses these every 600ms in the background |
| Coding: wrong language detected | Inspect the language dropdown in DevTools → add its selector to `detectLanguage()` in content.js |
