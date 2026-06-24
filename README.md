# Telegram Topic Clone Bot

Bot tự động **clone toàn bộ supergroup** (tất cả topic) hoặc **một topic duy nhất** sang chat đích, giữ nguyên thứ tự và cấu trúc — chỉ riêng video được thay bằng ảnh bìa + nút ▶️.

```
Supergroup nguồn                   Supergroup đích (bản sao mới)
┌──────────────────────┐           ┌──────────────────────────────┐
│ 📂 Topic A           │  ──────►  │ 📂 Topic A (clone)           │
│   💬 văn bản         │           │   💬 văn bản                 │
│   🖼 ảnh             │           │   🖼 ảnh                     │
│   🎞 video           │           │   🖼 ảnh bìa + [▶️ Xem]      │
│   📁 album ảnh+video │           │   📁 album ảnh+thumbnail     │
│                      │           │   📋 [▶️ Video 1]            │
├──────────────────────┤           ├──────────────────────────────┤
│ 📂 Topic B           │  ──────►  │ 📂 Topic B (clone)           │
│   ...                │           │   ...                        │
├──────────────────────┤           ├──────────────────────────────┤
│ 📂 Topic C           │  ──────►  │ 📂 Topic C (clone)           │
└──────────────────────┘           └──────────────────────────────┘
```

Người xem bấm **▶️** → bot gửi video gốc ngay vào chat.

---

## Luật chuyển đổi

| Loại tin nhắn | Hành động |
|---|---|
| Văn bản | Copy nguyên (HTML) |
| Ảnh, Sticker, Audio, Voice, Document | Copy nguyên (file_id) |
| Video / GIF / Round video | **Ảnh bìa + nút ▶️** |
| Document MIME `video/*` | **Ảnh bìa + nút ▶️** |
| Album toàn ảnh | Media group copy nguyên |
| Album có video | Album thumbnail + tin nhắn nút ▶️ |

---

## Yêu cầu

| Thành phần | Lý do |
|---|---|
| **Python 3.12+** | — |
| **Bot Token** ([@BotFather](https://t.me/BotFather)) | Đăng ảnh bìa + nhận callback |
| **API ID + API Hash** ([my.telegram.org](https://my.telegram.org)) | Đọc lịch sử topic qua Pyrogram |
| **Bot là admin** ở cả chat nguồn và đích | Quyền: Gửi media + **Manage Topics** |

---

## Cài đặt

```bat
git clone https://github.com/easlymazzawi-collab/test.git
cd test
pip install -r requirements.txt
```

---

## Cấu hình

```bat
copy .env.example .env
notepad .env
```

| Biến | Mô tả |
|---|---|
| `BOT_TOKEN` | Token từ @BotFather |
| `API_ID` / `API_HASH` | Từ my.telegram.org → App configuration |
| `PHONE_NUMBER` | Số điện thoại Telegram của bạn |
| `SOURCE_CHAT_ID` | ID supergroup chứa topic gốc (vd `-1001234567890`) |
| `SOURCE_TOPIC_ID` | **Để trống** → clone tất cả topic. Điền số → clone 1 topic |
| `DEST_CHAT_ID` | ID chat/kênh đích |
| `DEST_TOPIC_ID` | (tuỳ chọn) Thread ID đích — chỉ dùng khi clone 1 topic |
| `PUBLISH_DELAY` | Chờ giữa các lần gửi (giây), mặc định `1.5` |

---

## Sử dụng

### Clone tất cả topic (khuyến nghị)

```bat
python bot.py --clone-all
```

Bot sẽ:
1. Yêu cầu nhập OTP Telegram (chỉ lần đầu).
2. Liệt kê tất cả topic trong `SOURCE_CHAT_ID`.
3. Tự động tạo topic tương ứng trong `DEST_CHAT_ID`.
4. Clone từng topic theo thứ tự, gửi tiến độ vào chat admin.
5. Tiếp tục polling để phục vụ nút ▶️.

### Clone một topic duy nhất

Điền `SOURCE_TOPIC_ID` vào `.env`, sau đó:

```bat
python bot.py --crawl
```

### Chỉ chạy bot (không clone lại)

```bat
python bot.py
```

### Điều khiển qua Telegram

| Lệnh | Tác dụng |
|---|---|
| `/cloneall` | Clone tất cả topic ngay trong Telegram |
| `/crawl` | Clone topic đơn (cần `SOURCE_TOPIC_ID`) |
| `/status` | Xem config + danh sách topic đã clone |
| `/start` | Hướng dẫn |

---

## Kiến trúc

```
bot.py          — CLI entry point + Application builder
config.py       — Đọc .env
database.py     — SQLite: processed_messages, media_map, group_map, topic_map
crawler.py      — Pyrogram: list_topics(), crawl_topic(topic_id)
publisher.py    — Gửi từng loại tin; hỗ trợ dest_topic_id per-call
cloner.py       — Orchestrator: clone_all_topics() → tạo topic đích + crawl + publish
handlers.py     — /start /status /crawl /cloneall + callback media:{token}
```

---

## Lưu ý

- **Idempotent**: Chạy lại an toàn. Topic đích đã tạo và message đã xử lý đều được bỏ qua.
- **Session file**: `media_crawler.session` lưu đăng nhập Pyrogram. Giữ bí mật, không commit.
- **Flood wait**: Topic nhiều video → tăng `PUBLISH_DELAY` lên `2.0`–`3.0`.
- **Manage Topics**: Bot cần quyền này ở DEST_CHAT_ID để tự tạo topic khi dùng `--clone-all`.
