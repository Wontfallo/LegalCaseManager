"use client";

import { ReactNode, useEffect, useState } from "react";
import Link from "next/link";
import { useAuthStore } from "@/stores/authStore";
import { 
  Box, 
  Drawer, 
  List, 
  ListItem, 
  ListItemButton, 
  ListItemIcon, 
  ListItemText,
  Typography,
  CircularProgress,
  Switch,
  FormControlLabel,
  Divider,
} from "@mui/material";
import FolderIcon from "@mui/icons-material/Folder";
import SettingsIcon from "@mui/icons-material/Settings";
import GavelIcon from "@mui/icons-material/Gavel";

interface AppShellProps {
  children: ReactNode;
}

const drawerWidth = 240;

export default function AppShell({ children }: AppShellProps) {
  const { isLoading } = useAuthStore();
  const [theme, setTheme] = useState<"light" | "dark">("dark");

  useEffect(() => {
    if (typeof window === "undefined") return;
    const savedTheme = window.localStorage.getItem("legalcm:theme");
    if (savedTheme === "dark" || savedTheme === "light") {
      setTheme(savedTheme);
    }
  }, []);

  const toggleTheme = () => {
    const nextTheme = theme === "dark" ? "light" : "dark";
    setTheme(nextTheme);
    if (typeof window !== "undefined") {
      window.localStorage.setItem("legalcm:theme", nextTheme);
      // Fallback for non-MUI html elements
      document.documentElement.classList.toggle("dark", nextTheme === "dark");
    }
  };

  if (isLoading) {
    return (
      <Box sx={{ display: 'flex', minHeight: '100vh', alignItems: 'center', justifyContent: 'center' }}>
        <CircularProgress />
      </Box>
    );
  }

  return (
    <Box sx={{ display: 'flex', height: '100vh', overflow: 'hidden' }}>
      <Drawer
        variant="permanent"
        sx={{
          width: drawerWidth,
          flexShrink: 0,
          [`& .MuiDrawer-paper`]: { width: drawerWidth, boxSizing: 'border-box' },
        }}
      >
        <Box sx={{ display: 'flex', alignItems: 'center', p: 2.5, gap: 1.5 }}>
          <GavelIcon color="primary" />
          <Typography variant="h6" sx={{ fontWeight: 'bold' }}>LegalCM</Typography>
        </Box>
        <Divider />
        <List sx={{ flexGrow: 1, py: 2 }}>
          <ListItem disablePadding>
            <ListItemButton component={Link} href="/cases">
              <ListItemIcon>
                <FolderIcon />
              </ListItemIcon>
              <ListItemText primary="Cases" />
            </ListItemButton>
          </ListItem>
          <ListItem disablePadding>
            <ListItemButton component={Link} href="/settings">
              <ListItemIcon>
                <SettingsIcon />
              </ListItemIcon>
              <ListItemText primary="Settings" />
            </ListItemButton>
          </ListItem>
        </List>
        <Divider />
        <Box sx={{ p: 2 }}>
          <FormControlLabel
            control={<Switch checked={theme === 'dark'} onChange={toggleTheme} />}
            label={
              <Typography variant="body2" color="text.secondary">
                {theme === 'dark' ? 'Dark Mode' : 'Light Mode'}
              </Typography>
            }
          />
        </Box>
      </Drawer>

      <Box component="main" sx={{ flexGrow: 1, overflow: 'auto', bgcolor: 'background.default' }}>
        {children}
      </Box>
    </Box>
  );
}
