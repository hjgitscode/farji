// The ONLY thing FARJI takes from Supabase for authorization: the verified user id.

type UserLike = { id?: unknown; is_anonymous?: unknown };

export type IdentityClient = {
  auth: { getUser(): Promise<{ data: { user: UserLike | null }; error: unknown }> };
};

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Asks Supabase Auth to validate the session token (auth.getUser() contacts the auth
 * server; it does not trust the cookie blindly the way getSession() does) and returns
 * the user's id. user_metadata / app_metadata are intentionally never read.
 */
export async function getVerifiedAuthUserId(client: IdentityClient): Promise<string | null> {
  const { data, error } = await client.auth.getUser();
  if (error || !data.user) return null;
  if (data.user.is_anonymous === true) return null; // anonymous sessions never get a FARJI account
  const id = data.user.id;
  return typeof id === "string" && UUID.test(id) ? id.toLowerCase() : null;
}
