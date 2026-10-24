import { requireCrm } from "@/lib/auth/crm";
import { CRM_ROLE_LABEL } from "@/lib/domain/crm";
import { myProfile } from "@/lib/services/crm-profile";
import { fmtStamp } from "@/lib/format";
import { PhotoPicker } from "./photo-picker";
import { ProfileForm } from "./profile-form";

export const metadata = { title: "Profile · FITRON CRM" };

export default async function ProfilePage() {
  const u = await requireCrm(undefined, { setup: true });
  const me = await myProfile(u);
  return (
    <section className="flex flex-col gap-6">
      <div className="flex flex-col gap-2">
        <span className="text-[11px] font-semibold tracking-[0.24em] text-[var(--accent)] uppercase">{u.setupNeeded ? "Before you start" : "Your account"}</span>
        <h1 className="m-0">{u.setupNeeded ? "Set up your profile" : "Edit profile"}</h1>
        <p className="m-0 text-[13px] text-[var(--muted)]">{me.name} · {me.email} · {CRM_ROLE_LABEL[u.role]} · Employee ID <b className="tracking-[0.08em] text-[var(--accent-strong)]">{me.empId}</b></p>
      </div>
      <PhotoPicker userId={u.id} name={me.name} hasPhoto={me.hasPhoto} tag={me.photoTag} />
      <ProfileForm d={{ empId: me.empId, email: me.email, name: me.name, role: u.role, profile: me.profile, payout: me.payout, termsAccepted: me.termsAccepted, termsAcceptedText: me.termsAcceptedAt ? `Terms accepted on ${fmtStamp(me.termsAcceptedAt)}` : "", needsSetup: u.setupNeeded }} />
    </section>
  );
}
