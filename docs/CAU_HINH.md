# Cấu hình

HAONLINE đọc biến môi trường và tự nạp file `.env` ở thư mục gốc dự án. Giá trị trong `process.env` được ưu tiên hơn `.env`.

## Biến môi trường

| Biến | Mặc định | Ý nghĩa |
| --- | --- | --- |
| `NODE_ENV` | `development` | Đặt `production` khi phát hành. Production bắt buộc `APP_SECRET` mạnh. |
| `HOST` | `0.0.0.0` | Địa chỉ lắng nghe. Dùng `127.0.0.1` cho bản chạy thử trên điện thoại. |
| `PORT` | `8080` | Cổng HTTP nội bộ. |
| `PUBLIC_URL` | `http://localhost:<PORT>` | URL công khai, dùng cho link xác minh email. Phải là URL HTTPS thật khi phát hành. |
| `DATA_DIR` | `./data` | Nơi chứa SQLite, uploads và backups. Phải là volume bền vững. |
| `DB_PATH` | `<DATA_DIR>/haonline.db` | Đường dẫn database tùy chọn. |
| `WEB_DIR` | `./web` | Thư mục web tĩnh. Production dùng `./dist/web`. |
| `APP_SECRET` | Chuỗi dev | Khóa ký hash token/phiên. Bắt buộc đổi trong production. |
| `SESSION_DAYS` | `30` | Thời hạn phiên đăng nhập. |
| `MAX_UPLOAD_MB` | `200` | Giới hạn kích thước mỗi tệp tải lên. |
| `MAIL_DEV_MODE` | `true` | Trả mã xác minh trong API ở môi trường phát triển. Tắt ở production. |
| `MAIL_FROM` | `no-reply@haonline.local` | Địa chỉ gửi email. |
| `SMTP_HOST` | rỗng | Nếu rỗng, email được lưu vào `email_outbox` thay vì gửi. |
| `SMTP_PORT` | `587` | Cổng SMTP. |
| `SMTP_SECURE` | `false` | `true` cho TLS ngay từ kết nối; `false` dùng STARTTLS. |
| `SMTP_USER`, `SMTP_PASS` | rỗng | Tài khoản SMTP. |
| `VAPID_PUBLIC_KEY`, `VAPID_PRIVATE_KEY` | rỗng | Bật Web Push. Khóa private dạng base64url 32 byte. |
| `VAPID_SUBJECT` | `mailto:admin@haonline.local` | Chủ thể VAPID. |
| `STRIPE_SECRET_KEY`, `STRIPE_WEBHOOK_SECRET` | rỗng | Bật thanh toán/checkout. Không có thì monetization chạy ledger-only. |
| `PAYMENT_CURRENCY` | `USD` | Tiền tệ thanh toán. |
| `CORS_ORIGINS` | rỗng | Danh sách origin cách nhau bởi dấu phẩy. Rỗng nghĩa là cho phép mọi origin. |
| `ADMIN_EMAIL`, `ADMIN_USERNAME`, `ADMIN_PASSWORD` | `admin@haonline.local`, `admin`, ngẫu nhiên | Dùng cho `npm run seed`. |

## Cấu hình trong ứng dụng

Quản trị viên có thể sửa các khóa sau qua `PATCH /api/admin/settings`:

- `site_name`
- `registration_open`
- `maintenance_mode`
- `moderation_notice`
- `max_upload_mb`
- `feature_live`
- `feature_calls`
- `feature_marketplace`

Khi `maintenance_mode=true`, API trả `503` cho người dùng thường. Hai ngoại lệ là `/api/auth/login` và `/api/auth/me` để admin vẫn đăng nhập được.

`registration_open=false` chặn đăng ký mới. Các cờ `feature_live`, `feature_calls`, `feature_marketplace` chặn tạo mới livestream, cuộc gọi và sản phẩm chợ ở phía server; dữ liệu cũ vẫn đọc được và người bán vẫn có thể xóa sản phẩm.

## Thư mục dữ liệu

```text
data/
  haonline.db          SQLite chính (WAL)
  haonline.db-wal
  haonline.db-shm
  uploads/             ảnh, video, âm thanh, tệp
  backups/             bản sao lưu database và uploads
```

Không commit `data/` lên Git. `.gitignore` đã chặn database, uploads và backups.

## SMTP

Ví dụ:

```dotenv
NODE_ENV=production
MAIL_DEV_MODE=false
MAIL_FROM=no-reply@tenmien.vn
SMTP_HOST=smtp.tenmien.vn
SMTP_PORT=587
SMTP_SECURE=false
SMTP_USER=no-reply@tenmien.vn
SMTP_PASS=mat-khau-ung-dung
```

Nếu SMTP gửi lỗi, thư vẫn được lưu trong `email_outbox` với trạng thái `failed`. Kiểm tra trong trang quản trị hoặc `GET /api/admin/email-outbox`.

## Web Push

Điền một cặp khóa VAPID P-256. Public key dùng cho trình duyệt đăng ký, private key dùng để ký request. HAONLINE gửi push không kèm payload để tiết kiệm băng thông; service worker tự gọi `/api/notifications` khi được đánh thức.

## Thanh toán

Khi có `STRIPE_SECRET_KEY` và `STRIPE_WEBHOOK_SECRET`, cấu hình webhook Stripe trỏ tới:

```text
https://tenmien.vn/api/monetization/webhook/stripe
```

Không có Stripe, hệ thống vẫn ghi nhận quảng cáo, thu nhập, tip và payout ở dạng sổ nội bộ.

## Kiểm tra cấu hình

```sh
node -e "import('./server/src/config.js').then(({config})=>console.log({env:config.env,port:config.port,webDir:config.webDir,dataDir:config.dataDir,prod:config.isProd}))"
```

Lệnh này không in secret.
