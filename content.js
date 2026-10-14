(() => {
  'use strict';

  // Do not act inside a frame, on the chat page, or on other websites.
  if (window.top !== window) return;
  const onJobs = /^\/web\/geek\/jobs?\/?$/.test(location.pathname);
  const onDetail = /^\/job_detail\/[^/]+\.html$/.test(location.pathname);
  if (!onJobs && !onDetail) return;

  let enabled = true;
  let handoffTab = false;
  let opening = false;
  chrome.storage.local.get({ enabled: true }, obj => { enabled = obj.enabled !== false; });
  chrome.storage.onChanged.addListener((changes, area) => {
    if (area === 'local' && changes.enabled) enabled = changes.enabled.newValue !== false;
  });

  function validatedJobUrl(href) {
    try {
      const url = new URL(href, location.href);
      if (url.protocol !== 'https:' || url.hostname !== 'www.zhipin.com') return null;
      return /^\/job_detail\/[^/?#]+\.html$/.test(url.pathname) ? url.href : null;
    } catch { return null; }
  }

  function jobUrlWithin(element) {
    if (!element) return null;
    const anchors = element.matches && element.matches('a[href*="/job_detail/"]')
      ? [element]
      : element.querySelectorAll('a[href*="/job_detail/"]');
    for (const a of anchors) {
      const href = validatedJobUrl(a.getAttribute('href'));
      if (href) return href;
    }
    return null;
  }

  function visible(element) {
    if (!element || !element.isConnected) return false;
    const style = getComputedStyle(element);
    return style.display !== 'none' && style.visibility !== 'hidden' && element.getClientRects().length > 0;
  }

  function findOriginalButton() {
    const candidates = document.querySelectorAll(
      'a.btn-startchat, a.op-btn-chat, a.btn-chat, button.btn-startchat, .btn-startchat, .op-btn-chat, .job-detail-box a, .job-detail-box button, .job-banner a'
    );
    for (const el of candidates) {
      if (visible(el) && /立即沟通/.test(el.textContent.trim())) return el;
    }
    // Some BOSS versions use another CSS class. Only match real buttons/links.
    for (const el of document.querySelectorAll('a, button, [role="button"]')) {
      if (visible(el) && el.textContent.trim() === '立即沟通') return el;
    }
    return null;
  }

  function selectedCard() {
    // Accommodate several layouts observed in public BOSS extension implementations.
    const selector = '.job-card-wrap, .job-card-wrapper, .job-card-box, .job-card-item, .job-list-item, .card-area';
    const cards = [...document.querySelectorAll(selector)].filter(card =>
      !card.parentElement?.closest(selector) && !!jobUrlWithin(card)
    );
    if (cards.length === 0) return null;

    const active = cards.filter(card => {
      const cls = typeof card.className === 'string' ? card.className : '';
      const activeTag = /(^|[\s_-])(active|selected|current|cur)([\s_-]|$)/i;
      if (activeTag.test(cls) || card.getAttribute('aria-selected') === 'true' ||
          card.dataset.selected === 'true') return true;
      // Some layouts put the active marker on a nested job link instead.
      const link = card.querySelector('a[href*="/job_detail/"]');
      return !!link && (activeTag.test(link.className || '') || link.getAttribute('aria-current') === 'true');
    });
    if (active.length === 1) return active[0];

    // BOSS often outlines the selected left-hand card with a turquoise border.
    // Count only unambiguous highlighted cards; never choose the first job blindly.
    const outlined = cards.filter(card => {
      const st = getComputedStyle(card);
      const width = parseFloat(st.borderTopWidth) || 0;
      const color = st.borderTopColor.match(/\d+(?:\.\d+)?/g);
      if (width < 1 || !color || color.length < 3) return false;
      const [r, g, b] = color.map(Number);
      return g > 125 && b > 100 && r < 110 && g > r + 45;
    });
    if (outlined.length === 1) return outlined[0];
    return null;
  }

  function jobUrlFromSelectedJob() {
    if (onDetail) return validatedJobUrl(location.href);

    // Preferred: "查看更多职位信息" in the visible right-hand detail panel.
    const rightPanels = document.querySelectorAll(
      '.job-detail-box, .job-detail-container, .job-detail-info, .job-detail-section'
    );
    for (const panel of rightPanels) {
      if (!visible(panel)) continue;
      const direct = panel.querySelector('a.more-job-btn[href*="/job_detail/"]');
      if (direct) {
        const url = validatedJobUrl(direct.getAttribute('href'));
        if (url) return url;
      }
    }

    // Preferred fallback: BOSS's selected job card on the left.
    const selected = selectedCard();
    if (selected) return jobUrlWithin(selected);

    // Another page variant shows a single "查看更多信息" link.
    const moreLinks = [...document.querySelectorAll('a.more-job-btn[href*="/job_detail/"]')]
      .filter(visible).map(a => validatedJobUrl(a.getAttribute('href'))).filter(Boolean);
    if (moreLinks.length === 1) return moreLinks[0];

    // If the page contains only one job detail link, it is unambiguous.
    const urls = new Set([...document.querySelectorAll('a[href*="/job_detail/"]')]
      .map(a => validatedJobUrl(a.getAttribute('href'))).filter(Boolean));
    return urls.size === 1 ? [...urls][0] : null;
  }

  function showHint(message, timeout = 5500) {
    if (!document.body) return;
    const old = document.getElementById('boss-new-tab-hint');
    if (old) old.remove();
    const host = document.createElement('div');
    host.id = 'boss-new-tab-hint';
    host.textContent = message;
    Object.assign(host.style, {
      position: 'fixed', bottom: '24px', right: '24px', zIndex: '2147483647',
      background: '#17333a', color: '#fff', padding: '13px 17px',
      borderRadius: '10px', boxShadow: '0 5px 26px #0003',
      font: '14px/1.6 system-ui, sans-serif', maxWidth: '355px',
      whiteSpace: 'pre-wrap', pointerEvents: 'none'
    });
    document.body.appendChild(host);
    setTimeout(() => { if (host.isConnected) host.remove(); }, timeout);
  }

  function findChatTarget(event) {
    const target = event.target;
    if (!(target instanceof Element)) return null;
    const btn = target.closest('a,button,[role="button"]');
    if (!btn || !visible(btn)) return null;
    const text = (btn.textContent || '').replace(/\s+/g, '').trim();
    return text === '立即沟通' ? btn : null;
  }

  // Listener registered early to catch user clicks. It only prevents the
  // original navigation when an unambiguous job URL is available.
  function handleClick(event) {
    if (!enabled || handoffTab || !event.isTrusted || event.button !== 0 || opening) return;
    if (!findChatTarget(event)) return;
    const jobUrl = jobUrlFromSelectedJob();
    if (!jobUrl) {
      // Never open a guessed job: a wrong recruiter is worse than normal behavior.
      // Preserve the site's original click when the selected job is unknown.
      return;
    }
    event.preventDefault();
    event.stopImmediatePropagation();
    event.stopPropagation();
    opening = true;
    chrome.runtime.sendMessage({ type: 'OPEN_JOB_TAB', jobUrl }, response => {
      opening = false;
      if (chrome.runtime.lastError || !response?.ok) {
        showHint('新标签页打开失败。请检查插件权限，或暂时关闭插件后重试。');
      }
    });
  }
  window.addEventListener('click', handleClick, true);

  // Handoff: only an explicitly created job-detail tab can auto-trigger the
  // original BOSS button, only once. No form input, typing, or messages.
  if (onDetail) {
    (async () => {
      let claimed = false;
      for (let n = 0; n < 16; n++) {
        try {
          const reply = await chrome.runtime.sendMessage({ type: 'CLAIM_JOB_TAB' });
          if (reply?.ok) { claimed = true; break; }
        } catch (_) { /* service worker may still be starting */ }
        await new Promise(resolve => setTimeout(resolve, 300));
      }
      if (!claimed) return;
      handoffTab = true;
      const deadline = Date.now() + 25000;
      while (Date.now() < deadline) {
        if (!/^\/job_detail\/[^/]+\.html$/.test(location.pathname)) return;
        const button = findOriginalButton();
        if (button) {
          // Wait briefly for the page framework to finish hydrating.
          await new Promise(resolve => setTimeout(resolve, 700));
          if (!button.isConnected || !visible(button)) continue;
          button.click();
          // A JS-generated click is not a trusted mouse gesture. If BOSS
          // ignores it, the page remains open for a manual click.
          setTimeout(() => {
            if (location.pathname.startsWith('/job_detail/') && findOriginalButton()) {
              showHint('已尝试打开聊天。若没有跳转，请手动点击页面中的「立即沟通」。', 9000);
            }
          }, 5500);
          return;
        }
        await new Promise(resolve => setTimeout(resolve, 300));
      }
      showHint('没有找到「立即沟通」按钮。请在当前新标签页中手动操作。', 9000);
    })();
  }
})();
