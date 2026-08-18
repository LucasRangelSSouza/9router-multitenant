"use client";

/**
 * Tenant Store — Zustand + localStorage persist.
 *
 * Chosen over a React Context because the codebase already uses Zustand
 * (see themeStore, headerSearchStore, notificationStore) with the `persist`
 * middleware for exactly this kind of small global UI state. Reusing the
 * same pattern means no provider tree to wire up, no new context consumers,
 * and the selection survives page reloads / tab restarts automatically.
 *
 * `selectedTenantId === null` means "Global / All" — no ?tenantId filter is
 * applied and no tenantId is sent on create, matching current (pre-tenant)
 * behavior exactly.
 */

import { create } from "zustand";
import { persist } from "zustand/middleware";

export const useTenantStore = create(
  persist(
    (set, get) => ({
      tenants: [],
      selectedTenantId: null,
      loading: false,

      fetchTenants: async () => {
        set({ loading: true });
        try {
          const res = await fetch("/api/tenants");
          const data = await res.json().catch(() => ({}));
          if (res.ok) set({ tenants: data.tenants || [] });
        } catch (error) {
          console.log("Error fetching tenants:", error);
        } finally {
          set({ loading: false });
        }
      },

      setSelectedTenantId: (id) => set({ selectedTenantId: id || null }),

      createTenant: async (name) => {
        const trimmed = (name || "").trim();
        if (!trimmed) return { error: "Name is required" };
        try {
          const res = await fetch("/api/tenants", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ name: trimmed }),
          });
          const data = await res.json().catch(() => ({}));
          if (!res.ok) return { error: data.error || "Failed to create tenant" };
          set((state) => ({
            tenants: [...state.tenants, data.tenant],
            selectedTenantId: data.tenant.id,
          }));
          return { tenant: data.tenant };
        } catch (error) {
          console.log("Error creating tenant:", error);
          return { error: "Failed to create tenant" };
        }
      },
    }),
    {
      name: "9router-selected-tenant",
      // Only persist the selection — the tenant list itself is always
      // refetched from the server so it never goes stale in localStorage.
      partialize: (state) => ({ selectedTenantId: state.selectedTenantId }),
    }
  )
);
