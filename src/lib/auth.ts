import { buildAuthenticatedFetch, createDpopHeader, generateDpopKeyPair } from '@inrupt/solid-client-authn-core';
import { fail, objectWithoutEmpty } from '@noeldemartin/utils';
import fetch from 'node-fetch'; // or use native fetch in node >=18
import { z } from 'zod';

import { config, serverUrl, webId } from './utils';

const UnsuccessfulResponseSchema = z.object({
  statusCode: z.number().or(z.string()),
  message: z.string().optional(),
  name: z.string().optional(),
});

function isUnsuccessfulResponse(response: unknown, message?: string): response is { message?: string; name?: string } {
  const parsed = UnsuccessfulResponseSchema.safeParse(response);
  if (!parsed.success) return false;

  const data = parsed.data;
  return Number(data.statusCode) % 100 !== 2 && (!message || data.message === message);
}

let authenticatedFetch: typeof globalThis.fetch | null = null;

async function controlUrl(key: string, authorization?: string): Promise<string> {
  const response = await fetch(serverUrl('/.account/'), {
    headers: objectWithoutEmpty({
      Authorization: authorization && `CSS-Account-Token ${authorization}`,
    }) as Record<string, string>,
  });
  const json = await response.json();

  if (isUnsuccessfulResponse(json)) {
    if (json.message?.includes('does not belong to this account')) {
      // Our test deleted the profile card but then CSS recreated it without the right webId linkage or similar,
      // or we deleted something we shouldn't have and now the WebID isn't attached to the account properly.
      // Let's log it, and see if it recovers, though it might throw.
    }
    throw new Error(json.message || json.name);
  }

  const parsed = z.object({ controls: z.record(z.string(), z.any()) }).parse(json);
  const url = key.split('.').reduce((controls, part) => controls[part], parsed.controls as Record<string, any>);

  return typeof url === 'string' ? url : fail(`'${key}' CSS control not found`);
}

async function getCredentials(authorization: string): Promise<{ id: string; secret: string }> {
  const url = await controlUrl('account.clientCredentials', authorization);
  const response = await fetch(url, {
    method: 'POST',
    headers: {
      Authorization: `CSS-Account-Token ${authorization}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ webId: webId() }),
  });
  const json = await response.json();

  if (isUnsuccessfulResponse(json)) {
    throw new Error(json.message || json.name);
  }

  const parsed = z.object({ id: z.string(), secret: z.string() }).parse(json);
  return { id: parsed.id, secret: parsed.secret };
}

async function logIn(): Promise<string | null> {
  const url = await controlUrl('password.login');
  const response = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      email: config('email'),
      password: config('password'),
    }),
  });
  const json = await response.json();

  if (isUnsuccessfulResponse(json, 'Invalid email/password combination.')) {
    return null;
  }

  const parsed = z.object({ authorization: z.string() }).parse(json);
  return parsed.authorization;
}

async function createAccount(): Promise<string> {
  const url = await controlUrl('account.create');
  const response = await fetch(url, { method: 'POST' });
  const json = await response.json();

  if (isUnsuccessfulResponse(json)) {
    throw new Error(json.message || json.name);
  }

  const parsed = z.object({ authorization: z.string() }).parse(json);
  return parsed.authorization;
}

async function createPassword(authorization: string): Promise<void> {
  const url = await controlUrl('password.create', authorization);
  const response = await fetch(url, {
    method: 'POST',
    headers: {
      Authorization: `CSS-Account-Token ${authorization}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      email: config('email'),
      password: config('password'),
    }),
  });
  const json = await response.json();

  if (isUnsuccessfulResponse(json)) {
    throw new Error(json.message || json.name);
  }
}

async function createPOD(authorization: string): Promise<void> {
  const url = await controlUrl('account.pod', authorization);
  const response = await fetch(url, {
    method: 'POST',
    headers: {
      Authorization: `CSS-Account-Token ${authorization}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      name: config('account'),
    }),
  });
  const json = await response.json();

  if (isUnsuccessfulResponse(json)) {
    if (
      json.message?.includes('Existing containers cannot be updated via PUT') ||
      json.message?.includes('Pod creation failed')
    ) {
      // This implies the pod might have been created already and something else failed. We can ignore it safely.
      return;
    }
    throw new Error(json.message || json.name);
  }
}

async function setupAccount(): Promise<string> {
  const authorization = await createAccount();
  await createPassword(authorization);
  await createPOD(authorization);
  return authorization;
}

export function resetAuthentication(): void {
  authenticatedFetch = null;
}

export async function authenticate(): Promise<typeof globalThis.fetch> {
  if (!authenticatedFetch) {
    const authorization = (await logIn()) ?? (await setupAccount());
    const credentials = await getCredentials(authorization);
    const authString = `${encodeURIComponent(credentials.id)}:${encodeURIComponent(credentials.secret)}`;
    const tokenUrl = serverUrl('/.oidc/token');
    const dpopKey = await generateDpopKeyPair();
    const dpop = await createDpopHeader(tokenUrl, 'POST', dpopKey);
    const response = await fetch(tokenUrl, {
      method: 'POST',
      headers: {
        Authorization: `Basic ${Buffer.from(authString).toString('base64')}`,
        'Content-Type': 'application/x-www-form-urlencoded',
        DPoP: dpop,
      },
      body: 'grant_type=client_credentials&scope=webid',
    });
    const json = await response.json();

    if (isUnsuccessfulResponse(json)) {
      throw new Error(json.message || json.name);
    }

    const parsed = z.object({ access_token: z.string() }).parse(json);

    authenticatedFetch = buildAuthenticatedFetch(parsed.access_token, {
      dpopKey,
    }) as unknown as typeof globalThis.fetch;
  }

  return authenticatedFetch;
}
