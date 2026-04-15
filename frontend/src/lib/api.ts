/**
 * Axios-based API client with JWT token management.
 *
 * In both local development and Docker/production, the browser client
 * uses relative URLs (e.g., "/api/..."). Next.js rewrites proxy these
 * requests to the backend (configured via NEXT_PUBLIC_API_URL in
 * next.config.js, which runs server-side).
 *
 * IMPORTANT: The browser must always use relative URLs because in Docker
 * the backend hostname ("backend") is only resolvable inside the Docker
 * network, not from the user's browser.
 */

import axios, { AxiosError, AxiosInstance, InternalAxiosRequestConfig } from "axios";
import type { TokenResponse } from "@/types";

// Browser client always uses relative URLs — the Next.js rewrite proxy
// forwards /api/* to the backend. No direct backend URL needed here.
const API_BASE_URL = "";

class ApiClient {
  private client: AxiosInstance;
  private accessToken: string | null = null;
  private refreshToken: string | null = null;

  constructor() {
    this.client = axios.create({
      baseURL: API_BASE_URL,
      headers: {
        "Content-Type": "application/json",
      },
      timeout: 30000,
    });

    // Load tokens from localStorage (client-side only)
    if (typeof window !== "undefined") {
      this.accessToken = localStorage.getItem("access_token");
      this.refreshToken = localStorage.getItem("refresh_token");
    }

    // Request interceptor: attach Bearer token
    this.client.interceptors.request.use(
      (config: InternalAxiosRequestConfig) => {
        if (this.accessToken && config.headers) {
          config.headers.Authorization = `Bearer ${this.accessToken}`;
        }
        return config;
      },
      (error) => Promise.reject(error)
    );

    // Response interceptor: auto-refresh on 401
    this.client.interceptors.response.use(
      (response) => response,
      async (error: AxiosError) => {
        const originalRequest = error.config as InternalAxiosRequestConfig & {
          _retry?: boolean;
        };

        if (
          error.response?.status === 401 &&
          !originalRequest._retry &&
          this.refreshToken
        ) {
          originalRequest._retry = true;

          try {
            const refreshResponse = await axios.post<TokenResponse>(
              `/api/auth/refresh`,
              { refresh_token: this.refreshToken },
              { headers: { "Content-Type": "application/json" } }
            );

            this.setTokens(refreshResponse.data);

            if (originalRequest.headers) {
              originalRequest.headers.Authorization = `Bearer ${this.accessToken}`;
            }
            return this.client(originalRequest);
          } catch (refreshError) {
            this.clearTokens();
            return Promise.reject(refreshError);
          }
        }

        return Promise.reject(error);
      }
    );
  }

  setTokens(tokens: TokenResponse): void {
    this.accessToken = tokens.access_token;
    this.refreshToken = tokens.refresh_token;
    if (typeof window !== "undefined") {
      localStorage.setItem("access_token", tokens.access_token);
      localStorage.setItem("refresh_token", tokens.refresh_token);
    }
  }

  clearTokens(): void {
    this.accessToken = null;
    this.refreshToken = null;
    if (typeof window !== "undefined") {
      localStorage.removeItem("access_token");
      localStorage.removeItem("refresh_token");
    }
  }

  isAuthenticated(): boolean {
    return this.accessToken !== null;
  }

  // ── Generic request methods ───────────────────────────
  async get<T>(url: string, params?: Record<string, unknown>): Promise<T> {
    const response = await this.client.get<T>(url, { params });
    return response.data;
  }

  async post<T>(url: string, data?: unknown): Promise<T> {
    const response = await this.client.post<T>(url, data);
    return response.data;
  }

  async patch<T>(url: string, data?: unknown): Promise<T> {
    const response = await this.client.patch<T>(url, data);
    return response.data;
  }

  async delete<T>(url: string): Promise<T> {
    const response = await this.client.delete<T>(url);
    return response.data;
  }

  async getBlob(
    url: string,
    params?: Record<string, unknown>
  ): Promise<{ blob: Blob; contentType: string | undefined; filename: string | null }> {
    const response = await this.client.get(url, {
      params,
      responseType: "blob",
    });
    const disposition = response.headers["content-disposition"] as string | undefined;
    const filenameMatch = disposition?.match(/filename="?([^";]+)"?/i);
    return {
      blob: response.data as Blob,
      contentType: response.headers["content-type"] as string | undefined,
      filename: filenameMatch?.[1] || null,
    };
  }

  async uploadFile<T>(
    url: string,
    file: File,
    params?: Record<string, string>
  ): Promise<T> {
    const formData = new FormData();
    formData.append("file", file);

    const queryString = params
      ? "?" + new URLSearchParams(params).toString()
      : "";

    const response = await this.client.post<T>(`${url}${queryString}`, formData, {
      headers: {
        "Content-Type": "multipart/form-data",
      },
      timeout: 120000, // 2 min for large file uploads
    });
    return response.data;
  }
}

export const apiClient = new ApiClient();
