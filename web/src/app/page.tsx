"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";
import { Loader2 } from "lucide-react";
import { useSession } from "@/lib/session";

export default function Home() {
  const { ready, session } = useSession();
  const router = useRouter();

  useEffect(() => {
    if (!ready) return;
    router.replace(session ? "/dashboard" : "/login");
  }, [ready, session, router]);

  return (
    <div className="flex min-h-screen items-center justify-center">
      <Loader2 className="size-6 animate-spin text-muted-foreground" />
    </div>
  );
}
