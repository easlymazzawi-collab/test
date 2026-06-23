"""
python-telegram-bot update handlers.

/start      — greeting
/status     — current config + DB stats
/crawl      — clone the configured single topic (SOURCE_TOPIC_ID must be set)
/cloneall   — clone ALL topics in the source supergroup
Callback    — media:{token} → send the actual video to the user
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
    mode = (
        f"topic <code>{config.SOURCE_TOPIC_ID}</code>"
        if config.SOURCE_TOPIC_ID
        else "tất cả topic"
    )
    await update.message.reply_text(
        "👋 <b>Telegram Topic Clone Bot</b>\n\n"
        f"Nguồn: chat <code>{config.SOURCE_CHAT_ID}</code> — {mode}\n"
        f"Đích: chat <code>{config.DEST_CHAT_ID}</code>\n\n"
        "Lệnh:\n"
        "/crawl     — clone topic đã cấu hình\n"
        "/cloneall  — clone <b>TẤT CẢ</b> topic trong supergroup\n"
        "/status    — xem trạng thái\n\n"
        "Khi người xem bấm <b>▶️</b> → bot gửi video gốc về chat.",
        parse_mode=ParseMode.HTML,
    )


# ── /status ────────────────────────────────────────────────────────────────────

async def cmd_status(update: Update, context: ContextTypes.DEFAULT_TYPE) -> None:
    running = context.bot_data.get("crawl_running", False)
    running_what = context.bot_data.get("crawl_desc", "—")

    mappings = await database.list_topic_mappings()
    map_text = ""
    if mappings:
        rows = "\n".join(
            f"  • <b>{m['title'] or m['source_topic_id']}</b> "
            f"(src <code>{m['source_topic_id']}</code> → "
            f"dst <code>{m['dest_topic_id']}</code>)"
            for m in mappings
        )
        map_text = f"\n\n<b>Topic đã clone:</b>\n{rows}"

    await update.message.reply_text(
        f"<b>Trạng thái:</b> {'🔄 Đang chạy: ' + running_what if running else '✅ Rảnh'}\n\n"
        f"<b>Nguồn:</b> <code>{config.SOURCE_CHAT_ID}</code>"
        + (f" topic <code>{config.SOURCE_TOPIC_ID}</code>" if config.SOURCE_TOPIC_ID else " (all topics)")
        + f"\n<b>Đích:</b> <code>{config.DEST_CHAT_ID}</code>"
        + (f" topic <code>{config.DEST_TOPIC_ID}</code>" if config.DEST_TOPIC_ID else "")
        + map_text,
        parse_mode=ParseMode.HTML,
    )


# ── /crawl (single topic) ──────────────────────────────────────────────────────

async def cmd_crawl(update: Update, context: ContextTypes.DEFAULT_TYPE) -> None:
    if not config.SOURCE_TOPIC_ID:
        await update.message.reply_text(
            "⚠️ SOURCE_TOPIC_ID chưa được đặt trong .env.\n"
            "Dùng /cloneall để clone tất cả topic."
        )
        return

    if context.bot_data.get("crawl_running"):
        await update.message.reply_text("⏳ Đang chạy, vui lòng chờ...")
        return

    await update.message.reply_text(
        f"🚀 Bắt đầu clone topic <code>{config.SOURCE_TOPIC_ID}</code>…",
        parse_mode=ParseMode.HTML,
    )
    context.job_queue.run_once(
        _crawl_single_job,
        when=0,
        data={"chat_id": update.effective_chat.id},
        name="crawl_single",
    )


async def _crawl_single_job(context: ContextTypes.DEFAULT_TYPE) -> None:
    from crawler import build_client, crawl_topic
    from publisher import publish

    context.bot_data["crawl_running"] = True
    context.bot_data["crawl_desc"] = f"topic {config.SOURCE_TOPIC_ID}"
    chat_id = context.job.data["chat_id"]

    try:
        pyro = await build_client()
        await pyro.start()

        count = 0
        async for obj in crawl_topic(pyro, already_processed=set(),
                                     topic_id=config.SOURCE_TOPIC_ID):
            await publish(obj, context.bot, pyro, dest_topic_id=config.DEST_TOPIC_ID)
            count += 1

        await pyro.stop()
        await context.bot.send_message(
            chat_id=chat_id,
            text=f"✅ Hoàn tất! Đã xử lý <b>{count}</b> mục.",
            parse_mode=ParseMode.HTML,
        )
    except Exception as e:
        logger.exception("Single crawl failed: %s", e)
        await context.bot.send_message(
            chat_id=chat_id,
            text=f"❌ Lỗi: <code>{e}</code>",
            parse_mode=ParseMode.HTML,
        )
    finally:
        context.bot_data["crawl_running"] = False
        context.bot_data.pop("crawl_desc", None)


# ── /cloneall (all topics) ─────────────────────────────────────────────────────

async def cmd_cloneall(update: Update, context: ContextTypes.DEFAULT_TYPE) -> None:
    if context.bot_data.get("crawl_running"):
        await update.message.reply_text("⏳ Đang chạy, vui lòng chờ hoàn tất...")
        return

    await update.message.reply_text(
        "🚀 Bắt đầu clone <b>TẤT CẢ</b> topic…\n"
        "Tôi sẽ thông báo tiến độ từng topic.",
        parse_mode=ParseMode.HTML,
    )
    context.job_queue.run_once(
        _clone_all_job,
        when=0,
        data={"chat_id": update.effective_chat.id},
        name="clone_all",
    )


async def _clone_all_job(context: ContextTypes.DEFAULT_TYPE) -> None:
    from crawler import build_client
    from cloner import clone_all_topics, format_results

    context.bot_data["crawl_running"] = True
    context.bot_data["crawl_desc"] = "clone all topics"
    chat_id = context.job.data["chat_id"]

    try:
        pyro = await build_client()
        await pyro.start()

        async def _progress(title: str, current: int, total: int) -> None:
            try:
                await context.bot.send_message(
                    chat_id=chat_id,
                    text=f"📌 [{current}/{total}] Xong topic: <b>{title}</b>",
                    parse_mode=ParseMode.HTML,
                )
            except Exception:
                pass

        results = await clone_all_topics(pyro, context.bot, progress_cb=_progress)
        await pyro.stop()

        summary = format_results(results)
        await context.bot.send_message(
            chat_id=chat_id, text=summary, parse_mode=ParseMode.HTML
        )
    except Exception as e:
        logger.exception("Clone-all job failed: %s", e)
        await context.bot.send_message(
            chat_id=chat_id,
            text=f"❌ Lỗi: <code>{e}</code>",
            parse_mode=ParseMode.HTML,
        )
    finally:
        context.bot_data["crawl_running"] = False
        context.bot_data.pop("crawl_desc", None)


# ── Inline button callback ─────────────────────────────────────────────────────

async def callback_handler(update: Update, context: ContextTypes.DEFAULT_TYPE) -> None:
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
            await context.bot.send_document(
                chat_id=query.message.chat_id,
                document=file_id,
                caption=caption or None,
                parse_mode=ParseMode.HTML,
            )
    except Exception as e:
        logger.error("Failed to send media token=%s: %s", token, e)
        await query.answer("❌ Lỗi khi gửi video.", show_alert=True)
