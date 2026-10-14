'use strict';
const toggle = document.getElementById('toggle');
const state = document.getElementById('state');
const pageStatus = document.getElementById('pageStatus');
function render(enabled) {
  toggle.checked = enabled;
  state.textContent = enabled ? '已开启：点击后自动切换到新标签页' : '已关闭：使用 BOSS 原有跳转方式';
}
chrome.storage.local.get({ enabled: true }, data => render(data.enabled !== false));
toggle.addEventListener('change', async () => {
  const enabled = toggle.checked;
  await chrome.storage.local.set({ enabled });
  render(enabled);
});
chrome.tabs.query({ active: true, currentWindow: true }, tabs => {
  const url = tabs[0]?.url || '';
  if (/^https:\/\/www\.zhipin\.com\/(web\/geek\/jobs?|job_detail\/)/.test(url)) {
    pageStatus.textContent = '✓ 当前是支持的 BOSS 岗位页面';
  } else if (url.includes('zhipin.com')) {
    pageStatus.textContent = '当前不是岗位页面。请进入 BOSS 岗位搜索页使用。';
  } else {
    pageStatus.textContent = '请在 BOSS 直聘岗位搜索页使用本插件。';
  }
});
