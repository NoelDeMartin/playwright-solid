import { existsSync, readFileSync } from 'fs';
import { dirname, resolve } from 'path';
import { fileURLToPath } from 'url';

import { normalizeSparql, createSolidDocument, deleteSolidDocument } from '@noeldemartin/solid-utils';
import { applyReplacements } from '@noeldemartin/utils';
import { expect } from '@playwright/test';
import type { Page } from '@playwright/test';
import { setEngine, Container, SolidEngine, bootCoreModels } from 'soukai-bis';

import { authenticate, resetAuthentication } from './auth';
import { config, serverUrl, podUrl, webId } from './utils';

const _dirname = typeof __dirname !== 'undefined' ? __dirname : dirname(fileURLToPath(import.meta.url));

function defaultPodDocuments(): string[] {
  return [podUrl('/'), podUrl('/profile/'), podUrl('/profile/card'), podUrl('/README')];
}

async function deleteContainer(url: string): Promise<void> {
  const container = await Container.findOrFail(url);

  await Promise.all(
    container.resourceUrls.map(async (url) => {
      if (url.endsWith('/')) {
        await deleteContainer(url);

        return;
      }

      await deleteDocument(url);
    }),
  );

  await deleteDocument(url);
}

async function deleteDocument(url: string): Promise<void> {
  if (defaultPodDocuments().includes(url)) {
    return;
  }

  await deleteSolidDocument(url, { fetch: await authenticate() });
}

async function replaceDocument(url: string, body: string): Promise<void> {
  const authenticatedFetch = await authenticate();

  await authenticatedFetch(url, {
    method: 'PUT',
    headers: { 'Content-Type': 'text/turtle' },
    body,
  });
}

async function resetPod(retry: boolean = true): Promise<void> {
  const authenticatedFetch = await authenticate();

  bootCoreModels(true);
  setEngine(new SolidEngine(authenticatedFetch));

  try {
    await deleteContainer(podUrl('/'));
    await replaceDocument(
      podUrl('/profile/card'),
      `
        @prefix foaf: <http://xmlns.com/foaf/0.1/>.
        @prefix solid: <http://www.w3.org/ns/solid/terms#>.

        <>
          a foaf:PersonalProfileDocument;
          foaf:maker <#me>;
          foaf:primaryTopic <#me>.

        <#me>
          a foaf:Person;
          foaf:name "${config('name')}";
          solid:oidcIssuer <${serverUrl('/')}>.
      `,
    );
  } catch (error) {
    if (!retry) {
      throw error;
    }

    resetAuthentication();

    await resetPod(false);
  }
}

export async function solidReset(): Promise<void> {
  await resetPod();
}

export async function solidLogin(page: Page): Promise<void> {
  const appUrl = page.url();

  await page.waitForURL(new RegExp('^' + serverUrl()));

  // Check if we are already logged in on the identity provider
  const isAlreadyLoggedIn = await page.getByText(webId()).isVisible();

  if (!isAlreadyLoggedIn) {
    await page.fill('#email', config('email'));
    await page.fill('#password', config('password'));
    await page.click('button:has-text("Log in")');
    await expect(page.getByText(webId())).toBeVisible();
  }

  // Authorize
  await page.waitForTimeout(200);
  await page.click('button:has-text("Authorize")');
  await page.waitForTimeout(200);

  // Wait to return to the app
  await page.waitForURL(appUrl);
}

export async function solidCreateDocument(
  path: string,
  turtleOrFixture: string,
  replacements: Record<string, string> = {},
): Promise<void> {
  let body = turtleOrFixture;
  const fixturePath = resolve(_dirname, 'fixtures', turtleOrFixture);
  if (existsSync(fixturePath)) {
    body = readFileSync(fixturePath, 'utf-8');
  }
  const authenticatedFetch = await authenticate();
  await createSolidDocument(podUrl(path), applyReplacements(body, replacements), {
    fetch: authenticatedFetch,
  });
}

export async function solidUpdateDocument(
  path: string,
  sparqlOrFixture: string,
  replacements: Record<string, string> = {},
): Promise<void> {
  let body = sparqlOrFixture;

  const fixturePath = resolve(_dirname, 'fixtures', sparqlOrFixture);

  if (existsSync(fixturePath)) {
    body = readFileSync(fixturePath, 'utf-8');
  }

  const authenticatedFetch = await authenticate();

  await authenticatedFetch(podUrl(path), {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/sparql-update' },
    body: normalizeSparql(applyReplacements(body, replacements)),
  });
}

export async function fixture(path: string): Promise<string> {
  return readFileSync(resolve(_dirname, 'fixtures', path), 'utf-8');
}
