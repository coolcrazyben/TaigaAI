import Link from "next/link";
import { BarChart3, Database, Upload, Fuel, Package } from "lucide-react";

const nav = [
  { href: "/",         label: "Connect",    icon: BarChart3 },
  { href: "/upload",   label: "Upload CSV", icon: Upload },
  { href: "/data",     label: "Data",       icon: Database },
  { href: "/products", label: "Products",   icon: Package },
];

export function AppShell({ children }: { children: React.ReactNode }) {
  return (
    <div className="min-h-screen bg-[#07090d] text-slate-100 analytics-grid">
      <div className="flex min-h-screen">
        {/* Sidebar */}
        <aside className="hidden w-60 flex-shrink-0 border-r border-green-950 bg-[#071209]/90 px-4 py-5 lg:flex lg:flex-col">
          <Link href="/" className="mb-8 flex items-center gap-3">
            <div className="flex h-9 w-9 items-center justify-center rounded-full bg-green-700">
              <Fuel size={17} className="text-white" />
            </div>
            <div>
              <div className="text-sm font-bold tracking-wide text-white">Prince Oil</div>
              <div className="text-xs text-green-600">Store Analytics</div>
            </div>
          </Link>

          <nav className="flex-1 space-y-1">
            {nav.map((item) => (
              <Link
                key={item.href}
                href={item.href}
                className="flex items-center gap-3 rounded-lg px-3 py-2.5 text-sm text-green-200/80 transition hover:bg-green-950/60 hover:text-white"
              >
                <item.icon size={16} />
                {item.label}
              </Link>
            ))}
          </nav>

          <div className="mt-auto pt-4 border-t border-green-950">
            <p className="text-xs text-green-800">Prince Oil · Mississippi</p>
            <p className="text-xs text-green-900">10 Locations</p>
          </div>
        </aside>

        {/* Mobile header */}
        <div className="flex flex-1 flex-col">
          <div className="border-b border-green-950 bg-[#071209]/90 px-4 py-3 lg:hidden">
            <div className="flex items-center justify-between">
              <Link href="/" className="flex items-center gap-2 font-bold text-white">
                <Fuel size={16} className="text-green-500" />
                Prince Oil
              </Link>
              <nav className="flex gap-1">
                {nav.map((item) => (
                  <Link
                    key={item.href}
                    href={item.href}
                    className="rounded-md p-2 text-green-300 hover:bg-green-950"
                  >
                    <item.icon size={17} />
                  </Link>
                ))}
              </nav>
            </div>
          </div>

          <main className="flex-1">{children}</main>
        </div>
      </div>
    </div>
  );
}
