"""
Entry point — runs the Telegram bot.

Usage
-----
    python bot.py              # start bot (polling)
    python bot.py --crawl      # crawl source topic once, then keep bot running
"""

from __future__ import annotations

import argparse
import asyncio
import logging
import sys

from telegram.ext import (
    Application,
    CallbackQueryHandler,
    CommandHandler,
)

import config
import database
from handlers import cmd_start, cmd_crawl, callback_handler

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s [%(levelname)s] %(name)s: %(message)s",
    datefmt="%Y-%m-%d %H:%M:%S",
)
logger = logging.getLogger(__name__)


async def post_init(application: Application) -> None:
    """Initialise database after the application starts."""
    await database.init_db()
    logger.info("Database initialised at %s", config.DB_PATH)


async def run_crawl_once(application: Application) -> None:
    """Immediately trigger a crawl-and-publish pass."""
    from crawler import build_client, crawl_topic
    from publisher import publish

    logger.info("Starting one-off crawl...")
    pyro_client = await build_client()
    await pyro_client.start()

    count = 0
    async for obj in crawl_topic(pyro_client, already_processed=set()):
        await publish(obj, application.bot, pyro_client)
        count += 1

    await pyro_client.stop()
    logger.info("Crawl complete — processed %d item(s).", count)


def main() -> None:
    parser = argparse.ArgumentParser(description="Telegram Media Thumbnail Bot")
    parser.add_argument(
        "--crawl",
        action="store_true",
        help="Run a one-off crawl of the source topic on startup.",
    )
    args = parser.parse_args()

    app = (
        Application.builder()
        .token(config.BOT_TOKEN)
        .post_init(post_init)
        .build()
    )

    # Register handlers
    app.add_handler(CommandHandler("start", cmd_start))
    app.add_handler(CommandHandler("crawl", cmd_crawl))
    app.add_handler(CallbackQueryHandler(callback_handler, pattern=r"^media:"))

    if args.crawl:
        # Run crawl, then start polling
        async def _startup(app: Application) -> None:
            await run_crawl_once(app)

        app.post_init = post_init  # already set above via builder

        loop = asyncio.new_event_loop()
        asyncio.set_event_loop(loop)

        async def _main_async() -> None:
            await database.init_db()
            async with app:
                await run_crawl_once(app)
                await app.start()
                await app.updater.start_polling(drop_pending_updates=True)
                logger.info("Bot is running. Press Ctrl+C to stop.")
                try:
                    await asyncio.Event().wait()  # run forever
                except (KeyboardInterrupt, SystemExit):
                    pass
                finally:
                    await app.updater.stop()
                    await app.stop()

        try:
            loop.run_until_complete(_main_async())
        except (KeyboardInterrupt, SystemExit):
            logger.info("Shutting down.")
    else:
        app.run_polling(drop_pending_updates=True)


if __name__ == "__main__":
    main()
