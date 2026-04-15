"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";

export default function HomePage() {
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
