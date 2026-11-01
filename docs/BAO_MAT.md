# Bảo mật

## Mô hình

- API dùng bearer token lưu trong `localStorage` ở web.
- Phiên lưu trong SQLite dưới dạng hash; token gốc chỉ trả một lần khi đăng nhập.
- Mật khẩu băm bằng `scrypt` với salt ngẫu nhiên.
- 2FA dùng TOTP chuẩn 30 giây, cửa sổ ±1 bước.
- Quyền được kiểm tra ở server; UI chỉ là lớp trình bày.

## Header và CSP

Mọi response có:

- `X-Content-Type-Options: nosniff`
- `Referrer-Policy: strict-origin-when-cross-origin`
- `X-Frame-Options: SAMEORIGIN`
- `Permissions-Policy` giới hạn camera, micro, vị trí.
- `X-Request-Id`

Trang web có CSP:

```text
default-src 'self';
script-src 'self';
style-src 'self' 'unsafe-inline';
img-src 'self' data: blob: https:;
media-src 'self' blob: https:;
connect-src 'self' https: wss:;
font-src 'self' data:;
frame-ancestors 'self';
base-uri 'self'
```

Không thêm inline script hoặc `onclick=` vào HTML. Dùng `addEventListener` và các module hiện có.

## XSS

- Nội dung người dùng phải đi qua `esc()` trước khi chèn vào HTML.
- URL và văn bản có link dùng `linkify()` an toàn.
- Không dùng `innerHTML` với dữ liệu chưa escape.
- CSP chặn inline script, nhưng không thay thế việc escape.

## Tải tệp lên

- Chỉ chấp nhận MIME trong danh sách: JPEG, PNG, WebP, GIF, AVIF, MP4, WebM, MOV, MKV, OGG, MP3, M4A, WAV, PDF, ZIP, text/plain.
- Phần mở rộng file được suy ra từ MIME, không lấy từ tên file người dùng. HTML, JavaScript, SVG và loại không xác định bị từ chối.
- Giới hạn dung lượng lấy từ `MAX_UPLOAD_MB` hoặc cấu hình `max_upload_mb` trong quản trị.
- Ảnh/video được xử lý bằng ffmpeg; nội dung không xử lý được vẫn có thể lưu nhưng không được phục vụ dưới dạng HTML/JS.
- Không có AV/malware scanner. Nếu cho phép tệp từ người lạ, nên quét bằng ClamAV hoặc dịch vụ ngoài trước khi phát hành.

## Xác thực và phân quyền

- `requireAuth` cho endpoint cần đăng nhập.
- `requireRole('admin')`, `requireRole('admin','moderator')` cho quản trị/kiểm duyệt.
- Kiểm tra quyền sở hữu ở từng route (bài viết, media, nhóm, trang, sự kiện, sản phẩm).
- Chặn và quyền riêng tư được kiểm tra khi đọc feed, hồ sơ, tìm kiếm và nhắn tin.
- Đăng nhập, đăng ký, OTP, quên mật khẩu có rate limit.

## Token và phiên

- Token sống mặc định 30 ngày (`SESSION_DAYS`).
- Logout thu hồi phiên hiện tại.
- Người dùng có thể xem và thu hồi từng phiên hoặc toàn bộ phiên.
- Token không được ghi log. Không đưa token vào query trừ SSE, nơi EventSource không hỗ trợ header.
- Nếu triển khai sau proxy, đặt HTTPS và không để token trong URL bị ghi ở access log. Với SSE, cấu hình proxy không log query string hoặc dùng cookie same-site nếu tự mở rộng.

## CSRF và CORS

- API xác thực bằng bearer token, không dựa vào cookie phiên, nên CSRF qua form không áp dụng trực tiếp.
- `CORS_ORIGINS` rỗng hiện cho phép mọi origin. Production nên đặt danh sách chính xác:

```dotenv
CORS_ORIGINS=https://haonline.example.com
```

- Không dùng `*` nếu API có thể truy cập từ trình duyệt của người khác.

## Rate limit

Rate limit lưu trong bộ nhớ tiến trình:

- Auth: 30 request/10 phút/IP.
- Báo cáo và một số route có giới hạn riêng.
- Header `X-RateLimit-Limit`, `X-RateLimit-Remaining`, `Retry-After`.

Giới hạn reset khi restart và không dùng chung giữa nhiều instance. Với cụm nhiều máy, thay bằng Redis hoặc gateway rate limit.

## Bảo trì và vận hành

- `maintenance_mode` chặn người dùng thường nhưng cho admin vào.
- Audit log ghi thao tác quản trị.
- Error log lưu lỗi 5xx kèm request id, không trả stack trace cho client ở production.
- Backup chứa toàn bộ dữ liệu và có thể chứa thông tin cá nhân; bảo vệ quyền truy cập thư mục backup.

## Checklist production

- [ ] `NODE_ENV=production`
- [ ] `APP_SECRET` ngẫu nhiên, đủ dài, không nằm trong Git
- [ ] HTTPS bắt buộc, HSTS ở reverse proxy
- [ ] `CORS_ORIGINS` giới hạn đúng domain
- [ ] `MAIL_DEV_MODE=false` và SMTP thật
- [ ] Đổi mật khẩu admin seed
- [ ] Xóa dữ liệu demo và database thử nghiệm
- [ ] Giới hạn quyền đọc `DATA_DIR`
- [ ] Backup định kỳ và thử khôi phục
- [ ] TURN server có xác thực cho WebRTC
- [ ] Quét malware cho upload nếu cần
- [ ] Theo dõi log lỗi, audit, email outbox

## Rủi ro còn lại

- Token trong `localStorage` có thể bị đọc nếu có XSS. Phòng thủ chính là escape và CSP.
- WebRTC dùng STUN công khai; IP có thể lộ với peer trong cuộc gọi. Dùng TURN để che IP khi cần.
- Không có giới hạn tần suất phân tán.
- Không có mã hóa database at-rest; dùng mã hóa ổ đĩa của máy chủ.
- Không có AV scanner cho tệp tải lên.
