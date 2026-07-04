# Preset Workbench

Preset Workbench is a SillyTavern preset workbench for editing Chat Completion prompt entries, keeping local version history, annotating tests, restoring older versions, and inspecting generation request payloads.

## Features

- Reads native SillyTavern preset files.
- Edits `prompts` and `prompt_order`: enabled state, order, role, insertion position, depth, order value, triggers, and content.
- Creates a before-save snapshot and an after-save version.
- Adds model, card, and note annotations to versions.
- Restores any history version with an automatic `Before restore` safety snapshot.
- Shows diffs against the current file or the previous version.
- Captures generation request JSON from the browser and displays final `messages` or `prompt` payloads.
- Falls back to SillyTavern's in-page `PresetManager` when the server plugin API is unavailable. In fallback mode, history is stored in browser IndexedDB.

History is stored under:

```text
backups/preset-workbench/<apiId>/<presetName>/
```

If the workbench opens but shows no presets, refresh SillyTavern and check the status line. `Ready (browser fallback)` means the server history API was not loaded, but presets are still read from SillyTavern's native frontend state.

The visual editor is focused on Chat Completion/OpenAI preset structures. Other SillyTavern preset groups can still be listed, snapshotted, saved, and restored when their server folders exist.
