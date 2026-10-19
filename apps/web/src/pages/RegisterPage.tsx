import { useState, type FormEvent } from 'react';
import { ApiError } from '../api';
import { navigate } from '../lib/router';
import { useAuth } from '../lib/auth';
import { Turnstile } from '../ui/Turnstile';
import styles from '../ui/common.module.scss';

export function RegisterPage() {
  const { register, config } = useAuth();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [displayName, setDisplayName] = useState('');
  const [inviteCode, setInviteCode] = useState('');
  const [turnstileToken, setTurnstileToken] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState<{ emailSent: boolean } | null>(null);

  if (config && config.allowRegistration === false) {
    return (
      <div className={styles.authPage}>
        <div className={styles.authCard}>
          <h1 className={styles.authTitle}>注册已关闭</h1>
          <p className={styles.authSubtitle}>当前站点已关闭自助注册，请联系管理员开通账号。</p>
          <button className={`${styles.button} ${styles.buttonBlock}`} onClick={() => navigate('/login')}>
            返回登录
          </button>
        </div>
      </div>
    );
  }

  if (done) {
    return (
      <div className={styles.authPage}>
        <div className={styles.authCard}>
          <h1 className={styles.authTitle}>注册成功</h1>
          {done.emailSent ? (
            <p className={styles.authSubtitle}>我们已向你的邮箱发送验证邮件，请查收后完成验证。</p>
          ) : (
            <p className={styles.authSubtitle}>账号已创建，可以开始使用了。</p>
          )}
          <button
            className={`${styles.button} ${styles.buttonPrimary} ${styles.buttonBlock}`}
            onClick={() => navigate('/documents')}
          >
            进入文档中心
          </button>
        </div>
      </div>
    );
  }

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    if (busy) return;
    setBusy(true);
    setError(null);
    try {
      const result = await register({
        email: email.trim(),
        password,
        displayName: displayName.trim() || undefined,
        turnstileToken: turnstileToken ?? undefined,
        inviteCode: inviteCode.trim() || undefined,
      });
      setDone({ emailSent: result.emailSent });
    } catch (caught) {
      setError(caught instanceof ApiError ? caught.message : '注册失败，请重试');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className={styles.authPage}>
      <div className={styles.authCard}>
        <h1 className={styles.authTitle}>创建账号</h1>
        <p className={styles.authSubtitle}>注册后即可在云端保存、分享你的全部文档</p>

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
            <span className={styles.label}>昵称（可选）</span>
            <input
              className={styles.input}
              maxLength={60}
              value={displayName}
              onChange={(event) => setDisplayName(event.target.value)}
            />
          </div>

          <div className={styles.field}>
            <span className={styles.label}>密码（至少 8 位）</span>
            <input
              className={styles.input}
              type="password"
              required
              minLength={8}
              autoComplete="new-password"
              value={password}
              onChange={(event) => setPassword(event.target.value)}
            />
          </div>

          {config?.inviteRequired ? (
            <div className={styles.field}>
              <span className={styles.label}>邀请码</span>
              <input
                className={styles.input}
                required
                maxLength={32}
                placeholder="请输入管理员提供的邀请码"
                value={inviteCode}
                onChange={(event) => setInviteCode(event.target.value.toUpperCase())}
              />
              <span className={styles.hint}>本站开启邀请制，需要有效邀请码才能完成注册。</span>
            </div>
          ) : null}

          <Turnstile siteKey={config?.turnstileEnabled ? config.turnstileSiteKey : null} onToken={setTurnstileToken} />

          <button
            type="submit"
            className={`${styles.button} ${styles.buttonPrimary} ${styles.buttonBlock}`}
            disabled={busy}
          >
            {busy ? '注册中…' : '注册'}
          </button>
        </form>

        <div className={styles.authFooter}>
          <a onClick={() => navigate('/login')}>已有账号？去登录</a>
        </div>
      </div>
    </div>
  );
}
