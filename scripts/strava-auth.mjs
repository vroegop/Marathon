#!/usr/bin/env node
// One-time Strava OAuth authorization helper.
//
//   STRAVA_CLIENT_ID=... STRAVA_CLIENT_SECRET=... node scripts/strava-auth.mjs
//
// 1. Prints an authorization URL; open it in a browser and click "Authorize".
// 2. Strava redirects to http://localhost:8723/exchange_token?code=... which this
//    script catches (or paste the code manually if the browser is on another machine).
// 3. Exchanges the code for tokens and prints the refresh token to store as the
//    STRAVA_REFRESH_TOKEN secret. Nothing is written to disk.
//
// The Strava API application (https://www.strava.com/settings/api) must have
// "Authorization Callback Domain" set to: localhost

import http from 'node:http';
import readline from 'node:readline/promises';
import { stdin, stdout } from 'node:process';

const PORT = Number(process.env.STRAVA_AUTH_PORT || 8723);
const SCOPES = 'read,activity:read_all,profile:read_all';
const TOKEN_URL = process.env.STRAVA_TOKEN_URL || 'https://www.strava.com/oauth/token';
const AUTH_URL = process.env.STRAVA_AUTHORIZE_URL || 'https://www.strava.com/oauth/authorize';

async function ask(question) {
  const rl = readline.createInterface({ input: stdin, output: stdout });
  try {
    return (await rl.question(question)).trim();
  } finally {
    rl.close();
  }
}

async function main() {
  const clientId = process.env.STRAVA_CLIENT_ID || (await ask('Strava Client ID: '));
  const clientSecret = process.env.STRAVA_CLIENT_SECRET || (await ask('Strava Client Secret: '));
  const redirectUri = `http://localhost:${PORT}/exchange_token`;
  const url = new URL(AUTH_URL);
  url.searchParams.set('client_id', clientId);
  url.searchParams.set('response_type', 'code');
  url.searchParams.set('redirect_uri', redirectUri);
  url.searchParams.set('approval_prompt', 'force');
  url.searchParams.set('scope', SCOPES);

  console.log('\nOpen this URL in your browser and authorize the app:\n');
  console.log(`  ${url}\n`);

  const code = await new Promise((resolve) => {
    const server = http.createServer((req, res) => {
      const u = new URL(req.url, `http://localhost:${PORT}`);
      if (u.pathname !== '/exchange_token') {
        res.writeHead(404).end();
        return;
      }
      const c = u.searchParams.get('code');
      const scope = u.searchParams.get('scope') || '';
      if (!c) {
        res.writeHead(400, { 'content-type': 'text/plain' }).end(`No code in callback (${u.search}).`);
        return;
      }
      if (!scope.includes('activity:read_all')) {
        res.writeHead(400, { 'content-type': 'text/plain' }).end('Please authorize with "View data about your private activities" enabled and retry.');
        console.error(`Granted scopes "${scope}" do not include activity:read_all; re-run and tick all boxes.`);
        return;
      }
      res.writeHead(200, { 'content-type': 'text/plain' }).end('Authorized. You can close this tab and return to the terminal.');
      server.close();
      resolve(c);
    });
    server.listen(PORT, () => {
      console.log(`Waiting for the redirect on ${redirectUri} ...`);
      console.log('(If the browser cannot reach this machine, copy the "code=" value from the failed redirect URL and paste it here.)');
    });
    ask('Paste code manually (or just wait): ').then((manual) => {
      if (manual) {
        server.close();
        resolve(manual);
      }
    });
  });

  const body = new URLSearchParams({ client_id: clientId, client_secret: clientSecret, code, grant_type: 'authorization_code' });
  const res = await fetch(TOKEN_URL, { method: 'POST', body });
  const json = await res.json();
  if (!res.ok || !json.refresh_token) {
    console.error('Token exchange failed:', JSON.stringify(json));
    process.exit(1);
  }
  console.log(`\nAuthorized as ${json.athlete?.firstname || ''} ${json.athlete?.lastname || ''} (athlete id ${json.athlete?.id}).`);
  console.log('\nAdd these three GitHub Actions secrets (repo Settings -> Secrets and variables -> Actions):\n');
  console.log(`  STRAVA_CLIENT_ID     = ${clientId}`);
  console.log(`  STRAVA_CLIENT_SECRET = (your client secret)`);
  console.log(`  STRAVA_REFRESH_TOKEN = ${json.refresh_token}\n`);
  console.log('Then run the "Sync Strava" workflow from the Actions tab.');
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
