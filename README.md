# Telegram Media Clone Bot

Bot tự động **clone toàn bộ một topic Telegram** sang topic/kênh đích, giữ nguyên cấu trúc và thứ tự — chỉ riêng video được thay thế bằng ảnh bìa + nút bấm.

```
─────────────── Topic nguồn ───────────────     ──────────── Topic đích (clone) ────────────
  💬 "Xin chào mọi người"            ──►          💬 "Xin chào mọi người"
  🖼  Ảnh                            ──►          🖼  Ảnh (copy nguyên)
  🎞  Video 1                        ──►          🖼  Ảnh bìa video 1 + [▶️ Xem video]
  🎞  Video 2                        ──►          🖼  Ảnh bìa video 2 + [▶️ Xem video]
  📁  Album [ảnh + ảnh + video]      ──►          📁  Album [ảnh + ảnh + thumbnail]
                                                   📋  2 ảnh trong album trên:
                                                       [▶️ Video 1]
  🎵  Audio                          ──►          🎵  Audio (copy nguyên)
  😄  Sticker                        ──►          😄  Sticker (copy nguyên)
─────────────────────────────────────────     ─────────────────────────────────────────────
Người xem bấm [▶️ Xem video]  →  bot gửi ngay video gốc vào chat
```

---

## Luật chuyển đổi

| Loại tin nhắn nguồn | Hành động |
|---|---|
| Văn bản | Copy nguyên (HTML formatting) |
| Ảnh đơn | Copy nguyên (file_id + caption) |
| Video / GIF / Round video | **Ảnh bìa + nút ▶️** |
| Sticker | Copy nguyên |
| Audio / Voice | Copy nguyên |
| Document (không phải video) | Copy nguyên |
| Document (MIME video/*) | **Ảnh bìa + nút ▶️** |
| Album toàn ảnh | Copy nguyên như media group |
| Album có video | Album ảnh bìa (ảnh giữ nguyên, video → thumbnail) + tin nhắn nút ▶️ |

---

## Yêu cầu

| Thành phần | Lý do |
|---|---|
| **Python 3.12+** | — |
| **Bot Token** ([@BotFather](https://t.me/BotFather)) | Đăng ảnh bìa và nhận callback |
| **API ID + API Hash** ([my.telegram.org](https://my.telegram.org)) | Đọc lịch sử topic nguồn qua Pyrogram |
| **Bot được thêm vào** cả chat nguồn và chat đích | Với quyền gửi media |

---

## Cài đặt

```bash
git clone <repo>
cd <repo>

pip install python-telegram-bot==21.6 pyrogram==2.0.106 \
            python-dotenv==1.0.1 aiosqlite==0.20.0 Pillow==10.4.0
```

> **TgCrypto** (C extension tăng tốc) cần `python3-dev`.
> Nếu không build được, Pyrogram vẫn hoạt động, chỉ chậm hơn một chút.

---

## Cấu hình

```bash
cp .env.example .env
```

Điền các biến vào `.env`:

| Biến | Mô tả |
|---|---|
| `BOT_TOKEN` | Token từ @BotFather |
| `API_ID` | App API ID từ my.telegram.org |
| `API_HASH` | App API Hash từ my.telegram.org |
| `PHONE_NUMBER` | Số điện thoại Telegram (cho Pyrogram) |
| `SOURCE_CHAT_ID` | ID supergroup chứa topic nguồn (vd `-1001234567890`) |
| `SOURCE_TOPIC_ID` | Thread ID topic nguồn (URL Telegram Web: `?thread=XXX`) |
| `DEST_CHAT_ID` | ID chat/kênh đích |
| `DEST_TOPIC_ID` | (tuỳ chọn) Thread ID topic đích |
| `PUBLISH_DELAY` | Chờ giữa các lần gửi, mặc định `1.5` giây |
| `DB_PATH` | Đường dẫn SQLite, mặc định `data/bot.db` |

---

## Sử dụng

### Clone topic và giữ bot chạy (khuyến nghị lần đầu)

```bash
python bot.py --crawl
```

1. Lần đầu: Pyrogram yêu cầu nhập OTP qua terminal → tạo file session.
2. Bot đọc toàn bộ topic nguồn, đăng sang topic đích theo đúng thứ tự.
3. Sau khi clone xong, bot tiếp tục polling để phục vụ nút ▶️.

### Chỉ chạy bot (không clone lại)

```bash
python bot.py
```

### Trigger clone từ Telegram

Gửi `/crawl` cho bot trong bất kỳ chat nào bot đang tham gia.

### Xem thống kê

Gửi `/status` để xem chat nguồn/đích đang cấu hình.

---

## Kiến trúc

```
bot.py          — Khởi động Application, đăng ký handlers
config.py       — Đọc .env
database.py     — SQLite async: processed_messages, media_map, group_map
crawler.py      — Pyrogram: đọc toàn bộ topic, phân loại AnyMessage / MessageGroup
publisher.py    — Gửi từng loại tin: copy hoặc chuyển sang thumbnail+button
handlers.py     — /start, /status, /crawl, callback media:{token}
```

### Luồng dữ liệu

```
Pyrogram user session
  └─► crawl_topic() → AnyMessage | MessageGroup  (chronological order)
        └─► publish()
              ├─► text/photo/sticker/audio → bot.send_*(file_id)
              └─► video/* → download_thumbnail → bot.send_photo(thumb, InlineKeyboard)
                              └─► save_media(token, file_id) → SQLite

Người bấm ▶️  →  callback_handler()
  └─► get_media(token) từ SQLite  →  bot.send_video(file_id)
```

---

## Lưu ý

- **File ID**: Video không bị upload lại — bot chỉ lưu `file_id` Telegram và dùng lại.
- **Session file**: `<SESSION_NAME>.session` được tạo sau lần đăng nhập đầu tiên. Giữ bí mật.
- **Flood wait**: Nếu topic có hàng nghìn tin nhắn, tăng `PUBLISH_DELAY` để tránh rate limit.
- **Album video**: Telegram không cho gắn InlineKeyboard vào media group, nên bot gửi thêm 1 tin nhắn chứa các nút ngay sau album.
