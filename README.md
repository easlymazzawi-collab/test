# Telegram Topic Clone Bot

Tải về → Click đúp → Xong.

---

## Cách dùng

### Bước 1 — Cài Python (1 lần duy nhất)

Tải tại [python.org/downloads](https://www.python.org/downloads/)  
**Tick "Add Python to PATH"** trước khi bấm Install.

### Bước 2 — Tải bot

Tải 2 file:
- [`bot.py`](bot.py)
- [`run.bat`](run.bat)

Bỏ cùng vào 1 thư mục (ví dụ `C:\Bot\`)

### Bước 3 — Click đúp `run.bat`

Lần đầu bot sẽ:
1. Tự cài thư viện
2. Hỏi thông tin cấu hình (BOT_TOKEN, API_ID…)
3. Hỏi OTP Telegram để đăng nhập
4. Tự động clone toàn bộ topic
5. Tiếp tục chạy để phục vụ nút ▶️

Từ lần 2 trở đi: click đúp là chạy ngay, không hỏi gì thêm.

---

## Thông tin cần chuẩn bị

| Thông tin | Lấy ở đâu |
|---|---|
| **BOT_TOKEN** | Nhắn `/newbot` cho [@BotFather](https://t.me/BotFather) |
| **API_ID + API_HASH** | [my.telegram.org](https://my.telegram.org) → App configuration |
| **Số điện thoại** | Số điện thoại Telegram của bạn |
| **SOURCE_CHAT_ID** | ID supergroup chứa topic gốc — thêm [@userinfobot](https://t.me/userinfobot) vào group để lấy |
| **DEST_CHAT_ID** | ID kênh/group đích |

---

## Lưu ý

- Bot cần quyền **admin + Manage Topics** ở chat đích để tự tạo topic
- Thông tin cấu hình lưu vào `config.json` (cùng thư mục với `bot.py`)
- File đăng nhập Pyrogram lưu vào `media_crawler.session` — giữ bí mật, không chia sẻ
- Nếu muốn clone lại từ đầu: xóa `data/bot.db`
- Nếu muốn đổi cấu hình: xóa `config.json`, chạy lại bot
