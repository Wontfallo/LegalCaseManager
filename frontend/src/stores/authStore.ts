/**
 * Global auth store using Zustand.
 *
 * Single-user local mode: on first load, if no tokens exist the store
 * automatically calls /api/auth/auto-login to create and authenticate
 * the local owner account. No manual login required.
 */

import { create } from "zustand";
import type { UserResponse } from "@/types";
import { apiClient } from "@/lib/api";

interface AuthState {
  user: UserResponse | null;
  isLoading: boolean;
  isAuthenticated: boolean;
  login: (email: string, password: string) => Promise<void>;
  logout: () => void;
  fetchUser: () => Promise<void>;
}

export const useAuthStore = create<AuthState>((set) => ({
  user: null,
  isLoading: true,
  isAuthenticated: false,

  login: async (email: string, password: string) => {
    const tokens = await apiClient.post<{
      access_token: string;
      refresh_token: string;
      token_type: string;
      expires_in: number;
    }>("/api/auth/login", { email, password });

    apiClient.setTokens(tokens);

    const user = await apiClient.get<UserResponse>("/api/auth/me");
    set({ user, isAuthenticated: true, isLoading: false });
  },

  logout: () => {
    apiClient.clearTokens();
    set({ user: null, isAuthenticated: false, isLoading: false });
  },

  fetchUser: async () => {
    try {
      // If we already have tokens, verify them
      if (apiClient.isAuthenticated()) {
        const user = await apiClient.get<UserResponse>("/api/auth/me");
        set({ user, isAuthenticated: true, isLoading: false });
        return;
      }

      // No tokens — auto-login for local single-user mode
      const tokens = await apiClient.post<{
        access_token: string;
        refresh_token: string;
        token_type: string;
        expires_in: number;
      }>("/api/auth/auto-login");

      apiClient.setTokens(tokens);

      const user = await apiClient.get<UserResponse>("/api/auth/me");
      set({ user, isAuthenticated: true, isLoading: false });
    } catch {
      // If auto-login fails too, just mark as loaded (app will still render)
      apiClient.clearTokens();
      set({ user: null, isAuthenticated: false, isLoading: false });
    }
  },
}));
