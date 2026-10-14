import React from 'react';
import ReactDOM from 'react-dom/client';
import { BrowserRouter } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MotionConfig } from 'framer-motion';
import { Toaster } from 'sonner';
import './index.css';
import { ThemeProvider, useTheme } from '@/lib/theme';
import { AuthProvider } from '@/features/auth/AuthProvider';
import { App } from './App';

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 15_000,
      retry: (count, err) => {
        const status = (err as { status?: number; code?: string })?.code;
        if (status === 'PGRST301' || status === '42501') return false;
        return count < 2;
      },
      refetchOnWindowFocus: false,
    },
  },
});

function ThemedToaster() {
  const { resolved } = useTheme();
  return <Toaster theme={resolved} position="top-center" richColors closeButton toastOptions={{ className: 'font-sans' }} />;
}

const basename = import.meta.env.BASE_URL.replace(/\/$/, '') || '/';

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <ThemeProvider>
      <QueryClientProvider client={queryClient}>
        <MotionConfig reducedMotion="user">
          <BrowserRouter basename={basename} future={{ v7_startTransition: true, v7_relativeSplatPath: true }}>
            <AuthProvider>
              <App />
              <ThemedToaster />
            </AuthProvider>
          </BrowserRouter>
        </MotionConfig>
      </QueryClientProvider>
    </ThemeProvider>
  </React.StrictMode>,
);
