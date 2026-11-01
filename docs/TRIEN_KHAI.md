# Triển khai

## Yêu cầu

- Node.js >= 22.5.
- `ffmpeg` và `ffprobe` để tạo thumbnail, tối ưu ảnh và chuyển mã video.
- Một reverse proxy HTTPS (Caddy, Nginx hoặc tương đương).
- Volume bền vững cho `DATA_DIR`.
- TURN server nếu cần gọi WebRTC ổn định qua Internet.

## Chuẩn bị

```sh
cp .env.example .env
```

Sửa tối thiểu:

```dotenv
NODE_ENV=production
PORT=8080
PUBLIC_URL=https://haonline.example.com
DATA_DIR=/var/lib/haonline
WEB_DIR=/opt/haonline/dist/web
APP_SECRET=<chuoi-ngau-nhien-dai>
MAIL_DEV_MODE=false
```

Tạo secret:

```sh
node -e "console.log(require('node:crypto').randomBytes(48).toString('base64url'))"
```

Không dùng chung `APP_SECRET` giữa các môi trường.

## Cài đặt thủ công

```sh
npm ci --omit=dev
npm run web:build
npm run migrate
npm run seed
npm start
```

Ghi lại mật khẩu admin do `npm run seed` in ra, hoặc đặt `ADMIN_PASSWORD` trước khi seed. Nếu user admin đã tồn tại, seed chỉ nâng quyền và không đổi mật khẩu.

Kiểm tra:

```sh
curl -fsS http://127.0.0.1:8080/api/health
```

Kết quả mong đợi có `"status":"ok"` và `"database":"ok"`.

## Docker

```sh
cp .env.example .env
docker compose -f docker/docker-compose.yml up -d --build
docker compose -f docker/docker-compose.yml exec haonline npm run seed
```

Docker dùng volume `haonline-data` cho `/data`, chạy bằng user `node`, có healthcheck và build web bên trong image.

Sao lưu đầy đủ:

```sh
docker compose -f docker/docker-compose.yml run --rm backup
```

Lệnh trên dùng profile `tools`, tạo bản sao database và archive uploads trong volume.

## Reverse proxy

Ví dụ Caddy:

```caddyfile
haonline.example.com {
  encode zstd gzip
  reverse_proxy 127.0.0.1:8080 {
    flush_interval -1
  }
}
```

`flush_interval -1` giúp SSE `/api/stream` không bị đệm. Nếu dùng Nginx, tắt `proxy_buffering` cho route SSE và đặt `proxy_read_timeout` đủ dài.

Không mở trực tiếp cổng 8080 ra Internet nếu chưa có HTTPS và firewall.

## Dữ liệu và sao lưu

```sh
npm run backup
npm run backup -- --full
```

- Không có `--full`: chỉ sao lưu database.
- Có `--full`: thêm `uploads-<timestamp>.tar.gz`.

Bản sao lưu nằm trong `<DATA_DIR>/backups`, đồng thời được ghi vào bảng `backup_log` và audit log.

Khôi phục:

1. Dừng server.
2. Giữ bản sao lưu hiện tại để rollback.
3. Thay `haonline.db` bằng bản backup.
4. Giải nén uploads nếu có.
5. Khởi động lại và kiểm tra `/api/health`.

## Nâng cấp

```sh
npm ci --omit=dev
npm run web:build
npm run migrate
npm start
```

Luôn sao lưu trước khi nâng cấp. HAONLINE dùng migration tuần tự; không sửa file migration đã chạy.

## Giới hạn vận hành

- SQLite WAL phù hợp một tiến trình Node duy nhất. Không chạy nhiều bản sao HAONLINE ghi chung một database.
- Rate limit và SSE client đang lưu trong bộ nhớ tiến trình, không dùng chung giữa nhiều instance.
- Không đặt HAONLINE sau load balancer nhiều instance nếu chưa thay backend lưu trạng thái.
- Uploads nằm trên filesystem; cần volume dùng chung nếu chuyển sang hạ tầng khác.
- Web Push không gửi payload; service worker tự gọi API khi nhận tín hiệu.
- Cuộc gọi WebRTC cần TURN khi hai phía không kết nối trực tiếp được.

## Kiểm tra sau triển khai

- `GET /api/health` trả `ok`.
- Đăng nhập admin, đổi mật khẩu seed.
- Tạo bài viết, tải ảnh/video, kiểm tra `/uploads/...`.
- Gửi email xác minh thật nếu đã cấu hình SMTP.
- Kiểm tra SSE trên hai trình duyệt.
- Kiểm tra gọi thoại/video trong cùng mạng và qua Internet.
- Kiểm tra backup và khôi phục thử trên môi trường staging.
