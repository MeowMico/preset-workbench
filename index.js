const fs = require('node:fs');
const fsp = require('node:fs/promises');
const path = require('node:path');
const crypto = require('node:crypto');
const express = require('express');

let sanitizeFilename = null;
try {
  sanitizeFilename = require('sanitize-filename');
} catch {
  sanitizeFilename = null;
}

const PLUGIN_ID = 'preset-workbench';
const SNAPSHOT_TYPE = 'preset-workbench.snapshot';
const SNAPSHOT_VERSION = 1;
const HISTORY_API_VERSION = 1;

const info = {
  id: PLUGIN_ID,
  name: 'Preset Workbench',
  description: 'Prompt preset editing, local version history, annotations, rollback, and request console for SillyTavern.',
};

const API_CONFIG = {
  openai: {
    label: 'Chat Completion',
    directory: 'openAI_Settings',
    extension: '.json',
  },
  textgenerationwebui: {
    label: 'Text Completion',
    directory: 'textGen_Settings',
    extension: '.json',
  },
  kobold: {
    label: 'Kobold / Horde',
    directory: 'koboldAI_Settings',
    extension: '.json',
  },
  novel: {
    label: 'NovelAI',
    directory: 'novelAI_Settings',
    extension: '.json',
  },
  instruct: {
    label: 'Instruct Template',
    directory: 'instruct',
    extension: '.json',
  },
  context: {
    label: 'Context Template',
    directory: 'context',
    extension: '.json',
  },
  sysprompt: {
    label: 'System Prompt',
    directory: 'sysprompt',
    extension: '.json',
  },
  reasoning: {
    label: 'Reasoning Formatting',
    directory: 'reasoning',
    extension: '.json',
  },
};

async function init(router) {
  router.use(express.json({ limit: '50mb' }));

  router.get('/status', asyncRoute(async (req, res) => {
    requireUser(req);
    res.json({
      ok: true,
      id: PLUGIN_ID,
      version: HISTORY_API_VERSION,
      apis: listAvailableApis(req.user.directories),
      storage: 'server-files',
    });
  }));

  router.get('/apis', asyncRoute(async (req, res) => {
    requireUser(req);
    res.json({ ok: true, apis: listAvailableApis(req.user.directories) });
  }));

  router.get('/presets', asyncRoute(async (req, res) => {
    requireUser(req);
    const apiId = cleanApiId(req.query.apiId || 'openai');
    const presets = await listPresets(req.user.directories, apiId);
    res.json({ ok: true, apiId, presets });
  }));

  router.get('/preset', asyncRoute(async (req, res) => {
    requireUser(req);
    const apiId = cleanApiId(req.query.apiId || 'openai');
    const name = cleanName(req.query.name);
    if (!name) return res.status(400).json({ ok: false, error: 'missing_name' });
    const data = await readPreset(req.user.directories, apiId, name);
    res.json({ ok: true, apiId, preset: summarizePreset(apiId, name, data), data });
  }));

  router.post('/preset', asyncRoute(async (req, res) => {
    requireUser(req);
    const apiId = cleanApiId(req.body?.apiId || 'openai');
    const name = cleanName(req.body?.name);
    const data = req.body?.data;
    if (!name || !data || typeof data !== 'object') {
      return res.status(400).json({ ok: false, error: 'missing_preset' });
    }
    await writePreset(req.user.directories, apiId, name, data);
    res.json({ ok: true, apiId, preset: summarizePreset(apiId, name, data) });
  }));

  router.get('/history/status', asyncRoute(async (req, res) => {
    requireUser(req);
    res.json({
      ok: true,
      storage: 'server-files',
      version: HISTORY_API_VERSION,
      root: PLUGIN_ID,
    });
  }));

  router.get('/history', asyncRoute(async (req, res) => {
    requireUser(req);
    const apiId = cleanApiId(req.query.apiId || 'openai');
    const name = cleanName(req.query.name);
    if (!name) return res.status(400).json({ ok: false, error: 'missing_name' });
    const snapshots = await listFullSnapshots(req.user.directories, apiId, name);
    res.json({ ok: true, storage: 'server-files', apiId, snapshots });
  }));

  router.get('/snapshots', asyncRoute(async (req, res) => {
    requireUser(req);
    const apiId = cleanApiId(req.query.apiId || 'openai');
    const name = cleanName(req.query.name);
    if (!name) return res.status(400).json({ ok: false, error: 'missing_name' });
    const snapshots = await listSnapshots(req.user.directories, apiId, name);
    res.json({ ok: true, apiId, snapshots });
  }));

  router.get('/snapshot', asyncRoute(async (req, res) => {
    requireUser(req);
    const apiId = cleanApiId(req.query.apiId || 'openai');
    const name = cleanName(req.query.name);
    const file = cleanSnapshotFile(req.query.file);
    if (!name || !file) return res.status(400).json({ ok: false, error: 'missing_params' });
    const snapshot = await readSnapshot(req.user.directories, apiId, name, file);
    res.json({ ok: true, apiId, snapshot: fullSnapshot(snapshot, file) });
  }));

  router.post('/snapshots', asyncRoute(async (req, res) => {
    requireUser(req);
    const apiId = cleanApiId(req.body?.apiId || 'openai');
    const name = cleanName(req.body?.name);
    if (!name) return res.status(400).json({ ok: false, error: 'missing_name' });

    const data = req.body?.data && typeof req.body.data === 'object'
      ? req.body.data
      : await readPreset(req.user.directories, apiId, name);
    const result = await createSnapshot(req.user.directories, apiId, name, data, {
      label: req.body?.label,
      note: req.body?.note,
      modelTag: req.body?.modelTag,
      cardTag: req.body?.cardTag,
      reason: req.body?.reason || 'manual',
      skipDuplicate: req.body?.skipDuplicate !== false,
    });

    res.json({ ok: true, apiId, ...result });
  }));

  router.post('/snapshot/label', asyncRoute(async (req, res) => {
    requireUser(req);
    const apiId = cleanApiId(req.body?.apiId || 'openai');
    const name = cleanName(req.body?.name);
    const file = cleanSnapshotFile(req.body?.file);
    if (!name || !file) return res.status(400).json({ ok: false, error: 'missing_params' });

    const snapshot = await updateSnapshotLabel(req.user.directories, apiId, name, file, {
      label: req.body?.label,
      note: req.body?.note,
      modelTag: req.body?.modelTag,
      cardTag: req.body?.cardTag,
    });
    res.json({ ok: true, apiId, snapshot: summarizeSnapshot(snapshot, file) });
  }));

  router.post('/restore', asyncRoute(async (req, res) => {
    requireUser(req);
    const apiId = cleanApiId(req.body?.apiId || 'openai');
    const name = cleanName(req.body?.name);
    const file = cleanSnapshotFile(req.body?.file);
    if (!name || !file) return res.status(400).json({ ok: false, error: 'missing_params' });

    const snapshot = await readSnapshot(req.user.directories, apiId, name, file);
    const before = await createSnapshot(req.user.directories, apiId, name, await readPreset(req.user.directories, apiId, name), {
      label: `Before restore ${formatDateForLabel(new Date())}`,
      reason: 'pre-restore',
      skipDuplicate: false,
    });
    await writePreset(req.user.directories, apiId, name, snapshot.data);
    res.json({ ok: true, apiId, restored: summarizeSnapshot(snapshot, file), before });
  }));

  router.get('/compare', asyncRoute(async (req, res) => {
    requireUser(req);
    const apiId = cleanApiId(req.query.apiId || 'openai');
    const name = cleanName(req.query.name);
    const file = cleanSnapshotFile(req.query.file);
    if (!name || !file) return res.status(400).json({ ok: false, error: 'missing_params' });

    const current = await readPreset(req.user.directories, apiId, name);
    const snapshot = await readSnapshot(req.user.directories, apiId, name, file);
    res.json({
      ok: true,
      apiId,
      base: summarizeSnapshot(snapshot, file),
      current: summarizePreset(apiId, name, current),
      diff: diffPresets(snapshot.data, current),
    });
  }));

  router.get('/compare-snapshots', asyncRoute(async (req, res) => {
    requireUser(req);
    const apiId = cleanApiId(req.query.apiId || 'openai');
    const name = cleanName(req.query.name);
    const leftFile = cleanSnapshotFile(req.query.left);
    const rightFile = cleanSnapshotFile(req.query.right);
    if (!name || !leftFile || !rightFile) return res.status(400).json({ ok: false, error: 'missing_params' });

    const left = await readSnapshot(req.user.directories, apiId, name, leftFile);
    const right = await readSnapshot(req.user.directories, apiId, name, rightFile);
    res.json({
      ok: true,
      apiId,
      base: summarizeSnapshot(left, leftFile),
      current: summarizeSnapshot(right, rightFile),
      diff: diffPresets(left.data, right.data),
    });
  }));

  console.log(`[${PLUGIN_ID}] loaded. API: /api/plugins/${PLUGIN_ID}/status`);
}

async function exit() {
  return Promise.resolve();
}

function asyncRoute(fn) {
  return (req, res) => Promise.resolve(fn(req, res)).catch((error) => {
    console.error(`[${PLUGIN_ID}] request failed`, error);
    res.status(error.statusCode || 500).json({ ok: false, error: error.code || 'internal_error', message: error.message });
  });
}

function requireUser(req) {
  if (!req.user?.directories) {
    const error = new Error('SillyTavern user session is required.');
    error.statusCode = 403;
    error.code = 'missing_user';
    throw error;
  }
}

function listAvailableApis(directories) {
  return Object.entries(API_CONFIG)
    .filter(([, config]) => typeof directories?.[config.directory] === 'string')
    .map(([id, config]) => ({
      id,
      label: config.label,
      directory: config.directory,
    }));
}

async function listPresets(directories, apiId) {
  const settings = presetSettings(directories, apiId);
  const files = await fsp.readdir(settings.folder, { withFileTypes: true }).catch(error => {
    if (error.code === 'ENOENT') return [];
    throw error;
  });
  const presets = [];
  for (const file of files) {
    if (!file.isFile() || path.extname(file.name).toLowerCase() !== settings.extension) continue;
    const name = path.parse(file.name).name;
    try {
      const data = await readPreset(directories, apiId, name);
      const stat = await fsp.stat(path.join(settings.folder, file.name)).catch(() => null);
      presets.push({ ...summarizePreset(apiId, name, data), updatedAt: stat?.mtime?.toISOString() || null });
    } catch (error) {
      presets.push({ apiId, name, file: file.name, error: error.message, promptCount: 0, orderCount: 0, sourceHash: '' });
    }
  }
  return presets.sort((left, right) => left.name.localeCompare(right.name));
}

async function readPreset(directories, apiId, name) {
  const filePath = presetPath(directories, apiId, name);
  const text = await fsp.readFile(filePath, 'utf8');
  const data = JSON.parse(text);
  if (!data || typeof data !== 'object' || Array.isArray(data)) {
    throw Object.assign(new Error('Preset must be a JSON object.'), { code: 'invalid_preset' });
  }
  return data;
}

async function writePreset(directories, apiId, name, data) {
  if (!data || typeof data !== 'object' || Array.isArray(data)) {
    throw Object.assign(new Error('Preset must be a JSON object.'), { code: 'invalid_preset' });
  }
  await writeJsonAtomic(presetPath(directories, apiId, name), data);
}

function presetPath(directories, apiId, name) {
  const settings = presetSettings(directories, apiId);
  const filename = `${safeSegment(name)}${settings.extension}`;
  const target = path.join(settings.folder, filename);
  if (!isPathInside(settings.folder, target)) {
    throw Object.assign(new Error('Invalid preset path.'), { code: 'invalid_path', statusCode: 400 });
  }
  return target;
}

function presetSettings(directories, apiId) {
  const normalized = normalizeApiId(apiId);
  const config = API_CONFIG[normalized];
  const folder = config ? directories?.[config.directory] : null;
  if (!config || !folder) {
    throw Object.assign(new Error(`Unsupported preset API: ${apiId}`), { code: 'unsupported_api', statusCode: 400 });
  }
  return { ...config, apiId: normalized, folder };
}

async function createSnapshot(directories, apiId, name, data, options = {}) {
  const hash = hashObject(data);
  const snapshots = await listSnapshots(directories, apiId, name);
  const latest = snapshots[0];
  if (options.skipDuplicate && latest?.sourceHash === hash) {
    return { skipped: true, snapshot: latest };
  }

  const now = new Date();
  const dir = await ensureSnapshotDir(directories, apiId, name);
  const file = `${formatDateForFile(now)}__${hash.slice(0, 10)}.json`;
  const snapshot = {
    type: SNAPSHOT_TYPE,
    version: SNAPSHOT_VERSION,
    id: `${normalizeApiId(apiId)}:${safeSegment(name)}:${file}`,
    apiId: normalizeApiId(apiId),
    presetName: name,
    presetFile: `${safeSegment(name)}.json`,
    label: cleanOptionalText(options.label) || defaultSnapshotLabel(options.reason),
    note: cleanOptionalText(options.note),
    modelTag: cleanOptionalText(options.modelTag),
    cardTag: cleanOptionalText(options.cardTag),
    reason: cleanOptionalText(options.reason) || 'manual',
    createdAt: now.toISOString(),
    createdAtMs: now.getTime(),
    sourceHash: hash,
    promptCount: countPrompts(data),
    orderCount: countPromptOrder(data),
    data,
  };
  await writeJsonAtomic(path.join(dir, file), snapshot);
  return { skipped: false, snapshot: summarizeSnapshot(snapshot, file) };
}

async function listFullSnapshots(directories, apiId, name) {
  const dir = snapshotDir(directories, apiId, name);
  if (!fs.existsSync(dir)) return [];
  const files = await fsp.readdir(dir, { withFileTypes: true });
  const out = [];
  for (const file of files) {
    if (!file.isFile() || path.extname(file.name).toLowerCase() !== '.json') continue;
    try {
      const snapshot = JSON.parse(await fsp.readFile(path.join(dir, file.name), 'utf8'));
      if (snapshot?.type === SNAPSHOT_TYPE && snapshot.data) {
        out.push(fullSnapshot(snapshot, file.name));
      }
    } catch {
      // Ignore malformed files in the full-history API.
    }
  }
  return sortSnapshots(out);
}

async function listSnapshots(directories, apiId, name) {
  const dir = snapshotDir(directories, apiId, name);
  if (!fs.existsSync(dir)) return [];
  const files = await fsp.readdir(dir, { withFileTypes: true });
  const out = [];
  for (const file of files) {
    if (!file.isFile() || path.extname(file.name).toLowerCase() !== '.json') continue;
    try {
      const snapshot = JSON.parse(await fsp.readFile(path.join(dir, file.name), 'utf8'));
      if (snapshot?.type === SNAPSHOT_TYPE) {
        out.push(summarizeSnapshot(snapshot, file.name));
      }
    } catch (error) {
      out.push({ file: file.name, error: error.message, createdAtMs: 0 });
    }
  }
  return sortSnapshots(out);
}

async function readSnapshot(directories, apiId, name, file) {
  const dir = snapshotDir(directories, apiId, name);
  const target = path.join(dir, file);
  if (!isPathInside(dir, target)) {
    throw Object.assign(new Error('Invalid snapshot path.'), { code: 'invalid_path', statusCode: 400 });
  }
  const snapshot = JSON.parse(await fsp.readFile(target, 'utf8'));
  if (snapshot?.type !== SNAPSHOT_TYPE || !snapshot.data) {
    throw Object.assign(new Error('Invalid snapshot file.'), { code: 'invalid_snapshot', statusCode: 400 });
  }
  return snapshot;
}

async function updateSnapshotLabel(directories, apiId, name, file, { label, note, modelTag, cardTag }) {
  const snapshot = await readSnapshot(directories, apiId, name, file);
  snapshot.label = cleanOptionalText(label) || snapshot.label || '';
  snapshot.note = cleanOptionalText(note);
  snapshot.modelTag = cleanOptionalText(modelTag);
  snapshot.cardTag = cleanOptionalText(cardTag);
  snapshot.updatedAt = new Date().toISOString();
  await writeJsonAtomic(path.join(snapshotDir(directories, apiId, name), file), snapshot);
  return snapshot;
}

async function ensureSnapshotDir(directories, apiId, name) {
  const dir = snapshotDir(directories, apiId, name);
  await fsp.mkdir(dir, { recursive: true });
  return dir;
}

function snapshotDir(directories, apiId, name) {
  const root = path.join(directories.backups, PLUGIN_ID, normalizeApiId(apiId));
  const target = path.join(root, safeSegment(name));
  if (!isPathInside(root, target)) {
    throw Object.assign(new Error('Invalid snapshot directory.'), { code: 'invalid_path', statusCode: 400 });
  }
  return target;
}

function summarizePreset(apiId, name, data) {
  return {
    apiId: normalizeApiId(apiId),
    name,
    file: `${safeSegment(name)}.json`,
    title: cleanOptionalText(data?.name) || name,
    sourceHash: hashObject(data),
    promptCount: countPrompts(data),
    orderCount: countPromptOrder(data),
    settingCount: countSettings(data),
    model: inferPresetModel(data),
    chatCompletionSource: cleanOptionalText(data?.chat_completion_source),
  };
}

function summarizeSnapshot(snapshot, file) {
  return {
    file,
    id: snapshot.id || file,
    apiId: snapshot.apiId || 'openai',
    presetName: snapshot.presetName || snapshot.name || '',
    label: snapshot.label || '',
    note: snapshot.note || '',
    modelTag: snapshot.modelTag || '',
    cardTag: snapshot.cardTag || '',
    reason: snapshot.reason || '',
    createdAt: snapshot.createdAt,
    createdAtMs: snapshot.createdAtMs || Date.parse(snapshot.createdAt || '') || 0,
    sourceHash: snapshot.sourceHash,
    promptCount: snapshot.promptCount ?? countPrompts(snapshot.data),
    orderCount: snapshot.orderCount ?? countPromptOrder(snapshot.data),
  };
}

function fullSnapshot(snapshot, file) {
  return {
    ...snapshot,
    ...summarizeSnapshot(snapshot, file),
  };
}

function sortSnapshots(snapshots) {
  return snapshots.sort((left, right) => Number(right.createdAtMs || 0) - Number(left.createdAtMs || 0));
}

function diffPresets(base, current) {
  const promptEntries = diffPromptEntries(base, current);
  const settingEntries = diffTopLevelSettings(base, current);
  return {
    summary: {
      added: promptEntries.filter(x => x.status === 'added').length,
      removed: promptEntries.filter(x => x.status === 'removed').length,
      changed: promptEntries.filter(x => x.status === 'changed').length,
      unchanged: promptEntries.filter(x => x.status === 'unchanged').length,
      settings: settingEntries.length,
    },
    entries: promptEntries.filter(x => x.status !== 'unchanged'),
    settings: settingEntries,
  };
}

function diffPromptEntries(base, current) {
  const basePrompts = normalizePromptRecords(base);
  const currentPrompts = normalizePromptRecords(current);
  const allIds = [...new Set([...Object.keys(basePrompts), ...Object.keys(currentPrompts)])]
    .sort((left, right) => promptTitle(basePrompts[left] || currentPrompts[left]).localeCompare(promptTitle(basePrompts[right] || currentPrompts[right])));

  const entries = [];
  for (const id of allIds) {
    const before = basePrompts[id] || null;
    const after = currentPrompts[id] || null;
    if (!before) {
      entries.push({ id, status: 'added', title: promptTitle(after), fields: [] });
      continue;
    }
    if (!after) {
      entries.push({ id, status: 'removed', title: promptTitle(before), fields: [] });
      continue;
    }
    const fields = diffPromptFields(before, after);
    entries.push({
      id,
      status: fields.length ? 'changed' : 'unchanged',
      title: promptTitle(after),
      fields,
    });
  }
  return entries;
}

function diffPromptFields(before, after) {
  const fields = [
    ['name', before.prompt?.name, after.prompt?.name],
    ['role', before.prompt?.role, after.prompt?.role],
    ['content', before.prompt?.content, after.prompt?.content],
    ['enabled', before.order?.enabled, after.order?.enabled],
    ['order', before.orderIndex, after.orderIndex],
    ['injection_position', before.prompt?.injection_position, after.prompt?.injection_position],
    ['injection_depth', before.prompt?.injection_depth, after.prompt?.injection_depth],
    ['injection_order', before.prompt?.injection_order, after.prompt?.injection_order],
    ['injection_trigger', before.prompt?.injection_trigger, after.prompt?.injection_trigger],
    ['forbid_overrides', before.prompt?.forbid_overrides, after.prompt?.forbid_overrides],
    ['system_prompt', before.prompt?.system_prompt, after.prompt?.system_prompt],
    ['marker', before.prompt?.marker, after.prompt?.marker],
  ];

  return fields
    .map(([name, leftValue, rightValue]) => {
      const left = comparableField(leftValue);
      const right = comparableField(rightValue);
      if (left === right) return null;
      return {
        name,
        before: left,
        after: right,
        lines: name === 'content' ? diffLines(String(left), String(right)) : [],
      };
    })
    .filter(Boolean);
}

function diffTopLevelSettings(base, current) {
  const ignored = new Set(['prompts', 'prompt_order']);
  const keys = [...new Set([
    ...Object.keys(base || {}),
    ...Object.keys(current || {}),
  ])].filter(key => !ignored.has(key)).sort();

  return keys
    .map((key) => {
      const left = comparableField(base?.[key]);
      const right = comparableField(current?.[key]);
      if (left === right) return null;
      return {
        name: key,
        before: left,
        after: right,
        lines: looksMultiline(left, right) ? diffLines(left, right) : [],
      };
    })
    .filter(Boolean);
}

function normalizePromptRecords(data) {
  const prompts = Array.isArray(data?.prompts) ? data.prompts : [];
  const order = getGlobalPromptOrder(data);
  const records = {};

  prompts.forEach((prompt, index) => {
    if (!prompt || typeof prompt !== 'object') return;
    const id = cleanOptionalText(prompt.identifier) || `prompt:${index}`;
    records[id] = {
      prompt,
      order: null,
      orderIndex: null,
    };
  });

  order.forEach((item, index) => {
    if (!item || typeof item !== 'object') return;
    const id = cleanOptionalText(item.identifier);
    if (!id) return;
    if (!records[id]) records[id] = { prompt: { identifier: id, name: id, marker: true }, order: null, orderIndex: null };
    records[id].order = item;
    records[id].orderIndex = index;
  });

  return records;
}

function getGlobalPromptOrder(data) {
  if (!Array.isArray(data?.prompt_order)) return [];
  const preferred = data.prompt_order.find(item => String(item?.character_id) === '100000');
  const group = preferred || data.prompt_order.find(item => Array.isArray(item?.order));
  return Array.isArray(group?.order) ? group.order : [];
}

function promptTitle(record) {
  return cleanOptionalText(record?.prompt?.name)
    || cleanOptionalText(record?.prompt?.identifier)
    || '(untitled prompt)';
}

function diffLines(before, after) {
  const a = String(before || '').split(/\r?\n/);
  const b = String(after || '').split(/\r?\n/);
  const table = Array.from({ length: a.length + 1 }, () => Array(b.length + 1).fill(0));
  for (let i = a.length - 1; i >= 0; i--) {
    for (let j = b.length - 1; j >= 0; j--) {
      table[i][j] = a[i] === b[j] ? table[i + 1][j + 1] + 1 : Math.max(table[i + 1][j], table[i][j + 1]);
    }
  }

  const rows = [];
  let i = 0;
  let j = 0;
  while (i < a.length && j < b.length) {
    if (a[i] === b[j]) {
      rows.push({ type: 'same', text: a[i] });
      i++;
      j++;
    } else if (table[i + 1][j] >= table[i][j + 1]) {
      rows.push({ type: 'removed', text: a[i++] });
    } else {
      rows.push({ type: 'added', text: b[j++] });
    }
  }
  while (i < a.length) rows.push({ type: 'removed', text: a[i++] });
  while (j < b.length) rows.push({ type: 'added', text: b[j++] });
  return rows;
}

function looksMultiline(left, right) {
  return String(left || '').includes('\n') || String(right || '').includes('\n');
}

function countPrompts(data) {
  return Array.isArray(data?.prompts) ? data.prompts.length : 0;
}

function countPromptOrder(data) {
  return getGlobalPromptOrder(data).length;
}

function countSettings(data) {
  if (!data || typeof data !== 'object') return 0;
  return Object.keys(data).filter(key => key !== 'prompts' && key !== 'prompt_order').length;
}

function inferPresetModel(data) {
  const candidates = [
    data?.openai_model,
    data?.claude_model,
    data?.google_model,
    data?.vertexai_model,
    data?.custom_model,
    data?.textgen_model,
    data?.model,
    data?.model_novel,
  ];
  return cleanOptionalText(candidates.find(value => cleanOptionalText(value)));
}

function comparableField(value) {
  if (Array.isArray(value)) return JSON.stringify(value);
  if (value && typeof value === 'object') return stableStringify(value);
  return value === undefined || value === null ? '' : String(value);
}

function hashObject(value) {
  return crypto.createHash('sha256').update(stableStringify(value)).digest('hex');
}

function stableStringify(value) {
  return JSON.stringify(sortValue(value));
}

function sortValue(value) {
  if (Array.isArray(value)) return value.map(sortValue);
  if (value && typeof value === 'object') {
    return Object.keys(value).sort().reduce((acc, key) => {
      acc[key] = sortValue(value[key]);
      return acc;
    }, {});
  }
  return value;
}

async function writeJsonAtomic(target, value) {
  const temp = `${target}.${process.pid}.${Date.now()}.tmp`;
  await fsp.mkdir(path.dirname(target), { recursive: true });
  await fsp.writeFile(temp, `${JSON.stringify(value, null, 4)}\n`, 'utf8');
  await fsp.rename(temp, target);
}

function normalizeApiId(value) {
  const apiId = String(value || '').trim();
  if (apiId === 'koboldhorde') return 'kobold';
  return apiId || 'openai';
}

function cleanApiId(value) {
  const apiId = normalizeApiId(value);
  return API_CONFIG[apiId] ? apiId : 'openai';
}

function cleanName(value) {
  const text = String(value ?? '').trim();
  return text.length ? text : '';
}

function cleanOptionalText(value) {
  return String(value ?? '').trim();
}

function cleanSnapshotFile(value) {
  const file = path.basename(String(value ?? '').trim());
  return file.endsWith('.json') ? file : '';
}

function safeSegment(value) {
  if (sanitizeFilename) {
    return sanitizeFilename(String(value ?? '').trim()) || 'untitled';
  }
  const cleaned = String(value ?? '')
    .replace(/[<>:"/\\|?*\u0000-\u001f]/g, '_')
    .replace(/^\.+$/, '_')
    .trim();
  return cleaned || 'untitled';
}

function defaultSnapshotLabel(reason) {
  if (reason === 'auto') return 'Before auto save';
  if (reason === 'auto-after') return 'After auto save';
  if (reason === 'pre-restore') return 'Before restore';
  return 'Manual snapshot';
}

function formatDateForFile(date) {
  const pad = (value, size = 2) => String(value).padStart(size, '0');
  return [
    date.getFullYear(),
    '-',
    pad(date.getMonth() + 1),
    '-',
    pad(date.getDate()),
    '_',
    pad(date.getHours()),
    '-',
    pad(date.getMinutes()),
    '-',
    pad(date.getSeconds()),
    '-',
    pad(date.getMilliseconds(), 3),
  ].join('');
}

function formatDateForLabel(date) {
  return formatDateForFile(date).replace('_', ' ').replace(/-/g, ':').replace(/^(\d{4}):(\d{2}):(\d{2})/, '$1-$2-$3');
}

function isPathInside(parent, child) {
  const relative = path.relative(parent, child);
  return relative === '' || (!relative.startsWith('..') && !path.isAbsolute(relative));
}

module.exports = { init, exit, info };
