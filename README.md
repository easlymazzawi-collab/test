# Cursor Chat Studio

Web chat hiện đại kiểu Claude/ChatGPT để gọi Cursor Cloud Agent API, có:

- Giao diện chat streaming theo run của Cursor Agent
- Streaming SSE có tự nối lại khi rớt mạng (`Last-Event-ID`), hết hạn thì đọc
  kết quả qua Get A Run; có nút **Dừng** để cancel run đang chạy
- Render markdown trong tin nhắn (heading, list, blockquote, link, code), tối ưu
  vẽ lại theo khung hình để không giật khi câu trả lời dài
- Code block trong chat có nút Copy và Sửa (mở thẳng vào code workspace)
- Sidebar lưu nhiều đoạn chat trong `localStorage`, có nút xoá từng đoạn
- Nhập Cursor API key hoặc dùng biến môi trường `CURSOR_API_KEY`
- Tự load danh sách model từ `GET /v1/models` khi có API key
- Chọn model ngay trong khu nhập chat
- Upload tối đa 5 ảnh cho mỗi prompt (`png`, `jpeg`, `gif`, `webp`)
- Kéo-thả ảnh vào trang hoặc dán ảnh (Ctrl+V) ngay trong ô chat
- Thả/đính kèm file code (text): tự đọc nội dung, mở trong code workspace và
  gửi kèm prompt (Cursor API chỉ nhận ảnh làm attachment, nên file code được
  đưa vào dưới dạng code context)
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

### Lấy bản mới mà KHÔNG cần tải ZIP lại

Thay vì tải ZIP từ GitHub rồi giải nén mỗi lần có bản sửa, hãy clone repo bằng
`git` một lần duy nhất, sau đó chỉ cần `git pull` là có code mới nhất.

Cài [Git](https://git-scm.com/downloads) một lần, rồi:

```bash
# Lần đầu (clone 1 lần)
git clone <repo-url> cursor-chat
cd cursor-chat

# Nếu code đang ở nhánh phát triển, checkout nhánh đó
git checkout cursor/cursor-chat-web-02bb
```

Mỗi lần mình báo đã fix, bạn chỉ cần:

```bash
git pull        # hoặc: npm run update
npm start
```

### Cài & chạy bằng CMD (Windows)

Cài 2 thứ trước (mỗi thứ 1 lần):

- [Node.js LTS](https://nodejs.org) — nhớ để mặc định "Add to PATH"
- [Git](https://git-scm.com/downloads)

Mở **CMD** rồi gõ lần lượt:

```cmd
cd %USERPROFILE%\Desktop
git clone https://github.com/easlymazzawi-collab/test cursor-chat
cd cursor-chat
git checkout cursor/cursor-chat-web-02bb
node server.js
```

Mở trình duyệt vào `http://localhost:4173`. Tắt server bằng `Ctrl + C`.

Lần sau muốn lấy bản mới + chạy, chỉ cần:

```cmd
cd %USERPROFILE%\Desktop\cursor-chat
git pull
node server.js
```

Hoặc double-click `start.bat` (đã tự `git pull` + chạy giúp bạn).

### Bấm 1 cái để tự cập nhật + chạy

- **Windows**: double-click `start.bat` — tự `git pull` rồi mở server.
- **macOS / Linux**: chạy `./start.sh` — tự `git pull` rồi mở server.

Hai script này tự lấy bản mới nhất (nếu thư mục là git clone), nên không phải
tải lại ZIP và giải nén nữa.

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

### Hai cách để agent sửa code

**1. Có repo (sửa thẳng + tạo PR):**

1. Nhập `GitHub repo URL`, ví dụ `https://github.com/org/repo`
2. Nhập `Starting ref`, ví dụ `main`
3. Bật "Tự tạo PR khi agent push code"
4. Nhập prompt và bấm "Gửi"

Agent chạy trên VM cloud có repo của bạn, sửa file trực tiếp, commit lên branch
`cursor/...` và mở PR. Branch/PR hiện trong tool call của tin nhắn. Bạn không cần
tải file về.

**2. Không repo (file lẻ):**

Agent cloud không truy cập máy bạn nên không sửa file local trực tiếp. Khi bạn
thả file code/ảnh và hỏi, agent trả code trong chat. Mỗi code block có:

- **Áp dụng**: ghi đè code mới vào tab đang mở trong code workspace
- **Mở**: mở code thành tab mới
- **Copy**: copy nhanh

Trong code workspace có nút **Tải file** để lưu file đã sửa về máy chỉ với 1 click.

### Lưu đoạn chat và code

- Mỗi đoạn chat được lưu trên trình duyệt bằng `localStorage`
- Agent ID/run của từng chat được giữ riêng để gửi follow-up đúng phiên
- Code workspace cũng lưu local; bấm **Viết code** hoặc để agent trả code block
  thì panel code sẽ tự mở
- App tự migrate state cũ để bỏ file demo `example.ts`; nếu trình duyệt vẫn hiện
  giao diện cũ, hard refresh trang hoặc xoá site data của `localhost:4173`
