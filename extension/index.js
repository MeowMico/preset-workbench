const PLUGIN_ROOT = '/api/plugins/preset-workbench';
const DB_NAME = 'preset-workbench';
const DB_VERSION = 1;
const SNAPSHOT_STORE = 'snapshots';
const SNAPSHOT_TYPE = 'preset-workbench.snapshot';
const SNAPSHOT_VERSION = 1;
// Chat Completion PromptManager uses 100001 for its global prompt order.
const DUMMY_CHARACTER_ID = 100001;
const LEGACY_DUMMY_CHARACTER_ID = 100000;
const MAX_CONSOLE_RECORDS = 80;
const ORIGINAL_FETCH = window.fetch.bind(window);

const ROLE_OPTIONS = ['system', 'user', 'assistant'];
const INJECTION_POSITIONS = [
  { value: 0, label: 'Relative / 跟随排序' },
  { value: 1, label: 'In-chat / 按深度插入' },
];

const FALLBACK_APIS = [
  { id: 'openai', label: 'Chat Completion' },
  { id: 'textgenerationwebui', label: 'Text Completion' },
  { id: 'instruct', label: 'Instruct Template' },
  { id: 'context', label: 'Context Template' },
  { id: 'sysprompt', label: 'System Prompt' },
  { id: 'reasoning', label: 'Reasoning Formatting' },
];

const app = {
  installed: false,
  modulesLoaded: false,
  serverAvailable: null,
  apis: FALLBACK_APIS,
  activeApiId: 'openai',
  presets: [],
  activePreset: null,
  currentData: null,
  draftData: null,
  activePromptId: '',
  snapshots: [],
  activeSnapshot: null,
  activeTab: 'editor',
  diffMode: 'current',
  dirty: false,
  rendering: false,
  dragPromptId: '',
  consoleRecords: [],
  activeConsoleId: '',
};

let stScript = {};
let presetManagerModule = {};

void init();

async function init() {
  if (app.installed) return;
  app.installed = true;
  await loadSillyTavernModules();
  installWorkbenchButton();
  installPromptConsoleInterceptor();
}

async function loadSillyTavernModules() {
  if (app.modulesLoaded) return;
  try {
    [stScript, presetManagerModule] = await Promise.all([
      import('/script.js').catch(() => ({})),
      import('/scripts/preset-manager.js').catch(() => ({})),
    ]);
  } finally {
    app.modulesLoaded = true;
  }
}

function installWorkbenchButton() {
  const add = () => {
    const menu = document.querySelector('#extensionsMenu');
    if (!menu || document.querySelector('#pwb-open-workbench')) return;

    const button = document.createElement('div');
    button.id = 'pwb-open-workbench';
    button.className = 'list-group-item flex-container flexGap5 interactable';
    button.tabIndex = 0;
    button.textContent = 'Preset Workbench';
    button.addEventListener('click', openWorkbench);
    button.addEventListener('keydown', (event) => {
      if (event.key === 'Enter' || event.key === ' ') {
        event.preventDefault();
        openWorkbench();
      }
    });
    menu.append(button);
  };

  add();
  const observer = new MutationObserver(add);
  observer.observe(document.body, { childList: true, subtree: true });
}

async function openWorkbench() {
  await loadSillyTavernModules();
  ensureWorkbench();
  document.querySelector('#pwb-workbench')?.classList.add('open');
  if (!app.presets.length) {
    await refreshWorkbench();
  } else {
    renderAll();
  }
}

function ensureWorkbench() {
  if (document.querySelector('#pwb-workbench')) return;

  const root = document.createElement('div');
  root.id = 'pwb-workbench';
  root.innerHTML = `
    <div class="pwb-panel" role="dialog" aria-modal="true" aria-label="Preset Workbench">
      <header class="pwb-header">
        <div class="pwb-title-block">
          <h2>Preset Workbench</h2>
          <p id="pwb-status">Ready</p>
        </div>
        <div class="pwb-header-actions">
          <select id="pwb-api-select" aria-label="Preset type"></select>
          <button id="pwb-refresh" type="button">Refresh</button>
          <button id="pwb-close" type="button">Close</button>
        </div>
      </header>

      <main class="pwb-layout">
        <aside class="pwb-pane pwb-presets-pane">
          <div class="pwb-pane-head">
            <h3>Presets</h3>
            <span id="pwb-preset-count">0</span>
          </div>
          <input id="pwb-preset-search" type="search" placeholder="Search preset">
          <div id="pwb-presets" class="pwb-list"></div>
        </aside>

        <section class="pwb-pane pwb-main-pane">
          <div class="pwb-active-head">
            <div>
              <h3 id="pwb-active-title">No preset selected</h3>
              <p id="pwb-active-meta">0 prompts</p>
            </div>
            <div class="pwb-active-actions">
              <button id="pwb-reload-preset" type="button">Reload</button>
              <button id="pwb-save-preset" class="pwb-primary" type="button" disabled>Save</button>
            </div>
          </div>

          <div class="pwb-tabs" role="tablist" aria-label="Workbench tabs">
            <button type="button" data-pwb-tab="editor" class="active">Prompt entries</button>
            <button type="button" data-pwb-tab="diff">Diff</button>
            <button type="button" data-pwb-tab="console">Console</button>
          </div>

          <section id="pwb-editor-tab" class="pwb-tab-panel">
            <aside class="pwb-prompt-list-pane">
              <div class="pwb-subhead">
                <strong>Entries</strong>
                <div class="pwb-icon-actions">
                  <button id="pwb-add-prompt" type="button" title="New prompt" aria-label="New prompt">+</button>
                  <button id="pwb-duplicate-prompt" type="button" title="Duplicate prompt" aria-label="Duplicate prompt">Copy</button>
                  <button id="pwb-delete-prompt" type="button" class="pwb-danger" title="Delete prompt" aria-label="Delete prompt">Del</button>
                </div>
              </div>
              <div class="pwb-move-row">
                <button id="pwb-move-up" type="button">Up</button>
                <button id="pwb-move-down" type="button">Down</button>
              </div>
              <div id="pwb-prompts" class="pwb-list"></div>
            </aside>

            <section class="pwb-editor-form">
              <div class="pwb-form-grid pwb-form-grid-top">
                <label class="pwb-check">
                  <input id="pwb-prompt-enabled" type="checkbox">
                  <span>Enabled in order</span>
                </label>
                <label>
                  <span>Name</span>
                  <input id="pwb-prompt-name" type="text">
                </label>
                <label>
                  <span>Identifier</span>
                  <input id="pwb-prompt-id" type="text" readonly>
                </label>
                <label>
                  <span>Role</span>
                  <select id="pwb-prompt-role">
                    ${ROLE_OPTIONS.map(role => `<option value="${role}">${role}</option>`).join('')}
                  </select>
                </label>
                <label>
                  <span>Position</span>
                  <select id="pwb-prompt-injection-position">
                    ${INJECTION_POSITIONS.map(item => `<option value="${item.value}">${item.label}</option>`).join('')}
                  </select>
                </label>
                <label class="pwb-depth-control">
                  <span>Depth</span>
                  <input id="pwb-prompt-depth" type="number" min="0">
                </label>
                <label class="pwb-order-control">
                  <span>Order</span>
                  <input id="pwb-prompt-order" type="number">
                </label>
                <label>
                  <span>Triggers</span>
                  <input id="pwb-prompt-trigger" type="text" placeholder="normal, continue, impersonate">
                </label>
              </div>

              <div class="pwb-flags">
                <label class="pwb-check">
                  <input id="pwb-prompt-forbid" type="checkbox">
                  <span>Forbid overrides</span>
                </label>
                <label class="pwb-check">
                  <input id="pwb-prompt-system" type="checkbox">
                  <span>System prompt</span>
                </label>
                <label class="pwb-check">
                  <input id="pwb-prompt-marker" type="checkbox">
                  <span>Marker</span>
                </label>
              </div>

              <label class="pwb-content-field">
                <span>Content</span>
                <textarea id="pwb-prompt-content" rows="18"></textarea>
              </label>

              <details class="pwb-json-details">
                <summary>Raw preset JSON</summary>
                <textarea id="pwb-raw-json" rows="14" spellcheck="false"></textarea>
                <div class="pwb-json-actions">
                  <button id="pwb-apply-json" type="button">Apply JSON</button>
                </div>
              </details>
            </section>
          </section>

          <section id="pwb-diff-tab" class="pwb-tab-panel hidden">
            <div class="pwb-version-form">
              <label>
                <span>Version name</span>
                <input id="pwb-version-label" type="text" placeholder="e.g. test Claude / card A">
              </label>
              <label>
                <span>Note</span>
                <input id="pwb-version-note" type="text" placeholder="What changed or what to observe">
              </label>
              <label>
                <span>Model tag</span>
                <input id="pwb-version-model" type="text" placeholder="Current model">
              </label>
              <label>
                <span>Card tag</span>
                <input id="pwb-version-card" type="text" placeholder="Current card">
              </label>
              <button id="pwb-create-snapshot" type="button">Snapshot draft</button>
            </div>
            <div class="pwb-diff-toolbar">
              <div class="pwb-segmented">
                <button id="pwb-diff-current" type="button" class="active">Current</button>
                <button id="pwb-diff-previous" type="button">Previous</button>
              </div>
              <button id="pwb-restore-snapshot" type="button" class="pwb-danger" disabled>Restore selected</button>
            </div>
            <div id="pwb-diff-summary" class="pwb-diff-summary"></div>
            <div id="pwb-diff-view" class="pwb-diff-view">Select a version</div>
          </section>

          <section id="pwb-console-tab" class="pwb-tab-panel hidden">
            <div class="pwb-console-toolbar">
              <div>
                <strong>Generation request console</strong>
                <span id="pwb-console-count">0 captures</span>
              </div>
              <div class="pwb-console-actions">
                <button id="pwb-copy-console" type="button">Copy raw</button>
                <button id="pwb-clear-console" type="button">Clear</button>
              </div>
            </div>
            <div class="pwb-console-grid">
              <div id="pwb-console-list" class="pwb-list"></div>
              <div id="pwb-console-body" class="pwb-console-body">No generation request captured yet.</div>
            </div>
          </section>
        </section>

        <aside class="pwb-pane pwb-history-pane">
          <div class="pwb-pane-head">
            <h3>Versions</h3>
            <span id="pwb-snapshot-count">0</span>
          </div>
          <div id="pwb-snapshots" class="pwb-list"></div>
        </aside>
      </main>
    </div>
  `;
  document.body.append(root);
  bindWorkbenchEvents(root);
  renderApiOptions();
  renderAll();
}

function bindWorkbenchEvents(root) {
  root.querySelector('#pwb-close').addEventListener('click', () => root.classList.remove('open'));
  root.querySelector('#pwb-refresh').addEventListener('click', refreshWorkbench);
  root.querySelector('#pwb-api-select').addEventListener('change', async (event) => {
    if (!await confirmDiscardChanges()) {
      event.currentTarget.value = app.activeApiId;
      return;
    }
    app.activeApiId = event.currentTarget.value;
    app.activePreset = null;
    await loadPresets();
  });
  root.querySelector('#pwb-preset-search').addEventListener('input', renderPresets);
  root.querySelector('#pwb-reload-preset').addEventListener('click', reloadActivePreset);
  root.querySelector('#pwb-save-preset').addEventListener('click', saveDraftPreset);
  root.querySelectorAll('[data-pwb-tab]').forEach(button => {
    button.addEventListener('click', () => setActiveTab(button.dataset.pwbTab));
  });

  root.querySelector('#pwb-add-prompt').addEventListener('click', addPrompt);
  root.querySelector('#pwb-duplicate-prompt').addEventListener('click', duplicatePrompt);
  root.querySelector('#pwb-delete-prompt').addEventListener('click', deletePrompt);
  root.querySelector('#pwb-move-up').addEventListener('click', () => moveActivePrompt(-1));
  root.querySelector('#pwb-move-down').addEventListener('click', () => moveActivePrompt(1));

  [
    '#pwb-prompt-enabled',
    '#pwb-prompt-name',
    '#pwb-prompt-role',
    '#pwb-prompt-injection-position',
    '#pwb-prompt-depth',
    '#pwb-prompt-order',
    '#pwb-prompt-trigger',
    '#pwb-prompt-forbid',
    '#pwb-prompt-system',
    '#pwb-prompt-marker',
    '#pwb-prompt-content',
  ].forEach((selector) => {
    const input = root.querySelector(selector);
    const eventName = input.type === 'checkbox' ? 'change' : 'input';
    input.addEventListener(eventName, updateActivePromptFromForm);
  });

  root.querySelector('#pwb-apply-json').addEventListener('click', applyRawJson);
  root.querySelector('#pwb-create-snapshot').addEventListener('click', createManualSnapshot);
  root.querySelector('#pwb-diff-current').addEventListener('click', () => setDiffMode('current'));
  root.querySelector('#pwb-diff-previous').addEventListener('click', () => setDiffMode('previous'));
  root.querySelector('#pwb-restore-snapshot').addEventListener('click', restoreSelectedSnapshot);
  root.querySelector('#pwb-copy-console').addEventListener('click', copyActiveConsoleRaw);
  root.querySelector('#pwb-clear-console').addEventListener('click', clearConsoleRecords);
}

async function refreshWorkbench() {
  if (!await confirmDiscardChanges()) return;
  setStatus('Refreshing');
  await loadSillyTavernModules();

  try {
    const status = await getJson('/status');
    app.serverAvailable = true;
    app.apis = mergeApis(Array.isArray(status.apis) && status.apis.length ? status.apis : FALLBACK_APIS, listNativeApis());
    if (!app.apis.some(api => api.id === app.activeApiId)) {
      app.activeApiId = app.apis[0]?.id || 'openai';
    }
  } catch (error) {
    app.serverAvailable = false;
    app.apis = listNativeApis();
    if (!app.apis.some(api => api.id === app.activeApiId)) {
      app.activeApiId = app.apis[0]?.id || 'openai';
    }
    setStatus('Server history unavailable; reading presets from SillyTavern');
  }

  renderApiOptions();
  await loadPresets();
  setStatus(app.serverAvailable ? 'Ready' : 'Ready (browser fallback)');
}

async function loadPresets() {
  setStatus('Loading presets');
  let serverPresets = [];
  if (app.serverAvailable) {
    try {
      const result = await getJson(`/presets?apiId=${encodeURIComponent(app.activeApiId)}`);
      serverPresets = (result.presets || []).map(preset => ({ ...preset, storage: 'server' }));
    } catch (error) {
      app.serverAvailable = false;
      console.warn('[Preset Workbench] Server preset list failed; falling back to native manager.', error);
      setStatus('Server preset list failed; using SillyTavern presets');
    }
  }
  app.presets = mergePresetLists(serverPresets, listNativePresets(app.activeApiId));

  const nativeName = getNativeCurrentPresetName(app.activeApiId);
  app.activePreset = app.activePreset
    ? app.presets.find(preset => preset.name === app.activePreset.name) || null
    : null;
  if (!app.activePreset && nativeName) {
    app.activePreset = app.presets.find(preset => preset.name === nativeName) || null;
  }
  if (!app.activePreset) app.activePreset = app.presets[0] || null;

  renderPresets();
  await loadActivePreset();
}

async function loadActivePreset() {
  app.currentData = null;
  app.draftData = null;
  app.activePromptId = '';
  app.snapshots = [];
  app.activeSnapshot = null;
  app.dirty = false;

  if (!app.activePreset) {
    renderAll();
    return;
  }

  setStatus(`Loading ${app.activePreset.name}`);
  const data = await readPresetData(app.activeApiId, app.activePreset.name, app.activePreset);
  app.currentData = cloneValue(data || {});
  app.draftData = cloneValue(data || {});
  ensurePromptStructure(app.draftData);
  app.activePromptId = getOrderedPromptRecords(app.draftData)[0]?.id || '';
  populateDefaultSnapshotTags();
  renderAll();
  await loadSnapshots();
  setStatus('Ready');
}

async function reloadActivePreset() {
  if (!await confirmDiscardChanges()) return;
  await loadActivePreset();
}

async function loadSnapshots() {
  if (!app.activePreset) return;
  const previousId = app.activeSnapshot?.id;
  let snapshots = [];
  if (app.serverAvailable) {
    try {
      const result = await getJson(`/snapshots?apiId=${encodeURIComponent(app.activeApiId)}&name=${encodeURIComponent(app.activePreset.name)}`);
      snapshots = snapshots.concat((result.snapshots || []).map(snapshot => ({ ...snapshot, storage: 'server' })));
    } catch (error) {
      app.serverAvailable = false;
      console.warn('[Preset Workbench] Server snapshot list failed; using browser history.', error);
    }
  }
  snapshots = mergeSnapshots(snapshots, await getLocalSnapshots(app.activeApiId, app.activePreset.name));
  app.snapshots = snapshots;
  app.activeSnapshot = app.snapshots.find(snapshot => snapshot.id === previousId) || app.snapshots[0] || null;
  renderSnapshots();
  if (app.activeTab === 'diff') await renderDiff();
}

function renderAll() {
  renderApiOptions();
  renderPresets();
  renderActivePreset();
  renderTabs();
  renderPromptList();
  renderPromptEditor();
  renderSnapshots();
  renderConsole();
}

function renderApiOptions() {
  const select = document.querySelector('#pwb-api-select');
  if (!select) return;
  select.replaceChildren(...app.apis.map((api) => {
    const option = document.createElement('option');
    option.value = api.id;
    option.textContent = api.label || api.id;
    return option;
  }));
  select.value = app.activeApiId;
}

function renderPresets() {
  const root = document.querySelector('#pwb-workbench');
  if (!root) return;

  const filter = root.querySelector('#pwb-preset-search').value.trim().toLowerCase();
  const presets = app.presets.filter(preset => preset.name.toLowerCase().includes(filter) || (preset.title || '').toLowerCase().includes(filter));
  root.querySelector('#pwb-preset-count').textContent = String(app.presets.length);
  const list = root.querySelector('#pwb-presets');

  if (!presets.length) {
    list.replaceChildren(emptyNode(app.serverAvailable === false ? 'Server plugin is not available.' : 'No presets found.'));
    return;
  }

  list.replaceChildren(...presets.map((preset) => {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = `pwb-row ${app.activePreset?.name === preset.name ? 'active' : ''}`;
    button.innerHTML = '<span></span><small></small>';
    button.querySelector('span').textContent = preset.title || preset.name;
    button.querySelector('small').textContent = [
      `${preset.promptCount || 0} prompts`,
      preset.model || '',
      preset.updatedAt ? formatDate(preset.updatedAt) : '',
    ].filter(Boolean).join(' | ');
    button.addEventListener('click', async () => {
      if (!await confirmDiscardChanges()) return;
      app.activePreset = preset;
      await loadActivePreset();
    });
    return button;
  }));
}

function renderActivePreset() {
  const root = document.querySelector('#pwb-workbench');
  if (!root) return;
  const title = root.querySelector('#pwb-active-title');
  const meta = root.querySelector('#pwb-active-meta');
  const save = root.querySelector('#pwb-save-preset');
  const reload = root.querySelector('#pwb-reload-preset');

  if (!app.activePreset) {
    title.textContent = 'No preset selected';
    meta.textContent = app.serverAvailable === false ? 'Install the server plugin side to edit files.' : '0 prompts';
    save.disabled = true;
    reload.disabled = true;
    return;
  }

  title.textContent = `${app.activePreset.title || app.activePreset.name}${app.dirty ? ' *' : ''}`;
  meta.textContent = [
    activeApiLabel(),
    `${countPrompts(app.draftData)} prompts`,
    `${getGlobalPromptOrder(app.draftData).length} ordered`,
    inferPresetModel(app.draftData),
  ].filter(Boolean).join(' | ');
  save.disabled = !app.dirty || !app.draftData;
  reload.disabled = !app.draftData;
}

function renderTabs() {
  const root = document.querySelector('#pwb-workbench');
  if (!root) return;
  root.querySelectorAll('[data-pwb-tab]').forEach(button => {
    button.classList.toggle('active', button.dataset.pwbTab === app.activeTab);
  });
  root.querySelector('#pwb-editor-tab').classList.toggle('hidden', app.activeTab !== 'editor');
  root.querySelector('#pwb-diff-tab').classList.toggle('hidden', app.activeTab !== 'diff');
  root.querySelector('#pwb-console-tab').classList.toggle('hidden', app.activeTab !== 'console');
  root.querySelector('#pwb-diff-current').classList.toggle('active', app.diffMode === 'current');
  root.querySelector('#pwb-diff-previous').classList.toggle('active', app.diffMode === 'previous');
}

function renderPromptList() {
  const root = document.querySelector('#pwb-workbench');
  if (!root) return;
  const list = root.querySelector('#pwb-prompts');
  const records = getOrderedPromptRecords(app.draftData);
  if (!records.length) {
    list.replaceChildren(emptyNode('No prompt entries. Add one to start.'));
  } else {
    list.replaceChildren(...records.map((record, index) => {
      const button = document.createElement('button');
      button.type = 'button';
      button.draggable = true;
      button.className = `pwb-row pwb-prompt-row ${record.id === app.activePromptId ? 'active' : ''}`;
      button.dataset.promptId = record.id;
      button.innerHTML = '<span></span><small></small>';
      button.querySelector('span').textContent = promptName(record.prompt);
      button.querySelector('small').textContent = [
        `#${index + 1}`,
        record.prompt?.role || 'marker',
        record.order?.enabled === false ? 'disabled' : 'enabled',
        positionLabel(record.prompt),
      ].filter(Boolean).join(' | ');
      button.addEventListener('click', () => {
        app.activePromptId = record.id;
        renderPromptList();
        renderPromptEditor();
      });
      button.addEventListener('dragstart', event => handlePromptDragStart(event, record.id));
      button.addEventListener('dragover', event => handlePromptDragOver(event, record.id));
      button.addEventListener('dragleave', handlePromptDragLeave);
      button.addEventListener('drop', event => handlePromptDrop(event, record.id));
      button.addEventListener('dragend', handlePromptDragEnd);
      return button;
    }));
  }

  const hasPrompt = Boolean(getActivePromptRecord());
  root.querySelector('#pwb-add-prompt').disabled = !app.draftData;
  root.querySelector('#pwb-duplicate-prompt').disabled = !hasPrompt;
  root.querySelector('#pwb-delete-prompt').disabled = !hasPrompt;
  root.querySelector('#pwb-move-up').disabled = !hasPrompt;
  root.querySelector('#pwb-move-down').disabled = !hasPrompt;
}

function renderPromptEditor() {
  const root = document.querySelector('#pwb-workbench');
  if (!root) return;
  app.rendering = true;
  try {
    const record = getActivePromptRecord();
    const disabled = !record;
    const prompt = record?.prompt || {};
    const order = record?.order || {};
    setInput(root, '#pwb-prompt-enabled', order.enabled !== false, disabled);
    setInput(root, '#pwb-prompt-name', prompt.name || '', disabled);
    setInput(root, '#pwb-prompt-id', prompt.identifier || '', true);
    setInput(root, '#pwb-prompt-role', prompt.role || 'system', disabled);
    setInput(root, '#pwb-prompt-injection-position', String(Number(prompt.injection_position || 0)), disabled);
    setInput(root, '#pwb-prompt-depth', prompt.injection_depth ?? 4, disabled);
    setInput(root, '#pwb-prompt-order', prompt.injection_order ?? 100, disabled);
    setInput(root, '#pwb-prompt-trigger', Array.isArray(prompt.injection_trigger) ? prompt.injection_trigger.join(', ') : '', disabled);
    setInput(root, '#pwb-prompt-forbid', Boolean(prompt.forbid_overrides), disabled);
    setInput(root, '#pwb-prompt-system', Boolean(prompt.system_prompt), disabled);
    setInput(root, '#pwb-prompt-marker', Boolean(prompt.marker), disabled);
    setInput(root, '#pwb-prompt-content', prompt.content || '', disabled || Boolean(prompt.marker));
    renderPositionControls(root, prompt);
    root.querySelector('#pwb-raw-json').value = app.draftData ? JSON.stringify(app.draftData, null, 4) : '';
    root.querySelector('#pwb-raw-json').disabled = !app.draftData;
    root.querySelector('#pwb-apply-json').disabled = !app.draftData;
  } finally {
    app.rendering = false;
  }
}

function setInput(root, selector, value, disabled) {
  const input = root.querySelector(selector);
  input.disabled = Boolean(disabled);
  if (input.type === 'checkbox') {
    input.checked = Boolean(value);
  } else {
    input.value = value ?? '';
  }
}

function updateActivePromptFromForm() {
  if (app.rendering) return;
  const root = document.querySelector('#pwb-workbench');
  const record = getActivePromptRecord();
  if (!root || !record) return;

  record.order.enabled = root.querySelector('#pwb-prompt-enabled').checked;
  record.prompt.name = root.querySelector('#pwb-prompt-name').value;
  record.prompt.role = root.querySelector('#pwb-prompt-role').value;
  record.prompt.injection_position = Number(root.querySelector('#pwb-prompt-injection-position').value || 0);
  record.prompt.injection_depth = numberOrDefault(root.querySelector('#pwb-prompt-depth').value, 4);
  record.prompt.injection_order = numberOrDefault(root.querySelector('#pwb-prompt-order').value, 100);
  record.prompt.injection_trigger = root.querySelector('#pwb-prompt-trigger').value
    .split(',')
    .map(item => item.trim())
    .filter(Boolean);
  record.prompt.forbid_overrides = root.querySelector('#pwb-prompt-forbid').checked;
  record.prompt.system_prompt = root.querySelector('#pwb-prompt-system').checked;
  record.prompt.marker = root.querySelector('#pwb-prompt-marker').checked;
  if (!record.prompt.marker) {
    record.prompt.content = root.querySelector('#pwb-prompt-content').value;
  }

  markDirty('Prompt changed');
  renderPositionControls(root, record.prompt);
  renderPromptList();
  renderActivePreset();
}

function addPrompt() {
  if (!app.draftData) return;
  ensurePromptStructure(app.draftData);
  const id = `pwb-${randomId()}`;
  const prompt = {
    identifier: id,
    name: 'New Prompt',
    role: 'system',
    content: '',
    system_prompt: false,
    marker: false,
    injection_position: 0,
    injection_trigger: [],
  };
  app.draftData.prompts.push(prompt);
  const group = getGlobalPromptOrderGroup(app.draftData);
  const activeIndex = group.order.findIndex(item => item.identifier === app.activePromptId);
  group.order.splice(activeIndex >= 0 ? activeIndex + 1 : group.order.length, 0, { identifier: id, enabled: true });
  app.activePromptId = id;
  markDirty('Prompt added');
  renderPromptList();
  renderPromptEditor();
  focusActivePromptName();
}

function duplicatePrompt() {
  const record = getActivePromptRecord();
  if (!record || !app.draftData) return;
  const id = `pwb-${randomId()}`;
  const prompt = cloneValue(record.prompt);
  prompt.identifier = id;
  prompt.name = `${prompt.name || 'Prompt'} copy`;
  prompt.system_prompt = false;
  app.draftData.prompts.push(prompt);
  const group = getGlobalPromptOrderGroup(app.draftData);
  const index = group.order.findIndex(item => item.identifier === record.id);
  group.order.splice(index >= 0 ? index + 1 : group.order.length, 0, { identifier: id, enabled: record.order?.enabled !== false });
  app.activePromptId = id;
  markDirty('Prompt duplicated');
  renderPromptList();
  renderPromptEditor();
  focusActivePromptName();
}

function deletePrompt() {
  const record = getActivePromptRecord();
  if (!record || !app.draftData) return;
  if (record.prompt.system_prompt && !window.confirm(`Delete system prompt "${promptName(record.prompt)}"?`)) return;
  app.draftData.prompts = app.draftData.prompts.filter(prompt => prompt.identifier !== record.id);
  const group = getGlobalPromptOrderGroup(app.draftData);
  group.order = group.order.filter(item => item.identifier !== record.id);
  app.activePromptId = getOrderedPromptRecords(app.draftData)[0]?.id || '';
  markDirty('Prompt deleted');
  renderPromptList();
  renderPromptEditor();
}

function moveActivePrompt(delta) {
  const record = getActivePromptRecord();
  if (!record || !app.draftData) return;
  const group = getGlobalPromptOrderGroup(app.draftData);
  const index = group.order.findIndex(item => item.identifier === record.id);
  if (index < 0) return;
  const next = index + delta;
  if (next < 0 || next >= group.order.length) return;
  const [item] = group.order.splice(index, 1);
  group.order.splice(next, 0, item);
  markDirty('Prompt moved');
  renderPromptList();
}

function renderPositionControls(root, prompt) {
  const isAbsolute = Number(prompt?.injection_position || 0) === 1;
  root.querySelectorAll('.pwb-depth-control, .pwb-order-control').forEach(element => {
    element.classList.toggle('hidden', !isAbsolute);
  });
}

function focusActivePromptName() {
  window.requestAnimationFrame(() => {
    const input = document.querySelector('#pwb-prompt-name');
    if (!input || input.disabled) return;
    input.focus();
    input.select();
  });
}

function handlePromptDragStart(event, id) {
  app.dragPromptId = id;
  event.dataTransfer.effectAllowed = 'move';
  event.dataTransfer.setData('text/plain', id);
  event.currentTarget.classList.add('dragging');
}

function handlePromptDragOver(event, targetId) {
  if (!app.dragPromptId || app.dragPromptId === targetId) return;
  event.preventDefault();
  event.dataTransfer.dropEffect = 'move';
  clearPromptDropClasses();
  const rect = event.currentTarget.getBoundingClientRect();
  const placement = event.clientY > rect.top + rect.height / 2 ? 'after' : 'before';
  event.currentTarget.classList.add(placement === 'after' ? 'drop-after' : 'drop-before');
}

function handlePromptDragLeave(event) {
  event.currentTarget.classList.remove('drop-before', 'drop-after');
}

function handlePromptDrop(event, targetId) {
  if (!app.dragPromptId || app.dragPromptId === targetId) return;
  event.preventDefault();
  const rect = event.currentTarget.getBoundingClientRect();
  const placement = event.clientY > rect.top + rect.height / 2 ? 'after' : 'before';
  reorderPrompt(app.dragPromptId, targetId, placement);
  handlePromptDragEnd();
}

function handlePromptDragEnd() {
  app.dragPromptId = '';
  clearPromptDropClasses({ includeDragging: true });
}

function clearPromptDropClasses({ includeDragging = false } = {}) {
  document.querySelectorAll('#pwb-prompts .pwb-prompt-row').forEach(row => {
    row.classList.remove('drop-before', 'drop-after');
    if (includeDragging) row.classList.remove('dragging');
  });
}

function reorderPrompt(dragId, targetId, placement) {
  if (!app.draftData || dragId === targetId) return;
  const group = getGlobalPromptOrderGroup(app.draftData);
  const from = group.order.findIndex(item => item.identifier === dragId);
  if (from < 0) return;
  const [item] = group.order.splice(from, 1);
  const target = group.order.findIndex(order => order.identifier === targetId);
  if (target < 0) {
    group.order.splice(from, 0, item);
    return;
  }
  const insertAt = placement === 'after' ? target + 1 : target;
  group.order.splice(insertAt, 0, item);
  app.activePromptId = dragId;
  markDirty('Prompt moved');
  renderPromptList();
}

function applyRawJson() {
  const root = document.querySelector('#pwb-workbench');
  if (!root || !app.draftData) return;
  try {
    const data = JSON.parse(root.querySelector('#pwb-raw-json').value);
    if (!data || typeof data !== 'object' || Array.isArray(data)) throw new Error('Preset JSON must be an object.');
    app.draftData = data;
    ensurePromptStructure(app.draftData);
    app.activePromptId = getOrderedPromptRecords(app.draftData)[0]?.id || '';
    markDirty('Raw JSON applied');
    renderAll();
  } catch (error) {
    setStatus(error.message || 'Invalid JSON');
  }
}

async function saveDraftPreset() {
  if (!app.activePreset || !app.draftData) return;
  setStatus('Saving preset');
  const metadata = readSnapshotMetadata();
  try {
    await putSnapshotRecord({
      apiId: app.activeApiId,
      name: app.activePreset.name,
      data: app.currentData || app.draftData,
      label: 'Before workbench save',
      reason: 'auto',
      skipDuplicate: true,
    });

    await writePresetThroughNativeOrServer(app.activeApiId, app.activePreset.name, app.draftData);

    const result = await putSnapshotRecord({
      apiId: app.activeApiId,
      name: app.activePreset.name,
      data: app.draftData,
      label: metadata.label || 'Workbench save',
      note: metadata.note,
      modelTag: metadata.modelTag,
      cardTag: metadata.cardTag,
      reason: 'manual',
      skipDuplicate: true,
    });

    app.currentData = cloneValue(app.draftData);
    app.dirty = false;
    if (result.snapshot) app.activeSnapshot = result.snapshot;
    setStatus(result.skipped ? 'Saved; duplicate snapshot skipped' : 'Saved and versioned');
    await loadPresetsAfterSave();
    await loadSnapshots();
    renderAll();
  } catch (error) {
    console.warn('[Preset Workbench] Save failed', error);
    setStatus(`Save failed: ${error.message || error}`);
  }
}

async function loadPresetsAfterSave() {
  let serverPresets = [];
  if (app.serverAvailable) {
    try {
      const result = await getJson(`/presets?apiId=${encodeURIComponent(app.activeApiId)}`);
      serverPresets = (result.presets || []).map(preset => ({ ...preset, storage: 'server' }));
    } catch (error) {
      app.serverAvailable = false;
      console.warn('[Preset Workbench] Preset refresh after save failed; using native manager.', error);
    }
  }
  app.presets = mergePresetLists(serverPresets, listNativePresets(app.activeApiId));
  app.activePreset = app.presets.find(preset => preset.name === app.activePreset?.name) || app.activePreset;
}

async function writePresetThroughNativeOrServer(apiId, name, data) {
  const manager = getNativePresetManager(apiId);
  if (manager && typeof manager.savePreset === 'function') {
    try {
      await manager.savePreset(name, cloneValue(data), { skipUpdate: false });
      return;
    } catch (error) {
      console.warn('[Preset Workbench] Native preset save failed; using server plugin fallback.', error);
    }
  }

  await postJson('/preset', {
    apiId,
    name,
    data,
  });
}

async function createManualSnapshot() {
  if (!app.activePreset || !app.draftData) return;
  setStatus('Creating snapshot');
  const metadata = readSnapshotMetadata();
  try {
    const result = await putSnapshotRecord({
      apiId: app.activeApiId,
      name: app.activePreset.name,
      data: app.draftData,
      label: metadata.label || 'Manual snapshot',
      note: metadata.note,
      modelTag: metadata.modelTag,
      cardTag: metadata.cardTag,
      reason: 'manual',
      skipDuplicate: true,
    });
    if (result.snapshot) app.activeSnapshot = result.snapshot;
    await loadSnapshots();
    setStatus(result.skipped ? 'Skipped duplicate' : 'Snapshot created');
  } catch (error) {
    setStatus(`Snapshot failed: ${error.message || error}`);
  }
}

function readSnapshotMetadata() {
  const root = document.querySelector('#pwb-workbench');
  return {
    label: root?.querySelector('#pwb-version-label')?.value.trim() || '',
    note: root?.querySelector('#pwb-version-note')?.value.trim() || '',
    modelTag: root?.querySelector('#pwb-version-model')?.value.trim() || '',
    cardTag: root?.querySelector('#pwb-version-card')?.value.trim() || '',
  };
}

function populateDefaultSnapshotTags() {
  const root = document.querySelector('#pwb-workbench');
  if (!root) return;
  const model = root.querySelector('#pwb-version-model');
  const card = root.querySelector('#pwb-version-card');
  if (model && !model.value) model.value = inferPresetModel(app.draftData) || getCurrentModelTag();
  if (card && !card.value) card.value = getCurrentCardName();
}

function renderSnapshots() {
  const root = document.querySelector('#pwb-workbench');
  if (!root) return;
  const list = root.querySelector('#pwb-snapshots');
  root.querySelector('#pwb-snapshot-count').textContent = String(app.snapshots.length);
  root.querySelector('#pwb-restore-snapshot').disabled = !app.activeSnapshot;

  if (!app.snapshots.length) {
    list.replaceChildren(emptyNode('No versions yet.'));
    return;
  }

  list.replaceChildren(...app.snapshots.map((snapshot, index) => {
    const row = document.createElement('div');
    row.className = `pwb-snapshot-row ${app.activeSnapshot?.id === snapshot.id ? 'active' : ''}`;

    const main = document.createElement('button');
    main.type = 'button';
    main.className = 'pwb-snapshot-main';
    main.innerHTML = '<span></span><small></small><em></em>';
    main.querySelector('span').textContent = snapshot.label || 'Untitled version';
    main.querySelector('small').textContent = [
      index === 0 ? 'Latest' : '',
      formatDate(snapshot.createdAt),
      `${snapshot.promptCount || 0} prompts`,
    ].filter(Boolean).join(' | ');
    main.querySelector('em').textContent = [snapshot.modelTag, snapshot.cardTag, snapshot.note].filter(Boolean).join(' / ');
    main.addEventListener('click', async () => {
      app.activeSnapshot = snapshot;
      renderSnapshots();
      if (app.activeTab === 'diff') await renderDiff();
    });

    const edit = document.createElement('button');
    edit.type = 'button';
    edit.textContent = 'Edit';
    edit.addEventListener('click', () => editSnapshotLabel(snapshot));

    row.append(main, edit);
    return row;
  }));
}

async function editSnapshotLabel(snapshot) {
  if (!app.activePreset || !snapshot) return;
  const label = window.prompt('Version name', snapshot.label || '');
  if (label === null) return;
  const note = window.prompt('Note', snapshot.note || '');
  if (note === null) return;
  const modelTag = window.prompt('Model tag', snapshot.modelTag || '');
  if (modelTag === null) return;
  const cardTag = window.prompt('Card tag', snapshot.cardTag || '');
  if (cardTag === null) return;
  if (snapshot.storage === 'browser') {
    await updateLocalSnapshotLabel(snapshot.id, { label, note, modelTag, cardTag });
  } else {
    await postJson('/snapshot/label', {
      apiId: app.activeApiId,
      name: app.activePreset.name,
      file: snapshot.file,
      label,
      note,
      modelTag,
      cardTag,
    });
  }
  await loadSnapshots();
}

async function restoreSelectedSnapshot() {
  if (!app.activePreset || !app.activeSnapshot) return;
  const ok = window.confirm(`Restore "${app.activePreset.name}" to "${app.activeSnapshot.label || app.activeSnapshot.file}"?`);
  if (!ok) return;
  setStatus('Restoring');
  try {
    if (app.activeSnapshot.storage === 'browser') {
      await putLocalSnapshot(app.activeApiId, app.activePreset.name, app.currentData || app.draftData, {
        label: `Before restore ${formatDate(new Date().toISOString())}`,
        reason: 'pre-restore',
        skipDuplicate: false,
      });
      await writePresetThroughNativeOrServer(app.activeApiId, app.activePreset.name, app.activeSnapshot.data);
    } else {
      await postJson('/restore', {
        apiId: app.activeApiId,
        name: app.activePreset.name,
        file: app.activeSnapshot.file,
      });
    }
    await loadActivePreset();
    const manager = getNativePresetManager(app.activeApiId);
    if (manager && typeof manager.updateList === 'function' && app.currentData) {
      manager.updateList(app.activePreset.name, cloneValue(app.currentData));
    }
    setStatus('Restored');
  } catch (error) {
    setStatus(`Restore failed: ${error.message || error}`);
  }
}

function setActiveTab(tab) {
  app.activeTab = tab;
  renderTabs();
  if (tab === 'diff') void renderDiff();
  if (tab === 'console') renderConsole();
}

function setDiffMode(mode) {
  app.diffMode = mode;
  renderTabs();
  void renderDiff();
}

async function renderDiff() {
  const root = document.querySelector('#pwb-workbench');
  if (!root) return;
  const summary = root.querySelector('#pwb-diff-summary');
  const view = root.querySelector('#pwb-diff-view');

  if (!app.activePreset || !app.activeSnapshot) {
    summary.textContent = '';
    view.replaceChildren(document.createTextNode('Select a version'));
    return;
  }

  const base = app.diffMode === 'previous' ? getPreviousSnapshot(app.activeSnapshot) : app.activeSnapshot;
  if (!base) {
    summary.textContent = '';
    view.replaceChildren(document.createTextNode('No previous version'));
    return;
  }

  setStatus('Comparing');
  try {
    const data = await getDiffData(base, app.activeSnapshot);

    summary.textContent = `Prompts +${data.diff.summary.added} -${data.diff.summary.removed} ~${data.diff.summary.changed}; settings ~${data.diff.summary.settings}`;
    view.replaceChildren(...renderDiffNodes(data.diff));
    setStatus('Ready');
  } catch (error) {
    summary.textContent = '';
    view.replaceChildren(document.createTextNode(error.message || String(error)));
    setStatus('Diff failed');
  }
}

function renderDiffNodes(diff) {
  const nodes = [];
  if (diff.settings?.length) {
    const section = document.createElement('section');
    section.className = 'pwb-diff-entry changed';
    const title = document.createElement('h4');
    title.textContent = `SETTINGS (${diff.settings.length})`;
    section.append(title, ...diff.settings.map(renderDiffField));
    nodes.push(section);
  }

  for (const entry of diff.entries || []) {
    const section = document.createElement('section');
    section.className = `pwb-diff-entry ${entry.status}`;
    const title = document.createElement('h4');
    title.textContent = `${entry.status.toUpperCase()} ${entry.title}`;
    section.append(title, ...(entry.fields || []).map(renderDiffField));
    nodes.push(section);
  }

  return nodes.length ? nodes : [emptyNode('No changes')];
}

function renderDiffField(field) {
  const wrap = document.createElement('div');
  wrap.className = 'pwb-diff-field';
  const name = document.createElement('strong');
  name.textContent = field.name;
  wrap.append(name);

  if (field.lines?.length) {
    const pre = document.createElement('pre');
    pre.className = 'pwb-line-diff';
    for (const line of field.lines) {
      const row = document.createElement('span');
      row.className = line.type;
      row.textContent = `${line.type === 'added' ? '+ ' : line.type === 'removed' ? '- ' : '  '}${line.text}\n`;
      pre.append(row);
    }
    wrap.append(pre);
    return wrap;
  }

  const grid = document.createElement('div');
  grid.className = 'pwb-diff-grid';
  const before = document.createElement('pre');
  const after = document.createElement('pre');
  before.textContent = field.before;
  after.textContent = field.after;
  grid.append(before, after);
  wrap.append(grid);
  return wrap;
}

function getPreviousSnapshot(snapshot) {
  const index = app.snapshots.findIndex(item => item.file === snapshot.file);
  return index >= 0 ? app.snapshots[index + 1] : null;
}

function installPromptConsoleInterceptor() {
  if (window.__presetWorkbenchConsoleInterceptorInstalled) return;
  window.__presetWorkbenchConsoleInterceptorInstalled = true;

  window.fetch = async function presetWorkbenchFetch(input, initOptions = {}) {
    void capturePromptRequest(input, initOptions).catch((error) => {
      console.warn('[Preset Workbench] Request capture failed', error);
    });
    return ORIGINAL_FETCH(input, initOptions);
  };
}

async function capturePromptRequest(input, initOptions = {}) {
  const method = String(initOptions?.method || input?.method || 'GET').toUpperCase();
  if (method !== 'POST') return;

  const url = requestUrl(input);
  const target = parseTargetUrl(url);
  const pathname = target?.pathname || String(url || '');
  if (!pathname || pathname.includes('/api/plugins/preset-workbench') || pathname.includes('/api/presets/')) return;

  const bodyText = await requestBodyText(input, initOptions);
  if (!bodyText || bodyText.length > 8_000_000) return;

  let payload = null;
  try {
    payload = JSON.parse(bodyText);
  } catch {
    return;
  }

  if (!shouldCapturePayload(pathname, payload)) return;

  const record = {
    id: `${Date.now()}-${randomId()}`,
    time: new Date().toISOString(),
    method,
    path: pathname,
    api: cleanText(stScript.main_api) || '',
    preset: getNativeCurrentPresetName(cleanText(stScript.main_api) || app.activeApiId),
    model: inferRequestModel(payload) || getCurrentModelTag(),
    card: getCurrentCardName(),
    payload,
    raw: JSON.stringify(payload, null, 2),
  };

  app.consoleRecords.unshift(record);
  app.consoleRecords = app.consoleRecords.slice(0, MAX_CONSOLE_RECORDS);
  app.activeConsoleId = record.id;
  if (app.activeTab === 'console') renderConsole();
}

function shouldCapturePayload(pathname, payload) {
  if (!payload || typeof payload !== 'object') return false;
  if (Array.isArray(payload.messages) || typeof payload.prompt === 'string' || typeof payload.input === 'string') return true;
  if (Array.isArray(payload?.body?.messages) || typeof payload?.body?.prompt === 'string') return true;
  return /^\/api\/.+/i.test(pathname) && /(generate|completion|chat-completions|text-completions|kobold|novelai|openai|horde|textgenerationwebui)/i.test(pathname);
}

function renderConsole() {
  const root = document.querySelector('#pwb-workbench');
  if (!root) return;
  const list = root.querySelector('#pwb-console-list');
  const body = root.querySelector('#pwb-console-body');
  root.querySelector('#pwb-console-count').textContent = `${app.consoleRecords.length} captures`;

  if (!app.consoleRecords.length) {
    list.replaceChildren(emptyNode('No captures'));
    body.replaceChildren(document.createTextNode('No generation request captured yet.'));
    root.querySelector('#pwb-copy-console').disabled = true;
    return;
  }

  if (!app.consoleRecords.some(record => record.id === app.activeConsoleId)) {
    app.activeConsoleId = app.consoleRecords[0].id;
  }
  const active = getActiveConsoleRecord();

  list.replaceChildren(...app.consoleRecords.map((record) => {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = `pwb-row ${record.id === app.activeConsoleId ? 'active' : ''}`;
    button.innerHTML = '<span></span><small></small>';
    button.querySelector('span').textContent = `${formatTime(record.time)} ${record.model || record.api || 'request'}`;
    button.querySelector('small').textContent = [record.preset, record.card, record.path].filter(Boolean).join(' | ');
    button.addEventListener('click', () => {
      app.activeConsoleId = record.id;
      renderConsole();
    });
    return button;
  }));

  root.querySelector('#pwb-copy-console').disabled = !active;
  body.replaceChildren(...renderConsoleBody(active));
}

function renderConsoleBody(record) {
  if (!record) return [document.createTextNode('Select a capture')];
  const nodes = [];

  const meta = document.createElement('div');
  meta.className = 'pwb-console-meta';
  meta.textContent = [
    formatDate(record.time),
    record.api ? `API: ${record.api}` : '',
    record.preset ? `Preset: ${record.preset}` : '',
    record.model ? `Model: ${record.model}` : '',
    record.card ? `Card: ${record.card}` : '',
  ].filter(Boolean).join(' | ');
  nodes.push(meta);

  const messages = findMessages(record.payload);
  if (messages?.length) {
    const messageWrap = document.createElement('div');
    messageWrap.className = 'pwb-message-list';
    for (const message of messages) {
      const item = document.createElement('section');
      item.className = 'pwb-message-item';
      const role = document.createElement('strong');
      role.textContent = cleanText(message.role) || 'message';
      const content = document.createElement('pre');
      content.textContent = stringifyMessageContent(message.content);
      item.append(role, content);
      messageWrap.append(item);
    }
    nodes.push(messageWrap);
  } else {
    const prompt = findPromptText(record.payload);
    if (prompt) {
      const promptBlock = document.createElement('pre');
      promptBlock.className = 'pwb-console-prompt';
      promptBlock.textContent = prompt;
      nodes.push(promptBlock);
    }
  }

  const rawTitle = document.createElement('strong');
  rawTitle.textContent = 'Raw JSON';
  const raw = document.createElement('pre');
  raw.className = 'pwb-console-raw';
  raw.textContent = record.raw;
  nodes.push(rawTitle, raw);
  return nodes;
}

function getActiveConsoleRecord() {
  return app.consoleRecords.find(record => record.id === app.activeConsoleId) || app.consoleRecords[0] || null;
}

async function copyActiveConsoleRaw() {
  const record = getActiveConsoleRecord();
  if (!record) return;
  try {
    await navigator.clipboard.writeText(record.raw);
    setStatus('Copied raw request JSON');
  } catch {
    setStatus('Clipboard unavailable');
  }
}

function clearConsoleRecords() {
  app.consoleRecords = [];
  app.activeConsoleId = '';
  renderConsole();
}

function listNativeApis() {
  const apis = FALLBACK_APIS.filter(api => getNativePresetManager(api.id));
  return apis.length ? apis : FALLBACK_APIS;
}

function mergeApis(primary = [], fallback = []) {
  const merged = new Map();
  for (const api of [...fallback, ...primary]) {
    if (api?.id) merged.set(api.id, api);
  }
  return [...merged.values()];
}

function listNativePresets(apiId) {
  const manager = getNativePresetManager(apiId);
  if (!manager || typeof manager.getPresetList !== 'function') return [];

  try {
    const { presets, preset_names: presetNames } = manager.getPresetList(apiId);
    const names = Array.isArray(presetNames) ? presetNames : Object.keys(presetNames || {});
    return names
      .map((name) => {
        const data = getNativePresetData(apiId, name);
        if (!data) return null;
        return {
          ...summarizePresetData(apiId, name, data),
          storage: 'native',
          nativeOnly: true,
          presetIndex: Array.isArray(presetNames) ? presetNames.indexOf(name) : presetNames?.[name],
          loaded: Boolean(presets),
        };
      })
      .filter(Boolean)
      .sort((left, right) => left.name.localeCompare(right.name));
  } catch (error) {
    console.warn('[Preset Workbench] Native preset list failed.', error);
    return [];
  }
}

function mergePresetLists(serverPresets = [], nativePresets = []) {
  const merged = new Map();
  for (const preset of serverPresets) {
    if (!preset?.name) continue;
    merged.set(preset.name, preset);
  }
  for (const preset of nativePresets) {
    if (!preset?.name) continue;
    merged.set(preset.name, {
      ...(merged.get(preset.name) || {}),
      ...preset,
      storage: merged.has(preset.name) ? 'native+server' : 'native',
      nativeOnly: !merged.has(preset.name),
    });
  }
  return [...merged.values()].sort((left, right) => left.name.localeCompare(right.name));
}

async function readPresetData(apiId, name, preset = null) {
  const nativeData = getNativePresetData(apiId, name);
  if (nativeData) return nativeData;

  if (app.serverAvailable || preset?.storage === 'server') {
    try {
      const result = await getJson(`/preset?apiId=${encodeURIComponent(apiId)}&name=${encodeURIComponent(name)}`);
      return result.data || {};
    } catch (error) {
      app.serverAvailable = false;
      console.warn('[Preset Workbench] Server preset read failed; no native data was available.', error);
    }
  }

  return {};
}

function getNativePresetData(apiId, name) {
  const manager = getNativePresetManager(apiId);
  if (!manager || typeof manager.getPresetList !== 'function') return null;

  try {
    const { presets, preset_names: presetNames } = manager.getPresetList(apiId);
    let preset = null;
    if (Array.isArray(presetNames)) {
      const index = presetNames.findIndex(item => item === name);
      if (index >= 0) preset = presets?.[index];
    } else if (presetNames && Object.hasOwn(presetNames, name)) {
      preset = presets?.[presetNames[name]];
    }

    if (!preset && cleanText(manager.getSelectedPresetName?.()) === name && typeof manager.getPresetSettings === 'function') {
      preset = manager.getPresetSettings(name);
    }

    return preset && typeof preset === 'object' ? cloneValue(preset) : null;
  } catch (error) {
    console.warn('[Preset Workbench] Native preset read failed.', error);
    return null;
  }
}

function summarizePresetData(apiId, name, data) {
  return {
    apiId,
    name,
    file: `${name}.json`,
    title: cleanText(data?.name) || name,
    sourceHash: hashObject(data),
    promptCount: countPrompts(data),
    orderCount: getGlobalPromptOrder(data).length,
    settingCount: data && typeof data === 'object' ? Object.keys(data).filter(key => key !== 'prompts' && key !== 'prompt_order').length : 0,
    model: inferPresetModel(data),
    chatCompletionSource: cleanText(data?.chat_completion_source),
  };
}

async function putSnapshotRecord(payload) {
  if (app.serverAvailable) {
    try {
      return await postJson('/snapshots', payload);
    } catch (error) {
      app.serverAvailable = false;
      console.warn('[Preset Workbench] Server snapshot write failed; using browser history.', error);
    }
  }

  const saved = await putLocalSnapshot(payload.apiId, payload.name, payload.data, payload);
  return { ok: true, skipped: saved.skipped, snapshot: saved.snapshot };
}

async function putLocalSnapshot(apiId, name, data, options = {}) {
  if (!data || typeof data !== 'object') {
    throw new Error('Snapshot needs preset data.');
  }

  const hash = hashObject(data);
  const existing = await getLocalSnapshots(apiId, name);
  const latest = existing[0];
  if (options.skipDuplicate && latest?.sourceHash === hash) {
    return { skipped: true, snapshot: latest };
  }

  const now = new Date();
  const file = `${formatDateForFile(now)}__${hash.slice(0, 10)}.json`;
  const snapshot = {
    type: SNAPSHOT_TYPE,
    version: SNAPSHOT_VERSION,
    id: `${apiId}:${name}:${file}`,
    file,
    storage: 'browser',
    apiId,
    presetName: name,
    label: cleanText(options.label) || defaultSnapshotLabel(options.reason),
    note: cleanText(options.note),
    modelTag: cleanText(options.modelTag),
    cardTag: cleanText(options.cardTag),
    reason: cleanText(options.reason) || 'manual',
    createdAt: now.toISOString(),
    createdAtMs: now.getTime(),
    sourceHash: hash,
    promptCount: countPrompts(data),
    orderCount: getGlobalPromptOrder(data).length,
    data: cloneValue(data),
  };

  const db = await openDb();
  await idbRequest(db.transaction(SNAPSHOT_STORE, 'readwrite').objectStore(SNAPSHOT_STORE).put(snapshot));
  db.close();
  return { skipped: false, snapshot };
}

async function getLocalSnapshots(apiId, name) {
  try {
    const db = await openDb();
    const records = await idbRequest(db.transaction(SNAPSHOT_STORE, 'readonly').objectStore(SNAPSHOT_STORE).getAll());
    db.close();
    return sortSnapshots((records || [])
      .filter(snapshot => snapshot?.apiId === apiId && snapshot?.presetName === name)
      .map(snapshot => ({ ...snapshot, storage: 'browser' })));
  } catch (error) {
    console.warn('[Preset Workbench] Browser history read failed.', error);
    return [];
  }
}

async function updateLocalSnapshotLabel(id, { label, note, modelTag, cardTag }) {
  const db = await openDb();
  const snapshot = await idbRequest(db.transaction(SNAPSHOT_STORE, 'readonly').objectStore(SNAPSHOT_STORE).get(id));
  if (!snapshot) {
    db.close();
    throw new Error('Local snapshot not found.');
  }
  snapshot.label = cleanText(label) || snapshot.label || '';
  snapshot.note = cleanText(note);
  snapshot.modelTag = cleanText(modelTag);
  snapshot.cardTag = cleanText(cardTag);
  snapshot.updatedAt = new Date().toISOString();
  await idbRequest(db.transaction(SNAPSHOT_STORE, 'readwrite').objectStore(SNAPSHOT_STORE).put(snapshot));
  db.close();
}

function openDb() {
  return new Promise((resolve, reject) => {
    if (!window.indexedDB) {
      reject(new Error('IndexedDB is not available.'));
      return;
    }
    const request = indexedDB.open(DB_NAME, DB_VERSION);
    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains(SNAPSHOT_STORE)) {
        const store = db.createObjectStore(SNAPSHOT_STORE, { keyPath: 'id' });
        store.createIndex('presetKey', ['apiId', 'presetName'], { unique: false });
        store.createIndex('createdAtMs', 'createdAtMs', { unique: false });
      }
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

function idbRequest(request) {
  return new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

async function getDiffData(base, activeSnapshot) {
  const canUseRemote = app.serverAvailable
    && base?.storage !== 'browser'
    && activeSnapshot?.storage !== 'browser';
  if (canUseRemote) {
    return app.diffMode === 'previous'
      ? getJson(`/compare-snapshots?apiId=${encodeURIComponent(app.activeApiId)}&name=${encodeURIComponent(app.activePreset.name)}&left=${encodeURIComponent(base.file)}&right=${encodeURIComponent(activeSnapshot.file)}`)
      : getJson(`/compare?apiId=${encodeURIComponent(app.activeApiId)}&name=${encodeURIComponent(app.activePreset.name)}&file=${encodeURIComponent(base.file)}`);
  }

  const left = await getSnapshotData(base);
  const right = app.diffMode === 'previous'
    ? await getSnapshotData(activeSnapshot)
    : (app.draftData || app.currentData || {});
  return {
    ok: true,
    diff: diffPresets(left, right),
  };
}

async function getSnapshotData(snapshot) {
  if (snapshot?.data) return snapshot.data;
  if (!snapshot || snapshot.storage === 'browser') return {};
  const result = await getJson(`/snapshot?apiId=${encodeURIComponent(app.activeApiId)}&name=${encodeURIComponent(app.activePreset.name)}&file=${encodeURIComponent(snapshot.file)}`);
  return result.snapshot?.data || {};
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
  const basePrompts = normalizePromptRecordsForDiff(base);
  const currentPrompts = normalizePromptRecordsForDiff(current);
  const allIds = [...new Set([...Object.keys(basePrompts), ...Object.keys(currentPrompts)])]
    .sort((left, right) => promptName(basePrompts[left]?.prompt || currentPrompts[left]?.prompt).localeCompare(promptName(basePrompts[right]?.prompt || currentPrompts[right]?.prompt)));

  return allIds.map((id) => {
    const before = basePrompts[id] || null;
    const after = currentPrompts[id] || null;
    if (!before) return { id, status: 'added', title: promptName(after.prompt), fields: [] };
    if (!after) return { id, status: 'removed', title: promptName(before.prompt), fields: [] };
    const fields = diffPromptFields(before, after);
    return { id, status: fields.length ? 'changed' : 'unchanged', title: promptName(after.prompt), fields };
  });
}

function normalizePromptRecordsForDiff(data) {
  const clone = cloneValue(data || {});
  ensurePromptStructure(clone);
  return Object.fromEntries(getOrderedPromptRecords(clone).map(record => [record.id, record]));
}

function diffPromptFields(before, after) {
  const fields = [
    ['name', before.prompt?.name, after.prompt?.name],
    ['role', before.prompt?.role, after.prompt?.role],
    ['content', before.prompt?.content, after.prompt?.content],
    ['enabled', before.order?.enabled, after.order?.enabled],
    ['order', before.index, after.index],
    ['injection_position', before.prompt?.injection_position, after.prompt?.injection_position],
    ['injection_depth', before.prompt?.injection_depth, after.prompt?.injection_depth],
    ['injection_order', before.prompt?.injection_order, after.prompt?.injection_order],
    ['injection_trigger', before.prompt?.injection_trigger, after.prompt?.injection_trigger],
    ['forbid_overrides', before.prompt?.forbid_overrides, after.prompt?.forbid_overrides],
    ['system_prompt', before.prompt?.system_prompt, after.prompt?.system_prompt],
    ['marker', before.prompt?.marker, after.prompt?.marker],
  ];

  return fields.map(([name, beforeValue, afterValue]) => {
    const left = comparableField(beforeValue);
    const right = comparableField(afterValue);
    if (left === right) return null;
    return {
      name,
      before: left,
      after: right,
      lines: name === 'content' ? diffLines(left, right) : [],
    };
  }).filter(Boolean);
}

function diffTopLevelSettings(base, current) {
  const ignored = new Set(['prompts', 'prompt_order']);
  const keys = [...new Set([
    ...Object.keys(base || {}),
    ...Object.keys(current || {}),
  ])].filter(key => !ignored.has(key)).sort();

  return keys.map((key) => {
    const left = comparableField(base?.[key]);
    const right = comparableField(current?.[key]);
    if (left === right) return null;
    return { name: key, before: left, after: right, lines: looksMultiline(left, right) ? diffLines(left, right) : [] };
  }).filter(Boolean);
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

function comparableField(value) {
  if (Array.isArray(value)) return JSON.stringify(value);
  if (value && typeof value === 'object') return stableStringify(value);
  return value === undefined || value === null ? '' : String(value);
}

function looksMultiline(left, right) {
  return String(left || '').includes('\n') || String(right || '').includes('\n');
}

function sortSnapshots(snapshots) {
  return snapshots.sort((left, right) => Number(right.createdAtMs || 0) - Number(left.createdAtMs || 0));
}

function mergeSnapshots(primary = [], fallback = []) {
  const merged = new Map();
  for (const snapshot of [...fallback, ...primary]) {
    if (!snapshot) continue;
    merged.set(snapshot.id || snapshot.file, snapshot);
  }
  return sortSnapshots([...merged.values()]);
}

function defaultSnapshotLabel(reason) {
  if (reason === 'auto') return 'Before workbench save';
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

function hashObject(value) {
  const text = stableStringify(value);
  let hash = 0x811c9dc5;
  for (let i = 0; i < text.length; i++) {
    hash ^= text.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193);
  }
  return (hash >>> 0).toString(16).padStart(8, '0');
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

function ensurePromptStructure(data) {
  if (!data || typeof data !== 'object') return;
  if (!Array.isArray(data.prompts)) data.prompts = [];
  data.prompts.forEach((prompt) => {
    if (!prompt.identifier) prompt.identifier = `pwb-${randomId()}`;
    if (!prompt.name) prompt.name = prompt.identifier;
    if (!prompt.role && !prompt.marker) prompt.role = 'system';
  });
  const group = getGlobalPromptOrderGroup(data);
  const orderIds = new Set(group.order.map(item => item.identifier).filter(Boolean));
  for (const prompt of data.prompts) {
    if (!orderIds.has(prompt.identifier)) {
      group.order.push({ identifier: prompt.identifier, enabled: prompt.enabled !== false });
    }
  }
  group.order = group.order.filter(item => item && item.identifier);
}

function getGlobalPromptOrderGroup(data) {
  if (!data || typeof data !== 'object') return { character_id: DUMMY_CHARACTER_ID, order: [] };
  if (!Array.isArray(data.prompt_order)) data.prompt_order = [];
  let group = data.prompt_order.find(item => String(item?.character_id) === String(DUMMY_CHARACTER_ID));
  if (!group) group = data.prompt_order.find(item => String(item?.character_id) === String(LEGACY_DUMMY_CHARACTER_ID));
  if (!group) group = data.prompt_order.find(item => Array.isArray(item?.order));
  if (!group) {
    group = { character_id: DUMMY_CHARACTER_ID, order: [] };
    data.prompt_order.push(group);
  }
  if (!Array.isArray(group.order)) group.order = [];
  return group;
}

function getGlobalPromptOrder(data) {
  return getGlobalPromptOrderGroup(data).order;
}

function getOrderedPromptRecords(data) {
  if (!data || typeof data !== 'object') return [];
  ensurePromptStructure(data);
  const prompts = new Map((data.prompts || []).map(prompt => [prompt.identifier, prompt]));
  const seen = new Set();
  const records = [];
  getGlobalPromptOrderGroup(data).order.forEach((order, index) => {
    const prompt = prompts.get(order.identifier) || { identifier: order.identifier, name: order.identifier, marker: true };
    seen.add(order.identifier);
    records.push({ id: order.identifier, prompt, order, index });
  });
  for (const prompt of data.prompts || []) {
    if (seen.has(prompt.identifier)) continue;
    records.push({ id: prompt.identifier, prompt, order: { identifier: prompt.identifier, enabled: prompt.enabled !== false }, index: records.length });
  }
  return records;
}

function getActivePromptRecord() {
  return getOrderedPromptRecords(app.draftData).find(record => record.id === app.activePromptId) || null;
}

function markDirty(message) {
  app.dirty = true;
  setStatus(message);
  renderActivePreset();
}

async function confirmDiscardChanges() {
  if (!app.dirty) return true;
  return window.confirm('Discard unsaved preset edits?');
}

function getNativePresetManager(apiId) {
  try {
    return presetManagerModule.getPresetManager?.(apiId);
  } catch {
    return null;
  }
}

function getNativeCurrentPresetName(apiId) {
  const manager = getNativePresetManager(apiId);
  try {
    return cleanText(manager?.getSelectedPresetName?.());
  } catch {
    return '';
  }
}

function getRequestHeaders() {
  return typeof stScript.getRequestHeaders === 'function'
    ? stScript.getRequestHeaders()
    : { 'Content-Type': 'application/json' };
}

async function getJson(pathname) {
  const response = await ORIGINAL_FETCH(`${PLUGIN_ROOT}${pathname}`, {
    credentials: 'include',
    cache: 'no-cache',
  });
  if (!response.ok) throw new Error(await response.text());
  return response.json();
}

async function postJson(pathname, body) {
  const response = await ORIGINAL_FETCH(`${PLUGIN_ROOT}${pathname}`, {
    method: 'POST',
    headers: getRequestHeaders(),
    body: JSON.stringify(body || {}),
    credentials: 'include',
  });
  if (!response.ok) throw new Error(await response.text());
  return response.json();
}

function requestUrl(input) {
  if (typeof input === 'string') return input;
  if (input instanceof URL) return input.toString();
  return input?.url || '';
}

function parseTargetUrl(url) {
  try {
    return new URL(url, window.location.origin);
  } catch {
    return null;
  }
}

async function requestBodyText(input, initOptions) {
  const body = initOptions?.body;
  if (typeof body === 'string') return body;
  if (body instanceof Blob) return body.text();
  if (input instanceof Request) {
    return input.clone().text();
  }
  return '';
}

function findMessages(payload) {
  if (Array.isArray(payload?.messages)) return payload.messages;
  if (Array.isArray(payload?.body?.messages)) return payload.body.messages;
  if (Array.isArray(payload?.request?.messages)) return payload.request.messages;
  return null;
}

function findPromptText(payload) {
  const candidates = [
    payload?.prompt,
    payload?.input,
    payload?.text,
    payload?.body?.prompt,
    payload?.request?.prompt,
  ];
  return candidates.find(value => typeof value === 'string' && value.trim()) || '';
}

function stringifyMessageContent(content) {
  if (typeof content === 'string') return content;
  if (Array.isArray(content)) {
    return content.map(part => {
      if (typeof part === 'string') return part;
      if (part?.text) return part.text;
      return JSON.stringify(part);
    }).join('\n');
  }
  if (content && typeof content === 'object') return JSON.stringify(content, null, 2);
  return '';
}

function inferRequestModel(payload) {
  const candidates = [
    payload?.model,
    payload?.openai_model,
    payload?.claude_model,
    payload?.chat_completion_model,
    payload?.body?.model,
    payload?.request?.model,
  ];
  return cleanText(candidates.find(value => cleanText(value)));
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
  return cleanText(candidates.find(value => cleanText(value)));
}

function getCurrentModelTag() {
  const candidates = [
    stScript.oai_settings?.openai_model,
    stScript.oai_settings?.claude_model,
    stScript.oai_settings?.custom_model,
    window.SillyTavern?.getContext?.()?.oai_settings?.openai_model,
  ];
  return cleanText(candidates.find(value => cleanText(value)));
}

function getCurrentCardName() {
  const context = window.SillyTavern?.getContext?.();
  const characters = stScript.characters || context?.characters || [];
  const thisChid = stScript.this_chid ?? context?.this_chid;
  const charName = characters?.[thisChid]?.name;
  const groupName = context?.groups?.find?.(group => group.id === context?.selected_group)?.name;
  return cleanText(groupName || charName || stScript.name2);
}

function countPrompts(data) {
  return Array.isArray(data?.prompts) ? data.prompts.length : 0;
}

function activeApiLabel() {
  return app.apis.find(api => api.id === app.activeApiId)?.label || app.activeApiId;
}

function promptName(prompt) {
  return cleanText(prompt?.name) || cleanText(prompt?.identifier) || '(untitled prompt)';
}

function positionLabel(prompt) {
  if (!prompt || prompt.marker) return 'marker';
  return Number(prompt.injection_position || 0) === 1
    ? `depth ${prompt.injection_depth ?? 4} / order ${prompt.injection_order ?? 100}`
    : 'relative';
}

function numberOrDefault(value, fallback) {
  const number = Number(value);
  return Number.isFinite(number) ? number : fallback;
}

function cloneValue(value) {
  return value === undefined ? undefined : JSON.parse(JSON.stringify(value));
}

function randomId() {
  if (globalThis.crypto?.randomUUID) return globalThis.crypto.randomUUID().slice(0, 8);
  return Math.random().toString(36).slice(2, 10);
}

function emptyNode(text) {
  const node = document.createElement('div');
  node.className = 'pwb-empty';
  node.textContent = text;
  return node;
}

function setStatus(message) {
  const status = document.querySelector('#pwb-status');
  if (status) status.textContent = message;
}

function formatDate(value) {
  if (!value) return '';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return String(value);
  return date.toLocaleString();
}

function formatTime(value) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '';
  return date.toLocaleTimeString();
}

function cleanText(value) {
  return String(value ?? '').trim();
}
