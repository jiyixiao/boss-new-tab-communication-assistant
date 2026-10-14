'use strict';

// Only job-detail URLs hosted by BOSS may be opened. No web scraping, chat APIs,
// login tokens, or outgoing requests are used by this extension.
function normalizedJobUrl(raw) {
  try {
    const url = new URL(raw);
    if (url.protocol !== 'https:' || url.hostname !== 'www.zhipin.com') return null;
    if (!/^\/job_detail\/[^/?#]+\.html$/.test(url.pathname)) return null;
    return url.href;
  } catch {
    return null;
  }
}

function validSource(sender) {
  if (!sender.tab || typeof sender.tab.id !== 'number') return false;
  try {
    const url = new URL(sender.url || sender.tab.url);
    return url.hostname === 'www.zhipin.com' && url.protocol === 'https:' &&
      (/^\/web\/geek\/jobs?\/?$/.test(url.pathname) || /^\/job_detail\/[^/]+\.html$/.test(url.pathname));
  } catch {
    return false;
  }
}

function sendReply(sendResponse, value) {
  try { sendResponse(value); } catch (_) { /* caller navigated away */ }
}

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (!message || typeof message.type !== 'string') return false;

  if (message.type === 'OPEN_JOB_TAB') {
    (async () => {
      if (!validSource(sender)) throw new Error('仅支持 BOSS 求职端岗位页面');
      const jobUrl = normalizedJobUrl(message.jobUrl);
      if (!jobUrl) throw new Error('无法验证当前岗位链接，已停止跳转');

      const opener = sender.tab;
      // The new tab is active, exactly as requested. The original tab is untouched.
      const tab = await chrome.tabs.create({
        url: jobUrl,
        active: true,
        openerTabId: opener.id,
        index: opener.index + 1
      });
      if (typeof tab.id !== 'number') throw new Error('新建标签页失败');
      const recordKey = `pending_${tab.id}`;
      await chrome.storage.session.set({
        [recordKey]: {
          url: jobUrl,
          createdAt: Date.now(),
          claimed: false
        }
      });
      return { ok: true };
    })().then(result => sendReply(sendResponse, result))
      .catch(error => sendReply(sendResponse, { ok: false, error: error.message }));
    return true;
  }

  if (message.type === 'CLAIM_JOB_TAB') {
    (async () => {
      if (!validSource(sender) || !sender.tab) return { ok: false };
      const key = `pending_${sender.tab.id}`;
      const object = await chrome.storage.session.get(key);
      const pending = object[key];
      if (!pending || pending.claimed || Date.now() - pending.createdAt > 120000) {
        return { ok: false };
      }
      const actual = normalizedJobUrl(sender.url || sender.tab.url);
      if (!actual || actual !== pending.url) return { ok: false };
      // The pending record can be consumed only once, preventing repeat clicks
      // after refresh and limiting automation to a tab created by the user action.
      await chrome.storage.session.remove(key);
      return { ok: true };
    })().then(result => sendReply(sendResponse, result))
      .catch(() => sendReply(sendResponse, { ok: false }));
    return true;
  }
  return false;
});

chrome.tabs.onRemoved.addListener(tabId => {
  chrome.storage.session.remove(`pending_${tabId}`).catch(() => {});
});
