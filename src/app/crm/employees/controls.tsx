"use client";

import { useState, useTransition } from "react";
import { Button, Input, Select } from "@/components/ui";
import { CRM_ROLES, CRM_ROLE_LABEL } from "@/lib/domain/crm";
import { employeeAction } from "../actions";

/** Role, manager, target and activation for one employee. The server refuses what isn't allowed (yourself, the last Super Admin). */
export function EmployeeControls({ userId, self, active, role, managerId, target, managers }: { userId: string; self: boolean; active: boolean; role: string; managerId: string | null; target: number; managers: { id: string; name: string }[] }) {
  const [r, setR] = useState(role);
  const [m, setM] = useState(managerId ?? "");
  const [t, setT] = useState(String(target || ""));
  const [msg, setMsg] = useState("");
  const [pending, start] = useTransition();
  const save = (patch: Parameters<typeof employeeAction>[1]) => start(async () => setMsg((await employeeAction(userId, patch))?.message ?? ""));
  return (
    <div className="flex flex-wrap items-center gap-1.5">
      <Select aria-label="Role" value={r} disabled={self} onChange={(e) => setR(e.target.value)} className="w-auto">{CRM_ROLES.map((x) => <option key={x} value={x}>{CRM_ROLE_LABEL[x]}</option>)}</Select>
      {r === "sales" && <Select aria-label="Reports to" value={m} onChange={(e) => setM(e.target.value)} className="w-auto"><option value="">No manager</option>{managers.map((x) => <option key={x.id} value={x.id}>{x.name}</option>)}</Select>}
      <Input aria-label="Monthly target in rupees" value={t} onChange={(e) => setT(e.target.value)} inputMode="numeric" placeholder="Target ₹" className="w-28" />
      <Button disabled={pending} onClick={() => save({ role: r, managerId: r === "sales" ? m || null : null, target: Number(t) || 0 })}>Save</Button>
      {!self && <Button variant={active ? "danger" : "default"} disabled={pending} onClick={() => save({ active: !active })}>{active ? "Deactivate" : "Reactivate"}</Button>}
      {msg && <span role="status" className="text-xs text-muted">{msg}</span>}
    </div>
  );
}
