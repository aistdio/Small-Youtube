// The settings popup. Every change is saved right away.
(() => {
  const { settings: settingsLib, store: storeLib, scale } = globalThis.SmallYT;
  const store = storeLib.createStore(chrome, Date.now);
  const t = key => chrome.i18n.getMessage(key);
  const $ = id => document.getElementById(id);

  const TILE_COUNT = 12;
  const NO_LIMIT = () => t('noLimit');
  const COMMON_LANGUAGES = ['ar', 'bn', 'cs', 'da', 'de', 'el', 'en', 'es', 'fa', 'fi', 'fr', 'he', 'hi', 'hu', 'id', 'it', 'ja', 'ko', 'nl', 'no', 'pl', 'pt', 'ro', 'ru', 'sv', 'th', 'tr', 'uk', 'vi', 'zh'];

  const languageName = code => {
    try {
      return new Intl.DisplayNames([chrome.i18n.getUILanguage()], { type: 'language' }).of(code) ?? code;
    } catch {
      return code;
    }
  };

  const localize = () => {
    document.documentElement.lang = chrome.i18n.getUILanguage();
    for (const el of document.querySelectorAll('[data-i18n]')) el.textContent = t(el.dataset.i18n);
    for (const el of document.querySelectorAll('[data-i18n-aria]')) el.setAttribute('aria-label', t(el.dataset.i18nAria));
  };

  let settings = null;
  const save = patch => {
    settings = settingsLib.normalize({ ...settings, ...patch });
    return store.setSettings(patch);
  };

  // Share slider and its preview.
  const shareText = share => (share === 'random' ? t('random') : `${share}%`);
  const renderShare = () => {
    const { share } = settings;
    $('share-slider').value = scale.shareToPos(share);
    $('share-value').value = shareText(share);
    const preview = $('preview');
    preview.classList.toggle('random', share === 'random');
    [...preview.children].forEach((tile, i) => tile.classList.toggle('small', share !== 'random' && scale.isSmallTile(i, share)));
  };

  // Moves one stop at a time with the keyboard, instead of the slider's tiny native step.
  const stepKeys = (slider, stops, toPos, apply) => {
    slider.addEventListener('keydown', e => {
      const direction = { ArrowRight: 1, ArrowUp: 1, ArrowLeft: -1, ArrowDown: -1 }[e.key];
      if (!direction) return;
      e.preventDefault();
      const here = Number(slider.value);
      const positions = stops.map(toPos);
      const next = direction > 0 ? positions.find(p => p > here + 0.001) : positions.filter(p => p < here - 0.001).pop();
      if (next !== undefined) apply(next);
    });
  };

  const setupShare = () => {
    for (let i = 0; i < TILE_COUNT; i++) {
      const tile = document.createElement('div');
      tile.className = 'tile';
      $('preview').append(tile);
    }
    const applyPos = pos => {
      save({ share: scale.posToShare(pos) });
      renderShare();
    };
    $('share-slider').addEventListener('input', e => applyPos(Number(e.target.value)));
    stepKeys($('share-slider'), scale.SHARE_STOPS, scale.shareToPos, applyPos);
    $('share-value').addEventListener('change', e => {
      const value = scale.parseShare(e.target.value, t('random'));
      if (value !== undefined) save({ share: value });
      renderShare();
    });
  };

  // A range is two sliders on one track, plus a value box for each.
  const setupRange = (name, minKey, maxKey) => {
    const minSlider = $(`${name}-min-slider`);
    const maxSlider = $(`${name}-max-slider`);
    const minBox = $(`${name}-min`);
    const maxBox = $(`${name}-max`);

    const render = () => {
      minSlider.value = scale.valueToPos(settings[minKey]);
      maxSlider.value = scale.valueToPos(settings[maxKey]);
      minBox.value = scale.formatValue(settings[minKey], NO_LIMIT());
      maxBox.value = scale.formatValue(settings[maxKey], NO_LIMIT());
      maxBox.title = settings[maxKey] === null ? t('noLimitTitle') : '';
    };
    const atOrBelow = (min, max) => max === null || min <= max;

    const setMinPos = pos => {
      const value = scale.posToValue(pos);
      if (value !== null && atOrBelow(value, settings[maxKey])) save({ [minKey]: value });
      render();
    };
    const setMaxPos = pos => {
      const value = scale.posToValue(pos);
      if (atOrBelow(settings[minKey], value)) save({ [maxKey]: value });
      render();
    };

    minSlider.addEventListener('input', e => setMinPos(Number(e.target.value)));
    maxSlider.addEventListener('input', e => setMaxPos(Number(e.target.value)));
    stepKeys(minSlider, scale.STOPS, scale.valueToPos, setMinPos);
    stepKeys(maxSlider, scale.STOPS, scale.valueToPos, setMaxPos);

    minBox.addEventListener('change', e => {
      const typed = scale.parseTyped(e.target.value);
      const value = typed === null ? 0 : typed;
      if (value !== undefined && atOrBelow(value, settings[maxKey])) save({ [minKey]: value });
      render();
    });
    maxBox.addEventListener('change', e => {
      const value = scale.parseTyped(e.target.value);
      if (value !== undefined && atOrBelow(settings[minKey], value)) save({ [maxKey]: value });
      render();
    });
    return render;
  };

  const renderLanguages = () => {
    const list = $('languages');
    list.replaceChildren(...settings.languages.map(code => {
      const item = document.createElement('li');
      item.textContent = languageName(code);
      const remove = document.createElement('button');
      remove.type = 'button';
      remove.textContent = '×';
      remove.setAttribute('aria-label', `${t('remove')}: ${languageName(code)}`);
      remove.disabled = settings.languages.length === 1;
      remove.addEventListener('click', () => {
        save({ languages: settingsLib.removeLanguage(settings.languages, code), languagesEdited: true });
        renderLanguages();
      });
      item.append(remove);
      return item;
    }));

    const select = $('add-language');
    const prompt = document.createElement('option');
    prompt.value = '';
    prompt.textContent = `+ ${t('addLanguage')}`;
    const options = COMMON_LANGUAGES.filter(code => !settings.languages.includes(code))
      .map(code => ({ code, name: languageName(code) }))
      .sort((a, b) => a.name.localeCompare(b.name))
      .map(({ code, name }) => {
        const option = document.createElement('option');
        option.value = code;
        option.textContent = name;
        return option;
      });
    select.replaceChildren(prompt, ...options);
    select.value = '';
  };

  const setupSwitch = (id, key) => {
    $(id).checked = settings[key];
    $(id).addEventListener('change', e => save({ [key]: e.target.checked }));
  };

  const blockRow = (label, item) => {
    const row = document.createElement('li');
    row.textContent = label;
    const undo = document.createElement('button');
    undo.type = 'button';
    undo.textContent = t('undo');
    undo.addEventListener('click', async () => {
      await store.unblock(item);
      renderBlocks();
    });
    row.append(undo);
    return row;
  };

  async function renderBlocks() {
    const blocks = await store.getBlocks();
    const rows = [
      ...blocks.channels.map(c => blockRow(c.name, { channelId: c.id })),
      ...blocks.phrases.map(phrase => blockRow(phrase, { phrase })),
      ...blocks.seedChannels.map(name => blockRow(name, { seedChannel: name })),
    ];
    $('blocks').replaceChildren(...rows);
    $('blocks-empty').hidden = rows.length > 0;
  }

  const renderNotice = async () => {
    const pausedUntil = await store.getState('pausedUntil');
    const budget = await store.getState('budget');
    const today = new Date().toISOString().slice(0, 10);
    const notice = $('notice');
    if (pausedUntil > Date.now()) {
      const minutes = Math.ceil((pausedUntil - Date.now()) / 60000);
      notice.textContent = t('pausedNotice').replace('{minutes}', minutes);
      notice.hidden = false;
    } else if (budget?.day === today && budget.used >= 3000) {
      notice.textContent = t('budgetNotice');
      notice.hidden = false;
    } else {
      notice.hidden = true;
    }
  };

  const renderPower = () => {
    const power = $('power');
    power.setAttribute('aria-pressed', String(settings.enabled));
    power.textContent = settings.enabled ? t('turnOff') : t('turnOn');
  };

  const init = async () => {
    localize();
    settings = await store.getSettings();
    if (settings.languages === null) await save({ languages: settingsLib.initialLanguages(navigator.language) });

    setupShare();
    const renderSubs = setupRange('subs', 'subsMin', 'subsMax');
    const renderViews = setupRange('views', 'viewsMin', 'viewsMax');
    setupSwitch('skip-dubbed', 'skipDubbed');
    setupSwitch('show-unknown', 'showUnknownLanguage');
    setupSwitch('use-account', 'useAccountForSearches');

    $('add-language').addEventListener('change', e => {
      if (!e.target.value) return;
      save({ languages: [...settings.languages, e.target.value], languagesEdited: true });
      renderLanguages();
    });
    $('power').addEventListener('click', () => {
      save({ enabled: !settings.enabled });
      renderPower();
    });

    renderShare();
    renderSubs();
    renderViews();
    renderLanguages();
    renderPower();
    renderBlocks();
    renderNotice();
  };

  init();
})();
