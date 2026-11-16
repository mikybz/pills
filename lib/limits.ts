/**
 * Upper bounds that keep one user (or a burst of sign-ups) from flooding the app.
 * Generous for real use; hitting one returns 429 `limit`.
 */
export const LIMITS = {
  /** Accounts in total, and new accounts per rolling 24 h (then "try later"). */
  maxUsers: 1000,
  maxNewUsersPerDay: 50,
  /** People / pets one user can create. */
  personsCreatedPerUser: 20,
  /** Medicines per person, archived included. */
  medicinesPerPerson: 100,
  /** Doses one user can log per rolling 24 h. */
  dosesPerUserPerDay: 500,
  /** Unused share codes per person at a time. */
  openShareCodesPerPerson: 10,
  /** Push subscriptions per user (the oldest is dropped beyond this). */
  pushSubscriptionsPerUser: 10,
  /** API requests per user per minute. */
  requestsPerMinute: 300,
  /** Share-code attempts per user per 15 min. */
  joinAttemptsPer15Min: 10,
  /** JSON request bodies. */
  maxBodyBytes: 64 * 1024,
} as const;
