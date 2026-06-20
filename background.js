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
      generationConfig: { temperature: 0.0, maxOutputTokens: 8192, topP: 1.0 }
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

  // ── Step 1: structured sample cases block ──────────────────────────────────
  let samplesBlock = '';
  if (testCases && testCases.length > 0) {
    samplesBlock += '\n\n=== SAMPLE TEST CASES ===\n';
    testCases.forEach((tc, i) => {
      samplesBlock += `\nSample ${i + 1}:\nInput:\n${tc.input.trim()}\nExpected Output:\n${tc.output.trim()}\n`;
    });
    samplesBlock += '\n=========================\n';
  }

  // ── Step 2: language-specific rules ───────────────────────────────────────
  const langRules = {
    'Java': [
      'Class name MUST be exactly "Main" (public class Main).',
      'Entry point MUST be: public static void main(String[] args).',
      'Use Scanner or BufferedReader for stdin. Use System.out.print/println for stdout.',
      'Import all required packages (java.util.*, java.io.*, etc.).',
      'Do NOT use package declarations.',
    ],
    'Python 3': [
      'Use input() to read each line from stdin.',
      'Use print() for stdout. print() adds a newline automatically — do NOT add extra \\n.',
      'If multiple values on one line: map(int, input().split()) or input().split().',
      'Handle ALL lines of input that the problem specifies.',
    ],
    'C++': [
      'Include all required headers: #include <bits/stdc++.h> or specific ones.',
      'Entry point: int main() { ... return 0; }',
      'Use cin for stdin, cout for stdout.',
      'Do NOT use "using namespace std;" unless needed — or add it safely.',
    ],
    'C': [
      'Include all required headers: #include <stdio.h>, <stdlib.h>, <string.h> as needed.',
      'Entry point: int main() { ... return 0; }',
      'Use scanf/printf for I/O.',
    ],
    'JavaScript (Node.js)': [
      'Read all input at once: const lines = require("fs").readFileSync("/dev/stdin","utf8").trim().split("\\n");',
      'Use process.stdout.write() or console.log() for output.',
      'console.log() adds a newline — do NOT double-add \\n at end.',
    ],
  };

  const specificRules = (langRules[lang] || [
    `Write complete, compilable ${lang} code.`,
    'Read from stdin, write to stdout.',
  ]).map((r, i) => `  ${i + 1}. ${r}`).join('\n');

  // ── Step 3: compose the full prompt ───────────────────────────────────────
  let prompt =
`You are a world-class competitive programmer. Your task is to write a PERFECT solution in ${lang} that passes ALL test cases on the FIRST attempt.

=== PROBLEM ===
${question.trim()}
===============${samplesBlock}
=== STRICT OUTPUT RULES ===
1. Output ONLY the raw source code — zero markdown, zero backtick fences, zero explanations.
2. Do NOT include any code comments.
3. The code must be 100% complete and immediately compilable/runnable with no modifications.
4. Read from standard input (stdin). Write to standard output (stdout).
${specificRules}

=== CRITICAL CORRECTNESS RULES ===
Before writing a single line of code, carefully:
  a) Identify the EXACT input format: how many lines, what values per line, what separators.
  b) Identify the EXACT output format: spacing, newlines, case sensitivity, trailing characters.
  c) Mentally trace your solution on EVERY sample test case listed above and verify output matches exactly — character by character.
  d) Consider ALL edge cases: empty input, single element, n=0, n=1, negative numbers, very large numbers (use long/int64 if needed), duplicate values, already sorted input, all same values.
  e) If the output is a single value per test case, do NOT add extra newlines or spaces.
  f) Watch for: off-by-one errors, integer overflow (use long/long long for large n), wrong loop bounds, missed edge cases.

=== OUTPUT FORMAT MATCHING ===
- Match the expected output EXACTLY — same whitespace, same case, same newline placement.
- If expected output has a trailing newline, include it. If not, don't add one.
- Numbers: print integers as integers (not 1.0 for 1). Floats: match decimal places shown.

Now output ONLY the complete, correct ${lang} source code:`;

  if (previousCode && previousError) {
    prompt += `


=============================================
YOUR PREVIOUS ATTEMPT FAILED — YOU MUST FIX IT:
The following ${lang} code was submitted but produced an error or wrong answer.
Analyze the error carefully, identify the root cause, and output a completely corrected solution.

BROKEN CODE:
${previousCode}

COMPILER / RUNTIME / WRONG ANSWER ERROR:
${previousError}

Fix ALL issues. Output ONLY the corrected source code. Nothing else.
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
