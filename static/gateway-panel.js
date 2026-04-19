/**
 * Gateway management panel — Vanilla JS
 */
(function() {
  'use strict';

  const PLATFORM_NAMES = {
    telegram: "Telegram", discord: "Discord", slack: "Slack",
    whatsapp: "WhatsApp", matrix: "Matrix", feishu: "飞书",
    dingtalk: "钉钉", wecom: "企微", mattermost: "Mattermost",
    webhook: "Webhook", api_server: "API Server",
  };

  const STATE_COLORS = {
    connected: "#22c55e", running: "#22c55e",
    disconnected: "#ef4444", fatal: "#ef4444",
    connecting: "#f59e0b", retrying: "#f59e0b",
    draining: "#f59e0b", stopping: "#f59e0b",
    not_connected: "var(--muted)",
  };

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

      // Status card
      let html = `<div class="gw-status-card">
        <div class="gw-status-indicator" style="background:${statusColor}"></div>
        <div class="gw-status-info">
          <div class="gw-status-text" style="color:${statusColor}">${statusText}</div>
          ${data.pid ? `<div style="font-size:10px;color:var(--muted)">PID: ${data.pid}</div>` : ''}
          ${data.url ? `<div style="font-size:10px;color:var(--muted)">URL: ${data.url}</div>` : ''}
          ${data.gateway_state ? `<div style="font-size:10px;color:var(--muted)">State: ${esc(data.gateway_state)}</div>` : ''}
        </div>
      </div>`;

      // Platforms list
      const platforms = data.platforms || {};
      if (Object.keys(platforms).length > 0) {
        html += `<div class="gw-details">
          <div style="font-size:11px;color:var(--muted);margin-bottom:6px">平台连接状态</div>`;
        for (const [name, info] of Object.entries(platforms)) {
          const state = info.state || "unknown";
          const color = STATE_COLORS[state] || "var(--muted)";
          const label = PLATFORM_NAMES[name] || name;
          const connected = state === "connected" || state === "running";
          html += `<div class="gw-platform">
            <span style="color:${color};font-size:14px">${connected ? '●' : '○'}</span>
            <span style="font-size:11px;font-weight:500">${esc(label)}</span>
            <span style="font-size:10px;color:${color}">${esc(state)}</span>
            ${info.error_message ? `<span style="font-size:10px;color:#ef4444" title="${esc(info.error_message)}">!</span>` : ''}
          </div>`;
        }
        html += `</div>`;
      } else {
        html += `<div style="padding:12px;font-size:11px;color:var(--muted)">未配置任何平台渠道</div>`;
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
