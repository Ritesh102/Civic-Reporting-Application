import { Routes, Route, Link } from 'react-router-dom';
import ReportIssue from './pages/ReportIssue';
import InternalDashboard from './pages/InternalDashboard';

function App() {
  return (
    <Routes>
      <Route path="/" element={<ReportIssue />} />
      <Route path="/internal" element={<InternalDashboard />} />
    </Routes>
  );
}

export default App;
