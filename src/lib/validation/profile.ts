import * as z from "zod";
import "@/lib/zod-config";
import { indianPhone } from "./common";
import { newPassword } from "./site";

export const profileInput = z.object({
  name: z.string().trim().min(2, { error: "Enter your name." }).max(120),
  phone: indianPhone,
});

export type ProfileInput = z.infer<typeof profileInput>;

export const passwordChangeInput = z
  .object({ current: z.string().min(1, { error: "Enter your current password." }), password: newPassword, confirm: z.string() })
  .refine((d) => d.password === d.confirm, { path: ["confirm"], message: "The two passwords don't match." });

export type PasswordChangeInput = z.infer<typeof passwordChangeInput>;
