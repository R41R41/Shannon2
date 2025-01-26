import { Navigate, useLocation } from 'react-router-dom';

const AuthGuard: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const location = useLocation();
  const isAuthenticated = localStorage.getItem('isAuthenticated') === 'true';
  const isLocalhost =
    window.location.hostname === 'localhost' ||
    window.location.hostname === '127.0.0.1';

  // localhostの場合は自動認証
  if (isLocalhost && !isAuthenticated) {
    localStorage.setItem('isAuthenticated', 'true');
    return <>{children}</>;
  }

  // 非localhostで未認証の場合は、現在のURLをstate経由で渡す
  if (!isAuthenticated) {
    return <Navigate to="/login" state={{ from: location }} replace />;
  }

  return <>{children}</>;
};

export default AuthGuard;
