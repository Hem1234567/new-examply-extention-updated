// =================================================================
//  popup.js  –  Examly AI Automation Extension  v3.0.0
// =================================================================

document.addEventListener('DOMContentLoaded', () => {
  // ── DOM refs ──────────────────────────────────────────────────
  const startBtn        = document.getElementById('start-btn');
  const inspectBtn      = document.getElementById('inspect-btn');
  const saveKeyBtn      = document.getElementById('save-key-btn');
  const saveOrKeyBtn    = document.getElementById('save-or-key-btn');
  const geminiKeyInput  = document.getElementById('gemini-key-input');
  const orKeyInput      = document.getElementById('openrouter-key-input');
  const orModelInput    = document.getElementById('openrouter-model-input');
  const statusText      = document.getElementById('status-text');
  const statusDot       = document.getElementById('status-dot');
  const modeSummary     = document.getElementById('mode-summary');
  const keyBadge        = document.getElementById('key-badge');
  const toggleBtns      = document.querySelectorAll('.toggle-btn');
  const providerTabs    = document.querySelectorAll('.provider-tab');
  const panelGemini     = document.getElementById('panel-gemini');
  const panelOpenRouter = document.getElementById('panel-openrouter');
  const tabGemini       = document.getElementById('tab-gemini');
  const tabOpenRouter   = document.getElementById('tab-openrouter');

  // ── State ─────────────────────────────────────────────────────
  const selected      = new Set();
  let activeProvider  = 'gemini';

  // ── Load saved state ──────────────────────────────────────────
  chrome.storage.local.get(
    ['geminiApiKey', 'openrouterApiKey', 'openrouterModel', 'apiProvider', 'automationTypes'],
    result => {
      if (result.apiProvider) { activeProvider = result.apiProvider; renderProviderTabs(); }
      if (result.geminiApiKey)     geminiKeyInput.value = result.geminiApiKey;
      if (result.openrouterApiKey) orKeyInput.value     = result.openrouterApiKey;
      if (result.openrouterModel)  orModelInput.value   = result.openrouterModel;
      else orModelInput.placeholder = 'e.g. openai/gpt-4o-mini';
      updateKeyBadge(result);
      if (result.automationTypes?.length) {
        result.automationTypes.forEach(t => selected.add(t));
        renderToggles();
      }
    }
  );

  // ── Provider tab switching ─────────────────────────────────────
  providerTabs.forEach(tab => {
    tab.addEventListener('click', () => {
      activeProvider = tab.dataset.provider;
      chrome.storage.local.set({ apiProvider: activeProvider });
      renderProviderTabs();
      chrome.storage.local.get(['geminiApiKey', 'openrouterApiKey'], updateKeyBadge);
    });
  });

  function renderProviderTabs() {
    tabGemini.className     = 'provider-tab';
    tabOpenRouter.className = 'provider-tab';
    if (activeProvider === 'openrouter') {
      tabOpenRouter.classList.add('active-openrouter');
      panelGemini.style.display     = 'none';
      panelOpenRouter.style.display = '';
    } else {
      tabGemini.classList.add('active-gemini');
      panelGemini.style.display     = '';
      panelOpenRouter.style.display = 'none';
    }
  }

  function updateKeyBadge(result) {
    const hasKey = activeProvider === 'openrouter' ? !!result.openrouterApiKey : !!result.geminiApiKey;
    keyBadge.style.display = hasKey ? 'inline-block' : 'none';
  }

  // ── Save Gemini key ───────────────────────────────────────────
  saveKeyBtn.addEventListener('click', () => {
    const key = geminiKeyInput.value.trim();
    if (!key) { setStatus('⚠️ Please paste your Gemini API key first', 'error'); return; }
    chrome.storage.local.set({ geminiApiKey: key, apiProvider: 'gemini' }, () => {
      activeProvider = 'gemini';
      keyBadge.style.display = 'inline-block';
      setStatus('✅ Gemini API key saved!', 'ready');
      setTimeout(() => setStatus('Ready', 'ready'), 2000);
    });
  });

  // ── Save OpenRouter key + model ───────────────────────────────
  saveOrKeyBtn.addEventListener('click', () => {
    const key   = orKeyInput.value.trim();
    const model = orModelInput.value.trim() || 'openai/gpt-4o-mini';
    if (!key) { setStatus('⚠️ Please paste your OpenRouter API key first', 'error'); return; }
    chrome.storage.local.set({ openrouterApiKey: key, openrouterModel: model, apiProvider: 'openrouter' }, () => {
      activeProvider = 'openrouter';
      keyBadge.style.display = 'inline-block';
      setStatus(`✅ OpenRouter key saved! (${model})`, 'ready');
      setTimeout(() => setStatus('Ready', 'ready'), 2500);
    });
  });

  // ── Toggle mode buttons ───────────────────────────────────────
  toggleBtns.forEach(btn => {
    btn.addEventListener('click', () => {
      const type = btn.dataset.type;

      if (type === 'all') {
        // "Full Auto" toggle — select all three OR deselect all
        const allSelected = selected.has('video') && selected.has('mcq') && selected.has('coding');
        selected.clear();
        if (!allSelected) { selected.add('video'); selected.add('mcq'); selected.add('coding'); }
      } else {
        if (selected.has(type)) selected.delete(type); else selected.add(type);
      }

      renderToggles();
      chrome.storage.local.set({ automationTypes: [...selected] });
    });
  });

  function renderToggles() {
    const allActive = selected.has('video') && selected.has('mcq') && selected.has('coding');

    toggleBtns.forEach(btn => {
      const type = btn.dataset.type;
      btn.className = 'toggle-btn';
      if (type === 'all') {
        if (allActive) btn.classList.add('active-all');
      } else {
        if (selected.has(type)) btn.classList.add(`active-${type}`);
      }
    });

    if (selected.size === 0) {
      modeSummary.className   = 'summary none';
      modeSummary.textContent = '⚠️ Select at least one option';
      return;
    }

    const labels = { video: '▶️ Video', mcq: '📝 MCQ', coding: '💻 Coding' };
    const parts  = ['video', 'mcq', 'coding'].filter(t => selected.has(t)).map(t => labels[t]);
    modeSummary.className   = 'summary active';
    modeSummary.textContent = '✅ Will run: ' + parts.join(' + ');
  }

  // ── Start automation ──────────────────────────────────────────
  startBtn.addEventListener('click', () => {
    if (selected.size === 0) { setStatus('⚠️ Select at least one mode first!', 'error'); return; }

    if (selected.has('coding') || selected.has('mcq')) {
      const storageKey = activeProvider === 'openrouter' ? 'openrouterApiKey' : 'geminiApiKey';
      chrome.storage.local.get([storageKey], result => {
        if (!result[storageKey]) {
          const name = activeProvider === 'openrouter' ? 'OpenRouter' : 'Gemini';
          setStatus(`⚠️ Add your ${name} API key first!`, 'error');
          return;
        }
        doStart();
      });
    } else {
      doStart();
    }
  });

  function doStart() {
    const types = [...selected];
    setStatus('🚀 Running automation…', 'working');
    startBtn.disabled = true;

    sendToContent('start_automation', { types }, res => {
      startBtn.disabled = false;
      if (res?.status) setStatus(res.status, 'ready');
      else setStatus('Done', 'ready');
    });
  }

  // ── Inspect page ──────────────────────────────────────────────
  inspectBtn.addEventListener('click', () => {
    setStatus('🔍 Grabbing page HTML…', 'working');
    sendToContent('inspect_page', {}, res => {
      if (res?.htmlSnippet) {
        navigator.clipboard.writeText(res.htmlSnippet)
          .then(() => setStatus('📋 HTML copied to clipboard!', 'ready'))
          .catch(() => setStatus('Copy failed — check permissions', 'error'));
      } else {
        setStatus('Could not read page HTML', 'error');
      }
    });
  });

  // ── Send message to active tab ─────────────────────────────────
  function sendToContent(action, payload, callback) {
    chrome.tabs.query({ active: true, currentWindow: true }, tabs => {
      const tab = tabs[0];
      if (!tab?.id) { setStatus('No active tab found', 'error'); return; }

      const msg = { action, ...payload };

      chrome.tabs.sendMessage(tab.id, msg, response => {
        if (chrome.runtime.lastError) {
          // Inject content script if not already present
          chrome.scripting.executeScript(
            { target: { tabId: tab.id }, files: ['content.js'] },
            () => {
              if (chrome.runtime.lastError) {
                setStatus('❌ Cannot inject on this page', 'error');
                if (callback) callback(null);
                return;
              }
              setTimeout(() => {
                chrome.tabs.sendMessage(tab.id, msg, retry => {
                  if (chrome.runtime.lastError) {
                    setStatus('❌ Script injection failed', 'error');
                    if (callback) callback(null);
                  } else {
                    if (callback) callback(retry);
                  }
                });
              }, 600);
            }
          );
        } else {
          if (callback) callback(response);
        }
      });
    });
  }

  // ── Status helper ─────────────────────────────────────────────
  function setStatus(text, state) {
    statusText.textContent = text;
    statusDot.className    = 'status-dot ' + (state || 'ready');
    startBtn.disabled      = (state === 'working');
  }
});
