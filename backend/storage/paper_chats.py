"""本地问答会话与原文依据的持久化。"""
from __future__ import annotations

import json
import sqlite3
from contextlib import contextmanager
from datetime import datetime, timezone

from backend.config import settings


class ConversationChanged(Exception):
    """同一对话已被另一个请求更新。"""


@contextmanager
def _connect():
    path = settings.BASE_DIR / "data" / "paper_chats.sqlite3"
    path.parent.mkdir(parents=True, exist_ok=True)
    connection = sqlite3.connect(path)
    connection.row_factory = sqlite3.Row
    try:
        with connection:
            connection.execute("""
                CREATE TABLE IF NOT EXISTS paper_chats (
                    id TEXT PRIMARY KEY,
                    title TEXT NOT NULL,
                    papers TEXT NOT NULL,
                    turns TEXT NOT NULL,
                    updated_at TEXT NOT NULL
                )
            """)
            yield connection
    finally:
        connection.close()


def _decode(row: sqlite3.Row) -> dict:
    conversation = dict(row)
    conversation["papers"] = json.loads(conversation["papers"])
    if "turns" in conversation:
        conversation["turns"] = json.loads(conversation["turns"])
    return conversation


def list_conversations() -> list[dict]:
    with _connect() as connection:
        rows = connection.execute("""
            SELECT id, title, papers, updated_at
            FROM paper_chats ORDER BY updated_at DESC, id
        """).fetchall()
    return [_decode(row) for row in rows]


def get_conversation(conversation_id: str) -> dict | None:
    with _connect() as connection:
        row = connection.execute(
            "SELECT * FROM paper_chats WHERE id = ?", (conversation_id,)
        ).fetchone()
    return _decode(row) if row else None


def append_turn(conversation_id: str, papers: list[dict], turn: dict, expected_turns: int) -> dict:
    """保存完整的一轮问答，重试同一请求时返回已保存结果。"""
    with _connect() as connection:
        connection.execute("BEGIN IMMEDIATE")
        row = connection.execute(
            "SELECT * FROM paper_chats WHERE id = ?", (conversation_id,)
        ).fetchone()
        conversation = _decode(row) if row else {
            "id": conversation_id,
            "title": turn["question"][:100],
            "papers": papers,
            "turns": [],
        }
        turns = conversation["turns"]
        if any(previous["id"] == turn["id"] for previous in turns):
            return conversation
        if len(turns) != expected_turns or conversation["papers"] != papers:
            raise ConversationChanged
        turns.append(turn)
        conversation["updated_at"] = datetime.now(timezone.utc).isoformat()
        connection.execute("""
            INSERT INTO paper_chats (id, title, papers, turns, updated_at)
            VALUES (?, ?, ?, ?, ?)
            ON CONFLICT(id) DO UPDATE SET turns = excluded.turns, updated_at = excluded.updated_at
        """, (
            conversation_id, conversation["title"], json.dumps(papers, ensure_ascii=False),
            json.dumps(turns, ensure_ascii=False), conversation["updated_at"],
        ))
        return conversation
