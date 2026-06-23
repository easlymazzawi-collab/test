"""
SQLite async database layer.

Tables
------
processed_messages
    Tracks source message IDs that have already been crawled and published.

media_map
    Maps a callback-data token → (file_id, file_type) so the bot can re-send
    the original video when a user taps the inline button.

group_map
    Keeps media_group_id → list of media_map row IDs so that when a user
    taps a group button we send the whole album.
"""

import json
import os
import aiosqlite

import config


async def _get_db() -> aiosqlite.Connection:
    os.makedirs(os.path.dirname(config.DB_PATH), exist_ok=True)
    db = await aiosqlite.connect(config.DB_PATH)
    db.row_factory = aiosqlite.Row
    return db


async def init_db() -> None:
    """Create tables if they don't exist."""
    async with await _get_db() as db:
        await db.executescript(
            """
            CREATE TABLE IF NOT EXISTS processed_messages (
                source_msg_id   INTEGER PRIMARY KEY,
                processed_at    TIMESTAMP DEFAULT CURRENT_TIMESTAMP
            );

            CREATE TABLE IF NOT EXISTS media_map (
                token       TEXT PRIMARY KEY,   -- unique callback-data token
                file_id     TEXT NOT NULL,       -- Telegram file_id of the video/gif
                file_type   TEXT NOT NULL,       -- 'video' | 'animation' | 'document'
                caption     TEXT DEFAULT ''
            );

            CREATE TABLE IF NOT EXISTS group_map (
                media_group_id  TEXT NOT NULL,
                token           TEXT NOT NULL,
                position        INTEGER NOT NULL,  -- order within the album
                PRIMARY KEY (media_group_id, position)
            );
            """
        )
        await db.commit()


# ── processed_messages ─────────────────────────────────────────────────────────

async def is_processed(source_msg_id: int) -> bool:
    async with await _get_db() as db:
        cursor = await db.execute(
            "SELECT 1 FROM processed_messages WHERE source_msg_id = ?",
            (source_msg_id,),
        )
        return await cursor.fetchone() is not None


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
            "INSERT OR REPLACE INTO media_map (token, file_id, file_type, caption) VALUES (?, ?, ?, ?)",
            (token, file_id, file_type, caption),
        )
        await db.commit()


async def get_media(token: str) -> dict | None:
    async with await _get_db() as db:
        cursor = await db.execute(
            "SELECT file_id, file_type, caption FROM media_map WHERE token = ?",
            (token,),
        )
        row = await cursor.fetchone()
        if row is None:
            return None
        return {"file_id": row["file_id"], "file_type": row["file_type"], "caption": row["caption"]}


# ── group_map ──────────────────────────────────────────────────────────────────

async def save_group_member(media_group_id: str, token: str, position: int) -> None:
    async with await _get_db() as db:
        await db.execute(
            "INSERT OR REPLACE INTO group_map (media_group_id, token, position) VALUES (?, ?, ?)",
            (media_group_id, token, position),
        )
        await db.commit()


async def get_group_tokens(media_group_id: str) -> list[str]:
    """Return tokens ordered by position."""
    async with await _get_db() as db:
        cursor = await db.execute(
            "SELECT token FROM group_map WHERE media_group_id = ? ORDER BY position",
            (media_group_id,),
        )
        rows = await cursor.fetchall()
        return [r["token"] for r in rows]
