import type { Metadata } from "next";
import AuthForm from "@/components/AuthForm";

export const metadata: Metadata = { title: "Log in · Cafeteria AI" };

export default function AuthPage() {
  return <AuthForm />;
}
