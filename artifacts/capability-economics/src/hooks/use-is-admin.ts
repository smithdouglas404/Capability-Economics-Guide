import { useUser } from "@clerk/react";

export function useIsAdmin(): { isAdmin: boolean; isLoaded: boolean } {
  const { user, isLoaded } = useUser();
  const role = (user?.publicMetadata as { role?: string } | undefined)?.role;
  return { isAdmin: role === "admin", isLoaded };
}
