// =================================================================
//  background.js  –  Examly AI Automation Extension  v3.0.0
//  Service worker: Gemini / OpenRouter code generation + MCQ answers
// =================================================================

chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  // ── Code generation for coding questions ──
  if (request.action === 'generateCode') {
    handleCodeGeneration(request)
      .then(result  => sendResponse(result))
      .catch(err    => sendResponse({ success: false, error: err.message }));
    return true;
  }

  // ── Direct Gemini prompt (for MCQ answers) ──
  if (request.action === 'askGemini') {
    askGeminiDirect(request.prompt)
      .then(answer  => sendResponse({ success: true, answer }))
      .catch(err    => sendResponse({ success: false, error: err.message }));
    return true;
  }

  // ── Read stored settings ──
  if (request.action === 'getSettings') {
    chrome.storage.local.get(
      ['geminiApiKey', 'openrouterApiKey', 'openrouterModel', 'apiProvider', 'automationTypes'],
      result => { sendResponse(result); }
    );
    return true;
  }
});

// =================================================================
//  CODE GENERATION HANDLER
// =================================================================
async function handleCodeGeneration({ question, language, testCases, previousCode, previousError }) {
  const stored = await getStorage(['geminiApiKey', 'openrouterApiKey', 'openrouterModel', 'apiProvider']);
  const provider = stored.apiProvider || 'gemini';

  if (provider === 'openrouter') {
    const apiKey = (stored.openrouterApiKey || '').trim();
    if (!apiKey) {
      return { success: false, error: 'No OpenRouter API key found. Please enter your key in the extension popup and click Save.' };
    }
    const model = (stored.openrouterModel || '').trim() || 'openai/gpt-4o-mini';
    try {
      const code = await callOpenRouter(apiKey, model, question, language, testCases, previousCode, previousError);
      return { success: true, code };
    } catch (err) {
      return { success: false, error: err.message };
    }
  }

  // Default: Gemini
  const apiKey = (stored.geminiApiKey || '').trim();
  if (!apiKey) {
    return { success: false, error: 'No Gemini API key found. Please enter your key in the extension popup and click Save.' };
  }
  try {
    const code = await callGemini(apiKey, buildCodePrompt(question, language, testCases, previousCode, previousError));
    return { success: true, code };
  } catch (err) {
    return { success: false, error: err.message };
  }
}

// =================================================================
//  DIRECT GEMINI PROMPT  (for MCQ / general questions)
// =================================================================
async function askGeminiDirect(prompt) {
  const { geminiApiKey } = await getStorage(['geminiApiKey']);
  const apiKey = (geminiApiKey || '').trim();
  if (!apiKey) throw new Error('No Gemini API key found. Please save your key in the extension popup.');
  return callGemini(apiKey, prompt);
}

// =================================================================
//  GEMINI API
// =================================================================
async function callGemini(apiKey, prompt) {
  const model = 'gemini-2.0-flash';
  const url   = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${apiKey}`;

  const resp = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      contents: [{ parts: [{ text: prompt }] }],
      generationConfig: { temperature: 0.05, maxOutputTokens: 4096, topP: 0.8 }
    })
  });

  if (!resp.ok) {
    const txt = await resp.text();
    throw new Error(`Gemini API error ${resp.status}: ${txt.slice(0, 300)}`);
  }

  const data = await resp.json();
  const raw  = data?.candidates?.[0]?.content?.parts?.[0]?.text ?? '';
  if (!raw) throw new Error('Gemini returned an empty response.');
  return stripMarkdown(raw);
}

// =================================================================
//  OPENROUTER API
// =================================================================
async function callOpenRouter(apiKey, model, question, language, testCases, previousCode, previousError) {
  const prompt = buildCodePrompt(question, language, testCases, previousCode, previousError);

  const resp = await fetch('https://openrouter.ai/api/v1/chat/completions', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${apiKey}`,
      'HTTP-Referer': 'https://examly.io',
      'X-Title': 'Examly AI Automation'
    },
    body: JSON.stringify({
      model,
      messages: [{ role: 'user', content: prompt }],
      temperature: 0.05,
      max_tokens: 4096
    })
  });

  if (!resp.ok) {
    const txt = await resp.text();
    throw new Error(`OpenRouter API error ${resp.status}: ${txt.slice(0, 300)}`);
  }

  const data = await resp.json();
  if (data.error) throw new Error(`OpenRouter: ${data.error.message || JSON.stringify(data.error)}`);
  const raw = data?.choices?.[0]?.message?.content ?? '';
  if (!raw) throw new Error('OpenRouter returned an empty response.');
  return stripMarkdown(raw);
}

// =================================================================
//  CODE PROMPT BUILDER
// =================================================================
function buildCodePrompt(question, language, testCases, previousCode, previousError) {
  const lang = normaliseLang(language);

  let prompt =
`You are an expert competitive programmer. Solve the problem below in ${lang}.

OUTPUT RULES (STRICTLY FOLLOW):
- Output ONLY the raw source code. No explanations. No markdown. No backtick fences.
- The code must read from standard input (stdin) and write to standard output (stdout).
- Do NOT include any comments.
- The code must be complete and compilable as-is.
- For Java: the class name MUST be "Main" with a public static void main(String[] args) method.
- For Python: use input() for reading; print() for output.
- For C/C++: include all required headers; use int main().

PROBLEM:
${question.trim()}`;

  if (testCases && testCases.length > 0) {
    prompt += '\n\nSAMPLE TEST CASES:\n';
    testCases.forEach((tc, i) => {
      prompt += `\n--- Case ${i + 1} ---\nInput:\n${tc.input}\nExpected Output:\n${tc.output}\n`;
    });
    prompt += '\nMake sure your solution produces exactly the expected output for every sample case.';
  }

  if (previousCode && previousError) {
    prompt += `

=============================================
PREVIOUS ATTEMPT FAILED — FIX IT:
The following ${lang} code was submitted but produced an error.
You MUST fix every issue so it compiles and runs correctly.

BROKEN CODE:
${previousCode}

COMPILER / RUNTIME ERROR:
${previousError}

Output ONLY the corrected source code. Nothing else.
=============================================`;
  }

  return prompt;
}

// =================================================================
//  HELPERS
// =================================================================
function stripMarkdown(raw) {
  const fenced = raw.match(/```(?:[a-zA-Z+#]*\n)?([\s\S]*?)```/);
  if (fenced) return fenced[1].trim();
  return raw.trim();
}

function normaliseLang(lang) {
  const map = {
    python: 'Python 3', python3: 'Python 3', py: 'Python 3',
    java: 'Java',
    c: 'C',
    cpp: 'C++', 'c++': 'C++',
    javascript: 'JavaScript (Node.js)', js: 'JavaScript (Node.js)',
    typescript: 'TypeScript', ts: 'TypeScript',
    go: 'Go', golang: 'Go',
    ruby: 'Ruby', rb: 'Ruby',
    swift: 'Swift',
  };
  return map[(lang || '').toLowerCase()] ?? (lang || 'Java');
}

function getStorage(keys) {
  return new Promise(resolve => chrome.storage.local.get(keys, resolve));
}
