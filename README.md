# Bạn Viết — Học viết văn tả người lớp 5

Ứng dụng web hỗ trợ học sinh lớp 5 tự quan sát, lập dàn ý, tự viết, tự sửa và chia sẻ bài văn tả người theo quy trình 5 bước, kết hợp chế độ **AI khi còn lượt, kho từ khi hết lượt**, cổng giáo viên và chuẩn **LTI 1.3** kết nối với OPEN-EDU.

## Yêu cầu hệ thống

- **Node.js** `>= 20`
- **PostgreSQL** đã có sẵn schema `banviet`

## Chạy cục bộ (Development)

```bash
npm install
npm run dev
```

Máy chủ mặc định chạy ở `http://localhost:3000`.

## Triển khai trên Render (Node Web Service)

Cấu hình Web Service trên Render như sau:

- **Runtime:** Node (`>= 20`)
- **Build Command:** `npm install && npm run build`
- **Start Command:** `npm start`
- **Health Check Path:** `/healthz` (trả về HTTP `200` với nội dung `ok`, không truy vấn cơ sở dữ liệu)

Khi `NODE_ENV=production` (được đặt sẵn trong `npm start`), máy chủ Express chạy bản đã biên dịch tại `dist-server/server.mjs`, lắng nghe trên `0.0.0.0:$PORT` (mặc định `3000` nếu không có `PORT`) và phục vụ trực tiếp tệp giao diện đã build trong thư mục `dist/`.

## Danh sách biến môi trường cần đặt khi triển khai

Đặt các biến sau trong mục **Environment** trên Render (tuyệt đối không đưa tệp `.env` hoặc khóa bí mật lên GitHub):

### 1. Bắt buộc cho ứng dụng chính

| Biến môi trường | Mô tả |
| --- | --- |
| `NODE_ENV` | Đặt `production` khi chạy trên Render. |
| `APP_ENV` | Đặt `production` để bật header bảo mật `Content-Security-Policy: frame-ancestors` chỉ cho các origin OPEN-EDU. Để trống nếu chạy thử nghiệm. |
| `APP_URL` | Địa chỉ công khai của ứng dụng trên Render (ví dụ địa chỉ `https://...onrender.com`). |
| `DATABASE_URL` | Chuỗi kết nối PostgreSQL transaction pooler dùng cho schema `banviet`. |
| `SESSION_SECRET` | Chuỗi bí mật ngẫu nhiên (tối thiểu 16 ký tự) dùng ký phiên đăng nhập Bearer 8 giờ. |
| `PORT` | Cổng HTTP do Render tự cấp (nếu bỏ trống máy chủ tự dùng `3000`). |

### 2. Trí tuệ nhân tạo (khuyến nghị cấu hình ít nhất một khóa; thiếu cả hai app vẫn chạy bình thường với kho từ có sẵn)

| Biến môi trường | Mô tả |
| --- | --- |
| `OPENROUTER_API_KEY` | Khóa API OpenRouter (được ưu tiên dùng trước nếu có; tự kiểm tra hạn mức mỗi 5 phút và giữ 5 lượt dự phòng cho Bước 4 “Đọc giúp”). |
| `OPENROUTER_MODEL` | *(Tùy chọn)* Tên model trên OpenRouter (nếu bỏ trống sẽ dùng model mặc định của ứng dụng). |
| `GEMINI_API_KEY` | Khóa Google Gemini API (được dùng khi không cấu hình `OPENROUTER_API_KEY`). |

### 3. Đăng nhập Google cho giáo viên *(tùy chọn — nếu thiếu chỉ ẩn nút Google, học sinh vẫn đăng nhập bình thường)*

| Biến môi trường | Mô tả |
| --- | --- |
| `GOOGLE_CLIENT_ID` | OAuth 2.0 Client ID của Google Cloud. |
| `GOOGLE_CLIENT_SECRET` | OAuth 2.0 Client Secret của Google Cloud. |

### 4. Kết nối LTI 1.3 với OPEN-EDU *(tùy chọn — nếu thiếu chỉ tắt phần LTI, chế độ độc lập vẫn chạy)*

| Biến môi trường | Mô tả |
| --- | --- |
| `LTI_ISSUER` | Địa chỉ Issuer của nền tảng OPEN-EDU (dùng kiểm tra JWT, JWKS và token). |
| `OPENEDU_WEB_ORIGIN` | Origin trang học sinh OPEN-EDU (dùng cho OIDC `/lti/auth`, `frame-ancestors` và `postMessage`). |
| `OPENEDU_TEACHER_ORIGIN` | Origin cổng giáo viên OPEN-EDU (dùng cho `frame-ancestors` và `postMessage`). |
| `LTI_CLIENT_ID` | Client ID do OPEN-EDU cấp cho Bạn Viết. |
| `LTI_DEPLOYMENT_ID` | Deployment ID của ứng dụng trên OPEN-EDU. |
| `TOOL_PRIVATE_JWK` | Khóa bí mật RSA dạng JSON (JWK) dùng ký JWT khi gửi điểm AGS và sự kiện xAPI. |
