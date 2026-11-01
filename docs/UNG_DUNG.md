# Ứng dụng client

Android, iOS và Windows đều là lớp vỏ WebView/Electron quanh cùng một máy chủ HAONLINE. Không có API riêng cho từng nền tảng.

## Chọn máy chủ

Đặt URL HTTPS của máy chủ trước khi build:

```sh
export HAONLINE_BASE_URL=https://haonline.example.com
```

Client Android mặc định dùng `http://127.0.0.1:8080`; Windows và iOS mặc định dùng `https://haonline.example.com`. Phải đổi URL khi phát hành.

## Android

Yêu cầu:

- Android SDK.
- `platforms;android-34`.
- `build-tools;34.0.0`.
- Gradle 8.9+ (hoặc thêm Gradle wrapper).

Build debug:

```sh
HAONLINE_BASE_URL=https://haonline.example.com npm run android:build
```

Nếu không đặt biến, debug dùng `http://127.0.0.1:8080`. Trong app, mở Cài đặt → Tài khoản → Máy chủ ứng dụng để đổi địa chỉ mà không cần build lại. HTTP chỉ được phép cho localhost, `127.0.0.1`, `10.0.2.2`; máy chủ khác phải dùng HTTPS.

APK nằm ở:

```text
mobile/android/app/build/outputs/apk/debug/app-debug.apk
```

Ký bản phát hành bằng biến môi trường:

```sh
export HAONLINE_KEYSTORE=/duong/dan/haonline.jks
export HAONLINE_KEYSTORE_PASSWORD=...
export HAONLINE_KEY_ALIAS=haonline
export HAONLINE_KEY_PASSWORD=...
```

Sau đó build release bằng Gradle theo quy trình Android tiêu chuẩn. Không commit keystore.

Client Android hỗ trợ:

- WebView với JavaScript, DOM storage, media autoplay.
- Mở link ngoài bằng ứng dụng hệ thống.
- Chọn tệp, chụp ảnh/quay video, tải tệp qua `DownloadManager`.
- Cấp quyền camera/micro/vị trí cho origin tin cậy.
- Nút Back điều hướng trong WebView.
- Đổi địa chỉ máy chủ trong app; hiện lỗi kết nối kèm nút thử lại.
- Chỉ cho phép HTTP với localhost; chặn SSL lỗi.

Giới hạn:

- Không có push native; thông báo trong ứng dụng và Web Push PWA vẫn phụ thuộc trình duyệt/nền tảng.
- Cuộc gọi WebRTC cần HTTPS, quyền micro/camera và TURN.
- Không có deep link/universal link riêng.

## Windows

Yêu cầu: Node.js 22+, npm. Với đóng gói trên Linux: Wine.

Chạy trực tiếp:

```sh
cd desktop
npm install
HAONLINE_BASE_URL=https://haonline.example.com npm start
```

Đóng gói NSIS x64:

```sh
npm run windows:package
```

Artifact:

```text
desktop/release/HAONLINE-Setup-1.0.0.exe
```

Có thể tạo bản không cài:

```sh
cd desktop
npm run package:dir
```

Client Windows:

- Single-instance lock.
- Lưu kích thước/vị trí cửa sổ.
- Chặn điều hướng ra ngoài origin máy chủ.
- Mở `http`, `https`, `mailto`, `tel` bằng ứng dụng hệ thống.
- Trang offline có nút thử lại.
- Menu tiếng Việt, phím tắt Back/Forward, reload, zoom, devtools.

Không đóng gói kèm Chromium tùy biến; Electron đi kèm runtime của nó.

## iOS

Yêu cầu:

- macOS.
- Xcode.
- XcodeGen (`brew install xcodegen`).

Mở project:

```sh
npm run ios:open
```

Script tạo `HAONLINE.xcodeproj` từ `mobile/ios/project.yml`, sau đó mở bằng Xcode. Nếu chưa cài XcodeGen nhưng đã có project, script mở project sẵn có.

Cấu hình:

- Bundle id: `com.haonline.app`.
- Deployment target: iOS 15.
- Base URL: build setting `HAONLINE_BASE_URL`, đọc qua `Info.plist` key `HAONLINEBaseURL`.
- Code signing: automatic; cần chọn Apple Team trong Xcode trước khi chạy thiết bị thật.

Client iOS hỗ trợ:

- WKWebView, JavaScript, DOM storage.
- Chọn ảnh/video bằng PHPicker và document picker.
- Quay camera/ghi âm qua quyền hệ thống.
- Hộp thoại JS alert/confirm/prompt.
- Mở link ngoài.
- Overlay lỗi khi không tải được máy chủ.

Giới hạn:

- Chưa build/chạy thử trong môi trường Linux hiện tại; cần Xcode để xác nhận.
- Web Push trên iOS cần iOS 16.4+ và quyền người dùng; client hiện dựa vào WebView/PWA.
- Cuộc gọi WebRTC cần HTTPS, quyền và TURN.
- Chưa có native share sheet, background upload, hoặc push native.

## PWA

Web production là PWA:

- `manifest.webmanifest`.
- Service worker cache shell.
- Cài trên màn hình chính.
- Hoạt động offline ở mức shell; API cần mạng.

## Kiểm tra sau khi build client

1. Mở ứng dụng, đăng nhập.
2. Kiểm tra feed, ảnh, video.
3. Chọn và tải ảnh/video lên.
4. Gửi tin nhắn, mở cuộc gọi.
5. Mở link ngoài.
6. Kiểm tra nút Back.
7. Tắt mạng, mở lại, xem thông báo lỗi.
8. Kiểm tra kích thước cửa sổ được ghi nhớ trên Windows.
9. Kiểm tra quyền camera/micro trên thiết bị thật.
