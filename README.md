# Cursor Chat Studio

Web chat hiện đại kiểu Claude/ChatGPT để gọi Cursor Cloud Agent API, có:

- Giao diện chat streaming theo run của Cursor Agent
- Render markdown trong tin nhắn (heading, list, blockquote, link, code)
- Code block trong chat có nút Copy và Sửa (mở thẳng vào code workspace)
- Sidebar lưu nhiều đoạn chat trong `localStorage`, có nút xoá từng đoạn
- Nhập Cursor API key hoặc dùng biến môi trường `CURSOR_API_KEY`
- Tự load danh sách model từ `GET /v1/models` khi có API key
- Chọn model ngay trong khu nhập chat
- Upload tối đa 5 ảnh cho mỗi prompt (`png`, `jpeg`, `gif`, `webp`)
- Panel code bên phải chỉ hiện tab khi có code thật hoặc khi bạn tạo file
- Tự tạo tab từ code block trong phản hồi của agent
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

### Lưu đoạn chat và code

- Mỗi đoạn chat được lưu trên trình duyệt bằng `localStorage`
- Agent ID/run của từng chat được giữ riêng để gửi follow-up đúng phiên
- Code workspace cũng lưu local; bấm **Viết code** hoặc để agent trả code block
  thì panel code sẽ tự mở
- App tự migrate state cũ để bỏ file demo `example.ts`; nếu trình duyệt vẫn hiện
  giao diện cũ, hard refresh trang hoặc xoá site data của `localhost:4173`
