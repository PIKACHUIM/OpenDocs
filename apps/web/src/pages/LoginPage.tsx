import { useState, type FormEvent } from 'react';
import { ApiError } from '../api';
import { getRedirectTarget, navigate } from '../lib/router';
import { useAuth } from '../lib/auth';
import { Turnstile } from '../ui/Turnstile';
import styles from '../ui/common.module.scss';

export function LoginPage() {
  const { login, config } = useAuth();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [turnstileToken, setTurnstileToken] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    if (busy) return;
    setBusy(true);
    setError(null);
    try {
      await login(email.trim(), password, turnstileToken ?? undefined);
      // 若是因为访问受保护页面被弹到登录页，登录后回到原来那个页面
      navigate(getRedirectTarget() ?? '/');
    } catch (caught) {
      setError(caught instanceof ApiError ? caught.message : '登录失败，请重试');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className={styles.authPage}>
      <div className={styles.authCard}>
        <h1 className={styles.authTitle}>{config?.siteName ?? 'OpenDocs'}</h1>
        <p className={styles.authSubtitle}>登录以管理你的云端文档</p>

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

          <div className={styles.field}>
            <span className={styles.label}>密码</span>
            <input
              className={styles.input}
              type="password"
              required
              autoComplete="current-password"
              value={password}
              onChange={(event) => setPassword(event.target.value)}
            />
          </div>

          <Turnstile siteKey={config?.turnstileEnabled ? config.turnstileSiteKey : null} onToken={setTurnstileToken} />

          <button
            type="submit"
            className={`${styles.button} ${styles.buttonPrimary} ${styles.buttonBlock}`}
            disabled={busy}
          >
            {busy ? '登录中…' : '登录'}
          </button>
        </form>

        <div className={styles.authFooter}>
          <a onClick={() => navigate('/forgot-password')}>忘记密码？</a>
          <span style={{ margin: '0 8px' }}>·</span>
          {config?.allowRegistration === false ? (
            <span>当前已关闭注册</span>
          ) : (
            <a onClick={() => navigate('/register')}>还没有账号？去注册</a>
          )}
        </div>
      </div>
    </div>
  );
}
