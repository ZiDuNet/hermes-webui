/**
 * MCP Servers management panel — Vanilla JS
 * Provides: server list, add/edit form (stdio/http), enable toggle, delete
 */
(function() {
  'use strict';

  let _servers = {};  // { name: { type, command, args, url, ... } }

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

  async function loadServers() {
    const data = await api('/api/mgmt/mcp-servers');
    _servers = data.servers || {};
    renderAll();
  }

  function renderAll() {
    renderServerList();
  }

  function renderServerList() {
    const el = $('mcpServerList');
    if (!el) return;
    const entries = Object.entries(_servers);

    if (!entries.length) {
      el.innerHTML = `<div style="padding:24px;text-align:center;color:var(--muted)">
        No MCP servers configured.<br>
        <button class="cron-btn run" style="margin-top:8px" onclick="window._mcpToggleForm()">Add server</button>
      </div>`;
      return;
    }

    el.innerHTML = entries.map(([name, config]) => {
      const type = config.type || (config.command ? 'stdio' : 'http');
      const isStdio = type === 'stdio';
      const transport = isStdio ? 'stdio' : (config.type || 'http');
      const enabled = config.enabled !== false;
      const desc = isStdio
        ? `${config.command || ''} ${(config.args || []).join(' ')}`
        : (config.url || config.sse_url || '');
      return `<div class="mcp-card">
        <div class="mcp-card-header">
          <div class="mcp-card-info">
            <div class="mcp-card-name">${esc(name)}</div>
            <div class="mcp-card-meta">${esc(transport)} · ${esc(desc.substring(0, 60))}${desc.length > 60 ? '...' : ''}</div>
          </div>
          <div class="mcp-card-actions">
            <label class="cfg-switch" title="Enable/Disable">
              <input type="checkbox" ${enabled ? 'checked' : ''} onchange="window._mcpToggle('${esc(name)}', this.checked)">
              <span class="cfg-slider"></span>
            </label>
            <button class="keys-edit-btn" onclick="window._mcpEdit('${esc(name)}')" title="Edit">Edit</button>
            <button class="keys-del-btn" onclick="window._mcpDelete('${esc(name)}')" title="Delete">Del</button>
          </div>
        </div>
      </div>`;
    }).join('');
  }

  // ── Actions ──────────────────────────────────────────────────────────────

  window._mcpToggleForm = function(editName) {
    const form = $('mcpForm');
    const title = $('mcpFormTitle');
    if (!form) return;
    const isEdit = !!editName;
    if (title) title.textContent = isEdit ? `Edit: ${editName}` : 'Add MCP Server';
    $('mcpFormName').value = editName || '';
    $('mcpFormName').readOnly = !!editName;

    // Pre-fill if editing
    if (isEdit && _servers[editName]) {
      const cfg = _servers[editName];
      const type = cfg.type || (cfg.command ? 'stdio' : 'http');
      $('mcpFormType').value = type;
      $('mcpFormCommand').value = cfg.command || '';
      $('mcpFormArgs').value = (cfg.args || []).join(' ');
      $('mcpFormUrl').value = cfg.url || cfg.sse_url || '';
      $('mcpFormEnv').value = Object.entries(cfg.env || {}).map(([k, v]) => `${k}=${v}`).join('\n');
    } else {
      $('mcpFormType').value = 'stdio';
      $('mcpFormCommand').value = '';
      $('mcpFormArgs').value = '';
      $('mcpFormUrl').value = '';
      $('mcpFormEnv').value = '';
    }
    _mcpUpdateTypeFields();
    form.style.display = form.style.display === 'none' ? 'block' : 'none';
  };

  function _mcpUpdateTypeFields() {
    const type = ($('mcpFormType') || {}).value || 'stdio';
    const stdioFields = $('mcpStdioFields');
    const httpFields = $('mcpHttpFields');
    if (stdioFields) stdioFields.style.display = type === 'stdio' ? 'block' : 'none';
    if (httpFields) httpFields.style.display = type !== 'stdio' ? 'block' : 'none';
  }

  window._mcpTypeChange = function() {
    _mcpUpdateTypeFields();
  };

  window._mcpSubmit = async function() {
    const name = ($('mcpFormName') || {}).value?.trim();
    const type = ($('mcpFormType') || {}).value;
    if (!name) { alert('Server name is required'); return; }

    const config = { type, enabled: true };
    if (type === 'stdio') {
      config.command = ($('mcpFormCommand') || {}).value?.trim() || '';
      const argsStr = ($('mcpFormArgs') || {}).value?.trim();
      config.args = argsStr ? argsStr.split(/\s+/) : [];
    } else {
      config.url = ($('mcpFormUrl') || {}).value?.trim() || '';
    }
    const envStr = ($('mcpFormEnv') || {}).value?.trim();
    if (envStr) {
      config.env = {};
      for (const line of envStr.split('\n')) {
        const eqIdx = line.indexOf('=');
        if (eqIdx > 0) config.env[line.slice(0, eqIdx).trim()] = line.slice(eqIdx + 1).trim();
      }
    }

    const isEdit = !!_servers[name];
    try {
      await api(isEdit ? '/api/mgmt/mcp-servers/update' : '/api/mgmt/mcp-servers/add', {
        method: 'POST',
        body: JSON.stringify({ name, config }),
      });
      $('mcpForm').style.display = 'none';
      await loadServers();
      _showToast(`${name} ${isEdit ? 'updated' : 'added'}`);
    } catch (err) {
      _showToast('Failed: ' + err.message, true);
    }
  };

  window._mcpEdit = function(name) {
    window._mcpToggleForm(name);
  };

  window._mcpDelete = async function(name) {
    if (!confirm(`Delete MCP server "${name}"?`)) return;
    try {
      await api('/api/mgmt/mcp-servers/delete', {
        method: 'POST',
        body: JSON.stringify({ name }),
      });
      await loadServers();
      _showToast(`${name} deleted`);
    } catch (err) {
      _showToast('Delete failed: ' + err.message, true);
    }
  };

  window._mcpToggle = async function(name, enabled) {
    const config = { ..._servers[name], enabled };
    try {
      await api('/api/mgmt/mcp-servers/update', {
        method: 'POST',
        body: JSON.stringify({ name, config }),
      });
      await loadServers();
    } catch (err) {
      _showToast('Toggle failed: ' + err.message, true);
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

  window.initMcpPanel = function() {
    loadServers().catch(err => {
      const el = $('mcpServerList');
      if (el) el.innerHTML = `<div style="padding:24px;color:var(--accent)">Error: ${esc(err.message)}</div>`;
    });
  };

})();
