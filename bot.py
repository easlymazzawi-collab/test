"""
Entry point — runs the Telegram bot.

Usage
-----
    python bot.py              # start bot in polling mode
    python bot.py --crawl      # clone source topic once, then keep polling
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
from handlers import cmd_start, cmd_status, cmd_crawl, callback_handler

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s [%(levelname)s] %(name)s: %(message)s",
    datefmt="%Y-%m-%d %H:%M:%S",
)
logger = logging.getLogger(__name__)


async def _run_crawl_once(app: Application) -> None:
    """One-off crawl: clone source topic to destination."""
    from crawler import build_client, crawl_topic
    from publisher import publish

    logger.info("Starting one-off topic clone…")
    pyro = await build_client()
    await pyro.start()

    count = 0
    async for obj in crawl_topic(pyro, already_processed=set()):
        await publish(obj, app.bot, pyro)
        count += 1

    await pyro.stop()
    logger.info("Clone complete — %d item(s) processed.", count)


def main() -> None:
    parser = argparse.ArgumentParser(description="Telegram Media Clone Bot")
    parser.add_argument(
        "--crawl",
        action="store_true",
        help="Clone source topic once on startup, then keep bot running.",
    )
    args = parser.parse_args()

    app = Application.builder().token(config.BOT_TOKEN).build()

    # Register handlers
    app.add_handler(CommandHandler("start", cmd_start))
    app.add_handler(CommandHandler("status", cmd_status))
    app.add_handler(CommandHandler("crawl", cmd_crawl))
    app.add_handler(CallbackQueryHandler(callback_handler, pattern=r"^media:"))

    if args.crawl:
        async def _main_async() -> None:
            await database.init_db()
            async with app:
                await _run_crawl_once(app)
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

        try:
            asyncio.run(_main_async())
        except (KeyboardInterrupt, SystemExit):
            logger.info("Shutting down.")
    else:
        async def _init(application: Application) -> None:
            await database.init_db()

        app.post_init = _init
        app.run_polling(drop_pending_updates=True)


if __name__ == "__main__":
    main()
