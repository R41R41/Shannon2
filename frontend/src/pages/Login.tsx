import React, { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import styles from './Login.module.scss';

const Login: React.FC = () => {
  const [password, setPassword] = useState('');
  const navigate = useNavigate();

  useEffect(() => {
    // localhostまたは127.0.0.1からのアクセスの場合は自動ログイン
    if (
      window.location.hostname === 'localhost' ||
      window.location.hostname === '127.0.0.1'
    ) {
      localStorage.setItem('isAuthenticated', 'true');
      navigate('/shannonUI');
    }
  }, [navigate]);

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (password === import.meta.env.VITE_APP_PASSWORD) {
      localStorage.setItem('isAuthenticated', 'true');
      navigate('/shannonUI');
    } else {
      alert('パスワードが違います');
    }
  };

  // localhostの場合はローディング表示
  if (
    window.location.hostname === 'localhost' ||
    window.location.hostname === '127.0.0.1'
  ) {
    return <div className={styles.loading}>Redirecting...</div>;
  }

  return (
    <div className={styles.container}>
      <form onSubmit={handleSubmit} className={styles.form}>
        <h1>ShannonUI</h1>
        <input
          type="password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          placeholder="パスワードを入力"
          className={styles.input}
        />
        <button type="submit" className={styles.button}>
          ログイン
        </button>
      </form>
    </div>
  );
};

export default Login;
