// The four kinds of people the cafeteria serves. Self-declared at sign-up, changeable in Profile.
// Google sign-ups can't pick one, so they start as "outsider" until they change it.
export const ROLES = [
  { value: "student", label: "Student" },
  { value: "teacher", label: "Teacher" },
  { value: "worker", label: "University worker" },
  { value: "outsider", label: "Outsider" },
] as const;

export type Role = (typeof ROLES)[number]["value"];

export const roleLabel = (role: string | null | undefined) => ROLES.find((r) => r.value === role)?.label ?? "Outsider";
