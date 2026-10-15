import { readFile, rename, writeFile, mkdir, unlink } from 'node:fs/promises';
import { spawnSync } from 'node:child_process';
import { resolve } from 'node:path';

const ROOT = process.cwd();
const CATALOG_PATH = resolve(ROOT, 'catalog/catalog.json');
const RELEASES_PATH = resolve(ROOT, 'catalog/releases');
const MANUFACTURER_SOURCES = [
  { make: 'VOGE', title: 'VOGE Polska · aktualne modele', url: 'https://voge.pl/modele', kind: 'voge', minimumModels: 5 },
  { make: 'VOGE', title: 'VOGE Polska · modele archiwalne', url: 'https://voge.pl/modele-archiwalne', kind: 'voge', minimumModels: 2 },
  { make: 'ZONTES', title: 'ZONTES · lista modeli producenta', url: 'https://www.zontes.com/en/Products/ProductsList.aspx', kind: 'zontes', minimumModels: 5 },
  { make: 'KOVE', title: 'KOVE · lista modeli producenta', url: 'https://www.kovemoto.com/models', kind: 'kove', minimumModels: 3 },
];
const WRITE_MODE = process.argv.includes('--write');
const DRY_RUN = process.argv.includes('--dry-run') || !WRITE_MODE;

const decodeEntities = (value) => value
  .replace(/&#(\d+);/g, (_, number) => String.fromCodePoint(Number(number)))
  .replace(/&#x([\da-f]+);/gi, (_, number) => String.fromCodePoint(parseInt(number, 16)))
  .replace(/&nbsp;/gi, ' ')
  .replace(/&amp;/gi, '&')
  .replace(/&quot;/gi, '"')
  .replace(/&apos;/gi, "'")
  .replace(/&lt;/gi, '<')
  .replace(/&gt;/gi, '>')
  .replace(/&ndash;/gi, '–')
  .replace(/&mdash;/gi, '—')
  .replace(/&rsquo;/gi, '’')
  .replace(/&lsquo;/gi, '‘')
  .replace(/&rdquo;/gi, '”')
  .replace(/&ldquo;/gi, '“');

const cleanText = (html) => decodeEntities(html
  .replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, ' ')
  .replace(/<style\b[^>]*>[\s\S]*?<\/style>/gi, ' ')
  .replace(/<[^>]+>/g, ' ')
  .replace(/\s+/g, ' '))
  .trim();

const normalized = (value) => value
  .normalize('NFKD')
  .replace(/[\u0300-\u036f]/g, '')
  .toLocaleLowerCase('pl-PL')
  .replace(/[^a-z0-9]+/g, ' ')
  .trim();

function modelFromManufacturerLink(source, title, href) {
  const url = new URL(href, source.url);
  let model = title.replace(/\s+/g, ' ').trim();

  if (source.kind === 'voge') {
    if (!/\/modele(?:-archiwalne)?\//i.test(url.pathname)) return null;
    model = model.replace(/^voge\s+/i, '').replace(/^nowość\s+/i, '').replace(/^zobacz model\s*/i, '').trim();
    if (!model) model = url.pathname.split('/').filter(Boolean).at(-1)?.replace(/-/g, ' ').toUpperCase() || '';
    if (/^modele?\b/i.test(model)) return null;
  } else if (source.kind === 'kove') {
    if (!/\/kove-[^/]+/i.test(url.pathname)) return null;
    model = model.replace(/^kove\s+/i, '').replace(/\s+(?:CN4\/E5\+|CN4\+?|E5\+).*$/i, '').trim();
    if (!model) model = url.pathname.split('/').filter(Boolean).at(-1)?.replace(/^kove-/i, '').replace(/-/g, ' ').toUpperCase() || '';
  } else if (source.kind === 'zontes') {
    if (!/ModelsDetailed\.aspx\?Cid=/i.test(`${url.pathname}${url.search}`)) return null;
    model = model.replace(/^zontes\s+/i, '').trim();
    if (!/^(?:ZT\s*)?\d{2,3}[A-Z0-9 -]{0,16}$|^GK\s*\d{3}$|^TDR\s*\dZ$/i.test(model)) return null;
  }

  model = model.replace(/[|·•]+$/g, '').trim();
  if (!model || model.length > 100 || /^(promocja|akcesoria|części|wyprzedane|download|for sale)$/i.test(model)) return null;
  return { make: source.make, model, url: url.toString(), sourceTitle: source.title };
}

function extractManufacturerModels(html, source) {
  const found = new Map();
  const anchorPattern = /<a\b([^>]*)>([\s\S]*?)<\/a\s*>/gi;
  for (const match of html.matchAll(anchorPattern)) {
    const hrefMatch = /\bhref\s*=\s*["']([^"']+)["']/i.exec(match[1]);
    if (!hrefMatch) continue;
    const titleAttribute = /\b(?:title|aria-label)\s*=\s*["']([^"']+)["']/i.exec(match[1]);
    const headingMatch = /<h[1-6]\b[^>]*>([\s\S]*?)<\/h[1-6]\s*>/i.exec(match[2]);
    const plainText = cleanText(match[2]);
    const callToAction = [...plainText.matchAll(/\bzobacz model\s+([a-z0-9]+(?:[\s-]+[a-z0-9]+){0,2})/gi)].at(-1)?.[1];
    const title = cleanText(headingMatch?.[1] || '') || decodeEntities(titleAttribute?.[1] || '').trim() || callToAction || plainText;
    const entry = modelFromManufacturerLink(source, title, hrefMatch[1]);
    if (!entry) continue;
    const key = `${entry.make}:${normalized(entry.model)}`;
    found.set(key, entry);
  }
  return [...found.values()];
}

async function fetchManufacturerSource(source) {
  const url = source.url;
  const response = await fetch(url, {
    headers: { Accept: 'text/html', 'User-Agent': 'BigBikes-CatalogSync/1.0 (+official-manufacturer-model-index)' },
    signal: AbortSignal.timeout(20000),
  });
  if (!response.ok) throw new Error(`${source.make} zwrócił HTTP ${response.status} dla strony ${url}`);
  const html = await response.text();
  if (!html || html.length < 500) throw new Error(`Strona ${url} jest pusta lub niekompletna`);
  const models = extractManufacturerModels(html, source);
  if (models.length < source.minimumModels) throw new Error(`Rozpoznano tylko ${models.length} modeli na oficjalnej stronie ${url} (minimum kontrolne: ${source.minimumModels}); katalog pozostaje bez zmian.`);
  console.log(`- ${source.title}: ${models.length} rozpoznanych modeli.`);
  return models;
}

async function readManufacturerModels() {
  const all = new Map();
  for (const source of MANUFACTURER_SOURCES) {
    const models = await fetchManufacturerSource(source);
    for (const model of models) {
      const key = `${model.make}:${normalized(model.model)}`;
      all.set(key, model);
    }
  }
  return { models: [...all.values()], sourcesRead: MANUFACTURER_SOURCES.length };
}

function makeId(make, model, existingIds) {
  const base = `bb-${normalized(`${make} ${model}`).replace(/\s+/g, '-')}`;
  let id = base;
  let suffix = 2;
  while (existingIds.has(id)) id = `${base}-${suffix++}`;
  existingIds.add(id);
  return id;
}

function incrementMinor(version) {
  const [major, minor] = version.split('.').map(Number);
  return `${major}.${minor + 1}.0`;
}

async function saveCatalogAtomically(path, contents) {
  const temporaryPath = `${path}.tmp`;
  await writeFile(temporaryPath, contents, 'utf8');
  await rename(temporaryPath, path);
}

async function main() {
  const catalog = JSON.parse(await readFile(CATALOG_PATH, 'utf8'));
  if (catalog.schemaVersion !== 1 || !Array.isArray(catalog.models) || !Number.isSafeInteger(catalog.revision)) {
    throw new Error('Bieżący katalog nie spełnia podstawowego formatu. Nic nie zapisano.');
  }

  const { models: remoteModels, sourcesRead } = await readManufacturerModels();
  const knownNames = new Set(catalog.models.map((entry) => `${entry.make}:${normalized(entry.model)}`));
  const ids = new Set(catalog.models.map((entry) => entry.id));
  const additions = remoteModels.filter((entry) => !knownNames.has(`${entry.make}:${normalized(entry.model)}`));
  const retrievedAt = new Date().toISOString().replace(/\.\d{3}Z$/, 'Z');

  console.log(`Sprawdzone oficjalne źródła producentów: ${sourcesRead}.`);
  console.log(`Rozpoznane modele VOGE/ZONTES/KOVE: ${remoteModels.length}.`);
  if (additions.length === 0) {
    console.log('Katalog jest aktualny. Nie zmieniono plików.');
    return;
  }

  console.log(`Nowe nazwy (${additions.length}); zostaną dodane bez zweryfikowanych nastaw:`);
  for (const entry of additions) console.log(`- ${entry.make} ${entry.model}`);
  if (DRY_RUN) {
    console.log('Tryb podglądu: katalog nie został zapisany. Dodaj --write, aby opublikować nowe wpisy.');
    return;
  }

  const nextCatalog = structuredClone(catalog);
  nextCatalog.models.push(...additions.map((entry) => ({
    id: makeId(entry.make, entry.model, ids),
    make: entry.make,
    model: entry.model,
    year: null,
    status: 'unverified',
    notes: 'Model rozpoznany w katalogu producenta. Brak zweryfikowanych nastaw zawieszenia; wpis nie stanowi zalecenia.',
    sources: [{
      id: `manufacturer-${entry.make.toLowerCase()}-${normalized(entry.model).replace(/\s+/g, '-')}`,
      title: `${entry.make} · katalog producenta · ${entry.model}`,
      url: entry.url,
      retrievedAt,
      notes: 'Źródło potwierdza nazwę modelu. Nastawy, rocznik i parametry zawieszenia nie są z tej strony automatycznie wyprowadzane.',
    }],
    specifications: [],
    settings: [],
  })));
  nextCatalog.revision += 1;
  nextCatalog.catalogVersion = incrementMinor(catalog.catalogVersion);
  nextCatalog.publishedAt = retrievedAt;

  const validatorPath = resolve(ROOT, 'scripts/validate-catalog.mjs');
  const validation = spawnSync(process.execPath, [validatorPath, CATALOG_PATH.replace(/\\/g, '/')], { encoding: 'utf8' });
  if (validation.error) throw validation.error;
  if (validation.status !== 0) throw new Error(`Nie można uruchomić walidatora katalogu: ${validation.stderr || validation.stdout}`);

  // Validate the proposed document in a temporary path before preserving or replacing anything.
  const temporaryPath = `${CATALOG_PATH}.candidate.json`;
  try {
    await writeFile(temporaryPath, `${JSON.stringify(nextCatalog, null, 2)}\n`, 'utf8');
    const candidateValidation = spawnSync(process.execPath, [validatorPath, temporaryPath.replace(/\\/g, '/')], { encoding: 'utf8' });
    if (candidateValidation.error || candidateValidation.status !== 0) {
      const detail = candidateValidation.error?.message || candidateValidation.stderr || candidateValidation.stdout;
      throw new Error(`Proponowany katalog nie przeszedł walidacji: ${detail}`);
    }
  } finally {
    await unlink(temporaryPath).catch(() => {});
  }

  await mkdir(RELEASES_PATH, { recursive: true });
  const backupPath = resolve(RELEASES_PATH, `${catalog.catalogVersion}-r${catalog.revision}.json`);
  await writeFile(backupPath, `${JSON.stringify(catalog, null, 2)}\n`, { encoding: 'utf8', flag: 'wx' }).catch((error) => {
    if (error.code !== 'EEXIST') throw error;
  });
  await saveCatalogAtomically(CATALOG_PATH, `${JSON.stringify(nextCatalog, null, 2)}\n`);
  console.log(`Zapisano katalog ${nextCatalog.catalogVersion}, rewizja ${nextCatalog.revision}. Kopia poprzedniej wersji: ${backupPath}`);
}

main().catch((error) => {
  console.error(`Aktualizacja katalogu przerwana: ${error.message}`);
  process.exitCode = 1;
});
