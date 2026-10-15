(() => {
  'use strict';

  const CACHE_KEY = 'bigbikes.catalog.last-good.v1';
  const CONFIG_KEY = 'bigbikes.catalog.config.v1';
  const CHECK_KEY = 'bigbikes.catalog.last-check.v1';
  const PERSONAL_SETUP_KEY = 'bigbikes.personal-setup.v1';
  const CLICK_SETUP_KEY = 'bigbikes.click-setup.v1';
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
  const clickPlannerIntro = document.querySelector('#click-planner-intro');
  const clickPlannerContent = document.querySelector('#click-planner-content');
  const riderWeightInput = document.querySelector('#rider-weight');
  const riderHeightInput = document.querySelector('#rider-height');
  const luggageWeightInput = document.querySelector('#luggage-weight');
  const luggageCasesInput = document.querySelector('#luggage-cases');
  const hasPassengerInput = document.querySelector('#has-passenger');
  const passengerWeightInput = document.querySelector('#passenger-weight');
  const passengerWeightField = document.querySelector('#passenger-weight-field');
  const loadSummary = document.querySelector('#load-summary');
  const riderLoadedLabel = document.querySelector('#rider-loaded-label');
  const riderLoadedHelp = document.querySelector('#rider-loaded-help');
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
  let clickProfileOverride = 'automatic';

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
      const clickProfileMatches = new Map();
      for (const setting of model.settings) {
        if (!isPlainObject(setting) || !['front', 'rear', 'general'].includes(setting.side)) throw new Error(`Niepoprawny wpis nastawy (${model.id}).`);
        if (typeof setting.name !== 'string' || !setting.name.trim() || setting.name.length > 120 || !['string', 'number'].includes(typeof setting.value) || (typeof setting.value === 'string' && (!setting.value.trim() || setting.value.length > 500))) throw new Error(`Brak nazwy lub wartości nastawy (${model.id}).`);
        if (typeof setting.value === 'number' && !Number.isFinite(setting.value)) throw new Error(`Niepoprawna wartość nastawy (${model.id}).`);
        if (setting.unit !== undefined && (typeof setting.unit !== 'string' || setting.unit.length > 40)) throw new Error(`Niepoprawna jednostka nastawy (${model.id}).`);
        if (setting.context !== undefined && (typeof setting.context !== 'string' || setting.context.length > 500)) throw new Error(`Niepoprawny kontekst nastawy (${model.id}).`);
        if (!Array.isArray(setting.sourceIds) || setting.sourceIds.length === 0 || setting.sourceIds.some((id) => !sourceIds.has(id))) throw new Error(`Każda nastawa musi wskazywać źródło (${model.id}).`);
        if (setting.clickGuide !== undefined) {
          const guide = setting.clickGuide;
          if (!isPlainObject(guide) || typeof guide.id !== 'string' || !/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(guide.id) || typeof guide.label !== 'string' || !guide.label.trim() || guide.label.length > 100) throw new Error(`Niepoprawna instrukcja klików (${model.id}).`);
          if (!Number.isInteger(guide.baselineClicks) || guide.baselineClicks < 0 || guide.baselineClicks > 1000 || !Number.isFinite(guide.tolerance ?? 0) || (guide.tolerance ?? 0) < 0 || (guide.tolerance ?? 0) > 20) throw new Error(`Niepoprawna nastawa bazowa w klikach (${model.id}).`);
          if (!['hard-stop', 'left-stop', 'right-stop'].includes(guide.reference) || !['clockwise', 'counterclockwise'].includes(guide.countDirection)) throw new Error(`Niepoprawny punkt odniesienia klików (${model.id}).`);
          if (guide.profile !== undefined && (typeof guide.profile !== 'string' || !/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(guide.profile))) throw new Error(`Niepoprawny wariant obciążenia (${model.id}).`);
          if (guide.profileLabel !== undefined && (typeof guide.profileLabel !== 'string' || !guide.profileLabel.trim() || guide.profileLabel.length > 100)) throw new Error(`Niepoprawna nazwa wariantu obciążenia (${model.id}).`);
          if (guide.loadProfileMatch !== undefined && !['solo-no-luggage', 'solo-three-cases', 'two-riders-three-cases'].includes(guide.loadProfileMatch)) throw new Error(`Niepoprawne kryterium doboru wariantu obciążenia (${model.id}).`);
          const profileKey = guide.profile || 'default';
          const matchKey = guide.loadProfileMatch || '';
          if (clickProfileMatches.has(profileKey) && clickProfileMatches.get(profileKey) !== matchKey) throw new Error(`Wariant klików ma niespójne kryteria obciążenia (${model.id}).`);
          clickProfileMatches.set(profileKey, matchKey);
          if ((guide.minRange !== undefined || guide.maxRange !== undefined) && (!Number.isInteger(guide.minRange) || !Number.isInteger(guide.maxRange) || guide.minRange < 0 || guide.maxRange < guide.minRange || guide.baselineClicks < guide.minRange || guide.baselineClicks > guide.maxRange)) throw new Error(`Niepoprawny zakres regulatora (${model.id}).`);
        }
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

  const manualClickAdjusters = [
    { id: 'front-compression', label: 'Przód · kompresja' },
    { id: 'front-rebound', label: 'Przód · odbicie' },
    { id: 'rear-compression', label: 'Tył · kompresja' },
    { id: 'rear-rebound', label: 'Tył · odbicie' },
  ];

  function clickRecordKey() {
    return selectedPersonalSetupKey();
  }

  function readClickRecord() {
    const key = clickRecordKey();
    const records = readObject(CLICK_SETUP_KEY);
    return key && isPlainObject(records) && isPlainObject(records[key]) ? records[key] : { values: {} };
  }

  function saveClickValue(valueKey, value) {
    const key = clickRecordKey();
    if (!key) return;
    const records = readObject(CLICK_SETUP_KEY);
    const nextRecords = isPlainObject(records) ? records : {};
    const prior = isPlainObject(nextRecords[key]) ? nextRecords[key] : {};
    const values = isPlainObject(prior.values) ? prior.values : {};
    values[valueKey] = value;
    nextRecords[key] = { savedAt: new Date().toISOString(), values };
    safeSet(CLICK_SETUP_KEY, JSON.stringify(nextRecords));
  }

  function clickOriginLabel(reference) {
    return reference === 'left-stop' ? 'lewego ogranicznika' : reference === 'right-stop' ? 'prawego ogranicznika' : 'pozycji maksymalnego tłumienia';
  }

  function turnLabel(direction) {
    return direction === 'clockwise' ? 'w prawo' : 'w lewo';
  }

  function clickCountWord(count) {
    const absolute = Math.abs(count);
    const lastTwo = absolute % 100;
    const last = absolute % 10;
    if (absolute === 1) return 'klik';
    if (last >= 2 && last <= 4 && !(lastTwo >= 12 && lastTwo <= 14)) return 'kliki';
    return 'klików';
  }

  function updateClickRow(row) {
    const output = row.querySelector('[data-click-output]');
    const currentInput = row.querySelector('[data-click-current]');
    const targetInput = row.querySelector('[data-click-target]');
    const currentRaw = currentInput?.value.trim() ?? '';
    const targetRaw = targetInput ? targetInput.value.trim() : (row.dataset.targetClicks || '');
    if (currentRaw === '' || targetRaw === '') {
      output.textContent = row.dataset.mode === 'manufacturer'
        ? 'Wpisz aktualne położenie, aby sprawdzić różnicę względem bazy producenta.'
        : 'Wpisz aktualną i docelową wartość z instrukcji, liczone od tego samego punktu.';
      return;
    }
    const current = Number(currentRaw);
    const target = Number(targetRaw);
    if (!Number.isInteger(current) || !Number.isInteger(target) || current < 0 || target < 0) {
      output.textContent = 'Wpisz całkowitą, nieujemną liczbę klików.';
      return;
    }
    if (row.dataset.mode === 'manufacturer') {
      const minimum = Number(row.dataset.targetMin);
      const maximum = Number(row.dataset.targetMax);
      const minRange = row.dataset.minRange === '' ? null : Number(row.dataset.minRange);
      const maxRange = row.dataset.maxRange === '' ? null : Number(row.dataset.maxRange);
      if ((minRange !== null && (current < minRange || current > maxRange)) || current < 0) {
        output.textContent = 'Ta wartość wychodzi poza zakres klików podany w instrukcji. Sprawdź punkt liczenia.';
      } else if (current >= minimum && current <= maximum) {
        output.textContent = 'To ustawienie mieści się w tolerancji podanej przez producenta.';
      } else {
        const targetEdge = current < minimum ? minimum : maximum;
        const difference = Math.abs(targetEdge - current);
        const countDirection = row.dataset.countDirection;
        const direction = current < minimum ? countDirection : (countDirection === 'clockwise' ? 'counterclockwise' : 'clockwise');
        output.textContent = `Do zakresu producenta: ${difference} ${clickCountWord(difference)} ${turnLabel(direction)}. Nastawa standardowa: ${row.dataset.targetText}.`;
      }
      return;
    }
    const difference = target - current;
    output.textContent = difference === 0
      ? 'Aktualna wartość odpowiada wpisanej przez Ciebie wartości docelowej.'
      : `Zmień liczbę z ${current} na ${target} klików (${Math.abs(difference)} ${clickCountWord(difference)} różnicy), licząc od tego samego punktu odniesienia.`;
  }

  function makeClickRow({ id, label, mode, reference, countDirection, baseline, tolerance = 0, minRange, maxRange, savedValues = {} }) {
    const row = document.createElement('article');
    row.className = 'click-row';
    row.dataset.mode = mode;
    if (mode === 'manufacturer') {
      const minimum = baseline - tolerance;
      const maximum = baseline + tolerance;
      row.dataset.targetClicks = String(baseline);
      row.dataset.targetMin = String(minimum);
      row.dataset.targetMax = String(maximum);
      row.dataset.targetText = tolerance ? `${baseline} ± ${tolerance} klik` : `${baseline} ${clickCountWord(baseline)}`;
      row.dataset.countDirection = countDirection;
      row.dataset.minRange = minRange === undefined ? '' : String(minRange);
      row.dataset.maxRange = maxRange === undefined ? '' : String(maxRange);
    }
    const heading = document.createElement('div');
    heading.className = 'click-row-heading';
    const name = document.createElement('strong');
    name.textContent = label;
    const baselineText = document.createElement('span');
    baselineText.className = 'click-baseline';
    baselineText.textContent = mode === 'manufacturer'
      ? `${tolerance ? `${baseline} ± ${tolerance} klik` : `${baseline} ${clickCountWord(baseline)}`} od ${clickOriginLabel(reference)}`
      : 'Własna wartość z instrukcji';
    heading.append(name, baselineText);
    row.append(heading);

    const fields = document.createElement('div');
    fields.className = 'click-fields';
    if (mode === 'manufacturer') {
      const labelNode = document.createElement('label');
      labelNode.textContent = `Teraz · kliki od ${clickOriginLabel(reference)}`;
      const input = document.createElement('input');
      input.type = 'number';
      input.min = '0';
      input.step = '1';
      input.inputMode = 'numeric';
      input.autocomplete = 'off';
      input.placeholder = 'np. 12';
      input.dataset.clickCurrent = '';
      input.dataset.clickValueKey = id;
      input.value = typeof savedValues[id] === 'string' ? savedValues[id] : '';
      labelNode.append(input);
      fields.append(labelNode);
    } else {
      for (const [field, labelText, placeholder] of [
        ['target', 'Cel z instrukcji', 'np. 12'],
        ['current', 'Teraz', 'np. 15'],
      ]) {
        const labelNode = document.createElement('label');
        labelNode.textContent = labelText;
        const input = document.createElement('input');
        input.type = 'number';
        input.min = '0';
        input.step = '1';
        input.inputMode = 'numeric';
        input.autocomplete = 'off';
        input.placeholder = placeholder;
        input.dataset.clickValueKey = `${id}:${field}`;
        input.dataset.clickValueField = field;
        if (field === 'target') input.dataset.clickTarget = '';
        else input.dataset.clickCurrent = '';
        input.value = typeof savedValues[input.dataset.clickValueKey] === 'string' ? savedValues[input.dataset.clickValueKey] : '';
        labelNode.append(input);
        fields.append(labelNode);
      }
    }
    row.append(fields);
    const output = document.createElement('p');
    output.className = 'click-row-output';
    output.setAttribute('data-click-output', '');
    output.setAttribute('aria-live', 'polite');
    row.append(output);
    row.querySelectorAll('input').forEach((input) => {
      input.addEventListener('input', () => {
        saveClickValue(input.dataset.clickValueKey, input.value.trim());
        updateClickRow(row);
      });
    });
    updateClickRow(row);
    return row;
  }

  function renderClickPlanner(model) {
    const currentProfile = clickPlannerContent.querySelector('#click-profile')?.value;
    clickPlannerContent.replaceChildren();
    if (!makeInput.value || !modelInput.value.trim() || !yearInput.value) {
      clickPlannerIntro.textContent = 'Wybierz markę, model i rocznik, aby zobaczyć punkt bazowy lub wpisać kliknięcia z instrukcji.';
      return;
    }
    const vehicleLabel = `${makeInput.value} ${modelInput.value.trim()} · ${yearInput.value}`;
    const guides = (model?.settings || []).filter((setting) => setting.clickGuide);
    if (guides.length) {
      const load = getLoadData();
      const profiles = new Map();
      for (const setting of guides) {
        const guide = setting.clickGuide;
        const key = guide.profile || 'default';
        if (!profiles.has(key)) profiles.set(key, { label: guide.profileLabel || 'Pozycja standardowa', loadProfileMatch: guide.loadProfileMatch || '', settings: [] });
        profiles.get(key).settings.push(setting);
      }
      const savedValues = readClickRecord().values || {};
      const automaticProfile = [...profiles.entries()].find(([, profile]) => profile.loadProfileMatch && matchesLoadProfile(profile.loadProfileMatch, load))?.[0]
        || (profiles.size === 1 && ![...profiles.values()][0].loadProfileMatch ? profiles.keys().next().value : '');
      const selectedProfile = clickProfileOverride !== 'automatic' && profiles.has(clickProfileOverride)
        ? clickProfileOverride
        : currentProfile && currentProfile !== 'automatic' && profiles.has(currentProfile) && clickProfileOverride !== 'automatic'
          ? currentProfile
          : automaticProfile;
      if (profiles.size > 1) {
        const profileLabel = document.createElement('label');
        profileLabel.className = 'click-profile-field';
        profileLabel.textContent = 'Wariant z instrukcji · dobór automatyczny';
        const select = document.createElement('select');
        select.id = 'click-profile';
        const automaticOption = document.createElement('option');
        automaticOption.value = 'automatic';
        automaticOption.textContent = 'Dobór automatyczny do obciążenia';
        automaticOption.selected = clickProfileOverride === 'automatic';
        select.append(automaticOption);
        for (const [key, profile] of profiles) {
          const option = document.createElement('option');
          option.value = key;
          option.textContent = `Pokaż ręcznie: ${profile.label}`;
          option.selected = clickProfileOverride === key;
          select.append(option);
        }
        select.value = clickProfileOverride !== 'automatic' && profiles.has(clickProfileOverride) ? clickProfileOverride : 'automatic';
        select.addEventListener('change', () => {
          clickProfileOverride = select.value;
          renderClickPlanner(model);
        });
        profileLabel.append(select);
        clickPlannerContent.append(profileLabel);
      }
      if (!selectedProfile) {
        clickPlannerIntro.textContent = `Dla ${vehicleLabel} instrukcja nie podaje klików dla dokładnie takiego połączenia pasażera i bagażu. Nie przeliczamy kilogramów ani wzrostu na zgadywane wartości.`;
        const notice = document.createElement('p');
        notice.className = 'click-manual-note';
        notice.textContent = 'Zmień obciążenie na wariant opisany przez producenta albo użyj ręcznego podglądu innego wariantu instrukcji. Waga i wzrost są pokazane jako kontekst; nie stanowią tabeli do przeliczenia klików.';
        clickPlannerContent.append(notice);
        return;
      }
      const profile = profiles.get(selectedProfile);
      const wasManuallySelected = clickProfileOverride !== 'automatic';
      if (profile.loadProfileMatch) {
        clickPlannerIntro.textContent = wasManuallySelected
          ? `Podgląd wariantu „${profile.label}” z instrukcji dla ${vehicleLabel}. To ręcznie wybrany punkt odniesienia, nie dopasowanie do wpisanego obciążenia.`
          : `Dopasowano wariant „${profile.label}” z instrukcji dla ${vehicleLabel}. Podane kg i wzrost nie zmieniają klików, jeśli producent nie podaje dla nich osobnej tabeli.`;
      } else {
        clickPlannerIntro.textContent = `Nastawa standardowa producenta dla ${vehicleLabel}. Instrukcja nie podaje odrębnych klików dla wpisanej masy lub wzrostu.`;
      }
      for (const setting of profile.settings) {
        const guide = setting.clickGuide;
        const profileKey = guide.profile || 'default';
        const valueKey = `${profileKey}:${guide.id}`;
        clickPlannerContent.append(makeClickRow({
          id: valueKey,
          label: guide.label,
          mode: 'manufacturer',
          reference: guide.reference,
          countDirection: guide.countDirection,
          baseline: guide.baselineClicks,
          tolerance: guide.tolerance || 0,
          minRange: guide.minRange,
          maxRange: guide.maxRange,
          savedValues,
        }));
      }
      return;
    }

    clickPlannerIntro.textContent = `Dla ${vehicleLabel} nie ma jeszcze potwierdzonych klików producenta. Wpisz wartości z instrukcji — narzędzie porówna je z obecną pozycją, ale nie poda zgadywanej nastawy.`;
    const savedValues = readClickRecord().values || {};
    const manualNotice = document.createElement('p');
    manualNotice.className = 'click-manual-note';
    manualNotice.textContent = 'Wartość docelową i aktualną policz od tego samego ogranicznika wskazanego w instrukcji. Wpisy zapisują się tylko w tej przeglądarce i nie są fabryczną rekomendacją.';
    clickPlannerContent.append(manualNotice);
    for (const adjuster of manualClickAdjusters) {
      clickPlannerContent.append(makeClickRow({
        id: adjuster.id,
        label: adjuster.label,
        mode: 'manual',
        savedValues,
      }));
    }
  }

  function getLoadData() {
    const readOptional = (input) => input.value.trim() === '' ? NaN : Number(input.value);
    return {
      riderWeight: readOptional(riderWeightInput),
      riderHeight: readOptional(riderHeightInput),
      luggageWeight: readOptional(luggageWeightInput),
      cases: Number(luggageCasesInput.value),
      hasPassenger: hasPassengerInput.checked,
      passengerWeight: readOptional(passengerWeightInput),
    };
  }

  function matchesLoadProfile(rule, load) {
    if (rule === 'solo-no-luggage') return !load.hasPassenger && load.cases === 0 && load.luggageWeight === 0;
    if (rule === 'solo-three-cases') return !load.hasPassenger && load.cases === 3;
    if (rule === 'two-riders-three-cases') return load.hasPassenger && load.cases === 3;
    return false;
  }

  function updateLoadSummary({ resetClickOverride = false } = {}) {
    if (resetClickOverride) clickProfileOverride = 'automatic';
    passengerWeightField.hidden = !hasPassengerInput.checked;
    const load = getLoadData();
    const formatter = new Intl.NumberFormat('pl-PL', { maximumFractionDigits: 1 });
    const parts = [];
    const riderWeightValid = Number.isFinite(load.riderWeight) && riderWeightInput.validity.valid;
    const riderHeightValid = Number.isFinite(load.riderHeight) && riderHeightInput.validity.valid;
    const luggageWeightValid = Number.isFinite(load.luggageWeight) && luggageWeightInput.validity.valid;
    const passengerWeightValid = Number.isFinite(load.passengerWeight) && passengerWeightInput.validity.valid;
    const complete = riderWeightValid && riderHeightValid && luggageWeightValid && (!load.hasPassenger || passengerWeightValid);
    if (riderWeightValid) parts.push(`kierowca ${formatter.format(load.riderWeight)} kg`);
    else parts.push(Number.isFinite(load.riderWeight) ? 'sprawdź zakres wagi kierowcy (1–300 kg)' : 'uzupełnij wagę kierowcy');
    if (riderHeightValid) parts.push(`${formatter.format(load.riderHeight)} cm wzrostu`);
    else parts.push(Number.isFinite(load.riderHeight) ? 'sprawdź zakres wzrostu (100–230 cm)' : 'uzupełnij wzrost kierowcy');
    if (load.hasPassenger) {
      if (passengerWeightValid) parts.push(`pasażer ${formatter.format(load.passengerWeight)} kg`);
      else parts.push(Number.isFinite(load.passengerWeight) ? 'sprawdź zakres wagi pasażera (1–250 kg)' : 'uzupełnij wagę pasażera');
    } else {
      parts.push('jazda solo');
    }
    if (luggageWeightValid) parts.push(`bagaż ${formatter.format(load.luggageWeight)} kg`);
    else parts.push(Number.isFinite(load.luggageWeight) ? 'sprawdź zakres bagażu (0–200 kg)' : 'uzupełnij masę bagażu (wpisz 0, jeśli go nie ma)');
    const casesLabel = ['bez kufrów', '1 kufer', '2 kufry', '3 kufry'][load.cases] || '';
    if (casesLabel) parts.push(casesLabel);
    if (complete) {
      const total = load.riderWeight + (load.hasPassenger ? load.passengerWeight : 0) + load.luggageWeight;
      parts.push(`razem osoby + bagaż: ${formatter.format(total)} kg`);
    }
    loadSummary.textContent = `${parts.join(' · ')}. Wzrost i masa są kontekstem; kliki zmieniają się tylko według wariantu opisanego w instrukcji producenta.`;
    loadSummary.dataset.complete = String(complete);
    riderLoadedLabel.textContent = load.hasPassenger || (Number.isFinite(load.luggageWeight) && load.luggageWeight > 0)
      ? 'Pomiar: motocykl w wybranym obciążeniu'
      : 'Pomiar: kierowca z wyposażeniem';
    riderLoadedHelp.textContent = load.hasPassenger || (Number.isFinite(load.luggageWeight) && load.luggageWeight > 0)
      ? 'Kierowca w stroju, pasażer i bagaż zgodnie z podanym wyżej wariantem.'
      : 'Kierowca w pełnym stroju, w pozycji do jazdy.';
    renderClickPlanner(getSelectedModel());
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
    renderClickPlanner(item);
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
    clickProfileOverride = 'automatic';
    const matches = catalog?.models.filter((item) => item.make === makeInput.value && normalize(item.model) === normalize(modelInput.value)) || [];
    if (matches.length === 1 && matches[0].year !== null) yearInput.value = String(matches[0].year);
    populateSuggestions();
    renderModelStatus();
  }

  form.addEventListener('submit', calculate);
  personalSetup.addEventListener('submit', savePersonalSetup);
  personalSetupClear.addEventListener('click', clearPersonalSetup);
  makeInput.addEventListener('change', updateSelectedVehicle);
  modelInput.addEventListener('input', () => { clickProfileOverride = 'automatic'; renderModelStatus(); });
  modelInput.addEventListener('change', updateSelectedVehicle);
  yearInput.addEventListener('input', () => { clickProfileOverride = 'automatic'; renderModelStatus(); });
  yearInput.addEventListener('change', renderModelStatus);
  suspensionSideInput.addEventListener('change', renderModelStatus);
  [riderWeightInput, riderHeightInput, luggageWeightInput, passengerWeightInput].forEach((input) => input.addEventListener('input', () => updateLoadSummary({ resetClickOverride: true })));
  luggageCasesInput.addEventListener('change', () => updateLoadSummary({ resetClickOverride: true }));
  hasPassengerInput.addEventListener('change', () => updateLoadSummary({ resetClickOverride: true }));
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
  updateLoadSummary();
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
    const alreadyControlled = Boolean(navigator.serviceWorker.controller);
    navigator.serviceWorker.addEventListener('controllerchange', () => {
      if (alreadyControlled) window.location.reload();
    });
    window.addEventListener('load', () => navigator.serviceWorker.register('./sw.js', { updateViaCache: 'none' }).then((registration) => {
      registration.update().catch(() => {});
    }).catch(() => {
      catalogMessage.textContent = 'Kalkulator jest dostępny, ale przeglądarka nie uruchomiła trybu offline. Do instalacji wymagany jest HTTPS.';
    }));
  }
})();
