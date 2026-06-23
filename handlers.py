"""
python-telegram-bot update handlers.

/start   — greeting
/crawl   — trigger a full topic clone (admin command)
/status  — show DB stats
Callback — media:{token} → send the actual video to the user
"""

from __future__ import annotations

import logging

from telegram import Update, InlineKeyboardButton, InlineKeyboardMarkup
from telegram.constants import ParseMode, ChatAction
from telegram.ext import ContextTypes

import config
import database

logger = logging.getLogger(__name__)


# ── /start ─────────────────────────────────────────────────────────────────────

async def cmd_start(update: Update, context: ContextTypes.DEFAULT_TYPE) -> None:
    await update.message.reply_text(
        "👋 <b>Telegram Media Clone Bot</b>\n\n"
        "Bot này sao chép toàn bộ topic nguồn sang topic đích:\n"
        "• Tin nhắn văn bản, ảnh, sticker, audio → copy nguyên vẹn\n"
        "• Video / GIF / Round video → ảnh bìa + nút <b>▶️ Xem video</b>\n"
        "• Album hỗn hợp → album ảnh bìa + nút riêng từng video\n\n"
        "Lệnh:\n"
        "/crawl — bắt đầu clone topic\n"
        "/status — xem thống kê",
        parse_mode=ParseMode.HTML,
    )


# ── /status ────────────────────────────────────────────────────────────────────

async def cmd_status(update: Update, context: ContextTypes.DEFAULT_TYPE) -> None:
    running = context.bot_data.get("crawl_running", False)
    status_text = "🔄 Đang chạy..." if running else "✅ Rảnh"
    await update.message.reply_text(
        f"<b>Trạng thái bot:</b> {status_text}\n\n"
        f"<b>Nguồn:</b> chat <code>{config.SOURCE_CHAT_ID}</code> "
        f"topic <code>{config.SOURCE_TOPIC_ID}</code>\n"
        f"<b>Đích:</b> chat <code>{config.DEST_CHAT_ID}</code>"
        + (f" topic <code>{config.DEST_TOPIC_ID}</code>" if config.DEST_TOPIC_ID else ""),
        parse_mode=ParseMode.HTML,
    )


# ── /crawl ─────────────────────────────────────────────────────────────────────

async def cmd_crawl(update: Update, context: ContextTypes.DEFAULT_TYPE) -> None:
    if context.bot_data.get("crawl_running"):
        await update.message.reply_text("⏳ Đang clone, vui lòng chờ hoàn tất...")
        return

    await update.message.reply_text(
        "🚀 Bắt đầu clone topic...\n"
        "Tôi sẽ thông báo khi hoàn thành."
    )
    context.job_queue.run_once(
        _crawl_job,
        when=0,
        data={"chat_id": update.effective_chat.id},
        name="crawl_once",
    )


async def _crawl_job(context: ContextTypes.DEFAULT_TYPE) -> None:
    """Background job: crawl + clone publish."""
    from crawler import build_client, crawl_topic
    from publisher import publish

    context.bot_data["crawl_running"] = True
    chat_id = context.job.data["chat_id"]

    try:
        pyro_client = await build_client()
        await pyro_client.start()

        count = 0
        async for obj in crawl_topic(pyro_client, already_processed=set()):
            await publish(obj, context.bot, pyro_client)
            count += 1

        await pyro_client.stop()

        await context.bot.send_message(
            chat_id=chat_id,
            text=f"✅ Clone hoàn tất! Đã xử lý <b>{count}</b> mục.",
            parse_mode=ParseMode.HTML,
        )
    except Exception as e:
        logger.exception("Crawl job failed: %s", e)
        await context.bot.send_message(
            chat_id=chat_id,
            text=f"❌ Lỗi trong quá trình clone:\n<code>{e}</code>",
            parse_mode=ParseMode.HTML,
        )
    finally:
        context.bot_data["crawl_running"] = False


# ── Inline button callback ─────────────────────────────────────────────────────

async def callback_handler(update: Update, context: ContextTypes.DEFAULT_TYPE) -> None:
    """
    Handle media:{token} callbacks — send the original video back to the user.
    """
    query = update.callback_query
    await query.answer()

    data: str = query.data or ""
    if not data.startswith("media:"):
        return

    token = data[len("media:"):]
    media = await database.get_media(token)

    if media is None:
        await query.answer("⚠️ Không tìm thấy video. Có thể đã bị xóa.", show_alert=True)
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
        elif file_type == "video_note":
            await context.bot.send_video_note(
                chat_id=query.message.chat_id,
                video_note=file_id,
            )
        else:
            # document with video MIME type
            await context.bot.send_document(
                chat_id=query.message.chat_id,
                document=file_id,
                caption=caption or None,
                parse_mode=ParseMode.HTML,
            )
    except Exception as e:
        logger.error("Failed to send media token=%s: %s", token, e)
        await query.answer("❌ Lỗi khi gửi video.", show_alert=True)
