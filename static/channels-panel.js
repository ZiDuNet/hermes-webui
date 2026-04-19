/* channels-panel.js — 渠道管理面板 */
(function () {
  let initialized = false;

  // 平台元数据
  const PLATFORMS = [
    {
      id: "telegram", name: "Telegram", icon: "T",
      envKeys: ["TELEGRAM_BOT_TOKEN"],
      fields: [
        { key: "TELEGRAM_BOT_TOKEN", label: "Bot Token", type: "password" },
        { key: "allowed_users", label: "Allowed Users (comma separated)", type: "text", configKey: true },
        { key: "admin_users", label: "Admin Users (comma separated)", type: "text", configKey: true },
      ],
    },
    {
      id: "discord", name: "Discord", icon: "D",
      envKeys: ["DISCORD_BOT_TOKEN"],
      fields: [
        { key: "DISCORD_BOT_TOKEN", label: "Bot Token", type: "password" },
        { key: "DISCORD_APPLICATION_ID", label: "Application ID", type: "text" },
        { key: "allowed_channels", label: "Allowed Channels (comma separated)", type: "text", configKey: true },
      ],
    },
    {
      id: "slack", name: "Slack", icon: "S",
      envKeys: ["SLACK_BOT_TOKEN"],
      fields: [
        { key: "SLACK_BOT_TOKEN", label: "Bot Token (xoxb-...)", type: "password" },
        { key: "SLACK_APP_TOKEN", label: "App Token (xapp-...)", type: "password" },
        { key: "allowed_channels", label: "Allowed Channels (comma separated)", type: "text", configKey: true },
      ],
    },
    {
      id: "whatsapp", name: "WhatsApp", icon: "W",
      envKeys: ["WHATSAPP_ENABLED"],
      fields: [
        { key: "WHATSAPP_ENABLED", label: "Enabled", type: "checkbox" },
      ],
    },
    {
      id: "matrix", name: "Matrix", icon: "M",
      envKeys: ["MATRIX_ACCESS_TOKEN"],
      fields: [
        { key: "MATRIX_ACCESS_TOKEN", label: "Access Token", type: "password" },
        { key: "MATRIX_HOMESERVER", label: "Home Server URL", type: "text" },
        { key: "MATRIX_USER_ID", label: "User ID (@user:server)", type: "text" },
      ],
    },
    {
      id: "feishu", name: "飞书 (Feishu)", icon: "F",
      envKeys: ["FEISHU_APP_ID"],
      fields: [
        { key: "FEISHU_APP_ID", label: "App ID", type: "text" },
        { key: "FEISHU_APP_SECRET", label: "App Secret", type: "password" },
        { key: "FEISHU_VERIFICATION_TOKEN", label: "Verification Token", type: "text" },
      ],
    },
    {
      id: "dingtalk", name: "钉钉 (DingTalk)", icon: "D",
      envKeys: ["DINGTALK_CLIENT_ID"],
      fields: [
        { key: "DINGTALK_CLIENT_ID", label: "Client ID", type: "text" },
        { key: "DINGTALK_CLIENT_SECRET", label: "Client Secret", type: "password" },
      ],
    },
    {
      id: "wecom", name: "企微 (WeCom)", icon: "W",
      envKeys: ["WECOM_BOT_ID"],
      fields: [
        { key: "WECOM_BOT_ID", label: "Bot ID", type: "text" },
        { key: "WECOM_BOT_SECRET", label: "Bot Secret", type: "password" },
      ],
    },
  ];

  async function loadChannels() {
    const el = document.getElementById("channelsPanel");
    if (!el) return;
    el.innerHTML = '<div style="color:var(--muted);font-size:12px">Loading...</div>';
    try {
      const res = await fetch("/api/mgmt/channels");
      const data = await res.json();
      if (data.error) { el.innerHTML = `<div class="ch-error">${data.error}</div>`; return; }
      renderChannels(el, data);
    } catch (e) {
      el.innerHTML = `<div class="ch-error">Failed to load: ${e.message}</div>`;
    }
  }

  function renderChannels(el, data) {
    let html = "";
    for (const plat of PLATFORMS) {
      const info = data[plat.id] || {};
      const configured = info.configured;
      const hasCred = info.has_credentials;
      const cfg = info.config || {};
      const statusCls = configured ? "ch-status on" : "ch-status off";
      const statusTxt = configured ? "已配置" : "未配置";

      html += `<div class="ch-card${configured ? " configured" : ""}" data-platform="${plat.id}">
        <div class="ch-card-header">
          <div class="ch-icon">${plat.icon}</div>
          <div class="ch-card-title">
            <strong>${plat.name}</strong>
            <span class="${statusCls}">${statusTxt}</span>
          </div>
          <button class="ch-toggle-btn" onclick="window._chToggle('${plat.id}')" title="展开/折叠">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="6 9 12 15 18 9"/></svg>
          </button>
        </div>
        <div class="ch-card-body" id="chBody_${plat.id}" style="display:none">
          <div class="ch-fields">`;

      for (const f of plat.fields) {
        const isEnv = !f.configKey;
        const currentVal = isEnv ? (hasCred ? "••••••••" : "") : (cfg[f.key] || "");
        const inputType = f.type === "password" ? "password" : "text";

        if (f.type === "checkbox") {
          const checked = currentVal === "true" || currentVal === true || currentVal === "1" ? "checked" : "";
          html += `<label class="ch-field">
            <span class="ch-field-label">${f.label}</span>
            <input type="checkbox" data-key="${f.key}" data-env="${isEnv ? "1" : "0"}" ${checked} class="ch-input-checkbox">
          </label>`;
        } else {
          html += `<label class="ch-field">
            <span class="ch-field-label">${f.label}${isEnv ? ' <span style="font-size:10px;opacity:.5">(env)</span>' : ""}</span>
            <input type="${inputType}" value="${_esc(String(currentVal))}" data-key="${f.key}" data-env="${isEnv ? "1" : "0"}" class="ch-input" placeholder="未设置">
          </label>`;
        }
      }

      html += `</div>
          <div class="ch-actions">
            <button class="ch-save-btn" onclick="window._chSave('${plat.id}')">保存</button>
            <span class="ch-save-msg" id="chMsg_${plat.id}"></span>
          </div>
        </div>
      </div>`;
    }
    el.innerHTML = html;
  }

  function _esc(s) { return s.replace(/&/g, "&amp;").replace(/"/g, "&quot;").replace(/</g, "&lt;"); }

  // 展开/折叠
  window._chToggle = function (platId) {
    const body = document.getElementById("chBody_" + platId);
    if (body) body.style.display = body.style.display === "none" ? "block" : "none";
  };

  // 保存
  window._chSave = async function (platId) {
    const msgEl = document.getElementById("chMsg_" + platId);
    if (msgEl) { msgEl.textContent = "保存中..."; msgEl.style.color = "var(--muted)"; }

    const body = document.getElementById("chBody_" + platId);
    if (!body) return;

    const inputs = body.querySelectorAll("input");
    const config = {};
    const credentials = {};

    for (const inp of inputs) {
      const key = inp.dataset.key;
      const isEnv = inp.dataset.env === "1";
      let val = inp.type === "checkbox" ? (inp.checked ? "true" : "") : inp.value.trim();
      // Skip masked values
      if (val === "••••••••") continue;
      if (isEnv) {
        if (val) credentials[key] = val;
      } else {
        if (val) config[key] = val;
      }
    }

    try {
      const res = await fetch("/api/mgmt/channels", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ platform: platId, config, credentials }),
      });
      const data = await res.json();
      if (msgEl) {
        if (data.ok) { msgEl.textContent = "已保存"; msgEl.style.color = "var(--accent)"; }
        else { msgEl.textContent = data.error || "保存失败"; msgEl.style.color = "#e55"; }
      }
      setTimeout(() => loadChannels(), 800);
    } catch (e) {
      if (msgEl) { msgEl.textContent = "保存失败: " + e.message; msgEl.style.color = "#e55"; }
    }
  };

  window.initChannelsPanel = function () {
    if (initialized) { loadChannels(); return; }
    initialized = true;
    loadChannels();
  };
})();
