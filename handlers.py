"""
python-telegram-bot update handlers.

/start       — greeting
/crawl       — trigger a crawl + publish run (admin only)
Callback     — media:{token} → send the actual video to the user
"""

from __future__ import annotations

import logging
from io import BytesIO
from typing import TYPE_CHECKING

from telegram import Update, InlineKeyboardButton, InlineKeyboardMarkup
from telegram.constants import ParseMode, ChatAction
from telegram.ext import ContextTypes

import config
import database

if TYPE_CHECKING:
    pass

logger = logging.getLogger(__name__)


# ── /start ─────────────────────────────────────────────────────────────────────

async def cmd_start(update: Update, context: ContextTypes.DEFAULT_TYPE) -> None:
    await update.message.reply_text(
        "👋 Xin chào!\n\n"
        "Bot này lưu trữ và phân phối media từ nguồn kênh.\n"
        "Nhấn nút <b>▶️ Xem video</b> dưới ảnh bìa để nhận video.",
        parse_mode=ParseMode.HTML,
    )


# ── /crawl ─────────────────────────────────────────────────────────────────────

async def cmd_crawl(update: Update, context: ContextTypes.DEFAULT_TYPE) -> None:
    """
    Start a crawl-and-publish job.  Stored in bot_data so it's not re-launched
    while already running.
    """
    if context.bot_data.get("crawl_running"):
        await update.message.reply_text("⏳ Đang crawl, vui lòng chờ...")
        return

    await update.message.reply_text("🚀 Bắt đầu crawl nguồn media...")

    # Schedule the crawl as a background task via JobQueue
    context.job_queue.run_once(
        _crawl_job,
        when=0,
        data={"chat_id": update.effective_chat.id},
        name="crawl_once",
    )


async def _crawl_job(context: ContextTypes.DEFAULT_TYPE) -> None:
    """Background job: crawl + publish."""
    import asyncio
    from crawler import build_client, crawl_topic
    from publisher import publish

    context.bot_data["crawl_running"] = True
    chat_id = context.job.data["chat_id"]

    try:
        pyro_client = await build_client()
        await pyro_client.start()

        # Collect already-processed IDs
        processed: set[int] = set()  # we rely on DB checks inside publish

        count = 0
        async for obj in crawl_topic(pyro_client, processed):
            await publish(obj, context.bot, pyro_client)
            count += 1

        await pyro_client.stop()

        await context.bot.send_message(
            chat_id=chat_id,
            text=f"✅ Hoàn thành! Đã xử lý <b>{count}</b> mục.",
            parse_mode=ParseMode.HTML,
        )
    except Exception as e:
        logger.exception("Crawl job failed: %s", e)
        await context.bot.send_message(
            chat_id=chat_id,
            text=f"❌ Lỗi: <code>{e}</code>",
            parse_mode=ParseMode.HTML,
        )
    finally:
        context.bot_data["crawl_running"] = False


# ── Inline button callback ─────────────────────────────────────────────────────

async def callback_handler(update: Update, context: ContextTypes.DEFAULT_TYPE) -> None:
    """
    Handle media:{token} callbacks — send the actual video back to the user.
    """
    query = update.callback_query
    await query.answer()  # stop the loading spinner

    data: str = query.data or ""

    if not data.startswith("media:"):
        await query.answer("❓ Không nhận ra yêu cầu.")
        return

    token = data[len("media:"):]
    media = await database.get_media(token)

    if media is None:
        await query.answer("⚠️ Không tìm thấy media. Có thể đã bị xóa.", show_alert=True)
        return

    file_id = media["file_id"]
    file_type = media["file_type"]
    caption = media["caption"] or ""

    await context.bot.send_chat_action(
        chat_id=query.message.chat_id, action=ChatAction.UPLOAD_VIDEO
    )

    try:
        if file_type == "video":
            await context.bot.send_video(
                chat_id=query.message.chat_id,
                video=file_id,
                caption=caption or None,
                parse_mode=ParseMode.HTML,
            )
        elif file_type == "animation":
            await context.bot.send_animation(
                chat_id=query.message.chat_id,
                animation=file_id,
                caption=caption or None,
                parse_mode=ParseMode.HTML,
            )
        else:
            await context.bot.send_document(
                chat_id=query.message.chat_id,
                document=file_id,
                caption=caption or None,
                parse_mode=ParseMode.HTML,
            )
    except Exception as e:
        logger.error("Failed to send media for token %s: %s", token, e)
        await query.answer("❌ Lỗi khi gửi video.", show_alert=True)
