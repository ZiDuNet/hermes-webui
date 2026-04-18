"""
Hermes Web UI -- Management routes (Config, Keys/Env, MCP Servers).
Directly imports from hermes_cli.config — no Gateway HTTP API needed.
"""

import json
import logging
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

    return False


def handle_mgmt_post(handler, parsed) -> bool:
    """Handle management POST/PUT/DELETE routes. Returns True if matched."""
    body = read_body(handler)

    # ── Config save ──────────────────────────────────────────────────────
    if parsed.path == "/api/mgmt/config":
        if not body or "config" not in body:
            return j(handler, {"error": "Missing config"}, status=400)
        try:
            cli = _cli_module()
            disk_config = cli["load_config"]()
            denorm = _denormalize_config_from_web(body["config"], disk_config)
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

    return False
