"""Local model settings and durable analysis history."""
from __future__ import annotations

import ctypes
import hashlib
import json
import os
import sqlite3
from contextlib import contextmanager
from ctypes import wintypes
from dataclasses import dataclass

from backend.config import settings


@contextmanager
def workspace_db():
    data_dir = settings.BASE_DIR / "data"
    data_dir.mkdir(exist_ok=True)
    db = sqlite3.connect(data_dir / "workspace.sqlite3")
    try:
        with db:
            db.execute("CREATE TABLE IF NOT EXISTS model_config (id INTEGER PRIMARY KEY, data TEXT, secret BLOB)")
            db.execute("""CREATE TABLE IF NOT EXISTS analysis_history (
                task_id TEXT PRIMARY KEY, created_at TEXT, summary TEXT, result TEXT
            )""")
            db.execute("""CREATE TABLE IF NOT EXISTS model_compatibility (
                config_id TEXT PRIMARY KEY, result TEXT NOT NULL
            )""")
            yield db
    finally:
        db.close()


class DataBlob(ctypes.Structure):
    _fields_ = [("size", wintypes.DWORD), ("data", ctypes.POINTER(ctypes.c_byte))]


def protect_secret(value: bytes, *, decrypt: bool = False) -> bytes:
    """Use Windows DPAPI bound to the current OS account."""
    if os.name != "nt":
        raise RuntimeError("加密保存 API Key 需要 Windows。")
    buffer = ctypes.create_string_buffer(value)
    source = DataBlob(len(value), ctypes.cast(buffer, ctypes.POINTER(ctypes.c_byte)))
    result = DataBlob()
    crypt = ctypes.WinDLL("crypt32", use_last_error=True)
    kernel = ctypes.WinDLL("kernel32", use_last_error=True)
    kernel.LocalFree.argtypes = [ctypes.c_void_p]
    kernel.LocalFree.restype = ctypes.c_void_p
    operation = crypt.CryptUnprotectData if decrypt else crypt.CryptProtectData
    operation.argtypes = [
        ctypes.POINTER(DataBlob), ctypes.c_void_p, ctypes.c_void_p, ctypes.c_void_p,
        ctypes.c_void_p, wintypes.DWORD, ctypes.POINTER(DataBlob),
    ]
    operation.restype = wintypes.BOOL
    if not operation(ctypes.byref(source), None, None, None, None, 1, ctypes.byref(result)):
        raise ctypes.WinError(ctypes.get_last_error())
    try:
        return ctypes.string_at(result.data, result.size)
    finally:
        kernel.LocalFree(result.data)


@dataclass(repr=False)
class ModelConfig:
    base_url: str
    model: str
    api_key: str
    input_price: float | None = None
    output_price: float | None = None
    currency: str = "CNY"

    def public(self) -> dict:
        return {
            "base_url": self.base_url, "model": self.model, "configured": bool(self.api_key),
            "input_price": self.input_price, "output_price": self.output_price,
            "currency": self.currency,
        }


def load_model() -> ModelConfig:
    with workspace_db() as db:
        row = db.execute("SELECT data, secret FROM model_config WHERE id = 1").fetchone()
    if row is None:
        return ModelConfig(settings.DEEPSEEK_BASE_URL.rstrip("/"), settings.DEEPSEEK_MODEL, settings.DEEPSEEK_API_KEY)
    values = json.loads(row[0])
    key = protect_secret(row[1], decrypt=True).decode() if row[1] is not None else ""
    if row[1] is None and values["base_url"] == settings.DEEPSEEK_BASE_URL.rstrip("/"):
        key = settings.DEEPSEEK_API_KEY
    return ModelConfig(api_key=key, **values)


def save_model(config: ModelConfig, *, use_environment_key: bool) -> None:
    values = config.public()
    del values["configured"]
    secret = None if use_environment_key else protect_secret(config.api_key.encode())
    with workspace_db() as db:
        db.execute("INSERT OR REPLACE INTO model_config VALUES (1, ?, ?)", (json.dumps(values), secret))


def compatibility_id(config: ModelConfig) -> str:
    encoded = json.dumps(["extraction-v1", config.base_url, config.model, config.api_key]).encode()
    return hashlib.sha256(encoded).hexdigest()


def load_compatibility(config: ModelConfig) -> dict | None:
    if not config.api_key:
        return None
    with workspace_db() as db:
        row = db.execute(
            "SELECT result FROM model_compatibility WHERE config_id = ?", (compatibility_id(config),)
        ).fetchone()
    return json.loads(row[0]) if row else None


def save_compatibility(config: ModelConfig, result: dict) -> None:
    with workspace_db() as db:
        db.execute(
            "INSERT OR REPLACE INTO model_compatibility VALUES (?, ?)",
            (compatibility_id(config), json.dumps(result, ensure_ascii=False)),
        )


def persist_task(task: dict) -> None:
    summary = {key: value for key, value in task.items() if key not in {"events", "result"}}
    result = json.dumps(task["result"], ensure_ascii=False, default=str) if task["result"] is not None else None
    with workspace_db() as db:
        db.execute(
            "INSERT OR REPLACE INTO analysis_history VALUES (?, ?, ?, ?)",
            (task["task_id"], task["created_at"], json.dumps(summary, ensure_ascii=False), result),
        )


def load_task(task_id: str) -> dict | None:
    with workspace_db() as db:
        row = db.execute("SELECT summary, result FROM analysis_history WHERE task_id = ?", (task_id,)).fetchone()
    if row is None:
        return None
    return {**json.loads(row[0]), "result": json.loads(row[1]) if row[1] else None}


def delete_saved_task(task_id: str) -> bool:
    with workspace_db() as db:
        return db.execute("DELETE FROM analysis_history WHERE task_id = ?", (task_id,)).rowcount > 0


def list_history() -> list[dict]:
    with workspace_db() as db:
        rows = db.execute("SELECT summary FROM analysis_history ORDER BY created_at DESC, task_id DESC").fetchall()
    return [json.loads(row[0]) for row in rows]
