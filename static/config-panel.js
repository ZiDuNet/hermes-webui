/**
 * Config management panel — Vanilla JS
 * Provides: category navigation, field rendering, YAML editor, import/export
 */
(function() {
  'use strict';

  let _configData = {};   // current config values (normalized)
  let _defaultsData = {}; // DEFAULT_CONFIG
  let _schemaData = {};   // { fields: {...}, category_order: [...] }
  let _dirty = {};        // changed keys → new values
  let _activeCategory = 'general';
  let _yamlMode = false;
  let _searchQuery = '';

  // ── API helpers ──────────────────────────────────────────────────────────

  async function api(path, opts = {}) {
    const res = await fetch(path, {
      headers: { 'Content-Type': 'application/json' },
      ...opts,
    });
    if (!res.ok) {
      const err = await res.json().catch(() => ({ error: res.statusText }));
      throw new Error(err.error || res.statusText);
    }
    return res.json();
  }

  // ── Load data ────────────────────────────────────────────────────────────

  async function loadConfig() {
    const [config, defaults, schema] = await Promise.all([
      api('/api/mgmt/config'),
      api('/api/mgmt/config/defaults'),
      api('/api/mgmt/config/schema'),
    ]);
    _configData = config;
    _defaultsData = defaults;
    _schemaData = schema;
    _dirty = {};
    renderAll();
  }

  // ── Render ───────────────────────────────────────────────────────────────

  function renderAll() {
    renderCategories();
    renderFields();
    renderDirtyBar();
  }

  function renderCategories() {
    const el = $('configCategories');
    if (!el) return;
    const order = _schemaData.category_order || [];
    const counts = {};
    for (const [, f] of Object.entries(_schemaData.fields || {})) {
      const cat = f.category || 'general';
      counts[cat] = (counts[cat] || 0) + 1;
    }
    // Add categories from data that aren't in order
    for (const cat of Object.keys(counts)) {
      if (!order.includes(cat)) order.push(cat);
    }
    el.innerHTML = order.filter(c => counts[c]).map(cat =>
      `<button class="cfg-cat-btn ${cat === _activeCategory ? 'active' : ''}" onclick="window._cfgSetCategory('${cat}')">${cat} <span style="opacity:.5;font-size:10px">${counts[cat]}</span></button>`
    ).join('');
  }

  function renderFields() {
    const el = $('configFields');
    if (!el) return;

    if (_yamlMode) {
      renderYamlEditor();
      return;
    }

    const fields = _schemaData.fields || {};
    const query = _searchQuery.toLowerCase();
    const entries = Object.entries(fields).filter(([key, f]) => {
      if (f.category !== _activeCategory) return false;
      if (query) {
        return key.toLowerCase().includes(query) ||
               (f.description || '').toLowerCase().includes(query);
      }
      return true;
    });

    if (!entries.length) {
      el.innerHTML = `<div style="padding:24px;text-align:center;color:var(--muted)">No fields in this category</div>`;
      return;
    }

    el.innerHTML = entries.map(([key, field]) => {
      const value = _dirty.hasOwnProperty(key) ? _dirty[key] : getNestedValue(_configData, key);
      const defaultVal = getNestedValue(_defaultsData, key);
      const isDirty = _dirty.hasOwnProperty(key);
      return renderFieldRow(key, field, value, defaultVal, isDirty);
    }).join('');
  }

  function renderFieldRow(key, field, value, defaultVal, isDirty) {
    const type = field.type || 'string';
    const desc = field.description || key;
    const dirtyClass = isDirty ? ' cfg-dirty' : '';
    let input = '';

    if (type === 'boolean') {
      const checked = value ? ' checked' : '';
      input = `<label class="cfg-switch${dirtyClass}"><input type="checkbox"${checked} onchange="window._cfgToggle('${esc(key)}', this.checked)"><span class="cfg-slider"></span></label>`;
    } else if (type === 'select' && field.options) {
      input = `<select class="cfg-select${dirtyClass}" onchange="window._cfgChange('${esc(key)}', this.value)">${field.options.map(o => `<option value="${esc(o)}" ${value === o ? 'selected' : ''}>${esc(o || '(auto)')}</option>`).join('')}</select>`;
    } else if (type === 'number') {
      input = `<input type="number" class="cfg-input${dirtyClass}" value="${esc(String(value ?? ''))}" onchange="window._cfgChange('${esc(key)}', Number(this.value))">`;
    } else if (type === 'list') {
      const arr = Array.isArray(value) ? value : [];
      input = `<input type="text" class="cfg-input${dirtyClass}" value="${esc(arr.join(', '))}" onchange="window._cfgChange('${esc(key)}', this.value.split(',').map(s=>s.trim()).filter(Boolean))" placeholder="comma-separated">`;
    } else {
      // string — use textarea if multiline heuristic
      const strVal = String(value ?? '');
      if (strVal.includes('\n') || strVal.length > 100) {
        input = `<textarea class="cfg-textarea${dirtyClass}" rows="3" onchange="window._cfgChange('${esc(key)}', this.value)">${esc(strVal)}</textarea>`;
      } else {
        input = `<input type="text" class="cfg-input${dirtyClass}" value="${esc(strVal)}" onchange="window._cfgChange('${esc(key)}', this.value)">`;
      }
    }

    return `<div class="cfg-row">
      <div class="cfg-key" title="${esc(key)}">${esc(desc)}${isDirty ? ' <span style="color:var(--accent)">*</span>' : ''}</div>
      <div class="cfg-value">${input}</div>
    </div>`;
  }

  function renderYamlEditor() {
    const el = $('configFields');
    el.innerHTML = `<div class="cfg-yaml-wrap">
      <textarea id="configYamlEditor" class="cfg-yaml-editor" spellcheck="false"></textarea>
    </div>`;
    // Load YAML content asynchronously
    api('/api/mgmt/config/raw').then(data => {
      const editor = $('configYamlEditor');
      if (editor) editor.value = data.yaml || '';
    }).catch(err => {
      const editor = $('configYamlEditor');
      if (editor) editor.value = '# Error loading: ' + err.message;
    });
  }

  function renderDirtyBar() {
    const bar = $('configDirtyBar');
    if (!bar) return;
    const count = Object.keys(_dirty).length;
    bar.style.display = count > 0 ? 'flex' : 'none';
    const label = bar.querySelector('.cfg-dirty-count');
    if (label) label.textContent = `${count} unsaved change${count > 1 ? 's' : ''}`;
  }

  // ── Actions ──────────────────────────────────────────────────────────────

  window._cfgSetCategory = function(cat) {
    _activeCategory = cat;
    renderCategories();
    renderFields();
  };

  window._cfgToggle = function(key, val) {
    _dirty[key] = val;
    renderFields();
    renderDirtyBar();
  };

  window._cfgChange = function(key, val) {
    _dirty[key] = val;
    renderFields();
    renderDirtyBar();
  };

  window._cfgToggleYaml = function() {
    _yamlMode = !_yamlMode;
    const btn = $('configToggleYaml');
    if (btn) btn.textContent = _yamlMode ? 'Form' : 'YAML';
    renderFields();
  };

  window._cfgSave = async function() {
    try {
      if (_yamlMode) {
        const editor = $('configYamlEditor');
        if (!editor) return;
        await api('/api/mgmt/config/raw', {
          method: 'POST',
          body: JSON.stringify({ yaml_text: editor.value }),
        });
      } else {
        // Merge dirty into config
        const merged = JSON.parse(JSON.stringify(_configData));
        for (const [key, val] of Object.entries(_dirty)) {
          setNestedValue(merged, key, val);
        }
        await api('/api/mgmt/config', {
          method: 'POST',
          body: JSON.stringify({ config: merged }),
        });
      }
      _dirty = {};
      await loadConfig();
      showToast('Config saved');
    } catch (err) {
      showToast('Save failed: ' + err.message, true);
    }
  };

  window._cfgReset = async function() {
    if (!confirm('Reset all config to defaults? This cannot be undone.')) return;
    try {
      await api('/api/mgmt/config/reset', { method: 'POST', body: '{}' });
      await loadConfig();
      showToast('Config reset to defaults');
    } catch (err) {
      showToast('Reset failed: ' + err.message, true);
    }
  };

  window._cfgExport = function() {
    const blob = new Blob([JSON.stringify(_configData, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url; a.download = 'hermes-config.json'; a.click();
    URL.revokeObjectURL(url);
  };

  window._cfgImport = function() {
    const input = document.createElement('input');
    input.type = 'file'; input.accept = '.json';
    input.onchange = async () => {
      const file = input.files[0];
      if (!file) return;
      try {
        const text = await file.text();
        const config = JSON.parse(text);
        await api('/api/mgmt/config', {
          method: 'POST',
          body: JSON.stringify({ config }),
        });
        await loadConfig();
        showToast('Config imported');
      } catch (err) {
        showToast('Import failed: ' + err.message, true);
      }
    };
    input.click();
  };

  window._cfgSearch = function(val) {
    _searchQuery = val;
    renderFields();
  };

  // ── Utils ────────────────────────────────────────────────────────────────

  function $(id) { return document.getElementById(id); }
  function esc(s) { return String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;'); }

  function getNestedValue(obj, path) {
    return path.split('.').reduce((o, k) => o && o[k], obj);
  }

  function setNestedValue(obj, path, val) {
    const keys = path.split('.');
    const last = keys.pop();
    const target = keys.reduce((o, k) => {
      if (!o[k] || typeof o[k] !== 'object') o[k] = {};
      return o[k];
    }, obj);
    target[last] = val;
  }

  function showToast(msg, isError) {
    // Reuse existing toast system if available
    if (window.ui && window.ui.toast) {
      window.ui.toast(msg, isError ? 'error' : 'success');
      return;
    }
    // Fallback: create temp element
    const el = document.createElement('div');
    el.textContent = msg;
    el.style.cssText = `position:fixed;bottom:20px;left:50%;transform:translateX(-50%);padding:8px 16px;border-radius:8px;font-size:13px;z-index:9999;${isError ? 'background:#dc3545;color:#fff' : 'background:var(--surface);color:var(--text);border:1px solid var(--border)'}`;
    document.body.appendChild(el);
    setTimeout(() => el.remove(), 3000);
  }

  // ── Init ─────────────────────────────────────────────────────────────────

  window.initConfigPanel = function() {
    loadConfig().catch(err => {
      const el = $('configFields');
      if (el) el.innerHTML = `<div style="padding:24px;color:var(--accent)">Error: ${esc(err.message)}</div>`;
    });
  };

})();
