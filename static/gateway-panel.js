/**
 * Gateway management panel — Vanilla JS
 */
(function() {
  'use strict';

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

  async function loadStatus() {
    const el = $('gatewayPanel');
    if (!el) return;
    el.innerHTML = '<div style="padding:12px;color:var(--muted)">Checking...</div>';
    try {
      const data = await api('/api/mgmt/gateway/status');
      const running = data.running;
      const statusColor = running ? '#22c55e' : '#ef4444';
      const statusText = running ? 'Running' : 'Stopped';
      let html = `<div class="gw-status-card">
        <div class="gw-status-indicator" style="background:${statusColor}"></div>
        <div class="gw-status-info">
          <div class="gw-status-text" style="color:${statusColor}">${statusText}</div>
          ${data.pid ? `<div style="font-size:10px;color:var(--muted)">PID: ${data.pid}</div>` : ''}
          ${data.url ? `<div style="font-size:10px;color:var(--muted)">URL: ${data.url}</div>` : ''}
        </div>
      </div>`;

      // Health details
      if (data.health) {
        const h = data.health;
        html += `<div class="gw-details">
          <div style="font-size:11px;color:var(--muted);margin-bottom:6px">Health Check</div>`;
        if (h.platforms) {
          for (const [name, info] of Object.entries(h.platforms)) {
            const connected = info.status === 'connected';
            html += `<div class="gw-platform">
              <span style="color:${connected ? '#22c55e' : 'var(--muted)'}">${connected ? '●' : '○'}</span>
              <span style="font-size:11px">${name}</span>
              ${info.username ? `<span style="font-size:10px;color:var(--muted)">${info.username}</span>` : ''}
            </div>`;
          }
        }
        html += `</div>`;
      }

      // Action buttons
      html += `<div class="gw-actions">
        <button class="cron-btn" style="flex:1" onclick="window._gwAction('start')" ${running ? 'disabled style="flex:1;opacity:.4"' : ''}>Start</button>
        <button class="cron-btn" style="flex:1" onclick="window._gwAction('stop')" ${!running ? 'disabled style="flex:1;opacity:.4"' : ''}>Stop</button>
        <button class="cron-btn run" style="flex:1" onclick="window._gwAction('restart')">Restart</button>
      </div>`;

      el.innerHTML = html;
    } catch (err) {
      el.innerHTML = `<div style="padding:12px;color:var(--accent)">Error: ${esc(err.message)}</div>`;
    }
  }

  window._gwAction = async function(action) {
    const el = $('gatewayPanel');
    if (el) el.innerHTML = '<div style="padding:12px;color:var(--muted)">' + action.charAt(0).toUpperCase() + action.slice(1) + 'ing...</div>';
    try {
      const data = await api('/api/mgmt/gateway/' + action, { method: 'POST', body: '{}' });
      _showToast(data.output || (action + ' completed'));
      // Refresh after delay
      setTimeout(loadStatus, 2000);
    } catch (err) {
      _showToast(action + ' failed: ' + err.message, true);
      loadStatus();
    }
  };

  function _showToast(msg, isError) {
    if (window.ui && window.ui.toast) { window.ui.toast(msg, isError ? 'error' : 'success'); return; }
    const el = document.createElement('div');
    el.textContent = msg;
    el.style.cssText = `position:fixed;bottom:20px;left:50%;transform:translateX(-50%);padding:8px 16px;border-radius:8px;font-size:13px;z-index:9999;${isError ? 'background:#dc3545;color:#fff' : 'background:var(--surface);color:var(--text);border:1px solid var(--border)'}`;
    document.body.appendChild(el);
    setTimeout(() => el.remove(), 3000);
  }

  function $(id) { return document.getElementById(id); }
  function esc(s) { return String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;'); }

  window.initGatewayPanel = function() { loadStatus(); };
})();
