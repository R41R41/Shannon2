import React from "react";
import { BrowserRouter, Routes, Route, Navigate } from "react-router-dom";
import Login from "./pages/Login";
import ShannonUI from "./pages/ShannonUI";
import AuthGuard from "./components/AuthGuard/AuthGuard";

interface AppProps {
  isTest?: boolean;
}

const App: React.FC<AppProps> = ({ isTest }) => {
  return (
    <BrowserRouter>
      <Routes>
        <Route path="/login" element={<Login />} />
        <Route
          path="/shannonUI"
          element={
            <AuthGuard>
              <ShannonUI isTest={isTest} />
            </AuthGuard>
          }
        />
        <Route path="*" element={<Navigate to="/login" replace />} />
      </Routes>
    </BrowserRouter>
  );
};

export default App;
