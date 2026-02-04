import { useState, useEffect, useCallback } from 'react';
import { Link } from 'react-router-dom';
import { API_SERVICE_B } from '../config';
import styles from './InternalDashboard.module.css';

const COLUMN_LABELS = {
  id: 'Ticket ID',
  concern: 'Concern',
  notes: 'Notes',
  userName: 'User Name',
  contact: 'Contact',
  lat: 'Latitude',
  lng: 'Longitude',
  area: 'Area',
  timestamp: 'Date & time',
};

const STORAGE_TOKEN = 'civic_token';
const STORAGE_ROLE = 'civic_role';

function formatCell(col, val) {
  if (
    col === 'timestamp' &&
    (typeof val === 'number' || (typeof val === 'string' && /^\d+$/.test(val)))
  ) {
    const ms = typeof val === 'string' ? parseInt(val, 10) : val;
    return new Date(ms).toLocaleString(undefined, {
      dateStyle: 'short',
      timeStyle: 'medium',
    });
  }
  return val ?? '';
}

function colHeader(name) {
  return COLUMN_LABELS[name] ?? name;
}

export default function InternalDashboard() {
  const [token, setToken] = useState(() => localStorage.getItem(STORAGE_TOKEN));
  const [role, setRole] = useState(() => localStorage.getItem(STORAGE_ROLE));
  const [loginRole, setLoginRole] = useState('OFFICER');
  const [tickets, setTickets] = useState([]);
  const [message, setMessage] = useState('');

  const isLoggedIn = Boolean(token && role);

  const login = async () => {
    setMessage('');
    try {
      const res = await fetch(`${API_SERVICE_B}/internal/login`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ role: loginRole }),
      });
      const data = await res.json();
      if (data.token) {
        setToken(data.token);
        setRole(data.role);
        localStorage.setItem(STORAGE_TOKEN, data.token);
        localStorage.setItem(STORAGE_ROLE, data.role);
        setMessage('');
      } else {
        setMessage(data.error || 'Login failed');
      }
    } catch {
      setMessage('Cannot reach Service B. Is it running on port 5000?');
    }
  };

  const logout = () => {
    setToken(null);
    setRole(null);
    setTickets([]);
    localStorage.removeItem(STORAGE_TOKEN);
    localStorage.removeItem(STORAGE_ROLE);
  };

  const loadTickets = useCallback(async () => {
    if (!token) return;
    setMessage('');
    try {
      const res = await fetch(`${API_SERVICE_B}/internal/tickets`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      const data = await res.json();
      if (Array.isArray(data)) {
        setTickets(data);
      } else {
        setMessage(data.error || 'Failed to load');
      }
    } catch {
      setMessage('Failed to load tickets');
    }
  }, [token]);

  useEffect(() => {
    if (token) loadTickets();
  }, [token, loadTickets]);

  const cols = Object.keys(tickets[0] || {});

  return (
    <div className={styles.page}>
      <h1 className={styles.title}>Government Internal - Ticket Dashboard</h1>

      {!isLoggedIn ? (
        <div className={styles.login}>
          <label>Role:</label>
          <select
            value={loginRole}
            onChange={(e) => setLoginRole(e.target.value)}
            className={styles.select}
          >
            <option value="OFFICER">Field Officer</option>
            <option value="SUPERVISOR">Supervisor</option>
          </select>
          <button type="button" onClick={login} className={styles.btn}>
            Login
          </button>
        </div>
      ) : (
        <div className={styles.dashboard}>
          <p className={styles.bar}>
            Logged in as <strong>{role}</strong>{' '}
            <button type="button" onClick={logout} className={styles.btnSecondary}>
              Logout
            </button>
          </p>
          <p className={styles.internalLink}>
            <Link to="/">← Public: Report an issue</Link>
          </p>
          <button type="button" onClick={loadTickets} className={styles.btn}>
            Refresh Tickets
          </button>
          <div className={styles.tableWrap}>
            {tickets.length > 0 ? (
              <table className={styles.table}>
                <thead>
                  <tr>
                    {cols.map((c) => (
                      <th key={c}>{colHeader(c)}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {tickets.map((row, i) => (
                    <tr
                      key={row.id ?? i}
                      className={cols.length <= 4 ? styles.rowLimited : undefined}
                    >
                      {cols.map((c) => (
                        <td key={c}>{formatCell(c, row[c])}</td>
                      ))}
                    </tr>
                  ))}
                </tbody>
              </table>
            ) : (
              <p>No tickets yet.</p>
            )}
          </div>
        </div>
      )}

      {message && <div className={styles.error}>{message}</div>}
    </div>
  );
}
