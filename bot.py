"""
Entry point — runs the Telegram bot.

Usage
-----
    python bot.py                 # polling only (serve ▶️ callbacks)
    python bot.py --crawl         # clone single topic (SOURCE_TOPIC_ID required)
    python bot.py --clone-all     # clone ALL topics, then keep polling
"""

from __future__ import annotations

import argparse
import asyncio
import logging

from telegram.ext import (
    Application,
    CallbackQueryHandler,
    CommandHandler,
)

import config
import database
from handlers import (
    cmd_start, cmd_status, cmd_crawl, cmd_cloneall, callback_handler
)

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s [%(levelname)s] %(name)s: %(message)s",
    datefmt="%Y-%m-%d %H:%M:%S",
)
logger = logging.getLogger(__name__)


def _build_app() -> Application:
    app = Application.builder().token(config.BOT_TOKEN).build()
    app.add_handler(CommandHandler("start", cmd_start))
    app.add_handler(CommandHandler("status", cmd_status))
    app.add_handler(CommandHandler("crawl", cmd_crawl))
    app.add_handler(CommandHandler("cloneall", cmd_cloneall))
    app.add_handler(CallbackQueryHandler(callback_handler, pattern=r"^media:"))
    return app


async def _run_single_crawl(app: Application) -> None:
    from crawler import build_client, crawl_topic
    from publisher import publish

    if not config.SOURCE_TOPIC_ID:
        raise ValueError("SOURCE_TOPIC_ID is not set. Use --clone-all to clone all topics.")

    logger.info("One-off clone: topic %s", config.SOURCE_TOPIC_ID)
    pyro = await build_client()
    await pyro.start()

    count = 0
    async for obj in crawl_topic(pyro, already_processed=set(),
                                  topic_id=config.SOURCE_TOPIC_ID):
        await publish(obj, app.bot, pyro, dest_topic_id=config.DEST_TOPIC_ID)
        count += 1

    await pyro.stop()
    logger.info("Single-topic clone done — %d item(s).", count)


async def _run_clone_all(app: Application) -> None:
    from crawler import build_client
    from cloner import clone_all_topics, format_results

    logger.info("One-off clone-all: chat %s", config.SOURCE_CHAT_ID)
    pyro = await build_client()
    await pyro.start()
    results = await clone_all_topics(pyro, app.bot)
    await pyro.stop()
    logger.info(format_results(results).replace("<b>", "").replace("</b>", "")
                .replace("<i>", "").replace("</i>", ""))


async def _main_with_startup(startup_fn=None) -> None:
    await database.init_db()
    app = _build_app()
    async with app:
        if startup_fn:
            await startup_fn(app)
        await app.start()
        await app.updater.start_polling(drop_pending_updates=True)
        logger.info("Bot is running. Press Ctrl+C to stop.")
        try:
            await asyncio.Event().wait()
        except (KeyboardInterrupt, SystemExit):
            pass
        finally:
            await app.updater.stop()
            await app.stop()


def main() -> None:
    parser = argparse.ArgumentParser(description="Telegram Topic Clone Bot")
    group = parser.add_mutually_exclusive_group()
    group.add_argument("--crawl", action="store_true",
                       help="Clone configured single topic on startup.")
    group.add_argument("--clone-all", action="store_true",
                       help="Clone ALL topics in the source supergroup on startup.")
    args = parser.parse_args()

    try:
        if args.crawl:
            asyncio.run(_main_with_startup(_run_single_crawl))
        elif args.clone_all:
            asyncio.run(_main_with_startup(_run_clone_all))
        else:
            # Simple polling mode — no startup crawl
            async def _simple() -> None:
                await database.init_db()
                app = _build_app()
                app.run_polling(drop_pending_updates=True)

            asyncio.run(_simple())
    except (KeyboardInterrupt, SystemExit):
        logger.info("Shutting down.")


if __name__ == "__main__":
    main()
