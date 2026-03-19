import { expect, describe, it } from 'vite-plus/test';

import { podUrl, serverUrl, webId } from './utils';

describe('utils', () => {
  it('gets urls', () => {
    expect(serverUrl()).toBe('http://localhost:3000');
    expect(serverUrl('/bob/profile/card#me')).toBe('http://localhost:3000/bob/profile/card#me');
    expect(podUrl()).toBe('http://localhost:3000/alice/');
    expect(podUrl('/movies/spirited-away')).toBe('http://localhost:3000/alice/movies/spirited-away');
    expect(webId()).toBe('http://localhost:3000/alice/profile/card#me');
  });
});
