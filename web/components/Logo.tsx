import Image from "next/image";

// The golden mascot. The PNG has a transparent background, so it sits on any dark surface.
export default function Logo({ size, className = "" }: { size: number; className?: string }) {
  return <Image src="/logo.png" alt="" width={size} height={size} priority className={className} />;
}
