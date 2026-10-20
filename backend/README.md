# JPN backend

Node.js 20+ / Express API using Supabase Auth for identity and Supabase Postgres row-level security for profile data.

## Endpoints

- GET /api/health - public health check
- GET /api/me - authenticated account identity
- GET /api/profile - authenticated user's profile
- PATCH /api/profile - update the authenticated user's display name

Protected endpoints require Authorization: Bearer <Supabase access token>. The API verifies the token with Supabase Auth and uses that same user token for database requests, so RLS policies still apply. The browser never supplies the trusted user ID.

## 1. Prepare Supabase

1. Open your Supabase project dashboard.
2. Go to SQL Editor.
3. Run the script at backend/sql/001_profiles.sql.
4. In Authentication > URL Configuration, set the Site URL to https://jigar1234nob.github.io/JPN/ and allow the JPN redirect URLs.
5. In Authentication > Providers, enable Email and decide whether to require email confirmation.

## 2. Run locally

Open a terminal in the backend folder:

    npm install
    cp .env.example .env

Edit .env with the Supabase project URL and publishable key, then run:

    npm run dev

Check http://localhost:3000/api/health.

Windows PowerShell:

    Copy-Item .env.example .env
    npm install
    npm run dev

Never commit .env. Do not use a Supabase service-role or secret key in this scaffold; database access is user-scoped and constrained by RLS.

## 3. Deploy the API

One simple option is Render:

1. Create a new Web Service connected to this repository.
2. Set Root Directory to backend.
3. Build command: npm install
4. Start command: npm start
5. Add environment variables SUPABASE_URL, SUPABASE_PUBLISHABLE_KEY, and FRONTEND_ORIGINS=https://jigar1234nob.github.io
6. After deployment, open the service's /api/health URL to verify it responds.

The API is not live just because these files are committed. Deployment and environment variables are still required. For production, use HTTPS, monitor logs, and configure rate limits appropriate to the service.

## Security scope

This starter provides token verification, CORS, basic rate limiting, and user-scoped profile endpoints. It does not yet implement proxy fetching, subscriptions/payments, admin roles, download entitlements, or server-side subscription enforcement. Those must be implemented before exposing paid or restricted services. GitHub Pages is static hosting and cannot enforce private-page access by itself.