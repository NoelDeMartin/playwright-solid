import { fmt, lint, pack } from '@noeldemartin/vite-plus-config';
import { defineConfig } from 'vite-plus';

export default defineConfig({
    pack,
    fmt,
    lint: { extends: [lint] },
});
