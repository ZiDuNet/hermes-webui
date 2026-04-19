"""
Hermes Web UI -- Management routes (Config, Keys/Env, MCP Servers).
Directly imports from hermes_cli.config — no Gateway HTTP API needed.
"""

import json
import logging
import os
import shutil
import threading
import time
from pathlib import Path

from api.helpers import j, read_body

logger = logging.getLogger(__name__)

# ── Schema helpers (mirrored from web_server.py) ─────────────────────────────

_SCHEMA_OVERRIDES = {
    "model": {
        "type": "string",
        "description": "Default model (e.g. anthropic/claude-sonnet-4.6)",
        "category": "general",
    },
    "model_context_length": {
        "type": "number",
        "description": "Context window override (0 = auto-detect from model metadata)",
        "category": "general",
    },
    "terminal.backend": {
        "type": "select",
        "description": "Terminal execution backend",
        "options": ["local", "docker", "ssh", "modal", "daytona", "singularity"],
    },
    "terminal.modal_mode": {
        "type": "select",
        "description": "Modal sandbox mode",
        "options": ["sandbox", "function"],
    },
    "tts.provider": {
        "type": "select",
        "description": "Text-to-speech provider",
        "options": ["edge", "elevenlabs", "openai", "neutts"],
    },
    "stt.provider": {
        "type": "select",
        "description": "Speech-to-text provider",
        "options": ["local", "openai", "mistral"],
    },
    "display.skin": {
        "type": "select",
        "description": "CLI visual theme",
        "options": ["default", "ares", "mono", "slate"],
    },
    "dashboard.theme": {
        "type": "select",
        "description": "Web dashboard visual theme",
        "options": ["default", "midnight", "ember", "mono", "cyberpunk", "rose"],
    },
    "display.resume_display": {
        "type": "select",
        "description": "How resumed sessions display history",
        "options": ["minimal", "full", "off"],
    },
    "display.busy_input_mode": {
        "type": "select",
        "description": "Input behavior while agent is running",
        "options": ["queue", "interrupt", "block"],
    },
    "memory.provider": {
        "type": "select",
        "description": "Memory provider plugin",
        "options": ["builtin", "honcho"],
    },
    "approvals.mode": {
        "type": "select",
        "description": "Dangerous command approval mode",
        "options": ["ask", "yolo", "deny"],
    },
    "context.engine": {
        "type": "select",
        "description": "Context management engine",
        "options": ["default", "custom"],
    },
    "human_delay.mode": {
        "type": "select",
        "description": "Simulated typing delay mode",
        "options": ["off", "typing", "fixed"],
    },
    "logging.level": {
        "type": "select",
        "description": "Log level for agent.log",
        "options": ["DEBUG", "INFO", "WARNING", "ERROR"],
    },
    "agent.service_tier": {
        "type": "select",
        "description": "API service tier (OpenAI/Anthropic)",
        "options": ["", "auto", "default", "flex"],
    },
    "delegation.reasoning_effort": {
        "type": "select",
        "description": "Reasoning effort for delegated subagents",
        "options": ["", "low", "medium", "high"],
    },
}

_CATEGORY_MERGE = {
    "privacy": "security",
    "context": "agent",
    "skills": "agent",
    "cron": "agent",
    "network": "agent",
    "checkpoints": "agent",
    "approvals": "security",
    "human_delay": "display",
    "smart_model_routing": "agent",
    "dashboard": "display",
}

_CATEGORY_ORDER = [
    "general", "agent", "terminal", "display", "delegation",
    "memory", "compression", "security", "browser", "voice",
    "tts", "stt", "logging", "discord", "auxiliary",
]


def _infer_type(value):
    if isinstance(value, bool):
        return "boolean"
    if isinstance(value, (int, float)):
        return "number"
    if isinstance(value, list):
        return "list"
    if isinstance(value, dict):
        return "object"
    return "string"


def _build_schema_from_config(config, prefix=""):
    schema = {}
    for key, value in config.items():
        full_key = f"{prefix}.{key}" if prefix else key
        if full_key == "_config_version":
            continue
        if prefix:
            category = prefix.split(".")[0]
        elif isinstance(value, dict):
            category = key
        else:
            category = "general"
        if isinstance(value, dict):
            schema.update(_build_schema_from_config(value, full_key))
        else:
            entry = {
                "type": _infer_type(value),
                "description": full_key.replace(".", " → ").replace("_", " ").title(),
                "category": category,
            }
            if full_key in _SCHEMA_OVERRIDES:
                entry.update(_SCHEMA_OVERRIDES[full_key])
            entry["category"] = _CATEGORY_MERGE.get(entry["category"], entry["category"])
            schema[full_key] = entry
    return schema


# ── Config helpers ────────────────────────────────────────────────────────────

def _get_hermes_cli():
    """Import hermes_cli.config lazily (agent dir may not be available)."""
    from hermes_cli.config import (
        DEFAULT_CONFIG,
        OPTIONAL_ENV_VARS,
        load_config,
        save_config,
        load_env,
        save_env_value,
        remove_env_value,
        redact_key,
        get_config_path,
        get_env_path,
    )
    return {
        "DEFAULT_CONFIG": DEFAULT_CONFIG,
        "OPTIONAL_ENV_VARS": OPTIONAL_ENV_VARS,
        "load_config": load_config,
        "save_config": save_config,
        "load_env": load_env,
        "save_env_value": save_env_value,
        "remove_env_value": remove_env_value,
        "redact_key": redact_key,
        "get_config_path": get_config_path,
        "get_env_path": get_env_path,
    }


# Cache the imported module
_cli = None
_cli_lock = threading.Lock()


def _cli_module():
    global _cli
    if _cli is not None:
        return _cli
    with _cli_lock:
        if _cli is not None:
            return _cli
        _cli = _get_hermes_cli()
        return _cli


def _normalize_config_for_web(config):
    """Flatten model dict to string + model_context_length."""
    config = dict(config)
    model_val = config.get("model")
    if isinstance(model_val, dict):
        ctx_len = model_val.get("context_length", 0)
        config["model"] = model_val.get("default", model_val.get("name", ""))
        config["model_context_length"] = ctx_len if isinstance(ctx_len, int) else 0
    else:
        config["model_context_length"] = 0
    return config


def _denormalize_config_from_web(flat_config, disk_config):
    """Reverse normalize: restore model dict structure from disk config."""
    result = dict(flat_config)
    ctx_override = result.pop("model_context_length", 0)
    if not isinstance(ctx_override, int):
        try:
            ctx_override = int(ctx_override)
        except (TypeError, ValueError):
            ctx_override = 0

    model_val = result.get("model")
    disk_model = disk_config.get("model")
    if isinstance(model_val, str) and isinstance(disk_model, dict):
        disk_model = dict(disk_model)  # shallow copy
        disk_model["default"] = model_val
        if ctx_override > 0:
            disk_model["context_length"] = ctx_override
        else:
            disk_model.pop("context_length", None)
        result["model"] = disk_model
    return result


# ── Rate limiter for reveal ──────────────────────────────────────────────────

_reveal_timestamps = []
_REVEAL_MAX = 5
_REVEAL_WINDOW = 30  # seconds


# ══════════════════════════════════════════════════════════════════════════════
# Route handlers — return True if handled
# ══════════════════════════════════════════════════════════════════════════════

def handle_mgmt_get(handler, parsed) -> bool:
    """Handle management GET routes. Returns True if matched."""

    # ── Config ───────────────────────────────────────────────────────────
    if parsed.path == "/api/mgmt/config":
        cli = _cli_module()
        config = _normalize_config_for_web(cli["load_config"]())
        # Strip internal keys
        clean = {k: v for k, v in config.items() if not k.startswith("_")}
        return j(handler, clean)

    if parsed.path == "/api/mgmt/config/defaults":
        cli = _cli_module()
        return j(handler, cli["DEFAULT_CONFIG"])

    if parsed.path == "/api/mgmt/config/schema":
        cli = _cli_module()
        schema = _build_schema_from_config(cli["DEFAULT_CONFIG"])
        # Inject virtual model_context_length after model
        ordered = {}
        for k, v in schema.items():
            ordered[k] = v
            if k == "model":
                ordered["model_context_length"] = _SCHEMA_OVERRIDES["model_context_length"]
        return j(handler, {"fields": ordered, "category_order": _CATEGORY_ORDER})

    if parsed.path == "/api/mgmt/config/raw":
        cli = _cli_module()
        try:
            import yaml
            raw = cli["get_config_path"]().read_text(encoding="utf-8")
            return j(handler, {"yaml": raw})
        except Exception as e:
            return j(handler, {"error": str(e)}, status=500)

    # ── Env / Keys ───────────────────────────────────────────────────────
    if parsed.path == "/api/mgmt/env":
        cli = _cli_module()
        env_on_disk = cli["load_env"]()
        result = {}
        for var_name, info in cli["OPTIONAL_ENV_VARS"].items():
            value = env_on_disk.get(var_name)
            result[var_name] = {
                "is_set": bool(value),
                "redacted_value": cli["redact_key"](value) if value else None,
                "value": value if value else "",
                "description": info.get("description", ""),
                "url": info.get("url", ""),
                "category": info.get("category", ""),
                "is_password": info.get("password", False),
                "tools": info.get("tools", []),
                "advanced": info.get("advanced", False),
            }
        return j(handler, result)

    # ── MCP Servers ──────────────────────────────────────────────────────
    if parsed.path == "/api/mgmt/mcp-servers":
        cli = _cli_module()
        config = cli["load_config"]()
        servers = config.get("mcp_servers", {})
        return j(handler, {"servers": servers})

    # ── Gateway status ────────────────────────────────────────────────────
    if parsed.path == "/api/mgmt/gateway/status":
        try:
            import subprocess
            from api.config import HOME
            hermes_home = Path(os.getenv("HERMES_HOME", str(HOME / ".hermes")))
            pid_file = hermes_home / "gateway.pid"
            state_file = hermes_home / "gateway_state.json"
            health_url = "http://127.0.0.1:8642"
            pid = None
            running = False
            platforms = {}
            gateway_state = None

            # Check PID file
            if pid_file.exists():
                try:
                    pid = int(pid_file.read_text().strip())
                    import signal
                    try:
                        os.kill(pid, 0)
                        running = True
                    except (ProcessLookupError, PermissionError):
                        running = False
                        pid = None
                except (ValueError, OSError):
                    pid = None

            # Read gateway_state.json for platform statuses
            if state_file.exists():
                try:
                    state_data = json.loads(state_file.read_text(encoding="utf-8"))
                    platforms = state_data.get("platforms", {})
                    gateway_state = state_data.get("gateway_state")
                except Exception:
                    pass

            # If no platforms from state file, try health endpoint
            if not platforms and running:
                try:
                    import urllib.request
                    resp = urllib.request.urlopen(f"{health_url}/health", timeout=2)
                    health_data = json.loads(resp.read())
                    platforms = health_data.get("platforms", {})
                    gateway_state = health_data.get("gateway_state", gateway_state)
                except Exception:
                    pass

            # If still no platforms but config has them, show as "not connected"
            if not platforms:
                try:
                    cli = _cli_module()
                    config = cli["load_config"]()
                    env_values = cli["load_env"]()
                    platform_map = {
                        "telegram": "TELEGRAM_BOT_TOKEN",
                        "discord": "DISCORD_BOT_TOKEN",
                        "slack": "SLACK_BOT_TOKEN",
                        "whatsapp": "WHATSAPP_ENABLED",
                        "matrix": "MATRIX_ACCESS_TOKEN",
                        "feishu": "FEISHU_APP_ID",
                        "dingtalk": "DINGTALK_CLIENT_ID",
                        "wecom": "WECOM_BOT_ID",
                    }
                    for p_name, env_key in platform_map.items():
                        has_cred = bool(env_values.get(env_key))
                        has_cfg = bool(config.get(p_name))
                        if has_cred or has_cfg:
                            platforms[p_name] = {
                                "state": "not_connected",
                                "configured": True,
                            }
                except Exception:
                    pass

            return j(handler, {
                "running": running,
                "pid": pid,
                "url": health_url,
                "gateway_state": gateway_state,
                "platforms": platforms,
            })
        except Exception as e:
            return j(handler, {"running": False, "error": str(e)})

    # ── Logs ──────────────────────────────────────────────────────────────
    if parsed.path == "/api/mgmt/logs":
        from urllib.parse import parse_qs
        qs = parse_qs(parsed.query)
        log_name = qs.get("file", ["agent"])[0]
        lines = int(qs.get("lines", ["200"])[0])
        level = qs.get("level", [""])[0].upper()
        search = qs.get("search", [""])[0]
        try:
            from api.config import HOME
            hermes_home = Path(os.getenv("HERMES_HOME", str(HOME / ".hermes")))
            log_file = hermes_home / "logs" / f"{log_name}.log"
            if not log_file.exists():
                return j(handler, {"lines": [], "file": log_name})
            with open(log_file, "r", encoding="utf-8", errors="replace") as f:
                all_lines = f.readlines()
            # Filter
            result = []
            for line in all_lines:
                if level and level not in line.upper():
                    continue
                if search and search.lower() not in line.lower():
                    continue
                result.append(line.rstrip("\n"))
            # Take last N lines
            result = result[-lines:]
            return j(handler, {"lines": result, "file": log_name, "total": len(all_lines)})
        except Exception as e:
            return j(handler, {"error": str(e)}, status=500)

    # ── Usage / Analytics ─────────────────────────────────────────────────
    if parsed.path == "/api/mgmt/usage":
        from urllib.parse import parse_qs
        qs = parse_qs(parsed.query)
        days = int(qs.get("days", ["30"])[0])
        try:
            import sqlite3
            from api.config import HOME
            db_path = Path(os.getenv("HERMES_HOME", str(HOME / ".hermes"))) / "state.db"
            if not db_path.exists():
                return j(handler, {"daily": [], "by_model": [], "totals": {}})
            with sqlite3.connect(str(db_path)) as conn:
                conn.row_factory = sqlite3.Row
                cur = conn.cursor()
                cutoff = time.time() - (days * 86400)
                # Daily stats
                cur.execute("""
                    SELECT DATE(started_at, 'unixepoch') as day,
                           COUNT(*) as sessions,
                           SUM(COALESCE(input_tokens, 0)) as input_tokens,
                           SUM(COALESCE(output_tokens, 0)) as output_tokens,
                           SUM(COALESCE(estimated_cost, 0)) as estimated_cost
                    FROM sessions
                    WHERE started_at >= ?
                    GROUP BY day ORDER BY day
                """, (cutoff,))
                daily = [dict(row) for row in cur.fetchall()]
                # By model
                cur.execute("""
                    SELECT model,
                           COUNT(*) as sessions,
                           SUM(COALESCE(input_tokens, 0)) as input_tokens,
                           SUM(COALESCE(output_tokens, 0)) as output_tokens,
                           SUM(COALESCE(estimated_cost, 0)) as estimated_cost
                    FROM sessions
                    WHERE started_at >= ?
                    GROUP BY model ORDER BY estimated_cost DESC
                """, (cutoff,))
                by_model = [dict(row) for row in cur.fetchall()]
                # Totals
                cur.execute("""
                    SELECT COUNT(*) as total_sessions,
                           SUM(COALESCE(input_tokens, 0)) as total_input,
                           SUM(COALESCE(output_tokens, 0)) as total_output,
                           SUM(COALESCE(estimated_cost, 0)) as total_cost
                    FROM sessions WHERE started_at >= ?
                """, (cutoff,))
                row = cur.fetchone()
                totals = dict(row) if row else {}
            return j(handler, {"daily": daily, "by_model": by_model, "totals": totals, "period_days": days})
        except Exception as e:
            return j(handler, {"error": str(e)}, status=500)

    # ── Channels ──────────────────────────────────────────────────────────
    if parsed.path == "/api/mgmt/channels":
        try:
            cli = _cli_module()
            config = cli["load_config"]()
            env_values = cli["load_env"]()
            platforms = ["telegram", "discord", "slack", "whatsapp", "matrix", "feishu", "dingtalk", "wecom"]
            result = {}
            for p in platforms:
                cfg = config.get(p, {})
                # Check if credentials exist
                token_map = {
                    "telegram": "TELEGRAM_BOT_TOKEN",
                    "discord": "DISCORD_BOT_TOKEN",
                    "slack": "SLACK_BOT_TOKEN",
                    "whatsapp": "WHATSAPP_ENABLED",
                    "matrix": "MATRIX_ACCESS_TOKEN",
                    "feishu": "FEISHU_APP_ID",
                    "dingtalk": "DINGTALK_CLIENT_ID",
                    "wecom": "WECOM_BOT_ID",
                }
                env_key = token_map.get(p, "")
                has_cred = bool(env_values.get(env_key))
                result[p] = {
                    "config": cfg,
                    "configured": has_cred or bool(cfg),
                    "has_credentials": has_cred,
                }
            return j(handler, result)
        except Exception as e:
            return j(handler, {"error": str(e)}, status=500)

    # ── OAuth Providers ───────────────────────────────────────────────────
    if parsed.path == "/api/mgmt/oauth/providers":
        try:
            import subprocess
            providers = [
                {"id": "anthropic", "name": "Anthropic (Claude API)", "flow": "pkce", "env_key": "ANTHROPIC_API_KEY"},
                {"id": "openai", "name": "OpenAI", "flow": "api_key", "env_key": "OPENAI_API_KEY"},
                {"id": "google", "name": "Google (Gemini)", "flow": "api_key", "env_key": "GOOGLE_API_KEY"},
                {"id": "groq", "name": "Groq", "flow": "api_key", "env_key": "GROQ_API_KEY"},
                {"id": "mistral", "name": "Mistral", "flow": "api_key", "env_key": "MISTRAL_API_KEY"},
                {"id": "deepseek", "name": "DeepSeek", "flow": "api_key", "env_key": "DEEPSEEK_API_KEY"},
                {"id": "openrouter", "name": "OpenRouter", "flow": "api_key", "env_key": "OPENROUTER_API_KEY"},
            ]
            cli = _cli_module()
            env_values = cli["load_env"]()
            for p in providers:
                key = p["env_key"]
                val = env_values.get(key, "")
                p["status"] = {
                    "logged_in": bool(val),
                    "source": "env_var" if val else "",
                    "has_key": bool(val),
                }
            return j(handler, {"providers": providers})
        except Exception as e:
            return j(handler, {"error": str(e)}, status=500)

    return False


def handle_mgmt_post(handler, parsed, body: dict = None) -> bool:
    """Handle management POST/PUT/DELETE routes. Returns True if matched."""
    if body is None:
        body = read_body(handler)

    # ── Terminal exec ────────────────────────────────────────────────────
    if parsed.path == "/api/mgmt/terminal/exec":
        if not body or "command" not in body:
            return j(handler, {"error": "Missing command"}, status=400)
        cmd = body["command"].strip()
        try:
            # Security: block dangerous commands
            blocked = ["rm -rf /", "del /s /q C:", "format", ":(){ :|:& };:", "mkfs"]
            if any(b in cmd.lower() for b in blocked):
                return j(handler, {"error": "Command blocked for safety", "exit_code": -1}, status=403)
            import subprocess
            result = subprocess.run(
                cmd, capture_output=True, text=True, timeout=30,
                shell=True, cwd=str(Path.home()),
            )
            return j(handler, {
                "stdout": result.stdout or "",
                "stderr": result.stderr or "",
                "exit_code": result.returncode,
            })
        except subprocess.TimeoutExpired:
            return j(handler, {"error": "Command timed out (30s)", "exit_code": -1}, status=408)
        except Exception as e:
            return j(handler, {"error": str(e)}, status=500)

    # ── Config save ──────────────────────────────────────────────────────
    if parsed.path == "/api/mgmt/config":
        if not body or "config" not in body:
            return j(handler, {"error": "Missing config"}, status=400)
        try:
            cli = _cli_module()
            disk_config = cli["load_config"]()
            web_config = body["config"]
            # Merge: only update top-level keys that exist in web_config
            merged = dict(disk_config)
            for k, v in web_config.items():
                merged[k] = v
            denorm = _denormalize_config_from_web(merged, disk_config)
            # Backup
            config_path = cli["get_config_path"]()
            if config_path.exists():
                shutil.copy2(config_path, str(config_path) + ".bak")
            cli["save_config"](denorm)
            return j(handler, {"ok": True})
        except Exception as e:
            logger.exception("PUT /api/mgmt/config failed")
            return j(handler, {"error": str(e)}, status=500)

    if parsed.path == "/api/mgmt/config/raw":
        if not body or "yaml_text" not in body:
            return j(handler, {"error": "Missing yaml_text"}, status=400)
        try:
            import yaml
            yaml.safe_load(body["yaml_text"])  # validate
            cli = _cli_module()
            config_path = cli["get_config_path"]()
            if config_path.exists():
                shutil.copy2(config_path, str(config_path) + ".bak")
            config_path.write_text(body["yaml_text"], encoding="utf-8")
            return j(handler, {"ok": True})
        except yaml.YAMLError as e:
            return j(handler, {"error": f"Invalid YAML: {e}"}, status=400)
        except Exception as e:
            return j(handler, {"error": str(e)}, status=500)

    if parsed.path == "/api/mgmt/config/reset":
        """Reset config to defaults."""
        try:
            import copy
            cli = _cli_module()
            config_path = cli["get_config_path"]()
            if config_path.exists():
                shutil.copy2(config_path, str(config_path) + ".bak")
            cli["save_config"](copy.deepcopy(cli["DEFAULT_CONFIG"]))
            return j(handler, {"ok": True})
        except Exception as e:
            return j(handler, {"error": str(e)}, status=500)

    # ── Env / Keys ───────────────────────────────────────────────────────
    if parsed.path == "/api/mgmt/env":
        if not body or "key" not in body:
            return j(handler, {"error": "Missing key"}, status=400)
        try:
            cli = _cli_module()
            cli["save_env_value"](body["key"], body.get("value", ""))
            return j(handler, {"ok": True, "key": body["key"]})
        except Exception as e:
            logger.exception("PUT /api/mgmt/env failed")
            return j(handler, {"error": str(e)}, status=500)

    if parsed.path == "/api/mgmt/env/delete":
        if not body or "key" not in body:
            return j(handler, {"error": "Missing key"}, status=400)
        try:
            cli = _cli_module()
            removed = cli["remove_env_value"](body["key"])
            if not removed:
                return j(handler, {"error": f"{body['key']} not found in .env"}, status=404)
            return j(handler, {"ok": True, "key": body["key"]})
        except Exception as e:
            logger.exception("DELETE /api/mgmt/env failed")
            return j(handler, {"error": str(e)}, status=500)

    if parsed.path == "/api/mgmt/env/reveal":
        if not body or "key" not in body:
            return j(handler, {"error": "Missing key"}, status=400)
        # Rate limit
        now = time.time()
        cutoff = now - _REVEAL_WINDOW
        _reveal_timestamps[:] = [t for t in _reveal_timestamps if t > cutoff]
        if len(_reveal_timestamps) >= _REVEAL_MAX:
            return j(handler, {"error": "Too many reveal requests. Try again shortly."}, status=429)
        _reveal_timestamps.append(now)
        try:
            cli = _cli_module()
            env_on_disk = cli["load_env"]()
            value = env_on_disk.get(body["key"], "")
            return j(handler, {"key": body["key"], "value": value})
        except Exception as e:
            return j(handler, {"error": str(e)}, status=500)

    # ── MCP Servers ──────────────────────────────────────────────────────
    if parsed.path == "/api/mgmt/mcp-servers/add":
        if not body or "name" not in body or "config" not in body:
            return j(handler, {"error": "Missing name or config"}, status=400)
        try:
            cli = _cli_module()
            config = cli["load_config"]()
            servers = config.get("mcp_servers", {})
            key = body["name"].strip()
            if key in servers:
                return j(handler, {"error": f'Server "{key}" already exists'}, status=409)
            servers[key] = body["config"]
            config["mcp_servers"] = servers
            config_path = cli["get_config_path"]()
            if config_path.exists():
                shutil.copy2(config_path, str(config_path) + ".bak")
            cli["save_config"](config)
            return j(handler, {"ok": True})
        except Exception as e:
            return j(handler, {"error": str(e)}, status=500)

    if parsed.path == "/api/mgmt/mcp-servers/update":
        if not body or "name" not in body or "config" not in body:
            return j(handler, {"error": "Missing name or config"}, status=400)
        try:
            cli = _cli_module()
            config = cli["load_config"]()
            servers = config.get("mcp_servers", {})
            key = body["name"].strip()
            if key not in servers:
                return j(handler, {"error": f'Server "{key}" not found'}, status=404)
            servers[key] = body["config"]
            config["mcp_servers"] = servers
            config_path = cli["get_config_path"]()
            if config_path.exists():
                shutil.copy2(config_path, str(config_path) + ".bak")
            cli["save_config"](config)
            return j(handler, {"ok": True})
        except Exception as e:
            return j(handler, {"error": str(e)}, status=500)

    if parsed.path == "/api/mgmt/mcp-servers/delete":
        if not body or "name" not in body:
            return j(handler, {"error": "Missing name"}, status=400)
        try:
            cli = _cli_module()
            config = cli["load_config"]()
            servers = config.get("mcp_servers", {})
            key = body["name"].strip()
            if key not in servers:
                return j(handler, {"error": f'Server "{key}" not found'}, status=404)
            del servers[key]
            config["mcp_servers"] = servers
            config_path = cli["get_config_path"]()
            if config_path.exists():
                shutil.copy2(config_path, str(config_path) + ".bak")
            cli["save_config"](config)
            return j(handler, {"ok": True})
        except Exception as e:
            return j(handler, {"error": str(e)}, status=500)

    # ── Channels save ────────────────────────────────────────────────────
    if parsed.path == "/api/mgmt/channels":
        if not body or "platform" not in body:
            return j(handler, {"error": "Missing platform"}, status=400)
        try:
            cli = _cli_module()
            config = cli["load_config"]()
            platform = body["platform"]
            valid_platforms = ["telegram", "discord", "slack", "whatsapp", "matrix", "feishu", "dingtalk", "wecom"]
            if platform not in valid_platforms:
                return j(handler, {"error": f"Unknown platform: {platform}"}, status=400)
            # Save platform config section
            if "config" in body:
                config[platform] = body["config"]
                config_path = cli["get_config_path"]()
                if config_path.exists():
                    shutil.copy2(config_path, str(config_path) + ".bak")
                cli["save_config"](config)
            # Save credentials to .env
            if "credentials" in body:
                for k, v in body["credentials"].items():
                    if v:  # Only set non-empty values
                        cli["save_env_value"](k, v)
            return j(handler, {"ok": True})
        except Exception as e:
            return j(handler, {"error": str(e)}, status=500)

    # ── OAuth set key ────────────────────────────────────────────────────
    if parsed.path == "/api/mgmt/oauth/set-key":
        if not body or "provider" not in body or "api_key" not in body:
            return j(handler, {"error": "Missing provider or api_key"}, status=400)
        try:
            provider_key_map = {
                "anthropic": "ANTHROPIC_API_KEY",
                "openai": "OPENAI_API_KEY",
                "google": "GOOGLE_API_KEY",
                "groq": "GROQ_API_KEY",
                "mistral": "MISTRAL_API_KEY",
                "deepseek": "DEEPSEEK_API_KEY",
                "openrouter": "OPENROUTER_API_KEY",
            }
            env_key = provider_key_map.get(body["provider"])
            if not env_key:
                return j(handler, {"error": f"Unknown provider: {body['provider']}"}, status=400)
            cli = _cli_module()
            cli["save_env_value"](env_key, body["api_key"])
            return j(handler, {"ok": True})
        except Exception as e:
            return j(handler, {"error": str(e)}, status=500)

    if parsed.path == "/api/mgmt/oauth/remove-key":
        if not body or "provider" not in body:
            return j(handler, {"error": "Missing provider"}, status=400)
        try:
            provider_key_map = {
                "anthropic": "ANTHROPIC_API_KEY",
                "openai": "OPENAI_API_KEY",
                "google": "GOOGLE_API_KEY",
                "groq": "GROQ_API_KEY",
                "mistral": "MISTRAL_API_KEY",
                "deepseek": "DEEPSEEK_API_KEY",
                "openrouter": "OPENROUTER_API_KEY",
            }
            env_key = provider_key_map.get(body["provider"])
            if not env_key:
                return j(handler, {"error": f"Unknown provider: {body['provider']}"}, status=400)
            cli = _cli_module()
            removed = cli["remove_env_value"](env_key)
            return j(handler, {"ok": True, "removed": removed})
        except Exception as e:
            return j(handler, {"error": str(e)}, status=500)

    # ── Gateway start/stop/restart ────────────────────────────────────────
    if parsed.path == "/api/mgmt/gateway/start":
        return _gateway_command(handler, "start")

    if parsed.path == "/api/mgmt/gateway/stop":
        return _gateway_command(handler, "stop")

    if parsed.path == "/api/mgmt/gateway/restart":
        return _gateway_command(handler, "restart")

    return False


def _gateway_command(handler, action):
    """Execute hermes gateway start/stop/restart."""
    try:
        import subprocess
        result = subprocess.run(
            ["hermes", "gateway", action],
            capture_output=True, text=True, timeout=30,
        )
        output = (result.stdout or "").strip()
        error = (result.stderr or "").strip()
        if result.returncode != 0 and not output:
            return j(handler, {"ok": False, "error": error or f"Exit code {result.returncode}"}, status=500)
        return j(handler, {"ok": True, "output": output, "error": error})
    except FileNotFoundError:
        return j(handler, {"error": "hermes CLI not found on PATH"}, status=500)
    except subprocess.TimeoutExpired:
        return j(handler, {"error": "Command timed out"}, status=500)
    except Exception as e:
        return j(handler, {"error": str(e)}, status=500)
