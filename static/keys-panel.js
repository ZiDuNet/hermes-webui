/**
 * Keys / Env management panel — Vanilla JS
 * Provides: Provider grouping, search, masking, edit, delete
 */
(function() {
  'use strict';

  let _envData = {};      // { VAR_NAME: { is_set, redacted_value, description, category, is_password, ... } }
  let _searchQuery = '';
  let _showAdvanced = true;
  let _revealSet = new Set(); // keys currently revealed

  // Provider groups for organizing env vars (mirrors hermes-agent PROVIDER_GROUPS)
  const PROVIDER_GROUPS = [
    { name: 'OpenAI', keys: ['OPENAI_API_KEY', 'OPENAI_BASE_URL', 'OPENAI_ORG_ID'] },
    { name: 'Anthropic', keys: ['ANTHROPIC_API_KEY'] },
    { name: 'Google', keys: ['GOOGLE_API_KEY', 'GEMINI_API_KEY', 'GOOGLE_APPLICATION_CREDENTIALS'] },
    { name: 'Groq', keys: ['GROQ_API_KEY'] },
    { name: 'Mistral', keys: ['MISTRAL_API_KEY'] },
    { name: 'Cohere', keys: ['CO_API_KEY'] },
    { name: 'Together', keys: ['TOGETHER_API_KEY'] },
    { name: 'Fireworks', keys: ['FIREWORKS_API_KEY'] },
    { name: 'DeepSeek', keys: ['DEEPSEEK_API_KEY'] },
    { name: 'Perplexity', keys: ['PERPLEXITY_API_KEY'] },
    { name: 'xAI', keys: ['XAI_API_KEY'] },
    { name: 'Azure', keys: ['AZURE_API_KEY', 'AZURE_ENDPOINT', 'AZURE_API_VERSION'] },
    { name: 'Amazon Bedrock', keys: ['AWS_ACCESS_KEY_ID', 'AWS_SECRET_ACCESS_KEY', 'AWS_REGION'] },
    { name: 'Ollama', keys: ['OLLAMA_BASE_URL'] },
    { name: 'Telegram', keys: ['TELEGRAM_BOT_TOKEN'] },
    { name: 'Discord', keys: ['DISCORD_BOT_TOKEN'] },
    { name: 'ElevenLabs', keys: ['ELEVENLABS_API_KEY'] },
    { name: 'Slack', keys: ['SLACK_BOT_TOKEN'] },
  ];

  // Build a reverse map: key → group name
  const _keyToGroup = {};
  PROVIDER_GROUPS.forEach(g => g.keys.forEach(k => _keyToGroup[k] = g.name));

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

  async function loadEnv() {
    _envData = await api('/api/mgmt/env');
    renderAll();
  }

  function renderAll() {
    renderKeys();
    renderUnset();
  }

  function renderKeys() {
    const el = $('keysList');
    if (!el) return;
    const query = _searchQuery.toLowerCase();

    // Group set keys by provider
    const groups = {};
    const ungrouped = [];
    for (const [key, info] of Object.entries(_envData)) {
      if (!info.is_set) continue;
      if (info.advanced && !_showAdvanced) continue;
      if (query && !key.toLowerCase().includes(query) &&
          !(info.description || '').toLowerCase().includes(query) &&
          !(info.category || '').toLowerCase().includes(query)) continue;
      const group = _keyToGroup[key];
      if (group) {
        if (!groups[group]) groups[group] = [];
        groups[group].push({ key, ...info });
      } else {
        ungrouped.push({ key, ...info });
      }
    }

    let html = '';
    // Provider groups
    for (const [group, vars] of Object.entries(groups)) {
      html += `<div class="keys-group">
        <div class="keys-group-header" onclick="this.parentElement.classList.toggle('collapsed')">${esc(group)} <span style="opacity:.5;font-size:10px">${vars.length}</span></div>
        <div class="keys-group-body">${vars.map(v => renderVarRow(v)).join('')}</div>
      </div>`;
    }
    // Ungrouped
    if (ungrouped.length) {
      html += `<div class="keys-group">
        <div class="keys-group-header" onclick="this.parentElement.classList.toggle('collapsed')">Other <span style="opacity:.5;font-size:10px">${ungrouped.length}</span></div>
        <div class="keys-group-body">${ungrouped.map(v => renderVarRow(v)).join('')}</div>
      </div>`;
    }

    if (!html) {
      html = `<div style="padding:24px;text-align:center;color:var(--muted)">No API keys configured</div>`;
    }
    el.innerHTML = html;
  }

  function renderUnset() {
    const el = $('keysUnset');
    if (!el) return;
    const unset = Object.entries(_envData).filter(([, v]) => !v.is_set);
    const query = _searchQuery.toLowerCase();
    const filtered = unset.filter(([key, info]) => {
      if (info.advanced && !_showAdvanced) return false;
      if (query && !key.toLowerCase().includes(query) &&
          !(info.description || '').toLowerCase().includes(query)) return false;
      return true;
    });

    if (!filtered.length) {
      el.style.display = 'none';
      return;
    }
    el.style.display = 'block';
    el.innerHTML = `<div class="keys-group-header" onclick="this.parentElement.classList.toggle('collapsed')">Not set <span style="opacity:.5;font-size:10px">${filtered.length}</span></div>
      <div class="keys-group-body" style="max-height:200px;overflow-y:auto">${filtered.map(([key, info]) =>
        `<div class="keys-row keys-unset">
          <div class="keys-key" title="${esc(info.description || '')}">${esc(key)}</div>
          <div class="keys-value"><button class="keys-edit-btn" onclick="window._keysEdit('${esc(key)}')">Set</button></div>
        </div>`
      ).join('')}</div>`;
  }

  function renderVarRow(v) {
    const revealed = _revealSet.has(v.key);
    const displayVal = revealed ? esc(v.value || '') : esc(v.redacted_value || '...');
    const masked = !revealed && v.is_password;
    return `<div class="keys-row">
      <div class="keys-info">
        <div class="keys-key">${esc(v.key)}</div>
        ${v.description ? `<div class="keys-desc">${esc(v.description)}</div>` : ''}
      </div>
      <div class="keys-value">
        <code class="keys-val${masked ? ' masked' : ''}">${displayVal}</code>
        <div class="keys-actions">
          ${v.is_password ? `<button class="keys-reveal-btn" onclick="window._keysReveal('${esc(v.key)}')">${revealed ? 'Hide' : 'Reveal'}</button>` : ''}
          <button class="keys-edit-btn" onclick="window._keysEdit('${esc(v.key)}')">Edit</button>
          <button class="keys-del-btn" onclick="window._keysDelete('${esc(v.key)}')">Delete</button>
        </div>
      </div>
    </div>`;
  }

  // ── Actions ──────────────────────────────────────────────────────────────

  window._keysSearch = function(val) {
    _searchQuery = val;
    renderAll();
  };

  window._keysToggleAdvanced = function() {
    _showAdvanced = !_showAdvanced;
    renderAll();
  };

  window._keysEdit = async function(key) {
    const info = _envData[key] || {};
    const newVal = prompt(`Enter value for ${key}:`, info.value || '');
    if (newVal === null) return; // cancelled
    try {
      await api('/api/mgmt/env', {
        method: 'POST',
        body: JSON.stringify({ key, value: newVal }),
      });
      await loadEnv();
      _showToast(`${key} saved`);
    } catch (err) {
      _showToast('Save failed: ' + err.message, true);
    }
  };

  window._keysDelete = async function(key) {
    if (!confirm(`Delete ${key}?`)) return;
    try {
      await api('/api/mgmt/env/delete', {
        method: 'POST',
        body: JSON.stringify({ key }),
      });
      await loadEnv();
      _showToast(`${key} deleted`);
    } catch (err) {
      _showToast('Delete failed: ' + err.message, true);
    }
  };

  window._keysReveal = async function(key) {
    if (_revealSet.has(key)) {
      _revealSet.delete(key);
      renderAll();
      return;
    }
    try {
      const data = await api('/api/mgmt/env/reveal', {
        method: 'POST',
        body: JSON.stringify({ key }),
      });
      // Update local data
      if (_envData[key]) {
        _envData[key].value = data.value;
      }
      _revealSet.add(key);
      renderAll();
    } catch (err) {
      _showToast('Reveal failed: ' + err.message, true);
    }
  };

  function _showToast(msg, isError) {
    if (window.ui && window.ui.toast) {
      window.ui.toast(msg, isError ? 'error' : 'success');
      return;
    }
    const el = document.createElement('div');
    el.textContent = msg;
    el.style.cssText = `position:fixed;bottom:20px;left:50%;transform:translateX(-50%);padding:8px 16px;border-radius:8px;font-size:13px;z-index:9999;${isError ? 'background:#dc3545;color:#fff' : 'background:var(--surface);color:var(--text);border:1px solid var(--border)'}`;
    document.body.appendChild(el);
    setTimeout(() => el.remove(), 3000);
  }

  function $(id) { return document.getElementById(id); }
  function esc(s) { return String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;'); }

  window.initKeysPanel = function() {
    loadEnv().catch(err => {
      const el = $('keysList');
      if (el) el.innerHTML = `<div style="padding:24px;color:var(--accent)">Error: ${esc(err.message)}</div>`;
    });
  };

})();
