"use client";

import { useEffect, useState, useMemo } from "react";

interface Company {
  name: string;
  batch: string;
  industry: string;
  subIndustry: string;
  oneLiner: string;
  description: string;
  location: string;
  teamSize: string;
  website: string;
  status: string;
  stage: string;
  tags: string[];
  ycUrl: string;
  whyMech: string;
}

const SECTOR_MAP: Record<string, string> = {
  "Industrials -> Manufacturing and Robotics": "Manufacturing & Robotics",
  "Industrials": "Manufacturing & Robotics",
  "B2B -> Engineering, Product and Design": "Engineering & Design Tools",
  "B2B -> Analytics": "Engineering & Design Tools",
  "B2B -> Productivity": "Engineering & Design Tools",
  "B2B": "Engineering & Design Tools",
  "B2B -> Supply Chain and Logistics": "Supply Chain & Operations",
  "B2B -> Operations": "Supply Chain & Operations",
  "B2B -> Infrastructure": "Supply Chain & Operations",
  "Industrials -> Aviation and Space": "Aviation & Space",
  "Industrials -> Energy": "Energy & Climate",
  "Industrials -> Climate": "Energy & Climate",
  "Real Estate and Construction -> Construction": "Construction",
  "Real Estate and Construction": "Construction",
  "Real Estate and Construction -> Housing and Real Estate": "Construction",
  "Healthcare -> Medical Devices": "Healthcare & Bio",
  "Healthcare -> Drug Discovery and Delivery": "Healthcare & Bio",
  "Healthcare -> Industrial Bio": "Healthcare & Bio",
  "Healthcare": "Healthcare & Bio",
  "Healthcare -> Diagnostics": "Healthcare & Bio",
  "Healthcare -> Therapeutics": "Healthcare & Bio",
  "Healthcare -> Healthcare IT": "Healthcare & Bio",
  "Industrials -> Defense": "Defense & Government",
  "Government": "Defense & Government",
  "Industrials -> Agriculture": "Agriculture",
  "Industrials -> Automotive": "Automotive & Drones",
  "Industrials -> Drones": "Automotive & Drones",
  "Consumer -> Consumer Electronics": "Consumer Hardware",
  "Consumer": "Consumer Hardware",
  "Consumer -> Food and Beverage": "Consumer Hardware",
  "Consumer -> Virtual and Augmented Reality": "Consumer Hardware",
};

function getSector(subIndustry: string): string {
  return SECTOR_MAP[subIndustry] ?? "Other";
}

const BATCH_ORDER = [
  "Summer 2022","Winter 2022","Summer 2023","Winter 2023",
  "Summer 2024","Fall 2024","Winter 2024",
  "Spring 2025","Summer 2025","Fall 2025","Winter 2025",
  "Summer 2026","Winter 2026",
];

export default function ListPage() {
  const [companies, setCompanies] = useState<Company[]>([]);
  const [search, setSearch] = useState("");
  const [batch, setBatch] = useState("All");
  const [industry, setIndustry] = useState("All");
  const [sector, setSector] = useState("All");
  const [selected, setSelected] = useState<Company | null>(null);

  useEffect(() => {
    fetch("/companies.json").then((r) => r.json()).then(setCompanies);
  }, []);

  const batches = useMemo(() => {
    const available = new Set(companies.map((c) => c.batch));
    return ["All", ...BATCH_ORDER.filter((b) => available.has(b))];
  }, [companies]);

  const industries = useMemo(() => {
    const filtered = batch === "All" ? companies : companies.filter((c) => c.batch === batch);
    return ["All", ...Array.from(new Set(filtered.map((c) => c.industry))).sort()];
  }, [companies, batch]);

  const sectors = useMemo(() => {
    let filtered = batch === "All" ? companies : companies.filter((c) => c.batch === batch);
    if (industry !== "All") filtered = filtered.filter((c) => c.industry === industry);
    const sectorOrder = [
      "Manufacturing & Robotics","Engineering & Design Tools","Supply Chain & Operations",
      "Aviation & Space","Energy & Climate","Construction","Healthcare & Bio",
      "Defense & Government","Agriculture","Automotive & Drones","Consumer Hardware","Other",
    ];
    const available = new Set(filtered.map((c) => getSector(c.subIndustry)));
    return ["All", ...sectorOrder.filter((s) => available.has(s))];
  }, [companies, batch, industry]);

  const filtered = useMemo(() => {
    const q = search.toLowerCase();
    return companies.filter((c) => {
      if (batch !== "All" && c.batch !== batch) return false;
      if (industry !== "All" && c.industry !== industry) return false;
      if (sector !== "All" && getSector(c.subIndustry) !== sector) return false;
      if (q && !c.name.toLowerCase().includes(q) && !c.oneLiner.toLowerCase().includes(q) && !c.whyMech.toLowerCase().includes(q)) return false;
      return true;
    });
  }, [companies, search, batch, industry, sector]);

  const industryColors: Record<string, string> = {
    "B2B": "bg-blue-100 text-blue-800",
    "Industrials": "bg-orange-100 text-orange-800",
    "Healthcare": "bg-green-100 text-green-800",
    "Consumer": "bg-purple-100 text-purple-800",
    "Fintech": "bg-yellow-100 text-yellow-800",
    "Real Estate and Construction": "bg-red-100 text-red-800",
    "Government": "bg-gray-100 text-gray-800",
  };

  return (
    <div className="min-h-screen bg-gray-50">
      <div className="bg-white border-b border-gray-200 px-6 py-4">
        <div className="max-w-7xl mx-auto flex items-center justify-between">
          <div>
            <h1 className="text-xl font-bold text-gray-900">YC Physical AI Companies</h1>
            <p className="text-sm text-gray-500">2022–2026 · {filtered.length} of {companies.length} companies</p>
          </div>
          <a href="/graph" className="text-sm px-4 py-2 bg-gray-900 text-white rounded-lg hover:bg-gray-700 transition shrink-0">
            ← Cluster Map
          </a>
          <input
            type="text"
            placeholder="Search name, description..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="w-72 px-3 py-2 text-sm border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-orange-400"
          />
        </div>
      </div>

      <div className="max-w-7xl mx-auto px-6 py-6 flex gap-6">
        <aside className="w-52 shrink-0 space-y-5">
          <FilterGroup
            label="Batch"
            options={batches}
            value={batch}
            onChange={(v) => { setBatch(v); setSector("All"); }}
          />
          <FilterGroup
            label="Industry"
            options={industries}
            value={industry}
            onChange={(v) => { setIndustry(v); setSector("All"); }}
          />
          <FilterGroup
            label="Sector"
            options={sectors}
            value={sector}
            onChange={setSector}
          />
        </aside>

        <main className="flex-1 grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4 auto-rows-min">
          {filtered.map((c) => (
            <button
              key={c.name}
              onClick={() => setSelected(c)}
              className="text-left bg-white border border-gray-200 rounded-xl p-4 hover:border-orange-400 hover:shadow-md transition-all"
            >
              <div className="flex items-start justify-between gap-2 mb-2">
                <span className="font-semibold text-gray-900 text-sm leading-tight">{c.name}</span>
                <span className="text-xs text-gray-400 shrink-0">{c.batch.replace("Summer","S").replace("Winter","W").replace("Fall","F").replace("Spring","Sp")}</span>
              </div>
              <p className="text-xs text-gray-600 mb-3 line-clamp-2">{c.oneLiner}</p>
              <div className="flex flex-wrap gap-1">
                <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${industryColors[c.industry] ?? "bg-gray-100 text-gray-700"}`}>
                  {getSector(c.subIndustry)}
                </span>
                {c.location && (
                  <span className="text-xs px-2 py-0.5 rounded-full bg-gray-50 text-gray-500 border border-gray-200">
                    {c.location.split(",")[0]}
                  </span>
                )}
              </div>
            </button>
          ))}
          {filtered.length === 0 && (
            <div className="col-span-3 text-center text-gray-400 py-20">No companies match your filters.</div>
          )}
        </main>
      </div>

      {selected && (
        <div className="fixed inset-0 bg-black/40 z-50 flex justify-end" onClick={() => setSelected(null)}>
          <div
            className="bg-white w-full max-w-xl h-full overflow-y-auto p-6 shadow-xl"
            onClick={(e) => e.stopPropagation()}
          >
            <button onClick={() => setSelected(null)} className="text-gray-400 hover:text-gray-700 text-sm mb-4">← Close</button>
            <div className="flex items-start justify-between gap-2 mb-1">
              <h2 className="text-2xl font-bold text-gray-900">{selected.name}</h2>
              <span className={`text-xs px-2 py-1 rounded-full font-medium mt-1 ${selected.status === "Active" ? "bg-green-100 text-green-700" : "bg-red-100 text-red-700"}`}>
                {selected.status}
              </span>
            </div>
            <p className="text-sm text-gray-500 mb-4">{selected.batch} · {selected.location}</p>
            <p className="text-base font-medium text-gray-800 mb-4">{selected.oneLiner}</p>

            <div className="mb-5">
              <h3 className="text-xs font-semibold uppercase tracking-wide text-gray-400 mb-2">Why Physical AI</h3>
              <p className="text-sm text-gray-700 bg-orange-50 border border-orange-200 rounded-lg p-3">{selected.whyMech}</p>
            </div>

            {selected.description && (
              <div className="mb-5">
                <h3 className="text-xs font-semibold uppercase tracking-wide text-gray-400 mb-2">About</h3>
                <p className="text-sm text-gray-700 leading-relaxed line-clamp-[12]">{selected.description}</p>
              </div>
            )}

            <div className="mb-5 flex flex-wrap gap-2">
              <span className={`text-xs px-2 py-1 rounded-full font-medium ${industryColors[selected.industry] ?? "bg-gray-100 text-gray-700"}`}>
                {selected.subIndustry}
              </span>
              {selected.tags.map((t) => (
                <span key={t} className="text-xs px-2 py-1 rounded-full bg-gray-100 text-gray-600">{t}</span>
              ))}
            </div>

            <div className="flex gap-3">
              {selected.website && (
                <a href={selected.website} target="_blank" rel="noopener noreferrer"
                  className="text-sm px-4 py-2 bg-gray-900 text-white rounded-lg hover:bg-gray-700 transition">
                  Website
                </a>
              )}
              {selected.ycUrl && (
                <a href={selected.ycUrl} target="_blank" rel="noopener noreferrer"
                  className="text-sm px-4 py-2 bg-orange-500 text-white rounded-lg hover:bg-orange-400 transition">
                  YC Profile
                </a>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function FilterGroup({ label, options, value, onChange }: {
  label: string;
  options: string[];
  value: string;
  onChange: (v: string) => void;
}) {
  return (
    <div>
      <p className="text-xs font-semibold uppercase tracking-wide text-gray-400 mb-2">{label}</p>
      <div className="space-y-0.5 max-h-56 overflow-y-auto pr-1">
        {options.map((o) => (
          <button
            key={o}
            onClick={() => onChange(o)}
            className={`w-full text-left text-xs px-2 py-1.5 rounded-md transition ${
              value === o ? "bg-orange-500 text-white font-medium" : "text-gray-600 hover:bg-gray-100"
            }`}
          >
            {o}
          </button>
        ))}
      </div>
    </div>
  );
}
