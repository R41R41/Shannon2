import { Navigate, useLocation } from "react-router-dom";

const AuthGuard: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const location = useLocation();
  const isAuthenticated = localStorage.getItem("isAuthenticated") === "true";
  const hostname = window.location.hostname;

  // 開発環境またはローカル環境での自動認証
  const isDevelopment = hostname === "localhost" || hostname === "127.0.0.1";

  if (isDevelopment && !isAuthenticated) {
    localStorage.setItem("isAuthenticated", "true");
    return <>{children}</>;
  }

  // 未認証の場合は、現在のURLをstate経由で渡す
  if (!isAuthenticated) {
    return <Navigate to="/login" state={{ from: location }} replace />;
  }

  return <>{children}</>;
};

export default AuthGuard;
