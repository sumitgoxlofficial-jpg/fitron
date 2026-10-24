import QRCode from "qrcode";
import { requireCrm } from "@/lib/auth/crm";
import { CRM_ROLE_LABEL } from "@/lib/domain/crm";
import { myProfile } from "@/lib/services/crm-profile";
import { initials } from "@/lib/format";
import { IdCard } from "./id-card";

export const metadata = { title: "My ID card · FITRON CRM" };
const DEPT = { sales: "Sales", manager: "Sales", marketing: "Marketing", admin: "Administration" } as const;

export default async function IdCardPage() {
  const u = await requireCrm();
  const me = await myProfile(u);
  const text = `FITRON EMPLOYEE\nID: ${me.empId}\nName: ${me.name}\nRole: ${CRM_ROLE_LABEL[u.role]}`;
  const svg = await QRCode.toString(text, { type: "svg", margin: 0, errorCorrectionLevel: "M", color: { dark: "#0e0d0a", light: "#f6f2e9" } });
  const joined = new Date(`${u.joinedAt}T00:00:00+05:30`).toLocaleDateString("en-IN", { day: "numeric", month: "short", year: "numeric", timeZone: "Asia/Kolkata" });
  const phone = me.profile.phone ? `+91 ${me.profile.phone.slice(0, 5)} ${me.profile.phone.slice(5)}` : "—";
  return (
    <section className="flex flex-col gap-5">
      <div className="flex flex-col gap-2">
        <span className="text-[11px] font-semibold tracking-[0.24em] text-[var(--accent)] uppercase">Employee identity · {me.empId}</span>
        <h1 className="m-0">My ID card</h1>
        <span className="text-[13px] text-[var(--muted)]">Drag the card in any direction to turn it. It rotates a full 360°.</span>
      </div>
      <IdCard d={{ name: me.name, role: CRM_ROLE_LABEL[u.role], dept: DEPT[u.role], joined, phone, empId: me.empId, initials: initials(me.name), photo: me.hasPhoto ? `/api/crm/photo/${u.id}?v=${me.photoTag}` : null, qr: `data:image/svg+xml,${encodeURIComponent(svg)}` }} />
    </section>
  );
}
