# Cursor Chat Studio

Web chat hiện đại kiểu Claude/ChatGPT để gọi Cursor Cloud Agent API, có:

- Giao diện chat streaming theo run của Cursor Agent
- Nhập Cursor API key hoặc dùng biến môi trường `CURSOR_API_KEY`
- Upload tối đa 5 ảnh cho mỗi prompt (`png`, `jpeg`, `gif`, `webp`)
- Panel bên phải để viết/sửa code theo nhiều tab file
- Gửi kèm tab code đang mở vào prompt
- Tuỳ chọn repo GitHub, starting ref, PR URL, auto-create PR và mode `agent`/`plan`

## Chạy web

Yêu cầu Node.js 18.17+.

```bash
npm start
```

Mở:

```text
http://localhost:4173
```

### Cách dùng API key

Cách khuyến nghị là đặt API key ở server:

```bash
CURSOR_API_KEY=your_cursor_api_key npm start
```

Hoặc dán API key vào ô "Cursor API" trong giao diện. Nếu bật "Lưu key",
key chỉ được lưu trong `localStorage` của trình duyệt đang dùng.

Backend local proxy các request tới:

```text
https://api.cursor.com/v1/agents
https://api.cursor.com/v1/agents/{agentId}/runs
https://api.cursor.com/v1/agents/{agentId}/runs/{runId}/stream
```

Điều này giúp frontend không gọi trực tiếp API Cursor cross-origin và không
cần hard-code API key vào file HTML/JS.

### Gửi agent sửa code trong repo

1. Nhập `GitHub repo URL`, ví dụ `https://github.com/org/repo`
2. Nhập `Starting ref`, ví dụ `main`
3. Chọn `Agent - sửa code trực tiếp` hoặc `Plan - lập kế hoạch trước`
4. Nhập prompt và bấm "Gửi"

Nếu không nhập repo URL, Cursor sẽ tạo no-repo agent để chat/trao đổi prompt.

---

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
