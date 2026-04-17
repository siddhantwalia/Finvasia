import { Link, NavLink, useLocation } from "react-router-dom";
import { ThemeToggle } from "@/components/ThemeToggle";
import { Menu, X } from "lucide-react";
import { useState } from "react";

const links = [
  { to: "/intake", label: "Intake" },
  { to: "/summary", label: "Summary" },
  { to: "/compare", label: "Compare" },
  { to: "/simulate", label: "Simulate" },
  { to: "/exclusions", label: "Traps" },
  { to: "/explainer", label: "Explainer" },
];

export const Navbar = () => {
  const [open, setOpen] = useState(false);
  const loc = useLocation();
  return (
    <header className="sticky top-0 z-40 border-b border-border bg-background/85 backdrop-blur-md">
      <div className="container flex h-14 items-center justify-between gap-4">
        <Link to="/" className="flex items-center gap-2 font-mono text-sm font-semibold">
          <span className="inline-block h-2.5 w-2.5 bg-primary shadow-glow" />
          <span>IIE<span className="text-muted-foreground">/</span>terminal</span>
        </Link>

        <nav className="hidden md:flex items-center gap-1">
          {links.map((l) => (
            <NavLink
              key={l.to}
              to={l.to}
              className={({ isActive }) =>
                `font-mono text-[12px] uppercase tracking-widest px-3 py-1.5 border border-transparent transition-colors ${
                  isActive
                    ? "text-primary border-border bg-card"
                    : "text-muted-foreground hover:text-foreground hover:border-border"
                }`
              }
            >
              {l.label}
            </NavLink>
          ))}
        </nav>

        <div className="flex items-center gap-2">
          <span className="terminal-chip terminal-chip-live hidden sm:inline-flex">live</span>
          <ThemeToggle />
          <button
            aria-label="Menu"
            className="md:hidden h-9 w-9 grid place-items-center border border-border"
            onClick={() => setOpen((o) => !o)}
          >
            {open ? <X className="h-4 w-4" /> : <Menu className="h-4 w-4" />}
          </button>
        </div>
      </div>

      {open && (
        <div className="md:hidden border-t border-border bg-background">
          <nav className="container py-3 grid gap-1">
            {links.map((l) => (
              <Link
                key={l.to}
                to={l.to}
                onClick={() => setOpen(false)}
                className={`font-mono text-xs uppercase tracking-widest px-3 py-2 border ${
                  loc.pathname === l.to ? "border-border bg-card text-primary" : "border-transparent text-muted-foreground"
                }`}
              >
                {l.label}
              </Link>
            ))}
          </nav>
        </div>
      )}
    </header>
  );
};
