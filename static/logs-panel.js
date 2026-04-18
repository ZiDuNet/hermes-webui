/**
 * Logs viewer panel — Vanilla JS
 */
(function() {
  'use strict';

  async function api(path) {
    const res = await fetch(path);
    if (!res.ok) {
      const err = await res.json().catch(() => ({ error: res.statusText }));
      throw new Error(err.error || res.statusText);
    }
    return res.json();
  }

  let _logFile = 'agent';
  let _logLevel = '';
  let _logSearch = '';
  let _autoRefresh = false;
  let _refreshTimer = null;

  async function loadLogs() {
    const el = $('logsContent');
    if (!el) return;
    const params = new URLSearchParams({ file: _logFile, lines: '300', level: _logLevel, search: _logSearch });
    try {
      const data = await api('/api/mgmt/logs?' + params);
      const lines = data.lines || [];
      if (!lines.length) {
        el.innerHTML = '<div style="padding:24px;text-align:center;color:var(--muted)">No log entries found</div>';
        return;
      }
      el.innerHTML = lines.map(line => {
        const level = _parseLevel(line);
        const cls = level === 'ERROR' ? 'log-error' : level === 'WARNING' ? 'log-warn' : '';
        return `<div class="log-line ${cls}">${esc(line)}</div>`;
      }).join('');
      el.scrollTop = el.scrollHeight;
      // Update count
      const count = $('logsCount');
      if (count) count.textContent = `${lines.length} lines`;
    } catch (err) {
      el.innerHTML = `<div style="padding:24px;color:var(--accent)">Error: ${esc(err.message)}</div>`;
    }
  }

  function _parseLevel(line) {
    const upper = line.toUpperCase();
    if (upper.includes('ERROR')) return 'ERROR';
    if (upper.includes('WARNING') || upper.includes('WARN')) return 'WARNING';
    if (upper.includes('DEBUG')) return 'DEBUG';
    if (upper.includes('INFO')) return 'INFO';
    return '';
  }

  window._logsSetFile = function(f) {
    _logFile = f;
    loadLogs();
  };

  window._logsSetLevel = function(l) {
    _logLevel = l;
    loadLogs();
  };

  window._logsSearch = function(val) {
    _logSearch = val;
    loadLogs();
  };

  window._logsRefresh = function() { loadLogs(); };

  window._logsAutoRefresh = function(on) {
    _autoRefresh = on;
    if (_refreshTimer) { clearInterval(_refreshTimer); _refreshTimer = null; }
    if (on) _refreshTimer = setInterval(loadLogs, 5000);
  };

  function $(id) { return document.getElementById(id); }
  function esc(s) { return String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;'); }

  window.initLogsPanel = function() { loadLogs(); };
})();
