from msapi.turns import Translator


def _assistant_text(text):
    return {"type": "assistant", "message": {"content": [{"type": "text", "text": text}]}}


def test_agent_narration_is_not_shown_as_status():
    # The agent's in-between text is for itself ("save was blocked, I'll use Write"); owners see tool labels only.
    out = Translator()(_assistant_text("The profile save was blocked, so I'll use the Write tool instead."))
    assert out == []


def test_tool_labels_still_become_status():
    ev = {"type": "assistant", "message": {"content": [
        {"type": "tool_use", "id": "t1", "name": "Bash", "input": {"command": "tf fetch https://x.example"}}]}}
    assert Translator()(ev) == [{"type": "status", "text": "Reading pages"}]


def test_done_reply_has_no_markdown():
    ev = {"type": "result", "subtype": "success", "is_error": False,
          "result": "## Try this first\nI'd try a **website chat helper**. My pick is __Chat-A__.\n- free plan"}
    assert Translator()(ev) == [{"type": "done",
                                 "reply": "Try this first\nI'd try a website chat helper. My pick is Chat-A.\n- free plan"}]


def test_done_reply_is_only_the_final_result_not_narration_between_tools():
    """Narration written between tool calls is never part of the reply: only the result event is."""
    tr = Translator()
    out = []
    for ev in (_assistant_text("The site failed, so I'll ask two short questions per the intake rules."),
               {"type": "assistant", "message": {"content": [
                   {"type": "tool_use", "id": "t1", "name": "Bash", "input": {"command": "tf fetch https://x.example"}}]}},
               _assistant_text("Which town are you in?"),
               {"type": "result", "subtype": "success", "is_error": False, "result": "Which town are you in?"}):
        out += tr(ev)
    done = [e for e in out if e["type"] == "done"]
    assert done == [{"type": "done", "reply": "Which town are you in?"}]


def test_a_leading_tapback_line_becomes_a_reaction_not_text():
    ev = {"type": "result", "subtype": "success", "is_error": False,
          "result": "tapback: love\n\nOh nice, four cafes!\n\nIs the phone ringing a lot?"}
    assert Translator()(ev) == [{"type": "done", "reply": "Oh nice, four cafes!\n\nIs the phone ringing a lot?",
                                 "tapback": "love"}]


def test_split_tapback_edges():
    from msapi.turns import split_tapback
    assert split_tapback("Tapback: LIKE\nGot it.") == ("Got it.", "like")
    assert split_tapback("tapback: wow\nhi") == ("hi", None)  # unknown kinds are dropped, never shown
    assert split_tapback("hi\ntapback: love") == ("hi\ntapback: love", None)  # only a first line counts
    assert split_tapback("no tapback here") == ("no tapback here", None)


def test_a_recorded_preview_shows_a_status_and_refreshes_the_preview_card():
    tr = Translator()
    out = tr({"type": "assistant", "message": {"content": [
        {"type": "tool_use", "id": "r1", "name": "Bash", "input": {"command": "preview record --tool chatling"}}]}})
    assert out == [{"type": "status", "text": "Recording the preview on a copy of your website"}]
    out = tr({"type": "user", "message": {"content": [
        {"type": "tool_result", "tool_use_id": "r1", "content": '{"ok": true, "preview": {"kind": "site"}}'}]}})
    assert out == [{"type": "files", "kinds": ["preview"]}]
