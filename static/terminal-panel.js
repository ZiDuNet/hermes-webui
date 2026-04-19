/* terminal-panel.js — 简易终端面板 (HTTP polling 模式) */
(function () {
  let initialized = false;
  let pollTimer = null;

  async function initTerm() {
    const el = document.getElementById("terminalPanel");
    if (!el) return;
    el.innerHTML = `
      <div class="term-toolbar">
        <span class="term-title">Terminal</span>
        <span class="term-hint">输入命令并回车执行（HTTP 模式，非实时 WebSocket）</span>
      </div>
      <div class="term-output" id="termOutput"><div class="term-line term-info">Hermes Terminal (HTTP polling mode)</div></div>
      <div class="term-input-row">
        <span class="term-prompt">$</span>
        <input type="text" id="termInput" class="term-input" placeholder="输入命令..." autocomplete="off">
      </div>`;
    const input = document.getElementById("termInput");
    if (input) {
      input.addEventListener("keydown", function (e) {
        if (e.key === "Enter" && input.value.trim()) {
          window._termExec(input.value.trim());
          input.value = "";
        }
      });
      input.focus();
    }
  }

  window._termExec = async function (cmd) {
    const output = document.getElementById("termOutput");
    if (!output) return;
    // Echo command
    output.innerHTML += `<div class="term-line term-cmd">$ ${_escHtml(cmd)}</div>`;
    output.innerHTML += `<div class="term-line term-info">执行中...</div>`;
    output.scrollTop = output.scrollHeight;
    try {
      const res = await fetch("/api/mgmt/terminal/exec", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ command: cmd }),
      });
      const data = await res.json();
      // Remove "执行中..." line
      const lines = output.querySelectorAll(".term-line");
      if (lines.length > 0 && lines[lines.length - 1].classList.contains("term-info")) {
        lines[lines.length - 1].remove();
      }
      if (data.stdout) output.innerHTML += `<div class="term-line">${_escHtml(data.stdout)}</div>`;
      if (data.stderr) output.innerHTML += `<div class="term-line term-err">${_escHtml(data.stderr)}</div>`;
      if (!data.stdout && !data.stderr && data.exit_code !== undefined) {
        output.innerHTML += `<div class="term-line term-info">(exit code: ${data.exit_code})</div>`;
      }
    } catch (e) {
      const lines = output.querySelectorAll(".term-line");
      if (lines.length > 0 && lines[lines.length - 1].classList.contains("term-info")) {
        lines[lines.length - 1].textContent = "连接失败: " + e.message;
        lines[lines.length - 1].className = "term-line term-err";
      }
    }
    output.scrollTop = output.scrollHeight;
  };

  function _escHtml(s) {
    const div = document.createElement("div");
    div.textContent = s;
    return div.innerHTML.replace(/\n/g, "<br>");
  }

  window.initTerminalPanel = function () {
    if (initialized) return;
    initialized = true;
    initTerm();
  };
})();
