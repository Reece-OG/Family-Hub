import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireUser, HttpError } from "@/lib/auth";
import { can } from "@/lib/permissions";
import { handleError } from "@/lib/http";
import {
  ALLOWED_IMAGE_MIME,
  contentTypeFromExt,
  deleteImage,
  makeSafeImageFilename,
  readImage,
  saveImage,
} from "@/lib/recipe-images";

// Recipe hero images: generous 10 MB cap. Modern phone photos hit ~4–6 MB, so
// this lets someone paste straight from their camera roll without resizing,
// while keeping the uploads volume in check.
const MAX_BYTES = 10 * 1024 * 1024;

// POST /api/recipes/[id]/image — multipart upload, replaces any previous file.
export async function POST(
  req: NextRequest,
  { params }: { params: { id: string } },
) {
  try {
    const me = await requireUser();
    if (!can(me, "canEditRecipes")) {
      throw new HttpError(403, "No permission to manage recipes");
    }
    const recipe = await prisma.recipe.findUnique({
      where: { id: params.id },
    });
    if (!recipe) throw new HttpError(404, "Recipe not found");

    const form = await req.formData();
    const file = form.get("file");
    if (!(file instanceof File)) throw new HttpError(400, "Missing file");
    if (file.size === 0) throw new HttpError(400, "Empty file");
    if (file.size > MAX_BYTES) {
      throw new HttpError(
        400,
        `Image exceeds ${Math.floor(MAX_BYTES / 1024 / 1024)} MB limit`,
      );
    }
    if (!ALLOWED_IMAGE_MIME.has(file.type)) {
      throw new HttpError(400, `Unsupported image type: ${file.type}`);
    }

    const buf = Buffer.from(await file.arrayBuffer());
    const filename = makeSafeImageFilename(file.type);
    await saveImage(buf, filename);

    // Drop the previous upload so we don't leak orphaned files on disk.
    if (recipe.imageFilename && recipe.imageFilename !== filename) {
      await deleteImage(recipe.imageFilename).catch(() => {});
    }

    const updated = await prisma.recipe.update({
      where: { id: params.id },
      data: {
        imageFilename: filename,
        // When a user uploads their own photo we drop any legacy URL so the
        // UI doesn't show two images at once.
        imageUrl: null,
      },
    });
    return NextResponse.json({ ok: true, filename, recipe: updated });
  } catch (e) {
    return handleError(e);
  }
}

// GET /api/recipes/[id]/image — streams the uploaded image inline.
export async function GET(
  _req: NextRequest,
  { params }: { params: { id: string } },
) {
  try {
    const me = await requireUser();
    if (!can(me, "canViewRecipes")) {
      throw new HttpError(403, "No permission to view recipes");
    }
    const recipe = await prisma.recipe.findUnique({
      where: { id: params.id },
      select: { imageFilename: true, title: true },
    });
    if (!recipe) throw new HttpError(404, "Recipe not found");
    if (!recipe.imageFilename) throw new HttpError(404, "No image uploaded");
    const buf = await readImage(recipe.imageFilename);
    if (!buf) throw new HttpError(404, "File missing on disk");

    const ext = recipe.imageFilename.split(".").pop() || "";
    const safeTitle = recipe.title.replace(/[^a-z0-9-_]/gi, "_") || "recipe";
    return new NextResponse(buf, {
      status: 200,
      headers: {
        "Content-Type": contentTypeFromExt(ext),
        "Content-Disposition": `inline; filename="${safeTitle}.${ext}"`,
        // Cache in-tab but revalidate — lets the browser skip re-downloading
        // during a session while still picking up replacements right away.
        "Cache-Control": "private, max-age=0, must-revalidate",
      },
    });
  } catch (e) {
    return handleError(e);
  }
}

// DELETE /api/recipes/[id]/image — removes the file + clears the column.
export async function DELETE(
  _req: NextRequest,
  { params }: { params: { id: string } },
) {
  try {
    const me = await requireUser();
    if (!can(me, "canEditRecipes")) {
      throw new HttpError(403, "No permission to manage recipes");
    }
    const recipe = await prisma.recipe.findUnique({
      where: { id: params.id },
    });
    if (!recipe) throw new HttpError(404, "Recipe not found");
    if (recipe.imageFilename) {
      await deleteImage(recipe.imageFilename).catch(() => {});
    }
    const updated = await prisma.recipe.update({
      where: { id: params.id },
      data: { imageFilename: null },
    });
    return NextResponse.json({ ok: true, recipe: updated });
  } catch (e) {
    return handleError(e);
  }
}
