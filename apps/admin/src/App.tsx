import { createBrowserRouter, RouterProvider } from 'react-router';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { Layout, NAV_ITEMS } from './components/Layout';
import { TodayPage } from './pages/TodayPage';
import { PlaceholderPage } from './pages/PlaceholderPage';
import { OrdersPage } from './pages/OrdersPage';
import { OrderDetailPage } from './pages/OrderDetailPage';
import { CustomersPage } from './pages/CustomersPage';
import { CustomerDetailPage } from './pages/CustomerDetailPage';
import { StaffPage } from './pages/StaffPage';
import { DeliveriesPage } from './pages/DeliveriesPage';
import { StockPage } from './pages/StockPage';
import { PaymentsPage } from './pages/PaymentsPage';
import { StatementPage } from './pages/StatementPage';
import { SettingsPage } from './pages/SettingsPage';
import { SignInPage } from './pages/SignInPage';
import { AuthProvider, useAuth } from './lib/auth';

const BUILT = new Set<string>([
  '/',
  '/orders',
  '/deliveries',
  '/customers',
  '/staff',
  '/stock',
  '/payments',
  '/settings',
]);

const queryClient = new QueryClient({
  defaultOptions: { queries: { retry: 1, refetchOnWindowFocus: false } },
});

const router = createBrowserRouter([
  {
    path: '/',
    element: <Layout />,
    children: [
      { index: true, element: <TodayPage /> },
      { path: 'orders', element: <OrdersPage /> },
      { path: 'orders/:id', element: <OrderDetailPage /> },
      { path: 'customers', element: <CustomersPage /> },
      { path: 'customers/:id', element: <CustomerDetailPage /> },
      { path: 'deliveries', element: <DeliveriesPage /> },
      { path: 'staff', element: <StaffPage /> },
      { path: 'stock', element: <StockPage /> },
      { path: 'payments', element: <PaymentsPage /> },
      { path: 'customers/:id/statement', element: <StatementPage /> },
      { path: 'settings', element: <SettingsPage /> },
      ...NAV_ITEMS.filter((i) => !BUILT.has(i.path)).map((i) => ({
        path: i.path.slice(1),
        element: <PlaceholderPage navKey={i.key} phase={i.phase} />,
      })),
      { path: '*', element: <PlaceholderPage navKey="today" phase="—" /> },
    ],
  },
]);

/** Nothing in the portal is visible before an office sign-in. */
function Gate() {
  const { status } = useAuth();
  if (status === 'loading')
    return (
      <p className="loading" role="status">
        …
      </p>
    );
  if (status === 'signedOut') return <SignInPage />;
  return <RouterProvider router={router} />;
}

export function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <AuthProvider>
        <Gate />
      </AuthProvider>
    </QueryClientProvider>
  );
}
