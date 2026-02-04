const isLocal =
  typeof window !== 'undefined' &&
  (window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1');

export const API_SERVICE_A = isLocal ? 'http://localhost:4000' : '';
export const API_SERVICE_B = isLocal ? 'http://localhost:5000' : '/api-internal';
