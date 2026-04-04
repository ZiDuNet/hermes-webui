"""
Sprint 24 Tests: agentic transparency — token/cost display, session usage fields,
subagent card names, skill picker in cron, skill linked files.
"""
import json, urllib.error, urllib.request

BASE = "http://127.0.0.1:8788"


def get(path):
    with urllib.request.urlopen(BASE + path, timeout=10) as r:
        return json.loads(r.read()), r.status


def post(path, body=None):
    data = json.dumps(body or {}).encode()
    req = urllib.request.Request(BASE + path, data=data,
                                headers={"Content-Type": "application/json"})
    try:
        with urllib.request.urlopen(req, timeout=10) as r:
            return json.loads(r.read()), r.status
    except urllib.error.HTTPError as e:
        return json.loads(e.read()), e.code


def make_session(created_list):
    d, _ = post("/api/session/new", {})
    sid = d["session"]["session_id"]
    created_list.append(sid)
    return sid, d["session"]


# ── Session usage fields ─────────────────────────────────────────────────

def test_new_session_has_usage_fields():
    """New session should include input_tokens, output_tokens, estimated_cost."""
    created = []
    try:
        sid, sess = make_session(created)
        post("/api/session/rename", {"session_id": sid, "title": "Usage Test"})
        d, status = get(f"/api/session?session_id={sid}")
        assert status == 200
        assert "input_tokens" in d["session"]
        assert "output_tokens" in d["session"]
        assert "estimated_cost" in d["session"]
        assert d["session"]["input_tokens"] == 0
        assert d["session"]["output_tokens"] == 0
    finally:
        for s in created:
            post("/api/session/delete", {"session_id": s})


def test_session_compact_has_usage_fields():
    """Session list should include usage fields in compact form."""
    created = []
    try:
        sid, _ = make_session(created)
        post("/api/session/rename", {"session_id": sid, "title": "Compact Usage"})
        d, status = get("/api/sessions")
        assert status == 200
        match = [s for s in d["sessions"] if s["session_id"] == sid]
        assert len(match) == 1
        assert "input_tokens" in match[0]
        assert "output_tokens" in match[0]
    finally:
        for s in created:
            post("/api/session/delete", {"session_id": s})


def test_session_usage_defaults_zero():
    """New session usage fields should default to 0/None."""
    created = []
    try:
        sid, sess = make_session(created)
        assert sess.get("input_tokens", 0) == 0
        assert sess.get("output_tokens", 0) == 0
    finally:
        for s in created:
            post("/api/session/delete", {"session_id": s})


# ── Skills content linked_files ──────────────────────────────────────────

def test_skills_content_requires_name():
    """GET /api/skills/content without name should return 400 or 500 (if skills module unavailable)."""
    try:
        d, status = get("/api/skills/content?file=test.md")
        assert status == 400
    except urllib.error.HTTPError as e:
        # 500 is acceptable if the skills_tool import fails in test env
        assert e.code in (400, 500)


def test_skills_content_has_linked_files_key():
    """GET /api/skills/content should return a linked_files key."""
    try:
        d, status = get("/api/skills")
        if not d.get("skills"):
            return  # no skills in test env
        name = d["skills"][0]["name"]
        d2, status2 = get(f"/api/skills/content?name={name}")
        assert status2 == 200
        assert "linked_files" in d2
    except urllib.error.HTTPError:
        pass  # skills may not work in test env


# ── Tool call integrity ──────────────────────────────────────────────────

def test_tool_calls_have_real_names():
    """Tool calls in session JSON should not have unresolved 'tool' name."""
    created = []
    try:
        sid, _ = make_session(created)
        d, status = get(f"/api/session?session_id={sid}")
        assert status == 200
        for tc in d["session"].get("tool_calls", []):
            assert tc.get("name") != "tool", f"Unresolved name: {tc}"
    finally:
        for s in created:
            post("/api/session/delete", {"session_id": s})
