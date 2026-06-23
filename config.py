"""
Central configuration — reads from .env (or environment variables).
"""

import os
from dotenv import load_dotenv

load_dotenv()


def _require(key: str) -> str:
    value = os.getenv(key)
    if not value:
        raise RuntimeError(f"Required environment variable '{key}' is not set. Check your .env file.")
    return value


def _optional(key: str, default: str = "") -> str:
    return os.getenv(key, default)


# ── Bot credentials ────────────────────────────────────────────────────────────
BOT_TOKEN: str = _require("BOT_TOKEN")

# ── Pyrogram (user-account) credentials ───────────────────────────────────────
API_ID: int = int(_require("API_ID"))
API_HASH: str = _require("API_HASH")
PHONE_NUMBER: str = _require("PHONE_NUMBER")
SESSION_NAME: str = _optional("SESSION_NAME", "media_crawler")

# ── Chat / topic IDs ───────────────────────────────────────────────────────────
SOURCE_CHAT_ID: int = int(_require("SOURCE_CHAT_ID"))
SOURCE_TOPIC_ID: int = int(_require("SOURCE_TOPIC_ID"))

DEST_CHAT_ID: int = int(_require("DEST_CHAT_ID"))
_dest_topic_raw = _optional("DEST_TOPIC_ID", "")
DEST_TOPIC_ID: int | None = int(_dest_topic_raw) if _dest_topic_raw.strip() else None

# ── Runtime settings ───────────────────────────────────────────────────────────
DB_PATH: str = _optional("DB_PATH", "data/bot.db")
PUBLISH_DELAY: float = float(_optional("PUBLISH_DELAY", "1.5"))
