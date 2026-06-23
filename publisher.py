"""
Publisher — takes MediaItem / MediaGroup objects and posts them to the
destination chat as thumbnail images with inline "▶️ Xem video" buttons.

Layout
------
Single video  →  one photo message with one inline button.

Media group   →  photo album (InputMediaPhoto) followed by a text message
                 with numbered inline buttons, one per video in the group.
                 (Telegram does not allow inline keyboards on media group messages.)
"""

from __future__ import annotations

import asyncio
import hashlib
import logging
import os
import tempfile
from io import BytesIO
from typing import TYPE_CHECKING

from telegram import Bot, InputFile, InputMediaPhoto, InlineKeyboardButton, InlineKeyboardMarkup
from telegram.constants import ParseMode
from telegram.error import TelegramError

import config
import database
from crawler import MediaItem, MediaGroup

if TYPE_CHECKING:
    from pyrogram import Client as PyroClient

logger = logging.getLogger(__name__)

# ── Token generation ───────────────────────────────────────────────────────────


def _make_token(file_unique_id: str) -> str:
    """Short, collision-resistant token for callback_data (≤ 64 bytes)."""
    return hashlib.sha256(file_unique_id.encode()).hexdigest()[:24]


# ── Thumbnail helpers ──────────────────────────────────────────────────────────


async def _download_thumbnail(pyro_client: "PyroClient", file_id: str) -> bytes | None:
    """Download a thumbnail using the Pyrogram client and return raw bytes."""
    try:
        data = await pyro_client.download_media(file_id, in_memory=True)
        if isinstance(data, BytesIO):
            return data.getvalue()
        if isinstance(data, bytes):
            return data
        return None
    except Exception as e:
        logger.warning("Could not download thumbnail %s: %s", file_id, e)
        return None


async def _get_thumbnail_bytes(
    pyro_client: "PyroClient",
    item: MediaItem,
    bot: Bot,
) -> bytes | None:
    """
    Get thumbnail bytes for an item.
    Falls back to a generic video-icon placeholder if no thumbnail available.
    """
    if item.thumbnail_file_id:
        data = await _download_thumbnail(pyro_client, item.thumbnail_file_id)
        if data:
            return data

    # No thumbnail available — create a simple placeholder image using Pillow
    try:
        from PIL import Image, ImageDraw, ImageFont

        img = Image.new("RGB", (320, 180), color=(30, 30, 30))
        draw = ImageDraw.Draw(img)
        # Draw a play-button triangle
        pts = [(110, 50), (210, 90), (110, 130)]
        draw.polygon(pts, fill=(200, 200, 200))
        draw.text((80, 150), "VIDEO", fill=(180, 180, 180))
        buf = BytesIO()
        img.save(buf, format="JPEG")
        return buf.getvalue()
    except Exception as e:
        logger.warning("Could not create placeholder image: %s", e)
        return None


# ── Single item publish ────────────────────────────────────────────────────────


async def publish_single(
    item: MediaItem,
    bot: Bot,
    pyro_client: "PyroClient",
) -> None:
    """Publish a standalone video as a thumbnail + inline button."""
    token = _make_token(item.file_unique_id)

    # Persist to DB
    await database.save_media(token, item.file_id, item.file_type, item.caption)
    await database.mark_processed(item.source_msg_id)

    thumb_bytes = await _get_thumbnail_bytes(pyro_client, item, bot)
    if thumb_bytes is None:
        logger.warning("No thumbnail for message %s — skipping", item.source_msg_id)
        return

    keyboard = InlineKeyboardMarkup(
        [[InlineKeyboardButton("▶️ Xem video", callback_data=f"media:{token}")]]
    )

    caption = item.caption or ""

    try:
        kwargs: dict = dict(
            chat_id=config.DEST_CHAT_ID,
            photo=InputFile(BytesIO(thumb_bytes), filename="thumb.jpg"),
            caption=caption if caption else None,
            reply_markup=keyboard,
            parse_mode=ParseMode.HTML,
        )
        if config.DEST_TOPIC_ID:
            kwargs["message_thread_id"] = config.DEST_TOPIC_ID

        await bot.send_photo(**kwargs)
        logger.info("Published single item (msg_id=%s)", item.source_msg_id)
    except TelegramError as e:
        logger.error("Failed to publish single item %s: %s", item.source_msg_id, e)


# ── Media group publish ────────────────────────────────────────────────────────


async def publish_group(
    group: MediaGroup,
    bot: Bot,
    pyro_client: "PyroClient",
) -> None:
    """Publish a media group as a photo album + button list message."""
    media_items: list[InputMediaPhoto] = []
    tokens: list[str] = []

    for idx, item in enumerate(group.items):
        token = _make_token(item.file_unique_id)
        tokens.append(token)

        await database.save_media(token, item.file_id, item.file_type, item.caption)
        await database.save_group_member(group.media_group_id, token, idx)
        await database.mark_processed(item.source_msg_id)

        thumb_bytes = await _get_thumbnail_bytes(pyro_client, item, bot)
        if thumb_bytes:
            media_items.append(
                InputMediaPhoto(
                    media=InputFile(BytesIO(thumb_bytes), filename=f"thumb_{idx}.jpg"),
                    caption=item.caption if item.caption else "",
                )
            )

    if not media_items:
        logger.warning("No thumbnails for group %s — skipping", group.media_group_id)
        return

    try:
        send_kwargs: dict = dict(chat_id=config.DEST_CHAT_ID, media=media_items)
        if config.DEST_TOPIC_ID:
            send_kwargs["message_thread_id"] = config.DEST_TOPIC_ID

        await bot.send_media_group(**send_kwargs)

        # Build numbered buttons
        buttons = [
            [InlineKeyboardButton(f"▶️ Video {i+1}", callback_data=f"media:{tok}")]
            for i, tok in enumerate(tokens)
        ]
        keyboard = InlineKeyboardMarkup(buttons)

        text_kwargs: dict = dict(
            chat_id=config.DEST_CHAT_ID,
            text=f"📂 Album — {len(tokens)} video{'s' if len(tokens) > 1 else ''}",
            reply_markup=keyboard,
        )
        if config.DEST_TOPIC_ID:
            text_kwargs["message_thread_id"] = config.DEST_TOPIC_ID

        await bot.send_message(**text_kwargs)
        logger.info("Published group %s (%d items)", group.media_group_id, len(tokens))

    except TelegramError as e:
        logger.error("Failed to publish group %s: %s", group.media_group_id, e)


# ── Dispatcher ─────────────────────────────────────────────────────────────────


async def publish(
    obj: MediaItem | MediaGroup,
    bot: Bot,
    pyro_client: "PyroClient",
) -> None:
    if isinstance(obj, MediaGroup):
        await publish_group(obj, bot, pyro_client)
    else:
        await publish_single(obj, bot, pyro_client)
    await asyncio.sleep(config.PUBLISH_DELAY)
