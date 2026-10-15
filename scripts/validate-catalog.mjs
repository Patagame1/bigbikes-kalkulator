import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const filename = resolve(process.argv[2] || 'catalog/catalog.json');
const failures = [];
const requireValue = (condition, message) => { if (!condition) failures.push(message); };
const isObject = (value) => value !== null && typeof value === 'object' && !Array.isArray(value);
const isUtc = (value) => typeof value === 'string' && /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,3})?Z$/.test(value) && Number.isFinite(Date.parse(value));
let catalog;

try {
  catalog = JSON.parse(readFileSync(filename, 'utf8'));
} catch (error) {
  console.error('Could not read valid JSON: ' + error.message);
  process.exit(1);
}

requireValue(isObject(catalog), 'root must be an object');
if (!isObject(catalog)) {
  console.error('Catalog validation failed: root must be an object.');
  process.exit(1);
}
requireValue(catalog.schemaVersion === 1, 'schemaVersion must equal 1');
requireValue(Number.isSafeInteger(catalog.revision) && catalog.revision >= 1, 'revision must be a positive integer');
requireValue(typeof catalog.catalogVersion === 'string' && /^\d+\.\d+\.\d+$/.test(catalog.catalogVersion), 'catalogVersion must use major.minor.patch');
requireValue(isUtc(catalog.publishedAt), 'publishedAt must be an ISO 8601 UTC timestamp');
requireValue(Array.isArray(catalog.makes) && ['VOGE', 'ZONTES', 'KOVE'].every((make) => catalog.makes.includes(make)), 'makes must include VOGE, ZONTES and KOVE');
requireValue(Array.isArray(catalog.models), 'models must be an array');

const allowedMakes = new Set(['VOGE', 'ZONTES', 'KOVE']);
const manufacturerDomains = {
  VOGE: ['voge.pl', 'vogespain.es'],
  ZONTES: ['zontes.com', 'zontes.eu', 'zontesmotos.es', 'sharpon.com'],
  KOVE: ['kovemoto.com'],
};
const hostMatches = (hostname, domain) => hostname === domain || hostname.endsWith('.' + domain);
const modelIds = new Set();
let verifiedCount = 0;
let unverifiedCount = 0;
for (const model of catalog.models || []) {
  const id = model?.id || '(no id)';
  requireValue(isObject(model), 'model must be an object: ' + id);
  if (!isObject(model)) continue;
  requireValue(typeof model.id === 'string' && /^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(model.id), 'invalid model id: ' + id);
  requireValue(!modelIds.has(model.id), 'duplicate model id: ' + id);
  modelIds.add(model.id);
  requireValue(allowedMakes.has(model.make), 'unsupported make on ' + id);
  requireValue(typeof model.model === 'string' && model.model.trim().length > 0 && model.model.length <= 100, 'invalid model name on ' + id);
  requireValue(model.year === null || (Number.isInteger(model.year) && model.year >= 1900 && model.year <= 2100), 'invalid year on ' + id);
  requireValue(['verified', 'unverified'].includes(model.status), 'invalid status on ' + id);
  requireValue(Array.isArray(model.sources), 'sources must be an array on ' + id);
  requireValue(Array.isArray(model.settings), 'settings must be an array on ' + id);
  if (!Array.isArray(model.sources) || !Array.isArray(model.settings)) continue;

  const sourceIds = new Set();
  const sourcesById = new Map();
  const clickProfileMatches = new Map();
  for (const source of model.sources) {
    requireValue(isObject(source), 'source must be an object on ' + id);
    if (!isObject(source)) continue;
    requireValue(typeof source.id === 'string' && !sourceIds.has(source.id), 'missing or duplicate source id on ' + id);
    sourceIds.add(source.id);
    requireValue(typeof source.title === 'string' && source.title.trim().length > 0 && source.title.length <= 160, 'source title is required and must be <= 160 characters on ' + id);
    let sourceUrl;
    try { sourceUrl = new URL(source.url); } catch { sourceUrl = null; }
    requireValue(sourceUrl?.protocol === 'https:', 'source URL must use HTTPS on ' + id);
    if (typeof source.id === 'string') sourcesById.set(source.id, source);
    requireValue(isUtc(source.retrievedAt), 'source retrievedAt must be UTC on ' + id);
    requireValue(source.notes === undefined || (typeof source.notes === 'string' && source.notes.length <= 500), 'source notes must be a string up to 500 characters on ' + id);
  }
  for (const setting of model.settings) {
    requireValue(isObject(setting), 'setting must be an object on ' + id);
    if (!isObject(setting)) continue;
    requireValue(['front', 'rear', 'general'].includes(setting.side), 'setting side must be front, rear or general on ' + id);
    requireValue(typeof setting.name === 'string' && setting.name.trim().length > 0 && setting.name.length <= 120, 'setting name is required and must be <= 120 characters on ' + id);
    requireValue(['number', 'string'].includes(typeof setting.value) && (typeof setting.value !== 'number' || Number.isFinite(setting.value)) && (typeof setting.value !== 'string' || (setting.value.trim().length > 0 && setting.value.length <= 500)), 'setting value must be a finite number or a non-empty string up to 500 characters on ' + id);
    requireValue(setting.unit === undefined || typeof setting.unit === 'string', 'setting unit must be a string on ' + id);
    requireValue(setting.context === undefined || (typeof setting.context === 'string' && setting.context.length <= 500), 'setting context must be a string up to 500 characters on ' + id);
    requireValue(Array.isArray(setting.sourceIds) && setting.sourceIds.length > 0 && setting.sourceIds.every((sourceId) => sourceIds.has(sourceId)), 'every setting must reference an existing source on ' + id);
    if (setting.clickGuide !== undefined) {
      const guide = setting.clickGuide;
      requireValue(isObject(guide), 'clickGuide must be an object on ' + id);
      if (isObject(guide)) {
        requireValue(typeof guide.id === 'string' && /^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(guide.id), 'invalid clickGuide id on ' + id);
        requireValue(typeof guide.label === 'string' && guide.label.trim().length > 0 && guide.label.length <= 100, 'invalid clickGuide label on ' + id);
        requireValue(Number.isInteger(guide.baselineClicks) && guide.baselineClicks >= 0 && guide.baselineClicks <= 1000, 'invalid clickGuide baseline on ' + id);
        requireValue(['hard-stop', 'left-stop', 'right-stop'].includes(guide.reference), 'invalid clickGuide reference on ' + id);
        requireValue(['clockwise', 'counterclockwise'].includes(guide.countDirection), 'invalid clickGuide direction on ' + id);
        requireValue(guide.loadProfileMatch === undefined || ['solo-no-luggage', 'solo-three-cases', 'two-riders-three-cases'].includes(guide.loadProfileMatch), 'invalid automatic load-profile rule on ' + id);
        const profileKey = guide.profile || 'default';
        const matchKey = guide.loadProfileMatch || '';
        requireValue(!clickProfileMatches.has(profileKey) || clickProfileMatches.get(profileKey) === matchKey, 'inconsistent automatic load-profile rule for ' + profileKey + ' on ' + id);
        clickProfileMatches.set(profileKey, matchKey);
      }
    }
    const settingSources = (setting.sourceIds || []).map((sourceId) => sourcesById.get(sourceId)).filter(Boolean);
    requireValue(settingSources.length > 0 && settingSources.every((source) => {
      try {
        const hostname = new URL(source.url).hostname.toLowerCase();
        return (manufacturerDomains[model.make] || []).some((domain) => hostMatches(hostname, domain));
      } catch { return false; }
    }), 'setting sources must be official manufacturer documentation for ' + model.make + ' on ' + id);
  }
  if (model.specifications !== undefined) {
    requireValue(Array.isArray(model.specifications), 'specifications must be an array on ' + id);
    for (const spec of model.specifications || []) {
      requireValue(['front', 'rear'].includes(spec.side) && spec.kind === 'travel', 'invalid specification kind or side on ' + id);
      requireValue(typeof spec.name === 'string' && spec.name.trim().length > 0, 'specification name is required on ' + id);
      requireValue(typeof spec.value === 'number' && Number.isFinite(spec.value) && spec.value > 0, 'specification value must be a positive number on ' + id);
      requireValue(spec.unit === undefined || typeof spec.unit === 'string', 'invalid specification unit on ' + id);
      requireValue(Array.isArray(spec.sourceIds) && spec.sourceIds.length > 0 && spec.sourceIds.every((sourceId) => sourceIds.has(sourceId)), 'every specification must reference an existing source on ' + id);
    }
  }
  if (model.status === 'verified') {
    verifiedCount += 1;
    requireValue(model.settings.length > 0 && model.sources.length > 0, 'verified models need sourced settings on ' + id);
  } else {
    unverifiedCount += 1;
    requireValue(model.settings.length === 0, 'unverified models must not publish settings on ' + id);
  }
  if (model.year === null) {
    requireValue(model.status === 'unverified' && model.settings.length === 0 && (!model.specifications || model.specifications.length === 0), 'models without a confirmed year cannot publish settings or specifications on ' + id);
  }
}

if (failures.length) {
  console.error('Catalog validation failed:');
  for (const failure of failures) console.error(' - ' + failure);
  process.exit(1);
}
console.log('Catalog valid: ' + catalog.catalogVersion + ' (revision ' + catalog.revision + ')');
console.log(catalog.models.length + ' model(s): ' + verifiedCount + ' verified, ' + unverifiedCount + ' without verified settings.');
