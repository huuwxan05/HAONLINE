export class ApiError extends Error {
  constructor(status, code, message, details = null) {
    super(message);
    this.status = status;
    this.code = code;
    this.details = details;
  }
}

export const badRequest = (message = 'Dữ liệu không hợp lệ', details) => new ApiError(400, 'bad_request', message, details);
export const unauthorized = (message = 'Cần đăng nhập') => new ApiError(401, 'unauthorized', message);
export const forbidden = (message = 'Không có quyền thực hiện') => new ApiError(403, 'forbidden', message);
export const notFound = (message = 'Không tìm thấy') => new ApiError(404, 'not_found', message);
export const conflict = (message = 'Dữ liệu đã tồn tại') => new ApiError(409, 'conflict', message);
export const tooMany = (message = 'Quá nhiều yêu cầu, thử lại sau') => new ApiError(429, 'rate_limited', message);
