import { prisma } from "@/lib/prisma";
import { requireHousehold } from "@/lib/session";
import { ProfileForm } from "@/components/profile/profile-form";

export default async function ProfilePage() {
  const { userId } = await requireHousehold();
  const user = await prisma.user.findUniqueOrThrow({ where: { id: userId } });

  return (
    <div className="flex flex-col gap-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Profile</h1>
        <p className="text-sm text-muted-foreground">Your account details.</p>
      </div>
      <div className="max-w-sm rounded-md border p-4">
        <ProfileForm displayName={user.displayName} email={user.email} />
      </div>
    </div>
  );
}
