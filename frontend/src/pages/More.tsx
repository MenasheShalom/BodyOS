import { ChevronRight } from "lucide-react";
import { Link } from "react-router";

const LINKS = [
  { to: "/photos", label: "Photos", body: "Progress photos and before/after compare" },
  { to: "/nutrition", label: "Nutrition", body: "My foods, targets and settings" },
  { to: "/reports", label: "Weekly reports", body: "A written summary of each week" },
  { to: "/history", label: "History", body: "Every entry, edit or delete" },
  { to: "/goals", label: "Goals", body: "Targets and projections" },
  { to: "/settings", label: "Settings", body: "Profile, hidden fields, sign out" },
];

export function More() {
  return (
    <section>
      <h1 className="mb-4 text-2xl font-semibold">More</h1>
      <ul className="divide-y divide-border overflow-hidden rounded-2xl bg-surface">
        {LINKS.map((l) => (
          <li key={l.to}>
            <Link to={l.to} className="flex items-center justify-between px-4 py-3">
              <span>
                <span className="block">{l.label}</span>
                <span className="block text-sm text-muted">{l.body}</span>
              </span>
              <ChevronRight size={18} className="text-muted" />
            </Link>
          </li>
        ))}
      </ul>
    </section>
  );
}
