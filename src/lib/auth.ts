import { buildAuthenticatedFetch, createDpopHeader, generateDpopKeyPair } from '@inrupt/solid-client-authn-core';
import { fail, isSuccessfulResponse, objectWithoutEmpty } from '@noeldemartin/utils';
import { z } from 'zod';

import { config, serverUrl, webId } from './utils';

let authenticatedFetch: typeof globalThis.fetch | null = null;

const CSSResponseSchema = z.object({
  controls: z.any(),
});

const CSSCredentialsResponseSchema = CSSResponseSchema.extend({
  id: z.string(),
  secret: z.string(),
});

const CSSAuthorizedResponseSchema = CSSResponseSchema.extend({
  authorization: z.string(),
});

const AccessTokenResponseSchema = z.object({
  access_token: z.string(),
});

function responseErrorMessage(context: string, response: unknown): string {
  if (typeof response === 'object' && response !== null && 'message' in response) {
    return `[${context}] ${String(response.message)}`;
  }

  if (typeof response === 'object' && response !== null && 'name' in response) {
    return `[${context}] ${String(response.name)}`;
  }

  return `[${context}] Unknown error response: ${JSON.stringify(response)}`;
}

async function controlUrl(key: string, authorization?: string): Promise<string> {
  const response = await fetch(serverUrl('/.account/'), {
    headers: objectWithoutEmpty({
      Authorization: authorization && `CSS-Account-Token ${authorization}`,
    }) as Record<string, string>,
  });

  const json = await response.json();
  const { success, data: parsed } = CSSResponseSchema.safeParse(json);

  if (!isSuccessfulResponse(response) || !success) {
    throw new Error(responseErrorMessage('controlUrl', json));
  }

  const url = key.split('.').reduce((controls, part) => controls[part], parsed.controls);

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
  const { success, data: parsed } = CSSCredentialsResponseSchema.safeParse(json);

  if (!isSuccessfulResponse(response) || !success) {
    throw new Error(responseErrorMessage('getCredentials', json));
  }

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
  const { success, data: parsed } = CSSAuthorizedResponseSchema.safeParse(json);

  if (!isSuccessfulResponse(response) || !success) {
    return null;
  }

  return parsed.authorization;
}

async function createAccount(): Promise<string> {
  const url = await controlUrl('account.create');
  const response = await fetch(url, { method: 'POST' });
  const json = await response.json();

  const { success, data: parsed } = CSSAuthorizedResponseSchema.safeParse(json);

  if (!isSuccessfulResponse(response) || !success) {
    throw new Error(responseErrorMessage('logIn', json));
  }

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

  if (!isSuccessfulResponse(response)) {
    throw new Error(responseErrorMessage('createPassword', json));
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

  if (!isSuccessfulResponse(response)) {
    throw new Error(responseErrorMessage('createPOD', json));
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
    const { success, data: parsed } = AccessTokenResponseSchema.safeParse(json);

    if (!success) {
      throw new Error(responseErrorMessage('authenticate', json));
    }

    authenticatedFetch = buildAuthenticatedFetch(parsed.access_token, { dpopKey });
  }

  return authenticatedFetch;
}
