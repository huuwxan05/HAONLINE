# HAONLINE

Mạng xã hội độc lập gồm máy chủ Node.js, ứng dụng web PWA, ứng dụng Android, iOS và Windows dùng chung một API.

## Trạng thái

- Backend và SPA: hoàn chỉnh, có kiểm thử tự động.
- Web production: build tĩnh trong `dist/web`.
- Android, iOS, Windows: mã nguồn client hoàn chỉnh; cần toolchain tương ứng để build.
- WebRTC cần thêm TURN server khi triển khai Internet thực tế.

## Triển khai công khai

- Mã nguồn: https://github.com/huuwxan05/HAONLINE
- Deploy bằng Render Blueprint: https://render.com/deploy?repo=https://github.com/huuwxan05/HAONLINE
- Repo đã có `render.yaml` và `Dockerfile`; Render tự chạy healthcheck tại `/api/health`.
- Gói Render miễn phí dùng filesystem tạm: SQLite và uploads sẽ mất khi redeploy/restart. Muốn giữ dữ liệu, dùng gói có disk gắn vào `/data`, hoặc chạy Docker/VPS với volume `haonline-data`.
- Trước khi mở công khai thật, đổi mật khẩu admin, cấu hình `PUBLIC_URL`, SMTP và sao lưu định kỳ.

## Tính năng

- Tài khoản: đăng ký, đăng nhập, xác minh email, quên mật khẩu, OTP, 2FA TOTP, quản lý phiên.
- Bảng tin: bài viết, media, cảm xúc, bình luận, chia sẻ, bookmark, lưu niệm, tìm kiếm.
- Kết nối: bạn bè, theo dõi, chặn, gợi ý, hồ sơ cá nhân.
- Tin nhắn: chat cá nhân/nhóm, tệp, media, đã đọc, đang nhập, tìm kiếm, cuộc gọi thoại/video qua WebRTC.
- Nội dung: story 24 giờ, reel, video, live, nhóm, trang, sự kiện.
- Chợ: đăng bán, danh mục, trạng thái, báo cáo.
- Thông báo: trong ứng dụng, SSE thời gian thực, Web Push, email.
- Kiếm tiền: quảng cáo, ví, thu nhập, payout, tip, Stripe webhook tùy chọn.
- Quản trị: dashboard, người dùng, kiểm duyệt, báo cáo, audit, lỗi, job, email, backup, cấu hình.
- PWA: manifest, service worker, cài trên màn hình chính, giao diện tối/sáng, responsive.

## Kiến trúc

```text
server/src/        Express API, SQLite (node:sqlite), SSE, Web Push
web/               SPA HTML/CSS/ES modules, PWA
scripts/           build web, build Android, đóng gói Windows, mở iOS
mobile/android/    Android WebView client
mobile/ios/        iOS WKWebView client (XcodeGen)
desktop/           Electron client cho Windows
docker/            Docker Compose
data/              SQLite, uploads, backups (không commit)
dist/web/          Web build production (không commit)
```

Yêu cầu: Node.js >= 22.5.

## Chạy nhanh

```sh
npm install
cp .env.example .env
npm run migrate
npm run seed
npm run dev
```

Mở `http://localhost:8080`.

`npm run seed` tạo admin `admin@haonline.local`. Nếu không đặt `ADMIN_PASSWORD`, mật khẩu ngẫu nhiên được in ra một lần. Hãy đổi mật khẩu sau lần đăng nhập đầu tiên.

## Kiểm thử

```sh
npm test
npm run test:security
```

Bộ test dùng thư mục dữ liệu tạm, không ảnh hưởng database thật.

## Build web production

```sh
npm run web:build
WEB_DIR=./dist/web NODE_ENV=production APP_SECRET='...' npm start
```

`npm run web:build` kiểm tra tài nguyên, cú pháp JavaScript, sao chép sang `dist/web`, tính hash và cập nhật version service worker.

## Client

### Android

```sh
HAONLINE_BASE_URL=https://haonline.example.com npm run android:build
```

Cần Android SDK, platform 34, build-tools 34.0.0, Gradle 8.9+. APK debug nằm trong `mobile/android/app/build/outputs/apk/debug/`.

Mặc định debug dùng `http://127.0.0.1:8080` để chạy cùng máy chủ trên máy. Trong app, mở Cài đặt → Tài khoản → Máy chủ ứng dụng để đổi địa chỉ. HTTP chỉ được phép cho localhost; máy chủ khác phải dùng HTTPS.

### Windows

```sh
cd desktop
npm install
npm start
```

Đóng gói từ Windows, hoặc từ Linux có Wine:

```sh
npm run windows:package
```

Biến `HAONLINE_BASE_URL` đổi máy chủ đích. Mặc định của client Android là `http://127.0.0.1:8080`; Windows và iOS dùng `https://haonline.example.com` nếu không cấu hình.

### iOS

```sh
npm run ios:open
```

Cần macOS, Xcode và XcodeGen. Đặt `HAONLINE_BASE_URL` trong `mobile/ios/project.yml` hoặc cấu hình build setting. Bundle id mặc định: `com.haonline.app`.

## Tài liệu

- [Cấu hình](docs/CAU_HINH.md)
- [Triển khai](docs/TRIEN_KHAI.md)
- [API](docs/API.md)
- [Bảo mật](docs/BAO_MAT.md)
- [Kiểm thử](docs/KIEM_THU.md)
- [Ứng dụng client](docs/UNG_DUNG.md)

## Việc bắt buộc trước khi phát hành

- Đặt `APP_SECRET` dài, ngẫu nhiên và `NODE_ENV=production`.
- Đổi mật khẩu admin seed, xóa dữ liệu demo.
- Bật HTTPS ở reverse proxy.
- Cấu hình SMTP, VAPID, Stripe nếu dùng.
- Dùng volume bền vững cho `DATA_DIR`.
- Sao lưu database và uploads định kỳ.
- Cấu hình TURN server cho cuộc gọi WebRTC qua Internet.

Chi tiết trong [Bảo mật](docs/BAO_MAT.md) và [Triển khai](docs/TRIEN_KHAI.md).
