import type { ReactNode } from "react";
import { BookOpen } from "lucide-react";

export function AuthLayout({ title, children }: { title: string; children: ReactNode }) {
  return (
    <div className="flex min-h-screen items-center justify-center bg-sidebar px-4 py-10">
      <div className="w-full max-w-md rounded-xl bg-card p-8 shadow-xl">
        <div className="mb-6 flex items-center gap-2">
          <BookOpen className="h-7 w-7 text-primary" aria-hidden />
          <span className="font-serif text-2xl font-semibold">Bibliotheca</span>
        </div>
        <h1 className="text-2xl font-semibold">{title}</h1>
        {children}
      </div>
    </div>
  );
}

export function FormMessage({ tone, children }: { tone: "error" | "info" | "warning"; children: ReactNode }) {
  const cls = {
    error: "border-destructive/40 bg-destructive/10 text-destructive",
    info: "border-border bg-muted text-foreground",
    warning: "border-warning-foreground/30 bg-warning text-warning-foreground",
  }[tone];
  return (
    <p role={tone === "error" ? "alert" : "status"} className={`mt-4 rounded-md border p-3 text-sm ${cls}`}>
      {children}
    </p>
  );
}
