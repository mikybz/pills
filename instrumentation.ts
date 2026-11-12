// Called once when a Next.js server instance starts. Starts the reminder
// scheduler in the Node.js runtime only (it uses Prisma and web-push).
export async function register() {
  if (process.env.NEXT_RUNTIME === "nodejs") {
    const { startReminderScheduler } = await import("./lib/reminders");
    startReminderScheduler();
  }
}
