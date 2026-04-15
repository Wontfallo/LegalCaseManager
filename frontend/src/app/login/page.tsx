"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";

/**
 * Login page is no longer needed in single-user local mode.
 * Redirect to cases if someone navigates here directly.
 */
export default function LoginPage() {
  const router = useRouter();

  useEffect(() => {
    router.replace("/cases");
  }, [router]);

  return (
    <div className="flex min-h-screen items-center justify-center">
      <div className="animate-spin h-8 w-8 rounded-full border-4 border-brand-600 border-t-transparent" />
    </div>
  );
}
