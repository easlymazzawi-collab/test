"""
Telegram Topic Clone Bot — ALL IN ONE FILE
==========================================
Lần đầu chạy:
  1. Tự cài thư viện cần thiết
  2. Hỏi thông tin cấu hình, lưu vào config.json
  3. Xác thực Telegram qua OTP
  4. Bắt đầu clone / chạy bot

Từ lần 2 trở đi: tự khởi động, không cần làm gì thêm.
"""

# ═══════════════════════════════════════════════════════════════════════════════
# BƯỚC 1 — Tự cài thư viện
# ═══════════════════════════════════════════════════════════════════════════════
import subprocess, sys, os

REQUIRED = [
    "python-telegram-bot==21.6",
    "pyrogram==2.0.106",
    "aiosqlite==0.20.0",
    "Pillow==10.4.0",
]

print("🔧 Kiểm tra thư viện...")
for pkg in REQUIRED:
    name = pkg.split("==")[0].lower().replace("-", "_")
    try:
        __import__(name)
    except ImportError:
        print(f"   Đang cài {pkg}...")
        subprocess.check_call(
            [sys.executable, "-m", "pip", "install", pkg, "-q"],
            stdout=subprocess.DEVNULL,
        )
print("✅ Thư viện OK\n")

# ═══════════════════════════════════════════════════════════════════════════════
# BƯỚC 2 — Import sau khi cài xong
# ═══════════════════════════════════════════════════════════════════════════════
import asyncio
import hashlib
import json
import logging
import sqlite3
from dataclasses import dataclass, field
from io import BytesIO
from typing import AsyncGenerator, Literal

import aiosqlite
from PIL import Image, ImageDraw
from pyrogram import Client as PyroClient
from pyrogram.types import Message
from telegram import (
    Bot, InputFile, InputMediaPhoto,
    InlineKeyboardButton, InlineKeyboardMarkup,
)
from telegram.constants import ParseMode, ChatAction
from telegram.error import TelegramError
from telegram.ext import (
    Application, CallbackQueryHandler, CommandHandler,
)

logging.basicConfig(
    level=logging.WARNING,
    format="%(asctime)s [%(levelname)s] %(message)s",
    datefmt="%H:%M:%S",
)
logger = logging.getLogger(__name__)

# ═══════════════════════════════════════════════════════════════════════════════
# BƯỚC 3 — Cấu hình (config.json)
# ═══════════════════════════════════════════════════════════════════════════════
CONFIG_FILE = os.path.join(os.path.dirname(os.path.abspath(__file__)), "config.json")

def _ask(prompt: str, default: str = "") -> str:
    val = input(prompt).strip()
    return val if val else default

def _setup_wizard() -> dict:
    print("=" * 60)
    print("  THIẾT LẬP LẦN ĐẦU — Nhập thông tin bên dưới")
    print("=" * 60)
    print()
    print("📌 Lấy BOT_TOKEN:  nhắn /newbot cho @BotFather trên Telegram")
    bot_token = _ask("BOT_TOKEN: ")

    print()
    print("📌 Lấy API_ID & API_HASH: vào https://my.telegram.org → App configuration")
    api_id    = _ask("API_ID: ")
    api_hash  = _ask("API_HASH: ")
    phone     = _ask("Số điện thoại Telegram (vd +84901234567): ")

    print()
    print("📌 SOURCE_CHAT_ID: ID supergroup chứa topic gốc (số âm, vd -1001234567890)")
    print("   Cách lấy: thêm @userinfobot vào group, nó sẽ trả về ID")
    source_chat = _ask("SOURCE_CHAT_ID: ")

    print()
    print("📌 DEST_CHAT_ID: ID kênh/group đích để đăng bản clone")
    dest_chat = _ask("DEST_CHAT_ID: ")

    print()
    print("📌 Chế độ clone:")
    print("   [1] Clone TẤT CẢ topic (để trống SOURCE_TOPIC_ID)")
    print("   [2] Clone MỘT topic (nhập ID topic)")
    mode = _ask("Chọn [1/2]: ", "1")
    source_topic = ""
    dest_topic   = ""
    if mode == "2":
        print("   SOURCE_TOPIC_ID: mở topic trên web.telegram.org, URL có ?thread=XXX")
        source_topic = _ask("SOURCE_TOPIC_ID: ")
        dest_topic   = _ask("DEST_TOPIC_ID (để trống nếu không có): ")

    delay = _ask("Delay giữa các tin nhắn (giây, mặc định 1.5): ", "1.5")

    cfg = {
        "BOT_TOKEN":        bot_token,
        "API_ID":           int(api_id),
        "API_HASH":         api_hash,
        "PHONE_NUMBER":     phone,
        "SOURCE_CHAT_ID":   int(source_chat),
        "SOURCE_TOPIC_ID":  int(source_topic) if source_topic.strip() else None,
        "DEST_CHAT_ID":     int(dest_chat),
        "DEST_TOPIC_ID":    int(dest_topic) if dest_topic.strip() else None,
        "PUBLISH_DELAY":    float(delay),
        "SESSION_NAME":     "media_crawler",
        "DB_PATH":          "data/bot.db",
    }

    with open(CONFIG_FILE, "w", encoding="utf-8") as f:
        json.dump(cfg, f, indent=2, ensure_ascii=False)

    print()
    print("✅ Đã lưu config.json")
    return cfg

def load_config() -> dict:
    if not os.path.exists(CONFIG_FILE):
        return _setup_wizard()
    with open(CONFIG_FILE, encoding="utf-8") as f:
        return json.load(f)

CFG = load_config()

# Shortcuts
BOT_TOKEN      = CFG["BOT_TOKEN"]
API_ID         = CFG["API_ID"]
API_HASH       = CFG["API_HASH"]
PHONE_NUMBER   = CFG["PHONE_NUMBER"]
SOURCE_CHAT_ID = CFG["SOURCE_CHAT_ID"]
SOURCE_TOPIC_ID= CFG.get("SOURCE_TOPIC_ID")   # None = clone all
DEST_CHAT_ID   = CFG["DEST_CHAT_ID"]
DEST_TOPIC_ID  = CFG.get("DEST_TOPIC_ID")
PUBLISH_DELAY  = CFG.get("PUBLISH_DELAY", 1.5)
SESSION_NAME   = CFG.get("SESSION_NAME", "media_crawler")
DB_PATH        = CFG.get("DB_PATH", "data/bot.db")

# ═══════════════════════════════════════════════════════════════════════════════
# DATABASE
# ═══════════════════════════════════════════════════════════════════════════════
os.makedirs(os.path.dirname(os.path.abspath(DB_PATH)), exist_ok=True)

async def init_db():
    async with aiosqlite.connect(DB_PATH) as db:
        await db.executescript("""
            CREATE TABLE IF NOT EXISTS processed_messages (
                source_msg_id INTEGER PRIMARY KEY,
                processed_at  TIMESTAMP DEFAULT CURRENT_TIMESTAMP
            );
            CREATE TABLE IF NOT EXISTS media_map (
                token     TEXT PRIMARY KEY,
                file_id   TEXT NOT NULL,
                file_type TEXT NOT NULL,
                caption   TEXT DEFAULT ''
            );
            CREATE TABLE IF NOT EXISTS group_map (
                media_group_id TEXT NOT NULL,
                token          TEXT NOT NULL,
                position       INTEGER NOT NULL,
                PRIMARY KEY (media_group_id, position)
            );
            CREATE TABLE IF NOT EXISTS topic_map (
                source_topic_id INTEGER PRIMARY KEY,
                dest_topic_id   INTEGER NOT NULL,
                title           TEXT DEFAULT ''
            );
        """)
        await db.commit()

async def mark_processed(mid: int):
    async with aiosqlite.connect(DB_PATH) as db:
        db.row_factory = aiosqlite.Row
        await db.execute("INSERT OR IGNORE INTO processed_messages (source_msg_id) VALUES (?)", (mid,))
        await db.commit()

async def save_media(token, file_id, file_type, caption=""):
    async with aiosqlite.connect(DB_PATH) as db:
        await db.execute("INSERT OR REPLACE INTO media_map VALUES (?,?,?,?)",
                         (token, file_id, file_type, caption))
        await db.commit()

async def get_media(token) -> dict | None:
    async with aiosqlite.connect(DB_PATH) as db:
        db.row_factory = aiosqlite.Row
        cur = await db.execute("SELECT file_id,file_type,caption FROM media_map WHERE token=?", (token,))
        row = await cur.fetchone()
        return dict(row) if row else None

async def save_group_member(gid, token, pos):
    async with aiosqlite.connect(DB_PATH) as db:
        await db.execute("INSERT OR REPLACE INTO group_map VALUES (?,?,?)", (gid, token, pos))
        await db.commit()

async def save_topic_map(src_tid, dst_tid, title=""):
    async with aiosqlite.connect(DB_PATH) as db:
        await db.execute("INSERT OR REPLACE INTO topic_map VALUES (?,?,?)", (src_tid, dst_tid, title))
        await db.commit()

async def get_dest_topic(src_tid) -> int | None:
    async with aiosqlite.connect(DB_PATH) as db:
        db.row_factory = aiosqlite.Row
        cur = await db.execute("SELECT dest_topic_id FROM topic_map WHERE source_topic_id=?", (src_tid,))
        row = await cur.fetchone()
        return row["dest_topic_id"] if row else None

async def list_topic_maps() -> list[dict]:
    async with aiosqlite.connect(DB_PATH) as db:
        db.row_factory = aiosqlite.Row
        cur = await db.execute("SELECT * FROM topic_map ORDER BY source_topic_id")
        return [dict(r) for r in await cur.fetchall()]

# ═══════════════════════════════════════════════════════════════════════════════
# CRAWLER
# ═══════════════════════════════════════════════════════════════════════════════
@dataclass
class AnyMsg:
    msg_id: int
    msg_type: str
    file_id: str | None = None
    file_unique_id: str | None = None
    thumbnail_file_id: str | None = None
    text: str = ""
    caption: str = ""
    media_group_id: str | None = None
    is_video: bool = False

@dataclass
class MsgGroup:
    media_group_id: str
    items: list[AnyMsg] = field(default_factory=list)

    @property
    def min_msg_id(self): return min(i.msg_id for i in self.items)
    @property
    def has_video(self): return any(i.is_video for i in self.items)

@dataclass
class TopicInfo:
    topic_id: int
    title: str
    icon_color: int = 0
    icon_custom_emoji_id: str | None = None

def _parse(msg: Message) -> AnyMsg | None:
    base = dict(msg_id=msg.id, media_group_id=msg.media_group_id)
    if msg.text and not msg.media:
        return AnyMsg(msg_type="text", text=msg.text.html or str(msg.text), **base)
    cap = msg.caption.html if msg.caption else ""
    if msg.photo:
        p = msg.photo
        return AnyMsg(msg_type="photo", file_id=p.file_id, file_unique_id=p.file_unique_id, caption=cap, **base)
    if msg.video:
        v = msg.video; th = v.thumbs[0].file_id if v.thumbs else None
        return AnyMsg(msg_type="video", file_id=v.file_id, file_unique_id=v.file_unique_id, thumbnail_file_id=th, caption=cap, is_video=True, **base)
    if msg.animation:
        a = msg.animation; th = a.thumbs[0].file_id if a.thumbs else None
        return AnyMsg(msg_type="animation", file_id=a.file_id, file_unique_id=a.file_unique_id, thumbnail_file_id=th, caption=cap, is_video=True, **base)
    if msg.sticker:
        s = msg.sticker
        return AnyMsg(msg_type="sticker", file_id=s.file_id, file_unique_id=s.file_unique_id, **base)
    if msg.document:
        d = msg.document; iv = bool(d.mime_type and d.mime_type.startswith("video/"))
        th = d.thumbs[0].file_id if d.thumbs else None
        return AnyMsg(msg_type="document", file_id=d.file_id, file_unique_id=d.file_unique_id,
                      thumbnail_file_id=th if iv else None, caption=cap, is_video=iv, **base)
    if msg.audio:
        a = msg.audio
        return AnyMsg(msg_type="audio", file_id=a.file_id, file_unique_id=a.file_unique_id, caption=cap, **base)
    if msg.voice:
        v = msg.voice
        return AnyMsg(msg_type="voice", file_id=v.file_id, file_unique_id=v.file_unique_id, caption=cap, **base)
    if msg.video_note:
        vn = msg.video_note; th = vn.thumbs[0].file_id if vn.thumbs else None
        return AnyMsg(msg_type="video_note", file_id=vn.file_id, file_unique_id=vn.file_unique_id,
                      thumbnail_file_id=th, is_video=True, **base)
    return None

async def list_topics(pyro: PyroClient) -> list[TopicInfo]:
    out = []
    try:
        for t in await pyro.get_forum_topics(SOURCE_CHAT_ID):
            out.append(TopicInfo(t.id, t.title,
                                 getattr(t, "icon_color", 0),
                                 getattr(t, "icon_custom_emoji_id", None)))
    except Exception as e:
        print(f"⚠️  Không lấy được danh sách topic: {e}")
    return out

async def crawl_topic(pyro: PyroClient, topic_id: int) -> AsyncGenerator[AnyMsg | MsgGroup, None]:
    standalone: list[AnyMsg] = []
    groups: dict[str, MsgGroup] = {}
    async for msg in pyro.get_chat_history(SOURCE_CHAT_ID):
        if getattr(msg, "message_thread_id", None) != topic_id:
            continue
        item = _parse(msg)
        if item is None:
            continue
        if item.media_group_id:
            gid = item.media_group_id
            if gid not in groups:
                groups[gid] = MsgGroup(gid)
            groups[gid].items.append(item)
        else:
            standalone.append(item)
    for g in groups.values():
        g.items.sort(key=lambda x: x.msg_id)
    combined = [(i.msg_id, i) for i in standalone] + [(g.min_msg_id, g) for g in groups.values()]
    combined.sort(key=lambda t: t[0])
    for _, obj in combined:
        yield obj

# ═══════════════════════════════════════════════════════════════════════════════
# PUBLISHER
# ═══════════════════════════════════════════════════════════════════════════════
def _tok(uid: str) -> str:
    return hashlib.sha256(uid.encode()).hexdigest()[:24]

def _dkw(tid: int | None = None) -> dict:
    kw = {"chat_id": DEST_CHAT_ID}
    t = tid if tid is not None else DEST_TOPIC_ID
    if t:
        kw["message_thread_id"] = t
    return kw

async def _get_thumb(pyro: PyroClient, item: AnyMsg) -> bytes | None:
    if item.thumbnail_file_id:
        try:
            data = await pyro.download_media(item.thumbnail_file_id, in_memory=True)
            if isinstance(data, BytesIO): return data.getvalue()
            if isinstance(data, bytes): return data
        except Exception:
            pass
    try:
        img = Image.new("RGB", (320, 180), (20, 20, 20))
        draw = ImageDraw.Draw(img)
        draw.polygon([(105, 45), (215, 90), (105, 135)], fill=(200, 200, 200))
        buf = BytesIO(); img.save(buf, "JPEG"); return buf.getvalue()
    except Exception:
        return None

async def _pub_single(item: AnyMsg, bot: Bot, pyro: PyroClient, tid: int | None):
    await mark_processed(item.msg_id)
    kw = _dkw(tid)
    try:
        if item.msg_type == "text":
            await bot.send_message(**kw, text=item.text or "—", parse_mode=ParseMode.HTML)
        elif item.msg_type == "photo":
            await bot.send_photo(**kw, photo=item.file_id, caption=item.caption or None, parse_mode=ParseMode.HTML)
        elif item.msg_type == "sticker":
            await bot.send_sticker(**kw, sticker=item.file_id)
        elif item.msg_type == "audio":
            await bot.send_audio(**kw, audio=item.file_id, caption=item.caption or None, parse_mode=ParseMode.HTML)
        elif item.msg_type == "voice":
            await bot.send_voice(**kw, voice=item.file_id, caption=item.caption or None, parse_mode=ParseMode.HTML)
        elif item.msg_type == "document" and not item.is_video:
            await bot.send_document(**kw, document=item.file_id, caption=item.caption or None, parse_mode=ParseMode.HTML)
        elif item.is_video:
            tok = _tok(item.file_unique_id)
            await save_media(tok, item.file_id, item.msg_type, item.caption)
            thumb = await _get_thumb(pyro, item)
            if thumb:
                kb = InlineKeyboardMarkup([[InlineKeyboardButton("▶️ Xem video", callback_data=f"media:{tok}")]])
                await bot.send_photo(**kw, photo=InputFile(BytesIO(thumb), "thumb.jpg"),
                                     caption=item.caption or None, reply_markup=kb, parse_mode=ParseMode.HTML)
    except TelegramError as e:
        print(f"   ⚠️  Lỗi gửi msg {item.msg_id}: {e}")

async def _pub_group(group: MsgGroup, bot: Bot, pyro: PyroClient, tid: int | None):
    kw = _dkw(tid)
    if not group.has_video:
        media = []
        for i, item in enumerate(group.items):
            await mark_processed(item.msg_id)
            media.append(InputMediaPhoto(media=item.file_id,
                                         caption=item.caption if i == 0 else "",
                                         parse_mode=ParseMode.HTML))
        try:
            await bot.send_media_group(**kw, media=media)
        except TelegramError as e:
            print(f"   ⚠️  Album group {group.media_group_id}: {e}")
        return

    media = []; btns = []; vi = 0
    for i, item in enumerate(group.items):
        await mark_processed(item.msg_id)
        cap = item.caption if i == 0 else ""
        if item.is_video:
            vi += 1; tok = _tok(item.file_unique_id)
            await save_media(tok, item.file_id, item.msg_type, item.caption)
            await save_group_member(group.media_group_id, tok, i)
            thumb = await _get_thumb(pyro, item)
            if thumb:
                media.append(InputMediaPhoto(media=InputFile(BytesIO(thumb), f"t{i}.jpg"),
                                             caption=cap, parse_mode=ParseMode.HTML))
                btns.append(InlineKeyboardButton(f"▶️ Video {vi}", callback_data=f"media:{tok}"))
        else:
            media.append(InputMediaPhoto(media=item.file_id, caption=cap, parse_mode=ParseMode.HTML))
    if not media:
        return
    try:
        await bot.send_media_group(**kw, media=media)
        if btns:
            await bot.send_message(**kw, text=f"📂 <b>{len(btns)} video</b> trong album trên:",
                                   reply_markup=InlineKeyboardMarkup([[b] for b in btns]),
                                   parse_mode=ParseMode.HTML)
    except TelegramError as e:
        print(f"   ⚠️  Album video group {group.media_group_id}: {e}")

async def publish(obj, bot: Bot, pyro: PyroClient, tid: int | None = None):
    if isinstance(obj, MsgGroup):
        await _pub_group(obj, bot, pyro, tid)
    else:
        await _pub_single(obj, bot, pyro, tid)
    await asyncio.sleep(PUBLISH_DELAY)

# ═══════════════════════════════════════════════════════════════════════════════
# CLONE LOGIC
# ═══════════════════════════════════════════════════════════════════════════════
async def clone_one(pyro: PyroClient, bot: Bot, topic: TopicInfo) -> int:
    dest_tid = await get_dest_topic(topic.topic_id)
    if dest_tid is None:
        print(f"   📂 Tạo topic mới: {topic.title}")
        try:
            kw = {"chat_id": DEST_CHAT_ID, "name": topic.title}
            if topic.icon_color:
                kw["icon_color"] = topic.icon_color
            if topic.icon_custom_emoji_id:
                kw["icon_custom_emoji_id"] = topic.icon_custom_emoji_id
            nt = await bot.create_forum_topic(**kw)
            dest_tid = nt.message_thread_id
            await save_topic_map(topic.topic_id, dest_tid, topic.title)
        except TelegramError as e:
            print(f"   ❌ Không tạo được topic: {e}")
            return 0

    count = 0
    async for obj in crawl_topic(pyro, topic.topic_id):
        await publish(obj, bot, pyro, tid=dest_tid)
        count += 1
    return count

async def clone_all(pyro: PyroClient, bot: Bot):
    topics = await list_topics(pyro)
    if not topics:
        print("⚠️  Không tìm thấy topic nào trong SOURCE_CHAT_ID.")
        return
    print(f"📋 Tìm thấy {len(topics)} topic. Bắt đầu clone...\n")
    total = 0
    for i, t in enumerate(topics, 1):
        print(f"[{i}/{len(topics)}] Topic: {t.title}")
        n = await clone_one(pyro, bot, t)
        print(f"         → {n} mục\n")
        total += n
    print(f"✅ Hoàn tất! Tổng cộng {total} mục trong {len(topics)} topic.")

async def clone_single(pyro: PyroClient, bot: Bot):
    if not SOURCE_TOPIC_ID:
        print("❌ SOURCE_TOPIC_ID chưa được đặt.")
        return
    print(f"📋 Clone topic {SOURCE_TOPIC_ID}...")
    count = 0
    async for obj in crawl_topic(pyro, SOURCE_TOPIC_ID):
        await publish(obj, bot, pyro, tid=DEST_TOPIC_ID)
        count += 1
    print(f"✅ Hoàn tất! {count} mục.")

# ═══════════════════════════════════════════════════════════════════════════════
# BOT HANDLERS
# ═══════════════════════════════════════════════════════════════════════════════
async def cmd_start(update, context):
    await update.message.reply_text(
        "👋 <b>Topic Clone Bot</b>\n\n"
        "/cloneall — clone tất cả topic\n"
        "/crawl    — clone topic đã cấu hình\n"
        "/status   — xem trạng thái\n\n"
        "Bấm <b>▶️</b> dưới ảnh bìa để nhận video.",
        parse_mode=ParseMode.HTML,
    )

async def cmd_status(update, context):
    maps = await list_topic_maps()
    mode = f"topic <code>{SOURCE_TOPIC_ID}</code>" if SOURCE_TOPIC_ID else "tất cả topic"
    text = (f"<b>Nguồn:</b> <code>{SOURCE_CHAT_ID}</code> — {mode}\n"
            f"<b>Đích:</b> <code>{DEST_CHAT_ID}</code>\n\n")
    if maps:
        text += "<b>Topic đã clone:</b>\n"
        for m in maps:
            text += f"  • {m['title']} ({m['source_topic_id']} → {m['dest_topic_id']})\n"
    await update.message.reply_text(text, parse_mode=ParseMode.HTML)

async def _run_job(context, coro_fn):
    if context.bot_data.get("running"):
        return
    context.bot_data["running"] = True
    chat_id = context.job.data
    try:
        pyro = PyroClient(SESSION_NAME, api_id=API_ID, api_hash=API_HASH, phone_number=PHONE_NUMBER)
        await pyro.start()
        await coro_fn(pyro, context.bot)
        await pyro.stop()
        await context.bot.send_message(chat_id=chat_id, text="✅ Hoàn tất!")
    except Exception as e:
        await context.bot.send_message(chat_id=chat_id, text=f"❌ Lỗi: <code>{e}</code>", parse_mode=ParseMode.HTML)
    finally:
        context.bot_data["running"] = False

async def cmd_cloneall(update, context):
    if context.bot_data.get("running"):
        await update.message.reply_text("⏳ Đang chạy, chờ chút...")
        return
    await update.message.reply_text("🚀 Bắt đầu clone tất cả topic...")
    context.job_queue.run_once(lambda c: _run_job(c, clone_all), 0, data=update.effective_chat.id)

async def cmd_crawl(update, context):
    if not SOURCE_TOPIC_ID:
        await update.message.reply_text("⚠️ SOURCE_TOPIC_ID chưa đặt. Dùng /cloneall.")
        return
    if context.bot_data.get("running"):
        await update.message.reply_text("⏳ Đang chạy, chờ chút...")
        return
    await update.message.reply_text(f"🚀 Bắt đầu clone topic {SOURCE_TOPIC_ID}...")
    context.job_queue.run_once(lambda c: _run_job(c, clone_single), 0, data=update.effective_chat.id)

async def cb_handler(update, context):
    q = update.callback_query
    await q.answer()
    if not (q.data or "").startswith("media:"):
        return
    tok = q.data[6:]
    m = await get_media(tok)
    if not m:
        await q.answer("⚠️ Không tìm thấy video.", show_alert=True)
        return
    await context.bot.send_chat_action(chat_id=q.message.chat_id, action=ChatAction.UPLOAD_VIDEO)
    try:
        if m["file_type"] == "video":
            await context.bot.send_video(chat_id=q.message.chat_id, video=m["file_id"],
                                         caption=m["caption"] or None, parse_mode=ParseMode.HTML)
        elif m["file_type"] == "animation":
            await context.bot.send_animation(chat_id=q.message.chat_id, animation=m["file_id"],
                                             caption=m["caption"] or None, parse_mode=ParseMode.HTML)
        elif m["file_type"] == "video_note":
            await context.bot.send_video_note(chat_id=q.message.chat_id, video_note=m["file_id"])
        else:
            await context.bot.send_document(chat_id=q.message.chat_id, document=m["file_id"],
                                            caption=m["caption"] or None, parse_mode=ParseMode.HTML)
    except Exception as e:
        await q.answer("❌ Lỗi gửi video.", show_alert=True)

# ═══════════════════════════════════════════════════════════════════════════════
# MAIN
# ═══════════════════════════════════════════════════════════════════════════════
async def startup(app):
    await init_db()

    # Tự động clone khi khởi động
    pyro = PyroClient(SESSION_NAME, api_id=API_ID, api_hash=API_HASH, phone_number=PHONE_NUMBER)
    await pyro.start()
    if SOURCE_TOPIC_ID:
        print(f"\n🚀 Bắt đầu clone topic {SOURCE_TOPIC_ID}...")
        await clone_single(pyro, app.bot)
    else:
        print("\n🚀 Bắt đầu clone TẤT CẢ topic...")
        await clone_all(pyro, app.bot)
    await pyro.stop()
    print("\n🤖 Bot đang chạy. Bấm Ctrl+C để dừng.\n")

def main():
    print()
    print("=" * 60)
    print("       TELEGRAM TOPIC CLONE BOT")
    print("=" * 60)
    print()

    app = Application.builder().token(BOT_TOKEN).build()
    app.add_handler(CommandHandler("start",    cmd_start))
    app.add_handler(CommandHandler("status",   cmd_status))
    app.add_handler(CommandHandler("cloneall", cmd_cloneall))
    app.add_handler(CommandHandler("crawl",    cmd_crawl))
    app.add_handler(CallbackQueryHandler(cb_handler, pattern=r"^media:"))

    async def _main():
        async with app:
            await startup(app)
            await app.start()
            await app.updater.start_polling(drop_pending_updates=True)
            try:
                await asyncio.Event().wait()
            except (KeyboardInterrupt, SystemExit):
                pass
            finally:
                await app.updater.stop()
                await app.stop()

    try:
        asyncio.run(_main())
    except (KeyboardInterrupt, SystemExit):
        print("\n👋 Đã dừng bot.")

if __name__ == "__main__":
    main()
