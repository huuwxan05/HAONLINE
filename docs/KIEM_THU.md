# Kiểm thử

## Tự động

```sh
npm test
npm run test:security
```

Bộ test dùng `node:test`, tạo server thật trên cổng ngẫu nhiên và thư mục dữ liệu tạm, sau đó xóa sạch. Không dùng database production.

Phạm vi hiện tại:

- Đăng ký, xác minh email, đăng nhập, logout, thu hồi phiên.
- Feed, bài viết, cảm xúc, bình luận, chia sẻ, bookmark.
- Quan hệ bạn bè, chặn, nhắn tin, quyền riêng tư.
- Nhóm, trang, sự kiện.
- Media, story, reel, video.
- Chợ, cài đặt, phân tích, kiếm tiền.
- CSP/security header, truy cập ẩn danh, JSON lỗi, SQL injection, quyền admin, backup, email outbox, maintenance, cờ tính năng, hồ sơ riêng tư, chặn DM, rate limit.
- Từ chối upload HTML/JavaScript và các MIME không nằm trong danh sách cho phép.

Kết quả gần nhất: 14 test pass.

## Kiểm tra cú pháp và build

```sh
npm run web:build
node --check desktop/main.js
python3 -c "import plistlib; plistlib.load(open('mobile/ios/HAONLINE/Info.plist','rb')); print('Info.plist OK')"
```

`npm run web:build` cũng chạy `node --check` cho toàn bộ JavaScript trong `web/`, kiểm tra tài nguyên được tham chiếu và danh sách cache service worker.

## Kiểm tra giao diện

Dùng Chromium của Hefesto:

```sh
hefesto_pagina index.html -o .hefesto/capturas/movil.png --movil
```

Với trang cần đăng nhập, chạy server tạm trên cổng riêng, đăng nhập bằng tài khoản thử, rồi chụp từng route. Không dùng tài khoản production.

Đã kiểm tra:

- 25 route mobile ở 390×844.
- 25 route desktop ở 1440×900.
- Feed, hồ sơ, bài viết, bạn bè, tin nhắn, thông báo, story, reel, video, live, nhóm, trang, sự kiện, chợ, bookmark, kỷ niệm, phân tích, kiếm tiền, cài đặt, tìm kiếm, quản trị, kiểm duyệt.
- Không có tràn ngang cấp trang.
- Các dải tab dài (cài đặt, tìm kiếm, quản trị) cuộn ngang trong khung riêng; đây là thiết kế có chủ đích.
- Danh sách hội thoại mobile từng bị ảnh đại diện 1200px đẩy nội dung ra ngoài. Đã sửa bằng kích thước avatar cố định 46×46 và `min-width: 0`; kiểm tra lại `OVF 390/390 n=0`.
- Bản thiết kế mới: hiệu ứng nền aurora, glass card, hero feed có SVG nội bộ và parallax, reveal khi cuộn, chuyển trang và artwork đăng nhập. Đã kiểm tra login/feed ở 1280×900 và 390×844, không tràn ngang (`scrollWidth = clientWidth`), console sạch.
- Nút đăng xuất có ở sidebar, topbar (chữ “Đăng xuất” trên desktop, icon trên mobile), menu “Thêm” mobile và Cài đặt → Bảo mật. Đã sửa cache cũ: static web trả `no-cache`, service worker ưu tiên mạng cho JS/CSS và tự tải lại khi có bản mới.

## Kiểm tra production

```sh
npm run web:build
WEB_DIR=./dist/web NODE_ENV=production APP_SECRET='<secret>' npm start
```

Kiểm tra:

```sh
curl -fsS http://127.0.0.1:8080/api/health
curl -fsS http://127.0.0.1:8080/api/version
curl -fsSI http://127.0.0.1:8080/
```

Kỳ vọng:

- `/api/health` trả `"status":"ok"`.
- `/` trả HTML có CSP.
- `/js/app.js` tải được.
- `/sw.js` chứa version build mới.
- Không có tài nguyên 404 trong console.

Build đã xác nhận: 28 tệp, version `haonline-3d04f2568e87`, có CSP, `Cache-Control: no-cache` cho toàn bộ static web, đăng nhập API thành công trên server production tạm. APK debug đã build thành công, ký debug và chứa URL mặc định `http://127.0.0.1:8080`.

## Kiểm thử thủ công nên làm trước phát hành

1. Đăng ký, xác minh email, đăng nhập, logout.
2. Đổi mật khẩu, bật/tắt 2FA, thu hồi phiên.
3. Đăng bài có ảnh/video, bình luận, cảm xúc, chia sẻ, bookmark.
4. Kết bạn, chấp nhận, chặn, bỏ chặn.
5. Chat cá nhân, chat nhóm, gửi tệp, đã đọc, đang nhập.
6. Gọi thoại/video trong LAN và qua Internet có TURN.
7. Story hết hạn sau 24 giờ, reel, video, live.
8. Tạo nhóm, trang, sự kiện; duyệt thành viên; đăng bài trong nhóm/trang.
9. Đăng sản phẩm, đánh dấu đã bán, báo cáo.
10. Quản trị: dashboard, sửa user, kiểm duyệt báo cáo, backup, email outbox, bảo trì.
11. Web Push trên Chrome/Edge/Firefox.
12. Cài PWA trên điện thoại, kiểm tra offline shell.
13. Khôi phục backup trên môi trường staging.

## Ghi chú

- Không chạy test trên `DATA_DIR` thật.
- Không dùng mật khẩu admin seed trong test tự động.
- `node:sqlite` là module thử nghiệm của Node 22; chạy bằng `--no-warnings` như trong `package.json`.
- Client Android/iOS/Windows cần toolchain riêng; xem [Ứng dụng client](UNG_DUNG.md).
