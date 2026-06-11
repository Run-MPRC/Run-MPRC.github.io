import React from 'react';
import { Navigate, useLocation } from 'react-router-dom';
import { useAuth } from '../../services/hooks/useAuth';

interface AdminGuardProps {
  children: React.ReactNode;
}

function AdminGuard({ children }: AdminGuardProps) {
  const { isLoading, isAuthenticated, isAdmin } = useAuth();
  const location = useLocation();

  if (isLoading) {
    return <div className="container mx-auto p-6">Loading...</div>;
  }
  if (!isAuthenticated) {
    return <Navigate to="/login" state={{ from: location.pathname }} replace />;
  }
  if (!isAdmin) {
    return (
      <div className="container mx-auto p-6">
        <h1 className="text-2xl font-bold">Admins only</h1>
        <p className="text-gray-700 mt-2">
          This page is restricted to club admins.
        </p>
      </div>
    );
  }
  return <>{children}</>;
}

export default AdminGuard;
