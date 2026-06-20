# owner-account-admin

Owner-only Supabase Edge Function for account actions that require the service-role key:

- send a password recovery email;
- revoke active sessions;
- block or unblock login;
- permanently delete an account.

The function verifies the caller's `profiles.role`, blocks destructive actions against the owner account, and records successful actions through RPC functions from `supabase-sql/016_owner_user_control_center.sql`.
