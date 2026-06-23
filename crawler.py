"""
Pyrogram-based crawler.

Reads ALL messages in the source topic, groups them by media_group_id,
and yields MediaItem / MediaGroup objects for the publisher to process.
"""

from __future__ import annotations

import logging
from dataclasses import dataclass, field
from typing import AsyncGenerator

from pyrogram import Client
from pyrogram.types import Message

import config

logger = logging.getLogger(__name__)


# ── Data models ────────────────────────────────────────────────────────────────

@dataclass
class MediaItem:
    """A single video / animation / document message."""

    source_msg_id: int
    file_id: str
    file_unique_id: str
    file_type: str              # 'video' | 'animation' | 'document'
    thumbnail_file_id: str | None
    caption: str
    media_group_id: str | None  # None for standalone messages


@dataclass
class MediaGroup:
    """A Telegram media group (album of videos)."""

    media_group_id: str
    items: list[MediaItem] = field(default_factory=list)

    @property
    def min_msg_id(self) -> int:
        return min(i.source_msg_id for i in self.items)


# ── Helpers ────────────────────────────────────────────────────────────────────

def _extract_media(msg: Message) -> MediaItem | None:
    """Return a MediaItem if the message contains a supported media type."""
    caption = msg.caption or ""

    if msg.video:
        v = msg.video
        thumb_id = v.thumbs[0].file_id if v.thumbs else None
        return MediaItem(
            source_msg_id=msg.id,
            file_id=v.file_id,
            file_unique_id=v.file_unique_id,
            file_type="video",
            thumbnail_file_id=thumb_id,
            caption=caption,
            media_group_id=msg.media_group_id,
        )

    if msg.animation:
        a = msg.animation
        thumb_id = a.thumbs[0].file_id if a.thumbs else None
        return MediaItem(
            source_msg_id=msg.id,
            file_id=a.file_id,
            file_unique_id=a.file_unique_id,
            file_type="animation",
            thumbnail_file_id=thumb_id,
            caption=caption,
            media_group_id=msg.media_group_id,
        )

    if msg.document and msg.document.mime_type and msg.document.mime_type.startswith("video/"):
        d = msg.document
        thumb_id = d.thumbs[0].file_id if d.thumbs else None
        return MediaItem(
            source_msg_id=msg.id,
            file_id=d.file_id,
            file_unique_id=d.file_unique_id,
            file_type="document",
            thumbnail_file_id=thumb_id,
            caption=caption,
            media_group_id=msg.media_group_id,
        )

    return None


# ── Main crawler ───────────────────────────────────────────────────────────────

async def crawl_topic(
    client: Client,
    already_processed: set[int],
) -> AsyncGenerator[MediaItem | MediaGroup, None]:
    """
    Async generator — yields MediaItem (standalone) or MediaGroup (album)
    objects in chronological order (oldest first).

    Pyrogram's get_chat_history returns messages newest-first, so we collect
    everything first, then reverse and process.
    """
    logger.info(
        "Collecting messages from chat %s topic %s…",
        config.SOURCE_CHAT_ID,
        config.SOURCE_TOPIC_ID,
    )

    # Collect all relevant raw messages (newest→oldest from API)
    all_items: list[MediaItem] = []
    group_buffer: dict[str, MediaGroup] = {}

    async for msg in client.get_chat_history(config.SOURCE_CHAT_ID):
        # Filter to our topic thread
        if getattr(msg, "message_thread_id", None) != config.SOURCE_TOPIC_ID:
            continue

        if msg.id in already_processed:
            logger.debug("Skip already-processed %s", msg.id)
            continue

        item = _extract_media(msg)
        if item is None:
            continue

        if item.media_group_id:
            gid = item.media_group_id
            if gid not in group_buffer:
                group_buffer[gid] = MediaGroup(media_group_id=gid)
            group_buffer[gid].items.append(item)
        else:
            all_items.append(item)

    # Sort group members by message id (ascending)
    for grp in group_buffer.values():
        grp.items.sort(key=lambda x: x.source_msg_id)

    # Build a single list of (min_msg_id, object) and sort chronologically
    combined: list[tuple[int, MediaItem | MediaGroup]] = []
    for item in all_items:
        combined.append((item.source_msg_id, item))
    for grp in group_buffer.values():
        combined.append((grp.min_msg_id, grp))

    combined.sort(key=lambda t: t[0])

    logger.info(
        "Found %d item(s) to publish (%d standalone, %d groups).",
        len(combined),
        len(all_items),
        len(group_buffer),
    )

    for _, obj in combined:
        yield obj


async def build_client() -> Client:
    """Create and return an authenticated Pyrogram client."""
    return Client(
        config.SESSION_NAME,
        api_id=config.API_ID,
        api_hash=config.API_HASH,
        phone_number=config.PHONE_NUMBER,
    )
