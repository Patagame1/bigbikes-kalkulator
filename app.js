(() => {
  'use strict';

  const CACHE_KEY = 'bigbikes.catalog.last-good.v1';
  const CONFIG_KEY = 'bigbikes.catalog.config.v1';
  const CHECK_KEY = 'bigbikes.catalog.last-check.v1';
  const PERSONAL_SETUP_KEY = 'bigbikes.personal-setup.v1';
  const DEFAULT_CONFIG = {
    catalogUrl: './catalog/catalog.json',
    refreshEveryHours: 12,
    requestTimeoutMs: 8000,
  };
  const ALLOWED_MAKES = ['VOGE', 'ZONTES', 'KOVE'];
  const MANUFACTURER_SOURCE_DOMAINS = {
    VOGE: ['voge.pl', 'vogespain.es'],
    ZONTES: ['zontes.com', 'zontes.eu', 'zontesmotos.es', 'sharpon.com'],
    KOVE: ['kovemoto.com'],
  };
  const labels = {
    front: 'Przód',
    rear: 'Tył',
    general: 'Ogólne',
  };
  const form = document.querySelector('#sag-form');
  const makeInput = document.querySelector('#make');
  const modelInput = document.querySelector('#model');
  const yearInput = document.querySelector('#year');
  const suspensionSideInput = document.querySelector('#suspension-side');
  const travelInput = document.querySelector('#travel');
  const targetSagInput = document.querySelector('#target-sag');
  const travelHelp = document.querySelector('#travel-help');
  const errorBox = document.querySelector('#form-error');
  const modelStatus = document.querySelector('#model-status');
  const modelStatusTitle = document.querySelector('#model-status-title');
  const modelStatusCopy = document.querySelector('#model-status-copy');
  const modelDetails = document.querySelector('#model-details');
  const personalSetup = document.querySelector('#personal-setup');
  const personalSetupModel = document.querySelector('#personal-setup-model');
  const personalSetupMessage = document.querySelector('#personal-setup-message');
  const personalSetupClear = document.querySelector('#personal-setup-clear');
  const personalSetupFields = [...personalSetup.querySelectorAll('[data-personal-field]')];
  const personalSetupNote = personalSetup.querySelector('[data-personal-note]');
  const syncPill = document.querySelector('#sync-pill');
  const syncLabel = document.querySelector('#sync-label');
  const catalogMessage = document.querySelector('#catalog-message');
  const refreshButton = document.querySelector('#refresh-catalog');
  const installButton = document.querySelector('#install-button');
  const installHelp = document.querySelector('#install-help');
  let catalog = null;
  let catalogSource = null;
  let pendingInstall = null;
  let refreshPromise = null;
  let travelSelectionKey = '';
  let personalSetupLoadedKey = '';

  function safeGet(key) {
    try { return localStorage.getItem(key); } catch { return null; }
  }

  function safeSet(key, value) {
    try { localStorage.setItem(key, value); } catch { /* App remains usable if storage is blocked or full. */ }
  }

  function readObject(key) {
    try { return JSON.parse(safeGet(key) || 'null'); } catch { return null; }
  }

  function isPlainObject(value) {
    return value !== null && typeof value === 'object' && !Array.isArray(value);
  }

  function validDate(value) {
    return typeof value === 'string' && /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,3})?Z$/.test(value) && Number.isFinite(Date.parse(value));
  }

  function validateCatalog(payload) {
    if (!isPlainObject(payload) || payload.schemaVersion !== 1) throw new Error('Nieobsługiwana wersja schematu katalogu.');
    if (!Number.isSafeInteger(payload.revision) || payload.revision < 1) throw new Error('Brak poprawnego numeru rewizji katalogu.');
    if (typeof payload.catalogVersion !== 'string' || !/^\d+\.\d+\.\d+$/.test(payload.catalogVersion)) throw new Error('Niepoprawna wersja katalogu.');
    if (!validDate(payload.publishedAt)) throw new Error('Niepoprawna data publikacji katalogu.');
    if (!Array.isArray(payload.makes) || !ALLOWED_MAKES.every((make) => payload.makes.includes(make))) throw new Error('Katalog musi zawierać marki VOGE, ZONTES i KOVE.');
    if (!Array.isArray(payload.models)) throw new Error('Lista modeli katalogu jest niepoprawna.');

    const manufacturerHostMatches = (hostname, make) => (MANUFACTURER_SOURCE_DOMAINS[make] || []).some((domain) => hostname === domain || hostname.endsWith(`.${domain}`));

    const ids = new Set();
    for (const model of payload.models) {
      if (!isPlainObject(model) || typeof model.id !== 'string' || !/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(model.id)) throw new Error('Model ma niepoprawny identyfikator.');
      if (ids.has(model.id)) throw new Error(`Powtórzony identyfikator modelu: ${model.id}.`);
      ids.add(model.id);
      if (!ALLOWED_MAKES.includes(model.make) || typeof model.model !== 'string' || model.model.trim().length < 1 || model.model.length > 100) throw new Error(`Niepoprawna marka lub nazwa modelu (${model.id}).`);
      if (model.year !== null && (!Number.isInteger(model.year) || model.year < 1900 || model.year > 2100)) throw new Error(`Niepoprawny rocznik modelu (${model.id}).`);
      if (!['verified', 'unverified'].includes(model.status)) throw new Error(`Niepoprawny status modelu (${model.id}).`);
      if (!Array.isArray(model.settings) || !Array.isArray(model.sources)) throw new Error(`Brak danych nastaw lub źródeł (${model.id}).`);
      const sourceIds = new Set();
      const sourcesById = new Map();
      for (const source of model.sources) {
        if (!isPlainObject(source) || typeof source.id !== 'string' || !/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(source.id) || sourceIds.has(source.id)) throw new Error(`Niepoprawne źródło (${model.id}).`);
        if (typeof source.title !== 'string' || !source.title.trim() || source.title.length > 160 || typeof source.url !== 'string') throw new Error(`Brak tytułu lub adresu źródła (${model.id}).`);
        let sourceUrl;
        try { sourceUrl = new URL(source.url); } catch { throw new Error(`Niepoprawny adres źródła (${model.id}).`); }
        if (sourceUrl.protocol !== 'https:' || !validDate(source.retrievedAt)) throw new Error(`Źródło musi mieć adres HTTPS i datę weryfikacji (${model.id}).`);
        if (source.notes !== undefined && (typeof source.notes !== 'string' || source.notes.length > 500)) throw new Error(`Niepoprawna notatka źródła (${model.id}).`);
        sourceIds.add(source.id);
        sourcesById.set(source.id, source);
      }
      if (model.specifications !== undefined) {
        if (!Array.isArray(model.specifications)) throw new Error(`Niepoprawne dane techniczne (${model.id}).`);
        for (const spec of model.specifications) {
          if (!isPlainObject(spec) || !['front', 'rear'].includes(spec.side) || spec.kind !== 'travel') throw new Error(`Niepoprawna specyfikacja skoku (${model.id}).`);
          if (typeof spec.name !== 'string' || !spec.name.trim() || typeof spec.value !== 'number' || !Number.isFinite(spec.value) || spec.value <= 0) throw new Error(`Niepoprawna wartość specyfikacji (${model.id}).`);
          if (spec.unit !== undefined && typeof spec.unit !== 'string') throw new Error(`Niepoprawna jednostka specyfikacji (${model.id}).`);
          if (!Array.isArray(spec.sourceIds) || spec.sourceIds.length === 0 || spec.sourceIds.some((id) => !sourceIds.has(id))) throw new Error(`Każda specyfikacja musi wskazywać źródło (${model.id}).`);
        }
      }
      for (const setting of model.settings) {
        if (!isPlainObject(setting) || !['front', 'rear', 'general'].includes(setting.side)) throw new Error(`Niepoprawny wpis nastawy (${model.id}).`);
        if (typeof setting.name !== 'string' || !setting.name.trim() || setting.name.length > 120 || !['string', 'number'].includes(typeof setting.value) || (typeof setting.value === 'string' && (!setting.value.trim() || setting.value.length > 500))) throw new Error(`Brak nazwy lub wartości nastawy (${model.id}).`);
        if (typeof setting.value === 'number' && !Number.isFinite(setting.value)) throw new Error(`Niepoprawna wartość nastawy (${model.id}).`);
        if (setting.unit !== undefined && (typeof setting.unit !== 'string' || setting.unit.length > 40)) throw new Error(`Niepoprawna jednostka nastawy (${model.id}).`);
        if (setting.context !== undefined && (typeof setting.context !== 'string' || setting.context.length > 500)) throw new Error(`Niepoprawny kontekst nastawy (${model.id}).`);
        if (!Array.isArray(setting.sourceIds) || setting.sourceIds.length === 0 || setting.sourceIds.some((id) => !sourceIds.has(id))) throw new Error(`Każda nastawa musi wskazywać źródło (${model.id}).`);
        const manufacturerSources = setting.sourceIds.map((id) => sourcesById.get(id)).filter(Boolean);
        if (!manufacturerSources.length || manufacturerSources.some((source) => !manufacturerHostMatches(new URL(source.url).hostname.toLowerCase(), model.make))) throw new Error(`Nastawy muszą pochodzić z dokumentacji producenta ${model.make} (${model.id}).`);
      }
      if (model.status === 'verified' && model.settings.length === 0) throw new Error(`Zweryfikowany model musi mieć co najmniej jedną nastawę (${model.id}).`);
      if (model.status === 'unverified' && model.settings.length > 0) throw new Error(`Niezweryfikowany model nie może publikować nastaw (${model.id}).`);
      if (model.year === null && (model.status !== 'unverified' || model.settings.length > 0 || (model.specifications?.length || 0) > 0)) throw new Error(`Model bez przypisanego rocznika nie może publikować nastaw ani specyfikacji (${model.id}).`);
    }
    return payload;
  }

  function validateConfig(payload) {
    if (!isPlainObject(payload) || typeof payload.catalogUrl !== 'string' || !payload.catalogUrl.trim()) throw new Error('Niepoprawna konfiguracja katalogu.');
    const url = new URL(payload.catalogUrl, document.baseURI);
    if (url.protocol !== 'https:' && !(url.origin === location.origin && ['localhost', '127.0.0.1'].includes(location.hostname))) {
      throw new Error('Zdalny katalog musi być udostępniany przez HTTPS.');
    }
    const refreshEveryHours = Number(payload.refreshEveryHours);
    const requestTimeoutMs = Number(payload.requestTimeoutMs);
    if (!Number.isFinite(refreshEveryHours) || refreshEveryHours < 1 || refreshEveryHours > 168) throw new Error('Interwał sprawdzania musi wynosić od 1 do 168 godzin.');
    if (!Number.isFinite(requestTimeoutMs) || requestTimeoutMs < 1000 || requestTimeoutMs > 30000) throw new Error('Limit czasu katalogu musi wynosić od 1 do 30 sekund.');
    return { catalogUrl: url.href, refreshEveryHours, requestTimeoutMs };
  }

  function cachedCatalog() {
    const record = readObject(CACHE_KEY);
    if (!isPlainObject(record) || !isPlainObject(record.catalog)) return null;
    try { return { catalog: validateCatalog(record.catalog), savedAt: record.savedAt || null }; } catch { return null; }
  }

  function cachedConfig() {
    const record = readObject(CONFIG_KEY);
    if (!isPlainObject(record)) return null;
    try { return validateConfig(record); } catch { return null; }
  }

  function setTopStatus(state, label) {
    syncPill.dataset.state = state;
    syncLabel.textContent = label;
  }

  function formatDate(value, withTime = false) {
    if (!value || !Number.isFinite(Date.parse(value))) return '—';
    const options = withTime ? { dateStyle: 'medium', timeStyle: 'short' } : { dateStyle: 'medium' };
    return new Intl.DateTimeFormat('pl-PL', options).format(new Date(value));
  }

  function normalize(value) {
    return String(value || '').normalize('NFKC').trim().replace(/\s+/g, ' ').toLocaleLowerCase('pl-PL');
  }

  function getSelectedModel() {
    if (!catalog) return null;
    const make = makeInput.value;
    const modelName = normalize(modelInput.value);
    const year = Number(yearInput.value);
    return catalog.models.find((item) => item.make === make && normalize(item.model) === modelName && item.year === year)
      || catalog.models.find((item) => item.make === make && normalize(item.model) === modelName && item.year === null)
      || null;
  }

  function syncTravelField() {
    const item = getSelectedModel();
    const selectionKey = `${makeInput.value}:${normalize(modelInput.value)}:${yearInput.value}:${item?.id || 'unknown'}|${suspensionSideInput.value}`;
    if (selectionKey !== travelSelectionKey) {
      travelInput.value = '';
      targetSagInput.value = '';
      for (const id of ['extended', 'bike-only', 'rider-loaded']) document.querySelector(`#${id}`).value = '';
      travelSelectionKey = selectionKey;
    }
    const spec = item?.specifications?.find((entry) => entry.kind === 'travel' && entry.side === suspensionSideInput.value);
    if (spec && !travelInput.value) travelInput.value = String(spec.value);
    if (spec) {
      travelHelp.textContent = `Skok potwierdzony w katalogu dla tej osi: ${spec.value} ${spec.unit || 'mm'} · ${item.make} ${item.model} ${item.year}. Możesz zmienić wartość.`;
    } else {
      travelHelp.textContent = 'Brak potwierdzonego skoku dla tej osi. Wartość możesz wpisać ze specyfikacji swojego motocykla.';
    }
  }

  function addSettingDetails(model) {
    modelDetails.replaceChildren();
    if (!model) return;
    if (model.notes && model.notes !== 'brak zweryfikowanych danych') {
      const note = document.createElement('p');
      note.className = 'model-note';
      note.textContent = model.notes;
      modelDetails.append(note);
    }
    const grouped = new Map();
    for (const setting of model.settings) {
      if (!grouped.has(setting.side)) grouped.set(setting.side, []);
      grouped.get(setting.side).push(setting);
    }
    for (const side of ['front', 'rear', 'general']) {
      const settings = grouped.get(side);
      const specifications = (model.specifications || []).filter((item) => item.side === side);
      if (!settings?.length && !specifications.length) continue;
      const section = document.createElement('section');
      section.className = 'setup-group';
      const title = document.createElement('h4');
      title.textContent = settings?.length && specifications.length
        ? `${labels[side]} · nastawy i dane`
        : specifications.length
          ? `${labels[side]} · dane techniczne`
          : `${labels[side]} · nastawy`;
      section.append(title);
      for (const setting of [...(settings || []), ...specifications]) {
        const row = document.createElement('div');
        row.className = 'setup-row';
        const name = document.createElement('span');
        name.textContent = setting.name;
        const value = document.createElement('strong');
        value.textContent = `${setting.value}${setting.unit ? ` ${setting.unit}` : ''}`;
        row.append(name, value);
        if (setting.context) {
          const context = document.createElement('small');
          context.textContent = setting.context;
          row.append(context);
        }
        section.append(row);
      }
      modelDetails.append(section);
    }
    const sourceList = document.createElement('ul');
    sourceList.className = 'source-list';
    for (const source of model.sources) {
      const li = document.createElement('li');
      const link = document.createElement('a');
      link.href = source.url;
      link.target = '_blank';
      link.rel = 'noopener noreferrer';
      link.textContent = `${source.title} · sprawdzono ${formatDate(source.retrievedAt)}`;
      li.append(link);
      if (source.notes) {
        const context = document.createElement('small');
        context.textContent = source.notes;
        li.append(context);
      }
      sourceList.append(li);
    }
    if (sourceList.childElementCount) modelDetails.append(sourceList);
  }

  function selectedPersonalSetupKey() {
    const make = makeInput.value;
    const model = normalize(modelInput.value);
    const year = Number(yearInput.value);
    if (!ALLOWED_MAKES.includes(make) || !model || model.length > 100 || !Number.isInteger(year) || year < 1900 || year > 2100) return '';
    return `${make}:${model}:${year}`;
  }

  function syncPersonalSetup(item) {
    const key = selectedPersonalSetupKey();
    const records = readObject(PERSONAL_SETUP_KEY);
    const record = key && isPlainObject(records) && isPlainObject(records[key]) ? records[key] : null;
    personalSetup.hidden = !key || (item?.status === 'verified' && !record);
    if (personalSetup.hidden) return;
    personalSetupModel.textContent = `${makeInput.value} ${modelInput.value.trim()} · ${yearInput.value}`;
    if (key !== personalSetupLoadedKey) {
      const values = isPlainObject(record?.values) ? record.values : {};
      for (const field of personalSetupFields) field.value = typeof values[field.dataset.personalField] === 'string' ? values[field.dataset.personalField].slice(0, 80) : '';
      personalSetupNote.value = typeof record?.note === 'string' ? record.note.slice(0, 400) : '';
      personalSetupMessage.textContent = record?.savedAt ? `Ostatni zapis: ${formatDate(record.savedAt, true)} · tylko na tym urządzeniu.` : 'Wpisz własne wartości ustalone dla tej wersji motocykla.';
      personalSetupClear.hidden = !record;
      personalSetupLoadedKey = key;
    }
  }

  function savePersonalSetup(event) {
    event.preventDefault();
    const key = selectedPersonalSetupKey();
    if (!key) return;
    const values = Object.fromEntries(personalSetupFields.map((field) => [field.dataset.personalField, field.value.trim()]));
    const note = personalSetupNote.value.trim();
    if (![...Object.values(values), note].some(Boolean)) {
      personalSetupMessage.textContent = 'Wpisz przynajmniej jedną wartość lub notatkę.';
      return;
    }
    const records = readObject(PERSONAL_SETUP_KEY);
    const nextRecords = isPlainObject(records) ? records : {};
    const savedAt = new Date().toISOString();
    nextRecords[key] = { savedAt, values, note };
    safeSet(PERSONAL_SETUP_KEY, JSON.stringify(nextRecords));
    const persisted = readObject(PERSONAL_SETUP_KEY);
    if (!isPlainObject(persisted?.[key])) {
      personalSetupMessage.textContent = 'Nie udało się zapisać w tej przeglądarce. Sprawdź ustawienia pamięci urządzenia.';
      return;
    }
    personalSetupLoadedKey = key;
    personalSetupClear.hidden = false;
    personalSetupMessage.textContent = `Zapisano ${formatDate(savedAt, true)} na tym urządzeniu.`;
  }

  function clearPersonalSetup() {
    const key = selectedPersonalSetupKey();
    const records = readObject(PERSONAL_SETUP_KEY);
    if (!key || !isPlainObject(records) || !Object.hasOwn(records, key)) return;
    delete records[key];
    safeSet(PERSONAL_SETUP_KEY, JSON.stringify(records));
    for (const field of personalSetupFields) field.value = '';
    personalSetupNote.value = '';
    personalSetupClear.hidden = true;
    personalSetupLoadedKey = key;
    personalSetupMessage.textContent = 'Usunięto własny zapis z tej przeglądarki.';
  }

  function renderModelStatus() {
    const item = getSelectedModel();
    syncTravelField();
    modelDetails.replaceChildren();
    if (item?.status === 'verified') {
      modelStatus.dataset.status = 'verified';
      modelStatusTitle.textContent = 'Nastawy potwierdzone źródłem';
      modelStatusCopy.textContent = `${item.make} ${item.model} · ${item.year}. To fabryczne punkty odniesienia i kierunki regulacji, nie gotowe ustawienie dla każdego kierowcy.`;
      addSettingDetails(item);
      syncPersonalSetup(item);
      return;
    }
    modelStatus.dataset.status = 'unverified';
    modelStatusTitle.textContent = 'Brak zweryfikowanych danych';
    if (item) {
      const hasSpecifications = Array.isArray(item.specifications) && item.specifications.length > 0;
      modelStatusCopy.textContent = item.year === null
        ? `${item.make} ${item.model} · ${yearInput.value}: nazwa modelu jest w katalogu marki, ale brak wpisu dla tego konkretnego rocznika. Nastawy nie są zgadywane.`
        : hasSpecifications
          ? `${item.make} ${item.model} · ${item.year}: znamy skok zawieszenia podany w źródle, ale brak zweryfikowanych nastaw. Katalog sprawdzany jest automatycznie.`
          : `${item.make} ${item.model} · ${item.year}: brak zweryfikowanych nastaw. Katalog sprawdzany jest automatycznie.`;
      addSettingDetails(item);
    } else if (makeInput.value && modelInput.value.trim() && yearInput.value) {
      modelStatusCopy.textContent = 'Nie znaleziono potwierdzonego wpisu dla tej marki, modelu i rocznika. Nastawy nie są zgadywane.';
    } else {
      modelStatusCopy.textContent = 'Wybierz markę, wpisz model i rocznik, aby sprawdzić katalog.';
    }
    syncPersonalSetup(item);
  }

  function renderCatalogMeta(checkedAt = safeGet(CHECK_KEY)) {
    document.querySelector('#catalog-version').textContent = catalog?.catalogVersion || '—';
    document.querySelector('#catalog-updated').textContent = catalog ? formatDate(catalog.publishedAt) : '—';
    document.querySelector('#catalog-checked').textContent = checkedAt ? formatDate(checkedAt, true) : '—';
  }

  function populateSuggestions() {
    const list = document.querySelector('#model-options');
    list.replaceChildren();
    if (!catalog) return;
    const groups = new Map();
    for (const item of catalog.models.filter((entry) => entry.make === makeInput.value)) {
      const key = normalize(item.model);
      if (!groups.has(key)) groups.set(key, []);
      groups.get(key).push(item);
    }
    const entries = [...groups.values()].sort((a, b) => a[0].model.localeCompare(b[0].model, 'pl'));
    for (const group of entries) {
      const item = group.find((entry) => entry.year === null) || group[0];
      const option = document.createElement('option');
      option.value = item.model;
      const years = [...new Set(group.map((entry) => entry.year).filter((year) => year !== null))].sort((a, b) => a - b);
      option.label = item.year === null
        ? `${item.model} · różne roczniki (podaj swój)`
        : `${item.model} · ${years.join(', ')}`;
      list.append(option);
    }
  }

  function renderCachedCatalog(checkedAt) {
    populateSuggestions();
    renderModelStatus();
    renderCatalogMeta(checkedAt);
  }

  function timeoutSignal(milliseconds) {
    if (typeof AbortSignal.timeout === 'function') return AbortSignal.timeout(milliseconds);
    const controller = new AbortController();
    window.setTimeout(() => controller.abort(), milliseconds);
    return controller.signal;
  }

  async function fetchJson(url, timeoutMs) {
    const response = await fetch(url, {
      cache: 'no-store',
      headers: { Accept: 'application/json' },
      signal: timeoutSignal(timeoutMs),
    });
    if (!response.ok) throw new Error(`Serwer katalogu zwrócił HTTP ${response.status}.`);
    return response.json();
  }

  async function refreshCatalog({ manual = false } = {}) {
    if (refreshPromise) return refreshPromise;
    if (refreshButton) {
      refreshButton.disabled = true;
      refreshButton.querySelector('span:first-child').textContent = 'Sprawdzam katalog…';
    }
    refreshPromise = (async () => {
      const previous = cachedCatalog();
      if (previous) catalog = previous.catalog;
      try {
        let config = null;
        try {
          const configPayload = await fetchJson(new URL('./catalog-source.json', document.baseURI).href, 5000);
          config = validateConfig(configPayload);
          safeSet(CONFIG_KEY, JSON.stringify(config));
        } catch (configError) {
          config = cachedConfig() || validateConfig(DEFAULT_CONFIG);
          if (!navigator.onLine) throw configError;
        }
        catalogSource = config.catalogUrl;
        const candidate = validateCatalog(await fetchJson(config.catalogUrl, config.requestTimeoutMs));
        const saved = cachedCatalog();
        if (saved && candidate.revision < saved.catalog.revision) {
          throw new Error(`Odrzucono starszą rewizję (${candidate.revision}); zachowano ${saved.catalog.catalogVersion} / r${saved.catalog.revision}.`);
        }
        if (saved && candidate.revision === saved.catalog.revision && (candidate.catalogVersion !== saved.catalog.catalogVersion || candidate.publishedAt !== saved.catalog.publishedAt || JSON.stringify(candidate) !== JSON.stringify(saved.catalog))) {
          throw new Error('Zawartość katalogu zmieniła się bez zwiększenia rewizji. Zachowano ostatnią poprawną kopię.');
        }
        catalog = candidate;
        const checkedAt = new Date().toISOString();
        safeSet(CACHE_KEY, JSON.stringify({ catalog: candidate, savedAt: checkedAt }));
        safeSet(CHECK_KEY, checkedAt);
        renderCachedCatalog(checkedAt);
        setTopStatus('online', `Katalog online · ${candidate.catalogVersion}`);
        catalogMessage.textContent = `Połączono z katalogiem. Używasz wersji ${candidate.catalogVersion} (rewizja ${candidate.revision}).`;
      } catch (error) {
        const saved = cachedCatalog();
        if (saved) {
          catalog = saved.catalog;
          renderCachedCatalog(safeGet(CHECK_KEY));
          setTopStatus(navigator.onLine ? 'error' : 'offline', navigator.onLine ? 'Błąd aktualizacji' : 'Offline · kopia lokalna');
          catalogMessage.textContent = `${error.message} Zachowano ostatni poprawny katalog${saved.savedAt ? ` zapisany ${formatDate(saved.savedAt, true)}` : ''}.`;
        } else {
          catalog = null;
          renderCachedCatalog(null);
          setTopStatus('error', navigator.onLine ? 'Katalog niedostępny' : 'Offline · brak kopii');
          catalogMessage.textContent = `${error.message} Kalkulator pomiaru działa, ale katalog nie został jeszcze pobrany.`;
        }
        if (manual) catalogMessage.setAttribute('aria-live', 'assertive');
      } finally {
        if (refreshButton) {
          refreshButton.disabled = false;
          refreshButton.querySelector('span:first-child').textContent = 'Odśwież teraz';
        }
        refreshPromise = null;
      }
    })();
    return refreshPromise;
  }

  function showError(message) {
    errorBox.textContent = message;
    errorBox.hidden = false;
    errorBox.focus?.();
  }

  function clearError() {
    errorBox.textContent = '';
    errorBox.hidden = true;
  }

  function numberFrom(id) {
    const raw = document.querySelector(`#${id}`).value.trim();
    return raw === '' ? NaN : Number(raw);
  }

  function formatMm(value) {
    return `${new Intl.NumberFormat('pl-PL', { minimumFractionDigits: 1, maximumFractionDigits: 1 }).format(value)} mm`;
  }

  function calculate(event) {
    event.preventDefault();
    clearError();
    const model = modelInput.value.trim();
    const year = Number(yearInput.value);
    const travel = numberFrom('travel');
    const targetRaw = targetSagInput.value.trim();
    const targetSag = targetRaw === '' ? NaN : Number(targetRaw);
    const extended = numberFrom('extended');
    const bikeOnly = numberFrom('bike-only');
    const riderLoaded = numberFrom('rider-loaded');
    if (!makeInput.value || !model || !Number.isInteger(year) || year < 1900 || year > 2100) {
      showError('Uzupełnij markę, model i poprawny rocznik motocykla.');
      return;
    }
    if (![travel, extended, bikeOnly, riderLoaded].every(Number.isFinite) || travel <= 0 || extended < 0 || bikeOnly < 0 || riderLoaded < 0) {
      showError('Wpisz skok zawieszenia i wszystkie trzy pomiary w milimetrach. Skok musi być większy od zera.');
      return;
    }
    if (targetRaw !== '' && (!Number.isFinite(targetSag) || targetSag <= 0 || targetSag > travel)) {
      showError('Cel ugięcia musi być większy od zera i nie może przekraczać podanego skoku zawieszenia.');
      return;
    }
    if (extended < bikeOnly || bikeOnly < riderLoaded) {
      showError('Sprawdź kolejność pomiarów: przy pełnym rozprężeniu odczyt powinien być największy, a z kierowcą najmniejszy. Użyj tego samego punktu pomiarowego.');
      return;
    }
    const freeSag = extended - bikeOnly;
    const riderSag = extended - riderLoaded;
    const percent = (riderSag / travel) * 100;
    document.querySelector('#free-sag').textContent = formatMm(freeSag);
    document.querySelector('#rider-sag').textContent = formatMm(riderSag);
    document.querySelector('#sag-percent').textContent = `${new Intl.NumberFormat('pl-PL', { maximumFractionDigits: 1 }).format(percent)}%`;
    const resultNote = document.querySelector('#result-note');
    resultNote.textContent = percent > 100
      ? 'Ugięcie z kierowcą przekracza podany skok. Sprawdź wartość skoku i punkty pomiarowe.'
      : targetRaw === ''
        ? 'To wynik z podanych pomiarów. Wpisz docelowe ugięcie z instrukcji, aby porównać wynik i uzyskać kierunek korekty napięcia wstępnego.'
        : 'Porównanie dotyczy wyłącznie wpisanego przez Ciebie celu. Liczby obrotów ani klików nie da się wyliczyć z samego pomiaru.';
    const setupAdvice = document.querySelector('#setup-advice');
    setupAdvice.hidden = targetRaw === '' || percent > 100;
    if (!setupAdvice.hidden) {
      const difference = riderSag - targetSag;
      const differenceText = new Intl.NumberFormat('pl-PL', { minimumFractionDigits: 1, maximumFractionDigits: 1 }).format(Math.abs(difference));
      setupAdvice.textContent = difference === 0
        ? 'Ugięcie z kierowcą odpowiada wpisanemu celowi. Sam pomiar nie wskazuje potrzeby korekty napięcia wstępnego.'
        : difference > 0
          ? `Ugięcie jest większe od celu o ${differenceText} mm. Jeśli instrukcja dopuszcza tę regulację, zwiększ napięcie wstępne małym krokiem i ponownie zmierz ugięcie.`
          : `Ugięcie jest mniejsze od celu o ${differenceText} mm. Jeśli instrukcja dopuszcza tę regulację, zmniejsz napięcie wstępne małym krokiem i ponownie zmierz ugięcie.`;
    }
    document.querySelector('#result').hidden = false;
    renderModelStatus();
    document.querySelector('#result').scrollIntoView({ behavior: 'smooth', block: 'nearest' });
  }

  function updateSelectedVehicle() {
    const matches = catalog?.models.filter((item) => item.make === makeInput.value && normalize(item.model) === normalize(modelInput.value)) || [];
    if (matches.length === 1 && matches[0].year !== null) yearInput.value = String(matches[0].year);
    populateSuggestions();
    renderModelStatus();
  }

  form.addEventListener('submit', calculate);
  personalSetup.addEventListener('submit', savePersonalSetup);
  personalSetupClear.addEventListener('click', clearPersonalSetup);
  makeInput.addEventListener('change', updateSelectedVehicle);
  modelInput.addEventListener('input', renderModelStatus);
  modelInput.addEventListener('change', updateSelectedVehicle);
  yearInput.addEventListener('input', renderModelStatus);
  yearInput.addEventListener('change', renderModelStatus);
  suspensionSideInput.addEventListener('change', renderModelStatus);
  refreshButton.addEventListener('click', () => refreshCatalog({ manual: true }));
  window.addEventListener('online', () => refreshCatalog());
  window.addEventListener('offline', () => {
    if (catalog) {
      setTopStatus('offline', 'Offline · kopia lokalna');
      catalogMessage.textContent = 'Brak połączenia. Wyświetlam ostatnią poprawną wersję katalogu zapisaną na tym urządzeniu.';
    }
  });
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible') {
      const checkedAt = safeGet(CHECK_KEY);
      const staleAfter = (catalogSource ? cachedConfig()?.refreshEveryHours : DEFAULT_CONFIG.refreshEveryHours) * 60 * 60 * 1000;
      if (!checkedAt || Date.now() - Date.parse(checkedAt) > staleAfter) refreshCatalog();
    }
  });

  window.addEventListener('beforeinstallprompt', (event) => {
    event.preventDefault();
    pendingInstall = event;
    installButton.hidden = false;
  });
  const isAppleTouch = /iphone|ipad|ipod/i.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
  if (isAppleTouch && !window.matchMedia('(display-mode: standalone)').matches) installButton.hidden = false;
  installButton.addEventListener('click', async () => {
    if (pendingInstall) {
      await pendingInstall.prompt();
      pendingInstall = null;
      installButton.hidden = true;
      return;
    }
    installHelp.hidden = false;
    installHelp.scrollIntoView({ behavior: 'smooth', block: 'center' });
  });
  window.addEventListener('appinstalled', () => {
    pendingInstall = null;
    installButton.hidden = true;
  });

  const initial = cachedCatalog();
  if (initial) {
    catalog = initial.catalog;
    renderCachedCatalog(safeGet(CHECK_KEY));
    catalogMessage.textContent = 'Wyświetlam ostatni poprawny katalog. Sprawdzam, czy jest dostępna nowsza wersja…';
  } else {
    renderModelStatus();
  }
  refreshCatalog();
  window.setInterval(() => {
    const checkedAt = safeGet(CHECK_KEY);
    const intervalHours = cachedConfig()?.refreshEveryHours || DEFAULT_CONFIG.refreshEveryHours;
    if (navigator.onLine && (!checkedAt || Date.now() - Date.parse(checkedAt) >= intervalHours * 60 * 60 * 1000)) refreshCatalog();
  }, 60 * 60 * 1000);

  if ('serviceWorker' in navigator && (location.protocol === 'https:' || ['localhost', '127.0.0.1'].includes(location.hostname))) {
    window.addEventListener('load', () => navigator.serviceWorker.register('./sw.js').catch(() => {
      catalogMessage.textContent = 'Kalkulator jest dostępny, ale przeglądarka nie uruchomiła trybu offline. Do instalacji wymagany jest HTTPS.';
    }));
  }
})();
