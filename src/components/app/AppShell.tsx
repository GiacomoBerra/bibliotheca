import { Link, Outlet } from "@tanstack/react-router";
import { BookOpen, GraduationCap, HandHelping, LayoutDashboard, Library, LogOut, Settings } from "lucide-react";

import { useAuth } from "@/lib/auth/AuthProvider";

const nav: { to: string; label: string; icon: typeof Library; adminOnly?: boolean }[] = [
  { to: "/dashboard", label: "Dashboard", icon: LayoutDashboard },
  { to: "/catalogo", label: "Catalogo", icon: Library },
  { to: "/prestiti", label: "Prestiti", icon: HandHelping, adminOnly: true },
  { to: "/didattica", label: "Modalità didattica", icon: GraduationCap },
  { to: "/impostazioni", label: "Backup e impostazioni", icon: Settings },
];

export function AppShell() {
  const { user, signOut, isAdmin } = useAuth();
  return (
    <>
      <a href="#contenuto" className="sr-only focus:not-sr-only focus:fixed focus:left-2 focus:top-2 focus:z-50 focus:rounded focus:bg-card focus:px-3 focus:py-2">
        Salta al contenuto
      </a>
      <div className="min-h-screen md:flex">
        <aside className="bg-sidebar text-sidebar-foreground md:sticky md:top-0 md:h-screen md:w-64 md:shrink-0 md:flex md:flex-col">
          <div className="flex items-center gap-2 px-5 py-4 md:py-6">
            <BookOpen className="h-6 w-6 text-sidebar-primary" aria-hidden />
            <span className="font-serif text-xl font-semibold">Bibliotheca</span>
          </div>
          <nav aria-label="Navigazione principale" className="overflow-x-auto px-3 pb-3 md:flex-1">
            <ul className="flex gap-1 md:flex-col">
              {nav.filter((n) => !n.adminOnly || isAdmin).map(({ to, label, icon: Icon }) => (
                <li key={to}>
                  <Link
                    to={to}
                    className="flex items-center gap-3 whitespace-nowrap rounded-md px-3 py-2 text-sm font-medium text-sidebar-foreground/85 hover:bg-sidebar-accent hover:text-sidebar-accent-foreground focus-visible:outline-sidebar-ring"
                    activeProps={{ className: "bg-sidebar-accent text-sidebar-accent-foreground", "aria-current": "page" }}
                  >
                    <Icon className="h-4 w-4" aria-hidden />
                    {label}
                  </Link>
                </li>
              ))}
            </ul>
          </nav>
          <div className="border-t border-sidebar-border px-5 py-3 text-sm">
            <p className="truncate text-sidebar-foreground/70" title={user?.email ?? ""}>{user?.email}</p>
            <button type="button" onClick={() => void signOut()} className="mt-1 flex items-center gap-2 text-sidebar-foreground/80 hover:text-sidebar-foreground">
              <LogOut className="h-4 w-4" aria-hidden /> Esci
            </button>
          </div>
        </aside>
        <div className="min-w-0 flex-1">
          <main id="contenuto" className="mx-auto max-w-6xl px-4 py-8 md:px-8">
            <Outlet />
          </main>
        </div>
      </div>
    </>
  );
}
