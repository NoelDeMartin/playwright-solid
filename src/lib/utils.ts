let _config: Config = {
  serverUrl: 'http://localhost:3000',
  account: 'alice',
  name: 'Alice Cooper',
  email: 'alice@example.com',
  password: 'secret',
};

export interface Config {
  serverUrl: string;
  account: string;
  name: string;
  email: string;
  password: string;
}

export function updateConfig(values: Partial<Config>) {
  Object.assign(_config, values);
}

export function config(): Config;
export function config<TKey extends keyof Config>(key: TKey): Config[TKey];
export function config<TKey extends keyof Config>(key?: TKey): Config[TKey] | Config {
  if (!_config) {
    throw new Error('playwright-solid config is not set, call setConfig() first');
  }

  return key ? _config[key] : _config;
}

export function serverUrl(path: string = ''): string {
  return config('serverUrl') + path;
}

export function podUrl(path: string = ''): string {
  return serverUrl(`/${config('account')}/${path.replace(/^\//, '')}`);
}

export function webId(): string {
  return podUrl('/profile/card#me');
}
