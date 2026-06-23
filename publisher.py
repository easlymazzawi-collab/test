"""
Publisher — clones a source topic to the destination chat.

Rules
-----
- Text messages          → send_message (HTML preserved)
- Photos                 → send_photo (file_id, caption preserved)
- Stickers               → send_sticker
- Audio / Voice          → send_audio / send_voice
- Video / Animation /
  video_note             → thumbnail image + [▶️ Xem video] inline button
- Document (non-video)   → send_document
- Document (video MIME)  → thumbnail image + [▶️ Xem video] inline button

Media groups (albums)
---------------------
- All photos             → send_media_group (photos, captions preserved)
- Any video in group     → send_media_group with ALL items as photos
                           (videos replaced by their thumbnail),
                           followed by a text message with numbered [▶️] buttons
"""

from __future__ import annotations

import asyncio
import hashlib
import logging
from io import BytesIO
from typing import TYPE_CHECKING

from telegram import Bot, InputFile, InputMediaPhoto, InlineKeyboardButton, InlineKeyboardMarkup
from telegram.constants import ParseMode
from telegram.error import TelegramError

import config
import database
from crawler import AnyMessage, MessageGroup

if TYPE_CHECKING:
    from pyrogram import Client as PyroClient

logger = logging.getLogger(__name__)


# ── Token helper ───────────────────────────────────────────────────────────────

def _token(file_unique_id: str) -> str:
    """24-char hex token safe for callback_data (≤ 64 bytes)."""
    return hashlib.sha256(file_unique_id.encode()).hexdigest()[:24]


# ── Destination helpers ────────────────────────────────────────────────────────

def _dest_kwargs() -> dict:
    """Base kwargs for every send_* call."""
    kw: dict = {"chat_id": config.DEST_CHAT_ID}
    if config.DEST_TOPIC_ID:
        kw["message_thread_id"] = config.DEST_TOPIC_ID
    return kw


# ── Thumbnail helpers ──────────────────────────────────────────────────────────

async def _thumb_bytes(pyro: "PyroClient", item: AnyMessage) -> bytes | None:
    """Download thumbnail bytes for a video item; fall back to placeholder."""
    if item.thumbnail_file_id:
        try:
            data = await pyro.download_media(item.thumbnail_file_id, in_memory=True)
            if isinstance(data, BytesIO):
                return data.getvalue()
            if isinstance(data, bytes):
                return data
        except Exception as e:
            logger.warning("Thumbnail download failed for msg %s: %s", item.msg_id, e)

    # Generate a dark placeholder with a play icon
    try:
        from PIL import Image, ImageDraw

        img = Image.new("RGB", (320, 180), color=(20, 20, 20))
        draw = ImageDraw.Draw(img)
        pts = [(105, 45), (215, 90), (105, 135)]
        draw.polygon(pts, fill=(200, 200, 200))
        buf = BytesIO()
        img.save(buf, format="JPEG")
        return buf.getvalue()
    except Exception as e:
        logger.warning("Placeholder creation failed: %s", e)
        return None


# ── Individual message senders ─────────────────────────────────────────────────

async def _send_text(item: AnyMessage, bot: Bot) -> None:
    try:
        await bot.send_message(
            **_dest_kwargs(),
            text=item.text or "(empty)",
            parse_mode=ParseMode.HTML,
        )
    except TelegramError as e:
        logger.error("send_message failed (msg %s): %s", item.msg_id, e)


async def _send_photo(item: AnyMessage, bot: Bot) -> None:
    try:
        await bot.send_photo(
            **_dest_kwargs(),
            photo=item.file_id,
            caption=item.caption or None,
            parse_mode=ParseMode.HTML,
        )
    except TelegramError as e:
        logger.error("send_photo failed (msg %s): %s", item.msg_id, e)


async def _send_sticker(item: AnyMessage, bot: Bot) -> None:
    try:
        await bot.send_sticker(**_dest_kwargs(), sticker=item.file_id)
    except TelegramError as e:
        logger.error("send_sticker failed (msg %s): %s", item.msg_id, e)


async def _send_audio(item: AnyMessage, bot: Bot) -> None:
    try:
        await bot.send_audio(
            **_dest_kwargs(),
            audio=item.file_id,
            caption=item.caption or None,
            parse_mode=ParseMode.HTML,
        )
    except TelegramError as e:
        logger.error("send_audio failed (msg %s): %s", item.msg_id, e)


async def _send_voice(item: AnyMessage, bot: Bot) -> None:
    try:
        await bot.send_voice(
            **_dest_kwargs(),
            voice=item.file_id,
            caption=item.caption or None,
            parse_mode=ParseMode.HTML,
        )
    except TelegramError as e:
        logger.error("send_voice failed (msg %s): %s", item.msg_id, e)


async def _send_document(item: AnyMessage, bot: Bot) -> None:
    try:
        await bot.send_document(
            **_dest_kwargs(),
            document=item.file_id,
            caption=item.caption or None,
            parse_mode=ParseMode.HTML,
        )
    except TelegramError as e:
        logger.error("send_document failed (msg %s): %s", item.msg_id, e)


async def _send_video_as_thumb(
    item: AnyMessage,
    bot: Bot,
    pyro: "PyroClient",
    label: str = "▶️ Xem video",
) -> None:
    """Send a video item as its thumbnail image with an inline button."""
    tok = _token(item.file_unique_id)
    await database.save_media(tok, item.file_id, item.msg_type, item.caption)
    await database.mark_processed(item.msg_id)

    thumb = await _thumb_bytes(pyro, item)
    if thumb is None:
        logger.warning("No thumbnail available for msg %s — skipping", item.msg_id)
        return

    keyboard = InlineKeyboardMarkup([[InlineKeyboardButton(label, callback_data=f"media:{tok}")]])
    try:
        await bot.send_photo(
            **_dest_kwargs(),
            photo=InputFile(BytesIO(thumb), filename="thumb.jpg"),
            caption=item.caption or None,
            reply_markup=keyboard,
            parse_mode=ParseMode.HTML,
        )
    except TelegramError as e:
        logger.error("send_photo(thumb) failed (msg %s): %s", item.msg_id, e)


# ── Standalone message dispatcher ─────────────────────────────────────────────

async def _publish_single(item: AnyMessage, bot: Bot, pyro: "PyroClient") -> None:
    await database.mark_processed(item.msg_id)

    if item.msg_type == "text":
        await _send_text(item, bot)
    elif item.msg_type == "photo":
        await _send_photo(item, bot)
    elif item.msg_type == "sticker":
        await _send_sticker(item, bot)
    elif item.msg_type == "audio":
        await _send_audio(item, bot)
    elif item.msg_type == "voice":
        await _send_voice(item, bot)
    elif item.msg_type == "document" and not item.is_video:
        await _send_document(item, bot)
    elif item.is_video:
        # video / animation / video_note / video document
        await _send_video_as_thumb(item, bot, pyro)
    else:
        logger.debug("Unsupported message type %s for msg %s", item.msg_type, item.msg_id)


# ── Media group dispatcher ─────────────────────────────────────────────────────

async def _publish_group(group: MessageGroup, bot: Bot, pyro: "PyroClient") -> None:
    """
    Publish a media group.

    If the group contains no videos → send as a standard photo album.
    If it contains any video(s)     → send as mixed album (photos + video
                                      thumbnails) + a buttons message for videos.
    """
    if not group.has_video:
        # Pure photo album — send as-is
        media_list: list[InputMediaPhoto] = []
        for idx, item in enumerate(group.items):
            await database.mark_processed(item.msg_id)
            cap = item.caption if idx == 0 else ""   # caption only on first item
            media_list.append(InputMediaPhoto(media=item.file_id, caption=cap,
                                              parse_mode=ParseMode.HTML))
        try:
            await bot.send_media_group(**_dest_kwargs(), media=media_list)
        except TelegramError as e:
            logger.error("send_media_group (pure photo) failed for group %s: %s",
                         group.media_group_id, e)
        return

    # Mixed / video album — replace videos with thumbnails
    media_list = []
    video_buttons: list[InlineKeyboardButton] = []
    video_idx = 0

    for idx, item in enumerate(group.items):
        await database.mark_processed(item.msg_id)
        cap = item.caption if idx == 0 else ""

        if item.is_video:
            video_idx += 1
            tok = _token(item.file_unique_id)
            await database.save_media(tok, item.file_id, item.msg_type, item.caption)
            await database.save_group_member(group.media_group_id, tok, idx)

            thumb = await _thumb_bytes(pyro, item)
            if thumb:
                media_list.append(
                    InputMediaPhoto(
                        media=InputFile(BytesIO(thumb), filename=f"thumb_{idx}.jpg"),
                        caption=cap,
                        parse_mode=ParseMode.HTML,
                    )
                )
                video_buttons.append(
                    InlineKeyboardButton(
                        f"▶️ Video {video_idx}",
                        callback_data=f"media:{tok}",
                    )
                )
        else:
            # Photo item — keep original
            media_list.append(InputMediaPhoto(media=item.file_id, caption=cap,
                                              parse_mode=ParseMode.HTML))

    if not media_list:
        logger.warning("Group %s produced no media items — skipping", group.media_group_id)
        return

    try:
        await bot.send_media_group(**_dest_kwargs(), media=media_list)
    except TelegramError as e:
        logger.error("send_media_group (mixed) failed for group %s: %s",
                     group.media_group_id, e)
        return

    # Send buttons row for the videos in this group
    if video_buttons:
        # Wrap each button in its own row for readability
        keyboard = InlineKeyboardMarkup([[btn] for btn in video_buttons])
        try:
            await bot.send_message(
                **_dest_kwargs(),
                text=f"📂 <b>{len(video_buttons)} video</b> trong album trên:",
                reply_markup=keyboard,
                parse_mode=ParseMode.HTML,
            )
        except TelegramError as e:
            logger.error("send_message (video buttons) failed for group %s: %s",
                         group.media_group_id, e)


# ── Public API ─────────────────────────────────────────────────────────────────

async def publish(
    obj: AnyMessage | MessageGroup,
    bot: Bot,
    pyro: "PyroClient",
) -> None:
    """Publish one item (standalone or group), then wait PUBLISH_DELAY."""
    if isinstance(obj, MessageGroup):
        await _publish_group(obj, bot, pyro)
    else:
        await _publish_single(obj, bot, pyro)
    await asyncio.sleep(config.PUBLISH_DELAY)
