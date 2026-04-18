/**
 * Usage / Analytics panel — Vanilla JS
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

  let _period = 30;

  async function loadUsage() {
    const el = $('usagePanel');
    if (!el) return;
    el.innerHTML = '<div style="padding:12px;color:var(--muted)">Loading...</div>';
    try {
      const data = await api('/api/mgmt/usage?days=' + _period);
      const totals = data.totals || {};
      const sessions = totals.total_sessions || 0;
      const inputTk = totals.total_input || 0;
      const outputTk = totals.total_output || 0;
      const cost = totals.total_cost || 0;

      let html = `<div class="usage-cards">
        <div class="usage-card"><div class="usage-value">${sessions}</div><div class="usage-label">Sessions</div></div>
        <div class="usage-card"><div class="usage-value">${_fmtTokens(inputTk)}</div><div class="usage-label">Input tokens</div></div>
        <div class="usage-card"><div class="usage-value">${_fmtTokens(outputTk)}</div><div class="usage-label">Output tokens</div></div>
        <div class="usage-card"><div class="usage-value">$${cost.toFixed(2)}</div><div class="usage-label">Est. cost</div></div>
      </div>`;

      // By model breakdown
      const byModel = data.by_model || [];
      if (byModel.length) {
        html += `<div class="usage-section"><div class="usage-section-title">By Model</div>`;
        html += byModel.map(m => `<div class="usage-row">
          <div class="usage-model">${esc(m.model || 'unknown')}</div>
          <div class="usage-stats">
            <span>${m.sessions} sessions</span>
            <span>${_fmtTokens(m.input_tokens + m.output_tokens)} tokens</span>
            <span>$${(m.estimated_cost || 0).toFixed(2)}</span>
          </div>
        </div>`).join('');
        html += `</div>`;
      }

      // Daily trend (simple text chart)
      const daily = data.daily || [];
      if (daily.length) {
        html += `<div class="usage-section"><div class="usage-section-title">Daily (${_period}d)</div>`;
        html += `<div class="usage-daily">`;
        // Show last 14 days max in compact form
        const show = daily.slice(-14);
        for (const d of show) {
          const barWidth = Math.max(2, Math.min(100, (d.sessions || 0) * 5));
          html += `<div class="usage-daily-row">
            <span class="usage-day">${d.day?.slice(5) || ''}</span>
            <div class="usage-bar-track"><div class="usage-bar" style="width:${barWidth}%"></div></div>
            <span class="usage-count">${d.sessions || 0}</span>
          </div>`;
        }
        html += `</div></div>`;
      }

      el.innerHTML = html;
    } catch (err) {
      el.innerHTML = `<div style="padding:12px;color:var(--accent)">Error: ${esc(err.message)}</div>`;
    }
  }

  function _fmtTokens(n) {
    if (n >= 1_000_000) return (n / 1_000_000).toFixed(1) + 'M';
    if (n >= 1_000) return (n / 1_000).toFixed(1) + 'K';
    return String(n);
  }

  window._usagePeriod = function(days) {
    _period = days;
    loadUsage();
  };

  function $(id) { return document.getElementById(id); }
  function esc(s) { return String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;'); }

  window.initUsagePanel = function() { loadUsage(); };
})();
