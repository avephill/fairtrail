'use client';

import { useState } from 'react';
import styles from './page.module.css';

export default function GatePage() {
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    setError('');

    const res = await fetch('/api/gate/auth', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ password }),
    });

    if (res.ok) {
      window.location.href = '/';
    } else {
      setError('Invalid password');
      setLoading(false);
    }
  };

  return (
    <main className={styles.root}>
      <form className={styles.form} onSubmit={handleSubmit}>
        <h1 className={styles.title}>Fairtrail</h1>
        <p className={styles.subtitle}>This site is password-protected</p>
        <input
          type="password"
          className={styles.input}
          placeholder="Password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          autoFocus
        />
        {error && <p className={styles.error}>{error}</p>}
        <button className={styles.button} type="submit" disabled={loading}>
          {loading ? 'Verifying...' : 'Enter'}
        </button>
      </form>
    </main>
  );
}
