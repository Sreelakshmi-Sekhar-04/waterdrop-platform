import { createBrowserRouter, RouterProvider } from 'react-router';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { Layout, NAV_ITEMS } from './components/Layout';
import { TodayPage } from './pages/TodayPage';
import { PlaceholderPage } from './pages/PlaceholderPage';

const queryClient = new QueryClient();

const router = createBrowserRouter([
  {
    path: '/',
    element: <Layout />,
    children: [
      { index: true, element: <TodayPage /> },
      ...NAV_ITEMS.filter((i) => i.path !== '/').map((i) => ({
        path: i.path.slice(1),
        element: <PlaceholderPage navKey={i.key} phase={i.phase} />,
      })),
      { path: '*', element: <PlaceholderPage navKey="today" phase="—" /> },
    ],
  },
]);

export function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <RouterProvider router={router} />
    </QueryClientProvider>
  );
}
