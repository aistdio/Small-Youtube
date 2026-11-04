// Reads the account's preferred languages once. YouTube's own settings page loads in a hidden frame
// and its own code makes the signed request, so this script never touches a login secret.
// It only opens the dialog and reads it. It never presses the dialog's confirm button.
(() => {
  const { SELECTORS: S, LANGUAGE_PANEL_REQUEST, ACCOUNT_PLAYBACK_PATH } = globalThis.SmallYT.ytPage;

  const TIMEOUT_MS = 15000;
  const POLL_MS = 100;
  const MIN_ROWS = 50; // the full language list has hundreds of rows

  const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));

  const until = async (check, deadline) => {
    while (Date.now() < deadline) {
      const value = check();
      if (value) return value;
      await sleep(POLL_MS);
    }
    return null;
  };

  // Found by structure, because its text is localized: the settings link that stays on YouTube.
  const findLanguageLink = doc => [...doc.querySelectorAll(S.settingsLink)]
    .find(a => !/^https?:/.test(a.getAttribute('href') ?? ''));

  const labelToCode = panelText => {
    const map = new Map();
    const walk = value => {
      if (!value || typeof value !== 'object') return;
      const item = value.checkboxItemViewModel;
      if (item?.key && item.text?.content) map.set(item.text.content, item.key);
      for (const key in value) walk(value[key]);
    };
    walk(JSON.parse(panelText));
    return map;
  };

  const press = (win, target, x, y) => {
    const init = { bubbles: true, cancelable: true, composed: true, view: win, clientX: x, clientY: y, button: 0 };
    target.dispatchEvent(new win.PointerEvent('pointerdown', init));
    target.dispatchEvent(new win.MouseEvent('mousedown', init));
    target.dispatchEvent(new win.PointerEvent('pointerup', init));
    target.dispatchEvent(new win.MouseEvent('mouseup', init));
    target.dispatchEvent(new win.MouseEvent('click', init));
  };

  const isChecked = row => row.getAttribute('aria-checked') === 'true'
    || !!row.querySelector('[aria-checked="true"],[aria-selected="true"],input:checked');

  const readAccountLanguages = async () => {
    const deadline = Date.now() + TIMEOUT_MS;
    const frame = document.createElement('iframe');
    frame.src = ACCOUNT_PLAYBACK_PATH;
    frame.setAttribute('aria-hidden', 'true');
    frame.tabIndex = -1;
    frame.style.cssText = 'position:fixed;left:-10000px;top:0;width:1200px;height:900px;border:0';
    try {
      document.documentElement.append(frame);
      const link = await until(() => {
        const doc = frame.contentDocument;
        return doc && doc.readyState !== 'loading' ? findLanguageLink(doc) : null;
      }, deadline);
      if (!link) return null;
      await sleep(800); // lets YouTube finish wiring up the link

      const win = frame.contentWindow;
      let panelText = null;
      const realFetch = win.fetch;
      win.fetch = async function fetchAndWatch(...args) {
        const response = await realFetch.apply(this, args);
        try {
          const url = typeof args[0] === 'string' ? args[0] : args[0].url;
          if (LANGUAGE_PANEL_REQUEST.test(url)) panelText = await response.clone().text();
        } catch {
          // Not the request this is waiting for.
        }
        return response;
      };

      const box = link.getClientRects()[0];
      const x = box.left + Math.min(40, box.width / 2);
      const y = box.top + box.height / 2;
      press(win, win.document.elementFromPoint(x, y) ?? link, x, y);

      const rows = await until(() => {
        const dialog = [...win.document.querySelectorAll(S.dialog)].find(d => d.querySelector(S.menuItem));
        const found = dialog ? [...dialog.querySelectorAll(S.menuItem)] : [];
        return panelText && found.length >= MIN_ROWS ? found : null;
      }, deadline);
      if (!rows) return null;

      const codes = labelToCode(panelText);
      const chosen = rows.filter(isChecked).map(row => codes.get((row.innerText ?? '').trim())).filter(Boolean);
      return chosen.length ? chosen : null;
    } catch {
      return null;
    } finally {
      frame.remove();
    }
  };

  (globalThis.SmallYT ??= {}).languages = { readAccountLanguages };
})();
