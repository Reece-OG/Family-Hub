import { prisma } from "./prisma";

export async function getSettings() {
  const existing = await prisma.appSettings.findUnique({ where: { id: "singleton" } });
  if (existing) return existing;
  return prisma.appSettings.create({
    data: {
      id: "singleton",
      countryCode: "GB",
      timezone: "Europe/London",
      showHolidays: true,
    },
  });
}
