import { requireUser } from "@/lib/auth";
import { can } from "@/lib/permissions";
import { PhotosView } from "@/components/PhotosView";

export default async function PhotosPage() {
  const me = await requireUser();
  if (!can(me, "canViewPhotos")) {
    return <p className="muted">You don't have permission to view photos.</p>;
  }
  return (
    <div>
      <h1 className="text-2xl font-bold mb-4">Photos</h1>
      <PhotosView canManage={can(me, "canManagePhotos")} />
    </div>
  );
}
