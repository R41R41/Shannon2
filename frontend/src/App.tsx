import React from 'react';
import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';
import Login from './pages/Login';
import ShannonUI from './pages/ShannonUI';
import AuthGuard from './components/AuthGuard/AuthGuard';

const App: React.FC = () => {
  return (
    <BrowserRouter>
      <Routes>
        <Route path="/login" element={<Login />} />
        <Route
          path="/chat"
          element={
            <AuthGuard>
              <ShannonUI />
            </AuthGuard>
          }
        />
        <Route path="/" element={<Navigate to="/login" replace />} />
      </Routes>
    </BrowserRouter>
  );
};

export default App;
