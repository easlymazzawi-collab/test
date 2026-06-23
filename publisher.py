"""
Publisher — clones messages to the destination chat/topic.

Each publish function accepts an optional `dest_topic_id` override so that
clone-all-topics mode can route each topic's messages to the correct thread.
When None, falls back to config.DEST_TOPIC_ID.
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


# ── Helpers ────────────────────────────────────────────────────────────────────

def _token(file_unique_id: str) -> str:
    return hashlib.sha256(file_unique_id.encode()).hexdigest()[:24]


def _dest_kwargs(dest_topic_id: int | None = None) -> dict:
    kw: dict = {"chat_id": config.DEST_CHAT_ID}
    tid = dest_topic_id if dest_topic_id is not None else config.DEST_TOPIC_ID
    if tid:
        kw["message_thread_id"] = tid
    return kw


async def _thumb_bytes(pyro: "PyroClient", item: AnyMessage) -> bytes | None:
    if item.thumbnail_file_id:
        try:
            data = await pyro.download_media(item.thumbnail_file_id, in_memory=True)
            if isinstance(data, BytesIO):
                return data.getvalue()
            if isinstance(data, bytes):
                return data
        except Exception as e:
            logger.warning("Thumbnail download failed for msg %s: %s", item.msg_id, e)

    try:
        from PIL import Image, ImageDraw

        img = Image.new("RGB", (320, 180), color=(20, 20, 20))
        draw = ImageDraw.Draw(img)
        draw.polygon([(105, 45), (215, 90), (105, 135)], fill=(200, 200, 200))
        buf = BytesIO()
        img.save(buf, format="JPEG")
        return buf.getvalue()
    except Exception as e:
        logger.warning("Placeholder creation failed: %s", e)
        return None


# ── Individual senders ─────────────────────────────────────────────────────────

async def _send_text(item: AnyMessage, bot: Bot, tid: int | None) -> None:
    try:
        await bot.send_message(**_dest_kwargs(tid), text=item.text or "(empty)",
                               parse_mode=ParseMode.HTML)
    except TelegramError as e:
        logger.error("send_message failed (msg %s): %s", item.msg_id, e)


async def _send_photo(item: AnyMessage, bot: Bot, tid: int | None) -> None:
    try:
        await bot.send_photo(**_dest_kwargs(tid), photo=item.file_id,
                             caption=item.caption or None, parse_mode=ParseMode.HTML)
    except TelegramError as e:
        logger.error("send_photo failed (msg %s): %s", item.msg_id, e)


async def _send_sticker(item: AnyMessage, bot: Bot, tid: int | None) -> None:
    try:
        await bot.send_sticker(**_dest_kwargs(tid), sticker=item.file_id)
    except TelegramError as e:
        logger.error("send_sticker failed (msg %s): %s", item.msg_id, e)


async def _send_audio(item: AnyMessage, bot: Bot, tid: int | None) -> None:
    try:
        await bot.send_audio(**_dest_kwargs(tid), audio=item.file_id,
                             caption=item.caption or None, parse_mode=ParseMode.HTML)
    except TelegramError as e:
        logger.error("send_audio failed (msg %s): %s", item.msg_id, e)


async def _send_voice(item: AnyMessage, bot: Bot, tid: int | None) -> None:
    try:
        await bot.send_voice(**_dest_kwargs(tid), voice=item.file_id,
                             caption=item.caption or None, parse_mode=ParseMode.HTML)
    except TelegramError as e:
        logger.error("send_voice failed (msg %s): %s", item.msg_id, e)


async def _send_document(item: AnyMessage, bot: Bot, tid: int | None) -> None:
    try:
        await bot.send_document(**_dest_kwargs(tid), document=item.file_id,
                                caption=item.caption or None, parse_mode=ParseMode.HTML)
    except TelegramError as e:
        logger.error("send_document failed (msg %s): %s", item.msg_id, e)


async def _send_video_as_thumb(
    item: AnyMessage,
    bot: Bot,
    pyro: "PyroClient",
    tid: int | None,
    label: str = "▶️ Xem video",
) -> None:
    tok = _token(item.file_unique_id)
    await database.save_media(tok, item.file_id, item.msg_type, item.caption)
    await database.mark_processed(item.msg_id)

    thumb = await _thumb_bytes(pyro, item)
    if thumb is None:
        logger.warning("No thumbnail for msg %s — skipping", item.msg_id)
        return

    keyboard = InlineKeyboardMarkup([[InlineKeyboardButton(label, callback_data=f"media:{tok}")]])
    try:
        await bot.send_photo(
            **_dest_kwargs(tid),
            photo=InputFile(BytesIO(thumb), filename="thumb.jpg"),
            caption=item.caption or None,
            reply_markup=keyboard,
            parse_mode=ParseMode.HTML,
        )
    except TelegramError as e:
        logger.error("send_photo(thumb) failed (msg %s): %s", item.msg_id, e)


# ── Standalone dispatcher ──────────────────────────────────────────────────────

async def _publish_single(
    item: AnyMessage, bot: Bot, pyro: "PyroClient", tid: int | None
) -> None:
    await database.mark_processed(item.msg_id)

    if item.msg_type == "text":
        await _send_text(item, bot, tid)
    elif item.msg_type == "photo":
        await _send_photo(item, bot, tid)
    elif item.msg_type == "sticker":
        await _send_sticker(item, bot, tid)
    elif item.msg_type == "audio":
        await _send_audio(item, bot, tid)
    elif item.msg_type == "voice":
        await _send_voice(item, bot, tid)
    elif item.msg_type == "document" and not item.is_video:
        await _send_document(item, bot, tid)
    elif item.is_video:
        await _send_video_as_thumb(item, bot, pyro, tid)
    else:
        logger.debug("Unsupported type %s msg %s", item.msg_type, item.msg_id)


# ── Group dispatcher ───────────────────────────────────────────────────────────

async def _publish_group(
    group: MessageGroup, bot: Bot, pyro: "PyroClient", tid: int | None
) -> None:
    if not group.has_video:
        media_list: list[InputMediaPhoto] = []
        for idx, item in enumerate(group.items):
            await database.mark_processed(item.msg_id)
            cap = item.caption if idx == 0 else ""
            media_list.append(InputMediaPhoto(media=item.file_id, caption=cap,
                                              parse_mode=ParseMode.HTML))
        try:
            await bot.send_media_group(**_dest_kwargs(tid), media=media_list)
        except TelegramError as e:
            logger.error("send_media_group (photos) failed group %s: %s",
                         group.media_group_id, e)
        return

    # Mixed / video album
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
                media_list.append(InputMediaPhoto(
                    media=InputFile(BytesIO(thumb), filename=f"thumb_{idx}.jpg"),
                    caption=cap, parse_mode=ParseMode.HTML,
                ))
                video_buttons.append(InlineKeyboardButton(
                    f"▶️ Video {video_idx}", callback_data=f"media:{tok}"
                ))
        else:
            media_list.append(InputMediaPhoto(media=item.file_id, caption=cap,
                                              parse_mode=ParseMode.HTML))

    if not media_list:
        logger.warning("Group %s has no publishable items", group.media_group_id)
        return

    try:
        await bot.send_media_group(**_dest_kwargs(tid), media=media_list)
    except TelegramError as e:
        logger.error("send_media_group (mixed) failed group %s: %s", group.media_group_id, e)
        return

    if video_buttons:
        keyboard = InlineKeyboardMarkup([[btn] for btn in video_buttons])
        try:
            await bot.send_message(
                **_dest_kwargs(tid),
                text=f"📂 <b>{len(video_buttons)} video</b> trong album trên:",
                reply_markup=keyboard,
                parse_mode=ParseMode.HTML,
            )
        except TelegramError as e:
            logger.error("send buttons failed group %s: %s", group.media_group_id, e)


# ── Public API ─────────────────────────────────────────────────────────────────

async def publish(
    obj: AnyMessage | MessageGroup,
    bot: Bot,
    pyro: "PyroClient",
    dest_topic_id: int | None = None,
) -> None:
    """Publish one item, then wait PUBLISH_DELAY."""
    if isinstance(obj, MessageGroup):
        await _publish_group(obj, bot, pyro, dest_topic_id)
    else:
        await _publish_single(obj, bot, pyro, dest_topic_id)
    await asyncio.sleep(config.PUBLISH_DELAY)
