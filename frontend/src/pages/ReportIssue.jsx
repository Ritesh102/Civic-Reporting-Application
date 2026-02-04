import { useState } from 'react';
import { Link } from 'react-router-dom';
import axios from 'axios';
import { API_SERVICE_A } from '../config';
import styles from './ReportIssue.module.css';

const CONCERNS = [
  { value: '', label: '-- Select --' },
  { value: 'Pothole', label: 'Pothole' },
  { value: 'Streetlight', label: 'Streetlight' },
  { value: 'Garbage', label: 'Garbage / Waste' },
  { value: 'Water', label: 'Water Supply' },
  { value: 'Drainage', label: 'Drainage' },
  { value: 'Other', label: 'Other' },
];

function getLocation() {
  return new Promise((resolve, reject) => {
    if (!navigator.geolocation) {
      reject(new Error('Geolocation is not supported by your browser'));
      return;
    }
    navigator.geolocation.getCurrentPosition(resolve, reject, {
      enableHighAccuracy: true,
      timeout: 10000,
      maximumAge: 0,
    });
  });
}

export default function ReportIssue() {
  const [concern, setConcern] = useState('');
  const [notes, setNotes] = useState('');
  const [userName, setUserName] = useState('');
  const [contact, setContact] = useState('');
  const [manualCoords, setManualCoords] = useState(false);
  const [lat, setLat] = useState('');
  const [lng, setLng] = useState('');
  const [message, setMessage] = useState({ text: '', type: '' });
  const [submitting, setSubmitting] = useState(false);

  const showMsg = (text, type) => setMessage({ text, type });

  const setBangaloreCoords = () => {
    setLat('12.9716');
    setLng('77.5946');
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    setSubmitting(true);
    if (!manualCoords) showMsg('Getting your location...', 'info');

    try {
      let latitude, longitude;
      if (manualCoords) {
        latitude = parseFloat(lat);
        longitude = parseFloat(lng);
        if (Number.isNaN(latitude) || Number.isNaN(longitude)) {
          showMsg('Please enter valid latitude and longitude.', 'error');
          setSubmitting(false);
          return;
        }
        showMsg('Submitting report...', 'info');
      } else {
        const pos = await getLocation();
        latitude = pos.coords.latitude;
        longitude = pos.coords.longitude;
      }

      const body = {
        concern,
        notes: notes || undefined,
        userName,
        contact: contact || undefined,
        lat: latitude,
        lng: longitude,
      };

      showMsg('Submitting report...', 'info');
      const res = await axios.post(`${API_SERVICE_A}/api/v1/tickets`, body);
      showMsg(`Success! Ticket ID: ${res.data.ticketId}`, 'success');
      setConcern('');
      setNotes('');
      setUserName('');
      setContact('');
      setManualCoords(false);
      setLat('');
      setLng('');
    } catch (err) {
      if (err.code === 1) {
        showMsg('Location permission denied. Please allow location access to report issues.', 'error');
      } else if (err.code === 2) {
        showMsg('Location unavailable. Please check your device settings.', 'error');
      } else if (err.code === 3) {
        showMsg('Location request timed out. Please try again.', 'error');
      } else if (err.response) {
        const data = err.response.data;
        const status = err.response.status;
        if (status === 400 || status === 403 || status === 422) {
          showMsg(data.error || data.message || 'Invalid submission. Please check your details.', 'error');
        } else {
          showMsg('Server error. Please try again later.', 'error');
        }
      } else {
        showMsg(err.message || 'Something went wrong. Please try again.', 'error');
      }
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className={styles.page}>
      <h1 className={styles.title}>Civic Issue Reporting</h1>
      <p className={styles.intro}>
        Report local civic issues for Bangalore. Your location will be used to validate that the issue is within city limits.
      </p>
      <p className={styles.internalLink}>
        <Link to="/internal">Government staff → Internal dashboard</Link>
      </p>

      <form onSubmit={handleSubmit} className={styles.form}>
        <label htmlFor="concern">Concern Type</label>
        <select
          id="concern"
          value={concern}
          onChange={(e) => setConcern(e.target.value)}
          required
        >
          {CONCERNS.map((opt) => (
            <option key={opt.value || 'empty'} value={opt.value}>
              {opt.label}
            </option>
          ))}
        </select>

        <label htmlFor="notes">Description / Notes</label>
        <textarea
          id="notes"
          rows={3}
          placeholder="Describe the issue in detail..."
          value={notes}
          onChange={(e) => setNotes(e.target.value)}
        />

        <label htmlFor="userName">Your Name</label>
        <input
          id="userName"
          type="text"
          required
          placeholder="Enter your name"
          value={userName}
          onChange={(e) => setUserName(e.target.value)}
        />

        <label htmlFor="contact">Contact (optional)</label>
        <input
          id="contact"
          type="text"
          placeholder="Phone or email"
          value={contact}
          onChange={(e) => setContact(e.target.value)}
        />

        <label className={styles.checkboxLabel}>
          <input
            type="checkbox"
            checked={manualCoords}
            onChange={(e) => setManualCoords(e.target.checked)}
          />
          Use manual coordinates <span className={styles.checkboxHint}>(if location unavailable)</span>
        </label>

        {manualCoords && (
          <div className={styles.manualBox}>
            <p className={styles.manualHint}>
              Enter coordinates for testing. Example: Bangalore center (12.9716, 77.5946)
            </p>
            <div className={styles.coordsRow}>
              <input
                type="number"
                step="any"
                placeholder="Latitude"
                value={lat}
                onChange={(e) => setLat(e.target.value)}
                className={styles.coordInput}
              />
              <input
                type="number"
                step="any"
                placeholder="Longitude"
                value={lng}
                onChange={(e) => setLng(e.target.value)}
                className={styles.coordInput}
              />
              <button type="button" onClick={setBangaloreCoords} className={styles.secondaryBtn}>
                Use Bangalore
              </button>
            </div>
          </div>
        )}

        <button type="submit" className={styles.submitBtn} disabled={submitting}>
          Report Issue
        </button>
      </form>

      {message.text && (
        <div className={`${styles.msg} ${styles[message.type]}`}>{message.text}</div>
      )}
    </div>
  );
}
