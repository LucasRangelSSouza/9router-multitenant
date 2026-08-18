"use client";

import { useEffect, useState } from "react";
import { useTenantStore } from "@/store/tenantStore";

// Simple combo box + "new tenant" button, per explicit product decision:
// functionality over polish for the tenant switcher. Selection is global
// (Zustand + localStorage, see src/store/tenantStore.js) so any page can
// read it without prop drilling.
export default function TenantSelector() {
  const tenants = useTenantStore((s) => s.tenants);
  const selectedTenantId = useTenantStore((s) => s.selectedTenantId);
  const fetchTenants = useTenantStore((s) => s.fetchTenants);
  const setSelectedTenantId = useTenantStore((s) => s.setSelectedTenantId);
  const createTenant = useTenantStore((s) => s.createTenant);
  const [creating, setCreating] = useState(false);

  useEffect(() => {
    fetchTenants();
  }, [fetchTenants]);

  const handleCreate = async () => {
    const name = window.prompt("New tenant name:");
    if (!name || !name.trim()) return;
    setCreating(true);
    const { error } = await createTenant(name);
    setCreating(false);
    if (error) alert(error);
  };

  return (
    <div className="flex items-center gap-1">
      <select
        value={selectedTenantId || ""}
        onChange={(e) => setSelectedTenantId(e.target.value || null)}
        className="h-8 rounded-lg border border-border bg-surface/60 px-2 text-sm focus:outline-none focus:border-primary/50 transition-colors max-w-[140px]"
        title="Filter by tenant"
      >
        <option value="">Global / All</option>
        {tenants.map((t) => (
          <option key={t.id} value={t.id}>
            {t.name}
          </option>
        ))}
      </select>
      <button
        type="button"
        onClick={handleCreate}
        disabled={creating}
        className="flex h-8 w-8 items-center justify-center rounded-lg border border-border bg-surface/60 text-text-muted hover:text-primary hover:border-primary/50 transition-colors"
        title="New tenant"
        aria-label="New tenant"
      >
        <span className="material-symbols-outlined text-[16px]">add</span>
      </button>
    </div>
  );
}
