/* oauth-panel.js — OAuth / API Key 管理面板 */
(function () {
  let initialized = false;

  const PROVIDER_META = {
    anthropic: { name: "Anthropic (Claude)", color: "#d4a276" },
    openai: { name: "OpenAI", color: "#74aa9c" },
    google: { name: "Google (Gemini)", color: "#4285f4" },
    groq: { name: "Groq", color: "#f55036" },
    mistral: { name: "Mistral", color: "#ff7000" },
    deepseek: { name: "DeepSeek", color: "#4a90d9" },
    openrouter: { name: "OpenRouter", color: "#6d28d9" },
  };

  async function loadProviders() {
    const el = document.getElementById("oauthPanel");
    if (!el) return;
    el.innerHTML = '<div style="color:var(--muted);font-size:12px">Loading...</div>';
    try {
      const res = await fetch("/api/mgmt/oauth/providers");
      const data = await res.json();
      if (data.error) { el.innerHTML = `<div class="oauth-error">${data.error}</div>`; return; }
      renderProviders(el, data.providers || []);
    } catch (e) {
      el.innerHTML = `<div class="oauth-error">Failed: ${e.message}</div>`;
    }
  }

  function renderProviders(el, providers) {
    let html = '<div class="oauth-list">';
    for (const p of providers) {
      const meta = PROVIDER_META[p.id] || { name: p.name, color: "#888" };
      const loggedIn = p.status && p.status.logged_in;
      const statusDot = loggedIn ? "oauth-dot on" : "oauth-dot off";
      const statusTxt = loggedIn ? "已设置" : "未设置";

      html += `<div class="oauth-card" data-provider="${p.id}">
        <div class="oauth-card-header">
          <div class="oauth-icon" style="background:${meta.color}20;color:${meta.color}">${(meta.name[0] || "?").toUpperCase()}</div>
          <div class="oauth-card-info">
            <strong>${meta.name}</strong>
            <span class="${statusDot}">${statusTxt}</span>
          </div>
          <div class="oauth-card-actions">`;

      if (loggedIn) {
        html += `<button class="oauth-btn reveal" onclick="window._oauthReveal('${p.id}')" title="显示 Key">显示</button>
                 <button class="oauth-btn remove" onclick="window._oauthRemove('${p.id}')" title="删除 Key">删除</button>`;
      } else {
        html += `<button class="oauth-btn add" onclick="window._oauthShowForm('${p.id}')">+ 设置</button>`;
      }

      html += `</div></div>
        <div class="oauth-form" id="oauthForm_${p.id}" style="display:none">
          <div class="oauth-form-row">
            <input type="password" id="oauthInput_${p.id}" class="oauth-input" placeholder="输入 API Key">
            <button class="oauth-btn save" onclick="window._oauthSave('${p.id}')">保存</button>
          </div>
          <div class="oauth-form-msg" id="oauthMsg_${p.id}"></div>
        </div>
      </div>`;
    }
    html += "</div>";
    el.innerHTML = html;
  }

  window._oauthShowForm = function (id) {
    const form = document.getElementById("oauthForm_" + id);
    if (form) form.style.display = form.style.display === "none" ? "block" : "none";
  };

  window._oauthSave = async function (id) {
    const input = document.getElementById("oauthInput_" + id);
    const msg = document.getElementById("oauthMsg_" + id);
    if (!input || !input.value.trim()) { if (msg) { msg.textContent = "请输入 API Key"; msg.style.color = "#e55"; } return; }
    if (msg) { msg.textContent = "保存中..."; msg.style.color = "var(--muted)"; }
    try {
      const res = await fetch("/api/mgmt/oauth/set-key", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ provider: id, api_key: input.value.trim() }),
      });
      const data = await res.json();
      if (data.ok) { if (msg) { msg.textContent = "已保存"; msg.style.color = "var(--accent)"; } setTimeout(() => loadProviders(), 600); }
      else { if (msg) { msg.textContent = data.error || "失败"; msg.style.color = "#e55"; } }
    } catch (e) { if (msg) { msg.textContent = e.message; msg.style.color = "#e55"; } }
  };

  window._oauthReveal = async function (id) {
    const msg = document.getElementById("oauthMsg_" + id);
    if (msg) { msg.textContent = "获取中..."; msg.style.color = "var(--muted)"; }
    // Use the env reveal mechanism — need the env key name
    const keyMap = {
      anthropic: "ANTHROPIC_API_KEY", openai: "OPENAI_API_KEY", google: "GOOGLE_API_KEY",
      groq: "GROQ_API_KEY", mistral: "MISTRAL_API_KEY", deepseek: "DEEPSEEK_API_KEY",
      openrouter: "OPENROUTER_API_KEY",
    };
    const envKey = keyMap[id];
    if (!envKey) return;
    try {
      const res = await fetch("/api/mgmt/env/reveal", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ key: envKey }),
      });
      const data = await res.json();
      if (data.value) {
        // Show in the form
        const form = document.getElementById("oauthForm_" + id);
        if (form) form.style.display = "block";
        const input = document.getElementById("oauthInput_" + id);
        if (input) input.value = data.value;
        if (msg) { msg.textContent = "已显示"; msg.style.color = "var(--accent)"; }
      } else {
        if (msg) { msg.textContent = data.error || "无法获取"; msg.style.color = "#e55"; }
      }
    } catch (e) { if (msg) { msg.textContent = e.message; msg.style.color = "#e55"; } }
  };

  window._oauthRemove = async function (id) {
    if (!confirm("确认删除该 API Key？")) return;
    try {
      await fetch("/api/mgmt/oauth/remove-key", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ provider: id }),
      });
      loadProviders();
    } catch (e) { alert("删除失败: " + e.message); }
  };

  window.initOauthPanel = function () {
    if (initialized) { loadProviders(); return; }
    initialized = true;
    loadProviders();
  };
})();
