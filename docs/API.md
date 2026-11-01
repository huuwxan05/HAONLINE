# API

Base URL: `https://haonline.example.com/api`.

Mọi response là JSON, trừ media tĩnh, SSE và tải tệp. Lỗi dùng cấu trúc:

```json
{
  "error": {
    "code": "forbidden",
    "message": "Bạn không có quyền thực hiện thao tác này",
    "details": null,
    "request_id": "..."
  }
}
```

Header `X-Request-Id` có trong mọi response và dùng để đối chiếu log.

## Xác thực

Đăng nhập:

```http
POST /api/auth/login
Content-Type: application/json

{"email":"an@example.com","password":"MatKhau123"}
```

Response:

```json
{"user":{"id":"...","username":"an","display_name":"An"},"token":"...","expires_at":"..."}
```

Gửi token:

```http
Authorization: Bearer <token>
```

Có thể dùng `X-Session-Token`. SSE dùng query vì EventSource không gửi header tùy ý:

```text
GET /api/stream?token=<token>
```

Các endpoint xác thực khác:

| Method | Đường dẫn | Ghi chú |
| --- | --- | --- |
| POST | `/auth/register` | Tạo tài khoản, trả token và mã xác minh trong dev. |
| POST | `/auth/logout` | Thu hồi phiên hiện tại. |
| GET | `/auth/me` | User, privacy và settings. |
| POST | `/auth/email/verify` | Nhận `token` hoặc `code` + `email`. |
| POST | `/auth/email/resend` | Gửi lại mã xác minh. |
| POST | `/auth/otp/request`, `/auth/otp/verify` | OTP đăng nhập. |
| POST | `/auth/password/forgot`, `/auth/password/reset` | Khôi phục mật khẩu. |
| GET | `/auth/check-username?username=` | Kiểm tra username. |

## Phân trang

Các endpoint danh sách nhận `limit` (1–100, mặc định 20) và `offset` (mặc định 0). Response thường có `items`, `total`, `limit`, `offset`.

## Người dùng và quan hệ

| Nhóm | Endpoint chính |
| --- | --- |
| Hồ sơ | `GET /users/:idOrUsername`, `PATCH /users/me` |
| Gợi ý | `GET /users/suggestions` |
| Bạn bè | `GET /friends`, `GET /friends/requests`, `POST /friends/requests/:userId`, `POST /friends/requests/:userId/accept`, `POST /friends/requests/:userId/decline`, `DELETE /friends/:userId` |
| Theo dõi | `POST /follows/:userId`, `DELETE /follows/:userId`, `GET /users/:id/followers`, `GET /users/:id/following` |
| Chặn | `GET /blocks`, `POST /blocks/:userId`, `DELETE /blocks/:userId` |

## Bảng tin

| Method | Đường dẫn | Ghi chú |
| --- | --- | --- |
| GET | `/feed` | `limit`, `offset`, `author`, `group_id`, `page_id`, `scope=friends|following`, `q`. |
| POST | `/posts` | `body`, `media[]`, `visibility`, `group_id`, `page_id`, `shared_post_id`, `feeling`, `location`. |
| GET | `/posts/:id` | Chi tiết bài viết. |
| PATCH | `/posts/:id` | Sửa bài viết của mình. |
| DELETE | `/posts/:id` | Xóa mềm. |
| POST | `/posts/:id/react` | `kind`: `like`, `love`, `haha`, `wow`, `sad`, `angry`. |
| GET | `/posts/:id/comments` | Danh sách bình luận. |
| POST | `/posts/:id/comments` | `body`, `parent_id`, `media[]`. |
| DELETE | `/comments/:id` | Xóa bình luận. |
| POST | `/posts/:id/share` | Chia sẻ bài viết. |
| GET | `/feed/sponsored` | Quảng cáo đang hoạt động. |

Ví dụ tạo bài viết:

```json
{
  "body": "Xin chào HAONLINE",
  "visibility": "public",
  "media": [
    {"kind":"image","url":"/uploads/abc.jpg","thumb_url":"/uploads/abc-thumb.jpg","width":1600,"height":900}
  ]
}
```

## Media

Tải tệp lên bằng body nhị phân:

```http
POST /api/media
Authorization: Bearer <token>
Content-Type: image/jpeg
X-Filename: photo.jpg

<binary>
```

Có thể thêm `?kind=image&mime=image/jpeg`. Response có `media.id`, `kind`, `url`, `thumb_url`, `width`, `height`, `duration`, `size`.

MIME được chấp nhận: JPEG, PNG, WebP, GIF, AVIF, MP4, WebM, MOV, MKV, OGG, MP3, M4A, WAV, PDF, ZIP, text/plain. Loại khác trả `400`.

`GET /api/media/limits` trả giới hạn dung lượng và MIME được chấp nhận.

Story, reel, video, live dùng URL media đã tải:

| Nhóm | Endpoint chính |
| --- | --- |
| Story | `POST /stories`, `GET /stories/feed`, `GET /stories/:id`, `POST /stories/:id/view`, `DELETE /stories/:id` |
| Reel | `GET /reels`, `POST /reels`, `POST /reels/:id/view`, `DELETE /reels/:id` |
| Video | `GET /videos`, `GET /videos/:id`, `POST /videos`, `PATCH /videos/:id`, `DELETE /videos/:id`, `POST /videos/:id/view` |
| Live | `GET /live`, `GET /live/:id`, `POST /live`, `POST /live/:id/end`, `POST /live/:id/join`, `POST /live/:id/leave`, `GET/POST /live/:id/comments`, `POST/GET /live/:id/signal(s)` |

## Tin nhắn và cuộc gọi

| Nhóm | Endpoint chính |
| --- | --- |
| Hội thoại | `GET /conversations`, `POST /conversations`, `GET /conversations/:id`, `PATCH /conversations/:id` |
| Thành viên | `POST /conversations/:id/members`, `DELETE /conversations/:id/members/:userId` |
| Tin nhắn | `GET /conversations/:id/messages`, `POST /conversations/:id/messages`, `DELETE /messages/:id`, `GET /messages/search` |
| Trạng thái | `POST /conversations/:id/read`, `POST /conversations/:id/typing` |
| Cuộc gọi | `GET /calls/history`, `POST /calls`, `GET /calls/:id`, `POST /calls/:id/answer`, `POST /calls/:id/signal`, `GET /calls/:id/signals`, `POST /calls/:id/end` |

Cuộc gọi dùng signaling qua API và SSE. Client tự tạo RTCPeerConnection; STUN công khai có sẵn, TURN phải cấu hình riêng cho môi trường thật.

## Cộng đồng, trang, sự kiện

| Nhóm | Endpoint chính |
| --- | --- |
| Nhóm | `GET/POST /groups`, `GET/PATCH/DELETE /groups/:id`, `GET /groups/:id/members`, `POST /groups/:id/join`, `POST /groups/:id/leave` |
| Duyệt thành viên | `POST /groups/:id/members/:userId/approve`, `/reject`, `PATCH`/`DELETE` vai trò |
| Trang | `GET/POST /pages`, `GET/PATCH/DELETE /pages/:id`, `POST/DELETE /pages/:id/follow`, `GET /pages/:id/followers`, `POST/DELETE /pages/:id/roles`, `GET /pages/:id/analytics` |
| Sự kiện | `GET/POST /events`, `GET/PATCH/DELETE /events/:id`, `POST /events/:id/invite`, `POST /events/:id/attend`, `GET /events/:id/attendees` |

## Thông báo, hiện diện, tìm kiếm

| Method | Đường dẫn | Ghi chú |
| --- | --- | --- |
| GET | `/notifications` | `unread=true`, `kind`, phân trang. |
| POST | `/notifications/:id/read` | Đánh dấu đã đọc. |
| POST | `/notifications/read-all` | Đọc tất cả. |
| DELETE | `/notifications/:id` | Xóa thông báo. |
| GET/POST/DELETE | `/notifications/push/...` | Trạng thái và đăng ký Web Push. |
| GET | `/presence` | Trạng thái online. |
| POST | `/presence/ping` | Cập nhật hiện diện. |
| GET | `/stream?token=` | SSE sự kiện thời gian thực. |
| GET | `/search?q=&type=` | `type`: `all`, `users`, `posts`, `groups`, `pages`, `events`, `products`. |
| GET | `/search/suggestions?q=` | Gợi ý tìm kiếm. |

## Chợ

`GET /marketplace/products`, `GET /marketplace/products/:id`, `POST /marketplace/products`, `PATCH /marketplace/products/:id`, `POST /marketplace/products/:id/sold`, `DELETE /marketplace/products/:id`, `POST /marketplace/products/:id/report`, `GET /marketplace/categories`.

## Tài khoản, quyền riêng tư, bảo mật

| Nhóm | Endpoint chính |
| --- | --- |
| Bookmark | `GET/POST /bookmarks`, `DELETE /bookmarks/:type/:id` |
| Kỷ niệm | `GET /memories` |
| Quyền riêng tư | `GET/PATCH /privacy`, `POST /privacy/export`, `GET /privacy/export/:jobId`, `POST /privacy/delete-account` |
| Phiên | `GET /security/sessions`, `DELETE /security/sessions/:id`, `POST /security/sessions/revoke-all` |
| Đăng nhập | `GET /security/login-history` |
| Mật khẩu | `POST /security/password` |
| 2FA | `GET /security/2fa`, `POST /security/2fa/setup`, `POST /security/2fa/enable`, `POST /security/2fa/disable` |
| Cài đặt | `GET/PATCH /settings` |

## Kiếm tiền

`GET /monetization/status`, `GET/POST /monetization/ads`, `PATCH /monetization/ads/:id`, `POST /monetization/ads/:id/pause`, `POST /monetization/ads/:id/activate`, `GET /monetization/ads/serve`, `POST /monetization/ads/:id/click`, `POST /monetization/ads/:id/checkout`, `GET /monetization/earnings`, `POST /monetization/earnings/request-payout`, `GET /monetization/payouts`, `PATCH /monetization/payouts/:id`, `GET /monetization/transactions`, `POST /monetization/tips`.

Webhook Stripe: `POST /api/monetization/webhook/stripe`.

## Kiểm duyệt và quản trị

| Nhóm | Endpoint chính |
| --- | --- |
| Báo cáo | `POST /reports`, `GET /moderation/reports`, `GET/PATCH /moderation/reports/:id`, `GET /moderation/actions`, `GET /moderation/overview` |
| Xóa nội dung | `POST /moderation/content/:type/:id/remove` |
| Dashboard | `GET /admin/dashboard`, `GET /admin/analytics`, `GET /admin/health` |
| Người dùng | `GET /admin/users`, `PATCH /admin/users/:id` |
| Vận hành | `GET /admin/audit`, `GET/DELETE /admin/errors`, `GET /admin/jobs`, `GET /admin/email-outbox`, `GET/POST /admin/backups`, `GET/PATCH /admin/settings` |
| Tín dụng | `POST /admin/monetization/credit` |

Các endpoint `/moderation/*` cần role `admin` hoặc `moderator`; phần lớn `/admin/*` cần `admin`, một số dashboard cho phép `moderator`.

## Health

```text
GET /api/health
GET /api/version
```

`/api/health` kiểm tra `PRAGMA integrity_check`, uptime và phiên bản. Không cần token.

## Giới hạn

- JSON body tối đa 2 MB.
- Media tối đa theo `MAX_UPLOAD_MB`, mỗi bài viết tối đa 10 tệp.
- Auth bị rate limit 30 request/10 phút/IP.
- Các API khác có rate limit theo từng route.
- Token phiên mặc định 30 ngày; thu hồi bằng logout hoặc quản lý phiên.
