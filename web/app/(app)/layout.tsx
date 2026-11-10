import AuthGate from "@/components/AuthGate";
import Shell from "@/components/Shell";

// Everything inside (app) needs a signed-in user and gets the sidebar + top bar.
export default function AppLayout({ children }: LayoutProps<"/">) {
  return (
    <AuthGate>
      <Shell>{children}</Shell>
    </AuthGate>
  );
}
