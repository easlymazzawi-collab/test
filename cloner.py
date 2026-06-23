"""
cloner.py — Orchestrates cloning ALL topics from source to destination.

Flow
----
1. List every forum topic in SOURCE_CHAT_ID via Pyrogram.
2. For each topic:
   a. Look up (or create) a matching topic in DEST_CHAT_ID via Bot API.
   b. Crawl the source topic (skip already-processed messages).
   c. Publish each item to the destination topic.
3. Report a summary per topic.

The topic mapping (source_topic_id → dest_topic_id) is persisted in SQLite
so that re-running the cloner is safe: already-processed messages are skipped
and existing destination topics are reused.
"""

from __future__ import annotations

import asyncio
import logging
from dataclasses import dataclass

from pyrogram import Client as PyroClient
from telegram import Bot
from telegram.error import TelegramError

import config
import database
from crawler import TopicInfo, list_topics, crawl_topic
from publisher import publish

logger = logging.getLogger(__name__)


@dataclass
class CloneResult:
    topic_id: int
    title: str
    dest_topic_id: int
    items_published: int
    error: str | None = None


# ── Destination topic management ───────────────────────────────────────────────

async def _get_or_create_dest_topic(topic: TopicInfo, bot: Bot) -> int:
    """
    Return the destination topic ID for a given source topic,
    creating it in DEST_CHAT_ID if it doesn't exist yet.
    """
    cached = await database.get_dest_topic_id(topic.topic_id)
    if cached is not None:
        logger.info("Topic '%s' already mapped → dest topic %s", topic.title, cached)
        return cached

    logger.info("Creating destination topic '%s'…", topic.title)
    try:
        kwargs: dict = dict(
            chat_id=config.DEST_CHAT_ID,
            name=topic.title,
        )
        # Pass icon_color only when it's a valid Telegram colour value
        if topic.icon_color:
            kwargs["icon_color"] = topic.icon_color
        # Pass custom emoji id if present
        if topic.icon_custom_emoji_id:
            kwargs["icon_custom_emoji_id"] = topic.icon_custom_emoji_id

        new_topic = await bot.create_forum_topic(**kwargs)
        dest_id: int = new_topic.message_thread_id
    except TelegramError as e:
        raise RuntimeError(f"Cannot create topic '{topic.title}' in dest chat: {e}") from e

    await database.save_topic_mapping(topic.topic_id, dest_id, topic.title)
    logger.info("Created dest topic '%s' (id=%s)", topic.title, dest_id)
    return dest_id


# ── Single-topic clone ─────────────────────────────────────────────────────────

async def clone_one_topic(
    topic: TopicInfo,
    pyro: PyroClient,
    bot: Bot,
) -> CloneResult:
    """Clone a single topic; return a CloneResult summary."""
    try:
        dest_tid = await _get_or_create_dest_topic(topic, bot)
    except RuntimeError as e:
        return CloneResult(topic.topic_id, topic.title, 0, 0, str(e))

    count = 0
    try:
        async for obj in crawl_topic(pyro, already_processed=set(), topic_id=topic.topic_id):
            await publish(obj, bot, pyro, dest_topic_id=dest_tid)
            count += 1
    except Exception as e:
        logger.error("Error cloning topic '%s': %s", topic.title, e)
        return CloneResult(topic.topic_id, topic.title, dest_tid, count, str(e))

    return CloneResult(topic.topic_id, topic.title, dest_tid, count)


# ── All-topics clone ───────────────────────────────────────────────────────────

async def clone_all_topics(
    pyro: PyroClient,
    bot: Bot,
    progress_cb=None,
) -> list[CloneResult]:
    """
    Clone every topic in SOURCE_CHAT_ID to DEST_CHAT_ID.

    Parameters
    ----------
    progress_cb : async callable(topic_title, current, total) | None
        Optional callback called after each topic finishes.
    """
    topics = await list_topics(pyro)
    if not topics:
        logger.warning("No topics found in chat %s", config.SOURCE_CHAT_ID)
        return []

    logger.info("Found %d topic(s) to clone.", len(topics))
    results: list[CloneResult] = []

    for idx, topic in enumerate(topics, 1):
        logger.info("[%d/%d] Cloning topic '%s' (id=%s)…",
                    idx, len(topics), topic.title, topic.topic_id)
        result = await clone_one_topic(topic, pyro, bot)
        results.append(result)

        if progress_cb:
            await progress_cb(topic.title, idx, len(topics))

    return results


def format_results(results: list[CloneResult]) -> str:
    """Return a human-readable summary string."""
    lines = ["<b>📋 Kết quả clone:</b>\n"]
    total_items = 0
    for r in results:
        status = "✅" if r.error is None else "❌"
        lines.append(
            f"{status} <b>{r.title}</b> — {r.items_published} mục"
            + (f"\n   <i>{r.error}</i>" if r.error else "")
        )
        total_items += r.items_published

    lines.append(f"\n<b>Tổng cộng:</b> {total_items} mục trong {len(results)} topic")
    return "\n".join(lines)
