import { useState, type FormEvent } from 'react';
import { ApiError, authApi } from '../api';
import { navigate } from '../lib/router';
import { useAuth } from '../lib/auth';
import { Turnstile } from '../ui/Turnstile';
import styles from '../ui/common.module.scss';

export function ForgotPasswordPage() {
  const { config } = useAuth();
  const [email, setEmail] = useState('');
  const [turnstileToken, setTurnstileToken] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [sent, setSent] = useState(false);

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    if (busy) return;
    setBusy(true);
    setError(null);
    try {
      await authApi.forgotPassword({ email: email.trim(), turnstileToken: turnstileToken ?? undefined });
      setSent(true);
    } catch (caught) {
      setError(caught instanceof ApiError ? caught.message : '请求失败，请重试');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className={styles.authPage}>
      <div className={styles.authCard}>
        <h1 className={styles.authTitle}>找回密码</h1>
        <p className={styles.authSubtitle}>输入注册邮箱，我们会发送一个重置密码的链接</p>

        {sent ? (
          <div className={styles.success}>
            如果该邮箱已注册，重置密码邮件已发送，请查收（链接 1 小时内有效）。
          </div>
        ) : (
          <form onSubmit={submit}>
            {error ? <div className={styles.error}>{error}</div> : null}
            <div className={styles.field}>
              <span className={styles.label}>邮箱</span>
              <input
                className={styles.input}
                type="email"
                required
                autoComplete="email"
                value={email}
                onChange={(event) => setEmail(event.target.value)}
              />
            </div>
            <Turnstile siteKey={config?.turnstileEnabled ? config.turnstileSiteKey : null} onToken={setTurnstileToken} />
            <button
              type="submit"
              className={`${styles.button} ${styles.buttonPrimary} ${styles.buttonBlock}`}
              disabled={busy}
            >
              {busy ? '发送中…' : '发送重置链接'}
            </button>
          </form>
        )}

        <div className={styles.authFooter}>
          <a onClick={() => navigate('/login')}>返回登录</a>
        </div>
      </div>
    </div>
  );
}
