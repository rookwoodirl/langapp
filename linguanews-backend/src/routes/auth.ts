import { Router, Request, Response } from 'express';
import jwt from 'jsonwebtoken';

const router = Router();

const GOOGLE_CLIENT_ID = process.env.GOOGLE_CLIENT_ID ?? '';
const GOOGLE_CLIENT_SECRET = process.env.GOOGLE_CLIENT_SECRET ?? '';
const JWT_SECRET = process.env.JWT_SECRET ?? '';
const BACKEND_URL = (process.env.BACKEND_URL ?? '').replace(/\/$/, '');

const GOOGLE_CALLBACK = `${BACKEND_URL}/auth/google/callback`;

// Only allow redirects back to the app — never to arbitrary URLs
const ALLOWED_PREFIXES = [
  'exp://',
  'linguanews://',
  'http://localhost',
  'http://127.0.0.1',
  ...(process.env.WEB_APP_URL ? [process.env.WEB_APP_URL.replace(/\/$/, '')] : []),
];
function isAllowed(uri: string): boolean {
  return ALLOWED_PREFIXES.some((p) => uri.startsWith(p));
}

// Step 1 — app opens this URL in a browser
// ?state contains the app's redirect URI (base64-encoded)
router.get('/google', (req: Request, res: Response) => {
  const { state } = req.query as { state?: string };

  if (state) {
    try {
      const decoded = Buffer.from(state, 'base64').toString('utf-8');
      if (!isAllowed(decoded)) {
        res.status(400).send('Invalid redirect URI');
        return;
      }
    } catch {
      res.status(400).send('Invalid state parameter');
      return;
    }
  }

  const params = new URLSearchParams({
    client_id: GOOGLE_CLIENT_ID,
    redirect_uri: GOOGLE_CALLBACK,
    response_type: 'code',
    scope: 'openid email profile',
    access_type: 'offline',
    prompt: 'select_account',
    ...(state ? { state } : {}),
  });

  res.redirect(`https://accounts.google.com/o/oauth2/v2/auth?${params}`);
});

// Step 2 — Google sends the user back here with a code
router.get('/google/callback', async (req: Request, res: Response) => {
  const { code, state } = req.query as { code?: string; state?: string };

  // Decode the app redirect URI from state; fall back to production scheme
  let appRedirect = 'linguanews://auth';
  if (state) {
    try {
      const decoded = Buffer.from(state, 'base64').toString('utf-8');
      if (isAllowed(decoded)) appRedirect = decoded;
    } catch { /* use fallback */ }
  }

  if (!code) {
    res.redirect(`${appRedirect}?error=no_code`);
    return;
  }

  try {
    // Exchange auth code for Google tokens
    const tokenRes = await fetch('https://oauth2.googleapis.com/token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        code,
        client_id: GOOGLE_CLIENT_ID,
        client_secret: GOOGLE_CLIENT_SECRET,
        redirect_uri: GOOGLE_CALLBACK,
        grant_type: 'authorization_code',
      }),
    });
    const tokens = await tokenRes.json() as { access_token?: string; error?: string };

    if (!tokens.access_token) {
      console.error('Token exchange failed:', tokens.error);
      res.redirect(`${appRedirect}?error=token_exchange_failed`);
      return;
    }

    // Fetch the user's profile from Google
    const userRes = await fetch('https://www.googleapis.com/oauth2/v3/userinfo', {
      headers: { Authorization: `Bearer ${tokens.access_token}` },
    });
    const user = await userRes.json() as { sub: string; email: string; name: string };

    // Mint a long-lived app JWT — the Google secret never leaves this server
    const token = jwt.sign(
      { userId: user.sub, email: user.email, name: user.name },
      JWT_SECRET,
      { expiresIn: '365d' },
    );

    res.redirect(`${appRedirect}?token=${encodeURIComponent(token)}`);
  } catch (err) {
    console.error('OAuth callback error:', err);
    res.redirect(`${appRedirect}?error=server_error`);
  }
});

export default router;
