# Telegram Media Thumbnail Bot

Tự động chuyển đổi một **topic (luồng) chứa video** thành **ảnh bìa kèm nút bấm**.  
Khi người xem nhấn nút ▶️, bot gửi ngay video gốc về chat của họ.

```
[ Topic nguồn ]          [ Kênh/topic đích ]         [ Người xem ]
  video 1        ──►    🖼 ảnh bìa + [▶️ Xem]   ──►   nhận video
  video 2        ──►    🖼 ảnh bìa + [▶️ Xem]
  album 3 video  ──►    🖼🖼🖼 album ảnh bìa
                         📂 Album — 3 videos
                         [▶️ Video 1] [▶️ Video 2] [▶️ Video 3]
```

---

## Yêu cầu

| Thành phần | Lý do |
|---|---|
| **Python 3.12+** | async/await native |
| **Bot Token** (từ [@BotFather](https://t.me/BotFather)) | Để bot đăng ảnh và nhận callback |
| **API ID + API Hash** (từ [my.telegram.org](https://my.telegram.org)) | Để đọc lịch sử tin nhắn topic nguồn (Pyrogram user session) |
| **Bot được thêm vào cả 2 chat** với quyền gửi media | — |

---

## Cài đặt

```bash
git clone <repo>
cd telegram-media-thumbnail-bot

pip install python-telegram-bot==21.6 pyrogram==2.0.106 \
            python-dotenv==1.0.1 aiosqlite==0.20.0 Pillow==10.4.0
```

> **TgCrypto** (C extension tăng tốc Pyrogram) cần `python3-dev`.  
> Nếu không cài được, Pyrogram vẫn hoạt động bình thường, chỉ chậm hơn.

---

## Cấu hình

1. Sao chép file mẫu:

```bash
cp .env.example .env
```

2. Điền các giá trị vào `.env`:

| Biến | Mô tả |
|---|---|
| `BOT_TOKEN` | Token bot từ @BotFather |
| `API_ID` | App API ID từ my.telegram.org |
| `API_HASH` | App API Hash từ my.telegram.org |
| `PHONE_NUMBER` | Số điện thoại Telegram (để Pyrogram đăng nhập) |
| `SOURCE_CHAT_ID` | ID supergroup chứa topic nguồn (số âm, vd `-1001234567890`) |
| `SOURCE_TOPIC_ID` | Thread ID của topic nguồn (xem URL Telegram Web: `?thread=XXX`) |
| `DEST_CHAT_ID` | ID chat/kênh đích để đăng ảnh bìa |
| `DEST_TOPIC_ID` | (tuỳ chọn) Thread ID của topic đích |
| `PUBLISH_DELAY` | Thời gian chờ giữa các lần đăng (giây), mặc định `1.5` |
| `DB_PATH` | Đường dẫn SQLite, mặc định `data/bot.db` |

---

## Sử dụng

### Lần đầu — crawl topic nguồn và chạy bot

```bash
python bot.py --crawl
```

Bot sẽ:
1. Xác thực Pyrogram (lần đầu sẽ yêu cầu nhập OTP qua terminal).
2. Đọc toàn bộ tin nhắn trong topic nguồn.
3. Tải ảnh bìa của từng video, đăng sang chat đích kèm nút ▶️.
4. Tiếp tục chạy ở chế độ polling để phục vụ người bấm nút.

### Chỉ chạy bot (không crawl lại)

```bash
python bot.py
```

### Trigger crawl từ trong Telegram

Gửi lệnh `/crawl` cho bot (trong bất kỳ chat nào bot đã được thêm vào).

---

## Kiến trúc

```
bot.py          — Khởi động Application, đăng ký handlers
config.py       — Đọc biến môi trường từ .env
database.py     — SQLite async (aiosqlite): lưu mapping token→file_id
crawler.py      — Pyrogram: đọc lịch sử topic nguồn, trả về MediaItem/MediaGroup
publisher.py    — python-telegram-bot: đăng ảnh bìa + InlineKeyboard
handlers.py     — /start, /crawl, callback media:{token}
```

### Luồng dữ liệu

```
Pyrogram (user session)
  └─► crawl_topic()  →  MediaItem / MediaGroup
        └─► publish()
              ├─► download thumbnail (Pyrogram)
              ├─► save_media(token, file_id) → SQLite
              └─► bot.send_photo(photo, InlineKeyboardMarkup)

Người dùng bấm nút  →  callback_handler()
  └─► get_media(token) từ SQLite
        └─► bot.send_video(file_id)
```

---

## Ghi chú

- **File ID**: Bot sử dụng `file_id` nội bộ của Telegram — video không được tải lên lại, chỉ được forward qua Telegram infrastructure.
- **Album video**: Telegram không cho gắn InlineKeyboard vào media group, nên bot gửi thêm 1 tin nhắn văn bản chứa các nút ▶️ Video 1, ▶️ Video 2…
- **Pyrogram session**: File `<SESSION_NAME>.session` được tạo sau lần đăng nhập đầu tiên. Giữ file này bảo mật.
- **Flood wait**: Nếu topic nguồn có nhiều video, tăng `PUBLISH_DELAY` để tránh bị Telegram giới hạn tốc độ.
