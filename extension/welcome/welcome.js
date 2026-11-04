// A picture guide to pinning. An extension can't pin itself, but Chrome can tell it when that's done.
(() => {
  const POLL_MS = 1000;
  const $ = id => document.getElementById(id);

  document.documentElement.lang = chrome.i18n.getUILanguage();
  for (const el of document.querySelectorAll('[data-i18n]')) el.textContent = chrome.i18n.getMessage(el.dataset.i18n);

  const finishIfPinned = async () => {
    const { isOnToolbar } = await chrome.action.getUserSettings();
    if (!isOnToolbar) return false;
    $('guide').hidden = true;
    $('done').hidden = false;
    document.querySelector('.pointer').style.display = 'none';
    return true;
  };

  // Other browsers may not support this, so the guide simply stays as it is there.
  if (typeof chrome.action?.getUserSettings === 'function') {
    const poll = async () => {
      if (!(await finishIfPinned())) setTimeout(poll, POLL_MS);
    };
    poll().catch(() => {});
  }
})();
