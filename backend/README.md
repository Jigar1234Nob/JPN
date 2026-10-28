# JPN backend

JPN is operated by J-Private-Networking Group (full name: Jigar Private Networking Group).

Node.js 20+ / Express API using Supabase Auth for identity, Postgres row-level security, manual paid entitlements, and private download links.

## API endpoints

- GET /api/health - public health check
- GET /api/me - authenticated account identity, role, and membership status
- GET /api/profile and PATCH /api/profile - current user's profile
- GET /api/entitlement - current user's server-side paid status
- GET /api/downloads - lists published downloads only for active paid members (admins can access)
- POST /api/downloads/:id/url - creates a private signed download link lasting 60 seconds
- POST /api/admin/users/invite - admin-only account invitation by email
- GET /api/admin/users?email=... - admin-only member search
- PATCH /api/admin/users/:id/plan - admin-only assign No access, Premium, or Enterprise access with optional expiry
- PATCH /api/admin/users/:id/disabled - admin-only suspend or re-enable an account
- GET/POST/PATCH/DELETE /api/admin/download-groups - manage resource groups
- GET/POST/PATCH/DELETE /api/admin/downloads - manage published builds and GitHub URLs
- POST /api/inquiries/enterprise - public Enterprise inquiry submission
- GET/PATCH /api/admin/enterprise-inquiries - review and update inquiry status
- PATCH /api/admin/users/:id/entitlement - legacy paid-access grant/revoke endpoint

All protected endpoints require Authorization: Bearer <Supabase access token>. The API validates the token with Supabase Auth. Database calls use the same user's JWT, and admin RPC functions independently verify the caller's immutable app_metadata role. The account-invitation and account-suspension endpoints require SUPABASE_SERVICE_ROLE_KEY, kept only in the backend environment and never exposed to browser code. Account signup confirmations, password resets, email changes, and admin invitations are sent by Supabase Auth using the SMTP provider configured in Supabase Authentication settings. Render does not send email and requires no SMTP credentials. Invitation emails redirect to `/invitation/`, where the invited person verifies the invitation and sets a password. Enterprise inquiries are stored in Supabase and reviewed in the admin console; custom email notifications are not sent by Supabase Auth.

## 1. Apply database migrations

In Supabase Dashboard > SQL Editor, run these scripts in order:

1. backend/sql/001_profiles.sql
2. backend/sql/002_entitlements_and_downloads.sql
3. backend/sql/003_plan_requests.sql
4. backend/sql/004_tiers_resources_and_account_controls.sql

The second script creates entitlements, private download metadata, the private storage bucket, row-level security policies, and guarded admin functions. The third script adds plan-request details to admin search. The fourth script adds Premium/Enterprise tiers, group-based download catalogue metadata, GitHub release URLs, account suspension state, and Enterprise inquiry storage. Plan requests are informational and never grant access by themselves; server-side entitlements control access. Apply migrations 001 through 007 in order before using the expanded admin console. Migration 007 removes Basic from new plan assignments while preserving existing legacy Basic entitlements.

## 2. Create your administrator account

1. Create a normal account using the JPN login page, or choose the account you intend to administer.
2. In Supabase Dashboard, open Authentication > Users and select that account.
3. Edit its **app metadata** (not user metadata) to include this JSON object: {"role":"admin"}.
4. Save the change, then sign out and sign back in so the account gets a fresh access token.
5. Open https://jigar1234nob.github.io/JPN/admin/ and confirm that the admin console appears.

Never implement admin status using a browser-editable user_metadata field. The API trusts only server-controlled app_metadata and the database RPC functions check that role again.

## 3. Run locally

From the backend directory:

    npm install
    Copy-Item .env.example .env
    npm run dev

Edit .env with the Supabase project URL and publishable key. On Windows PowerShell, Copy-Item is the native copy command. The API will listen on http://localhost:3000 unless PORT is changed.

Check http://localhost:3000/api/health.

## 4. Deploy the API

For Render:

1. Create a Web Service connected to this repository.
2. Set Root Directory to backend.
3. Build command: npm install
4. Start command: npm start
5. Add SUPABASE_URL, SUPABASE_PUBLISHABLE_KEY, SUPABASE_SERVICE_ROLE_KEY (server-only; never put it in docs/supabase-config.js), and FRONTEND_ORIGINS=https://jigar1234nob.github.io.
6. In Supabase Dashboard > Authentication > URL Configuration, add `https://jigar1234nob.github.io/JPN/invitation/` to the allowed Redirect URLs so invitation links can return to the password setup page.
7. After deployment, test the service's /api/health endpoint.
8. Ensure docs/supabase-config.js exports JPN_API_BASE set to the deployed HTTPS origin, without /api at the end.

The API is not live just because files are committed. A successful /api/health response, working environment variables, and all database migrations are required.

## 5. Publish a private download

The bucket jpn-private-downloads is private. Upload the release file to it using Supabase Storage while signed in as the administrator. Then, as the admin, insert a row in public.jpn_downloads, for example:

    insert into public.jpn_downloads (id, title, description, version, bucket, object_path, published)
    values ('jpn-app-1-0', 'JPN App', 'Official JPN application', '1.0.0',
            'jpn-private-downloads', 'releases/jpn-app-1-0.zip', true);

Replace object_path with the exact path of the uploaded file. The admin policy permits this insert through a properly authenticated admin SQL/session. Do not upload private releases into the public GitHub Pages docs folder. Public assets are not gated.

An active entitlement is required for the API to list downloads and reveal build links. Private Supabase Storage links expire after 60 seconds; links already generated remain valid until they expire. GitHub-hosted release URLs are public once revealed, so use private Supabase Storage for files that must remain confidential.

## Signup terms acceptance

The signup page requires acceptance of `/JPN/terms/` and stores the terms version and timestamp in Supabase signup metadata. The disclosure explains that authorized operators with log access may be able to see IP addresses and that third-party application providers have their own terms. Metadata records the acknowledgement but is not a substitute for backend legal/compliance enforcement.

## Manual paid access, not billing

There is no checkout, payment processor, or automatic billing. The admin opens /JPN/admin/ to invite accounts by email, searches for existing members, and clicks Mark as paid or Revoke paid access. An optional expiry date can be set. This writes an entitlement in the database; the browser cannot grant itself membership.

## Security scope and remaining work

This starter enforces user sessions for profile APIs, server-verified admin role checks, manual paid entitlements, and private download access. GitHub Pages still serves the public HTML/CSS/JS pages to anyone who knows their URLs, but sensitive account data, admin actions, and download links are protected by the backend/database. Never place private files in docs/ or rely on hidden navigation for access control.

JPN is focused on its application and member download library. No web proxy service is part of the product scope.