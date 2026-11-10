import type { Metadata } from "next";
import ProfileForm from "@/components/ProfileForm";

export const metadata: Metadata = { title: "Profile settings · Cafeteria AI" };

export default function ProfilePage() {
  return <ProfileForm />;
}
