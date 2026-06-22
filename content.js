// =================================================================
//  content.js  –  Examly AI Automation Extension  v3.0.0
//  Full-page automation: Videos, MCQs, Coding Tests
//  Works on Examly / iamneo / neo.iamneo.ai
// =================================================================

'use strict';

console.log('[Examly-AI] Content script v3.0.0 loaded ✅');

// ── Guard: only run main logic in top frame ─────────────────────
const isTopFrame = (window === window.top);

// ── Utilities ──────────────────────────────────────────────────
const sleep = ms => new Promise(r => setTimeout(r, ms));
const log   = (...a) => console.log('%c[Examly-AI]', 'color:#6c63ff;font-weight:bold', ...a);
const warn  = (...a) => console.warn('%c[Examly-AI]', 'color:#f39c12;font-weight:bold', ...a);

// ── Global state ───────────────────────────────────────────────
let currentVideoState = { found: false, finished: false, src: '' };

// =================================================================
//  CROSS-FRAME VIDEO MESSAGING
//  iamneo embeds videos in iframes. We post messages to/from them.
// =================================================================
window.addEventListener('message', async (event) => {
  if (!event.data) return;

  // ── Handle in any frame: play & monitor the video ──
  if (event.data.action === 'play_and_monitor_video') {
    const video = document.querySelector('video');
    const playBtn = document.querySelector(
      'button[data-play-button="true"], .vjs-big-play-button, [aria-label="Play"], .play-button, #play0'
    );

    if (video) {
      // Attach tracking listeners once
      if (!video.dataset.examlyTracked) {
        video.dataset.examlyTracked   = 'true';
        video.dataset.examlyLastTime  = '0';
        video.dataset.examlyStallCount = '0';

        const markFinished = () => {
          if (video.dataset.examlyFinished) return;
          video.dataset.examlyFinished = 'true';
          try {
            window.top.postMessage({ action: 'video_finished_playing', src: video.currentSrc || video.src }, '*');
          } catch (e) {}
        };

        video.addEventListener('ended', markFinished);
        video.addEventListener('timeupdate', () => {
          // Mark finished near the end
          if (video.duration && video.currentTime >= video.duration - 0.5) {
            markFinished();
          }
          // Stall detector: if video hasn't moved in ~5 seconds, seek forward
          const lastTime   = parseFloat(video.dataset.examlyLastTime || 0);
          const stallCount = parseInt(video.dataset.examlyStallCount || 0);
          if (Math.abs(video.currentTime - lastTime) < 0.1) {
            const newCount = stallCount + 1;
            video.dataset.examlyStallCount = String(newCount);
            if (newCount >= 5) {
              video.dataset.examlyStallCount = '0';
              try {
                if (video.duration && video.currentTime + 30 < video.duration - 1) {
                  video.currentTime += 30;
                } else if (video.duration) {
                  video.currentTime = video.duration - 1;
                }
              } catch (e) {}
            }
          } else {
            video.dataset.examlyStallCount = '0';
          }
          video.dataset.examlyLastTime = String(video.currentTime);
        });
      }

      // Mute & max speed
      try { video.muted = true; } catch (e) {}
      try { video.playbackRate        = 16.0; } catch (e) {}
      try { video.defaultPlaybackRate = 16.0; } catch (e) {}

      // Skip to near the end immediately (avoids buffering at 16x)
      if (!video.dataset.examlyFinished && video.duration && isFinite(video.duration) && video.duration > 2) {
        const targetTime = video.duration - 1.0;
        if (video.currentTime < targetTime - 2) {
          try { video.currentTime = targetTime; } catch (e) {}
        }
      }

      // Play if paused
      if (video.paused && !video.dataset.examlyFinished) {
        if (playBtn) playBtn.click();
        video.play().catch(() => {});
      }

      try {
        window.top.postMessage({ action: 'video_found', src: video.currentSrc || video.src }, '*');
      } catch (e) {}
    } else {
      // No video element — try clicking a play button overlay
      if (playBtn) { try { playBtn.click(); } catch (e) {} }
    }
  }

  // ── Top-frame only: receive signals from child frames ──
  if (isTopFrame) {
    if (event.data.action === 'video_found') {
      currentVideoState.found = true;
      currentVideoState.src   = event.data.src;
    }
    if (event.data.action === 'video_finished_playing') {
      log('Received FINISHED signal from video iframe!');
      currentVideoState.finished = true;
    }
  }
});

// =================================================================
//  MESSAGE LISTENER  (from popup.js)
// =================================================================
chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
  if (!isTopFrame) return; // only top frame handles popup messages

  if (msg.action === 'start_automation') {
    if (window.examlyAutomationRunning) {
      sendResponse({ status: '⚠️ Automation already running!' });
      return true;
    }
    window.examlyAutomationRunning = true;

    // Accept both formats: msg.types (array) or legacy msg.mode (string)
    let types = msg.types || null;
    if (!types) {
      const m = msg.mode || 'full';
      types = [];
      if (m === 'video'  || m === 'full')                     types.push('video');
      if (m === 'mcq'    || m === 'mcq_coding' || m === 'full') types.push('mcq');
      if (m === 'coding' || m === 'mcq_coding' || m === 'full') types.push('coding');
    }
    window.examlyTypes = types;

    const doVideos  = types.includes('video');
    const doMCQ     = types.includes('mcq');
    const doCoding  = types.includes('coding');

    startExamlyAutomation(doVideos, doMCQ, doCoding)
      .then(status => sendResponse({ status }))
      .catch(err   => sendResponse({ status: '❌ ' + err.message }));

    sendResponse({ status: `🚀 Automation started! (${types.join(', ')})` });
    return true;
  }

  if (msg.action === 'inspect_page') {
    sendResponse({ htmlSnippet: document.body.innerHTML.slice(0, 8000) });
    return true;
  }
});

// =================================================================
//  MAIN AUTOMATION ORCHESTRATOR
// =================================================================
async function startExamlyAutomation(doVideos, doMCQ, doCoding) {
  const label = [
    doVideos ? '▶️ Video'  : '',
    doMCQ    ? '📝 MCQ'    : '',
    doCoding ? '💻 Coding' : '',
  ].filter(Boolean).join(' + ');

  showToast(`🚀 Automation starting!\nRunning: ${label || 'Nothing selected'}`);
  log(`doVideos:${doVideos}  doMCQ:${doMCQ}  doCoding:${doCoding}`);

  // Step 1: Expand all collapsed folders/sections on the course page
  await expandAllFolders();

  window.examlyProcessedModules = window.examlyProcessedModules || new Set();

  function getModuleKey(mod) {
    if (!mod || !mod.innerText) return '';
    let text = mod.innerText.toUpperCase();
    if (text.includes('START :')) text = text.substring(0, text.indexOf('START :'));
    else if (text.includes('START')) text = text.substring(0, text.indexOf('START'));
    text = text.replace(/\d+%/g, '').replace(/\d+:\d+/g, '');
    text = text.replace(/COMPLETED|ATTEMPT|SCORE|STATUS|VIDEO/g, '');
    text = text.replace(/[^A-Z0-9]/g, '');
    return text.substring(0, 100);
  }

  function getModuleElements() {
    const all          = Array.from(document.querySelectorAll('*'));
    const startEls     = all.filter(el => el.textContent && el.textContent.includes('Start :'));
    const deepestStart = startEls.filter(m => !startEls.some(o => m !== o && m.contains(o)));

    const mods = deepestStart.map(el => {
      let card = el;
      for (let j = 0; j < 3; j++) {
        if (card.parentElement && card.parentElement.tagName !== 'BODY') card = card.parentElement;
      }
      return card;
    }).filter(mod => {
      if (!mod || !mod.innerText) return false;
      const key = getModuleKey(mod);
      return key.length > 0 && !window.examlyProcessedModules.has(key);
    });

    const unique = [...new Set(mods)];
    unique.sort((a, b) => a.getBoundingClientRect().top - b.getBoundingClientRect().top);
    return unique;
  }

  let loopCount = 0;

  while (window.examlyAutomationRunning) {
    loopCount++;
    if (loopCount > 1000) {
      log('Max module iterations reached. Stopping.');
      break;
    }

    let currentModules = getModuleElements();
    if (currentModules.length === 0) {
      await expandAllFolders();
      currentModules = getModuleElements();
      if (currentModules.length === 0) {
        log('No more unprocessed modules found. Done!');
        break;
      }
    }

    const mod = currentModules[0];
    if (mod && mod.innerText) {
      window.examlyProcessedModules.add(getModuleKey(mod));
    }

    log('Processing module:', mod.innerText?.trim().substring(0, 60));

    mod.scrollIntoView({ behavior: 'smooth', block: 'center' });
    await sleep(1000);
    mod.click();
    const firstChild = mod.querySelector('*');
    if (firstChild) firstChild.click();

    // Click any play overlays after module loads
    setTimeout(() => {
      document.querySelectorAll('.play-button, #play0, img[src*="play"]').forEach(btn => {
        try { btn.click(); } catch (e) {}
      });
    }, 2000);

    // Reset video state for this module
    currentVideoState.found    = false;
    currentVideoState.finished = false;
    const previousVideoSrc = currentVideoState.src;

    let waitLoops      = 0;
    let isTest         = false;
    let alreadyDone    = false;

    // Wait up to 20s to detect: video / test / already-completed
    while (!currentVideoState.found && waitLoops < 20) {
      if (!window.examlyAutomationRunning) return '🛑 Stopped';

      // Broadcast to self and all iframes
      window.postMessage({ action: 'play_and_monitor_video' }, '*');
      document.querySelectorAll('iframe').forEach(f => {
        try { f.contentWindow.postMessage({ action: 'play_and_monitor_video' }, '*'); } catch (e) {}
      });

      // Check if already completed (Retake Test button is shown)
      const retakeBtn = document.querySelector('button.retake-btn-color, #undefinedRetake\\ Test') ||
        findButtonByText(['retake test', 'retake']);
      if (retakeBtn && retakeBtn.offsetParent !== null) {
        alreadyDone = true;
        break;
      }

      // Check if this is a test/assessment module
      const testAcceptBtn  = document.querySelector('#tt-start-accept, #tt-header-submit');
      const takeTestBtn    = findButtonByText(['take test']);
      const resumeTestBtn  = findButtonByText(['resume', 'resume test', 'continue test']);

      if (testAcceptBtn || takeTestBtn || (resumeTestBtn && resumeTestBtn.offsetParent !== null)) {
        isTest = true;
        break;
      }

      await sleep(1000);

      // If same video src is "found" again (stale state), reset
      if (currentVideoState.found && currentVideoState.src === previousVideoSrc) {
        currentVideoState.found = false;
      }
      waitLoops++;
    }

    if (alreadyDone) {
      log('Module already completed. Skipping.');
      showToast('⏭ Module already done — skipping');
      await sleep(2000);
      continue;
    }

    if (isTest) {
      if (!doMCQ && !doCoding) {
        log('Test detected but video-only mode selected. Skipping assessment.');
        showToast('⏭ Skipping test (video-only mode)');
        await sleep(2000);
        continue;
      }
      showToast('🧪 Test detected! Starting test automation…');
      log('Test module detected. Launching handleTestAutomation…');
      await handleTestAutomation(doMCQ, doCoding);
      await sleep(3000);
      continue;
    }

    if (!currentVideoState.found) {
      log('No video detected after 20s. Skipping module.');
      showToast('⚠️ No video found — skipping module');
      continue;
    }

    if (!doVideos) {
      log('Video found but video mode disabled. Skipping.');
      showToast('⏭ Skipping video (not enabled)');
      await sleep(2000);
      continue;
    }

    // ── PLAY VIDEO ──
    showToast('▶️ Playing video at 16x speed…');
    log('Video detected. Waiting for it to finish…');

    let safetyTimeout = 600; // max 600 * 1s = 10 minutes
    let loops = 0;

    while (!currentVideoState.finished && loops < safetyTimeout) {
      if (!window.examlyAutomationRunning) return '🛑 Stopped';

      if (mod) {
        mod.style.outline   = '4px solid #6c63ff';
        mod.style.boxShadow = '0 0 15px #6c63ff55';
      }

      window.postMessage({ action: 'play_and_monitor_video' }, '*');
      document.querySelectorAll('iframe').forEach(f => {
        try { f.contentWindow.postMessage({ action: 'play_and_monitor_video' }, '*'); } catch (e) {}
      });

      // Re-enforce 16x every second (players tend to reset it)
      document.querySelectorAll('video').forEach(v => {
        try {
          if (!v.dataset.examlyFinished) {
            v.playbackRate        = 16.0;
            v.defaultPlaybackRate = 16.0;
            v.muted = true;
          }
        } catch (e) {}
      });

      await sleep(1000);
      loops++;
    }

    log('Video finished!');
    showToast('✅ Video completed!');

    if (mod) {
      mod.style.outline   = 'none';
      mod.style.boxShadow = 'none';
    }

    await sleep(1500);
  }

  showToast('🎉 All modules done! Automation complete.');
  window.examlyAutomationRunning = false;
  return '✅ Automation finished!';
}

// =================================================================
//  EXPAND ALL FOLDERS
// =================================================================
async function expandAllFolders() {
  log('Checking for collapsed folders…');
  let clickedAny = false;

  const headers = Array.from(document.querySelectorAll('.modpointer, [class*="accordion"], [class*="collapse"]'));

  for (const el of headers) {
    const txt  = el.textContent || '';
    if (txt.includes('Start :')) continue; // skip module items

    let isCollapsed = false;
    if (el.getAttribute('aria-expanded') === 'false') {
      isCollapsed = true;
    } else if (el.parentElement?.getAttribute('aria-expanded') === 'false') {
      isCollapsed = true;
    } else {
      const html = el.innerHTML.toLowerCase();
      if ((html.includes('down') || html.includes('right') || html.includes('chevron-down')) &&
          !html.includes('up') && !html.includes('chevron-up')) {
        isCollapsed = true;
      }
    }

    if (isCollapsed) {
      log('Expanding folder:', txt.trim().substring(0, 40));
      el.scrollIntoView({ behavior: 'instant', block: 'center' });
      el.click();
      clickedAny = true;
      await sleep(400); // ⚡ reduced from 1500ms → 400ms for speed
    }
  }

  if (clickedAny) {
    await sleep(600); // brief settle time before recursing
    await expandAllFolders(); // recurse once to catch newly revealed folders
  }
}

// =================================================================
//  HANDLE TEST AUTOMATION  (MCQ + Coding inside a test session)
// =================================================================
async function handleTestAutomation(doMCQ, doCoding) {
  let testRunning    = true;
  let fallbackCount  = 0;

  // Background interval: auto-dismiss popups at any time
  const warningDismisser = setInterval(() => {
    // Tab-switch warning
    const okayBtn = document.querySelector('#tt-playground-alert-accept') ||
      Array.from(document.querySelectorAll('button')).find(btn => {
        if (!btn.innerText || btn.offsetParent === null) return false;
        const t = btn.innerText.trim().toUpperCase();
        return (t === 'OKAY' || t === 'OK') &&
               document.body.innerText.includes('Tab switching is prohibited');
      });
    if (okayBtn && okayBtn.offsetParent !== null) {
      log('⚠️ Tab-switch warning dismissed');
      okayBtn.click();
      return;
    }

    // "Code not submitted" skip popup
    if (document.body.innerText.includes('Your code is not submitted')) {
      const skipBtn = Array.from(document.querySelectorAll('button')).find(btn => {
        if (!btn.innerText || btn.offsetParent === null) return false;
        const t = btn.innerText.trim().toUpperCase();
        return t === 'SKIP' || t === 'SKIP & LEAVE' || t === 'SKIP AND LEAVE' || t.startsWith('SKIP');
      });
      if (skipBtn) {
        log('⚠️ Code-not-submitted popup — clicking Skip');
        skipBtn.click();
      }
    }
  }, 600);

  // ── Index-based question tracker (immune to text changes after submit) ──
  window.examlyQuestionIndex = window.examlyQuestionIndex || 0;
  window.examlySolvedIndices = window.examlySolvedIndices || new Set();

  while (testRunning && window.examlyAutomationRunning) {
    fallbackCount++;
    if (fallbackCount > 200) { log('Test loop exceeded 200 iterations. Exiting.'); break; }

    // ── P0: Dismiss tab-switch warning ──
    const tabWarnBtn = document.querySelector('#tt-playground-alert-accept') ||
      Array.from(document.querySelectorAll('button')).find(btn => {
        if (!btn.innerText || btn.offsetParent === null) return false;
        const t = btn.innerText.trim().toUpperCase();
        return (t === 'OKAY' || t === 'OK') && document.body.innerText.includes('Tab switching is prohibited');
      });
    if (tabWarnBtn && tabWarnBtn.offsetParent !== null) {
      tabWarnBtn.click();
      fallbackCount--;
      await sleep(1500);
      continue;
    }

    // ── P1: Agree & Proceed (highest priority) ──
    const agreeBtn = document.querySelector('#tt-start-accept') ||
      Array.from(document.querySelectorAll('button, a, div.t-cursor-pointer'))
        .find(el => el.innerText && el.innerText.trim().toUpperCase().includes('AGREE'));
    if (agreeBtn && agreeBtn.offsetParent !== null) {
      const termsBox = document.querySelector('input[type="checkbox"]');
      if (termsBox && !termsBox.checked) { log('Checking terms checkbox…'); termsBox.click(); await sleep(1000); }
      log('Clicking Agree & Proceed…');
      agreeBtn.click();
      await sleep(5000);
      continue;
    }

    // ── P2: Take Test ──
    const takeTestBtn = Array.from(document.querySelectorAll('button, a, div.t-cursor-pointer'))
      .find(el => el.innerText && el.innerText.trim().toUpperCase() === 'TAKE TEST');
    if (takeTestBtn && takeTestBtn.offsetParent !== null && !document.querySelector('.modal, .dialog')) {
      log('Clicking Take Test…');
      takeTestBtn.click();
      await sleep(3000);
      continue;
    }

    // ── P3: Enable Fullscreen ──
    const fsBtn = Array.from(document.querySelectorAll('button, a, div.t-cursor-pointer'))
      .find(el => {
        if (!el.innerText) return false;
        const t = el.innerText.trim().toUpperCase();
        return (t.includes('FULLSCREEN') || t.includes('FULL SCREEN')) && !t.includes('EXIT');
      });
    if (fsBtn && fsBtn.offsetParent !== null) {
      log('Clicking Enable Fullscreen…');
      fsBtn.click();
      await sleep(3000);
      continue;
    }

    // ── P4: Resume / Continue Test ──
    const resumeBtn = Array.from(document.querySelectorAll('button, a, div.t-cursor-pointer'))
      .find(el => {
        if (!el.innerText || el.offsetParent === null) return false;
        const t = el.innerText.trim().toUpperCase();
        return t === 'RESUME' || t === 'RESUME TEST' || t.includes('RESUME TEST') ||
               t === 'CONTINUE TEST' || t.includes('CONTINUE TEST');
      });
    if (resumeBtn) {
      log('Clicking Resume Test…');
      resumeBtn.click();
      await sleep(4000);
      continue;
    }

    // ── Check if we're on the question screen ──
    const submitBtn = document.querySelector('#tt-header-submit');
    if (!submitBtn) {
      await sleep(2000);
      continue;
    }

    // ── Read page context ──
    const playground = document.querySelector('testtaking-playground') ||
                       document.querySelector('[aria-labelledby="question-answer"]');
    const mainContext = playground ? playground.innerText : document.body.innerText.substring(0, 3000);

    // ── Determine question type ──
    const radioBtns = Array.from(document.querySelectorAll('input[type="radio"], [role="radio"], .option-container'));

    if (radioBtns.length > 0) {
      // ========================
      //  MCQ QUESTION
      // ========================
      if (!doMCQ) {
        log('MCQ found but MCQ mode disabled. Navigating away.');
        const unattempted = document.querySelectorAll('[aria-labelledby="not-attempted"]');
        if (unattempted.length > 0) unattempted[0].click();
        else { submitBtn.click(); testRunning = false; }
        await sleep(2000);
        continue;
      }

      log('MCQ question detected. Asking AI…');
      showToast('📝 Solving MCQ with AI…');

      // ── Step 1: Extract clean question + options from DOM ──────────────────────
      const mcqData = readMCQData(playground);
      log('MCQ question:', mcqData.question.substring(0, 120));
      log('MCQ options:', mcqData.options);

      // readMCQData may return fewer options if DOM detection is partial —
      // we still attempt to answer as long as we have a question.
      // If options array is empty we fall back to raw mainContext for the prompt.
      if (!mcqData.question && mcqData.options.length === 0) {
        warn('readMCQData: completely empty — falling back to mainContext as question');
        mcqData.question = mainContext.substring(0, 1500);
      }

      // ── Step 2: Ask AI with a clean, structured prompt ────────────────────────
      const optionsList = mcqData.options
        .map((opt, i) => `Option ${i + 1}: ${opt}`)
        .join('\n');

      const mcqPrompt =
        `You are an expert answering a multiple-choice exam question. Read carefully and select the CORRECT answer.\n\n` +
        `QUESTION:\n${mcqData.question}\n\n` +
        `OPTIONS:\n${optionsList}\n\n` +
        `INSTRUCTIONS:\n` +
        `- Analyze the question and all options carefully.\n` +
        `- Reply with ONLY the option NUMBER (e.g. 1, 2, 3, or 4). Nothing else.\n` +
        `- Do NOT explain. Do NOT repeat the option text. Just the number.`;

      const aiAnswer = await askGemini(mcqPrompt);
      log('AI raw answer:', aiAnswer);

      // ── Step 3: Parse the option number from AI response ─────────────────────
      let chosenIndex = -1;
      if (aiAnswer) {
        // Clean markdown bold/italics and newlines
        const ans = aiAnswer.replace(/\*/g, '').trim();

        // Find numbers in the text. Look for strong signals like "Option 2" or "answer is 2",
        // or just a standalone number if the response is short.
        const numMatch = ans.match(/(?:^|\boption\s*|\banswer(?: is|:)?\s*)(\d+)/i) || 
                         ans.match(/^\(?([A-Ea-e])\)?[.:\s]/i) ||
                         (ans.length < 10 ? ans.match(/(\d+)/) : null);

        if (numMatch) {
          if (numMatch[1]) {
            // Numeric answer
            const n = parseInt(numMatch[1], 10);
            if (n >= 1 && n <= Math.max(mcqData.options.length, 10)) chosenIndex = n - 1;
          } else if (numMatch[2]) {
            // Letter answer A/B/C/D/E
            chosenIndex = 'abcde'.indexOf(numMatch[2].toLowerCase());
          }
        }

        // Pattern B: AI wrote the answer text — fuzzy match against options
        if (chosenIndex === -1 && mcqData.options.length > 0) {
          const cleaned = ans.toLowerCase().replace(/[^a-z0-9\s]/g, ' ');
          let bestScore = 0;
          mcqData.options.forEach((opt, i) => {
            if (opt.includes('text hidden')) return;
            const optLower = opt.toLowerCase().replace(/[^a-z0-9\s]/g, ' ');
            const words = cleaned.split(/\s+/).filter(w => w.length > 2);
            const hits  = words.filter(w => optLower.includes(w)).length;
            const score = words.length > 0 ? hits / words.length : 0;
            if (score > bestScore) { bestScore = score; chosenIndex = i; }
          });
          if (bestScore < 0.3) chosenIndex = -1; // not confident enough
          if (chosenIndex >= 0) log(`Fuzzy matched option ${chosenIndex + 1} (score=${bestScore.toFixed(2)})`);
        }
      }

      // ── Step 4: Click the correct option element ────────────────────────────
      if (chosenIndex >= 0 && chosenIndex < mcqData.clickTargets.length) {
        log(`Clicking option ${chosenIndex + 1}: "${mcqData.options[chosenIndex]}"`);
        showToast(`✔️ Selecting option ${chosenIndex + 1}`);
        const target = mcqData.clickTargets[chosenIndex];
        target.scrollIntoView({ behavior: 'smooth', block: 'center' });
        await sleep(400);
        target.click();
        
        // Ensure radio inputs are checked if we clicked a wrapper
        if (target.tagName !== 'INPUT') {
          const innerRadio = target.querySelector('input[type="radio"]');
          if (innerRadio) innerRadio.click();
        }
        
        // Also click parent container — many Examly wrappers need this
        const parent = target.parentElement;
        if (parent && parent !== document.body && parent.tagName !== 'BODY') {
          parent.click();
        }
      } else {
        // chosenIndex is -1 OR out of bounds — try a last-resort text search
        // inside the actual clickTarget elements using the AI's raw answer text
        let lastResortClicked = false;
        if (aiAnswer && mcqData.clickTargets.length > 0) {
          const needle = aiAnswer.replace(/\*/g, '').trim().toLowerCase().substring(0, 80);
          for (let ci = 0; ci < mcqData.clickTargets.length; ci++) {
            const elText = (mcqData.clickTargets[ci].innerText || '').toLowerCase();
            if (needle.length > 3 && elText.includes(needle.substring(0, Math.min(needle.length, 20)))) {
              log(`Last-resort text match at option ${ci + 1}`);
              mcqData.clickTargets[ci].click();
              lastResortClicked = true;
              break;
            }
          }
        }
        
        // Absolute last resort: if we know there are radio buttons and we failed to answer, 
        // DO NOT skip. Ask AI the raw text question and pick option 1 as a fallback so we don't freeze/skip.
        if (!lastResortClicked) {
          warn('AI gave no usable answer. Falling back to option 1 to avoid skipping.');
          showToast('⚠️ Could not parse AI answer — clicking Option 1 as fallback');
          if (mcqData.clickTargets[0]) {
             mcqData.clickTargets[0].click();
             const innerRadio = mcqData.clickTargets[0].querySelector('input[type="radio"]');
             if (innerRadio) innerRadio.click();
          } else {
             radioBtns[0]?.click();
          }
        }
      }

      await sleep(1500);

      const unattempted = document.querySelectorAll('[aria-labelledby="not-attempted"]');
      if (unattempted.length > 0) {
        log(`${unattempted.length} unattempted MCQs left. Clicking next…`);
        unattempted[0].click();
        await sleep(3000);
      } else {
        log('No unattempted MCQs. Submitting test…');
        await submitTest(submitBtn);
        testRunning = false;
        await sleep(5000);
        await closeTestInterface();
      }

    } else {
      // ========================
      //  CODING QUESTION (or loading)
      // ========================
      const isMonaco   = document.querySelector('.monaco-editor, app-monaco-editor');
      const isCodePage = document.querySelector('content-right') || document.body.innerText.includes('Compile & Run');

      if (!isMonaco && !isCodePage) {
        await sleep(3000);
        continue;
      }

      if (!doCoding) {
        log('Coding detected but coding mode disabled. Skipping.');
        const unattempted = document.querySelectorAll('[aria-labelledby="not-attempted"]');
        if (unattempted.length > 0) { unattempted[0].click(); await clickSkipPopupIfVisible(); }
        else { submitBtn.click(); testRunning = false; }
        await sleep(1000);
        continue;
      }

      // Whitelist/Blacklist questions — skip them
      const pageText = document.body.innerText.toLowerCase();
      if (pageText.includes('whitelist') || pageText.includes('blacklist') ||
          pageText.includes('whitelist syntaxes') || pageText.includes('blacklist syntaxes')) {
        window.examlyWhitelistSkips = (window.examlyWhitelistSkips || 0) + 1;
        log('Whitelist/Blacklist question — skipping');
        showToast('⏭ Whitelist/Blacklist question — skipping');
        const unattempted = document.querySelectorAll('[aria-labelledby="not-attempted"]');
        const allDone     = window.examlyWhitelistSkips >= Math.max(2, unattempted.length + 1);
        if (allDone) {
          await submitTest(submitBtn); testRunning = false;
          await sleep(5000); await closeTestInterface();
        } else if (unattempted.length > 0) {
          const idx = Math.floor(Math.random() * unattempted.length);
          unattempted[idx].click(); await clickSkipPopupIfVisible();
        } else {
          const nextBtn = Array.from(document.querySelectorAll('button')).find(b => b.innerText?.trim() === 'Next');
          if (nextBtn && !nextBtn.disabled) nextBtn.click();
        }
        continue;
      }

      window.examlyWhitelistSkips  = 0;
      window.examlySolvedIndices   = window.examlySolvedIndices || new Set();

      // ── Identify current question by its index in the sidebar ──────────────
      // Use ALL sidebar question items (attempted + unattempted) so the index
      // is stable even when the "not-attempted" count changes after submitting.
      const allSidebarItems = Array.from(
        document.querySelectorAll(
          '[aria-labelledby="not-attempted"], [aria-labelledby="attempted"], ' +
          '[aria-labelledby="current"], [class*="question-nav"], [class*="qn-nav"]'
        )
      );

      // Find which sidebar item is currently active / highlighted
      let currentQIdx = window.examlyQuestionIndex; // fallback: use counter
      const activeItem = allSidebarItems.find(el =>
        el.classList.contains('active') ||
        el.classList.contains('current') ||
        el.getAttribute('aria-current') === 'true' ||
        el.getAttribute('aria-selected') === 'true'
      );
      if (activeItem) {
        const foundIdx = allSidebarItems.indexOf(activeItem);
        if (foundIdx >= 0) currentQIdx = foundIdx;
      }

      // ── GUARD: skip if we already solved this question ─────────────────────
      if (window.examlySolvedIndices.has(currentQIdx)) {
        log(`Question index ${currentQIdx} already solved — forcing navigation to next.`);
        showToast(`⏭ Q${currentQIdx + 1} already done — going to next…`);
        const didNav = await navigateToNextCodingQuestion(submitBtn);
        if (!didNav) {
          // No next question → end of test
          log('No next question found. Submitting test.');
          await submitTest(submitBtn);
          testRunning = false;
          await sleep(5000);
          await closeTestInterface();
        }
        continue;
      }

      // ── Read the left pane ONCE, at the start of solving ──────────────────
      const leftPane = document.querySelector('content-left') ||
                       document.querySelector('.problem-statement, .description, .left-pane') ||
                       playground || document.body;

      log(`Coding question #${currentQIdx + 1} found. Solving with AI…`);
      showToast(`💻 Solving Q${currentQIdx + 1} with AI…`);

      const solved = await solveCodingQuestion(leftPane, submitBtn);

      // ✅ Mark this index as solved IMMEDIATELY (before any navigation)
      window.examlySolvedIndices.add(currentQIdx);
      window.examlyQuestionIndex = currentQIdx + 1; // advance counter

      log(`Q${currentQIdx + 1} ${solved ? 'PASSED ✅' : 'FAILED ❌ (submitted best attempt)'} — navigating to next question…`);
      showToast(solved ? `✅ Q${currentQIdx + 1} passed! Moving to next…` : `⚠️ Q${currentQIdx + 1} done (best attempt) — next…`);

      // ── Check if END modal appeared (last question submitted) ──────────────
      if (await handleEndModal()) {
        testRunning = false;
        await sleep(5000);
        await closeTestInterface();
        continue;
      }

      // ── Navigate to next question ──────────────────────────────────────────
      const didNav = await navigateToNextCodingQuestion(submitBtn);
      if (!didNav) {
        log('navigateToNextCodingQuestion: no next question — submitting test.');
        await submitTest(submitBtn);
        testRunning = false;
        await sleep(5000);
        await closeTestInterface();
      }
    }
  }

  clearInterval(warningDismisser);
}

// =================================================================
//  NAVIGATE TO NEXT CODING QUESTION
//  Returns true if navigation succeeded, false if no next question.
//  Waits to confirm the page actually changed before returning.
// =================================================================
async function navigateToNextCodingQuestion(submitBtn) {
  log('navigateToNextCodingQuestion: attempting to move to next question…');

  // Snapshot current page content so we can verify navigation happened
  const contentBefore = (document.querySelector('content-left, .problem-statement, .description, .left-pane, testtaking-playground')
    || document.body).innerText.substring(0, 300);

  for (let attempt = 0; attempt < 3; attempt++) {
    await sleep(1000);

    // ── Strategy A: click first unattempted question in sidebar ──────────────
    const unattempted = Array.from(document.querySelectorAll('[aria-labelledby="not-attempted"]'));
    if (unattempted.length > 0) {
      log(`Clicking unattempted[0] (${unattempted.length} remaining)…`);
      unattempted[0].click();
      await sleep(600);
      await clickSkipPopupIfVisible();
    } else {
      // ── Strategy B: click "Next" button ──────────────────────────────────
      const nextBtn = Array.from(document.querySelectorAll('button'))
        .find(b => b.innerText?.trim().toUpperCase() === 'NEXT' && !b.disabled && b.offsetParent !== null);
      if (nextBtn) {
        log('Clicking Next button…');
        nextBtn.click();
        await sleep(600);
        await clickSkipPopupIfVisible();
      } else {
        // No unattempted and no Next → test is done
        log('No unattempted questions and no Next button — test appears complete.');
        return false;
      }
    }

    // ── Wait up to 6 s for the page content to CHANGE ────────────────────────
    let navConfirmed = false;
    for (let w = 0; w < 12; w++) {
      await sleep(500);
      const contentNow = (document.querySelector('content-left, .problem-statement, .description, .left-pane, testtaking-playground')
        || document.body).innerText.substring(0, 300);
      if (contentNow !== contentBefore) {
        navConfirmed = true;
        log('✅ Navigation confirmed — new question content detected.');
        break;
      }
      // Also dismiss any popup that may have blocked navigation
      await clickSkipPopupIfVisible();
    }

    if (navConfirmed) return true;
    log(`Navigation attempt ${attempt + 1} did not change page — retrying…`);
  }

  // All attempts exhausted — could not confirm navigation
  warn('navigateToNextCodingQuestion: navigation could not be confirmed after 3 attempts.');
  return false;
}

// =================================================================
//  SOLVE A SINGLE CODING QUESTION  (with AI retry loop)
// =================================================================
const MAX_CODE_RETRIES = 1; // Single attempt — prompt is built to be correct first time

// Selectors for the output/result panel (checked in priority order)
const OUTPUT_SELECTORS = [
  'app-test-result',
  '.test-cases-section',
  '[class*="testcase-result"]',
  '[class*="test-result"]',
  '[class*="compile-result"]',
  '[class*="result-panel"]',
  '[class*="compiler-output"]',
  '[class*="run-output"]',
  '[class*="console-output"]',
  '[class*="output"]',
  '[class*="error-msg"]',
  '#output', '#result', '#console',
  '.output-panel', '.result-panel', '.console',
];

/** Grab the current text from the output panel (or '' if not found / empty). */
function getOutputPanelText() {
  for (const sel of OUTPUT_SELECTORS) {
    const el = document.querySelector(sel);
    if (el) {
      const t = el.innerText?.trim();
      if (t && t.length > 2) return t;
    }
  }
  return '';
}

async function solveCodingQuestion(leftPane, submitBtn) {
  // ── Wait briefly for the left pane to fully render ───────────────────────
  await sleep(1500);

  // ── Read full question text — don't truncate, AI needs every detail ──────
  const rawQuestion = readFullQuestionText(leftPane);
  const testCases   = readTestCases();
  const language    = detectLanguage();

  if (!rawQuestion || rawQuestion.trim().length < 30) {
    warn('Could not read coding question text.');
    return false;
  }

  // ── Build an enhanced question string that includes sample I/O inline ─────
  // This ensures the AI sees both the narrative AND the structured I/O even if
  // readTestCases() already extracted them — redundancy helps accuracy.
  let question = rawQuestion.trim();
  if (testCases.length > 0) {
    const alreadyHasSamples = /sample|example\s+input|input.*output/i.test(question);
    if (!alreadyHasSamples) {
      question += '\n\nSample Test Cases:\n';
      testCases.forEach((tc, i) => {
        question += `\nExample ${i + 1}:\nInput: ${tc.input}\nOutput: ${tc.output}\n`;
      });
    }
  }

  log('Question preview:', question.substring(0, 200));
  log('Language:', language, '| Test cases found:', testCases.length);

  showToast(`🤖 Generating ${language} solution with AI…`);

  // ── Step 1: Generate code via AI (single attempt, best-quality prompt) ───
  const result = await chrome.runtime.sendMessage({
    action: 'generateCode',
    question,
    language,
    testCases,
  }).catch(err => ({ success: false, error: err.message }));

  if (!result || !result.success) {
    showToast('❌ AI error: ' + (result?.error || 'Unknown error'));
    warn('AI error:', result?.error);
    return false;
  }

  const code = result.code;

  // Guard: AI returned empty or placeholder code
  if (!code || code.trim().length < 10) {
    warn('AI returned empty/too-short code.');
    showToast('⚠️ AI returned empty code — skipping.');
    return false;
  }

  log('Got code:', code.substring(0, 300));

  // ── Step 2: Paste code into editor ──────────────────────────────────────
  showToast('📋 Pasting code into editor…');
  const pasted = await pasteCodeIntoEditor(code);
  if (!pasted) {
    showToast('⚠️ Could not find code editor.');
    warn('pasteCodeIntoEditor returned false');
    // Try submitting directly as last resort
    const submitCodeBtn = Array.from(document.querySelectorAll('button')).find(btn =>
      btn.innerText && (btn.innerText.trim() === 'Submit Code' || btn.innerText.trim() === 'Submit')
    );
    if (submitCodeBtn && submitCodeBtn.offsetParent !== null) {
      submitCodeBtn.click();
      await sleep(2000);
      return true;
    }
    return false;
  }

  // Give the editor time to fully register the new content
  await sleep(500);

  // ── Step 3: Snapshot the output panel BEFORE clicking compile ───────────
  const outputBefore = getOutputPanelText();
  log('Output panel BEFORE compile:', outputBefore.substring(0, 80) || '(empty)');

  // ── Step 4: Click Compile / Run ─────────────────────────────────────────
  const compiled = clickCompileButton();
  if (!compiled) {
    showToast('⚠️ Compile button not found');
    warn('Compile button not found — submitting directly');
    const submitCodeBtn = Array.from(document.querySelectorAll('button')).find(btn =>
      btn.innerText && (btn.innerText.trim() === 'Submit Code' || btn.innerText.trim() === 'Submit')
    );
    if (submitCodeBtn && submitCodeBtn.offsetParent !== null) {
      submitCodeBtn.click();
      await sleep(2000);
      return true;
    }
    return false;
  }

  showToast('⏳ Running test cases…');
  log('Compile clicked. Waiting for output…');

  // ── Step 5: Wait for compile/run result ─────────────────────────────────
  const compResult = await waitForCompileResult(20000, outputBefore);

  if (compResult.success) {
    showToast('✅ All test cases passed!');
    log('Code PASSED ✅');

    // ── Step 6: Submit the coding question ──────────────────────────────
    await sleep(200);
    const submitCodeBtn = Array.from(document.querySelectorAll('button')).find(btn =>
      btn.innerText && (
        btn.innerText.trim() === 'Submit Code' ||
        btn.innerText.trim() === 'Submit'
      )
    );
    if (submitCodeBtn && submitCodeBtn.offsetParent !== null) {
      log('Clicking Submit Code…');
      submitCodeBtn.click();
      await sleep(3500);
    }
    return true;
  }

  // Test failed — log and submit best attempt anyway
  warn('Code failed test cases:', compResult.error?.substring(0, 200));
  showToast('⚠️ Test cases did not pass — submitting best attempt.');
  await sleep(200);

  const submitCodeBtn = Array.from(document.querySelectorAll('button')).find(btn =>
    btn.innerText && (btn.innerText.trim() === 'Submit Code' || btn.innerText.trim() === 'Submit')
  );
  if (submitCodeBtn && submitCodeBtn.offsetParent !== null) {
    submitCodeBtn.click();
    await sleep(2000);
  }
  return false;
}

// =================================================================
//  WAIT FOR COMPILE RESULT
//  outputBefore: the text that was in the panel BEFORE compile was clicked.
//  We only accept output that is DIFFERENT from the pre-compile state.
// =================================================================
async function waitForCompileResult(timeoutMs = 25000, outputBefore = '') {
  const start = Date.now();

  // ── Priority 1: "N/N test cases passed" smart check ──────────────────────
  // Examly often shows "3/3 test cases passed" (full pass) OR "2/5 test cases passed" (partial fail).
  // We MUST handle this before any regex pattern matching to avoid misclassification.
  function checkFractionResult(text) {
    // Match patterns like "3/3 test cases passed", "Test Cases: 3/3 Passed", "3 / 3 passed" etc.
    const fracMatch = text.match(/(\d+)\s*[\/of]\s*(\d+)\s*(?:test cases?|tests?)?\s*(?:passed|correct)/i)
      || text.match(/(?:passed|correct)\s*:\s*(\d+)\s*[\/of]\s*(\d+)/i)
      || text.match(/test cases?\s*[:\-]\s*(\d+)\s*[\/of]\s*(\d+)/i);
    if (fracMatch) {
      const passed = parseInt(fracMatch[1]);
      const total  = parseInt(fracMatch[2]);
      if (total > 0 && passed === total) return 'success';   // 3/3 → ✅ full pass
      if (total > 0 && passed < total)  return 'partial';   // 2/5 → ❌ partial fail
    }
    return null;
  }

  // ── Strict success patterns ───────────────────────────────────────────────
  // Only match text that unambiguously means ALL tests passed
  const successPats = [
    /all\s+(?:\d+\s+)?test cases?\s+passed/i,
    /all\s+tests?\s+passed/i,
    /compilation\s+successful/i,
    /compiled\s+successfully/i,
    /output\s+matched/i,
    /correct\s+answer/i,
    /\baccepted\b/i,
    /100\s*%\s+(?:test cases?\s+)?passed/i,
    /passed\s*:\s*all/i,
  ];

  // ── Error patterns (ONLY unambiguous failure text) ────────────────────────
  // DO NOT include /\bfailed\b/ or /error:/ — too broad, causes false negatives.
  const errorPats = [
    /compilation\s+error/i,
    /runtime\s+error/i,
    /time\s+limit\s+exceeded/i,
    /wrong\s+answer/i,
    /build\s+failed/i,
    /exception\s+in\s+thread/i,
    /segmentation\s+fault/i,
    /\bTLE\b/,
    /\bMLE\b/,
    /memory\s+limit\s+exceeded/i,
    /test\s+case\s+\d+.*failed/i,     // "Test case 2 failed" — specific
    /\d+\s+test\s+cases?\s+failed/i,  // "2 test cases failed"
  ];

  log(`waitForCompileResult: timeout=${timeoutMs}ms | baseline length=${outputBefore.length}`);

  while (Date.now() - start < timeoutMs) {
    await sleep(1000);

    const outputNow = getOutputPanelText();

    // Skip if output hasn't changed since before we compiled
    if (!outputNow || outputNow === outputBefore) {
      log('Output unchanged, still waiting…');
      continue;
    }

    log('Output changed! New output:', outputNow.substring(0, 150));

    // Check if output looks like a real compile result (not a navigation menu)
    const hasResultKeyword = [
      /test case/i, /compil/i, /output/i, /error/i, /exception/i,
      /passed/i, /failed/i, /accepted/i, /runtime/i, /wrong/i, /correct/i,
    ].some(p => p.test(outputNow));

    if (!hasResultKeyword) {
      log('Output changed but no compile-result keywords found — still waiting…');
      continue;
    }

    // ── Priority check: N/N fraction detection (most reliable signal) ────────
    const fracResult = checkFractionResult(outputNow);
    if (fracResult === 'success') {
      log('✅ SUCCESS via fraction check (all test cases passed)');
      return { success: true, output: outputNow };
    }
    if (fracResult === 'partial') {
      log('❌ PARTIAL FAIL via fraction check');
      return { success: false, error: outputNow.slice(0, 1500) };
    }

    // ── Pattern-based checks ─────────────────────────────────────────────────
    const isSuccess = successPats.some(p => p.test(outputNow));
    const isError   = errorPats.some(p => p.test(outputNow));

    if (isSuccess) {
      // Success wins even if an error pattern also matched (success is explicit)
      log('✅ SUCCESS detected via pattern match');
      return { success: true, output: outputNow };
    }
    if (isError) {
      log('❌ ERROR detected via pattern match');
      return { success: false, error: outputNow.slice(0, 1500) };
    }

    // Output changed but matches neither — wait 4 more seconds to see if it resolves,
    // then bail out rather than waiting for the full timeout.
    log('Output changed but result inconclusive — waiting 4s for stabilisation…');
    await sleep(4000);
    const outputStabilised = getOutputPanelText();
    const fracFinal = checkFractionResult(outputStabilised);
    if (fracFinal === 'success') {
      log('✅ SUCCESS via late fraction check');
      return { success: true, output: outputStabilised };
    }
    if (fracFinal === 'partial' || errorPats.some(p => p.test(outputStabilised))) {
      log('❌ FAILURE via late pattern check');
      return { success: false, error: outputStabilised.slice(0, 1500) };
    }
    if (successPats.some(p => p.test(outputStabilised))) {
      log('✅ SUCCESS via late success pattern');
      return { success: true, output: outputStabilised };
    }
    // Still inconclusive — treat as failure and let submit happen immediately
    log('⚠️ Output stable but inconclusive — treating as failure and submitting now.');
    return { success: false, error: outputStabilised.slice(0, 1500) };
  }

  // ── Timeout — return FAILURE so AI gets another attempt ──
  warn('waitForCompileResult timed out — treating as FAILURE so AI can retry');
  return {
    success: false,
    error: 'Compile/run timed out after ' + (timeoutMs / 1000) + 's — no result detected in output panel',
  };
}

// =================================================================
//  SUBMIT TEST  (handles "Type END" confirmation modal)
// =================================================================
async function submitTest(submitBtn) {
  log('Submitting test…');
  submitBtn.click();
  await sleep(2000);
  await handleEndModal();
}

async function handleEndModal() {
  const confirmInputs = Array.from(document.querySelectorAll('input[type="text"]'));
  const isEndModal    = confirmInputs.some(i => i.offsetParent !== null) &&
                        document.body.innerText.includes('END');
  if (!isEndModal) return false;

  log('END confirmation modal detected. Typing END…');
  for (const input of confirmInputs) {
    if (input.offsetParent !== null) {
      input.value = 'END';
      input.dispatchEvent(new Event('input',  { bubbles: true }));
      input.dispatchEvent(new Event('change', { bubbles: true }));
    }
  }
  await sleep(1000);

  const confirmBtn = Array.from(document.querySelectorAll('button'))
    .find(btn => btn.offsetParent !== null && btn.innerText?.trim().toUpperCase() === 'YES') ||
    document.querySelector('#confirm-submit, button.primary-btn-color:not(#tt-header-submit)');
  if (confirmBtn) confirmBtn.click();

  return true;
}

// =================================================================
//  CLOSE TEST INTERFACE  (Exit / Back to Course button)
// =================================================================
async function closeTestInterface() {
  log('Looking for Exit/Close button after test…');
  for (let i = 0; i < 8; i++) {
    const exitBtn = Array.from(document.querySelectorAll('button, a, div.t-cursor-pointer'))
      .find(el => {
        if (!el.innerText) return false;
        const t = el.innerText.trim().toUpperCase();
        return t.includes('EXIT FULLSCREEN') || t.includes('EXIT FULL SCREEN') ||
               t === 'EXIT' || t === 'CLOSE' || t.includes('GO BACK') ||
               t.includes('BACK TO COURSE');
      });
    if (exitBtn && exitBtn.offsetParent !== null) {
      log('Clicking Exit button…');
      exitBtn.click();
      await sleep(3000);
      return;
    }
    await sleep(1000);
  }
}

// =================================================================
//  CLICK SKIP POPUP  (when navigating away from unsaved coding question)
// =================================================================
async function clickSkipPopupIfVisible() {
  for (let i = 0; i < 6; i++) {
    await sleep(500);
    const skipBtn = Array.from(document.querySelectorAll('button, a, div.t-cursor-pointer'))
      .find(el => {
        if (!el.innerText || el.offsetParent === null) return false;
        const t = el.innerText.trim().toUpperCase();
        return t === 'SKIP' || t === 'SKIP & LEAVE' || t === 'SKIP AND LEAVE' ||
               t === 'LEAVE' || t === 'LEAVE PAGE' || t.startsWith('SKIP');
      });
    if (skipBtn) { log('Skip popup found. Clicking Skip.'); skipBtn.click(); await sleep(1000); return true; }
  }
  return false;
}

// =================================================================
//  READ MCQ DATA
//  Returns { question: string, options: string[], clickTargets: Element[] }
//  5-strategy option detection — searches progressively wider scopes
// =================================================================
function readMCQData(playground) {
  // Search both the playground element AND the full body — whichever gives more options
  function findOptions(scope) {
    if (!scope) return [];

    // S1: Examly-specific class names (most reliable)
    const s1 = Array.from(scope.querySelectorAll(
      '.option-container, .options-container > *, ' +
      '[class*="option-item"], [class*="answer-option"], [class*="choice-item"], ' +
      '[class*="mcq-option"], [class*="option-wrapper"], [class*="opt-item"], ' +
      '[class*="option-box"], [class*="answer-box"], [class*="option-card"], ' +
      '.choice, .answer-choice, .option'
    )).filter(el => el.offsetParent !== null && el.innerText?.trim().length > 0);
    if (s1.length >= 2) return s1;

    // S2: ARIA radio roles  
    const s2 = Array.from(scope.querySelectorAll('[role="radio"], [role="option"], mat-radio-button, .mat-radio-button'))
      .filter(el => el.offsetParent !== null && el.innerText?.trim().length > 0);
    if (s2.length >= 2) return s2;

    // S3: Labels associated with radio inputs
    const radios = Array.from(scope.querySelectorAll('input[type="radio"]'))
      .filter(el => el.offsetParent !== null);
    if (radios.length >= 2) {
      return radios.map(input => {
        if (input.id) {
          const lbl = document.querySelector(`label[for="${input.id}"]`);
          if (lbl && lbl.innerText?.trim()) return lbl;
        }
        const parentLabel = input.closest('label');
        if (parentLabel && parentLabel.innerText?.trim()) return parentLabel;
        // Try next sibling span/div for the label text
        let sib = input.nextElementSibling;
        while (sib) {
          if (sib.innerText?.trim()) return sib;
          sib = sib.nextElementSibling;
        }
        return input.parentElement || input;
      });
    }

    // S4: List items (ol/ul) that look like answer choices
    const s4 = Array.from(scope.querySelectorAll('ul > li, ol > li'))
      .filter(el => el.offsetParent !== null && el.innerText?.trim().length > 0
               && el.innerText.trim().length < 500); // not a description list
    if (s4.length >= 2 && s4.length <= 8) return s4; // MCQs rarely have >8 options

    // S5: Any clickable div/span rows that contain text and look like options
    // Look for sibling elements that share the same parent and have similar structure
    const s5 = Array.from(scope.querySelectorAll('div, span, p'))
      .filter(el => {
        if (!el.offsetParent) return false;
        const t = el.innerText?.trim();
        if (!t || t.length < 1 || t.length > 300) return false;
        if (el.children.length > 5) return false; // too complex
        // Must have siblings with same tag that also have text
        const parent = el.parentElement;
        if (!parent) return false;
        const siblings = Array.from(parent.children).filter(
          s => s.tagName === el.tagName && s.innerText?.trim().length > 0
        );
        return siblings.length >= 2 && siblings.length <= 6;
      });
    // Group by parent, pick the group with 2-6 similar children
    if (s5.length >= 2) return s5;

    // S6: Hard fallback to the basic MCQ detection selectors
    const s6 = Array.from(scope.querySelectorAll('input[type="radio"], [role="radio"]'))
      .filter(el => el.offsetParent !== null);
    if (s6.length >= 2) return s6;

    return [];
  }

  // Try playground first, then body-wide
  let rawTargets = playground ? findOptions(playground) : [];
  if (rawTargets.length < 2) rawTargets = findOptions(document.body);

  // Deduplicate: remove elements that are ancestors of another found element
  const deduped = rawTargets.filter(el =>
    !rawTargets.some(other => other !== el && el.contains(other))
  );
  const clickTargets = deduped.length >= 2 ? deduped : rawTargets;

  // Extract and clean option texts
  let optionTexts = clickTargets.map(el => {
    let t = '';
    if (el.tagName === 'INPUT') {
      if (el.id) {
        const lbl = document.querySelector(`label[for="${el.id}"]`);
        if (lbl) t = lbl.innerText;
      }
      if (!t && el.parentElement) t = el.parentElement.innerText;
      if (!t) {
        let sib = el.nextElementSibling;
        while (sib && !t) { t = sib.innerText; sib = sib.nextElementSibling; }
      }
    } else {
      t = el.innerText;
    }
    t = (t || '').trim();
    // Strip leading A. B. (1) 1. etc.
    return t.replace(/^\(?[A-Ea-e1-5][.\)]\)?\s*/, '').trim();
  });

  // If text extraction completely failed, give them placeholder numbers so the array length matches
  optionTexts = optionTexts.map((t, i) => t || `[Option ${i + 1} text hidden]`);

  // ── Extract question text ─────────────────────────────────────────────────
  const root = playground || document.body;
  let questionText = '';

  const qSelectors = [
    '[class*="question-text"]', '[class*="question-body"]', '[class*="question-stem"]',
    '[class*="question-content"]', '[class*="question-description"]',
    '[class*="question-title"]', '[class*="qstn"]', '[class*="q-text"]',
    '.question', '.stem', 'p.question',
    // Angular component tags Examly uses
    'question-text', 'question-content',
  ];
  for (const sel of qSelectors) {
    const el = root.querySelector(sel) || document.querySelector(sel);
    if (el && el.offsetParent !== null) {
      const t = el.innerText?.trim();
      if (t && t.length > 10) { questionText = t; break; }
    }
  }

  // Fallback: from full text, take everything before the first option
  if (!questionText) {
    const fullText = (root.innerText || document.body.innerText || '').trim();
    const firstOptIdx = optionTexts
      .map(opt => opt && fullText.indexOf(opt))
      .filter(i => typeof i === 'number' && i > 5)
      .sort((a, b) => a - b)[0];
    if (firstOptIdx > 10) {
      questionText = fullText.substring(0, firstOptIdx).trim();
    } else {
      // Last resort: just use up to 800 chars of the page
      questionText = fullText.replace(/[\t ]{2,}/g, ' ').substring(0, 800).trim();
    }
  }

  log(`readMCQData: found ${clickTargets.length} option elements`);
  return { question: questionText, options: optionTexts, clickTargets };
}

// =================================================================
//  ASK GEMINI  (MCQ answers from background.js)
// =================================================================
async function askGemini(prompt) {
  const result = await chrome.runtime.sendMessage({ action: 'askGemini', prompt })
    .catch(err => ({ success: false, error: err.message }));
  if (result && result.success) return result.answer;
  warn('askGemini error:', result?.error);
  return null;
}

// =================================================================
//  READ FULL QUESTION TEXT  (for single-attempt AI solving)
//  Collects every visible detail: problem body, constraints, I/O format,
//  sample cases — NO truncation so the AI sees the full specification.
// =================================================================
function readFullQuestionText(leftPane) {
  // Priority 1: use leftPane element if supplied (most reliable)
  if (leftPane) {
    const text = leftPane.innerText?.trim();
    if (text && text.length > 30) return text;
  }

  // Priority 2: dedicated problem-statement selectors
  const selectors = [
    'content-left',
    '.problem-statement', '.problem-description', '.question-description',
    '.coding-question-body', '.coding-problem', '.question-body', '.statement-body',
    '[class*="problem-statement"]', '[class*="question-description"]',
    '[class*="problem-desc"]', '[class*="coding-question"]',
    '[class*="task-description"]', '[class*="question-text"]',
    '#problem-description', '#question-body', '#problem-statement',
    '.statement', '.task-description',
    '[data-testid="problem-statement"]',
    'testtaking-playground',
  ];

  for (const sel of selectors) {
    const el = document.querySelector(sel);
    if (el) {
      const text = el.innerText?.trim();
      if (text && text.length > 30) return text;
    }
  }

  // Priority 3: largest block that looks like a coding problem
  const blocks = [...document.querySelectorAll('div, section, article')]
    .filter(el => {
      const t = (el.innerText || '').trim();
      return t.length > 80 && t.length < 50000 &&
             !el.querySelector('input[type="text"], button, select') &&
             getComputedStyle(el).display !== 'none';
    })
    .sort((a, b) => b.innerText.length - a.innerText.length);

  for (const block of blocks) {
    const t = block.innerText.trim();
    if (/input|output|example|constraint|return|function/i.test(t)) return t;
  }
  return blocks[0]?.innerText.trim() ?? '';
}

// =================================================================
//  READ QUESTION TEXT
// =================================================================
function readQuestionText() {
  const selectors = [
    '.problem-statement', '.problem-description', '.question-description',
    '.coding-question-body', '.coding-problem', '.question-body', '.statement-body',
    '[class*="problem-statement"]', '[class*="question-description"]',
    '[class*="problem-desc"]', '[class*="coding-question"]',
    '[class*="task-description"]', '[class*="question-text"]',
    '#problem-description', '#question-body', '#problem-statement',
    '.statement', '.task-description',
    '[data-testid="problem-statement"]',
    'content-left',
  ];

  for (const sel of selectors) {
    const el = document.querySelector(sel);
    if (el) {
      const text = el.innerText?.trim();
      if (text && text.length > 30) return text;
    }
  }

  // Fallback: largest text block that looks like a problem
  const blocks = [...document.querySelectorAll('div, section, article')]
    .filter(el => {
      const t = (el.innerText || '').trim();
      return t.length > 80 && t.length < 10000 &&
             !el.querySelector('input[type="text"], button, select') &&
             getComputedStyle(el).display !== 'none';
    })
    .sort((a, b) => b.innerText.length - a.innerText.length);

  for (const block of blocks) {
    const t = block.innerText.trim();
    if (/input|output|example|constraint|return|function/i.test(t)) return t;
  }
  return blocks[0]?.innerText.trim() ?? null;
}

// =================================================================
//  READ TEST CASES
// =================================================================
function readTestCases() {
  const cases = [];

  // Strategy 1: Paired input/output containers
  const inputEls  = document.querySelectorAll('[class*="sample-input"],[class*="input-box"],[class*="test-input"],[class*="input-data"]');
  const outputEls = document.querySelectorAll('[class*="sample-output"],[class*="output-box"],[class*="test-output"],[class*="output-data"]');
  const pairCount = Math.min(inputEls.length, outputEls.length);
  for (let i = 0; i < pairCount; i++) {
    const inp = inputEls[i]?.innerText?.trim();
    const out = outputEls[i]?.innerText?.trim();
    if (inp && out) cases.push({ input: inp, output: out });
  }

  // Strategy 2: <pre> blocks
  if (cases.length === 0) {
    const pres = [...document.querySelectorAll('pre')].map(p => p.innerText.trim()).filter(Boolean);
    for (let i = 0; i + 1 < pres.length; i += 2) {
      cases.push({ input: pres[i], output: pres[i + 1] });
    }
  }

  // Strategy 3: Table rows
  if (cases.length === 0) {
    document.querySelectorAll('table tr').forEach(row => {
      const cells = [...row.querySelectorAll('td,th')].map(c => c.innerText.trim());
      if (cells.length >= 2 && cells[0] && cells[1]) {
        cases.push({ input: cells[0], output: cells[1] });
      }
    });
  }

  return cases;
}

// =================================================================
//  DETECT LANGUAGE
// =================================================================
function detectLanguage() {
  const dropdowns = [
    'select[name*="lang"]', 'select[id*="lang"]', 'select[class*="lang"]',
    '.language-selector select', '.lang-select select', '[class*="language"] select',
    '#language-selector', '#lang-select', 'select',
  ];
  for (const sel of dropdowns) {
    const el = document.querySelector(sel);
    if (el && el.value) return el.value.toLowerCase();
  }

  const langAttr = document.querySelector('[data-language]');
  if (langAttr) return langAttr.dataset.language.toLowerCase();

  const activeTab = document.querySelector(
    '.lang-tab.active, .language-tab.active, [class*="lang"][class*="active"]'
  );
  if (activeTab) return activeTab.innerText.trim().toLowerCase();

  const body = document.body.innerText.toLowerCase();
  if (/\bjavascript\b|\bnode\.?js\b/.test(body)) return 'javascript';
  if (/\bjava\b/.test(body))                      return 'java';
  if (/\bpython\b/.test(body))                    return 'python';
  if (/\bc\+\+\b|cpp/.test(body))                return 'cpp';
  if (/\bc\b/.test(body))                         return 'c';

  return 'java'; // safe default
}

// =================================================================
//  PASTE CODE INTO EDITOR
// =================================================================
async function pasteCodeIntoEditor(code) {
  await sleep(300);

  // CodeMirror 5
  const cm5 = document.querySelector('.CodeMirror');
  if (cm5 && cm5.CodeMirror) {
    cm5.CodeMirror.setValue(code);
    cm5.CodeMirror.focus();
    log('Pasted via CodeMirror 5');
    return true;
  }

  // CodeMirror 6
  const cm6 = findCM6View();
  if (cm6) {
    cm6.dispatch({ changes: { from: 0, to: cm6.state.doc.length, insert: code } });
    log('Pasted via CodeMirror 6');
    return true;
  }

  // ── Strategy 3: Monaco via DOM bridge ─────────────────────────────────────
  //
  //  WHY: Content scripts run in an "isolated world" — window.monaco is ONLY
  //  accessible in the page's main world. Direct access from content script
  //  always returns undefined. Injected <script> tags run in the page world
  //  but can't read content-script variables either.
  //
  //  FIX: Use a hidden DOM element (accessible from BOTH worlds) as a bridge:
  //    content script writes code → DOM element textContent
  //    injected script reads it  → sets Monaco value → writes result back
  //    content script reads result ← verifies success
  // ──────────────────────────────────────────────────────────────────────────
  const bridgeId = '__examly_code_bridge__';

  // Clean up any leftover bridge
  document.getElementById(bridgeId)?.remove();

  const bridge = document.createElement('div');
  bridge.id    = bridgeId;
  bridge.style.cssText = 'display:none !important; position:absolute; left:-9999px;';
  bridge.textContent = code;   // ← textContent is safe: no escaping needed, handles all chars
  bridge.setAttribute('data-result', 'pending');
  document.body.appendChild(bridge);

  const injected = document.createElement('script');
  injected.textContent = `
(function() {
  var bridge = document.getElementById('${bridgeId}');
  if (!bridge) return;
  var code = bridge.textContent;

  function setResult(r) { bridge.setAttribute('data-result', r); }

  // Try Monaco
  try {
    if (window.monaco && window.monaco.editor) {
      var editors = window.monaco.editor.getEditors();
      if (editors.length > 0) {
        editors[0].setValue(code);
        setResult('monaco_editor_ok');
        return;
      }
      var models = window.monaco.editor.getModels();
      if (models.length > 0) {
        models[0].setValue(code);
        setResult('monaco_model_ok');
        return;
      }
      setResult('monaco_no_instance');
    } else {
      setResult('monaco_not_found');
    }
  } catch(e) {
    setResult('monaco_err:' + e.message);
  }
})();
  `.trim();

  (document.head || document.documentElement).appendChild(injected);
  injected.remove();

  // Wait for the injected script to run and write its result
  await sleep(800);

  const monacoResult = bridge.getAttribute('data-result');
  bridge.remove();

  log('Monaco bridge result:', monacoResult);

  if (monacoResult && (monacoResult.endsWith('_ok'))) {
    log('✅ Pasted via Monaco (' + monacoResult + ')');
    return true;
  }

  // Monaco not found or failed — log and fall through to other strategies
  if (monacoResult && monacoResult !== 'pending') {
    warn('Monaco paste failed:', monacoResult, '— trying other editors…');
  }

  // ── Strategy 4: Ace Editor ────────────────────────────────────────────────
  if (window.ace) {
    try {
      const aceEl = document.querySelector('[class*="ace_editor"], .ace_editor');
      if (aceEl) {
        const aceEditor = window.ace.edit(aceEl);
        aceEditor.setValue(code, -1);
        log('✅ Pasted via Ace Editor');
        return true;
      }
    } catch (e) { warn('Ace error:', e.message); }
  }

  // ── Strategy 5: React-controlled textarea ────────────────────────────────
  const textareaSelectors = [
    'textarea[class*="editor"]',
    'textarea[class*="code"]',
    'textarea[id*="editor"]',
    'textarea[id*="code"]',
    'textarea[placeholder*="code"]',
    'textarea[placeholder*="Code"]',
    '.editor-container textarea',
    '.code-editor textarea',
    'textarea',
  ];
  for (const sel of textareaSelectors) {
    const el = document.querySelector(sel);
    if (el) {
      try {
        // Use React's native input value setter so React state updates
        const setter = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value')?.set;
        if (setter) setter.call(el, code);
        else el.value = code;
        el.dispatchEvent(new Event('input',  { bubbles: true }));
        el.dispatchEvent(new Event('change', { bubbles: true }));
        el.dispatchEvent(new KeyboardEvent('keydown', { bubbles: true, key: 'a', ctrlKey: true }));
        log('✅ Pasted via textarea:', sel);
        return true;
      } catch (e) { warn('Textarea error:', e.message); }
    }
  }

  // ── Strategy 6: contenteditable div ──────────────────────────────────────
  for (const sel of [
    '[contenteditable="true"][class*="editor"]',
    '[contenteditable="true"][class*="code"]',
    '[contenteditable="true"]',
  ]) {
    const el = document.querySelector(sel);
    if (el) {
      try {
        el.focus();
        document.execCommand('selectAll', false, null);
        document.execCommand('insertText', false, code);
        log('✅ Pasted via contenteditable:', sel);
        return true;
      } catch (e) { warn('contenteditable error:', e.message); }
    }
  }

  warn('❌ All paste strategies failed — no code editor found on this page');
  return false;
}

function findCM6View() {
  const candidates = document.querySelectorAll('[class*="cm-editor"],[class*="codemirror"]');
  for (const el of candidates) {
    for (const key of Object.getOwnPropertySymbols(el)) {
      const val = el[key];
      if (val && typeof val.dispatch === 'function' && val.state?.doc) return val;
    }
  }
  return null;
}

// =================================================================
//  CLICK COMPILE / RUN BUTTON
// =================================================================
function clickCompileButton() {
  const keywords = ['compile', 'run', 'run code', 'execute', 'check', 'test code', 'compile & run', 'run & check'];
  const allBtns  = [...document.querySelectorAll('button, [role="button"], input[type="button"], input[type="submit"]')];

  for (const btn of allBtns) {
    const txt = (btn.innerText || btn.value || btn.getAttribute('aria-label') || '').trim().toLowerCase();
    if (keywords.some(kw => txt === kw || txt.startsWith(kw))) {
      btn.click();
      log('Clicked compile:', btn.innerText || btn.value);
      return true;
    }
  }

  const fallbacks = [
    '#compile-btn', '#run-btn', '#execute-btn',
    '.compile-button', '.run-button', '.execute-button',
    '[class*="compile"]', '[class*="run-code"]', '[class*="execute"]',
    '[id*="compile"]', '[id*="run-btn"]',
  ];
  for (const sel of fallbacks) {
    const el = document.querySelector(sel);
    if (el) { el.click(); log('Clicked compile via selector:', sel); return true; }
  }

  warn('Compile button not found');
  return false;
}

// =================================================================
//  FIND BUTTON BY TEXT
// =================================================================
function findButtonByText(keywords) {
  const all = [...document.querySelectorAll(
    'button, [role="button"], a.btn, input[type="button"], input[type="submit"], [class*="btn"], [class*="button"]'
  )];
  for (const btn of all) {
    const txt = (btn.innerText || btn.value || btn.getAttribute('aria-label') || '').trim().toLowerCase();
    if (keywords.some(kw => txt.includes(kw.toLowerCase()))) return btn;
  }
  return null;
}

// =================================================================
//  TOAST NOTIFICATION
// =================================================================
function showToast(message) {
  const existing = document.getElementById('examly-ai-toast');
  if (existing) existing.remove();

  const toast = document.createElement('div');
  toast.id = 'examly-ai-toast';
  toast.innerText = message;
  toast.style.cssText = `
    position: fixed;
    bottom: 24px;
    right: 24px;
    z-index: 999999;
    background: #1a1a2e;
    color: #00ff88;
    border: 1px solid #00ff88;
    border-radius: 10px;
    padding: 12px 20px;
    font-family: monospace;
    font-size: 14px;
    font-weight: bold;
    box-shadow: 0 4px 20px rgba(0,255,136,0.3);
    max-width: 340px;
    word-wrap: break-word;
    white-space: pre-line;
    transition: opacity 0.4s;
    line-height: 1.5;
  `;
  document.body.appendChild(toast);
  setTimeout(() => {
    toast.style.opacity = '0';
    setTimeout(() => toast.remove(), 400);
  }, 5000);
}
