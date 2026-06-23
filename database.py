"""
SQLite async database layer.

Tables
------
processed_messages
    Source message IDs already cloned (global across all topics).

media_map
    token → (file_id, file_type, caption) for inline-button callbacks.

group_map
    media_group_id + position → token (for album buttons).

topic_map
    source_topic_id → dest_topic_id  (used by clone-all mode).
"""

import os
import aiosqlite

import config


async def _get_db() -> aiosqlite.Connection:
    os.makedirs(os.path.dirname(config.DB_PATH) or ".", exist_ok=True)
    db = await aiosqlite.connect(config.DB_PATH)
    db.row_factory = aiosqlite.Row
    return db


async def init_db() -> None:
    async with await _get_db() as db:
        await db.executescript(
            """
            CREATE TABLE IF NOT EXISTS processed_messages (
                source_msg_id   INTEGER PRIMARY KEY,
                processed_at    TIMESTAMP DEFAULT CURRENT_TIMESTAMP
            );

            CREATE TABLE IF NOT EXISTS media_map (
                token       TEXT PRIMARY KEY,
                file_id     TEXT NOT NULL,
                file_type   TEXT NOT NULL,
                caption     TEXT DEFAULT ''
            );

            CREATE TABLE IF NOT EXISTS group_map (
                media_group_id  TEXT NOT NULL,
                token           TEXT NOT NULL,
                position        INTEGER NOT NULL,
                PRIMARY KEY (media_group_id, position)
            );

            CREATE TABLE IF NOT EXISTS topic_map (
                source_topic_id INTEGER PRIMARY KEY,
                dest_topic_id   INTEGER NOT NULL,
                title           TEXT DEFAULT '',
                created_at      TIMESTAMP DEFAULT CURRENT_TIMESTAMP
            );
            """
        )
        await db.commit()


# ── processed_messages ─────────────────────────────────────────────────────────

async def is_processed(source_msg_id: int) -> bool:
    async with await _get_db() as db:
        cur = await db.execute(
            "SELECT 1 FROM processed_messages WHERE source_msg_id = ?",
            (source_msg_id,),
        )
        return await cur.fetchone() is not None


async def mark_processed(source_msg_id: int) -> None:
    async with await _get_db() as db:
        await db.execute(
            "INSERT OR IGNORE INTO processed_messages (source_msg_id) VALUES (?)",
            (source_msg_id,),
        )
        await db.commit()


# ── media_map ──────────────────────────────────────────────────────────────────

async def save_media(token: str, file_id: str, file_type: str, caption: str = "") -> None:
    async with await _get_db() as db:
        await db.execute(
            "INSERT OR REPLACE INTO media_map (token, file_id, file_type, caption) "
            "VALUES (?, ?, ?, ?)",
            (token, file_id, file_type, caption),
        )
        await db.commit()


async def get_media(token: str) -> dict | None:
    async with await _get_db() as db:
        cur = await db.execute(
            "SELECT file_id, file_type, caption FROM media_map WHERE token = ?",
            (token,),
        )
        row = await cur.fetchone()
        if row is None:
            return None
        return {"file_id": row["file_id"], "file_type": row["file_type"], "caption": row["caption"]}


# ── group_map ──────────────────────────────────────────────────────────────────

async def save_group_member(media_group_id: str, token: str, position: int) -> None:
    async with await _get_db() as db:
        await db.execute(
            "INSERT OR REPLACE INTO group_map (media_group_id, token, position) "
            "VALUES (?, ?, ?)",
            (media_group_id, token, position),
        )
        await db.commit()


async def get_group_tokens(media_group_id: str) -> list[str]:
    async with await _get_db() as db:
        cur = await db.execute(
            "SELECT token FROM group_map WHERE media_group_id = ? ORDER BY position",
            (media_group_id,),
        )
        rows = await cur.fetchall()
        return [r["token"] for r in rows]


# ── topic_map ──────────────────────────────────────────────────────────────────

async def save_topic_mapping(source_topic_id: int, dest_topic_id: int, title: str = "") -> None:
    async with await _get_db() as db:
        await db.execute(
            "INSERT OR REPLACE INTO topic_map (source_topic_id, dest_topic_id, title) "
            "VALUES (?, ?, ?)",
            (source_topic_id, dest_topic_id, title),
        )
        await db.commit()


async def get_dest_topic_id(source_topic_id: int) -> int | None:
    async with await _get_db() as db:
        cur = await db.execute(
            "SELECT dest_topic_id FROM topic_map WHERE source_topic_id = ?",
            (source_topic_id,),
        )
        row = await cur.fetchone()
        return row["dest_topic_id"] if row else None


async def list_topic_mappings() -> list[dict]:
    async with await _get_db() as db:
        cur = await db.execute(
            "SELECT source_topic_id, dest_topic_id, title FROM topic_map ORDER BY source_topic_id"
        )
        rows = await cur.fetchall()
        return [dict(r) for r in rows]
