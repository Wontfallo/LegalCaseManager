"use client";

import { useState, useEffect } from "react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { Toaster } from "react-hot-toast";
import { useAuthStore } from "@/stores/authStore";
import { ThemeProvider, createTheme, CssBaseline } from "@mui/material";

// Standardize Google Material aesthetics but with the dark brand colors.
const muiTheme = createTheme({
  palette: {
    mode: 'dark',
    primary: {
      main: '#8251EE',
      light: '#A888FA',
      dark: '#6B3DD9',
    },
    background: {
      default: '#0A0C10',
      paper: '#12141A',
    },
    divider: 'rgba(255, 255, 255, 0.1)',
  },
  typography: {
    fontFamily: 'inherit',
    button: {
      textTransform: 'none',
      fontWeight: 600,
    },
  },
  shape: {
    borderRadius: 8,
  },
  components: {
    MuiButton: {
      styleOverrides: {
        root: {
          boxShadow: 'none',
        },
      },
    },
  },
});

export default function Providers({ children }: { children: React.ReactNode }) {
  const [queryClient] = useState(
    () =>
      new QueryClient({
        defaultOptions: {
          queries: {
            staleTime: 30_000,
            retry: 1,
            refetchOnWindowFocus: false,
          },
        },
      })
  );

  const fetchUser = useAuthStore((s) => s.fetchUser);

  useEffect(() => {
    fetchUser();
  }, [fetchUser]);

  return (
    <ThemeProvider theme={muiTheme}>
      <CssBaseline />
      <QueryClientProvider client={queryClient}>
        {children}
        <Toaster
          position="top-right"
          toastOptions={{
            duration: 4000,
            style: {
              background: "#1E2128",
              color: "#fff",
              borderRadius: "8px",
              fontSize: "0.875rem",
              border: "1px solid rgba(255,255,255,0.1)",
            },
          }}
        />
      </QueryClientProvider>
    </ThemeProvider>
  );
}
