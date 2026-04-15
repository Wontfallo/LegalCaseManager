"use client";

import { ReactNode, useEffect, useState } from "react";
import Link from "next/link";
import { useAuthStore } from "@/stores/authStore";
import { cn } from "@/lib/utils";

interface AppShellProps {
  children: ReactNode;
}

export default function AppShell({ children }: AppShellProps) {
  const { isLoading } = useAuthStore();
  const [theme, setTheme] = useState<"light" | "dark">("light");

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
      document.documentElement.classList.toggle("dark", nextTheme === "dark");
    }
  };

  if (isLoading) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-slate-50 dark:bg-slate-950">
        <div className="animate-spin h-8 w-8 rounded-full border-4 border-brand-600 border-t-transparent" />
      </div>
    );
  }

  return (
    <div className="flex h-screen bg-[#0A0C10] text-[#E7E9ED] selection:bg-[#8251EE]/30">
      {/* Sidebar */}
      <aside className="w-64 flex-shrink-0 border-r border-white/5 bg-[#0D0F14] relative z-20">
        <div className="flex h-full flex-col">
          {/* Logo */}
          <div className="flex h-16 items-center gap-3 border-b border-white/5 px-6">
            <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-gradient-to-br from-[#8251EE] to-[#A855F7] shadow-[0_0_15px_rgba(130,81,238,0.4)]">
              <svg
                className="h-5 w-5 text-white"
                fill="none"
                viewBox="0 0 24 24"
                strokeWidth={1.5}
                stroke="currentColor"
              >
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  d="M12 3v17.25m0 0c-1.472 0-2.882.265-4.185.75M12 20.25c1.472 0 2.882.265 4.185.75M18.75 4.97A48.416 48.416 0 0012 4.5c-2.291 0-4.545.16-6.75.47m13.5 0c1.01.143 2.01.317 3 .52m-3-.52l2.62 10.726c.122.499-.106 1.028-.589 1.202a5.988 5.988 0 01-2.031.352 5.988 5.988 0 01-2.031-.352c-.483-.174-.711-.703-.59-1.202L18.75 4.971zm-16.5.52c.99-.203 1.99-.377 3-.52m0 0l2.62 10.726c.122.499-.106 1.028-.589 1.202a5.989 5.989 0 01-2.031.352 5.989 5.989 0 01-2.031-.352c-.483-.174-.711-.703-.59-1.202L5.25 4.971z"
                />
              </svg>
            </div>
            <span className="text-xl font-bold tracking-tight bg-clip-text text-transparent bg-gradient-to-r from-white to-white/70">
              LegalCM
            </span>
          </div>

          {/* Navigation */}
          <nav className="flex-1 space-y-1 px-3 py-4">
            <Link
              href="/cases"
              className="group flex items-center gap-3 rounded-xl px-4 py-3 text-sm font-semibold text-[#A1A1AA] transition-all duration-200 hover:bg-[#8251EE]/10 hover:text-white"
            >
              <svg
                className="h-5 w-5 text-slate-400 dark:text-slate-500"
                fill="none"
                viewBox="0 0 24 24"
                strokeWidth={1.5}
                stroke="currentColor"
              >
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  d="M2.25 12.75V12A2.25 2.25 0 014.5 9.75h15A2.25 2.25 0 0121.75 12v.75m-8.69-6.44l-2.12-2.12a1.5 1.5 0 00-1.061-.44H4.5A2.25 2.25 0 002.25 6v12a2.25 2.25 0 002.25 2.25h15A2.25 2.25 0 0021.75 18V9a2.25 2.25 0 00-2.25-2.25h-5.379a1.5 1.5 0 01-1.06-.44z"
                />
              </svg>
              Cases
            </Link>
            <Link
              href="/settings"
              className="group flex items-center gap-3 rounded-xl px-4 py-3 text-sm font-semibold text-[#A1A1AA] transition-all duration-200 hover:bg-[#8251EE]/10 hover:text-white"
            >
              <svg
                className="h-5 w-5 text-slate-400 dark:text-slate-500"
                fill="none"
                viewBox="0 0 24 24"
                strokeWidth={1.5}
                stroke="currentColor"
              >
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  d="M9.594 3.94c.09-.542.56-.94 1.11-.94h2.593c.55 0 1.02.398 1.11.94l.213 1.281c.063.374.313.686.645.87.074.04.147.083.22.127.325.196.72.257 1.075.124l1.217-.456a1.125 1.125 0 011.37.49l1.296 2.247a1.125 1.125 0 01-.26 1.431l-1.003.827c-.293.241-.438.613-.43.992a7.723 7.723 0 010 .255c-.008.378.137.75.43.991l1.004.827c.424.35.534.955.26 1.43l-1.298 2.247a1.125 1.125 0 01-1.369.491l-1.217-.456c-.355-.133-.75-.072-1.076.124a6.47 6.47 0 01-.22.128c-.331.183-.581.495-.644.869l-.213 1.281c-.09.543-.56.94-1.11.94h-2.594c-.55 0-1.019-.398-1.11-.94l-.213-1.281c-.062-.374-.312-.686-.644-.87a6.52 6.52 0 01-.22-.127c-.325-.196-.72-.257-1.076-.124l-1.217.456a1.125 1.125 0 01-1.369-.49l-1.297-2.247a1.125 1.125 0 01.26-1.431l1.004-.827c.292-.24.437-.613.43-.991a6.932 6.932 0 010-.255c.007-.38-.138-.751-.43-.992l-1.004-.827a1.125 1.125 0 01-.26-1.43l1.297-2.247a1.125 1.125 0 011.37-.491l1.216.456c.356.133.751.072 1.076-.124.072-.044.146-.086.22-.128.332-.183.582-.495.644-.869l.214-1.28z"
                />
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  d="M15 12a3 3 0 11-6 0 3 3 0 016 0z"
                />
              </svg>
              Settings
            </Link>
          </nav>

          <div className="border-t border-white/5 p-4">
            <button
              onClick={toggleTheme}
              className="flex w-full items-center justify-between rounded-xl px-4 py-3 text-xs font-bold uppercase tracking-widest text-[#A1A1AA] hover:bg-[#8251EE]/5 hover:text-[#8251EE] transition-all duration-200"
            >
              <span>{theme === "dark" ? "Dark Mode" : "Light Mode"}</span>
              <div className={cn("h-4 w-8 rounded-full p-1 transition-colors", theme === "dark" ? "bg-[#8251EE]" : "bg-white/10")}>
                <div className={cn("h-full w-2 rounded-full bg-white transition-transform", theme === "dark" ? "translate-x-4" : "translate-x-0")} />
              </div>
            </button>
          </div>
        </div>
      </aside>

      {/* Main content */}
      <main className="flex-1 overflow-auto bg-[#0A0C10] relative">
        {/* Ambient Glows */}
        <div className="absolute top-0 right-0 w-[500px] h-[500px] bg-[#8251EE]/5 blur-[120px] pointer-events-none" />
        <div className="absolute bottom-0 left-0 w-[400px] h-[400px] bg-[#3B82F6]/5 blur-[100px] pointer-events-none" />
        <div className="relative z-10 h-full">
          {children}
        </div>
      </main>
    </div>
  );
}
