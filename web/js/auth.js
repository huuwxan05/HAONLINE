import { api, setToken, loadMe, ApiError } from './api.js';
import { icon, esc, toast, spinner } from './ui.js';

const state = { mode: 'login', totp: false, resetToken: '', devCode: '' };

export function renderAuth(onAuthenticated) {
  const params = new URLSearchParams(location.search);
  if (params.get('reset')) { state.mode = 'reset'; state.resetToken = params.get('reset'); }
  if (params.get('verify')) state.mode = 'verify';

  document.body.innerHTML = `
  <div class="auth-wrap">
    <div class="auth-art">
      <div class="auth-art-glow"></div>
      <img class="auth-artwork" src="/assets/auth-visual.svg" alt="" aria-hidden="true" decoding="async">
      <div class="row auth-brand"><span class="brand-mark">H</span><div><div class="brand-name"><span>HAONLINE</span></div><div class="brand-sub">Social ecosystem</div></div></div>
      <div class="auth-art-copy">
        <h1 class="auth-headline">Kết nối <span>mọi người</span>,<br>kiến tạo cộng đồng.</h1>
        <p class="auth-copy">Mạng xã hội trọn vẹn: bảng tin, tin 24 giờ, reel, video, gọi điện, nhóm, trang, sự kiện, chợ và livestream — tất cả trong một nền tảng.</p>
        <div class="auth-signals">
          <span class="auth-signal"><i class="signal-dot"></i> Cộng đồng đang trực tuyến</span>
          <span class="auth-signal">${icon('sparkles', 14)} Trải nghiệm mượt mà</span>
        </div>
        <div class="auth-feats">
          <div class="auth-feat"><span class="auth-feat-icon">${icon('users', 17)}</span> Bạn bè, theo dõi và cộng đồng riêng tư</div>
          <div class="auth-feat"><span class="auth-feat-icon">${icon('message', 17)}</span> Nhắn tin, gọi thoại và video thời gian thực</div>
          <div class="auth-feat"><span class="auth-feat-icon">${icon('video', 17)}</span> Reels, video và livestream tương tác</div>
          <div class="auth-feat"><span class="auth-feat-icon">${icon('shield', 17)}</span> Quyền riêng tư, 2FA và kiểm duyệt minh bạch</div>
        </div>
      </div>
      <div class="auth-art-foot">HAONLINE · Nền tảng xã hội thế hệ mới</div>
    </div>
    <div class="auth-panel">
      <div class="auth-card">
        <div id="auth-content"></div>
      </div>
    </div>
  </div>`;

  const content = document.getElementById('auth-content');
  const draw = () => {
    content.innerHTML = view();
    bind();
  };
  const done = async (token, profile = null) => {
    setToken(token);
    if (profile) {
      const { auth } = await import('./api.js');
      auth.user = profile;
    }
    const data = await loadMe();
    toast(`Chào mừng ${data.user.display_name}!`, 'success');
    onAuthenticated();
  };

  function view() {
    if (state.mode === 'login') {
      return `
        <h1>Đăng nhập</h1>
        <p class="sub">Chào mừng trở lại HAONLINE.</p>
        <form id="auth-form">
          <div class="field"><label>Email</label><input class="input" type="email" name="email" required autocomplete="email" placeholder="ban@example.com"></div>
          <div class="field"><label>Mật khẩu</label><input class="input" type="password" name="password" required minlength="8" autocomplete="current-password" placeholder="••••••••"></div>
          ${state.totp ? `<div class="field"><label>Mã xác thực 2 lớp</label><input class="input" name="totp" inputmode="numeric" autocomplete="one-time-code" placeholder="123456" maxlength="6"></div>` : ''}
          <div class="row-between mb"><span></span><button type="button" class="link" data-mode="forgot" style="border:0;background:none">Quên mật khẩu?</button></div>
          <button class="btn btn-primary btn-block btn-lg" type="submit">Đăng nhập</button>
        </form>
        <div class="or-line">hoặc</div>
        <button class="btn btn-ghost btn-block" data-mode="otp">${icon('lock', 16)} Đăng nhập bằng mã OTP</button>
        <p class="auth-foot">Chưa có tài khoản? <button class="link" data-mode="register" style="border:0;background:none">Tạo tài khoản</button></p>`;
    }
    if (state.mode === 'register') {
      return `
        <h1>Tạo tài khoản</h1>
        <p class="sub">Bắt đầu hành trình của bạn trên HAONLINE.</p>
        <form id="auth-form">
          <div class="field"><label>Họ và tên</label><input class="input" name="display_name" required maxlength="80" placeholder="Nguyễn Văn A"></div>
          <div class="field"><label>Username</label><input class="input" name="username" required pattern="[a-z0-9._]{3,32}" placeholder="nguyenvana"><div class="hint">3–32 ký tự: chữ thường, số, chấm, gạch dưới.</div></div>
          <div class="field"><label>Email</label><input class="input" type="email" name="email" required autocomplete="email" placeholder="ban@example.com"></div>
          <div class="field"><label>Mật khẩu</label><input class="input" type="password" name="password" required minlength="8" autocomplete="new-password" placeholder="Ít nhất 8 ký tự"><div class="hint">Nên có chữ hoa, số và ký tự đặc biệt.</div></div>
          <label class="check mb"><input type="checkbox" required> Tôi đồng ý với quy định cộng đồng và chính sách riêng tư.</label>
          <button class="btn btn-primary btn-block btn-lg" type="submit">Tạo tài khoản</button>
        </form>
        <p class="auth-foot">Đã có tài khoản? <button class="link" data-mode="login" style="border:0;background:none">Đăng nhập</button></p>`;
    }
    if (state.mode === 'otp') {
      return `
        <h1>Đăng nhập bằng OTP</h1>
        <p class="sub">Chúng tôi gửi mã 6 số tới email của bạn.</p>
        <form id="otp-request-form">
          <div class="field"><label>Email</label><input class="input" type="email" name="email" required autocomplete="email"></div>
          <button class="btn btn-primary btn-block" type="submit">Gửi mã OTP</button>
        </form>
        ${state.devCode ? `<div class="demo-note">Mã OTP (chế độ phát triển): <b>${esc(state.devCode)}</b></div>` : ''}
        <form id="otp-verify-form" class="mt">
          <div class="field"><label>Mã OTP</label><input class="input" name="code" inputmode="numeric" maxlength="6" placeholder="123456"></div>
          <button class="btn btn-ghost btn-block" type="submit">Xác nhận và đăng nhập</button>
        </form>
        <p class="auth-foot"><button class="link" data-mode="login" style="border:0;background:none">Quay lại đăng nhập</button></p>`;
    }
    if (state.mode === 'forgot') {
      return `
        <h1>Khôi phục mật khẩu</h1>
        <p class="sub">Nhập email để nhận liên kết đặt lại mật khẩu.</p>
        <form id="forgot-form">
          <div class="field"><label>Email</label><input class="input" type="email" name="email" required autocomplete="email"></div>
          <button class="btn btn-primary btn-block" type="submit">Gửi liên kết</button>
        </form>
        ${state.devCode ? `<div class="demo-note">Liên kết phát triển: <a class="link" href="?reset=${esc(state.devCode)}">Đặt lại mật khẩu ngay</a></div>` : ''}
        <p class="auth-foot"><button class="link" data-mode="login" style="border:0;background:none">Quay lại đăng nhập</button></p>`;
    }
    if (state.mode === 'reset') {
      return `
        <h1>Đặt mật khẩu mới</h1>
        <p class="sub">Chọn mật khẩu mạnh mà bạn chưa từng dùng.</p>
        <form id="reset-form">
          <div class="field"><label>Mật khẩu mới</label><input class="input" type="password" name="password" required minlength="8" autocomplete="new-password"></div>
          <button class="btn btn-primary btn-block" type="submit">Cập nhật mật khẩu</button>
        </form>`;
    }
    if (state.mode === 'verify') {
      return `
        <h1>Xác minh email</h1>
        <p class="sub">Nhập mã 6 số đã gửi tới email của bạn.</p>
        <form id="verify-form">
          <div class="field"><label>Email</label><input class="input" type="email" name="email" required autocomplete="email"></div>
          <div class="field"><label>Mã xác minh</label><input class="input" name="code" inputmode="numeric" maxlength="6" required></div>
          <button class="btn btn-primary btn-block" type="submit">Xác minh email</button>
        </form>
        <p class="auth-foot"><button class="link" data-mode="login" style="border:0;background:none">Về trang đăng nhập</button></p>`;
    }
    return '';
  }

  function bind() {
    content.querySelectorAll('[data-mode]').forEach((btn) => {
      btn.onclick = () => { state.mode = btn.dataset.mode; state.totp = false; state.devCode = ''; draw(); };
    });
    const form = content.querySelector('#auth-form');
    if (form) {
      form.onsubmit = async (e) => {
        e.preventDefault();
        const btn = form.querySelector('button[type=submit]');
        btn.disabled = true;
        btn.innerHTML = spinner('Đang xử lý…');
        const values = Object.fromEntries(new FormData(form));
        try {
          if (state.mode === 'login') {
            const data = await api.post('/api/auth/login', values);
            await done(data.token, data.user);
          } else if (state.mode === 'register') {
            const data = await api.post('/api/auth/register', { ...values, device: 'web' });
            if (data.verification?.code) state.devCode = data.verification.code;
            if (data.verification?.code) toast(`Mã xác minh email (dev): ${data.verification.code}`, 'info', 8000);
            await done(data.token, data.user);
          }
        } catch (err) {
          if (err instanceof ApiError && err.code === 'twofa_required') {
            state.totp = true;
            draw();
            toast('Nhập mã xác thực 2 lớp để tiếp tục', 'info');
          } else {
            toast(err.message, 'error');
            btn.disabled = false;
            btn.textContent = state.mode === 'login' ? 'Đăng nhập' : 'Tạo tài khoản';
          }
        }
      };
    }

    const otpRequest = content.querySelector('#otp-request-form');
    if (otpRequest) {
      otpRequest.onsubmit = async (e) => {
        e.preventDefault();
        const email = otpRequest.email.value;
        try {
          const data = await api.post('/api/auth/otp/request', { email, purpose: 'login' });
          localStorage.setItem('haonline.otp.email', email);
          if (data.dev_code) { state.devCode = data.dev_code; }
          toast(data.sent ? 'Đã gửi mã OTP' : 'Nếu email tồn tại, mã đã được gửi', 'success');
          draw();
        } catch (err) { toast(err.message, 'error'); }
      };
    }
    const otpVerify = content.querySelector('#otp-verify-form');
    if (otpVerify) {
      otpVerify.onsubmit = async (e) => {
        e.preventDefault();
        const email = localStorage.getItem('haonline.otp.email') || '';
        if (!email) { toast('Hãy gửi mã OTP trước', 'error'); return; }
        try {
          const data = await api.post('/api/auth/otp/verify', { email, code: otpVerify.code.value, purpose: 'login' });
          localStorage.removeItem('haonline.otp.email');
          await done(data.token, data.user);
        } catch (err) { toast(err.message, 'error'); }
      };
    }

    const forgot = content.querySelector('#forgot-form');
    if (forgot) {
      forgot.onsubmit = async (e) => {
        e.preventDefault();
        try {
          const data = await api.post('/api/auth/password/forgot', { email: forgot.email.value });
          state.devCode = data.dev_token || '';
          toast('Nếu email tồn tại, liên kết đã được gửi', 'success');
          draw();
        } catch (err) { toast(err.message, 'error'); }
      };
    }

    const reset = content.querySelector('#reset-form');
    if (reset) {
      reset.onsubmit = async (e) => {
        e.preventDefault();
        try {
          await api.post('/api/auth/password/reset', { token: state.resetToken, password: reset.password.value });
          toast('Đã đặt lại mật khẩu. Hãy đăng nhập.', 'success');
          history.replaceState(null, '', location.pathname);
          state.mode = 'login';
          draw();
        } catch (err) { toast(err.message, 'error'); }
      };
    }

    const verify = content.querySelector('#verify-form');
    if (verify) {
      verify.onsubmit = async (e) => {
        e.preventDefault();
        try {
          await api.post('/api/auth/email/verify', { email: verify.email.value, code: verify.code.value });
          toast('Email đã được xác minh', 'success');
          state.mode = 'login';
          draw();
        } catch (err) { toast(err.message, 'error'); }
      };
    }
  }

  draw();
}
