"""
Pyrogram-based topic crawler — full clone mode.

Reads ALL messages in a given topic and yields them chronologically as
AnyMessage (standalone) or MessageGroup (media album) objects.
Only video/animation/video_note items are flagged is_video=True.
"""

from __future__ import annotations

import logging
from dataclasses import dataclass, field
from typing import AsyncGenerator, Literal

from pyrogram import Client
from pyrogram.types import Message

import config

logger = logging.getLogger(__name__)

MessageType = Literal[
    "text", "photo", "video", "animation", "sticker",
    "document", "audio", "voice", "video_note", "other"
]


# ── Data models ────────────────────────────────────────────────────────────────

@dataclass
class AnyMessage:
    """Represents any single message from the source topic."""

    msg_id: int
    msg_type: MessageType

    file_id: str | None = None
    file_unique_id: str | None = None
    thumbnail_file_id: str | None = None

    text: str = ""
    caption: str = ""

    media_group_id: str | None = None
    is_video: bool = False


@dataclass
class MessageGroup:
    """A Telegram media album (messages sharing the same media_group_id)."""

    media_group_id: str
    items: list[AnyMessage] = field(default_factory=list)

    @property
    def min_msg_id(self) -> int:
        return min(i.msg_id for i in self.items)

    @property
    def has_video(self) -> bool:
        return any(i.is_video for i in self.items)


# Aliases kept for backward compatibility
MediaItem = AnyMessage
MediaGroup = MessageGroup


# ── Message parser ─────────────────────────────────────────────────────────────

def _parse_message(msg: Message) -> AnyMessage | None:
    base = dict(msg_id=msg.id, media_group_id=msg.media_group_id)

    if msg.text and not msg.media:
        return AnyMessage(msg_type="text", text=msg.text.html or str(msg.text), **base)

    caption = msg.caption.html if msg.caption else ""

    if msg.photo:
        p = msg.photo
        return AnyMessage(msg_type="photo", file_id=p.file_id,
                          file_unique_id=p.file_unique_id, caption=caption, **base)

    if msg.video:
        v = msg.video
        thumb = v.thumbs[0].file_id if v.thumbs else None
        return AnyMessage(msg_type="video", file_id=v.file_id,
                          file_unique_id=v.file_unique_id, thumbnail_file_id=thumb,
                          caption=caption, is_video=True, **base)

    if msg.animation:
        a = msg.animation
        thumb = a.thumbs[0].file_id if a.thumbs else None
        return AnyMessage(msg_type="animation", file_id=a.file_id,
                          file_unique_id=a.file_unique_id, thumbnail_file_id=thumb,
                          caption=caption, is_video=True, **base)

    if msg.sticker:
        s = msg.sticker
        return AnyMessage(msg_type="sticker", file_id=s.file_id,
                          file_unique_id=s.file_unique_id, **base)

    if msg.document:
        d = msg.document
        is_vid = bool(d.mime_type and d.mime_type.startswith("video/"))
        thumb = d.thumbs[0].file_id if d.thumbs else None
        return AnyMessage(msg_type="document", file_id=d.file_id,
                          file_unique_id=d.file_unique_id,
                          thumbnail_file_id=thumb if is_vid else None,
                          caption=caption, is_video=is_vid, **base)

    if msg.audio:
        a = msg.audio
        return AnyMessage(msg_type="audio", file_id=a.file_id,
                          file_unique_id=a.file_unique_id, caption=caption, **base)

    if msg.voice:
        v = msg.voice
        return AnyMessage(msg_type="voice", file_id=v.file_id,
                          file_unique_id=v.file_unique_id, caption=caption, **base)

    if msg.video_note:
        vn = msg.video_note
        thumb = vn.thumbs[0].file_id if vn.thumbs else None
        return AnyMessage(msg_type="video_note", file_id=vn.file_id,
                          file_unique_id=vn.file_unique_id, thumbnail_file_id=thumb,
                          is_video=True, **base)

    return None


# ── Topic lister ───────────────────────────────────────────────────────────────

@dataclass
class TopicInfo:
    topic_id: int
    title: str
    icon_color: int = 0
    icon_custom_emoji_id: str | None = None


async def list_topics(client: Client) -> list[TopicInfo]:
    """
    Return all forum topics in SOURCE_CHAT_ID.
    Falls back gracefully if the supergroup has no forum enabled.
    """
    topics: list[TopicInfo] = []
    try:
        raw_topics = await client.get_forum_topics(config.SOURCE_CHAT_ID)
        for t in raw_topics:
            topics.append(TopicInfo(
                topic_id=t.id,
                title=t.title,
                icon_color=getattr(t, "icon_color", 0),
                icon_custom_emoji_id=getattr(t, "icon_custom_emoji_id", None),
            ))
    except Exception as e:
        logger.error("Failed to list forum topics: %s", e)
    return topics


# ── Main crawler ───────────────────────────────────────────────────────────────

async def crawl_topic(
    client: Client,
    already_processed: set[int],
    topic_id: int | None = None,
) -> AsyncGenerator[AnyMessage | MessageGroup, None]:
    """
    Async generator — yields AnyMessage / MessageGroup in chronological order.

    Parameters
    ----------
    topic_id : int | None
        Which topic to crawl. Falls back to config.SOURCE_TOPIC_ID if None.
    """
    tid = topic_id if topic_id is not None else config.SOURCE_TOPIC_ID
    if tid is None:
        raise ValueError("topic_id must be provided when SOURCE_TOPIC_ID is not set in .env")

    logger.info("Crawling chat %s topic %s…", config.SOURCE_CHAT_ID, tid)

    standalone: list[AnyMessage] = []
    group_buffer: dict[str, MessageGroup] = {}
    skipped = 0

    async for msg in client.get_chat_history(config.SOURCE_CHAT_ID):
        if getattr(msg, "message_thread_id", None) != tid:
            continue
        if msg.id in already_processed:
            skipped += 1
            continue
        item = _parse_message(msg)
        if item is None:
            continue
        if item.media_group_id:
            gid = item.media_group_id
            if gid not in group_buffer:
                group_buffer[gid] = MessageGroup(media_group_id=gid)
            group_buffer[gid].items.append(item)
        else:
            standalone.append(item)

    for grp in group_buffer.values():
        grp.items.sort(key=lambda x: x.msg_id)

    combined: list[tuple[int, AnyMessage | MessageGroup]] = []
    for item in standalone:
        combined.append((item.msg_id, item))
    for grp in group_buffer.values():
        combined.append((grp.min_msg_id, grp))
    combined.sort(key=lambda t: t[0])

    logger.info(
        "Topic %s: %d item(s) (%d standalone, %d groups, %d skipped).",
        tid, len(combined), len(standalone), len(group_buffer), skipped,
    )
    for _, obj in combined:
        yield obj


async def build_client() -> Client:
    return Client(
        config.SESSION_NAME,
        api_id=config.API_ID,
        api_hash=config.API_HASH,
        phone_number=config.PHONE_NUMBER,
    )
